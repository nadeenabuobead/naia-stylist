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
    
    // Extract product names from bold markdown (**Product Name**)
    const productMatches = result.match(/\*\*([^*]+)\*\*/g) || [];
    const products = productMatches
      .map(m => m.replace(/\*\*/g, '').trim())
      .filter(p => p.length > 0 && !p.toLowerCase().includes('how to style'));
    
    if (products.length === 0) {
      console.log(`  ✗ No products found in result`);
      continue;
    }
    
    console.log(`  Found products: ${products.join(', ')}`);
    
    // Create suggestion with items
    try {
      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId: review.sessionId,
          items: {
            create: products.map(productTitle => ({
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
      
      console.log(`  ✓ Created suggestion with ${products.length} items`);
    } catch (err) {
      console.log(`  ✗ Error creating suggestion:`, err.message);
    }
  }
  
  console.log("\nMigration complete!");
  await prisma.$disconnect();
}

migrate().catch(console.error);
