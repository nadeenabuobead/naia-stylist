import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ history: [], authenticated: false }, { headers: CORS });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  const sessions = await prisma.stylingSession.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const history = sessions.map(session => ({
    id: session.id,
    createdAt: session.createdAt,
    mood: session.currentMood,
    feeling: session.desiredFeeling,
    event: session.occasion,
    result: session.specificNeeds || null,
  }));

  return Response.json({ history, authenticated: true }, { headers: CORS });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }

  try {
    const body = await request.json();
    const { mood, feeling, event, result, styleWords, bodyPref, closetItemIds, naiaPiece, closetItems } = body;
    console.log("OUTFIT-HISTORY DEBUG:", JSON.stringify({ hasClosetItems: !!closetItems, hasNaiaPiece: !!naiaPiece, closetItemsLength: closetItems?.length, naiaPieceTitle: naiaPiece?.title }));
  console.log("Outfit history received:", { hasClosetItems: !!closetItems, hasNaiaPiece: !!naiaPiece, closetItems, naiaPiece });

    const session = await prisma.stylingSession.create({
      data: {
        customerId: customer.id,
        currentMood: mood || "",
        desiredFeeling: feeling || "",
        occasion: event || "",
        specificNeeds: result || null,
        styleFrom: "NAIA",
        bodyPreference: bodyPref || null,
        styleDNA: styleWords ? JSON.stringify(styleWords) : null,
      },
    });
    
    // Save the outfit items as a suggestion
    if (closetItems || naiaPiece) {
      console.log("SAVING SUGGESTIONS - closetItems:", closetItems, "naiaPiece:", naiaPiece);
      try {
        const suggestionItems = [];
        
        // Add closet items
        if (closetItems && Array.isArray(closetItems)) {
          closetItems.forEach(item => {
            // Map category to valid OutfitItemType enum
            let itemType = "TOP"; // default
            const cat = (item.category || "").toUpperCase();
            if (cat.includes("TOP") || cat.includes("SHIRT") || cat.includes("BLOUSE")) itemType = "TOP";
            else if (cat.includes("BOTTOM") || cat.includes("PANT") || cat.includes("JEAN") || cat.includes("SKIRT")) itemType = "BOTTOM";
            else if (cat.includes("DRESS")) itemType = "DRESS";
            else if (cat.includes("OUTERWEAR") || cat.includes("JACKET") || cat.includes("COAT") || cat.includes("BLAZER")) itemType = "OUTERWEAR";
            else if (cat.includes("SHOE") || cat.includes("BOOT") || cat.includes("SNEAKER")) itemType = "SHOES";
            else if (cat.includes("BAG") || cat.includes("PURSE") || cat.includes("TOTE")) itemType = "BAG";
            else if (cat.includes("JEWELRY") || cat.includes("NECKLACE") || cat.includes("EARRING")) itemType = "JEWELRY";
            else if (cat.includes("ACCESSORY") || cat.includes("SCARF") || cat.includes("HAT")) itemType = "ACCESSORY";
            
            suggestionItems.push({
              closetItemId: item.id && !isNaN(parseInt(item.id)) ? parseInt(item.id) : null,
              itemType: itemType,
              productTitle: item.name
            });
          });
        }
        
        // Add nAia piece
        if (naiaPiece && naiaPiece.title) {
          // Map nAia category to valid enum
          let itemType = "TOP"; // default
          const cat = (naiaPiece.category || "").toUpperCase();
          if (cat.includes("TOP") || cat.includes("SHIRT") || cat.includes("BLOUSE")) itemType = "TOP";
          else if (cat.includes("BOTTOM") || cat.includes("PANT") || cat.includes("JEAN") || cat.includes("SKIRT")) itemType = "BOTTOM";
          else if (cat.includes("DRESS")) itemType = "DRESS";
          else if (cat.includes("OUTERWEAR") || cat.includes("JACKET") || cat.includes("COAT")) itemType = "OUTERWEAR";
          else if (cat.includes("SHOE")) itemType = "SHOES";
          else if (cat.includes("BAG")) itemType = "BAG";
          
          suggestionItems.push({
            productTitle: naiaPiece.title,
            itemType: itemType
          });
        }
        
        // Create suggestion with items
        if (suggestionItems.length > 0) {
          const suggestion = await prisma.outfitSuggestion.create({
            data: {
              sessionId: session.id,
              items: {
                create: suggestionItems
              }
            }
          });
          
          // Set as selected suggestion
          await prisma.stylingSession.update({
            where: { id: session.id },
            data: { selectedSuggestionId: suggestion.id }
          });
          
          console.log(`Created suggestion ${suggestion.id} with ${suggestionItems.length} items`);
        }
      } catch (err) {
        console.error("Failed to save suggestions:", err);
      }
    }

    const sessions = await prisma.stylingSession.findMany({
  where: { customerId: customer.id },
  orderBy: { createdAt: "desc" },
  take: 1,
});
return Response.json({ ok: true, entry: { id: session.id } }, { headers: CORS });
  } catch (err) {
    console.error("History save error:", err);
    return Response.json({ error: "Failed to save" }, { status: 500, headers: CORS });
  }
}