import prisma from './app/db.server.js';

const sessions = await prisma.stylingSession.findMany({
  take: 10,
  orderBy: { createdAt: 'desc' },
  select: { id: true, styleDNA: true }
});

sessions.forEach(s => {
  console.log(`Session ${s.id.substring(0,10)}: styleDNA = ${JSON.stringify(s.styleDNA)}`);
});

await prisma.$disconnect();
