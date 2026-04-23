import prisma from './app/db.server.js';

const today = new Date();
today.setHours(0, 0, 0, 0);

const sessions = await prisma.stylingSession.findMany({
  where: {
    createdAt: { gte: today }
  },
  include: {
    review: true,
    suggestions: { include: { items: true } }
  },
  orderBy: { createdAt: 'desc' }
});

console.log('Today sessions:', sessions.length);
sessions.forEach(s => {
  const pieces = s.suggestions.flatMap(sug => sug.items.map(i => i.productTitle)).filter(Boolean);
  console.log({
    sessionId: s.id.substring(0, 10),
    created: s.createdAt.toISOString().substring(11, 19),
    hasReview: !!s.review,
    rating: s.review?.overallFeeling,
    naiaPieces: pieces.length,
    pieces: pieces
  });
});

await prisma.$disconnect();
