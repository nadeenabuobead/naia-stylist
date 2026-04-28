import prisma from './app/db.server.js';

const reviews = await prisma.postOutfitReview.findMany({
  take: 10,
  orderBy: { createdAt: 'desc' }
});

reviews.forEach(r => {
  console.log(`Review ${r.id.substring(0,10)}: physicalComfort = "${r.physicalComfort}"`);
});

await prisma.$disconnect();
