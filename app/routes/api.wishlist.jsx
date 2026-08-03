import { createHash } from "node:crypto";
import { data as json } from "react-router";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import prisma from "../db.server";
import { emitBuySkipSubmitted, recordJourneyEventAwaited } from "../lib/ai/journey-events.server";
import { getAllCatalogProducts } from "../lib/ai/naia-catalog";
import { NAIA_VERIFIED_MEDIA_MAP } from "../lib/ai/naia-product-media";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/wishlist — fetch all wishlist items
 */

// ANALYZE ITEM ACTION (for Buy/Skip)

// Build NAIA_PRODUCTS from canonical catalog — single source of truth.
const ITEM_TYPE_TO_CATEGORY = { TOP: "Top", BOTTOM: "Bottom", OUTERWEAR: "Outerwear", DRESS: "Dress", SET: "Dress" };
const NAIA_PRODUCTS = getAllCatalogProducts().map(p => ({
  title: p.parsed.identity.verifiedTitle,
  category: ITEM_TYPE_TO_CATEGORY[p.parsed.identity.itemType] ?? "Top",
  handle: p.handle,
  url: p.parsed.identity.liveUrl ?? `https://naiabynadine.com/products/${p.handle}`,
  imageUrl: NAIA_VERIFIED_MEDIA_MAP.get(p.handle)?.resolvedUrl ?? null,
}));

const COMPLEMENTARY_CATEGORIES = {
  "Top":       ["Bottom", "Outerwear"],
  "Bottom":    ["Top", "Outerwear"],
  "Dress":     ["Outerwear"],
  "Outerwear": ["Top", "Bottom", "Dress"],
  "Shoes":     ["Top", "Bottom", "Dress", "Outerwear"],
  "Bag":       ["Top", "Bottom", "Dress", "Outerwear"],
  "Accessory": ["Top", "Bottom", "Dress", "Outerwear"],
  "Jewelry":   ["Top", "Bottom", "Dress", "Outerwear"],
};

// Maps uploaded-item category (Buy or Skip values) to compatible Closet enum values
const CLOSET_COMPATIBLE_CATEGORIES = {
  "Top":       ["BOTTOMS", "OUTERWEAR"],
  "Bottom":    ["TOPS", "OUTERWEAR"],
  "Dress":     ["OUTERWEAR"],
  "Outerwear": ["TOPS", "BOTTOMS", "DRESSES"],
  "Shoes":     ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
  "Bag":       ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
  "Accessory": ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
  "Jewelry":   ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
};

function hashForIndex(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Idempotency policy: create a new analysis attempt per submission.
// Guard: if the same customer submits the same imageUrl within 60 s (double-click /
// network retry), skip the DB write and return the fresh analysis without a duplicate record.
// DB-backed idempotency: 60-second bucket, keyed on customerId+imageUrl.
// The idempotencyKey is stored in the DB with a unique constraint — duplicate
// submissions within the same 60s window hit a P2002 and return the cached result.
const IDEMPOTENCY_WINDOW_SECONDS = 60;

async function analyzeItem(request) {
  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  const { imageUrl, category, color, brand, itemLink, forOccasion, whatLike, unsureAbout, colorNote, size } = body;

  if (!imageUrl) {
    return json({ error: "Image required" }, { status: 400 });
  }

  // ── 2. Identity — NaiaSession only; guest record must never receive writes ─
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return json({ error: "not_authenticated" }, { status: 401 });
  }
  // The shared guest customer (shopifyCustomerId: "guest") is a style-me session placeholder.
  // It must never receive BuyOrSkipAnalysis writes.
  if (naiaCustomer.shopifyCustomerId === "guest") {
    return json({ error: "not_authenticated" }, { status: 401 });
  }

  // ── 3. DB-backed idempotency key ────────────────────────────────────────────
  // Bucket = floor(epoch seconds / 60) — same bucket for all requests within 60s window.
  const bucket = Math.floor(Date.now() / (IDEMPOTENCY_WINDOW_SECONDS * 1000));
  const idempotencyKey = "bos:" + createHash("sha256")
    .update(`${naiaCustomer.id}:${imageUrl ?? ""}:${bucket}`)
    .digest("hex")
    .slice(0, 24);
  let isIdempotentRepeat = false;

  const styleProfile = naiaCustomer.onboardingProfile;

    const closetData = await prisma.customer.findUnique({
      where: { id: naiaCustomer.id },
      select: {
        closetItems: {
          take: 20,
          orderBy: { createdAt: "desc" },
          select: { name: true, category: true, primaryColor: true }
        }
      }
    });
    const closetItems = closetData?.closetItems || [];

    const normalizedCategory = (category || "").trim();
    const allowed = COMPLEMENTARY_CATEGORIES[normalizedCategory] || ["Top", "Bottom", "Dress", "Outerwear"];
    const eligibleProducts = NAIA_PRODUCTS.filter(p => allowed.includes(p.category));
    const fallbackProducts = eligibleProducts.length > 0 ? eligibleProducts : NAIA_PRODUCTS;

    const compatibleClosetCategories = CLOSET_COMPATIBLE_CATEGORIES[normalizedCategory] || ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"];
    const eligibleClosetItems = closetItems.filter(i => compatibleClosetCategories.includes(i.category));

    // ── 5. Call Claude AI ──────────────────────────────────────────────────────
    // Sanitize user-entered strings before embedding them in the prompt
    const sanitize = s => typeof s === "string" ? s.replace(/"/g, "'").replace(/\n/g, " ").trim() : "";
    const safeOccasion    = sanitize(forOccasion);
    const safeWhatLike    = sanitize(whatLike);
    const safeUnsureAbout = sanitize(unsureAbout);
    const safeSize        = sanitize(size);

    let analysisResponse;
    try {
      analysisResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-opus-4-5-20251101",
          max_tokens: 3000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: imageUrl } },
              {
                type: "text",
                text: `You are assessing a clothing item for a specific customer. Be honest, concise and constructive. Every point must be stated ONCE only — never repeated across sections.

ITEM DETAILS:
- Category: ${category||"unknown"}
- Customer-selected colour: ${Array.isArray(color) ? color.join(", ") : color||"unknown"}
- Brand: ${brand || "unknown"}
${safeSize ? `- Size the customer is considering: ${safeSize}` : ""}

${styleProfile ? `CUSTOMER STYLE PROFILE:
- Style personalities: ${styleProfile.stylePersonalities?.join(", ")}
- Favourite colours: ${styleProfile.favoriteColors?.join(", ")}
- Lifestyle: ${styleProfile.dressesFor?.join(", ")}
- Desired feeling: ${styleProfile.desiredFeeling}

COLOUR PREFERENCE RULE: Favourite colours are style preferences, not exclusions. Do not reject a neutral (beige, cream, grey, white) because the customer's palette differs. For each neutral, state specifically whether it complements their favourites, coordinates with their closet, and adds wardrobe variety.

CUSTOMER FIT DATA (use ONLY this data — never invent measurements not listed):
- Usual top size: ${styleProfile.topSize || "not on record"}
- Usual bottom size: ${styleProfile.bottomSize || "not on record"}
- Usual dress size: ${styleProfile.dressSize || "not on record"}
- Fit preferences: ${styleProfile.fitPreferences?.length > 0 ? styleProfile.fitPreferences.join(", ") : "not on record"}
- Areas to highlight: ${styleProfile.bodyFocusAreas?.length > 0 ? styleProfile.bodyFocusAreas.join(", ") : "not on record"}
- Areas to minimise: ${styleProfile.bodyAvoidAreas?.length > 0 ? styleProfile.bodyAvoidAreas.join(", ") : "not on record"}
Note: body shape, height, waist and hip measurements are not yet in this Passport.` : "No style profile on record — give a general analysis."}

CUSTOMER'S INPUTS:

OCCASION: ${safeOccasion || "(not provided)"}
${safeOccasion ? `→ Does this item suit "${safeOccasion}"? One concrete reason referencing the item's formality and that occasion's dress code. If yes, one styling tip. If no, what adjustment would help.` : "→ Suggest the most suitable occasions for this item."}

WHAT THEY LIKE: ${safeWhatLike || "(not provided)"}
${safeWhatLike ? `→ Agree, partly agree, or disagree? One concrete reason based on the item's actual construction — do not restate what they said.` : ""}

WHAT THEY ARE UNSURE ABOUT: ${safeUnsureAbout || "(not provided)"}
${safeUnsureAbout ? `→ Justified, partly justified, or not supported? Use "partly justified" — not "justified" — when the concern is about fit or sizing and no measurements are on the Passport (check: all sizes show "not on record"). The concern may be valid but cannot be confirmed without trying it on. Use "justified" only when the issue is clearly visible from the item itself (e.g. colour clash, obviously unsuitable construction). Be direct. Then offer 2–3 specific practical solutions — e.g. for a strapless concern: supportive strapless bra, grip strips or fashion tape, tailoring the bodice, a styling layer (scarf or blazer), or trying on before committing. Do not recommend skipping without considering solutions first.` : ""}

BEFORE YOU BUY — exactly 2 points (25–40 words each), no repeated colour/fit warnings, no unsupported brand or care claims. IMPORTANT: do NOT begin either point with a label such as "Fit & Practical Solution:" or "Wearability:" — the card headings already show these labels:
1. FIT & PRACTICAL SOLUTION — Using ONLY the Passport fit data above, explain in one sentence how the item's silhouette, waist placement and length may work for this customer. Then give 1–2 concrete practical actions: compare garment measurements with their own, try it on before committing, adjust the waistband, tailor the length, or style with a higher-coverage layer when relevant. No brand-sizing claims. No invented measurements. If Passport fit data is insufficient, state exactly: "Fit cannot be confirmed from your current Passport. Compare the garment's bust, waist and hip measurements with your own before buying."
2. WEARABILITY — In 1–2 short sentences: whether the item suits the entered occasion, whether it can realistically be worn more than once, and whether it fits the customer's lifestyle. Be honest if versatility is limited. Do not repeat colour commentary.

REPETITION RULE: Each colour, concern or trait appears ONCE across the entire response. Never repeat Final Condition reasoning in any earlier section.

VERDICT-AWARE ANALYSIS RULE: The verdict drives every section's framing.
- BUY: explain specifically what works — style match, occasion suitability, how it meets the customer's preferences. Honest and positive.
- SKIP FOR NOW: focus on what blocks the purchase — specific fit unknowns, styling conditions not yet met, practical hurdles. Explain what could make it work and what the customer should confirm before buying. Do NOT open with praise or frame it like a BUY recommendation.
- SKIP: be direct about what is clearly unsuitable. Do not soften to a conditional recommendation.
The "betterDirection" field (SKIP / SKIP FOR NOW only) must reflect this same logic — describe what type of product would better serve the customer for this occasion, based on their style personality, Passport fit data, and Closet gaps.

${eligibleClosetItems.length > 0 ? `COMPATIBLE CLOSET CANDIDATES (pairings must come ONLY from this list):
${eligibleClosetItems.map(i => `- ${i.name} (${i.category}${i.primaryColor ? ", "+i.primaryColor : ""})`).join("\n")}` : "NO COMPATIBLE CLOSET ITEMS — leave closetPairings as an empty array."}

NAIA COLLECTION (pick naiaMatch ONLY from this list, exact title):
${fallbackProducts.map(p => `- ${p.title}`).join("\n")}

CONSISTENCY REQUIREMENT: All styling advice must point in the same direction across every section. If the analysis concludes the item needs a specific foundation piece (e.g. a fitted solid-colour top to balance a bold print), then: (a) closetPairings must only include pieces that fill that role; (b) the NADINE recommendation must be a piece that fills the same role — if no NADINE product is a solid, neutral piece that complements the uploaded item when worn together, return naiaMatch as null; (c) buyIf/skipIf must reflect the same logic. Never recommend a NADINE piece that contradicts the advice given elsewhere.

STRICT RULES:
1. closetPairings: ONLY items from the compatible Closet candidates list above; never invent items. Before adding each pairing, apply both tests — include it ONLY if it passes BOTH: (a) OCCASION TEST: does the uploaded item + this Closet piece create an outfit genuinely appropriate for the labeled occasion? A black lace top with printed trousers is an evening look, not brunch. (b) BALANCE TEST: does this piece support the styling advice? If the analysis says the item needs solid colours to balance a bold print, include only solid-coloured pieces — not another printed or textured piece. If no Closet piece passes both tests, return [].
2. naiaMatch: ONLY from the nAia collection list — exact title only. Return null if no product from the list genuinely complements the uploaded item when worn together. A NADINE piece that shares the same dominant visual element (bold print, dramatic silhouette, heavy texture) competes rather than complements — return null in that case. Do not recommend alternatives or substitutes; this section is for pairings only.
3. occasions: ${safeOccasion ? `Include "${safeOccasion}" ONLY if the item genuinely suits it.` : "Suggest appropriate occasions."}
4. Do not invent or hallucinate any items

Respond ONLY with valid JSON, no markdown:
{
  "itemType": "specific type e.g. Maxi Skirt, Blazer, Midi Dress",
  "detectedColor": "AI colour read from the image e.g. BEIGE / CREAM — use ALL CAPS",
  "verdict": "BUY" — item suits this customer well | "SKIP FOR NOW" — has potential but depends on fit confirmation, trying on, or specific styling (not definitively unsuitable) | "SKIP" — only when genuinely unsuitable with no realistic path to making it work,
  "confidence": 0-100,
  "styleDNAMatch": "≤20 words — how this item fits or challenges their style DNA",
  "detailedAnalysis": {
    "silhouette": "≤15 words",
    "color": "≤15 words — how the item colour works with their favourites and closet",
    "versatility": "≤15 words"
  },
  "occasionFit": ${safeOccasion ? `{ "occasion": "rewrite as a natural noun phrase — the activity only, no item category (e.g. 'evening dining', 'brunch', 'casual outings', 'work meetings')", "fits": true or false, "explanation": "≤20 words — one concrete reason referencing the item's formality", "stylingTip": "≤15 words — one specific action" }` : "null"},
  "whatLikeEval": ${safeWhatLike ? `{ "aspect": "${safeWhatLike.slice(0,80)}", "agreement": "agree" or "partly agree" or "disagree", "explanation": "≤20 words — based on item's actual properties" }` : "null"},
  "concernEval": ${safeUnsureAbout ? `{ "concern": "${safeUnsureAbout.slice(0,80)}", "justified": "justified" or "partly justified" or "not supported", "explanation": "≤20 words — direct assessment", "solutions": ["specific practical solution 1", "specific practical solution 2"] }` : "null"},
  "closetPairings": [{"occasion": "For [specific moment e.g. brunch, evening, work, weekends]", "name": "exact item name from the list above", "reason": "≤8 words — how it works with this specific item"}],
  "fillsGap": null — OR — if no Closet piece passes the balance and occasion tests, state the gap honestly in ≤20 words: e.g. "No fitted solid top confirmed in your Closet — this is the missing piece to make it work.",
  "occasions": [],
  "naiaMatch": null — if no NADINE product genuinely complements the uploaded item when worn together | { "title": "exact title from NAIA COLLECTION list", "reason": "≤25 words — explain exactly how the NADINE piece is worn with this item: does it layer over, add coverage, or contrast length? Include one specific colour coordination fact. Physical facts only, no mood language." },
  "beforeYouBuy": ["25–40 words — silhouette and fit assessment + 1–2 concrete practical actions, or exact missing-data statement. Start directly with the content, no label prefix.", "25–40 words — occasion suitability, realistic wear frequency, lifestyle fit. Start directly with the content, no label prefix."],
  "buyIf": "≤20 words — the one concrete condition that justifies buying",
  "skipIf": "≤20 words — the one concrete condition that makes this a mistake",
  "betterDirection": null for BUY | "1–3 sentences for SKIP or SKIP FOR NOW: describe the specific type of product (silhouette, fabric, fit profile) that would better serve this customer for this occasion — grounded in their occasion need, style personality, fit preferences, and any Closet gaps. No brand names, no prices. Write as a constructive redirect, not a rejection.",
  "finalThought": "ONE sentence max 30 words — style type + entered occasion + main condition. No filler. Example: 'A strong match for your minimalist style and brunch occasions, but only buy it if you know strapless styles fit and feel secure on you.'"
}`
              }
            ]
          }]
        })
      });
    } catch (fetchErr) {
      console.error("[buy-skip] AI fetch failed:", fetchErr?.message?.slice(0, 80));
      return json({ error: "Analysis service unavailable. Please try again." }, { status: 503 });
    }

    // ── 6. Parse AI response ───────────────────────────────────────────────────
    const aiData = await analysisResponse.json();
    if (!aiData.content || !aiData.content[0]) {
      console.error("[buy-skip] Unexpected AI response shape:", JSON.stringify(aiData).slice(0, 200));
      return json({ error: "Analysis failed. Please try again." }, { status: 502 });
    }

    let analysis;
    try {
      const text = aiData.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      console.error("[buy-skip] Could not parse AI response as JSON");
      return json({ error: "Analysis failed. Please try again." }, { status: 502 });
    }

    // Harden closetPairings: validate against eligible closet items only; all fields individually type-checked
    const eligibleClosetNameMap = new Map(
      eligibleClosetItems
        .filter(i => i.name != null && i.name.trim() !== "")
        .map(i => [i.name.toLowerCase().trim(), i.name])
    );
    const seen = new Set();
    const rawPairings = Array.isArray(analysis.closetPairings) ? analysis.closetPairings : [];
    analysis.closetPairings = rawPairings
      .map(p => {
        let rawName = null;
        let rawReason = null;
        let rawOccasion = null;
        if (typeof p === "string") {
          rawName = p;
        } else if (p !== null && typeof p === "object" && !Array.isArray(p)) {
          const nameVal  = typeof p.name  === "string" && p.name.trim()  !== "" ? p.name  : null;
          const itemVal  = typeof p.item  === "string" && p.item.trim()  !== "" ? p.item  : null;
          const titleVal = typeof p.title === "string" && p.title.trim() !== "" ? p.title : null;
          rawName = nameVal ?? itemVal ?? titleVal;
          rawReason = typeof p.reason === "string" && p.reason.trim() !== "" ? p.reason.trim() : null;
          rawOccasion = typeof p.occasion === "string" && p.occasion.trim() !== "" ? p.occasion.trim() : null;
        } else {
          return null;
        }
        if (typeof rawName !== "string" || rawName.trim() === "") return null;
        const canonical = eligibleClosetNameMap.get(rawName.toLowerCase().trim());
        if (!canonical) return null;
        return { occasion: rawOccasion, name: canonical, reason: rawReason };
      })
      .filter(p => p !== null && !seen.has(p.name) && seen.add(p.name));

    // Deterministic fallback: when eligible closet items exist but model returned no valid pairing
    if (analysis.closetPairings.length === 0 && eligibleClosetItems.length > 0) {
      const namedEligible = eligibleClosetItems.filter(i => i.name != null && i.name.trim() !== "");
      if (namedEligible.length > 0) {
        const idx = hashForIndex((imageUrl || "") + normalizedCategory) % namedEligible.length;
        const fallbackItem = namedEligible[idx];
        analysis.closetPairings = [{
          name: fallbackItem.name,
          reason: "A complementary piece from your Closet to build this look around."
        }];
      }
    }

    // Validate naiaMatch title against eligible catalog; overwrite URL and imageUrl from server-side data.
    // If AI returned null (no genuine complement) or an unrecognised title, keep null — section is hidden.
    const matchedProduct = fallbackProducts.find(p => p.title === analysis.naiaMatch?.title);
    if (matchedProduct) {
      analysis.naiaMatch = { title: matchedProduct.title, url: matchedProduct.url, imageUrl: matchedProduct.imageUrl ?? null, reason: analysis.naiaMatch?.reason || null };
    } else {
      analysis.naiaMatch = null;
    }

    // ── 8. Persist analysis (awaited; DB-backed idempotency via unique key) ───
    // Verdict is stated intent only — never a transaction, purchase, or revenue signal.
    // "SKIP FOR NOW" is a conditional skip — persisted as SKIP in the DB enum but preserved in fullAnalysis for display.
    const verdictMap = { BUY: "BUY", "SKIP FOR NOW": "SKIP", SKIP: "SKIP", MAYBE: "MAYBE" };
    const persistedVerdict = verdictMap[analysis.verdict] ?? "INCOMPLETE";
    let analysisRecord;
    {
      try {
        analysisRecord = await prisma.buyOrSkipAnalysis.create({
          data: {
            customerId: naiaCustomer.id,
            verdict: persistedVerdict,
            reasoning:
              typeof analysis.finalThought === "string" && analysis.finalThought.trim() !== ""
                ? analysis.finalThought.slice(0, 1000)
                : "No reasoning provided.",
            productName: null,
            imageUrl,
            source: "buy-or-skip",
            schemaVersion: "2.0",
            idempotencyKey,
            // Batch 3 — rich fields
            confidence:   typeof analysis.confidence === "number" ? analysis.confidence : null,
            category:     normalizedCategory || null,
            colors:       Array.isArray(color) ? color.filter(c => typeof c === "string") : [],
            forOccasion:  typeof forOccasion === "string" && forOccasion.trim() ? forOccasion.trim().slice(0, 500) : null,
            whatLike:     typeof whatLike    === "string" && whatLike.trim()    ? whatLike.trim().slice(0, 500)    : null,
            unsureAbout:  typeof unsureAbout === "string" && unsureAbout.trim() ? unsureAbout.trim().slice(0, 500) : null,
            colorNote:    typeof colorNote   === "string" && colorNote.trim()   ? colorNote.trim().slice(0, 200)   : null,
            itemSize:     typeof size        === "string" && size.trim()        ? size.trim().slice(0, 100)        : null,
            fullAnalysis: {
              verdict:               analysis.verdict,
              confidence:            analysis.confidence,
              itemType:              analysis.itemType             ?? null,
              detectedColor:         typeof analysis.detectedColor === "string" && analysis.detectedColor.trim() ? analysis.detectedColor.trim() : null,
              styleDNAMatch:         analysis.styleDNAMatch        ?? null,
              detailedAnalysis:      analysis.detailedAnalysis     ?? null,
              occasionFit:           analysis.occasionFit          ?? null,
              whatLikeEval:          analysis.whatLikeEval         ?? null,
              concernEval:           analysis.concernEval          ?? null,
              closetPairings:        analysis.closetPairings       ?? [],
              fillsGap:              analysis.fillsGap              ?? null,
              occasions:             analysis.occasions             ?? [],
              naiaMatch:             analysis.naiaMatch             ?? null,
              naiaMatchRelationship: typeof analysis.naiaMatchRelationship === "string" ? analysis.naiaMatchRelationship : "alternative",
              beforeYouBuy:          Array.isArray(analysis.beforeYouBuy) ? analysis.beforeYouBuy.filter(s => typeof s === "string" && s.trim()) : [],
              buyIf:                 typeof analysis.buyIf  === "string" && analysis.buyIf.trim()  ? analysis.buyIf.trim()  : null,
              skipIf:                typeof analysis.skipIf === "string" && analysis.skipIf.trim() ? analysis.skipIf.trim() : null,
              betterDirection:       typeof analysis.betterDirection === "string" && analysis.betterDirection.trim() ? analysis.betterDirection.trim() : null,
              finalThought:          analysis.finalThought          ?? null,
            },
          },
        });
      } catch (dbErr) {
        if (dbErr?.code === "P2002") {
          // Idempotent repeat — same bucket/customer/image hit a concurrent write.
          isIdempotentRepeat = true;
        } else {
          console.error("[buy-skip] persistence failed:", dbErr?.code ?? "unknown");
          return json(
            { error: "Analysis could not be saved. Please try again." },
            { status: 503 },
          );
        }
      }

      // Event emitted only after confirmed new DB write — deduplicated by idempotency key
      if (!isIdempotentRepeat && analysisRecord) {
        try {
          await recordJourneyEventAwaited(
            emitBuySkipSubmitted({
              customerId: naiaCustomer.id,
              sessionId: "buy-or-skip",
              analysisId: analysisRecord.id,
              verdict: persistedVerdict,
              category: normalizedCategory || null,
            }),
            `buy_skip_submitted:${analysisRecord.id}:v1`,
          );
        } catch {
          // Event emission never blocks the response — analysis is already saved
        }
      }
    }

    return json({
      success: true,
      analysis,
      analysisId: analysisRecord?.id ?? null,
      closetItemCount: closetItems.length,
      eligibleClosetItemCount: eligibleClosetItems.length,
      idempotentRepeat: isIdempotentRepeat,
    });
}


// DEPRECATED loader — Batch 1 (2026-07-29)
// WishlistItem model does not exist in schema.prisma; this loader crashed with P2021.
// Saved Looks (style-me/result.tsx intent=save) is the current nAia-owned save mechanism.
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return Response.json({ items: [], authenticated: false, deprecated: true }, { headers: CORS });
}

/**
 * POST /api/wishlist — add or remove wishlist items
 * Body: { action: "add", naiaProductId, title, handle, image }
 *    or: { action: "remove", naiaProductId }
 */
export async function action({ request }) {
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "analyze") {
    return analyzeItem(request);
  }
  
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }

  const body = await request.json();
  const { action: act } = body;

  // Handle pure tracking events (no wishlist modification)
  if (act === "track" && body.sessionId) {
    try {
      await prisma.stylingEvent.create({
        data: {
          customerId: customer.id,
          sessionId: body.sessionId,
          productId: body.naiaProductId,
          productTitle: body.title || "Unknown",
          eventType: body.eventType,
        },
      });
      return Response.json({ success: true }, { headers: CORS });
    } catch (err) {
      console.error('Event tracking failed:', err);
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }

  // Track wishlist event if sessionId is provided
  // DEPRECATED: "add" wishlist action — Batch 1 (2026-07-29)
  // WishlistItem model does not exist; crashes with P2021.
  // Saved Looks is the current nAia-owned save mechanism.
  if (act === "add") {
    return Response.json({ error: "deprecated", message: "Use Saved Looks." }, { status: 410, headers: CORS });
  }

  // DEPRECATED: "remove" wishlist action — Batch 1 (2026-07-29)
  if (act === "remove") {
    return Response.json({ error: "deprecated", message: "Use Saved Looks." }, { status: 410, headers: CORS });
  }

  return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
}
