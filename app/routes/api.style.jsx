export async function action({ request }) {
  try {
    const body = await request.json();
    const {
      mode, outfit, mood = "", feeling = "", event = "",
      styleWords = [], bodyPref = "",
      closetItem = null, closetItems = [],
      naiaPiece = null, closet = [],
    } = body || {};

    const safeMood = String(mood || "").trim();
    const safeFeeling = String(feeling || "").trim();
    const safeEvent = String(event || "").trim();
    const finalOutfit = String(outfit || "").trim() ||
      (Array.isArray(closetItems) && closetItems.length > 0
        ? closetItems.map(i => i.name).join(" + ")
        : closetItem?.name || "");

    if (!finalOutfit && (!closetItems || closetItems.length === 0)) {
      return Response.json({ error: "Missing outfit information." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ result: buildFallback({ mood: safeMood, feeling: safeFeeling, closetItem, naiaPiece, outfit: finalOutfit }) });
    }

    const stylistPrompt = buildStylistPrompt({
      mode, outfit: finalOutfit, mood: safeMood, feeling: safeFeeling,
      event: safeEvent, styleWords, bodyPref, closetItem, closetItems,
      naiaPiece, closet,
    });

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content: "You are nAia, an emotionally intelligent AI stylist. You style outfits based on mood, body preferences, and occasion. You know fashion deeply — silhouettes, color theory, proportion, and how clothes make people feel. Be specific, warm, and editorial. Never generic. Always follow the exact response format given to you.",
          },
          { role: "user", content: stylistPrompt },
        ],
      }),
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return Response.json({
        result: buildFallback({ mood: safeMood, feeling: safeFeeling, closetItem, naiaPiece, outfit: finalOutfit }),
        error: data?.error?.message || "OpenAI request failed.",
      });
    }

    const result = data?.choices?.[0]?.message?.content?.trim() ||
      buildFallback({ mood: safeMood, feeling: safeFeeling, closetItem, naiaPiece, outfit: finalOutfit });

    return Response.json({ result });

  } catch (error) {
    return Response.json({
      result: buildFallback({ mood: "", feeling: "", closetItem: null, naiaPiece: null, outfit: "" }),
      error: error?.message || "Something went wrong.",
    }, { status: 200 });
  }
}

function buildStylistPrompt({ mode, outfit, mood, feeling, event, styleWords, bodyPref, closetItem, closetItems, naiaPiece, closet }) {
  const closetList = Array.isArray(closet) && closet.length > 0
    ? closet.map(i => `- ${i.name} (${i.category}) [customer's closet]`).join("\n")
    : "No closet items.";

  const selectedList = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category}) [customer's closet]`).join("\n")
    : closetItem ? `- ${closetItem.name} (${closetItem.category}) [customer's closet]` : "None";

  const naiaList = `
- Sculptural Hybrid Coat (outerwear)
- Art Blouse (top)
- Art Panel Tailored Blazer (outerwear)
- Textured Art Midi Skirt (bottom)
- Wrap Cropped Top (top)
- Printed Wrap Kimono Dress (dress)
- Art Collar Layered Shirt (top)
- Leather Midi Dress (dress)
- Asymmetrical Waist Pants (bottom)
- Printed Straight Pants (bottom)`.trim();

  const eventNote = getEventDirection(event);

  return `
You are styling an outfit for a customer of nAia fashion brand.

CUSTOMER INFO:
- Current mood: ${mood || "not specified"}
- Desired feeling: ${feeling || "not specified"}
- Event: ${event || "not specified"}
- Style personality: ${Array.isArray(styleWords) && styleWords.length > 0 ? styleWords.join(", ") : "not specified"}
- Body preference: ${bodyPref || "not specified"}
- Mode: ${mode}

SELECTED PIECES FROM CUSTOMER'S CLOSET:
${selectedList}

CUSTOMER'S FULL CLOSET:
${closetList}

${naiaPiece ? `SELECTED NAIA PIECE:
- Name: ${naiaPiece.name} (nAia brand piece)
- Category: ${naiaPiece.category}
- Styling Notes: ${naiaPiece.stylingNotes || "not specified"}
- Mood Match: ${naiaPiece.moodMatch || "not specified"}
- Statement Level: ${naiaPiece.statementLevel || "not specified"}
- Occasion: ${naiaPiece.occasion || "not specified"}` : ""}

AVAILABLE NAIA PIECES:
${naiaList}

EVENT DIRECTION: ${eventNote}

STRICT RULES:
1. NEVER pair a top with another top. NEVER pair a bottom with another bottom.
2. Always refer to closet pieces as "your [piece name]" to distinguish from nAia pieces.
3. Always refer to nAia pieces by their exact name.
4. The Shift section must be ONE sentence only. Nothing else goes in Shift.
5. Accessories, Perfume, and Song go AFTER the Shift as separate labeled lines.
6. ${mode === "closet_only" ? "Style ONLY the customer's closet pieces together. Do NOT mention any nAia pieces at all." : ""}
7. ${mode === "recommend_naia" ? "Recommend 2-3 nAia pieces that complement the customer's closet piece. If closet piece is a TOP, only recommend BOTTOMS, OUTERWEAR, or DRESSES from nAia. NEVER recommend a top to go with a top." : ""}
8. ${mode === "closet_naia" ? "Style the customer's closet piece together with the selected nAia piece." : ""}

RESPOND IN EXACTLY THIS FORMAT:

You're feeling: ${mood}
You want to feel: ${feeling}

Your outfit direction
- [specific direction using "your [piece]" for closet pieces and exact names for nAia pieces]
- [specific direction]
- [specific direction]

Why this works
- [reason]
- [reason]
- [reason]

Shift
[ONE sentence about the emotional transformation this outfit creates. Nothing else here.]

${mode !== "closet_only" ? `nAia Recommendations
- [exact nAia piece name]: [why it works — must be different category from closet piece]
- [exact nAia piece name]: [why it works]` : ""}

Accessories: [1-2 specific accessories that match the look]
Perfume: [one specific perfume name and scent family]
Song: [Artist - Song Title that matches the energy]
`.trim();
}

function getEventDirection(event) {
  const key = String(event || "").toLowerCase();
  if (key === "casual") return "Relaxed, effortless, and easy to wear.";
  if (key === "dinner") return "Polished, sleek, and evening-appropriate.";
  if (key === "party") return "Bold, statement-driven, and high-impact.";
  if (key === "formal") return "Elegant, structured, and sophisticated.";
  if (key === "work") return "Professional, sharp, and intentional.";
  if (key === "date") return "Feminine, confident, and quietly alluring.";
  if (key === "travel") return "Comfortable, chic, and practical.";
  return "Focus on emotional shift and silhouette balance.";
}

function buildFallback({ mood, feeling, closetItem, naiaPiece, outfit }) {
  const currentMood = mood || "uncertain";
  const desiredFeeling = feeling || "more like yourself";
  const chosenCloset = closetItem?.name || "your selected piece";
  const chosenNaia = naiaPiece?.name || "a refined nAia piece";

  return `You're feeling: ${currentMood}
You want to feel: ${desiredFeeling}

Your outfit direction
- Start with your ${chosenCloset} as the foundation of the look.
- Add the ${chosenNaia} to create a more intentional silhouette.
- Keep the finish aligned with your desired feeling.

Why this works
- It shifts the look with clarity instead of adding random pieces.
- It balances emotion and structure so the outfit feels considered.
- It keeps the styling aligned with nAia's refined aesthetic.

Shift
This look moves you from ${currentMood} toward ${desiredFeeling}.

Accessories: Simple gold jewelry and a structured bag.
Perfume: Le Labo Santal 33.
Song: FKA Twigs - Two Weeks`;
}