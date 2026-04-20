// app/lib/ai/style-me.server.ts
import { prisma } from "~/lib/prisma.server";
import { callClaude } from "~/lib/ai/claude.server";

interface GenerateOutfitParams {
  mood: string;
  feelings: string[];
  occasion: string;
  source: "CLOSET" | "NAIA" | "BOTH";
  customerId?: string;
}

interface OutfitItem {
  type: "TOP" | "BOTTOM" | "DRESS" | "OUTERWEAR" | "SHOES" | "BAG" | "ACCESSORY" | "JEWELRY";
  name: string;
  imageUrl?: string;
  description?: string;
  closetItemId?: string;
  shopifyProductId?: string;
  shopifyVariantId?: string;
  price?: number;
  stylingTip?: string;
}

interface GeneratedOutfit {
  outfitName: string;
  heroImageUrl?: string;
  styleNotes: string;
  confidenceBoost: string;
  perfumeSuggestion?: string;
  hairSuggestion?: string;
  makeupSuggestion?: string;
  songSuggestion?: string;
  items: OutfitItem[];
}

const STYLE_ME_SYSTEM_PROMPT = `You are nAia, a warm, confident, and deeply intuitive AI personal stylist. You understand that fashion is about how clothes make someone FEEL, not just how they look.

Your approach:
- You lead with emotion and confidence, not rules
- You understand that the right outfit can transform someone's entire day
- You give specific, actionable styling advice
- You're encouraging but never condescending
- You treat fashion as a form of self-expression and self-care

When creating outfits:
1. Consider the mood and desired feelings FIRST
2. Match pieces that work together cohesively
3. Always include accessories to complete the look
4. Provide specific styling tips for each piece
5. Add the complete vibe (perfume, hair, makeup, song)

Respond ONLY with valid JSON matching the schema provided. No markdown, no extra text.`;

export async function generateOutfit(params: GenerateOutfitParams): Promise<GeneratedOutfit> {
  const { mood, feelings, occasion, source, customerId } = params;
  
  // Gather context based on source
  let closetItems: any[] = [];
  let customerProfile: any = null;
  
  if (customerId) {
    // Get customer's style profile
    customerProfile = await prisma.onboardingProfile.findUnique({
      where: { customerId },
      select: {
        stylePersonalities: true,
        lifestyle: true,
        favoritePreferences: true,
        avoidColors: true,
        styleStruggles: true,
        fitPreferences: true
      }
    });
    
    // Get closet items if needed
    if (source === "CLOSET" || source === "BOTH") {
      closetItems = await prisma.closetItem.findMany({
        where: { customerId },
        orderBy: { timesWorn: "desc" }
      });
    }
  }
  
  // Build the prompt
  const prompt = buildStyleMePrompt({
    mood,
    feelings,
    occasion,
    source,
    closetItems,
    customerProfile
  });
  
  // Call Claude
  const response = await callClaude({
    messages: [{ role: "user", content: prompt }],
    system: STYLE_ME_SYSTEM_PROMPT
  });
  
  // Parse the response
  return parseOutfitResponse(response, closetItems);
}

interface PromptContext {
  mood: string;
  feelings: string[];
  occasion: string;
  source: "CLOSET" | "NAIA" | "BOTH";
  closetItems: any[];
  customerProfile: any;
}

function buildStyleMePrompt(context: PromptContext): string {
  const { mood, feelings, occasion, source, closetItems, customerProfile } = context;
  
  const occasionLabels: Record<string, string> = {
    everyday: "a casual everyday outing",
    work: "a professional work setting",
    datenight: "a romantic date night",
    girlsnight: "a fun girls' night out",
    special: "a special event or celebration",
    travel: "comfortable travel",
    athome: "feeling put-together at home",
    fitness: "an active day"
  };
  
  let prompt = `Create a complete outfit for someone who is feeling ${mood} and wants to look ${feelings.join(", ")} for ${occasionLabels[occasion] || occasion}.

`;

  // Add customer profile context if available
  if (customerProfile) {
    prompt += `ABOUT THIS PERSON:
- Style personality: ${customerProfile.stylePersonalities?.join(", ") || "Not specified"
- Lifestyle: ${customerProfile.lifestyle || "Not specified"}
- Favorite colors: ${customerProfile.favoriteColors?.join(", ") || "Not specified"}
- Colors to avoid: ${customerProfile.avoidColors?.join(", ") || "None"}
- Style struggles: ${customerProfile.styleStruggles?.join(", ") || "None mentioned"}
- Preferred fit: ${customerProfile.fitPreferences?.join(", ") || "Not specified"}

`;
  }

  // Add available pieces
  if (source === "CLOSET" || source === "BOTH") {
    if (closetItems.length > 0) {
      prompt += `AVAILABLE FROM THEIR CLOSET:
${closetItems.map(item => 
  `[${item.id}] ${item.category}: ${item.name || "Unnamed"} - Colors: ${item.colors?.join(", ") || "N/A"} - Style: ${item.styleTags?.join(", ") || "N/A"}`
).join("\n")}

`;
    } else {
      prompt += `NOTE: Customer's closet is empty. Only suggest new pieces.

`;
    }
  }

  const sourceInstructions: Record<string, string> = {
    CLOSET: "ONLY use items from their closet. Do not suggest any new purchases.",
    NAIA: "ONLY suggest new pieces. Do not reference their closet.",
    BOTH: "Mix their existing closet pieces with new suggestions. Prioritize closet items but fill gaps with new pieces."
  };

  prompt += `SOURCE PREFERENCE: ${sourceInstructions[source]}

Create a cohesive outfit that captures the ${mood} mood and ${feelings.join(" + ")} aesthetic. Include:
1. Core outfit pieces (top, bottom OR dress, plus outerwear if appropriate)
2. Shoes that complete the look
3. A bag that works with the outfit
4. 1-2 accessories or jewelry pieces
5. A styling tip for each piece
6. An overall style note
7. A confidence-boosting affirmation
8. Perfume suggestion (type/notes, not specific brand)
9. Hair suggestion
10. Makeup suggestion
11. A "getting ready" song that matches the vibe

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "outfitName": "Creative name for this look",
  "styleNotes": "Overall styling advice for this outfit",
  "confidenceBoost": "An empowering affirmation for wearing this look",
  "perfumeSuggestion": "Type of scent with notes",
  "hairSuggestion": "Hair styling suggestion",
  "makeupSuggestion": "Makeup look suggestion",
  "songSuggestion": "Song title - Artist name",
  "items": [
    {
      "type": "TOP|BOTTOM|DRESS|OUTERWEAR|SHOES|BAG|ACCESSORY|JEWELRY",
      "name": "Item name",
      "description": "Brief description",
      "closetItemId": "ID if from closet, null otherwise",
      "shopifyProductId": null,
      "price": null,
      "stylingTip": "How to style this specific piece"
    }
  ]
}`;

  return prompt;
}

function parseOutfitResponse(response: string, closetItems: any[]): GeneratedOutfit {
  try {
    // Clean the response
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith("```json")) {
      cleanResponse = cleanResponse.slice(7);
    }
    if (cleanResponse.startsWith("```")) {
      cleanResponse = cleanResponse.slice(3);
    }
    if (cleanResponse.endsWith("```")) {
      cleanResponse = cleanResponse.slice(0, -3);
    }
    
    const parsed = JSON.parse(cleanResponse);
    
    // Validate and enrich items
    const items: OutfitItem[] = (parsed.items || []).map((item: any) => {
      const outfitItem: OutfitItem = {
        type: item.type,
        name: item.name,
        description: item.description,
        stylingTip: item.stylingTip
      };
      
      // Link to closet item if referenced
      if (item.closetItemId) {
        const closetItem = closetItems.find(ci => ci.id === item.closetItemId);
        if (closetItem) {
          outfitItem.closetItemId = closetItem.id;
          outfitItem.imageUrl = closetItem.imageUrl;
        }
      }
      
      return outfitItem;
    });
    
    return {
      outfitName: parsed.outfitName || "Your Perfect Look",
      styleNotes: parsed.styleNotes || "",
      confidenceBoost: parsed.confidenceBoost || "You're going to look amazing!",
      perfumeSuggestion: parsed.perfumeSuggestion,
      hairSuggestion: parsed.hairSuggestion,
      makeupSuggestion: parsed.makeupSuggestion,
      songSuggestion: parsed.songSuggestion,
      items
    };
  } catch (error) {
    console.error("Failed to parse outfit response:", error);
    
    // Return a fallback response
    return {
      outfitName: "Your Curated Look",
      styleNotes: "A beautiful outfit curated just for you.",
      confidenceBoost: "You're going to look and feel amazing!",
      items: []
    };
  }
}
