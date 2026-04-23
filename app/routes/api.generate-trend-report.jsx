import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";

export async function action({ request }) {
  try {
    const customer = await authenticateCustomer(request);
    if (!customer) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { trendReport } = body; // The public report text

    // Get customer's style intelligence
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

    // Build style profile
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
    
    // Generate personalized interpretation
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
            content: `You filter trend reports through a customer's style DNA.

Given a trend report and the customer's profile, create a personalized interpretation with THREE sections:

**TRENDS THAT FIT YOU**
List 2-3 trends from the report that align with their preferences. For each:
- Which trend
- Why it matches their style DNA, occasions, body preferences
- Best occasions for them to wear it
- Styling formula specific to them

**SKIP THESE**
List 1-2 trends that don't match. Brief reason why.

**PIECES TO EXPLORE NOW**
3-4 specific, shoppable items (with brand names):
- One luxury option (e.g., "LOEWE Amazona bag - structured, sculptural, matches your polished aesthetic")
- One contemporary option
- One accessible option
- Mix bags, shoes, outerwear, accessories
- Each recommendation must tie back to their style DNA

Keep it concise. This is translation, not a new essay.`
          },
          {
            role: "user",
            content: `TREND REPORT:\n${trendReport}\n\n${styleProfile}`
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