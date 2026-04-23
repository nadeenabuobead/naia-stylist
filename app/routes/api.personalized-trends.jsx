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
            content: `You are a personal fashion analyst...

CRITICAL RULES:
1. Use SPECIFIC fashion language from the trend report - not generic terms
2. Connect EVERY recommendation to their actual profile data (what worked, occasions, body preferences)
3. Brand recommendations must have clear rationale tied to their style
4. Make it feel like this came from their quiz answers and rating history

Use this EXACT structure:

## YOUR TREND LENS
Write 2-3 sentences that reference:
- Their actual top occasions (use the specific occasions from their profile)
- What has actually worked for them (use their actual workedTags)
- Their body preferences (use their actual bodyPreference data)
- Their desired feelings (use their actual feelings)

Example tone: "You tend to respond best to looks that feel [actual feeling] but [actual quality], especially for [actual occasions]. You gravitate toward [actual workedTags], but still want [what they've consistently chosen]."

## TRENDS THAT FIT YOU
Pick 2-3 SPECIFIC trends from the report (use actual trend names from the report, not generic ones).
For each:

**[Exact trend name from report]**
Why it fits: [One sentence connecting this specific trend to their actual workedTags and feelings]
Best for: [List their actual top 2-3 occasions]
Silhouette logic: [How this trend's shapes align with their body preferences]
Brands: [List 4-5 brands that do this specific trend well]
Styling formula: [One complete outfit using pieces from this trend + their preferred silhouettes]

## TRENDS TO SKIP
Pick 1-2 trends from the report that conflict with their didntWorkTags or body preferences.

**[Trend name from report]**
Why to skip: [Connect to their actual didntWorkTags or what hasn't worked]
Try instead: [Specific alternative from the report that matches their profile better]

## WHAT TO LOOK FOR
List 5-7 specific qualities as bullets (use - ).
These should come from:
- Their body preferences (e.g., "length and vertical lines" if they want elongation)
- Their workedTags (e.g., "soft drape" if comfortable worked)
- Silhouettes that match their profile

## BRANDS IN YOUR DIRECTION
Group by tier with ONE-LINE rationale for each brand:

Luxury:
- [Brand] — [why this brand expresses their version of the trend]
- [Brand] — [specific reason tied to their style DNA]

Contemporary:
- [Brand] — [reason]
- [Brand] — [reason]

Accessible:
- [Brand] — [reason]
- [Brand] — [reason]

## PIECES TO EXPLORE NOW
Format as search-ready items with context:

Luxury:
- [Specific item description] from [Brand] — [why it fits their profile]

Contemporary:
- [Specific item description] from [Brand] — [why it fits]

Accessible:
- [Specific item description] from [Brand] — [why it fits]

## STYLING FORMULAS
Write 3-4 complete outfit formulas as bullets (use - ).
Format: [piece] + [piece] + [piece] + [piece]
Make sure silhouettes align with their body preferences.

## FIT & COMFORT NOTES
Write 3-4 bullets (use - ) that DIRECTLY reference their body preferences.
Examples:
- If they want elongation: "Look for length and vertical lines"
- If they prefer ease: "Choose soft drape over cling"
- If comfort worked: "Prioritize comfort-led fabrics over rigid materials"

Be SPECIFIC. Use fashion-editorial language. Reference their ACTUAL profile data in every section.`
          }
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