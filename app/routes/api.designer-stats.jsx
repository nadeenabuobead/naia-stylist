import prisma from "../db.server";


export async function loader() {
  try {
    // Fetch all reviews with sessions and items
    const reviews = await prisma.postOutfitReview.findMany({
      include: {
        session: {
          include: {
            suggestions: {
              include: {
                items: true,
              },
            },
          },
        },
        customer: {
          select: {
            id: true,
            onboardingProfile: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const withBodyPref = reviews.filter(r => r.session?.bodyPreference);
    console.log("DEBUG:", {
      totalReviews: reviews.length,
      withBodyPref: withBodyPref.length,
      firstBodyPref: withBodyPref[0]?.session?.bodyPreference || "none",
      firstStyleDNA: withBodyPref[0]?.session?.styleDNA || "none"
    });
    const totalUsers = await prisma.customer.count();
    const totalLooks = reviews.length;

    if (totalLooks === 0) {
      return Response.json(getEmptyStats(totalUsers));
    }

    // 1. Overview Stats
    const avgRating = reviews.reduce((sum, r) => sum + (r.overallFeeling || 0), 0) / totalLooks;
    const avgAlignment = reviews.filter(r => r.feltLikeHer === "Yes").length / totalLooks;
    const avgRewear = reviews.filter(r => r.wouldWearAgain === "Definitely").length / totalLooks;

    // 2. Piece Performance Analysis
    const pieceStats = {};
    
    reviews.forEach(review => {
      // Get items from the selected suggestion
      const selectedSuggestion = review.session.suggestions.find(
        s => s.id === review.session.selectedSuggestionId
      ) || review.session.suggestions[0];
      
      if (!selectedSuggestion) return;
      
      selectedSuggestion.items.forEach(item => {
        const pieceName = item.productTitle || `Closet Item ${item.closetItemId}`;
        
        if (!pieceStats[pieceName]) {
          pieceStats[pieceName] = {
            name: pieceName,
            category: item.itemType || "Unknown",
            ratings: [],
            rewearYes: 0,
            rewearTotal: 0,
            helpedFeel: [],
            occasions: [],
            styleDNA: [],
            workedTags: [],
            didntWorkTags: [],
            quotes: [],
            confidenceDeltas: [],
            moods: [],
            desiredFeelings: [],
          };
        }
        
        const stats = pieceStats[pieceName];
        
        // Rating
        if (review.overallFeeling) {
          stats.ratings.push(review.overallFeeling);
        }
        
        // Rewear
        stats.rewearTotal++;
        if (review.wouldWearAgain === "Definitely") stats.rewearYes++;
        
        // Emotional outcomes
        if (review.session.desiredFeeling) {
          stats.helpedFeel.push(review.session.desiredFeeling);
        }
        
        // Occasions
        if (review.session.occasion) {
          stats.occasions.push(review.session.occasion);
        }
        
        // Style DNA - try customer profile first, then session
        let styleDNA = review.customer?.onboardingProfile?.styleDNA || review.session.styleDNA;
        if (styleDNA) {
          try {
            const dna = JSON.parse(styleDNA);
            if (Array.isArray(dna)) {
    console.log("Style DNA found:", reviews.map(r => r.session.styleDNA).filter(Boolean));
              stats.styleDNA.push(...dna);
            }
          } catch (e) {
            // Silent fail on parse error
          }
        }
        
        // Tags
        // Tags
        if (review.workedTags) {
          try {
        console.log("Processing review - workedTags:", review.workedTags, "for pieces:", selectedSuggestion.items.map(i => i.productTitle));
            let tags = review.workedTags;
            // Parse if string
            if (typeof tags === 'string') {
              tags = JSON.parse(tags);
            }
            // If array, parse each element if it's a string
            if (Array.isArray(tags)) {
              tags = tags.map(t => typeof t === 'string' ? (t.startsWith('[') ? JSON.parse(t) : t) : t).flat();
              stats.workedTags.push(...tags.filter(Boolean));
              console.log(`Added workedTags to ${pieceName}:`, tags);
            }
          } catch (e) {
            console.error('Failed to parse workedTags:', e);
          }
        }
        
        if (review.didntWorkTags) {
          try {
            let tags = review.didntWorkTags;
            if (typeof tags === 'string') {
              tags = JSON.parse(tags);
            }
            if (Array.isArray(tags)) {
              stats.didntWorkTags.push(...tags);
            } else if (typeof tags === 'string') {
              stats.didntWorkTags.push(tags);
            }
          } catch (e) {
            console.error('Failed to parse didntWorkTags:', e);
          }
        }
        
        // Quotes
        if (review.additionalNotes) {
          stats.quotes.push(review.additionalNotes);
        }
        
        // Confidence
        if (review.confidenceBefore && review.confidenceAfter) {
          stats.confidenceDeltas.push(review.confidenceAfter - review.confidenceBefore);
        }
        
        // Moods
        if (review.session.currentMood) {
          stats.moods.push(review.session.currentMood);
        }
        if (review.session.desiredFeeling) {
          stats.desiredFeelings.push(review.session.desiredFeeling);
        }
      });
    });

    // Calculate piece metrics
    const pieces = Object.values(pieceStats).map(p => {
      const avgRating = p.ratings.length > 0 
        ? p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length 
        : 0;
      const rewear = p.rewearTotal > 0 ? p.rewearYes / p.rewearTotal : 0;
      const ratingCount = p.ratings.length;
      const avgConfidenceBoost = p.confidenceDeltas.length > 0
        ? p.confidenceDeltas.reduce((a, b) => a + b, 0) / p.confidenceDeltas.length
        : 0;
      
      return {
        name: p.name,
        category: p.category,
        avgRating,
        ratingCount,
        rewear,
        helpedFeel: getMostCommon(p.helpedFeel, 3),
        bestOccasions: getMostCommon(p.occasions, 3),
        topDNA: getMostCommon(p.styleDNA, 3),
        positiveComments: getMostCommon(p.workedTags, 3),
        negativeComments: getMostCommon(p.didntWorkTags, 3),
        quotes: p.quotes,
        avgConfidenceBoost,
        startingMoods: getMostCommon(p.moods, 3),
      };
    });

    // 2. Top Performing
    const topPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => p.avgRating >= 4 && p.rewear >= 0.7)
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);

    // 3. Mixed Signal
    const mixedPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => 
        (p.avgRating >= 4 && p.rewear < 0.5) || 
        (p.avgRating < 3.5 && p.rewear >= 0.7)
      )
      .map(p => ({
        ...p,
        reason: p.avgRating >= 4 && p.rewear < 0.5 
          ? "High rating, low rewear - admired but not practical" 
          : "Lower rating but high rewear - functional but not exciting",
        friction: p.negativeComments[0] || "Needs investigation",
      }))
      .slice(0, 10);

    // 4. Underperforming
    const underperformingPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => p.avgRating < 3 || p.rewear < 0.3)
      .map(p => ({
        ...p,
        weakSignals: [
          p.avgRating < 3 ? "low rating" : null,
          p.rewear < 0.3 ? "low rewear intent" : null,
        ].filter(Boolean),
        rejectionReasons: p.negativeComments.slice(0, 3),
      }))
      .sort((a, b) => a.avgRating - b.avgRating)
      .slice(0, 10);

    // 5. Watch
    const watchPieces = pieces
      .filter(p => p.ratingCount > 0 && p.ratingCount < 3)
      .slice(0, 10);

    // 6 & 7. Positive/Negative Tags - built from piece stats
    const tagStats = { positive: {}, negative: {} };
    
    // Collect tags from already-parsed piece stats
    pieces.forEach(piece => {
      // Positive tags
      piece.positiveComments.forEach(tag => {
        if (!tag || tag === '[]') return; // Skip empty
        // Remove JSON formatting if present
        if (typeof tag === 'string' && tag.startsWith('["')) {
          try { tag = JSON.parse(tag)[0]; } catch(e) {}
        }
        if (!tagStats.positive[tag]) {
          tagStats.positive[tag] = { name: tag, count: 0, pieces: [] };
        }
        tagStats.positive[tag].count++;
        tagStats.positive[tag].pieces.push(piece.name);
      });
      
      // Negative tags
      piece.negativeComments.forEach(tag => {
        if (!tag || tag === '[]') return; // Skip empty
        // Remove JSON formatting if present
        if (typeof tag === 'string' && tag.startsWith('["')) {
          try { tag = JSON.parse(tag)[0]; } catch(e) {}
        }
        if (!tagStats.negative[tag]) {
          tagStats.negative[tag] = { name: tag, count: 0, pieces: [] };
        }
        tagStats.negative[tag].count++;
        tagStats.negative[tag].pieces.push(piece.name);
      });
    });
    
    const positiveTags = Object.values(tagStats.positive)
      .map(tag => ({
        name: tag.name,
        count: tag.count,
        topPieces: getMostCommon(tag.pieces, 3),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
      
    const negativeTags = Object.values(tagStats.negative)
      .map(tag => ({
        name: tag.name,
        count: tag.count,
        topPieces: getMostCommon(tag.pieces, 3),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 8. Style DNA Breakdown
    const customers = await prisma.customer.findMany({
      include: { onboardingProfile: true },
    });
    
    const dnaCount = {};
    customers.forEach(c => {
      if (c.onboardingProfile?.styleDNA) {
        try {
          const dnas = JSON.parse(c.onboardingProfile.styleDNA);
          dnas.forEach(dna => {
            dnaCount[dna] = (dnaCount[dna] || 0) + 1;
          });
        } catch {}
      }
    });
    
    const styleDNA = Object.entries(dnaCount)
      .map(([name, count]) => ({
        name,
        count,
        percentage: count / customers.length,
      }))
      .sort((a, b) => b.count - a.count);

    // 9. Pieces by DNA
    const piecesByDNA = pieces
      .filter(p => p.topDNA.length > 0)
      .slice(0, 15);

    // 10. Body Patterns - with piece performance
    const bodyStats = {};
    
    console.log("Body preferences found:", reviews.map(r => r.session.bodyPreference).filter(Boolean));
    reviews.forEach(review => {
      const bodyPref = review.session.bodyPreference;
      if (!bodyPref) return;
      
      if (!bodyStats[bodyPref]) {
        bodyStats[bodyPref] = { count: 0, pieces: {} };
      }
      bodyStats[bodyPref].count++;
      
      // Track piece performance for this body preference
      const selectedSuggestion = review.session.suggestions.find(
        s => s.id === review.session.selectedSuggestionId
      ) || review.session.suggestions[0];
      
      if (selectedSuggestion) {
        selectedSuggestion.items.forEach(item => {
          const pieceName = item.productTitle || `Closet Item ${item.closetItemId}`;
          if (!bodyStats[bodyPref].pieces[pieceName]) {
            bodyStats[bodyPref].pieces[pieceName] = { good: 0, bad: 0 };
          }
          
          // Track if this was a good or bad experience
          if (review.overallFeeling >= 4) {
            bodyStats[bodyPref].pieces[pieceName].good++;
          } else if (review.overallFeeling <= 2) {
            bodyStats[bodyPref].pieces[pieceName].bad++;
          }
        });
      }
    });
    
    const bodyPatterns = Object.entries(bodyStats)
      .map(([preference, data]) => {
        const piecePerformance = Object.entries(data.pieces)
          .map(([name, perf]) => ({ name, ...perf, score: perf.good - perf.bad }))
          .sort((a, b) => b.score - a.score);
        
        return {
          preference,
          userCount: data.count,
          bestPieces: piecePerformance.filter(p => p.score > 0).slice(0, 3).map(p => p.name),
          worstPieces: piecePerformance.filter(p => p.score < 0).slice(-3).reverse().map(p => p.name),
        };
      })
      .sort((a, b) => b.userCount - a.userCount);

    // 11. Styling Needs
    const occasionCount = {};
    reviews.forEach(r => {
      if (r.session.occasion) {
        occasionCount[r.session.occasion] = (occasionCount[r.session.occasion] || 0) + 1;
      }
    });
    
    const stylingNeeds = Object.entries(occasionCount)
      .map(([occasion, count]) => ({ occasion, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 12. Emotional Outcomes
    const emotionalOutcomes = pieces
      .filter(p => p.helpedFeel.length > 0)
      .map(p => ({
        name: p.name,
        emotions: p.helpedFeel,
        startingStates: p.startingMoods,
      }))
      .slice(0, 15);

    // 13. Top Occasions
    const occasionStats = {};
    reviews.forEach(r => {
      if (!r.session.occasion) return;
      if (!occasionStats[r.session.occasion]) {
        occasionStats[r.session.occasion] = { ratings: [], rewear: 0, total: 0 };
      }
      if (r.overallFeeling) occasionStats[r.session.occasion].ratings.push(r.overallFeeling);
      occasionStats[r.session.occasion].total++;
      if (r.wouldWearAgain === "Definitely") occasionStats[r.session.occasion].rewear++;
    });
    
    const topOccasions = Object.entries(occasionStats)
      .map(([name, data]) => ({
        name,
        avgRating: data.ratings.length > 0 
          ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length 
          : 0,
        lookCount: data.total,
        rewear: data.rewear / data.total,
      }))
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);

    // 14. Quotes
    const quotes = pieces
      .flatMap(p => p.quotes.map(q => ({ text: q, piece: p.name })))
      .filter(q => q.text.length > 20)
      .slice(0, 10);


    // Design Actions - aggregate ALL feedback tags from ALL reviews with action logic
    const designActions = [];
    
    // Collect ALL positive and negative tags across all reviews
    const allPositiveTags = [];
    const allNegativeTags = [];
    
    reviews.forEach(review => {
      if (review.workedTags) {
        try {
          let tags = review.workedTags;
          if (typeof tags === 'string') tags = JSON.parse(tags);
          if (Array.isArray(tags)) {
            tags = tags.map(t => typeof t === 'string' ? (t.startsWith('[') ? JSON.parse(t) : t) : t).flat();
            allPositiveTags.push(...tags.filter(Boolean));
          }
        } catch (e) {}
      }
      
      if (review.didntWorkTags) {
        try {
          let tags = review.didntWorkTags;
          if (typeof tags === 'string') tags = JSON.parse(tags);
          if (Array.isArray(tags)) {
            tags = tags.map(t => typeof t === 'string' ? (t.startsWith('[') ? JSON.parse(t) : t) : t).flat();
            allNegativeTags.push(...tags.filter(Boolean));
          }
        } catch (e) {}
      }
    });
    
    const getTopFeedback = (arr, count = 5) => {
      const freq = {};
      arr.forEach(item => {
        if (item && item !== '[]') {
          const clean = item.replace(/[\[\]"]/g, '').trim();
          if (clean) freq[clean] = (freq[clean] || 0) + 1;
        }
      });
      return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, count);
    };
    
    const formatTags = (tags) => tags.map(([tag, count]) => `"${tag}"`).join(', ');
    const formatTagsWithCounts = (tags) => tags.map(([tag, count]) => `"${tag}" x${count}`).join(', ');
    
    const globalPositive = getTopFeedback(allPositiveTags, 5);
    const globalNegative = getTopFeedback(allNegativeTags, 5);
    
    // Action logic based on tags
    const getPositiveAction = (tags, occasions) => {
      if (!tags || tags.length === 0) return null;
      const topTag = tags[0][0].toLowerCase();
      const occ = occasions.slice(0, 2).join('/') || 'styling';
      
      if (topTag.includes('right for the occasion')) return `Create content for ${occ}`;
      if (topTag.includes('easy to imagine')) return `Feature as wearable hero piece in ${occ} content`;
      if (topTag.includes('flattering') || topTag.includes('silhouette')) return `Highlight silhouette in ${occ} styling`;
      if (topTag.includes('proportions')) return `Use as fit reference and preserve proportions`;
      if (topTag.includes('colors')) return `Expand similar colorway`;
      if (topTag.includes('comfortable')) return `Highlight comfort in product copy`;
      if (topTag.includes('polished')) return `Position for elevated ${occ} styling`;
      if (topTag.includes('attractive')) return `Position for date/night out styling`;
      if (topTag.includes('confident')) return `Use in confidence/transformation messaging`;
      if (topTag.includes('felt like me')) return `Feature for style DNA alignment`;
      
      return `Create ${occ} styling content`;
    };
    
    const getNegativeFix = (tags) => {
      if (!tags || tags.length === 0) return null;
      const topTag = tags[0][0].toLowerCase();
      
      if (topTag.includes('clingy')) return "Review fabric, lining, pattern ease. If repeated, test a less clingy fabric or looser cut.";
      if (topTag.includes('uncomfortable')) return "Review comfort, construction, seam placement, fabric weight, or fit.";
      if (topTag.includes('exposed')) return "Adjust neckline, length, transparency, or offer more covered styling.";
      if (topTag.includes('structured')) return "Test softer construction, lighter interfacing, or more fluid fabric.";
      if (topTag.includes('lacked shape')) return "Add waist definition, darts, tailoring, or belt option.";
      if (topTag.includes('plain')) return "Add detail, colorway, texture, or statement pairing.";
      if (topTag.includes('too much')) return "Create toned-down styling or simpler version.";
      if (topTag.includes('hard to wear')) return "Create more wearable styling examples before changing design.";
      if (topTag.includes('wrong for')) return "Reposition for better occasion based on performance.";
      if (topTag.includes('didn\'t create feeling')) return "Reposition emotional styling language or pairing.";
      if (topTag.includes('didn\'t feel like me')) return "Review style DNA match and avoid for this segment.";
      
      return `Monitor "${tags[0][0]}" feedback.`;
    };
    
    // Create actions for each piece
    pieces.forEach(piece => {
      const reviewCount = piece.ratingCount;
      const wouldWear = Math.round(piece.rewear * 100);
      const rating = piece.avgRating;
      
      if (reviewCount === 0) return;
      
      const occasions = piece.bestOccasions || [];
      const occasionText = occasions.slice(0, 2).join(' and ') || 'styling';
      
      // Confidence
      let confidenceBadge, confidenceReason;
      if (reviewCount <= 2) {
        confidenceBadge = "Low Confidence";
        confidenceReason = `only ${reviewCount} review${reviewCount === 1 ? '' : 's'}`;
      } else if (reviewCount <= 4) {
        confidenceBadge = "Early Signal";
        confidenceReason = `${reviewCount} reviews`;
      } else if (reviewCount <= 9) {
        confidenceBadge = "Medium Confidence";
        confidenceReason = `${reviewCount} reviews`;
      } else {
        confidenceBadge = "High Confidence";
        confidenceReason = `${reviewCount} reviews`;
      }
      
      const positiveFeedback = globalPositive.length > 0 ? globalPositive : [];
      const negativeFeedback = globalNegative.length > 0 ? globalNegative : [];
      
      // Build "Why it works"
      let whyItWorks = '';
      if (reviewCount <= 2) {
        whyItWorks = `Initial rating is positive (${rating.toFixed(1)}/5), but only ${reviewCount} review${reviewCount === 1 ? ' is' : 's are'} available.`;
      } else {
        const signal = reviewCount <= 4 ? "Strong early response" : reviewCount <= 9 ? "Good performance" : "Proven performance";
        whyItWorks = `${signal} with ${rating.toFixed(1)}/5 rating and ${wouldWear}% would wear in real life.`;
        if (occasions.length > 0) whyItWorks += ` Best occasion signals are ${occasionText}.`;
      }
      
      if (positiveFeedback.length > 0 && reviewCount >= 3) {
        whyItWorks += ` Positive tags: ${formatTags(positiveFeedback.slice(0, 3))}.`;
      }
      
      // Build "Watch-out"
      let watchOut = '';
      if (reviewCount <= 2) {
        watchOut = "Not enough data yet to identify reliable fit, styling, or production issues.";
      } else if (negativeFeedback.length === 0) {
        watchOut = "No repeated watch-outs yet.";
      } else {
        const count = negativeFeedback[0][1];
        watchOut = `${count} user${count > 1 ? 's' : ''} mentioned "${negativeFeedback[0][0]}."`;
      }
      
      // Primary action
      let action = '';
      if (reviewCount <= 2) {
        action = "Continue gathering feedback";
      } else if (rating >= 4.5 && wouldWear >= 70) {
        action = getPositiveAction(positiveFeedback, occasions) || `Create ${occasionText} styling content`;
      } else {
        action = "Monitor performance";
      }
      
      // Recommended fix
      let recommendedFix = '';
      if (reviewCount <= 2) {
        recommendedFix = "Collect more ratings before deciding whether to feature, adjust, restock, or reposition.";
      } else if (negativeFeedback.length > 0) {
        const fix = getNegativeFix(negativeFeedback);
        if (rating >= 4.5 && wouldWear >= 70) {
          recommendedFix = `Monitor fit and fabric comfort. If repeated, ${fix.toLowerCase()}`;
        } else {
          recommendedFix = fix;
        }
      } else {
        if (reviewCount <= 4) {
          recommendedFix = "Continue gathering feedback to confirm patterns.";
        } else if (reviewCount <= 9) {
          recommendedFix = "Consider featuring in content and increasing availability.";
        } else {
          recommendedFix = "Scale production and feature prominently.";
        }
      }
      
      // Data line
      const posData = positiveFeedback.length > 0 ? `, positive tags: ${formatTags(positiveFeedback.slice(0, 3))}` : '';
      const negData = negativeFeedback.length > 0 ? `, negative tags: ${formatTags(negativeFeedback.slice(0, 2))}` : '';
      
      designActions.push({
        piece: piece.name,
        actionType: "Primary action",
        action,
        confidenceBadge,
        confidenceReason,
        whyItWorks,
        watchOut,
        recommendedFix,
        data: `${reviewCount} reviews, ${rating.toFixed(1)}/5 rating, ${wouldWear}% would wear in real life${posData}${negData}`,
        priority: confidenceBadge
      });
    });
    
    const priorityOrder = { 
      "High Confidence": 1, 
      "Medium Confidence": 2, 
      "Early Signal": 3, 
      "Low Confidence": 4 
    };
    
    designActions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    designActions.splice(8);

    return Response.json({
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
      designActions,
    });

  } catch (error) {
    console.error("Designer stats error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Helper functions
function getMostCommon(arr, limit = 3) {
  const counts = {};
  arr.forEach(item => {
    if (item) counts[item] = (counts[item] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}

function countTags(tags, pieces) {
  const tagCounts = {};
  
  tags.forEach(tag => {
    if (!tag) return;
    if (!tagCounts[tag]) {
      tagCounts[tag] = { name: tag, count: 0, topPieces: [] };
    }
    tagCounts[tag].count++;
  });
  
  return Object.values(tagCounts)
    .sort((a, b) => b.count - a.count);
}

function getEmptyStats(totalUsers) {
  return {
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
  };
}
