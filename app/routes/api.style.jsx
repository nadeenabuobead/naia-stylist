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
    console.log("Saving bodyPref to session:", bodyPref);
    const session = await prisma.stylingSession.create({
      data: {
        customerId: customer.id,
        currentMood: safeMood || "",
        desiredFeeling: safeFeeling || "",
        occasion: safeEvent || "",
        bodyPreference: bodyPref || "",
        styleDNA: JSON.stringify(styleDNA || []),
        specificNeeds: result,
        styleFrom: "NAIA",
      },
    });

    // Parse nAia pieces from result
    const ALL_PIECE_NAMES = [
      "Sculptural Hybrid Coat", "Art Blouse", "Art Panel Tailored Blazer",
      "Textured Art Maxi Skirt", "Wrap Cropped Top", "Printed Wrap Kimono Jacket",
      "Art Collar Shirt", "Leather Midi Dress", "Asymmetrical Waist Pants", "Printed Straight Pants"
    ];
    const PIECE_IDS = {
      "Sculptural Hybrid Coat": "7822708867114",
      "Art Blouse": "7822708310058",
      "Art Panel Tailored Blazer": "7822708113450",
      "Textured Art Maxi Skirt": "7822708047914",
      "Wrap Cropped Top": "7822707949610",
      "Printed Wrap Kimono Jacket": "7822707589162",
      "Art Collar Shirt": "7822707392554",
      "Leather Midi Dress": "7822707130410",
      "Asymmetrical Waist Pants": "7822706475050",
      "Printed Straight Pants": "7822706016298",
    };
    const PIECE_IMAGES = {
      "Sculptural Hybrid Coat": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png",
      "Art Blouse": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32674461-cac7-4699-aff1-74c435289333.png",
      "Art Panel Tailored Blazer": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/a7b908bb-3079-4f39-93b8-e1a89435249a.png",
      "Textured Art Maxi Skirt": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/6992350d-5695-4f28-8674-7747dfd1e680.png",
      "Wrap Cropped Top": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3614927b-4685-4df3-aeff-b3d5a950cbd2.png",
      "Printed Wrap Kimono Jacket": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/77d61b97-37da-4e57-8297-aa5207b35d07.png",
      "Art Collar Shirt": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32fe2afb-b8ef-46d2-ae2c-b1adc81a1b0f.png",
      "Leather Midi Dress": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/8a855f15-e5e9-4ef5-a7db-a7253e83a542.png",
      "Asymmetrical Waist Pants": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png",
      "Printed Straight Pants": "https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png",
    };

    const foundPieces = ALL_PIECE_NAMES.filter(name => result.includes(name));

    if (foundPieces.length > 0) {
      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId: session.id,
          whyThisWorks: result.match(/WHY THIS WORKS[\s\S]*?(?=\n[A-Z])/i)?.[0] || null,
        },
      });

      await prisma.outfitItem.createMany({
        data: foundPieces.map(name => ({
          suggestionId: suggestion.id,
          itemType: "TOP",
          shopifyProductId: PIECE_IDS[name],
          productTitle: name,
          productImageUrl: PIECE_IMAGES[name],
          productUrl: `https://naiabynadine.com/products/${name.toLowerCase().replace(/ /g, "-")}`,
        })),
      });
    }

    return Response.json({ result: "TEST - Intelligence has " + (styleIntelligence ? styleIntelligence.totalReviews : "NO") + " reviews", sessionId: session.id });
  }
} catch (err) {
  console.error("DB save error:", err);
}

return Response.json({ result, debug_styleIntelligence: styleIntelligence });

  } catch (error) {
    return Response.json({
      result: buildFallback({ mood: "", feeling: "", closetItem: null, naiaPiece: null, outfit: "" }),
      error: error?.message || "Something went wrong.",
    }, { status: 200 });
  }
}

function buildStylistPrompt({ mode, outfit, mood, feeling, event, styleWords, bodyPref, closetItem, closetItems, naiaPiece, closet, styleIntelligence, previousPieces, vibe, styleDNA }) {
  const closetList = Array.isArray(closet) && closet.length > 0
    ? closet.map(i => `- ${i.name} (${i.category}) [customer closet]`).join("\n")
    : "No closet items.";

  const selectedList = Array.isArray(closetItems) && closetItems.length > 0
    ? closetItems.map(i => `- ${i.name} (${i.category}) [customer closet]`).join("\n")
    : closetItem ? `- ${closetItem.name} (${closetItem.category}) [customer closet]` : "None";

  // All nAia pieces with full styling metadata
  const ALL_NAIA = [
    {
      name: "Calm", category: "outerwear",
      color: "soft beige + deep brown + art print panel", stylingRole: "statement",
      silhouette: "structured, longline, asymmetric", fit: "tailored", length: "full",
      visualWeight: "heavy", statementLevel: "high",
      styleDNA: "Statement, Refined, Artistic",
      occasion: "Dinner, Event, Night out, Date, Work",
      moodMatch: "Powerful, Confident, Magnetic, Bold",
      bodyPreferences: "Add structure, Define shape, Elongate legs",
      emotionalEffect: "empowering, elevating, commanding",
      pairingBehavior: "Best with minimal, clean base layers. Avoid competing statement outerwear or heavily detailed tops underneath.",
      outfitCompleteness: "near-complete"
    },
    {
      name: "Open", category: "outerwear",
      color: "cream, art print", stylingRole: "statement",
      silhouette: "wrap, soft-structured, defined waist", fit: "adjustable", length: "hip",
      visualWeight: "medium", statementLevel: "medium",
      styleDNA: "Artistic, Feminine, Relaxed",
      occasion: "Casual, Brunch, Weekend, Travel, Errands",
      moodMatch: "Comfortable, Soft, Effortless",
      bodyPreferences: "Create ease, Skim the body, Balance shoulders",
      emotionalEffect: "comforting, enveloping",
      pairingBehavior: "Pair with slim/straight bottoms. Avoid excess volume underneath.",
      outfitCompleteness: "builder"
    },
    {
      name: "Sharp", category: "outerwear",
      color: "dark brown + art print", stylingRole: "statement",
      silhouette: "structured, tailored", fit: "tailored", length: "hip",
      visualWeight: "medium-heavy", statementLevel: "medium-high",
      styleDNA: "Polished, Statement, Refined",
      occasion: "Work, Dinner, Event, Date",
      moodMatch: "Confident, Powerful, Polished, Elegant",
      bodyPreferences: "Add structure, Define shape, Balance shoulders",
      emotionalEffect: "empowering, elevated",
      pairingBehavior: "Pair with clean minimal tops, straight or fluid bottoms. Avoid competing prints.",
      outfitCompleteness: "builder"
    },
    {
      name: "Defined", category: "top",
      color: "deep chocolate brown + art print", stylingRole: "statement",
      silhouette: "structured, waist defined", fit: "fitted", length: "hip",
      visualWeight: "medium-high", statementLevel: "high",
      styleDNA: "Statement, Feminine, Artistic",
      occasion: "Dinner, Date, Event, Night out",
      moodMatch: "Powerful, Confident, Magnetic, Bold",
      bodyPreferences: "Highlight waist, Define shape",
      emotionalEffect: "powerful, protective",
      pairingBehavior: "Pair with minimal bottoms. Avoid additional statement pieces.",
      outfitCompleteness: "builder"
    },
    {
      name: "Balanced", category: "bottom",
      color: "Camel/tan knit + structured brown leather", stylingRole: "Anchor",
      silhouette: "Column ankle length with dramatic waist detail", fit: "skimming", length: "Midi",
      visualWeight: "medium-high", statementLevel: "Medium",
      styleDNA: "Statement, Refined, Edgy",
      occasion: "Dinner, Event, Date, Night out, Party, Brunch",
      moodMatch: "Confident, Powerful, Magnetic, Bold, Elegant",
      bodyPreferences: "Highlight waist, Elongate legs, Define shape",
      emotionalEffect: "grounding, expressive",
      pairingBehavior: "The waist IS the statement - pair with simple, minimal tops (tanks, bodysuits, fitted knits). Avoid anything with waist detail, busy necklines, or volume on top. Tuck tops IN to show the corset.",
      outfitCompleteness: "Near-complete"
    },
    {
      name: "Fluid", category: "top",
      color: "warm beige, rust + art print", stylingRole: "statement",
      silhouette: "fitted, sculpting", fit: "fitted", length: "hip",
      visualWeight: "medium", statementLevel: "medium-high",
      styleDNA: "Minimal, Artistic, Statement",
      occasion: "Dinner, Date, Event, Casual",
      moodMatch: "Confident, Bold, Magnetic",
      bodyPreferences: "Highlight waist, Define shape, Skim the body",
      emotionalEffect: "expressive, elevated",
      pairingBehavior: "Pair with clean bottoms. Avoid busy combinations.",
      outfitCompleteness: "builder"
    },
    {
      name: "Refined", category: "top",
      color: "crisp white + art print", stylingRole: "anchor",
      silhouette: "structured, waist defined", fit: "tailored", length: "hip",
      visualWeight: "medium", statementLevel: "medium",
      styleDNA: "Polished, Refined, Classic",
      occasion: "Work, Dinner, Event, Brunch",
      moodMatch: "Polished, Confident, Elegant",
      bodyPreferences: "Add structure, Define shape, Balance shoulders",
      emotionalEffect: "empowering, polished, composed",
      pairingBehavior: "Pair with fluid or statement bottoms. Works well under clean outerwear.",
      outfitCompleteness: "builder"
    },
    {
      name: "Soft", category: "dress",
      color: "deep burgundy brown + art print", stylingRole: "statement",
      silhouette: "fitted top + straight skirt", fit: "fitted (top), relaxed (skirt)", length: "midi",
      visualWeight: "high", statementLevel: "high",
      styleDNA: "Statement, Refined, Edgy",
      occasion: "Dinner, Event, Night out, Date, Party",
      moodMatch: "Powerful, Confident, Magnetic, Bold",
      bodyPreferences: "Define shape, Skim the body, Elongate legs",
      emotionalEffect: "grounded, powerful",
      pairingBehavior: "Minimal layering, keep everything else simple, avoid competing textures.",
      outfitCompleteness: "near-complete"
    },
    {
      name: "Grounded", category: "bottom",
      color: "dark brown + art print", stylingRole: "anchor",
      silhouette: "structured, elongated", fit: "tailored", length: "full",
      visualWeight: "medium", statementLevel: "medium",
      styleDNA: "Polished, Refined, Modern",
      occasion: "Work, Dinner, Date, Brunch, Weekend",
      moodMatch: "Polished, Confident, Elegant, Effortless",
      bodyPreferences: "Elongate legs, Define shape, Highlight waist",
      emotionalEffect: "grounding, polished",
      pairingBehavior: "Pair with clean or minimal tops. Avoid too much detail at the waist.",
      outfitCompleteness: "builder"
    },
    {
      name: "Light", category: "bottom",
      color: "rust, brown, art print", stylingRole: "statement",
      silhouette: "wide-leg, flowing", fit: "relaxed", length: "full",
      visualWeight: "medium-high", statementLevel: "high",
      styleDNA: "Artistic, Statement, Feminine",
      occasion: "Dinner, Event, Date, Brunch, Weekend",
      moodMatch: "Confident, Bold, Effortless, Magnetic",
      bodyPreferences: "Elongate legs, Create ease, Skim the body, Balance shoulders",
      emotionalEffect: "expressive, expansive, slightly dramatic",
      pairingBehavior: "Pair with structured tops, clean silhouettes. Avoid other strong prints.",
      outfitCompleteness: "anchor+statement in one"
    },
    {
      name: "Whole", category: "dress",
      color: "Cream/beige base with art print + structured corset bodice", stylingRole: "Complete statement",
      silhouette: "Fitted corset bodice + full maxi skirt with train + detached sleeves", fit: "Structured (corset) + flowing (skirt)", length: "Full maxi with train",
      visualWeight: "very heavy", statementLevel: "maximum",
      styleDNA: "Statement, Artistic, Edgy, Refined",
      occasion: "Wedding guest, Event, Party",
      moodMatch: "Powerful, Magnetic, Bold, Confident, Elegant",
      bodyPreferences: "Highlight waist, Define shape, Add structure, Elongate legs",
      emotionalEffect: "commanding, artistic, theatrical, unforgettable",
      pairingBehavior: "This IS the entire look. Nothing else needed except shoes (hidden under train) and minimal jewelry. The sleeves, corset, print, and train do ALL the work.",
      outfitCompleteness: "complete"
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
