import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  console.log("Starting migration...");
  
  // Get all reviews with tags
  const reviews = await prisma.postOutfitReview.findMany({
    where: {
      OR: [
        { workedTags: { not: null } },
        { didntWorkTags: { not: null } }
      ]
    },
    include: {
      session: true
    }
  });
  
  console.log(`Found ${reviews.length} reviews with tags`);
  
  for (const review of reviews) {
    console.log(`\nProcessing review ${review.id} for session ${review.sessionId}`);
    
    // Check if session already has suggestions
    const existingSuggestions = await prisma.outfitSuggestion.findMany({
      where: { sessionId: review.sessionId }
    });
    
    if (existingSuggestions.length > 0) {
      console.log(`  ✓ Session already has ${existingSuggestions.length} suggestions, skipping`);
      continue;
    }
    
    // Parse the AI result to extract products
    const result = review.session.specificNeeds;
    if (!result) {
      console.log(`  ✗ No AI result text found`);
      continue;
    }
    
    // Extract products from "Your outfit direction" section
    const outfitMatch = result.match(/Your outfit direction\s*([\s\S]*?)(?:\n\nWhy this works|$)/i);
    if (!outfitMatch) {
      console.log(`  ✗ No outfit direction section found`);
      continue;
    }
    
    // Extract bullet points
    const outfitSection = outfitMatch[1];
    const items = outfitSection
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line.length > 0);
    
    if (items.length === 0) {
      console.log(`  ✗ No items found in outfit direction`);
      continue;
    }
    
    console.log(`  Found items: ${items.join(', ')}`);
    
    // Create suggestion with items
    try {
      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId: review.sessionId,
          items: {
            create: items.map(productTitle => ({
              productTitle: productTitle,
              itemType: "clothing"
            }))
          }
        }
      });
      
      // Update session to mark this as selected
      await prisma.stylingSession.update({
        where: { id: review.sessionId },
        data: { selectedSuggestionId: suggestion.id }
      });
      
      console.log(`  ✓ Created suggestion with ${items.length} items`);
    } catch (err) {
      console.log(`  ✗ Error creating suggestion:`, err.message);
    }
  }
  
  console.log("\nMigration complete!");
  await prisma.$disconnect();
}

migrate().catch(console.error);
