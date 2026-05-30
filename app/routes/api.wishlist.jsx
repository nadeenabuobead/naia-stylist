import { authenticateCustomer } from "../customer-auth.server";
import { data as json } from "react-router";
import { getCustomer } from "../lib/auth.server.ts";
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
  { title: "Sculptural Hybrid Coat", handle: "trench-coat", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png", url: "https://naia-9417.myshopify.com/products/trench-coat" },
  { title: "Art Blouse", handle: "silk-top", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32674461-cac7-4699-aff1-74c435289333.png", url: "https://naia-9417.myshopify.com/products/silk-top" },
  { title: "Art Panel Tailored Blazer", handle: "blazer", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/a7b908bb-3079-4f39-93b8-e1a89435249a.png", url: "https://naia-9417.myshopify.com/products/blazer" },
  { title: "Textured Art Maxi Skirt", handle: "skirt", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/6992350d-5695-4f28-8674-7747dfd1e680.png", url: "https://naia-9417.myshopify.com/products/skirt" },
  { title: "Wrap Cropped Top", handle: "top", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3614927b-4685-4df3-aeff-b3d5a950cbd2.png", url: "https://naia-9417.myshopify.com/products/top" },
  { title: "Printed Wrap Kimono Jacket", handle: "kimono", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/77d61b97-37da-4e57-8297-aa5207b35d07.png", url: "https://naia-9417.myshopify.com/products/kimono" },
  { title: "Art Collar Shirt", handle: "shirt-1", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32fe2afb-b8ef-46d2-ae2c-b1adc81a1b0f.png", url: "https://naia-9417.myshopify.com/products/shirt-1" },
  { title: "Leather Midi Dress", handle: "shirt", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/8a855f15-e5e9-4ef5-a7db-a7253e83a542.png", url: "https://naia-9417.myshopify.com/products/shirt" },
  { title: "Asymmetrical Waist Pants", handle: "pants", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png", url: "https://naia-9417.myshopify.com/products/pants" },
  { title: "Printed Straight Pants", handle: "trousers", image: "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png", url: "https://naia-9417.myshopify.com/products/trousers" },
];

async function scrapeProductDetails(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                       html.match(/og:title[^>]*content="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : null;

    // Extract description
    const descMatch = html.match(/og:description[^>]*content="([^"]+)"/i) ||
                      html.match(/meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    const description = descMatch ? descMatch[1].replace(/\s+/g, " ").trim().slice(0, 300) : null;

    // Extract price
    const priceMatch = html.match(/["'](\$|€|£|AED)?\s*\d+[.,]\d{2}["']/) ||
                       html.match(/price["'][^>]*>[^<]*?(\$|€|£|AED)?\s*(\d+[.,]\d{2})/i);
    const price = priceMatch ? priceMatch[0].replace(/["\']/g, "").trim() : null;

    // Extract brand from og:site_name or domain
    const brandMatch = html.match(/og:site_name[^>]*content="([^"]+)"/i);
    const scrapedBrand = brandMatch ? brandMatch[1].trim() : new URL(url).hostname.replace("www.", "").split(".")[0];

    // Extract product image
    const imgMatch = html.match(/og:image[^>]*content="([^"]+)"/i);
    const productImage = imgMatch ? imgMatch[1] : null;

    return { title, description, price, brand: scrapedBrand, productImage };
  } catch (err) {
    console.log("Scrape failed:", err.message);
    return null;
  }
}

async function analyzeItem(request) {
  try {
    const { imageUrl, category, color, brand, itemLink } = await request.json();
    
    if (!imageUrl) {
      return json({ error: "Image required" }, { status: 400 });
    }

    // Scrape product details from link if provided
    let scrapedDetails = null;
    if (itemLink) {
      try {
        const url = itemLink.startsWith("http") ? itemLink : "https://" + itemLink;
        scrapedDetails = await scrapeProductDetails(url);
        console.log("Scraped product details:", scrapedDetails);
      } catch (e) {
        console.log("Could not scrape link:", e.message);
      }
    }

    // Get authenticated customer
    const customer = await getCustomer(request);
    const customerId = customer?.id || null;

    let styleProfile = null;
    let closetItems = [];
    
    if (customerId) {
      const customerData = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          onboardingProfile: true,
          closetItems: { take: 20, orderBy: { createdAt: 'desc' } }
        }
      });
      
      styleProfile = customerData?.onboardingProfile;
      closetItems = customerData?.closetItems || [];
    }

    const analysisResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
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
- Brand: ${scrapedDetails?.brand || brand || "unknown"}
${scrapedDetails ? `
Scraped from product page:
- Product title: ${scrapedDetails.title||"N/A"}
- Description: ${scrapedDetails.description||"N/A"}
- Price: ${scrapedDetails.price||"N/A"}
- Brand: ${scrapedDetails.brand||"N/A"}` : itemLink ? `- Product link provided: ${itemLink}` : ""}

${styleProfile ? `CUSTOMER STYLE PROFILE:
- Style personalities: ${styleProfile.stylePersonalities?.join(", ")}
- Favorite colors: ${styleProfile.favoriteColors?.join(", ")}
- Lifestyle: ${styleProfile.dressesFor?.join(", ")}
- Desired feeling: ${styleProfile.desiredFeeling}` : "No style profile — give general analysis."}

${closetItems.length > 0 ? `CUSTOMER REAL CLOSET (ONLY suggest pairings from this exact list, do not invent items):
${closetItems.map(i => `- ${i.name} (${i.category}${i.primaryColor ? ", "+i.primaryColor : ""})`).join("\n")}` : "CLOSET: Empty — do NOT suggest any closet pairings. Leave closetPairings as an empty array."}

NAIA COLLECTION (you MUST pick naiaMatch ONLY from this list, use exact title and url):
- Sculptural Hybrid Coat → https://naia-9417.myshopify.com/products/trench-coat
- Art Blouse → https://naia-9417.myshopify.com/products/silk-top
- Art Panel Tailored Blazer → https://naia-9417.myshopify.com/products/blazer
- Textured Art Maxi Skirt → https://naia-9417.myshopify.com/products/skirt
- Wrap Cropped Top → https://naia-9417.myshopify.com/products/top
- Printed Wrap Kimono Jacket → https://naia-9417.myshopify.com/products/kimono
- Art Collar Shirt → https://naia-9417.myshopify.com/products/shirt-1
- Leather Midi Dress → https://naia-9417.myshopify.com/products/shirt
- Asymmetrical Waist Pants → https://naia-9417.myshopify.com/products/pants
- Printed Straight Pants → https://naia-9417.myshopify.com/products/trousers

STRICT STYLING RULES:
1. closetPairings: ONLY use items from the customer's real closet list above. If closet is empty, return []
2. naiaMatch: ONLY pick from the nAia collection list above — return exact title and url
3. Do not invent, hallucinate, or suggest items not in these lists
4. CATEGORY LOGIC — only suggest complementary categories:
   - If item is a TOP → suggest bottoms (skirts, pants, trousers) or outerwear (blazer, jacket, coat) only
   - If item is a BOTTOM → suggest tops, blouses, shirts or outerwear only
   - If item is a DRESS → suggest outerwear (blazer, jacket, coat) only
   - If item is OUTERWEAR → suggest tops + bottoms or dresses underneath only
   - If item is SHOES/BAGS/ACCESSORIES → suggest any clothing category
   - NEVER suggest the same category as the uploaded item

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
  "closetPairings": [],
  "fillsGap": null,
  "occasions": [],
  "naiaMatch": { "title": "...", "url": "...", "reason": "..." },
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

    return json({ success: true, analysis });

  } catch (error) {
    console.error("Analysis error:", error);
    return json({ error: "Analysis failed", details: error.message }, { status: 500 });
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
  if (url.searchParams.get("action") === "scrape-image") {
    try {
      const { url: productUrl } = await request.json();
      const details = await scrapeProductDetails(productUrl);
      return Response.json({ 
        imageUrl: details?.productImage || null,
        brand: details?.brand || null,
        title: details?.title || null
      });
    } catch (e) {
      return Response.json({ imageUrl: null });
    }
  }

  // original action below
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
