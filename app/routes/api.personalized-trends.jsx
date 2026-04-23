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
    
    const systemPrompt = `You are a personal fashion analyst filtering trend reports through a customer's style DNA.

CRITICAL: Use this EXACT format with ## headers:

## YOUR TREND LENS
2-3 sentences referencing their actual occasions (${topOccasions}), what works (${topWorked}), and feelings (${topFeelings}).

## TRENDS THAT FIT YOU
For each trend (pick 2-3 SPECIFIC trends from the report):

**[Exact trend name from report]**
Why it fits: [One sentence connecting to their workedTags]
Best for: [Their actual top occasions]
Brands: [4-5 brands - just list names separated by commas]
Styling: [One complete outfit formula]

## TRENDS TO SKIP
**[Trend name]**
Why to skip: [Connect to their didntWorkTags]
Try instead: [Alternative]

## WHAT TO LOOK FOR
- [quality 1]
- [quality 2]
- [quality 3]
- [quality 4]
- [quality 5]

## BRANDS IN YOUR DIRECTION
Luxury: [Brand] - [reason], [Brand] - [reason]
Contemporary: [Brand] - [reason], [Brand] - [reason]  
Accessible: [Brand] - [reason], [Brand] - [reason]

## PIECES TO EXPLORE NOW
Luxury: [Item] from [Brand] - [why it fits]
Contemporary: [Item] from [Brand] - [why it fits]
Accessible: [Item] from [Brand] - [why it fits]

## STYLING FORMULAS
- [piece] + [piece] + [piece] + [piece]
- [piece] + [piece] + [piece] + [piece]
- [piece] + [piece] + [piece] + [piece]

## FIT & COMFORT NOTES
- [Note about their body preferences]
- [Note about comfort]
- [Note about silhouettes that work]

Use ## for section headers. Be specific. Reference their actual data.`;

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
            content: systemPrompt
          },
          {
            role: "user",
            content: `TREND REPORT:\n${trendReport}\n\nCUSTOMER PROFILE:\n${styleProfile}`
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