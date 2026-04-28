import prisma from './app/db.server.js';

const sessions = await prisma.stylingSession.findMany({
  take: 10,
  orderBy: { createdAt: 'desc' },
  include: {
    review: true,
    suggestions: { include: { items: true } }
  }
});

sessions.forEach(s => {
  const hasPieces = s.suggestions.some(sug => sug.items.length > 0);
  const hasReview = !!s.review;
  
  if (hasPieces || hasReview) {
    console.log(`Session ${s.id.substring(0,10)} - Pieces: ${hasPieces ? 'YES' : 'NO'}, Review: ${hasReview ? 'YES' : 'NO'}`);
    if (hasPieces) {
      s.suggestions.forEach(sug => {
        sug.items.forEach(item => console.log(`  - ${item.productTitle}`));
      });
    }
    if (hasReview) {
      console.log(`  Review rating: ${s.review.overallFeeling}/5`);
    }
  }
});

await prisma.$disconnect();
