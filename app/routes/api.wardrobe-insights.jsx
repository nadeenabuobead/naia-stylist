import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

const url = new URL(request.url);
const tokenParam = url.searchParams.get("naia_token");
let customerId = null;

if (tokenParam) {
  try {
    const decoded = JSON.parse(atob(decodeURIComponent(tokenParam)));
    if (decoded.shopifyId) {
      const customer = await prisma.customer.findFirst({
        where: { shopifyCustomerId: String(decoded.shopifyId) },
      });
      customerId = customer?.id || null;
    }
  } catch {}
}

if (!customerId) {
  const { customer } = await authenticateCustomer(request);
  customerId = customer?.id || null;
}

if (!customerId) return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });

const items = await prisma.closetItem.findMany({
  where: { customerId },
    orderBy: { createdAt: "desc" },
  });

  if (items.length < 3) {
    return Response.json({ insights: null }, { headers: CORS });
  }

  const closetSummary = items.map(i => 
    `- ${i.name} (${i.category}${i.primaryColor ? `, ${i.primaryColor}` : ""}${i.pattern ? `, ${i.pattern}` : ""}${i.occasions?.length ? `, occasions: ${i.occasions.join("/")}` : ""}${i.brand ? `, brand: ${i.brand}` : ""})`
  ).join("\n");

  const prompt = `You are a personal stylist analyzing a customer's wardrobe. Here are all her pieces:

${closetSummary}

Based on this wardrobe, provide a JSON response with exactly these fields:
{
"stylePersonality": "2-3 word description of their style (e.g. Minimalist Chic, Edgy Urban, Romantic Feminine)",
"styleDescription": "One sentence describing their overall aesthetic using 'you/your' language, e.g. 'Your style blends...'",
"dominantColors": ["color1", "color2", "color3"],
"tooMuchOf": ["specific thing they have too many of, e.g. 'Black formal trousers'", "another"],
"repeats": ["pattern they repeat, e.g. 'Solid neutral bottoms'", "another"],
"missingPieces": ["specific piece that fits THEIR style, e.g. 'A structured leather jacket'", "another specific piece", "another"],
"buyNext": "One specific piece recommendation that would complete their wardrobe, fitting their exact style, using 'you/your' language"
}

Be specific and style-aware. Don't recommend floral pieces for an edgy wardrobe. Don't recommend formal pieces for a casual wardrobe. Respond ONLY with the JSON object, no markdown.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    const insights = JSON.parse(text);
    return Response.json({ insights }, { headers: CORS });
  } catch (err) {
    console.error("Wardrobe insights error:", err);
    return Response.json({ insights: null }, { headers: CORS });
  }
}