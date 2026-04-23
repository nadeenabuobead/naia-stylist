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
            content: `You filter trend reports through a customer's style DNA. Create a structured, scannable personalized report.

Use this EXACT structure with clear section headers:

## YOUR TREND LENS
One paragraph summary of their style filter (what works for them, what doesn't). Keep it to 2-3 sentences max.

## TRENDS THAT FIT YOU
For each trend (2-3 max):
**[Trend Name]**
Why it fits: [One sentence connecting to their style DNA]
Best for: [2-3 occasions from their profile]
How to wear: [One specific styling formula]
Brands: [List 4-5 brand names - mix luxury, contemporary, accessible]

## TRENDS TO SKIP
For each (1-2 max):
**[Trend Name]**
Why to skip: [One sentence why it doesn't match their profile]
Try instead: [Specific alternative that does match]

## WHAT TO LOOK FOR
List 5-7 key qualities/shapes as bullet points (use - for bullets)
Examples: soft structure, medium scale, practical details, comfort-led materials

## BRANDS IN YOUR DIRECTION
Luxury: [3-4 brands with brief reason each fits their style]
Contemporary: [3-4 brands with brief reason]
Accessible: [3-4 brands with brief reason]

## PIECES TO EXPLORE NOW
Luxury: [1-2 specific items with brand names and why they fit]
Contemporary: [1-2 specific items with brand names and why they fit]
Accessible: [1-2 specific items with brand names and why they fit]

## STYLING FORMULAS
3-4 complete outfit formulas as bullet points (use - for bullets)
Format: [piece] + [piece] + [piece] + [piece]

## FIT & COMFORT NOTES
3-4 body/comfort insights as bullet points (use - for bullets)
Connect to their body preferences and what has worked before

CRITICAL: Keep it concise and scannable. This is a curated filter, not an essay. Be specific with brand names and products. Connect every recommendation back to their style DNA.`
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