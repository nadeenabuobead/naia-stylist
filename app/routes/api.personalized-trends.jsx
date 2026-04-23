import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";

export async function action({ request }) {
  try {
    const customer = await authenticateCustomer(request);
    if (!customer) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { trendReport } = body;

    const reviews = await prisma.postOutfitReview.findMany({
      where: { customerId: customer.id },
      include: {
        session: {
          select: {
            currentMood: true,
            desiredFeeling: true,
            occasion: true,
            bodyPreference: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (reviews.length < 3) {
      return Response.json({
        hasEnoughData: false,
        message: "Rate at least 3 looks to get personalized trend insights."
      });
    }

    const workedTags = [];
    const didntWorkTags = [];
    const feelings = [];
    const occasions = [];
    const bodyPrefs = [];

    reviews.forEach(r => {
      if (r.workedTags) {
        try { workedTags.push(...JSON.parse(r.workedTags)); } catch {}
      }
      if (r.didntWorkTags) {
        try { didntWorkTags.push(...JSON.parse(r.didntWorkTags)); } catch {}
      }
      if (r.session?.desiredFeeling) feelings.push(r.session.desiredFeeling);
      if (r.session?.occasion) occasions.push(r.session.occasion);
      if (r.session?.bodyPreference) bodyPrefs.push(r.session.bodyPreference);
    });

    const topWorked = [...new Set(workedTags)].slice(0, 5).join(", ");
    const topDidntWork = [...new Set(didntWorkTags)].slice(0, 3).join(", ");
    const topFeelings = [...new Set(feelings)].slice(0, 3).join(", ");
    const topOccasions = [...new Set(occasions)].slice(0, 3).join(", ");
    const topBodyPrefs = [...new Set(bodyPrefs)].slice(0, 2).join(", ");

    const styleProfile = `
Customer Style DNA:
- What works: ${topWorked || "Still learning"}
- What doesn't work: ${topDidntWork || "Still learning"}
- Desired feelings: ${topFeelings || "Not specified"}
- Common occasions: ${topOccasions || "Not specified"}
- Body preferences: ${topBodyPrefs || "Not specified"}
    `.trim();

    const apiKey = process.env.OPENAI_API_KEY;
    
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a personal fashion analyst. Filter trend reports through customer style data. Be specific with fashion language. Connect recommendations to their actual profile. Keep sections concise and scannable."
          },
          {
            role: "user",
            content: `TREND REPORT:\n${trendReport}\n\n${styleProfile}\n\nCreate a personalized report with sections: YOUR TREND LENS (2-3 sentences), TRENDS THAT FIT YOU (2-3 trends with why/best for/brands/styling), TRENDS TO SKIP (1-2 with alternatives), WHAT TO LOOK FOR (5-7 bullets), BRANDS IN YOUR DIRECTION (by tier with reasons), PIECES TO EXPLORE NOW (by tier), STYLING FORMULAS (3-4 bullets), FIT & COMFORT NOTES (3-4 bullets tied to body preferences). Be specific and reference their actual data.`
          }
        ],
      }),
    });

    const data = await openAiResponse.json();
    const personalizedReport = data.choices[0].message.content;

    return Response.json({
      hasEnoughData: true,
      personalizedReport,
    });
  } catch (error) {
    console.error("Personalized trends error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}