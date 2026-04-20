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
2. Accessories, Perfume, Hair, Makeup and Song MUST always appear at the very end as their own labeled lines.
3. Never add anything inside or after Shift except the labeled sections.
4. CRITICAL: You may ONLY recommend nAia pieces from the "NAIA PIECES YOU MAY RECOMMEND" list. This list has been pre-filtered. Do NOT invent or add pieces not in that list.
5. Never recommend a piece in the same category as what the customer already has (e.g. no top + top, no bottom + bottom).
6. CRITICAL: Never recommend TWO pieces from the same category. Each recommendation must be a DIFFERENT category. For example, do NOT recommend two outerwear pieces, or two bottoms. One outerwear + one bottom = good. Two outerwear = bad.
7. Refer to customer's closet pieces as "your [piece name]" and nAia pieces by their exact product name.
8. Song MUST be a well-known, popular song that most people would recognize — think top hits, Spotify top charts, popular artists like Dua Lipa, SZA, Billie Eilish, The Weeknd, Taylor Swift, Rihanna, Frank Ocean, Adele, Harry Styles, Beyoncé, Arctic Monkeys, Lana Del Rey, etc. Match the energy and mood. Never pick obscure songs.
9. Perfume MUST be a mainstream, widely available fragrance people would recognize — like Chanel No. 5, YSL Black Opium, Dior Miss Dior, Tom Ford Black Orchid, Marc Jacobs Daisy, Lancôme La Vie Est Belle, Versace Bright Crystal, etc. Match the mood of the outfit.
10. Connect every styling choice back to the customer's emotional shift (from current mood → desired feeling).
11. VARIETY RULE: You MUST pick different pieces every time. Never recommend the same combination twice in a row. If you recommended the Sculptural Hybrid Coat or Textured Art Maxi Skirt last time, pick completely different pieces this time. Rotate through ALL available pieces equally.`,
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

function buildStylistPrompt({ mode, outfit, mood, feeling, event, styleWords, bodyPref, closetItem, closetItems, naiaPiece, closet, previousPieces }) {
  const closetList = Array.isArray(closet) && closet.length > 0
    ? closet.map(i => `- ${i.name} (${i.category}) [customer closet]`).join("\n")
    : "No closet items.";

  const selectedList = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category}) [customer closet]`).join("\n")
    : closetItem ? `- ${closetItem.name} (${closetItem.category}) [customer closet]` : "None";

  // All nAia pieces with full styling metadata
  const ALL_NAIA = [
    {
      name: "Sculptural Hybrid Coat", category: "outerwear",
      color: "soft beige + deep brown + art print panel", stylingRole: "statement",
      silhouette: "structured, longline, asymmetric", fit: "tailored", length: "full",
      visualWeight: "heavy", statementLevel: "high",
      styleSignal: "dramatic, sculptural, refined, editorial",
      occasion: "event, dinner, evening, work",
      emotionalEffect: "empowering, elevating, commanding",
      pairingBehavior: "Best with minimal, clean base layers. Avoid competing statement outerwear or heavily detailed tops underneath. Works best over fitted or straight silhouettes. Can finish the whole look on its own.",
      outfitCompleteness: "near-complete"
    },
    {
      name: "Printed Wrap Kimono Jacket", category: "outerwear",
      color: "cream, rust, espresso brown", stylingRole: "statement",
      silhouette: "wrap, soft-structured, defined waist", fit: "adjustable", length: "hip",
      visualWeight: "medium", statementLevel: "medium",
      styleSignal: "artistic, textured, layered",
      occasion: "day, evening",
      emotionalEffect: "comforting, enveloping",
      pairingBehavior: "Pair with slim/straight bottoms. Avoid excess volume underneath. Can replace top + jacket.",
      outfitCompleteness: "builder"
    },
    {
      name: "Art Panel Tailored Blazer", category: "outerwear",
      color: "espresso brown + beige/brown print accent", stylingRole: "statement",
      silhouette: "structured, tailored", fit: "tailored", length: "hip",
      visualWeight: "medium-heavy", statementLevel: "medium-high",
      styleSignal: "sculptural, editorial, refined",
      occasion: "work, dinner, event",
      emotionalEffect: "empowering, elevated",
      pairingBehavior: "Pair with clean minimal tops, straight or fluid bottoms. Avoid competing prints, heavy detailing underneath, overlayering.",
      outfitCompleteness: "builder"
    },
    {
      name: "Art Blouse", category: "top",
      color: "deep chocolate brown + burnt bronze", stylingRole: "statement",
      silhouette: "structured, waist defined", fit: "fitted", length: "hip",
      visualWeight: "medium-high", statementLevel: "high",
      styleSignal: "sculptural, editorial, dramatic",
      occasion: "dinner, event, evening",
      emotionalEffect: "powerful, protective",
      pairingBehavior: "Pair with minimal bottoms. Avoid additional statement pieces. No heavy layering.",
      outfitCompleteness: "builder"
    },
    {
      name: "Textured Art Maxi Skirt", category: "bottom",
      color: "warm beige, rust, deep brown mix", stylingRole: "statement",
      silhouette: "long, straight, slightly fluid", fit: "skimming", length: "maxi",
      visualWeight: "medium-high", statementLevel: "high",
      styleSignal: "editorial, sculptural, artistic",
      occasion: "dinner, event",
      emotionalEffect: "grounding, expressive",
      pairingBehavior: "Pair with clean, structured, or minimal tops. Avoid competing textures. Keep upper half refined.",
      outfitCompleteness: "builder"
    },
    {
      name: "Wrap Cropped Top", category: "top",
      color: "warm beige, rust, deep brown blend", stylingRole: "statement",
      silhouette: "fitted, sculpting", fit: "fitted", length: "hip",
      visualWeight: "medium", statementLevel: "medium-high",
      styleSignal: "artistic, sculptural",
      occasion: "dinner, casual event",
      emotionalEffect: "expressive, elevated",
      pairingBehavior: "Pair with clean bottoms. Avoid busy combinations.",
      outfitCompleteness: "builder"
    },
    {
      name: "Art Collar Layered Shirt", category: "top",
      color: "crisp white + warm brown accent in collar", stylingRole: "anchor",
      silhouette: "structured, waist defined", fit: "tailored", length: "hip",
      visualWeight: "medium", statementLevel: "medium",
      styleSignal: "structured, sharp, refined, slightly editorial",
      occasion: "work, dinner, event",
      emotionalEffect: "empowering, polished, composed",
      pairingBehavior: "Pair with fluid or statement bottoms. Works well under clean outerwear. Avoid overly busy necklines or heavy accessories (collar is already a feature). Can elevate otherwise minimal outfits.",
      outfitCompleteness: "builder"
    },
    {
      name: "Leather Midi Dress", category: "dress",
      color: "deep burgundy brown + muted beige print", stylingRole: "statement",
      silhouette: "fitted top + straight skirt", fit: "fitted (top), relaxed (skirt)", length: "midi",
      visualWeight: "high", statementLevel: "high",
      styleSignal: "sculptural, editorial, refined",
      occasion: "dinner, evening, event",
      emotionalEffect: "grounded, powerful",
      pairingBehavior: "Minimal layering, keep everything else simple, avoid competing textures.",
      outfitCompleteness: "near-complete"
    },
    {
      name: "Asymmetrical Waist Pants", category: "bottom",
      color: "dark brown + neutral underlayer accent", stylingRole: "anchor",
      silhouette: "structured, elongated", fit: "tailored", length: "full",
      visualWeight: "medium", statementLevel: "medium",
      styleSignal: "structured, refined, slightly editorial",
      occasion: "work, dinner, day",
      emotionalEffect: "grounding, polished",
      pairingBehavior: "Pair with clean or minimal tops, structured or fluid tops. Avoid too much detail at the waist, and overly complex layering at midsection.",
      outfitCompleteness: "builder"
    },
    {
      name: "Printed Straight Pants", category: "bottom",
      color: "rust, brown, charcoal blend", stylingRole: "statement",
      silhouette: "wide-leg, flowing", fit: "relaxed", length: "full",
      visualWeight: "medium-high", statementLevel: "high",
      styleSignal: "fluid, artistic, expressive",
      occasion: "dinner, event, evening",
      emotionalEffect: "expressive, expansive, slightly dramatic",
      pairingBehavior: "Pair with structured tops, clean silhouettes, minimal layers. Avoid other strong prints, overly voluminous tops and competing textures.",
      outfitCompleteness: "anchor+statement in one"
    },
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
      return !customerNormalized.includes(pCat);
    });
    // Safety: if filtering removed everything, show outerwear + dresses at minimum
    if (filteredNaia.length === 0) {
      filteredNaia = ALL_NAIA.filter(p => {
        const pCat = normalize(p.category);
        return pCat === "dress" || pCat === "outerwear";
      });
    }
    // Limit to max 2 pieces per category so the AI has balanced options
    const catCount = {};
    filteredNaia = filteredNaia.filter(p => {
      const pCat = normalize(p.category);
      catCount[pCat] = (catCount[pCat] || 0) + 1;
      return catCount[pCat] <= 2;
    });
  }

  const naiaList = filteredNaia.map(p => `- ${p.name} (${p.category})
    Color: ${p.color} | Style: ${p.styleSignal} | Mood: ${p.emotionalEffect}
    Occasion: ${p.occasion} | Statement: ${p.statementLevel} | Weight: ${p.visualWeight}
    Pairing: ${p.pairingBehavior}
    Completeness: ${p.outfitCompleteness}`).join("\n");
  const removedCategories = mode === "recommend_naia" && customerNormalized.length > 0
    ? `\nIMPORTANT: The customer already has: ${customerNormalized.join(", ")}. The list below has been pre-filtered to EXCLUDE those categories. Only recommend from this list.`
    : "";

  const eventNote = getEventDirection(event);
  const styleNote = Array.isArray(styleWords) && styleWords.length > 0 ? styleWords.join(", ") : "not specified";

  return `Style an outfit for a nAia customer.
${previousPieces?.length > 0 ? `AVOID these pieces already recommended: ${previousPieces.join(", ")}. You MUST pick different pieces.` : ""} Variety seed: ${Math.floor(Math.random() * 10000)}. IMPORTANT: Pick DIFFERENT pieces than you normally default to. Avoid repeating the same combinations.

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
${mode === "recommend_naia" ? `- Recommend exactly 2 nAia pieces from the FILTERED list above.
- You may ONLY recommend pieces from the list above — no others.
- The list has already been filtered to exclude the customer's existing categories.
- CRITICAL: Each recommendation MUST be a DIFFERENT category. Never recommend two pieces of the same type (e.g. never two outerwear pieces, never two bottoms). Pick from different categories.
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
- [exact nAia piece name from a DIFFERENT category than the first]: [specific reason]` : ""}

Accessories: [1-2 specific, recognizable accessories — like a gold cuff bracelet, silk scarf, structured tote, etc.]
Perfume: [one well-known, mainstream perfume — e.g. Chanel No. 5, YSL Black Opium, Dior Miss Dior, Tom Ford Black Orchid, Marc Jacobs Daisy, Lancôme La Vie Est Belle. Match the mood.]
Hair: [specific hairstyle suggestion that matches the outfit and mood — e.g. sleek low bun, loose waves, high ponytail, textured updo]
Makeup: [specific makeup vibe — e.g. clean skin with bold lip, smoky eye with nude lip, dewy no-makeup makeup, warm bronze tones]
Song: [Artist - Song Title — must be a popular, well-known song people would recognize. Think Spotify top hits, chart artists. Match the outfit's energy.]`;
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
Hair: Sleek low bun with a centre part.
Makeup: Clean skin, defined brows, and a nude lip.
Song: FKA Twigs - Two Weeks`;
}
