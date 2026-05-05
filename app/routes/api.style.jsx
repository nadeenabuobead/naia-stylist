export async function action({ request }) {
  try {
    const body = await request.json();
    const {
  mode, outfit, mood = "", feeling = "", event = "",
  styleWords = [], bodyPref = "", vibe = "", styleDNA = [],
  closetItem = null, closetItems = [],
  naiaPiece = null, closet = [],
} = body || {};
    console.log("API received - bodyPref:", bodyPref, "styleDNA:", styleDNA);

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
// Fetch customer's style intelligence
let styleIntelligence = null;
try {
  const { authenticateCustomer } = await import("../customer-auth.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { customer } = await authenticateCustomer(request);
  
  if (customer) {
    const reviews = await prisma.postOutfitReview.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        session: {
          select: { currentMood: true, desiredFeeling: true, occasion: true }
        }
      }
    });
    
    if (reviews.length > 0) {
      // Extract what worked
      const workedTags = [];
      const didntWorkTags = [];
      const positiveMoods = [];
      const positiveOccasions = [];
      const negativeOccasions = [];
      const recentNotes = [];
      
      for (const r of reviews) {
        // Parse tags
        if (r.workedTags) {
          try {
            const tags = JSON.parse(r.workedTags);
            workedTags.push(...tags);
          } catch {}
        }
        if (r.didntWorkTags) {
          try {
            const tags = JSON.parse(r.didntWorkTags);
            didntWorkTags.push(...tags);
          } catch {}
        }
        
        // Track successful patterns
        if (r.feltLikeHer === "Yes" || r.wouldWearAgain === "Definitely") {
          if (r.session?.currentMood) positiveMoods.push(r.session.currentMood);
          if (r.session?.occasion) positiveOccasions.push(r.session.occasion);
        }
        
        // Track unsuccessful patterns
        if (r.feltLikeHer === "No" || r.wouldWearAgain === "Probably not") {
          if (r.session?.occasion) negativeOccasions.push(r.session.occasion);
        }
        
        // Collect notes
        if (r.additionalNotes) recentNotes.push(r.additionalNotes);
      }
      
      // Get top patterns
      const topWorked = [...new Set(workedTags)].slice(0, 5);
      const topDidntWork = [...new Set(didntWorkTags)].slice(0, 5);
      const topPositiveMoods = [...new Set(positiveMoods)].slice(0, 3);
      const topPositiveOccasions = [...new Set(positiveOccasions)].slice(0, 3);
      const topNegativeOccasions = [...new Set(negativeOccasions)].slice(0, 2);
      
      styleIntelligence = {
        totalReviews: reviews.length,
        workedTags: topWorked,
        didntWorkTags: topDidntWork,
        positiveMoods: topPositiveMoods,
        positiveOccasions: topPositiveOccasions,
        negativeOccasions: topNegativeOccasions,
        recentNotes: recentNotes.slice(0, 3)
      };
    }
  }
} catch (err) {
  console.error("Failed to fetch style intelligence:", err);
}

// Debug: log what intelligence was gathered
console.log("Style Intelligence:", JSON.stringify(styleIntelligence, null, 2));
    const stylistPrompt = buildStylistPrompt({
  mode, outfit: finalOutfit, mood: safeMood, feeling: safeFeeling,
  event: safeEvent, styleWords, bodyPref, closetItem, closetItems,
  naiaPiece, closet, vibe, styleDNA, styleIntelligence,
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
6. CRITICAL: If recommending 2 pieces, never recommend TWO pieces from the same category. Each must be DIFFERENT (e.g. one outerwear + one bottom = good; two outerwear = bad).
7. Refer to customer's closet pieces as "your [piece name]" and nAia pieces by their exact product name.
8. Song MUST be a 2025/2026 hit that matches the mood transformation. Use current artists: Sabrina Carpenter, Chappell Roan, Charli XCX, Billie Eilish, SZA, Olivia Rodrigo, Tate McRae, The Weeknd, Ariana Grande, etc.
9. Perfume MUST match the feeling they want to achieve AND the occasion. Evening/bold = YSL Black Opium, Tom Ford. Soft/romantic = Miss Dior, Daisy. Fresh/casual = Chanel Chance.
10. Hair MUST be a 2025/2026 trend: glass hair, wet look, 90s blowout, slicked-back, curtain bangs, editorial textures. Match to occasion and desired feeling.
11. Makeup MUST be a 2025/2026 trend: latte makeup, clean girl, burgundy tones, glass skin, graphic liner. Match to desired feeling and occasion.
12. Connect every styling choice (outfit, accessories, hair, makeup, perfume, song) back to the customer's emotional shift (current mood → desired feeling) and their specific occasion.
13. VARIETY RULE: Pick different pieces every time based on occasion, mood, body preference, and style DNA. The same occasion + mood combination should still yield variety by considering all factors.
14. CRITICAL: If the customer has CUSTOMER STYLE INTELLIGENCE data, you MUST prioritize and reference it. Use what has worked for her in the past, avoid what hasn't worked, and acknowledge her preferences in your recommendations.`,

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

// Parse and save nAia pieces to DB
try {
  const { authenticateCustomer } = await import("../customer-auth.server.js");
  const prisma = (await import("../db.server.js")).default;
  const { customer } = await authenticateCustomer(request);
  
  if (customer) {
    // Create styling session
    console.log("Saving styleDNA to session:", styleDNA);
    await prisma.stylingSession.create({
      data: {
        customerId: customer.id,
        currentMood: safeMood,
        desiredFeeling: safeFeeling,
        occasion: safeEvent,
        styleDNA: JSON.stringify(styleDNA || []),
        bodyPreference: bodyPref || null,
        mode,
      },
    });

    // Parse nAia recommendations from result
    const naiaSection = result.match(/nAia Recommendations\s*([\s\S]*?)(?:\n\nAccessories:|$)/i);
    if (naiaSection) {
      const lines = naiaSection[1].split('\n').filter(l => l.trim().startsWith('-'));
      
      for (const line of lines) {
        // Extract product name (before the colon)
        const match = line.match(/^-\s*([^:]+):/);
        if (match) {
          const productName = match[1].trim();
          
          // Find matching product from ALL_NAIA
          const product = ALL_NAIA.find(p => 
            p.name.toLowerCase() === productName.toLowerCase()
          );
          
          if (product) {
            // Check if already in closet
            const existing = await prisma.closetItem.findFirst({
              where: {
                customerId: customer.id,
                name: product.name,
                source: "naia"
              }
            });
            
            if (!existing) {
              await prisma.closetItem.create({
                data: {
                  customerId: customer.id,
                  name: product.name,
                  category: product.category,
                  color: product.color || null,
                  image: product.image || null,
                  source: "naia",
                  productId: product.id?.toString() || null,
                },
              });
              console.log(`Added ${product.name} to customer closet`);
            }
          }
        }
      }
    }
  }
} catch (err) {
  console.error("Failed to save nAia pieces:", err);
}

    return Response.json({ result });
  } catch (error) {
    console.error("Style API error:", error);
    return Response.json({ error: "Internal server error." }, { status: 500 });
  }
}

const ALL_NAIA = [
  {
    id: "9781793104094",
    name: "Sculptural Hybrid Coat",
    category: "OUTERWEAR",
    color: "BLACK",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4444.jpg?v=1732531829",
    styleSignal: "Architectural, bold",
    emotionalEffect: "Powerful, grounded",
    occasion: "Formal, statement events",
    statementLevel: "High",
    visualWeight: "Heavy",
    pairingBehavior: "Anchors simple bases",
    outfitCompleteness: "Statement piece, needs minimal styling"
  },
  {
    id: "9781793136926",
    name: "Art Blouse",
    category: "TOP",
    color: "CREAM/PRINT",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4490.jpg?v=1732532166",
    styleSignal: "Artistic, soft structure",
    emotionalEffect: "Creative, refined",
    occasion: "Work, dinner, creative settings",
    statementLevel: "Medium",
    visualWeight: "Light-medium",
    pairingBehavior: "Pairs with structured bottoms",
    outfitCompleteness: "Needs tailored bottom to balance"
  },
  {
    id: "9781793169630",
    name: "Art Panel Tailored Blazer",
    category: "OUTERWEAR",
    color: "BLACK/PRINT",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4503.jpg?v=1732532364",
    styleSignal: "Sharp, editorial",
    emotionalEffect: "Confident, polished",
    occasion: "Work, formal, meetings",
    statementLevel: "High",
    visualWeight: "Medium-heavy",
    pairingBehavior: "Elevates simple pieces",
    outfitCompleteness: "Statement piece, pairs with basics"
  },
  {
    id: "9781793202398",
    name: "Textured Art Maxi Skirt",
    category: "BOTTOMS",
    color: "BLACK/TEXTURE",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4512.jpg?v=1732532538",
    styleSignal: "Dramatic, flowing",
    emotionalEffect: "Elegant, magnetic",
    occasion: "Evening, formal, events",
    statementLevel: "High",
    visualWeight: "Heavy",
    pairingBehavior: "Needs simple top to balance",
    outfitCompleteness: "Statement piece, keep top minimal"
  },
  {
    id: "9781793235166",
    name: "Wrap Cropped Top",
    category: "TOP",
    color: "BLACK",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4534.jpg?v=1732532720",
    styleSignal: "Minimal, modern",
    emotionalEffect: "Clean, intentional",
    occasion: "Casual, layering, versatile",
    statementLevel: "Low",
    visualWeight: "Light",
    pairingBehavior: "Layers under blazers, pairs with high-waist",
    outfitCompleteness: "Base piece, needs layering or statement bottom"
  },
  {
    id: "9781793267934",
    name: "Printed Wrap Kimono Jacket",
    category: "OUTERWEAR",
    color: "PRINT/MULTI",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4525.jpg?v=1732532920",
    styleSignal: "Artistic, layered",
    emotionalEffect: "Creative, soft",
    occasion: "Casual, creative, travel",
    statementLevel: "Medium",
    visualWeight: "Light-medium",
    pairingBehavior: "Layers over simple bases",
    outfitCompleteness: "Layering piece, needs base underneath"
  },
  {
    id: "9781793300702",
    name: "Art Collar Shirt",
    category: "TOP",
    color: "WHITE/PRINT",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4540.jpg?v=1732533084",
    styleSignal: "Sharp, detailed",
    emotionalEffect: "Polished, refined",
    occasion: "Work, formal, meetings",
    statementLevel: "Medium",
    visualWeight: "Medium",
    pairingBehavior: "Pairs with tailored bottoms",
    outfitCompleteness: "Needs structured bottom to complete"
  },
  {
    id: "9781793333470",
    name: "Leather Midi Dress",
    category: "DRESS",
    color: "BLACK",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4549.jpg?v=1732533272",
    styleSignal: "Bold, sleek",
    emotionalEffect: "Powerful, magnetic",
    occasion: "Evening, dinner, events",
    statementLevel: "High",
    visualWeight: "Heavy",
    pairingBehavior: "Complete look, minimal accessories",
    outfitCompleteness: "Complete outfit, just add shoes"
  },
  {
    id: "9781793366238",
    name: "Asymmetrical Waist Pants",
    category: "BOTTOMS",
    color: "BLACK",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4560.jpg?v=1732533461",
    styleSignal: "Modern, architectural",
    emotionalEffect: "Sharp, intentional",
    occasion: "Work, formal, creative",
    statementLevel: "Medium-high",
    visualWeight: "Medium",
    pairingBehavior: "Pairs with simple tops",
    outfitCompleteness: "Statement bottom, keep top simple"
  },
  {
    id: "9781793399006",
    name: "Printed Straight Pants",
    category: "BOTTOMS",
    color: "PRINT/MULTI",
    image: "https://cdn.shopify.com/s/files/1/0888/6736/0318/files/IMG_4567.jpg?v=1732533638",
    styleSignal: "Artistic, bold",
    emotionalEffect: "Creative, confident",
    occasion: "Casual, creative, work",
    statementLevel: "Medium",
    visualWeight: "Medium",
    pairingBehavior: "Needs simple top to balance",
    outfitCompleteness: "Statement bottom, keep top minimal"
  },
];

function buildStylistPrompt({ mode, outfit, mood, feeling, event, styleWords, bodyPref, closetItem, closetItems, naiaPiece, closet, styleIntelligence, previousPieces, vibe, styleDNA }) {
  // Build lists
  const selectedList = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category || ""})`).join("\n")
    : closetItem
    ? `- ${closetItem.name} (${closetItem.category || ""})`
    : "No specific pieces selected";

  const closetList = Array.isArray(closet) && closet.length > 0
    ? closet.map(i => `- ${i.name} (${i.category || ""})`).join("\n")
    : "Empty closet";

  // Filter nAia pieces if needed
  const customerCategories = [];
  if (Array.isArray(closetItems) && closetItems.length > 0) {
    closetItems.forEach(i => {
      if (i.category) customerCategories.push(i.category);
    });
  } else if (closetItem?.category) {
    customerCategories.push(closetItem.category);
  }

  // Normalize category names for comparison
  const normalize = (c) => {
    if (!c) return "";
    c = String(c).toLowerCase().trim();
    if (c === "tops" || c === "top") return "top";
    if (c === "bottoms" || c === "bottom" || c === "pants" || c === "skirt") return "bottom";
    if (c === "outerwear" || c === "jacket" || c === "coat" || c === "blazer") return "outerwear";
    if (c === "dresses" || c === "dress") return "dress";
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
- Today's vibe: ${vibe || "not specified"}
- Style DNA: ${styleDNA || "not specified"}
- Body preference: ${bodyPref || "none"}
- Mode: ${mode}
${styleIntelligence?.totalReviews > 0 ? `
CUSTOMER STYLE INTELLIGENCE (learned from ${styleIntelligence.totalReviews} past reviews):
What consistently works for her:
${styleIntelligence.workedTags.length > 0 ? `- ${styleIntelligence.workedTags.join(", ")}` : "- Still learning"}
${styleIntelligence.positiveOccasions.length > 0 ? `- Best occasions: ${styleIntelligence.positiveOccasions.join(", ")}` : ""}
${styleIntelligence.positiveMoods.length > 0 ? `- Successful when feeling: ${styleIntelligence.positiveMoods.join(", ")}` : ""}

What hasn't worked:
${styleIntelligence.didntWorkTags.length > 0 ? `- ${styleIntelligence.didntWorkTags.join(", ")}` : "- No clear patterns yet"}
${styleIntelligence.negativeOccasions.length > 0 ? `- Struggled with: ${styleIntelligence.negativeOccasions.join(", ")}` : ""}

${styleIntelligence.recentNotes.length > 0 ? `In her own words: "${styleIntelligence.recentNotes.join('" | "')}"` : ""}

IMPORTANT: Use this intelligence to avoid past mistakes and lean into what has worked. Prioritize elements she's responded well to.` : ""}

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
${mode === "recommend_naia" ? `- Recommend 1-2 nAia pieces from the FILTERED list above. You can recommend just 1 piece if it's a complete statement (like a dress or coat), or 2 complementary pieces.
- You may ONLY recommend pieces from the list above — no others.
- The list has already been filtered to exclude the customer's existing categories.
- CRITICAL: If recommending 2 pieces, each MUST be a DIFFERENT category. Never recommend two pieces of the same type (e.g. never two outerwear pieces, never two bottoms). Pick from different categories.
- Each recommendation must complement (not duplicate) what the customer already owns.
- VARIETY PRIORITY: Choose pieces based on occasion (${event}), mood (${mood} → ${feeling}), body preference (${bodyPref}), and style DNA (${Array.isArray(styleDNA) ? styleDNA.join(", ") : styleDNA}). Different occasions and moods should lead to different recommendations.` : ""}
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
${mode === "recommend_naia" ? "- [OPTIONAL second piece - only if complementary and from a DIFFERENT category]: [specific reason]" : ""}` : ""}

Accessories: [1-2 specific, recognizable accessories that match the ${event} occasion and ${feeling} mood — like a gold cuff bracelet, silk scarf, structured tote, micro bag, etc.]
Perfume: [one well-known, mainstream perfume that matches the ${feeling} mood and ${event} occasion — e.g. for confident/evening: YSL Black Opium, Tom Ford Black Orchid; for soft/romantic: Miss Dior, Marc Jacobs Daisy; for fresh/casual: Chanel Chance, Jo Malone Wood Sage. Must be a 2025/2026 popular fragrance.]
Hair: [specific 2025/2026 trending hairstyle that matches the outfit, ${feeling} mood, and ${event} occasion — e.g. for polished: sleek low bun, slicked-back ponytail; for effortless: loose waves, curtain bangs; for bold: textured updo, wet look, glass hair. Reference current trends like glass hair, 90s blowouts, wet look, or editorial textures.]
Makeup: [specific 2025/2026 makeup trend that matches ${feeling} mood and ${event} occasion — e.g. for bold: graphic liner with bare skin, burgundy lip; for soft: latte makeup, no-makeup makeup; for editorial: glass skin with inner corner highlight, sculpted cheekbones. Reference 2025/2026 trends like latte makeup, clean girl aesthetic, burgundy tones, glass skin, or editorial drama.]
Song: [Artist - Song Title — MUST be a 2025/2026 popular song or recent hit that matches the outfit's ${feeling} energy and ${mood} → ${feeling} transformation. Think current Spotify top charts: Sabrina Carpenter, Chappell Roan, Charli XCX, Billie Eilish, SZA, The Weeknd, Dua Lipa, Olivia Rodrigo, Tate McRae, Ariana Grande, Taylor Swift. Match the exact vibe: confident = "Espresso" by Sabrina Carpenter; soft = "Birds of a Feather" by Billie Eilish; bold = "360" by Charli XCX.]`;
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
Perfume: YSL Black Opium — confident, warm, and evening-ready.
Hair: Slicked-back low bun with wet-look finish — polished and editorial.
Makeup: Glass skin with sculpted cheekbones and a nude lip — clean and refined.
Song: Sabrina Carpenter - Espresso`;
}
