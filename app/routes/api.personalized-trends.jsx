import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";

export async function loader({ request }) {
  try {
    const customer = await authenticateCustomer(request);
    if (!customer) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

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

    // Build style profile
    const workedTags = [];
    const didntWorkTags = [];
    const feelings = [];
    const occasions = [];
    const bodyPrefs = [];

    reviews.forEach(r => {
      if (r.workedTags) {
        try {
          workedTags.push(...JSON.parse(r.workedTags));
        } catch {}
      }
      if (r.didntWorkTags) {
        try {
          didntWorkTags.push(...JSON.parse(r.didntWorkTags));
        } catch {}
      }
      if (r.session?.desiredFeeling) feelings.push(r.session.desiredFeeling);
      if (r.session?.occasion) occasions.push(r.session.occasion);
      if (r.session?.bodyPreference) bodyPrefs.push(r.session.bodyPreference);
    });

    // Get top patterns
    const topWorked = [...new Set(workedTags)].slice(0, 5).join(", ");
    const topDidntWork = [...new Set(didntWorkTags)].slice(0, 3).join(", ");
    const topFeelings = [...new Set(feelings)].slice(0, 3).join(", ");
    const topOccasions = [...new Set(occasions)].slice(0, 3).join(", ");
    const topBodyPrefs = [...new Set(bodyPrefs)].slice(0, 2).join(", ");

    const styleProfile = `
Style DNA:
- What works for her: ${topWorked || "Still learning"}
- What doesn't work: ${topDidntWork || "Still learning"}
- Desired feelings: ${topFeelings || "Not specified"}
- Common occasions: ${topOccasions || "Not specified"}
- Body preferences: ${topBodyPrefs || "Not specified"}
    `.trim();

    // Call OpenAI to generate personalized trend recommendations
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
            content: `You are a personal fashion analyst. Given a customer's style DNA, recommend 3-4 current fashion trends that would genuinely suit them, and 1-2 trends they should skip.

For each recommendation, explain:
- What the trend is
- Why it matches their style preferences
- How to wear it in a way that suits them
- Specific pieces to try

For trends to skip, briefly explain why it doesn't match their aesthetic.

Keep it conversational, specific, and actionable. Focus on current Spring 2026 trends.`
          },
          {
            role: "user",
            content: styleProfile
          }
        ],
      }),
    });

    const data = await openAiResponse.json();
    const recommendations = data.choices[0].message.content;

    return Response.json({
      recommendations,
      hasEnoughData: reviews.length >= 3,
    });
  } catch (error) {
    console.error("Personalized trends error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}