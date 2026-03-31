export async function action({ request }) {
  try {
    const body = await request.json();
    const {
      mode, outfit, mood = "", feeling = "", event = "",
      styleWords = [], bodyPref = "",
      closetItem = null, closetItems = [],
      naiaPiece = null, recommendedPieces = [], closet = [],
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

    const stylistPrompt = buildStylistPrompt({
      mode, outfit: finalOutfit, mood: safeMood, feeling: safeFeeling,
      event: safeEvent, styleWords, bodyPref, closetItem, closetItems,
      naiaPiece, closet,
    });

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return Response.json({ result: buildFallback({ mood: safeMood, feeling: safeFeeling, closetItem, naiaPiece, outfit: finalOutfit }) });
    }

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content: "You are nAia, an emotionally intelligent AI stylist for a fashion brand. You style outfits based on mood, body preferences, and occasion. You know fashion deeply — silhouettes, color theory, proportion, and how clothes make people feel. Be specific, warm, and editorial. Never generic.",
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
    ? closet.map(i => `- ${i.name} (${i.category})`).join("\n")
    : "No closet items provided.";

  const selectedList = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category})`).join("\n")
    : closetItem ? `- ${closetItem.name} (${closetItem.category})` : "None";

  const naiaList = "Sculptural Hybrid Coat (outerwear), Art Blouse (top), Art Panel Tailored Blazer (outerwear), Textured Art Midi Skirt (bottom), Wrap Cropped Top (top), Printed Wrap Kimono Dress (dress), Art Collar Layered Shirt (top), Leather Midi Dress (dress), Asymmetrical Waist Pants (bottom), Printed Straight Pants (bottom)";

  const eventNote = getEventDirection(event);

  return `
You are styling an outfit for nAia.

CUSTOMER INFO:
- Current mood: ${mood || "not specified"}
- Desired feeling: ${feeling || "not specified"}
- Event: ${event || "not specified"}
- Style personality: ${Array.isArray(styleWords) && styleWords.length > 0 ? styleWords.join(", ") : "not specified"}
- Body preference: ${bodyPref || "not specified"}
- Styling mode: ${mode}

SELECTED CLOSET PIECES:
${selectedList}

FULL CLOSET:
${closetList}

${naiaPiece ? `SELECTED NAIA PIECE:
- Name: ${naiaPiece.name}
- Category: ${naiaPiece.category}
- Styling Notes: ${naiaPiece.stylingNotes || "not specified"}
- Mood Match: ${naiaPiece.moodMatch || "not specified"}
- Statement Level: ${naiaPiece.statementLevel || "not specified"}
- Occasion: ${naiaPiece.occasion || "not specified"}` : ""}

AVAILABLE NAIA PIECES (with categories):
${naiaList}

EVENT DIRECTION: ${eventNote}

IMPORTANT RULES:
- NEVER pair a top with another top, or a bottom with another bottom
- Always think about proportion and category balance (top + bottom, or top + outerwear, etc.)
- ${mode === "closet_only" ? "Style ONLY closet pieces together. DO NOT mention or recommend any nAia pieces." : ""}
- ${mode === "recommend_naia" ? "Recommend 2-3 nAia pieces that COMPLEMENT the closet piece. Match categories correctly — if the closet piece is a top, recommend bottoms, outerwear, or dresses. NEVER recommend another top to go with a top." : ""}
- ${mode === "closet_naia" ? "Style the selected closet piece WITH the selected nAia piece." : ""}

RESPOND IN EXACTLY THIS FORMAT — no deviations:

You're feeling: [mood]
You want to feel: [desired feeling]

Your outfit direction
- [specific styling direction]
- [specific styling direction]
- [specific styling direction]

Why this works
- [reason]
- [reason]
- [reason]

Shift
[One powerful sentence about the emotional shift this outfit creates]

${mode !== "closet_only" ? `nAia Recommendations
- [nAia piece name]: [why it works with the closet piece and the mood]
- [nAia piece name]: [why it works]` : ""}

Accessories: [suggest 1-2 specific accessories]
Perfume: [suggest one specific perfume name that matches the mood]
Song: [suggest one specific song — Artist - Song Title]
`.trim();
}

function getEventDirection(event) {
  const key = String(event || "").toLowerCase();
  if (key === "casual") return "Keep the look relaxed, effortless, and easy to wear.";
  if (key === "dinner") return "Make the look polished, sleek, and evening-appropriate.";
  if (key === "party") return "Make the look bolder, more statement-driven and high-impact.";
  if (key === "formal") return "Make the look elegant, structured, and sophisticated.";
  if (key === "work") return "Keep the look professional, sharp, and intentional.";
  if (key === "date") return "Make the look feminine, confident, and quietly alluring.";
  if (key === "travel") return "Keep the look comfortable, chic, and practical.";
  return "Focus on emotional shift and silhouette balance.";
}

function buildFallback({ mood, feeling, closetItem, naiaPiece, outfit }) {
  const currentMood = mood || "uncertain";
  const desiredFeeling = feeling || "more like yourself";
  const chosenCloset = closetItem?.name || "your selected closet piece";
  const chosenNaia = naiaPiece?.name || "a refined nAia piece";

  return `You're feeling: ${currentMood}
You want to feel: ${desiredFeeling}

Your outfit direction
- Start with ${chosenCloset} as the foundation of the look.
- Add ${chosenNaia} to create a more intentional silhouette and stronger visual balance.
- Keep the finish aligned with your desired feeling.

Why this works
- It shifts the look with clarity instead of adding random pieces.
- It balances emotion and structure so the outfit feels considered.
- It keeps the styling aligned with nAia's refined aesthetic.

Shift
This look moves you from ${currentMood} toward ${desiredFeeling}.

Accessories: Simple gold jewelry and a structured bag.
Perfume: Something clean and grounding like Le Labo Santal 33.
Song: FKA Twigs - Two Weeks`;
}