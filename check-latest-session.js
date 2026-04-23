import prisma from './app/db.server.js';

const latest = await prisma.stylingSession.findFirst({
  orderBy: { createdAt: 'desc' },
  include: {
    review: true,
    suggestions: { include: { items: true } }
  }
});

console.log('Latest session:', latest.id.substring(0, 10));
console.log('Created:', latest.createdAt);
console.log('Has review:', !!latest.review);
console.log('Pieces:');
latest.suggestions.forEach(sug => {
  sug.items.forEach(item => {
    console.log(' -', item.productTitle);
  });
});

await prisma.$disconnect();
