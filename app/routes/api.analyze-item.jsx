import prisma from "~/db.server";
import { getCustomer } from "~/lib/auth.server";

export async function action({ request }) {
  try {
    const { imageUrl, category, color, brand, itemLink } = await request.json();

    if (!imageUrl) {
      return Response.json({ error: "Image required" }, { status: 400 });
    }

    const customer = await getCustomer(request);
    const customerId = customer?.id || null;

    let styleProfile = null;
    let closetItems = [];

    if (customerId) {
      const customerData = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          onboardingProfile: true,
          closetItems: { take: 20, orderBy: { createdAt: "desc" } }
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
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: imageUrl }
            },
            {
              type: "text",
              text: `Analyze this clothing item. Known details: category=${category||"unknown"}, color=${color||"unknown"}${brand ? ", brand="+brand : ""}${itemLink ? ", product link="+itemLink : ""}. ${styleProfile ? `
Customer Style DNA: ${styleProfile.stylePersonalities?.join(", ")}
Favorite Colors: ${styleProfile.favoriteColors?.join(", ")}
Lifestyle: ${styleProfile.dressesFor?.join(", ")}
Desired Feeling: ${styleProfile.desiredFeeling}
` : "No style profile — general analysis."}
${closetItems.length > 0 ? `Their closet:\n${closetItems.map(i => `- ${i.name} (${i.category}, ${i.primaryColor})`).join("\n")}` : ""}

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "itemType": "...",
  "silhouette": "...",
  "colors": ["..."],
  "fabric": "...",
  "styleAesthetic": "...",
  "verdict": "BUY",
  "confidence": 85,
  "styleDNAMatch": "...",
  "detailedAnalysis": {
    "silhouette": "...",
    "color": "...",
    "fabric": "...",
    "versatility": "..."
  },
  "closetPairings": ["..."],
  "fillsGap": "...",
  "occasions": ["..."],
  "naiaMatch": "Suggest one specific nAia collection piece that would pair perfectly with this item",
  "finalThought": "..."
}`
            }
          ]
        }]
      })
    });

    const analysisData = await analysisResponse.json();

    if (!analysisResponse.ok) {
      console.error("Claude error:", analysisData);
      return Response.json({ error: "Analysis failed", details: analysisData.error?.message }, { status: 500 });
    }

    const responseText = analysisData.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

    return Response.json({ success: true, analysis });

  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json({ error: "Failed to analyze item", details: error.message }, { status: 500 });
  }
}
