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
              comfort: 0,
              workedTags: {},
              didntWorkTags: {},
              moods: {},
              feelings: {},
              occasions: {},
              bodyPrefs: {},
              styleDNA: {},
              quotes: []
            };
          }
          
          const piece = piecePerformance[pieceName];
          piece.timesRecommended += 1;
          
          if (review) {
            if (review.overallFeeling) piece.ratings.push(review.overallFeeling);
            if (review.feltLikeHer === "Yes") piece.feltLikeMe += 1;
            if (review.wouldWearAgain === "Definitely") piece.wouldWear += 1;
            if (review.physicalComfort === "Comfortable") piece.comfort += 1;
            
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
            if (session.styleDNA) {
              const dnas = Array.isArray(session.styleDNA) ? session.styleDNA : JSON.parse(session.styleDNA || "[]");
              dnas.forEach(dna => {
                piece.styleDNA[dna] = (piece.styleDNA[dna] || 0) + 1;
              });
            }
            
            if (review.additionalNotes) piece.quotes.push(review.additionalNotes);
          }
        });
    });
      });
    const pieces = Object.values(piecePerformance).map(piece => {
      const numRatings = piece.ratings.length;
      
      // Calculate normalized scores (0-100)
      const avgRating = numRatings > 0 
        ? piece.ratings.reduce((sum, r) => sum + r, 0) / numRatings 
        : 0;
      const ratingScore = ((avgRating - 1) / 4) * 100;
      
      const styleAlignment = numRatings > 0
        ? Math.round((piece.feltLikeMe / numRatings) * 100)
        : 0;
      
      const wouldWearPercent = numRatings > 0
        ? Math.round((piece.wouldWear / numRatings) * 100)
        : 0;
        
      const comfortPercent = numRatings > 0
        ? Math.round((piece.comfort / numRatings) * 100)
        : 0;
      
      // Calculate positive feedback score (simplified version)
      const totalPositiveTags = Object.values(piece.workedTags).reduce((sum, count) => sum + count, 0);
      const positiveFeedbackScore = numRatings > 0 ? Math.min(100, (totalPositiveTags / numRatings) * 25) : 0;
      
      // Calculate negative feedback score
      const totalNegativeTags = Object.values(piece.didntWorkTags).reduce((sum, count) => sum + count, 0);
      const negativeFeedbackScore = numRatings > 0 ? Math.min(100, (totalNegativeTags / numRatings) * 25) : 0;
      
      // Calculate Piece Response Score
      const pieceResponseScore = Math.round(
        0.25 * ratingScore +
        0.25 * styleAlignment +
        0.20 * wouldWearPercent +
        0.15 * comfortPercent +
        0.10 * positiveFeedbackScore -
        0.15 * negativeFeedbackScore
      );
      
      // Classify piece
      let classification = 'underperforming';
      let classificationReason = '';
      
      if (numRatings < 2) {
        classification = 'to_watch';
        classificationReason = 'Too little data';
      } else if (
        pieceResponseScore >= 55 &&
        styleAlignment >= 50 &&
        wouldWearPercent >= 50
      ) {
        classification = 'top_performing';
        classificationReason = 'Strong across all metrics';
      } else if (
        (pieceResponseScore >= 50 && pieceResponseScore < 70) ||
        (ratingScore >= 75 && wouldWearPercent < 60) ||
        (ratingScore >= 75 && comfortPercent < 60) ||
        (styleAlignment >= 60 && negativeFeedbackScore >= 35)
      ) {
        classification = 'mixed_signal';
        if (ratingScore >= 75 && wouldWearPercent < 60) {
          classificationReason = 'High rating but low would-wear-again';
        } else if (ratingScore >= 75 && comfortPercent < 60) {
          classificationReason = 'High rating but comfort issues';
        } else {
          classificationReason = 'Good response but needs attention';
        }
      } else {
        classification = 'underperforming';
        classificationReason = 'Weak response across metrics';
      }
        
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
        timesRated: numRatings,
        avgRating: Math.round(avgRating * 10) / 10,
        styleAlignment,
        wouldWearPercent,
        comfortPercent,
        pieceResponseScore,
        classification,
        classificationReason,
        topWorked,
        topDidntWork,
        topFeelings,
        topOccasions,
        topBodyPrefs,
        topStyleDNA,
        quote: piece.quotes[0] || null
      };
    });


    const topPieces = pieces
      .filter(p => p.classification === "top_performing")
      .sort((a, b) => b.pieceResponseScore - a.pieceResponseScore)
      .slice(0, 10);
      
    const underperformingPieces = pieces
      .filter(p => p.classification === "underperforming")
      .sort((a, b) => a.pieceResponseScore - b.pieceResponseScore);
      
    const mixedSignalPieces = pieces
      .filter(p => p.classification === "mixed_signal")
      .sort((a, b) => a.pieceResponseScore - b.pieceResponseScore);
      
    const piecesToWatch = pieces
      .filter(p => p.classification === "to_watch")
      .sort((a, b) => b.avgRating - a.avgRating);

    const allWorkedTags = {};
    const allDidntWorkTags = {};
    const allBodyPrefs = {};
    const allOccasions = {};
    const allStyleDNA = {};
    
    const tagToPieces = {};
    const didntWorkTagToPieces = {};
    reviews.forEach(r => {
      if (r.workedTags) {
        try {
          JSON.parse(r.workedTags).forEach(tag => {
            allWorkedTags[tag] = (allWorkedTags[tag] || 0) + 1;
          });
        } catch {}
        }
        // Track which pieces had this tag
        const sessionPieces = sessions.find(s => s.id === r.sessionId)?.suggestions?.flatMap(sug => sug.items.map(i => i.productTitle)) || [];
        if (r.workedTags) {
          try {
            JSON.parse(r.workedTags).forEach(tag => {
              if (!tagToPieces[tag]) tagToPieces[tag] = {};
              sessionPieces.forEach(piece => {
                tagToPieces[tag][piece] = (tagToPieces[tag][piece] || 0) + 1;
              });
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
        try {
          JSON.parse(r.didntWorkTags).forEach(tag => {
            if (!didntWorkTagToPieces[tag]) didntWorkTagToPieces[tag] = {};
            sessionPieces.forEach(piece => {
              didntWorkTagToPieces[tag][piece] = (didntWorkTagToPieces[tag][piece] || 0) + 1;
            });
          });
        } catch {}
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
    const topWorkedOverall = Object.entries(allWorkedTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => {
        const topPieces = Object.entries(tagToPieces[tag] || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([piece, count]) => ({ piece, count }));
        return { tag, count, topPieces };
      });
    const topDidntWorkOverall = Object.entries(allDidntWorkTags)
    const topDidntWorkOverall = Object.entries(allDidntWorkTags)
      .filter(([tag]) => tag !== "Everything worked")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count]) => {
        const topPieces = Object.entries(didntWorkTagToPieces[tag] || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([piece, count]) => ({ piece, count }));
        return { tag, count, topPieces };
      });
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
      topStyleDNAOverall,
    });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}