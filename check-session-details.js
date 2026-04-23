import prisma from './app/db.server.js';

const latest = await prisma.stylingSession.findFirst({
  orderBy: { createdAt: 'desc' }
});

console.log('Session ID:', latest.id.substring(0, 10));
console.log('Occasion field:', latest.occasion);
console.log('specificNeeds (first 200 chars):');
console.log(latest.specificNeeds?.substring(0, 200));

await prisma.$disconnect();
