import { createHash } from "node:crypto";
import { authenticateCustomer } from "../customer-auth.server";
import { data as json } from "react-router";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import prisma from "../db.server";
import { emitBuySkipSubmitted, recordJourneyEventAwaited } from "../lib/ai/journey-events.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/wishlist — fetch all wishlist items
 */

// ANALYZE ITEM ACTION (for Buy/Skip)


const NAIA_PRODUCTS = [
  { title: "Sculptural Hybrid Coat", category: "Outerwear", handle: "trench-coat", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png", url: "https://naia-9417.myshopify.com/products/trench-coat" },
  { title: "Art Blouse", category: "Top", handle: "silk-top", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32674461-cac7-4699-aff1-74c435289333.png", url: "https://naia-9417.myshopify.com/products/silk-top" },
  { title: "Art Panel Tailored Blazer", category: "Outerwear", handle: "blazer", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/a7b908bb-3079-4f39-93b8-e1a89435249a.png", url: "https://naia-9417.myshopify.com/products/blazer" },
  { title: "Textured Art Maxi Skirt", category: "Bottom", handle: "skirt", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/6992350d-5695-4f28-8674-7747dfd1e680.png", url: "https://naia-9417.myshopify.com/products/skirt" },
  { title: "Wrap Cropped Top", category: "Top", handle: "top", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3614927b-4685-4df3-aeff-b3d5a950cbd2.png", url: "https://naia-9417.myshopify.com/products/top" },
  { title: "Printed Wrap Kimono Jacket", category: "Outerwear", handle: "kimono", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/77d61b97-37da-4e57-8297-aa5207b35d07.png", url: "https://naia-9417.myshopify.com/products/kimono" },
  { title: "Art Collar Shirt", category: "Top", handle: "shirt-1", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32fe2afb-b8ef-46d2-ae2c-b1adc81a1b0f.png", url: "https://naia-9417.myshopify.com/products/shirt-1" },
  { title: "Leather Midi Dress", category: "Dress", handle: "shirt", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/8a855f15-e5e9-4ef5-a7db-a7253e83a542.png", url: "https://naia-9417.myshopify.com/products/shirt" },
  { title: "Asymmetrical Waist Pants", category: "Bottom", handle: "pants", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png", url: "https://naia-9417.myshopify.com/products/pants" },
  { title: "Printed Straight Pants", category: "Bottom", handle: "trousers", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png", url: "https://naia-9417.myshopify.com/products/trousers" },
];

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

  const { imageUrl, category, color, brand, itemLink } = body;

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
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: imageUrl } },
              {
                type: "text",
                text: `Analyze this clothing item.

Known details provided by user:
- Category: ${category||"unknown"}
- Color: ${Array.isArray(color) ? color.join(", ") : color||"unknown"}
- Brand: ${brand || "unknown"}
${itemLink ? `- Product link provided by customer: ${itemLink}` : ""}

${styleProfile ? `CUSTOMER STYLE PROFILE:
- Style personalities: ${styleProfile.stylePersonalities?.join(", ")}
- Favorite colors: ${styleProfile.favoriteColors?.join(", ")}
- Lifestyle: ${styleProfile.dressesFor?.join(", ")}
- Desired feeling: ${styleProfile.desiredFeeling}` : "No style profile — give general analysis."}

${eligibleClosetItems.length > 0 ? `COMPATIBLE CLOSET CANDIDATES (pairings must come ONLY from this list — never invent items):
${eligibleClosetItems.map(i => `- ${i.name} (${i.category}${i.primaryColor ? ", "+i.primaryColor : ""})`).join("\n")}` : "NO COMPATIBLE CLOSET ITEMS — leave closetPairings as an empty array."}

NAIA COLLECTION (you MUST pick naiaMatch ONLY from this list, use exact title):
${fallbackProducts.map(p => `- ${p.title}`).join("\n")}

STRICT STYLING RULES:
1. closetPairings: ONLY use items from the compatible Closet candidates list above
   - When candidates are listed, select at least one unless it is genuinely impractical to wear together
   - Never invent Closet items; only use items explicitly listed above
   - If no candidates are listed, return []
2. naiaMatch: ONLY pick from the nAia collection list above — return exact title only (no URL)
3. Do not invent, hallucinate, or suggest items not in these lists

Respond ONLY with valid JSON, no markdown:
{
  "itemType": "...",
  "verdict": "BUY" or "SKIP",
  "confidence": 0-100,
  "styleDNAMatch": "...",
  "detailedAnalysis": {
    "silhouette": "...",
    "color": "...",
    "fabric": "...",
    "versatility": "..."
  },
  "closetPairings": [{"name": "...", "reason": "..."}],
  "fillsGap": null,
  "occasions": [],
  "naiaMatch": { "title": "...", "reason": "..." },
  "finalThought": "..."
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
        if (typeof p === "string") {
          rawName = p;
        } else if (p !== null && typeof p === "object" && !Array.isArray(p)) {
          const nameVal  = typeof p.name  === "string" && p.name.trim()  !== "" ? p.name  : null;
          const itemVal  = typeof p.item  === "string" && p.item.trim()  !== "" ? p.item  : null;
          const titleVal = typeof p.title === "string" && p.title.trim() !== "" ? p.title : null;
          rawName = nameVal ?? itemVal ?? titleVal;
          rawReason = typeof p.reason === "string" && p.reason.trim() !== "" ? p.reason.trim() : null;
        } else {
          return null;
        }
        if (typeof rawName !== "string" || rawName.trim() === "") return null;
        const canonical = eligibleClosetNameMap.get(rawName.toLowerCase().trim());
        if (!canonical) return null;
        return { name: canonical, reason: rawReason };
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

    // Validate naiaMatch title against eligible catalog; overwrite URL from server-side data
    const matchedProduct = fallbackProducts.find(p => p.title === analysis.naiaMatch?.title);
    if (matchedProduct) {
      analysis.naiaMatch = { title: matchedProduct.title, url: matchedProduct.url, reason: analysis.naiaMatch?.reason || null };
    } else {
      const idx = hashForIndex((imageUrl || "") + normalizedCategory) % fallbackProducts.length;
      const fallback = fallbackProducts[idx];
      analysis.naiaMatch = { title: fallback.title, url: fallback.url, reason: null };
    }

    // ── 8. Persist analysis (awaited; DB-backed idempotency via unique key) ───
    // Verdict is stated intent only — never a transaction, purchase, or revenue signal.
    {
      const verdictMap = { BUY: "BUY", SKIP: "SKIP", MAYBE: "MAYBE" };
      const persistedVerdict = verdictMap[analysis.verdict] ?? "INCOMPLETE";

      let analysisRecord;
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
            schemaVersion: "1.0",
            idempotencyKey,
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

  const { customer } = await authenticateCustomer(request);
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
