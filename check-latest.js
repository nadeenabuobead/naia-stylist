import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const s = await p.stylingSession.findFirst({
  orderBy: { createdAt: 'desc' },
  include: { 
    suggestions: { include: { items: true } },
    review: true
  }
});

console.log('Session:', s.id);
console.log('Suggestions:', s.suggestions.length);
if (s.suggestions[0]) {
  console.log('Items:', s.suggestions[0].items.map(i => i.productTitle).join(', '));
}
console.log('Has review:', !!s.review);
if (s.review) {
  console.log('Tags:', s.review.workedTags);
}

await p.$disconnect();
