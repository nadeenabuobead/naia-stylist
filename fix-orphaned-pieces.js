import prisma from './app/db.server.js';

// Find all sessions WITH pieces but NO reviews
const sessionsWithPieces = await prisma.stylingSession.findMany({
  where: { 
    review: null,
    suggestions: { some: { items: { some: {} } } }
  },
  include: { 
    suggestions: { include: { items: true } },
    customer: true
  },
  orderBy: { createdAt: 'asc' }
});

console.log(`Found ${sessionsWithPieces.length} sessions with pieces but no reviews`);

// For each orphaned session, find the matching reviewed session
for (const orphan of sessionsWithPieces) {
  // Find the next session by same customer within 2 seconds
  const reviewed = await prisma.stylingSession.findFirst({
    where: {
      customerId: orphan.customerId,
      createdAt: { 
        gt: orphan.createdAt,
        lt: new Date(orphan.createdAt.getTime() + 2000)
      },
      review: { isNot: null }
    },
    include: { review: true }
  });

  if (reviewed) {
    console.log(`Linking pieces from ${orphan.id.substring(0,10)} to reviewed session ${reviewed.id.substring(0,10)}`);
    
    // Move the review to the orphaned session (which has the pieces)
    await prisma.postOutfitReview.update({
      where: { id: reviewed.review.id },
      data: { sessionId: orphan.id }
    });
    
    // Delete the duplicate session
    await prisma.stylingSession.delete({
      where: { id: reviewed.id }
    });
  }
}

console.log('Done! Check dashboard now.');
await prisma.$disconnect();
