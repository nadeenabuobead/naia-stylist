import prisma from './app/db.server.js';

const session = await prisma.stylingSession.findUnique({
  where: { id: 'cmo782fni0002jo04m9cnx0s2' },
  include: {
    review: true,
    suggestions: { include: { items: true } }
  }
});

console.log('Session:', session.id);
console.log('Created:', session.createdAt);
console.log('Has review:', !!session.review);
console.log('Pieces:', session.suggestions.flatMap(s => s.items.map(i => i.productTitle)));

if (session.review) {
  console.log('Review rating:', session.review.overallFeeling);
}

await prisma.$disconnect();
