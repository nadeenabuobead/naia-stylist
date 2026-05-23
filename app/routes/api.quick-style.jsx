export async function action({ request }) {
  try {
    const body = await request.json();
    const {
      currentMood,
      desiredMood,
      occasion,
      bodyComfortToday = [],
      stylingSource,
      uploadedItem,
      customerId,
      guestSessionId,
      isGuest
    } = body;

    // Extract uploaded item details if present
    const uploadedItemText = uploadedItem ? 
      `The customer uploaded a ${uploadedItem.color || ''} ${uploadedItem.category || 'item'} from their closet${uploadedItem.tags?.length > 0 ? ` (${uploadedItem.tags.join(', ')})` : ''}.` : '';

    const prompt = `You are the AI stylist for nAia, an emotionally intelligent fashion brand.

CUSTOMER'S SESSION TODAY:
- Current mood: ${currentMood}
- Desired mood: ${desiredMood}
- Occasion: ${occasion}
- Body comfort needs today: ${bodyComfortToday.join(", ") || "None specified"}
- Styling source: ${stylingSource}
${uploadedItemText}

${customerId ? `This is a returning customer.` : `This is a guest user trying nAia for the first time. Make it special.`}

STYLING GOAL:
Create a look that takes them from ${currentMood} to ${desiredMood} for ${occasion}.

${bodyComfortToday.length > 0 ? `Address their body comfort needs: ${bodyComfortToday.join(", ")}.` : ""}

RESPONSE FORMAT:
You're feeling: ${currentMood}
You want to feel: ${desiredMood}
Dressing for: ${occasion}

${uploadedItem ? `Your ${uploadedItem.color} ${uploadedItem.category} from your closet (your anchor piece)` : ''}

${stylingSource.includes("nAia") ? `nAia adds
- [specific piece name with fabric/cut details]
- [specific piece name with fabric/cut details]
- [specific piece name with fabric/cut details]

Styling direction
[2-4 evocative descriptive words]` : `Complete the look
- [piece suggestion]
- [piece suggestion]

Styling direction
[2-4 evocative descriptive words]`}

Why this works
[2-3 sentences explaining how this look addresses their mood shift, occasion, and body comfort needs${uploadedItem ? `, and how we're building around their ${uploadedItem.color} ${uploadedItem.category}` : ''}. Be specific about silhouettes, fabrics, and emotional impact.]

${stylingSource.includes("nAia") ? `Why these nAia pieces are worth trying
- [Piece 1]: [How it elevates the look and works with${uploadedItem ? ` their ${uploadedItem.color} ${uploadedItem.category}` : ' the outfit'}]
- [Piece 2]: [How it creates transformation]
- [Piece 3]: [How it completes the mood]` : ""}

The shift
From ${currentMood} to ${desiredMood} — through [describe the emotional/visual transformation].

Complete the mood
Accessories: [specific accessories - bags, jewelry, scarves]
Perfume: [specific current 2026 fragrance with notes]
Hair: [specific 2026 hairstyle trend]
Makeup: [specific 2026 makeup look with products/shades]
Song: [Artist - Song Title from 2025/2026 that matches the mood]

${uploadedItem ? `IMPORTANT: When mentioning their uploaded piece, always say "the ${uploadedItem.color} ${uploadedItem.category} from your closet" - never say "the piece you just uploaded".` : ''}

Keep the tone warm, emotionally intelligent, and personal. Be specific with product details, not generic.`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const anthropicData = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      console.error("Anthropic API Error:", anthropicData);
      return Response.json({ 
        error: "Styling failed", 
        details: anthropicData.error?.message 
      }, { status: 500 });
    }

    const result = anthropicData.content[0].text.trim();

    if (!isGuest && customerId) {
      const { prisma } = await import("../db.server.js");
      
      await prisma.quickStyleSession.create({
        data: {
          customerId: customerId,
          currentMood,
          desiredMood,
          occasion,
          bodyComfortToday: bodyComfortToday.join(", "),
          stylingSource,
          result,
          isGuest: false,
          createdAt: new Date()
        }
      });
    }

    return Response.json({ 
      result,
      sessionId: isGuest ? guestSessionId : null
    });

  } catch (error) {
    console.error("Quick Style API Error:", error);
    return Response.json({ 
      error: "Something went wrong", 
      details: error.message 
    }, { status: 500 });
  }
}
