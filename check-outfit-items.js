import prisma from './app/db.server.js';

async function check() {
  const items = await prisma.outfitItem.findMany({
    take: 10,
    orderBy: { id: 'desc' },
    include: { suggestion: { include: { session: true } } }
  });
  
  console.log(`Found ${items.length} OutfitItem records`);
  items.forEach(item => {
    console.log({
      id: item.id,
      productTitle: item.productTitle,
      shopifyProductId: item.shopifyProductId,
      sessionId: item.suggestion?.sessionId,
      created: item.suggestion?.session?.createdAt
    });
  });
  
  await prisma.$disconnect();
}

check();
