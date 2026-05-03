import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  console.log("Testing outfit save logic...\n");
  
  // Simulate data from frontend
  const closetItems = [
    { id: "123", name: "white top", category: "TOPS" }
  ];
  
  const naiaPiece = {
    title: "Asymmetrical Waist Pants",
    category: "BOTTOMS"
  };
  
  // Test the mapping logic
  const suggestionItems = [];
  
  // Map closet items
  closetItems.forEach(item => {
    let itemType = "TOP";
    const cat = (item.category || "").toUpperCase();
    if (cat.includes("TOP")) itemType = "TOP";
    else if (cat.includes("BOTTOM") || cat.includes("PANT")) itemType = "BOTTOM";
    
    const parsedId = item.id && !isNaN(parseInt(item.id)) ? parseInt(item.id) : null;
    
    console.log("Closet item:", {
      name: item.name,
      category: item.category,
      mappedType: itemType,
      parsedId: parsedId
    });
    
    suggestionItems.push({
      closetItemId: parsedId,
      itemType: itemType,
      productTitle: item.name
    });
  });
  
  // Map nAia piece
  let itemType = "BOTTOM";
  const cat = (naiaPiece.category || "").toUpperCase();
  if (cat.includes("TOP")) itemType = "TOP";
  else if (cat.includes("BOTTOM") || cat.includes("PANT")) itemType = "BOTTOM";
  
  console.log("\nnAia piece:", {
    title: naiaPiece.title,
    category: naiaPiece.category,
    mappedType: itemType
  });
  
  suggestionItems.push({
    productTitle: naiaPiece.title,
    itemType: itemType
  });
  
  console.log("\nFinal items to save:", suggestionItems);
  
  // Try to create a test session
  try {
    const testSession = await prisma.stylingSession.create({
      data: {
        customerId: "test",
        currentMood: "test",
        desiredFeeling: "test",
        occasion: "test",
        styleFrom: "NAIA"
      }
    });
    
    console.log("\nCreated test session:", testSession.id);
    
    // Try to save suggestion
    const suggestion = await prisma.outfitSuggestion.create({
      data: {
        sessionId: testSession.id,
        items: {
          create: suggestionItems
        }
      }
    });
    
    console.log("✅ SUCCESS! Created suggestion:", suggestion.id);
    
    // Clean up
    await prisma.outfitSuggestion.delete({ where: { id: suggestion.id } });
    await prisma.stylingSession.delete({ where: { id: testSession.id } });
    
  } catch (err) {
    console.log("❌ FAILED:", err.message);
  }
  
  await prisma.$disconnect();
}

test();
