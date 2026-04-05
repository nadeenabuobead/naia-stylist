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
            content: `You are nAia, an emotionally intelligent AI stylist who understands that clothing is emotional armor — what you wear transforms how you feel. You MUST follow the EXACT response format given to you. Rules:
1. The Shift section contains ONE sentence only — nothing else.
2. Accessories, Perfume, and Song MUST always appear at the very end as their own labeled lines.
3. Never add anything inside or after Shift except the labeled sections.
4. CRITICAL: You may ONLY recommend nAia pieces from the "NAIA PIECES YOU MAY RECOMMEND" list. This list has been pre-filtered. Do NOT invent or add pieces not in that list.
5. Never recommend a piece in the same category as what the customer already has (e.g. no top + top, no bottom + bottom).
6. Refer to customer's closet pieces as "your [piece name]" and nAia pieces by their exact product name.
7. Be specific and creative with Perfume and Song — never default to the same picks. Draw from a wide range.
8. Connect every styling choice back to the customer's emotional shift (from current mood → desired feeling).`,
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
    ? closet.map(i => `- ${i.name} (${i.category}) [customer closet]`).join("\n")
    : "No closet items.";

  const selectedList = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category}) [customer closet]`).join("\n")
    : closetItem ? `- ${closetItem.name} (${closetItem.category}) [customer closet]` : "None";

  // All nAia pieces with their categories
  const ALL_NAIA = [
    { name: "Sculptural Hybrid Coat", category: "outerwear" },
    { name: "Art Blouse", category: "top" },
    { name: "Art Panel Tailored Blazer", category: "outerwear" },
    { name: "Textured Art Midi Skirt", category: "bottom" },
    { name: "Wrap Cropped Top", category: "top" },
    { name: "Printed Wrap Kimono Dress", category: "dress" },
    { name: "Art Collar Layered Shirt", category: "top" },
    { name: "Leather Midi Dress", category: "dress" },
    { name: "Asymmetrical Waist Pants", category: "bottom" },
    { name: "Printed Straight Pants", category: "bottom" },
  ];

  // Determine which categories the customer already has covered
  const allSelectedItems = [
    ...(Array.isArray(closetItems) && closetItems.length > 0 ? closetItems : []),
    ...(closetItem ? [closetItem] : []),
  ];
  const customerCategories = allSelectedItems
    .map(i => (i.category || "").toLowerCase().trim())
    .filter(Boolean);

  // Category grouping: "top" and "shirt" are both upper body, etc.
  const normalize = (cat) => {
    const c = (cat || "").toLowerCase().trim();
    if (["top", "shirt", "blouse", "tshirt", "t-shirt", "sweater", "knit"].includes(c)) return "top";
    if (["bottom", "pants", "trousers", "skirt", "shorts", "jeans"].includes(c)) return "bottom";
    if (["outerwear", "jacket", "coat", "blazer", "cardigan"].includes(c)) return "outerwear";
    if (["dress", "jumpsuit", "romper", "one-piece"].includes(c)) return "dress";
    return c;
  };

  const customerNormalized = customerCategories.map(normalize);

  // For recommend_naia mode: FILTER OUT nAia pieces that conflict with what the customer already has
  let filteredNaia = ALL_NAIA;
  if (mode === "recommend_naia") {
    filteredNaia = ALL_NAIA.filter(p => {
      const pCat = normalize(p.category);
      // If customer has a top, don't show tops. If customer has a bottom, don't show bottoms.
      // Dresses and outerwear are always allowed since they layer or replace.
      if (pCat === "dress" || pCat === "outerwear") return true;
      return !customerNormalized.includes(pCat);
    });
    // Safety: if filtering removed everything, show outerwear + dresses at minimum
    if (filteredNaia.length === 0) {
      filteredNaia = ALL_NAIA.filter(p => {
        const pCat = normalize(p.category);
        return pCat === "dress" || pCat === "outerwear";
      });
    }
  }

  const naiaList = filteredNaia.map(p => `- ${p.name} (${p.category})`).join("\n");
  const removedCategories = mode === "recommend_naia" && customerNormalized.length > 0
    ? `\nIMPORTANT: The customer already has: ${customerNormalized.join(", ")}. The list below has been pre-filtered to EXCLUDE those categories. Only recommend from this list.`
    : "";

  const eventNote = getEventDirection(event);
  const styleNote = Array.isArray(styleWords) && styleWords.length > 0 ? styleWords.join(", ") : "not specified";

  return `Style an outfit for a nAia customer.

CUSTOMER:
- Mood: ${mood}
- Wants to feel: ${feeling}
- Event: ${event} — ${eventNote}
- Style personality: ${styleNote}
- Body preference: ${bodyPref || "none"}
- Mode: ${mode}

CUSTOMER'S SELECTED PIECES:
${selectedList}

CUSTOMER'S FULL CLOSET:
${closetList}

${naiaPiece ? `SELECTED NAIA PIECE:
- ${naiaPiece.name} (${naiaPiece.category})
- Styling Notes: ${naiaPiece.stylingNotes || "none"}
- Mood Match: ${naiaPiece.moodMatch || "none"}
- Occasion: ${naiaPiece.occasion || "none"}
- Statement Level: ${naiaPiece.statementLevel || "none"}` : ""}

NAIA PIECES YOU MAY RECOMMEND (pre-filtered, only complementary categories):${removedCategories}
${naiaList}

MODE RULES:
${mode === "closet_only" ? `- Style ONLY the customer's closet pieces together.
- Do NOT mention or recommend any nAia pieces.
- Focus on how to combine what they already own.` : ""}
${mode === "recommend_naia" ? `- Recommend 2-3 nAia pieces from the FILTERED list above.
- You may ONLY recommend pieces from the list above — no others.
- The list has already been filtered to exclude the customer's existing categories.
- Each recommendation must complement (not duplicate) what the customer already owns.` : ""}
${mode === "closet_naia" ? `- Style the customer's closet piece WITH the selected nAia piece together as one outfit.
- Explain how to wear them together.` : ""}

RESPOND IN THIS EXACT FORMAT — copy the section headers exactly:

You're feeling: ${mood}
You want to feel: ${feeling}

Your outfit direction
- [direction using "your [piece]" for closet pieces, exact name for nAia pieces]
- [direction]
- [direction]

Why this works
- [reason tying the outfit to their emotional shift and body preference]
- [reason about the silhouette and occasion]
- [reason about style personality alignment]

Shift
[ONE sentence only about the emotional transformation this outfit creates. Nothing else here.]

${mode === "recommend_naia" || mode === "closet_naia" ? `nAia Recommendations
- [exact nAia piece name from the filtered list]: [specific reason it works with their pieces and mood]
- [exact nAia piece name from the filtered list]: [specific reason]` : ""}

Accessories: [1-2 specific, unique accessories that match the look and mood]
Perfume: [one specific perfume name — be creative, vary your picks, avoid repeating Santal 33 or Jo Malone Peony]
Song: [Artist - Song Title — be diverse, match the energy, avoid repeating previous suggestions]`;
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
Perfume: Le Labo Santal 33 — warm, grounding, and refined.
Song: FKA Twigs - Two Weeks`;
}
