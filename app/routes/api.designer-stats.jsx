import { json } from "@remix-run/node";
import { prisma } from "~/lib/prisma.server";

export async function loader() {
  try {
    // Fetch all outfit ratings with related data
    const ratings = await prisma.outfitRating.findMany({
      include: {
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalUsers = await prisma.customer.count();
    const totalLooks = ratings.length;

    if (totalLooks === 0) {
      return json({
        totalUsers,
        totalLooks: 0,
        avgRating: 0,
        avgAlignment: 0,
        avgRewear: 0,
        topPieces: [],
        mixedPieces: [],
        underperformingPieces: [],
        watchPieces: [],
        positiveTags: [],
        negativeTags: [],
        styleDNA: [],
        piecesByDNA: [],
        bodyPatterns: [],
        stylingNeeds: [],
        emotionalOutcomes: [],
        topOccasions: [],
        quotes: [],
      });
    }

    // 1. Overview Stats
    const avgRating = ratings.reduce((sum, r) => sum + (r.rating || 0), 0) / totalLooks;
    const avgAlignment = ratings.filter(r => r.feltLikeMe === "yes").length / totalLooks;
    const avgRewear = ratings.filter(r => r.wouldWearAgain === "yes").length / totalLooks;

    // 2. Piece Performance Analysis
    const pieceStats = {};
    
    ratings.forEach(rating => {
      // Parse pieces from the rating (assuming they're stored in a pieces field or similar)
      const pieces = rating.pieces || []; // Adjust based on your schema
      
      pieces.forEach(piece => {
        if (!pieceStats[piece.name]) {
          pieceStats[piece.name] = {
            name: piece.name,
            category: piece.category || "Unknown",
            ratings: [],
            rewearYes: 0,
            rewearNo: 0,
            helpedFeel: [],
            occasions: [],
            styleDNA: [],
            positiveComments: [],
            negativeComments: [],
          };
        }
        
        const stats = pieceStats[piece.name];
        stats.ratings.push(rating.rating || 0);
        
        if (rating.wouldWearAgain === "yes") stats.rewearYes++;
        else if (rating.wouldWearAgain === "no") stats.rewearNo++;
        
        if (rating.helpedFeel) stats.helpedFeel.push(rating.helpedFeel);
        if (rating.occasion) stats.occasions.push(rating.occasion);
        if (rating.customer?.styleDNA) stats.styleDNA.push(rating.customer.styleDNA);
        if (rating.whatWorked) stats.positiveComments.push(rating.whatWorked);
        if (rating.whatDidntWork) stats.negativeComments.push(rating.whatDidntWork);
      });
    });

    // Calculate piece metrics
    const pieces = Object.values(pieceStats).map(p => {
      const avgRating = p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length;
      const rewear = p.rewearYes / (p.rewearYes + p.rewearNo);
      const ratingCount = p.ratings.length;
      
      return {
        name: p.name,
        category: p.category,
        avgRating,
        ratingCount,
        rewear,
        helpedFeel: [...new Set(p.helpedFeel)].slice(0, 3),
        bestOccasions: getMostCommon(p.occasions, 3),
        topDNA: getMostCommon(p.styleDNA, 3),
        positiveComments: p.positiveComments,
        negativeComments: p.negativeComments,
      };
    });

    // 2. Top Performing (high rating + high rewear + enough data)
    const topPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => p.avgRating >= 4 && p.rewear >= 0.7)
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);

    // 3. Mixed Signal (high rating but low rewear, or vice versa)
    const mixedPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => 
        (p.avgRating >= 4 && p.rewear < 0.5) || 
        (p.avgRating < 3 && p.rewear >= 0.7)
      )
      .map(p => ({
        ...p,
        reason: p.avgRating >= 4 && p.rewear < 0.5 
          ? "High rating, low rewear" 
          : "Admired but not practical",
        friction: p.negativeComments[0] || "Unknown friction point",
      }))
      .slice(0, 10);

    // 4. Underperforming (low rating + low rewear)
    const underperformingPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => p.avgRating < 3 || p.rewear < 0.3)
      .map(p => ({
        ...p,
        weakSignals: [
          p.avgRating < 3 ? "low rating" : null,
          p.rewear < 0.3 ? "low rewear" : null,
        ].filter(Boolean),
        rejectionReasons: p.negativeComments.slice(0, 3),
      }))
      .slice(0, 10);

    // 5. Watch (not enough data)
    const watchPieces = pieces
      .filter(p => p.ratingCount < 3)
      .slice(0, 10);

    // 6 & 7. Positive/Negative Tags
    const allPositive = ratings.flatMap(r => r.whatWorked || "").filter(Boolean);
    const allNegative = ratings.flatMap(r => r.whatDidntWork || "").filter(Boolean);
    
    const positiveTags = countTags(allPositive, pieces);
    const negativeTags = countTags(allNegative, pieces);

    // 8. Style DNA Breakdown
    const dnaCount = {};
    const customers = await prisma.customer.findMany({ select: { styleDNA: true } });
    customers.forEach(c => {
      if (c.styleDNA) {
        dnaCount[c.styleDNA] = (dnaCount[c.styleDNA] || 0) + 1;
      }
    });
    
    const styleDNA = Object.entries(dnaCount).map(([name, count]) => ({
      name,
      count,
      percentage: count / customers.length,
    })).sort((a, b) => b.count - a.count);

    // 9. Pieces by DNA
    const piecesByDNA = pieces
      .filter(p => p.topDNA.length > 0)
      .slice(0, 15);

    // 10. Body Patterns
    const bodyPrefs = {};
    ratings.forEach(r => {
      if (r.bodyPreference) {
        if (!bodyPrefs[r.bodyPreference]) {
          bodyPrefs[r.bodyPreference] = { count: 0, pieces: [] };
        }
        bodyPrefs[r.bodyPreference].count++;
        // Track which pieces worked for this body pref
      }
    });
    
    const bodyPatterns = Object.entries(bodyPrefs).map(([pref, data]) => ({
      preference: pref,
      userCount: data.count,
      bestPieces: [], // Would need more logic
      worstPieces: [],
    }));

    // 11. Styling Needs
    const occasionCount = {};
    ratings.forEach(r => {
      if (r.occasion) {
        occasionCount[r.occasion] = (occasionCount[r.occasion] || 0) + 1;
      }
    });
    
    const stylingNeeds = Object.entries(occasionCount)
      .map(([occasion, count]) => ({ occasion, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 12. Emotional Outcomes
    const emotionalOutcomes = pieces
      .filter(p => p.helpedFeel.length > 0)
      .slice(0, 15);

    // 13. Top Occasions
    const occasionStats = {};
    ratings.forEach(r => {
      if (!r.occasion) return;
      if (!occasionStats[r.occasion]) {
        occasionStats[r.occasion] = { ratings: [], rewear: 0, total: 0 };
      }
      occasionStats[r.occasion].ratings.push(r.rating || 0);
      occasionStats[r.occasion].total++;
      if (r.wouldWearAgain === "yes") occasionStats[r.occasion].rewear++;
    });
    
    const topOccasions = Object.entries(occasionStats)
      .map(([name, data]) => ({
        name,
        avgRating: data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length,
        lookCount: data.total,
        rewear: data.rewear / data.total,
      }))
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);

    // 14. Quotes
    const quotes = ratings
      .filter(r => r.comments && r.comments.length > 20)
      .map(r => ({
        text: r.comments,
        piece: r.pieces?.[0]?.name || null,
      }))
      .slice(0, 10);

    return json({
      totalUsers,
      totalLooks,
      avgRating,
      avgAlignment,
      avgRewear,
      topPieces,
      mixedPieces,
      underperformingPieces,
      watchPieces,
      positiveTags,
      negativeTags,
      styleDNA,
      piecesByDNA,
      bodyPatterns,
      stylingNeeds,
      emotionalOutcomes,
      topOccasions,
      quotes,
    });

  } catch (error) {
    console.error("Designer stats error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}

// Helper functions
function getMostCommon(arr, limit = 3) {
  const counts = {};
  arr.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}

function countTags(comments, pieces) {
  const tags = {};
  
  // Simple keyword extraction (you'd want better NLP here)
  const keywords = ["flattering", "comfortable", "structured", "loose", "tight", "elegant", "casual"];
  
  comments.forEach(comment => {
    keywords.forEach(keyword => {
      if (comment.toLowerCase().includes(keyword)) {
        if (!tags[keyword]) {
          tags[keyword] = { name: keyword, count: 0, topPieces: [] };
        }
        tags[keyword].count++;
      }
    });
  });
  
  return Object.values(tags)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
