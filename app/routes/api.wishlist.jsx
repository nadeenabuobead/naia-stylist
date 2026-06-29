import { authenticateCustomer } from "../customer-auth.server";
import { data as json } from "react-router";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import prisma from "../db.server";

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

async function analyzeItem(request) {
  try {
    const { imageUrl, category, color, brand, itemLink } = await request.json();
    
    if (!imageUrl) {
      return json({ error: "Image required" }, { status: 400 });
    }

    const naiaCustomer = await getCurrentNaiaCustomer(request);
    if (!naiaCustomer) {
      return json({ error: "Not authenticated" }, { status: 401 });
    }

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

    const analysisResponse = await fetch("https://api.anthropic.com/v1/messages", {
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

    const data = await analysisResponse.json();
    console.log("Claude response status:", analysisResponse.status);
    console.log("Claude response:", JSON.stringify(data).slice(0, 500));
    
    if (!data.content || !data.content[0]) {
      console.error('Unexpected API response:', data);
      throw new Error('Invalid API response: ' + JSON.stringify(data));
    }
    
    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);

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

    return json({ success: true, analysis, closetItemCount: closetItems.length, eligibleClosetItemCount: eligibleClosetItems.length });

  } catch (error) {
    console.error("Analysis error:", error);
    return json({ error: "Analysis failed" }, { status: 500 });
  }
}


export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ items: [], authenticated: false }, { headers: CORS });
  }

  const items = await prisma.wishlistItem.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ items, authenticated: true }, { headers: CORS });
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
  if (act === "add" && body.sessionId) {
    try {
      await prisma.stylingEvent.create({
        data: {
          customerId: customer.id,
          sessionId: body.sessionId,
          productId: body.naiaProductId,
          productTitle: body.title || "Unknown",
          eventType: "wishlisted",
        },
      });
    } catch (err) {
      console.error('Event tracking failed:', err);
    }
  }

  if (act === "add") {
    const { naiaProductId, title, handle, image } = body;
    if (!naiaProductId || !title) {
      return Response.json({ error: "naiaProductId and title required" }, { status: 400, headers: CORS });
    }

    const item = await prisma.wishlistItem.upsert({
      where: {
        customerId_naiaProductId: {
          customerId: customer.id,
          naiaProductId: String(naiaProductId),
        },
      },
      update: { title, handle: handle || "", image: image || null },
      create: {
        customerId: customer.id,
        naiaProductId: String(naiaProductId),
        title,
        handle: handle || "",
        image: image || null,
      },
    });

    return Response.json({ item }, { headers: CORS });
  }

  if (act === "remove") {
    const { naiaProductId } = body;
    if (!naiaProductId) {
      return Response.json({ error: "naiaProductId required" }, { status: 400, headers: CORS });
    }

    try {
      await prisma.wishlistItem.delete({
        where: {
          customerId_naiaProductId: {
            customerId: customer.id,
            naiaProductId: String(naiaProductId),
          },
        },
      });
    } catch {
      // Already removed, that's fine
    }

    return Response.json({ removed: true }, { headers: CORS });
  }

  return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
}
