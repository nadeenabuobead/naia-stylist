import prisma from './app/db.server.js';

const sessions = await prisma.stylingSession.findMany({
  where: {
    suggestions: {
      some: {
        items: {
          some: {
            productTitle: {
              in: ['Art Blouse', 'Art Panel Tailored Blazer', 'Asymmetrical Waist Pants']
            }
          }
        }
      }
    }
  },
  include: {
    review: true,
    suggestions: { include: { items: true } }
  }
});

console.log('Sessions with nAia pieces:', sessions.length);
sessions.forEach(s => {
  console.log({
    sessionId: s.id,
    created: s.createdAt,
    hasReview: !!s.review,
    reviewRating: s.review?.overallFeeling,
    pieces: s.suggestions.flatMap(sug => sug.items.map(i => i.productTitle))
  });
});

await prisma.$disconnect();
