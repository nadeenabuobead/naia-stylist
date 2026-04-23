import prisma from './app/db.server.js';

const sessions = await prisma.stylingSession.findMany({
  take: 5,
  orderBy: { createdAt: 'desc' },
  include: {
    suggestions: { include: { items: true } }
  }
});

sessions.forEach(s => {
  console.log(`Session ${s.id.substring(0,10)} at ${s.createdAt.toISOString()}`);
  s.suggestions.forEach(sug => {
    console.log(`  Suggestion ${sug.id.substring(0,10)} with ${sug.items.length} items`);
    sug.items.forEach(item => console.log(`    - ${item.productTitle}`));
  });
  if (s.suggestions.length === 0) console.log('  No suggestions');
  console.log('');
});

await prisma.$disconnect();
