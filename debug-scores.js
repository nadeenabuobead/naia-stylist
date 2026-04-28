import prisma from './app/db.server.js';

const sessions = await prisma.stylingSession.findMany({
  take: 20,
  orderBy: { createdAt: 'desc' },
  where: { review: { isNot: null } },
  include: {
    review: true,
    suggestions: { include: { items: true } }
  }
});

const piecePerformance = {};

sessions.forEach(s => {
  const review = s.review;
  s.suggestions.forEach(sug => {
    sug.items.forEach(item => {
      const name = item.productTitle;
      if (!piecePerformance[name]) {
        piecePerformance[name] = { 
          name, 
          ratings: [], 
          feltLikeMe: 0, 
          wouldWear: 0, 
          comfort: 0 
        };
      }
      const piece = piecePerformance[name];
      if (review.overallFeeling) piece.ratings.push(review.overallFeeling);
      if (review.feltLikeHer === "Yes") piece.feltLikeMe += 1;
      if (review.wouldWearAgain === "Definitely") piece.wouldWear += 1;
      if (review.physicalComfort === "Comfortable") piece.comfort += 1;
    });
  });
});

Object.values(piecePerformance).forEach(p => {
  const n = p.ratings.length;
  if (n === 0) return;
  
  const avgRating = p.ratings.reduce((sum, r) => sum + r, 0) / n;
  const ratingScore = ((avgRating - 1) / 4) * 100;
  const styleAlignment = Math.round((p.feltLikeMe / n) * 100);
  const wouldWearPercent = Math.round((p.wouldWear / n) * 100);
  const comfortPercent = Math.round((p.comfort / n) * 100);
  const pieceResponseScore = Math.round(
    0.25 * ratingScore +
    0.25 * styleAlignment +
    0.20 * wouldWearPercent +
    0.15 * comfortPercent
  );
  
  console.log(`\n${p.name}:`);
  console.log(`  Ratings: ${n}`);
  console.log(`  Avg Rating: ${avgRating.toFixed(1)} (score: ${ratingScore.toFixed(0)})`);
  console.log(`  Style Alignment: ${styleAlignment}%`);
  console.log(`  Would Wear: ${wouldWearPercent}%`);
  console.log(`  Comfort: ${comfortPercent}%`);
  console.log(`  Response Score: ${pieceResponseScore}`);
  console.log(`  Qualifies as top? ${pieceResponseScore >= 70 && styleAlignment >= 60 && wouldWearPercent >= 60 ? 'YES' : 'NO'}`);
});

await prisma.$disconnect();
