import prisma from "../db.server";

export async function loader() {
  try {
    console.log('Fetching sessions...');
    
    const sessions = await prisma.stylingSession.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        suggestions: {
          include: {
            items: {
              select: {
                productTitle: true,
                shopifyProductId: true,
                itemType: true,
              }
            }
          }
        },
        review: true,
      }
    });

    console.log('Sessions fetched:', sessions.length);

    const reviews = sessions.flatMap(s => s.review ? [s.review] : []);
    
    const totalReviews = reviews.length;
    const totalUsers = await prisma.customer.count();

    const avgFeeling = reviews.reduce((sum, r) => sum + (r.overallFeeling || 0), 0) / totalReviews || 0;
    const feltLikeMe = reviews.filter(r => r.feltLikeHer === "Yes").length;
    const wouldWear = reviews.filter(r => r.wouldWearAgain === "Definitely").length;

    const piecePerformance = {};
    
    sessions.forEach(session => {
      const review = session.review;
      
      session.suggestions?.forEach(sug => {
        sug.items.forEach(item => {
          if (!item.productTitle) return;
          
          const pieceName = item.productTitle;
          
          if (!piecePerformance[pieceName]) {
            piecePerformance[pieceName] = {
              name: pieceName,
              category: item.itemType,
              timesRecommended: 0,
              ratings: [],
              feltLikeMe: 0,
              wouldWear: 0,
              workedTags: {},
              didntWorkTags: {},
              moods: {},
              feelings: {},
              occasions: {},
              bodyPrefs: {},
              quotes: []
            };
          }
          
          const piece = piecePerformance[pieceName];
          piece.timesRecommended += 1;
          
          if (review) {
            if (review.overallFeeling) piece.ratings.push(review.overallFeeling);
            if (review.feltLikeHer === "Yes") piece.feltLikeMe += 1;
            if (review.wouldWearAgain === "Definitely") piece.wouldWear += 1;
            
            if (review.workedTags) {
              try {
                JSON.parse(review.workedTags).forEach(tag => {
                  piece.workedTags[tag] = (piece.workedTags[tag] || 0) + 1;
                });
              } catch {}
            }
            if (review.didntWorkTags) {
              try {
                JSON.parse(review.didntWorkTags).forEach(tag => {
                  piece.didntWorkTags[tag] = (piece.didntWorkTags[tag] || 0) + 1;
                });
              } catch {}
            }
            
            if (session.currentMood) piece.moods[session.currentMood] = (piece.moods[session.currentMood] || 0) + 1;
            if (session.desiredFeeling) piece.feelings[session.desiredFeeling] = (piece.feelings[session.desiredFeeling] || 0) + 1;
            if (session.occasion) piece.occasions[session.occasion] = (piece.occasions[session.occasion] || 0) + 1;
            if (session.bodyPreference) piece.bodyPrefs[session.bodyPreference] = (piece.bodyPrefs[session.bodyPreference] || 0) + 1;
            
            if (review.additionalNotes) piece.quotes.push(review.additionalNotes);
          }
        });
      });
    });

    const pieces = Object.values(piecePerformance).map(piece => {
      const avgRating = piece.ratings.length > 0 
        ? piece.ratings.reduce((sum, r) => sum + r, 0) / piece.ratings.length 
        : 0;
      
      const wouldWearPercent = piece.ratings.length > 0
        ? Math.round((piece.wouldWear / piece.ratings.length) * 100)
        : 0;
        
      const topWorked = Object.entries(piece.workedTags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tag]) => tag);
        
      const topDidntWork = Object.entries(piece.didntWorkTags)
        .filter(([tag]) => tag !== "Everything worked")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tag]) => tag);
        
      const topFeelings = Object.entries(piece.feelings)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([feeling]) => feeling);
        
      const topOccasions = Object.entries(piece.occasions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([occasion]) => occasion);
        
      const topBodyPrefs = Object.entries(piece.bodyPrefs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([pref]) => pref);
      
      return {
        name: piece.name,
        category: piece.category,
        timesRecommended: piece.timesRecommended,
        timesRated: piece.ratings.length,
        avgRating: Math.round(avgRating * 10) / 10,
        wouldWearPercent,
        topWorked,
        topDidntWork,
        topFeelings,
        topOccasions,
        topBodyPrefs,
        quote: piece.quotes[0] || null
      };
    });

    const topPieces = pieces
      .filter(p => p.timesRated > 0)
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);
      
    // Split pieces into performance categories
    const underperformingPieces = pieces
      .filter(p => p.timesRated > 0 && p.avgRating < 3.5)
      .sort((a, b) => a.avgRating - b.avgRating);
      
    const mixedSignalPieces = pieces
      .filter(p => p.timesRated > 1 && p.avgRating >= 3.5 && (
        p.topDidntWork.length > 0 || 
        p.wouldWearPercent < 75
      ))
      .sort((a, b) => a.avgRating - b.avgRating);
      
    const piecesToWatch = pieces
      .filter(p => p.timesRated === 1)
      .sort((a, b) => b.avgRating - a.avgRating);

    const allWorkedTags = {};
    const allDidntWorkTags = {};
    const allBodyPrefs = {};
    const allOccasions = {};
    
    reviews.forEach(r => {
      if (r.workedTags) {
        try {
          JSON.parse(r.workedTags).forEach(tag => {
            allWorkedTags[tag] = (allWorkedTags[tag] || 0) + 1;
          });
        } catch {}
      }
      if (r.didntWorkTags) {
        try {
          JSON.parse(r.didntWorkTags).forEach(tag => {
            allDidntWorkTags[tag] = (allDidntWorkTags[tag] || 0) + 1;
          });
        } catch {}
      }
    });
    
    sessions.forEach(s => {
      if (s.bodyPreference) {
        allBodyPrefs[s.bodyPreference] = (allBodyPrefs[s.bodyPreference] || 0) + 1;
      }
      if (s.occasion) {
        allOccasions[s.occasion] = (allOccasions[s.occasion] || 0) + 1;
      }
    });

    const topWorkedOverall = Object.entries(allWorkedTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => ({ tag, count }));
      
    const topDidntWorkOverall = Object.entries(allDidntWorkTags)
      .filter(([tag]) => tag !== "Everything worked")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => ({ tag, count }));
      
    const topBodyPrefsOverall = Object.entries(allBodyPrefs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([pref, count]) => ({ pref, count }));
      
    const topOccasionsOverall = Object.entries(allOccasions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([occasion, count]) => ({ occasion, count }));

    return Response.json({
      totalReviews,
      totalUsers,
      avgFeeling: Math.round(avgFeeling * 10) / 10,
      feltLikeMePercent: Math.round((feltLikeMe / totalReviews) * 100) || 0,
      wouldWearPercent: Math.round((wouldWear / totalReviews) * 100) || 0,
      topPieces,
      underperformingPieces,
      mixedSignalPieces,
      piecesToWatch,
      topWorkedOverall,
      topDidntWorkOverall,
      topBodyPrefsOverall,
      topOccasionsOverall,
    });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}