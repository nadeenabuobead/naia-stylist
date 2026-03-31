export async function action({ request }) {
  try {
    const body = await request.json();

    const {
      mode,
      outfit,
      mood = "",
      feeling = "",
      event = "",
      styleWords = [],
      bodyPref = "",
      closetItem = null,
      closetItems = [],
      naiaPiece = null,
      recommendedPieces = [],
      closet = [],
     } = body || {};

    const safeMood = String(mood || "").trim();
    const safeFeeling = String(feeling || "").trim();
    const safeEvent = String(event || "").trim();
    const safeOutfit = String(outfit || "").trim();

    if (!safeOutfit && !closetItem && !naiaPiece) {
      return Response.json(
        { error: "Missing outfit information." },
        { status: 400 },
      );
    }

    const stylistPrompt = buildStylistPrompt({
      mode,
      outfit: safeOutfit,
      mood: safeMood,
      feeling: safeFeeling,
      event: safeEvent,
      styleWords,
      bodyPref,
      closetItem,
      closetItems,
      naiaPiece,
      recommendedPieces,
      closet,
    });

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      const fallback = buildFallbackStyling({
        mood: safeMood,
        feeling: safeFeeling,
        event: safeEvent,
        closetItem,
        naiaPiece,
        recommendedPieces,
        outfit: safeOutfit,
      });

      return Response.json({ result: fallback });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              "You are the AI stylist for nAia, a fashion brand focused on emotionally intelligent styling, modern elegance, sculptural silhouettes, and refined statement dressing. Recommend only nAia pieces when referencing brand items. Keep the tone polished, warm, and editorial. Be specific, not generic.",
          },
          {
            role: "user",
            content: stylistPrompt,
          },
        ],
      }),
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      const fallback = buildFallbackStyling({
        mood: safeMood,
        feeling: safeFeeling,
        event: safeEvent,
        closetItem,
        naiaPiece,
        recommendedPieces,
        outfit: safeOutfit,
      });

      return Response.json({
        result: fallback,
        error: data?.error?.message || "OpenAI request failed.",
      });
    }

    const result =
      data?.choices?.[0]?.message?.content?.trim() ||
      buildFallbackStyling({
        mood: safeMood,
        feeling: safeFeeling,
        event: safeEvent,
        closetItem,
        naiaPiece,
        recommendedPieces,
        outfit: safeOutfit,
      });

    return Response.json({ result });
  } catch (error) {
    const fallback = buildFallbackStyling({
      mood: "",
      feeling: "",
      event: "",
      closetItem: null,
      naiaPiece: null,
      recommendedPieces: [],
      outfit: "",
    });

    return Response.json(
      {
        result: fallback,
        error: error?.message || "Something went wrong in /api/style.",
      },
      { status: 200 },
    );
  }
}

function buildStylistPrompt({
  mode,
  outfit,
  mood,
  feeling,
  event,
  styleWords,
  bodyPref,
  closetItem,
  closetItems,
  naiaPiece,
  recommendedPieces,
  closet,
}) {
  const closetSummary =
    Array.isArray(closet) && closet.length > 0
      ? closet.map((item) => `- ${item.name} (${item.category})`).join("\n")
      : "No full closet list provided.";

  const selectedItems = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category})`).join("\n")
    : closetItem ? `- ${closetItem.name} (${closetItem.category})` : "None selected";

  const eventDirection = getEventDirection(event);

  return `
Create a styling response for nAia.

Styling mode: ${mode || "not specified"}
Outfit: ${outfit || "not specified"}

Current mood: ${mood || "not specified"}
Desired feeling: ${feeling || "not specified"}
Event: ${event || "not specified"}
Style personality words: ${Array.isArray(styleWords) && styleWords.length > 0 ? styleWords.join(", ") : "not specified"}
Body/fit preference: ${bodyPref || "not specified"}

Selected closet pieces:
${selectedItems}

Selected nAia piece:
${naiaPiece ? `
- Name: ${naiaPiece.name}
- Category: ${naiaPiece.category || "not specified"}
- Mood Match: ${naiaPiece.moodMatch || "not specified"}
- Styling Role: ${naiaPiece.stylingRole || "not specified"}
- Statement Level: ${naiaPiece.statementLevel || "not specified"}
- Occasion: ${naiaPiece.occasion || "not specified"}
- Sihouette: ${naiaPiece.sihouette || "not specified"}
- Styling Notes: ${naiaPiece.stylingNotes || "not specified"}` : "None selected"}

Closet summary:
${closetSummary}

Event direction:
${eventDirection}

Rules:
- Respond in EXACTLY this structure:
You're feeling: ...
You want to feel: ...

Your outfit direction
- ...
- ...
- ...

Why this works
- ...
- ...
- ...

Shift
...

- Keep it concise but beautiful.
- Make the advice feel emotionally intelligent and fashion-aware.
- Honor the style personality words in your direction.
- Consider the body/fit preference in your suggestions.
- If event is provided, make the styling clearly match that occasion.
- If the event is wedding, formal, dinner, or party, make the styling more elevated and intentional.
- If a nAia piece is selected, center the advice around that piece.
- Use the nAia piece's Styling Notes as direct guidance for how to style it.
- Use the Mood Match to validate the emotional direction of the outfit.
- Use the Occasion field to confirm event alignment.
- Use the Styling Role to understand how the piece functions in the outfit.
- Use the Statement Level to calibrate how bold or subtle the overall look should be.
- If mode is recommend_naia, suggest which type of nAia piece would complete the look.
- If mode is closet_only, style the closet pieces together without requiring a nAia piece.
- If mode is recommend_naia, you MUST end your response with a specific section recommending 2-3 nAia pieces by name that would work best with the closet item, based on the mood, event and style words.
- Do not mention that you are an AI.
- Do not add any extra headings beyond the required format.
- For recommend_naia mode, after the Shift section add:
nAia Recommendations
- [specific piece name]: reason why it works
- [specific piece name]: reason why it works
`.trim();
}

function getEventDirection(event) {
  const key = String(event || "").toLowerCase();

  if (key === "casual") {
    return "Keep the look relaxed, effortless, refined, and easy to wear.";
  }

  if (key === "dinner") {
    return "Make the look polished, sleek, softly elevated, and evening-appropriate.";
  }

  if (key === "party") {
    return "Make the look bolder, more statement-driven, confident, and high-impact.";
  }

  if (key === "formal") {
    return "Make the look elegant, structured, intentional, and more sophisticated.";
  }

  if (key === "wedding") {
    return "Make the look graceful, elevated, romantic, and occasion-worthy without feeling costume-like.";
  }

  return "No specific event direction provided. Focus mainly on emotional shift and silhouette balance.";
}

function buildFallbackStyling({
  mood,
  feeling,
  event,
  closetItem,
  naiaPiece,
  recommendedPieces,
  outfit,
}) {
  const currentMood = mood || "uncertain";
  const desiredFeeling = feeling || "more like yourself";
  const eventLine = getFallbackEventLine(event);

  const chosenNaia =
    naiaPiece?.name ||
    (Array.isArray(recommendedPieces) && recommendedPieces[0]) ||
    "a refined nAia piece";

  const chosenCloset = closetItem?.name || "your selected closet piece";

  return `You’re feeling: ${currentMood}
You want to feel: ${desiredFeeling}

Your outfit direction
- Start with ${chosenCloset} as the foundation of the look.
- Add ${chosenNaia} to create a more intentional silhouette and stronger visual balance.
- ${eventLine}

Why this works
- It shifts the look with more clarity and direction instead of adding random pieces.
- It balances emotion and structure so the outfit feels considered, not overdone.
- It keeps the styling aligned with nAia’s polished, elevated aesthetic.

Shift
This look moves you from ${currentMood} toward ${desiredFeeling} by making the outfit feel more grounded, expressive, and purposeful${outfit ? ` around ${outfit}` : ""}.`;
}

function getFallbackEventLine(event) {
  const key = String(event || "").toLowerCase();

  if (key === "casual") {
    return "Keep the finish relaxed and minimal so it still feels effortless.";
  }

  if (key === "dinner") {
    return "Lean into a sleeker, more elevated finish that feels right for evening.";
  }

  if (key === "party") {
    return "Push it slightly bolder so the outfit has presence and statement energy.";
  }

  if (key === "formal") {
    return "Keep the overall silhouette clean, structured, and more sophisticated.";
  }

  if (key === "wedding") {
    return "Keep it elegant, softened, and special enough for the occasion.";
  }

  return "Keep the overall styling balanced and emotionally aligned with how you want to feel.";
}