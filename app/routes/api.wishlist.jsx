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
  itemType: p.parsed.identity.itemType,
  silhouette: p.parsed.identity.silhouette ?? null,
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
                text: `You are assessing a clothing item for a specific customer. Every verdict, match percentage, summary, and section must be grounded in this customer's actual Passport, Closet, and form inputs. Generic statements that could apply to any customer are not acceptable. Every point stated ONCE only — never repeated across sections.

ITEM DETAILS:
- Category: ${category||"unknown"}
- Customer-selected colour: ${Array.isArray(color) ? color.join(", ") : color||"unknown"}
- Brand: ${brand || "unknown"}
${safeSize ? `- Size the customer is considering: ${safeSize}` : ""}

${styleProfile ? `CUSTOMER PASSPORT — use every available field across the entire recommendation:

STYLE IDENTITY
- Style personalities: ${styleProfile.stylePersonalities?.join(", ")}
- Desired feelings when dressed: ${styleProfile.desiredFeelings?.join(", ") || "not specified"}
- Desired impression: ${styleProfile.desiredImpression?.length > 0 ? styleProfile.desiredImpression.join(", ") : "not specified"}
- Fashion risk comfort (1–10): ${styleProfile.comfortLevel ?? "not specified"}

LIFESTYLE & OCCASIONS
- Primary lifestyle: ${styleProfile.lifestyle || "not specified"}
- Typical day: ${styleProfile.typicalDay || "not specified"}
→ LIFESTYLE RULE: The wearability conclusion must name these actual occasions and state whether the item suits them specifically. Never write "may have limited wear if you don't attend such events." State the real match or mismatch using the occasions listed above.

COLOUR PALETTE
- Favourite colours: ${styleProfile.favoriteColors?.join(", ")}
- Colours she avoids: ${styleProfile.avoidColors?.length > 0 ? styleProfile.avoidColors.join(", ") : "none specified"}
→ COLOUR RULE: For the uploaded item's colour, explain specifically whether it complements her palette, usefully expands it, or conflicts with avoided colours. How does it coordinate with confirmed Closet pieces? Treat favourites as preferences, not exclusions. Never reject a neutral without naming how it works or clashes with this specific palette.

FIT & BODY
- Usual top size: ${styleProfile.topSize || "not on record"}
- Usual bottom size: ${styleProfile.bottomSize || "not on record"}
- Usual dress size: ${styleProfile.dressSize || "not on record"}
- Fit preferences: ${styleProfile.fitPreferences?.length > 0 ? styleProfile.fitPreferences.join(", ") : "not on record"}
- Areas to highlight: ${styleProfile.bodyFocusAreas?.length > 0 ? styleProfile.bodyFocusAreas.join(", ") : "not on record"}
- Areas to minimise: ${styleProfile.bodyAvoidAreas?.length > 0 ? styleProfile.bodyAvoidAreas.join(", ") : "not on record"}
- Style struggles: ${styleProfile.styleStruggles?.length > 0 ? styleProfile.styleStruggles.join(", ") : "not specified"}
Note: body shape, height, and body measurements are not yet in this Passport.

→ FIT RULE — use available signals in this priority order; never collapse them all into "fit cannot be confirmed":
  1. Fit preferences on record → reference them by name: "Your Passport shows you prefer [preference], so this [item detail] may feel [more/less] secure/comfortable."
  2. Highlight / minimise areas on record → apply them: "Your Passport shows you prefer greater [area] coverage — this [cut] is a direct conflict / strong match."
  3. Size on record for this category → use it to reason about sizing for this item type.
  4. Measurement fallback ONLY for measurements genuinely absent. Never write "Fit cannot be confirmed from your current Passport" as the opening when fit preferences, size, or coverage data exist.

→ FIT vs COVERAGE SEPARATION RULE — these are two distinct assessments and must never be conflated:
  - FIT PREFERENCE (fitted/relaxed/oversized) = silhouette shape preference. Use only to evaluate whether the garment's cut and silhouette aligns with what the customer prefers.
  - COVERAGE / COMFORT PREFERENCE = how much skin is exposed and how rigid the construction feels. Use only to evaluate sheerness, cutouts, exposed neckline/back/midriff, structured boning, or constraining construction.
  Example of a WRONG conflation: "Your relaxed fit preference conflicts with the corset's boning." Correct: "Your fit preference leans relaxed — this structured corset silhouette is a direct contrast. Separately, the exposed midriff cutout conflicts with your coverage preference."

PERSONALIZATION MANDATE
- BUY: every positive claim must cite a Passport or form field. Name the style personality, reference the lifestyle occasions, apply fit preferences and colour palette. No praise that applies to any customer.
- SKIP FOR NOW / SKIP: every blocker must cite a Passport or form field. "Your Passport shows you prefer… so this item…" is the required structure.` : "No style profile on record — give a general analysis."}

CUSTOMER'S INPUTS:

OCCASION: ${safeOccasion || "(not provided)"}
${safeOccasion ? `→ Does this item suit "${safeOccasion}"? One concrete reason referencing the item's formality and that occasion's dress code. If yes, one styling tip. If no, what adjustment would help.` : "→ Suggest the most suitable occasions given this customer's actual lifestyle contexts."}

WHAT THEY LIKE: ${safeWhatLike || "(not provided)"}
${safeWhatLike ? `→ Agree, partly agree, or disagree? One concrete reason based on the item's actual construction — do not restate what they said.` : ""}

WHAT THEY ARE UNSURE ABOUT: ${safeUnsureAbout || "(not provided)"}
${safeUnsureAbout ? `→ Justified, partly justified, or not supported? Use "partly justified" when the concern is about fit or sizing and measurements are not on the Passport. Use "justified" only when the issue is clearly visible from the item itself. Be direct. Then offer 2–3 specific practical solutions — e.g. for a strapless concern: supportive strapless bra, grip strips, tailoring the bodice, a styling layer, or trying on before committing.` : ""}

BEFORE YOU BUY — exactly 2 points (25–40 words each). Do NOT begin either point with a label — the card headings already show these:
1. FIT & PRACTICAL SOLUTION — Open with what IS known from the Passport (fit preferences, coverage preferences, size for this category), referencing them by name. Example: "Your Passport shows you prefer [preference], so this [item detail] may feel [more/less] secure." Only then add what to verify with measurements if specific measurements are missing. Never open with "Fit cannot be confirmed."
2. WEARABILITY — Name at least one of the customer's actual lifestyle contexts (${styleProfile?.lifestyle || "lifestyle not specified"}) and state directly whether this item suits those contexts and how realistically frequent the wear would be. Never use language like "if your lifestyle includes such events."
No brand-sizing claims — do not state or imply how this brand sizes relative to others.

REPETITION RULE: Each colour, concern or trait appears ONCE. Never repeat Final Condition reasoning in any earlier section.

VERDICT-AWARE PERSONALIZATION RULE:
- BUY: every claim must cite a Passport or form field — name the style personality/personalities, reference the actual lifestyle occasions, apply fit preferences and palette. No generic praise.
- SKIP FOR NOW: lead with specific blockers for THIS customer — cite fit preferences, lifestyle occasions, palette, or coverage needs by name. Structure: "Your Passport shows you prefer… so this item…"
- SKIP: name the specific conflict with this customer's Passport or form data. No softening.
The "betterDirection" field must describe a product type grounded in this customer's style personality, lifestyle occasions, fit preferences, and any identified Closet gap.

${eligibleClosetItems.length > 0 ? `COMPATIBLE CLOSET CANDIDATES (pairings must come ONLY from this list):
${eligibleClosetItems.map(i => `- ${i.name} (${i.category}${i.primaryColor ? ", "+i.primaryColor : ""})`).join("\n")}` : "NO COMPATIBLE CLOSET ITEMS — leave closetPairings as an empty array."}

CLOSET PAIRING RULE: For each pairing, state: (a) which of the customer's actual lifestyle occasions this combined outfit suits, (b) how the two pieces' colours coordinate, (c) how their proportions balance. Generic "both pieces share an aesthetic" is not acceptable.

NAIA COLLECTION (pick naiaMatch ONLY from this list, exact title):
${fallbackProducts.map(p => `- ${p.title} [${p.category}${p.silhouette ? ` — ${p.silhouette}` : ""}]`).join("\n")}

NADINE PHYSICAL COMPATIBILITY RULES — apply before writing the reason:
- OUTERWEAR pieces (e.g. trench coat, kimono jacket, zip jacket) are worn ON TOP of another garment, never tucked into or underneath it.
- BOTTOM pieces (e.g. trousers, skirt) are worn on the lower body. A bottom cannot "layer over" a neckline, drape over shoulders, or be worn over the top half.
- TOP pieces (e.g. peplum top, crew-neck, shirt) sit on the upper body. A top cannot be "paired beneath" a skirt in the sense of tucking — state "worn with" instead.
- DRESS pieces replace the top+bottom combination entirely — do not describe pairing a dress as a top or bottom component.
- Never describe a garment doing something physically impossible for its category.
NADINE PAIRING RULE: State exactly how the NADINE piece is worn with the uploaded item given the categories above (e.g. "Wear the [NADINE top] under the [uploaded outerwear]", "Pair with [NADINE trousers] for the lower half") and add one colour coordination fact between the two pieces. Physical facts only, no mood language. Return null if no product can realistically be worn with this item as a coherent outfit for this customer.

CONSISTENCY REQUIREMENT: All advice must point in the same direction. closetPairings, naiaMatch, and buyIf/skipIf must reflect the same logic. Never recommend a NADINE piece that contradicts advice given elsewhere.

STRICT RULES:
1. closetPairings: ONLY from the compatible Closet candidates list. Apply OCCASION TEST (does the combined outfit suit the labeled occasion?) and BALANCE TEST (does this piece support the styling advice?). Return [] if no piece passes both.
2. naiaMatch: ONLY from the nAia collection list — exact title. A NADINE piece that shares the same dominant visual element (bold print, dramatic silhouette) competes rather than complements — return null. Do not recommend substitutes.
3. occasions: ${safeOccasion ? `Include "${safeOccasion}" ONLY if the item genuinely suits it.` : "Suggest appropriate occasions given this customer's lifestyle."}
4. Never invent or hallucinate Passport fields, body data, lifestyle habits, owned pieces, or measurements not listed above.

Respond ONLY with valid JSON, no markdown:
{
  "itemType": "specific type e.g. Maxi Skirt, Blazer, Midi Dress",
  "detectedColor": "AI colour read from the image — ALL CAPS e.g. BEIGE / CREAM",
  "verdict": "BUY" — item suits this customer well | "SKIP FOR NOW" — potential but blocked by fit confirmation, specific styling condition, or practical hurdle (not definitively unsuitable) | "SKIP" — genuinely unsuitable for this customer with no realistic path,
  "confidence": 0-100,
  "styleDNAMatch": "≤20 words — name at least one of their style personalities explicitly and state whether this item aligns or conflicts with it",
  "detailedAnalysis": {
    "silhouette": "≤20 words — relate this cut to the customer's fit preferences and highlight/minimise areas from their Passport",
    "color": "≤20 words — how this colour works with their specific favourite colours and coordinates with confirmed Closet pieces",
    "versatility": "≤15 words — realistic assessment given their actual lifestyle occasions"
  },
  "occasionFit": ${safeOccasion ? `{ "occasion": "natural noun phrase — activity only, no item category (e.g. 'evening dining', 'brunch', 'casual outings', 'work meetings')", "fits": true or false, "explanation": "≤20 words — concrete reason referencing the item's formality and this customer's lifestyle", "stylingTip": "≤15 words — one specific action" }` : "null"},
  "whatLikeEval": ${safeWhatLike ? `{ "aspect": "${safeWhatLike.slice(0,80)}", "agreement": "agree" or "partly agree" or "disagree", "explanation": "≤20 words — based on item's actual construction" }` : "null"},
  "concernEval": ${safeUnsureAbout ? `{ "concern": "${safeUnsureAbout.slice(0,80)}", "justified": "justified" or "partly justified" or "not supported", "explanation": "≤20 words — direct assessment referencing Passport data where available", "solutions": ["specific practical solution 1", "specific practical solution 2"] }` : "null"},
  "closetPairings": [{ "occasion": "specific lifestyle occasion from this customer's Passport e.g. work meetings, date nights", "name": "exact item name from the candidate list above", "reason": "≤12 words — colour coordination fact + how proportions balance between the two pieces" }],
  "fillsGap": null | "≤20 words — the specific wardrobe gap this item fills for this customer given their Closet and lifestyle occasions",
  "occasions": [],
  "naiaMatch": null | { "title": "exact title from NAIA COLLECTION list", "reason": "≤25 words — how the NADINE piece is worn with this item (layers over / adds coverage / contrasts length) + one colour coordination fact. Physical facts only." },
  "beforeYouBuy": [
    "25–40 words — open with what fit data IS known (reference preferences, coverage, or size by name), then state what to verify if measurements are missing. No label prefix.",
    "25–40 words — name at least one of the customer's actual lifestyle occasions and state directly whether this item suits those occasions and how realistic repeat wear is. No label prefix."
  ],
  "buyIf": "≤20 words — the one concrete condition specific to this customer that justifies buying",
  "skipIf": "≤20 words — the one concrete condition specific to this customer that makes this a mistake",
  "betterDirection": null for BUY | "1–3 sentences — describe the product type (silhouette, fabric, fit profile) that would serve this customer better for their lifestyle occasions, referencing their style personality and any identified Closet gap. No brand names. Constructive redirect.",
  "finalThought": "ONE sentence ≤30 words — name their style personality or lifestyle context, include the entered occasion if provided, state the main condition. Example: 'A strong match for your minimalist style and brunch occasions, but only buy if strapless styles fit and feel secure on you.'"
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
