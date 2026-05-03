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
            let tags = review.workedTags;
            // Parse if string
            if (typeof tags === 'string') {
              tags = JSON.parse(tags);
            }
            // If array, parse each element if it's a string
            if (Array.isArray(tags)) {
              tags = tags.map(t => typeof t === 'string' ? (t.startsWith('[') ? JSON.parse(t) : t) : t).flat();
              stats.workedTags.push(...tags.filter(Boolean));
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


    // Design Actions - show actual user feedback tags with counts
    const designActions = [];
    const actionsMap = new Map();
    
    const getConfidence = (reviewCount) => {
      if (reviewCount <= 2) return { badge: "Low Confidence", reason: `only ${reviewCount} review${reviewCount === 1 ? '' : 's'} available` };
      if (reviewCount <= 4) return { badge: "Early Signal", reason: `based on ${reviewCount} reviews` };
      if (reviewCount <= 9) return { badge: "Medium Confidence", reason: `based on ${reviewCount} reviews` };
      return { badge: "High Confidence", reason: `based on ${reviewCount} reviews` };
    };
    
    const isBrandOccasion = (occasions) => {
      const elevated = ["date", "night out", "dinner", "event", "formal", "work-to-evening"];
      return occasions.some(occ => elevated.includes(occ.toLowerCase()));
    };
    
    const getContentAction = (occasions) => {
      if (!occasions || occasions.length === 0) return "Create styling content";
      const occ = occasions.map(o => o.toLowerCase());
      const uniqueOcc = [...new Set(occ)].slice(0, 2);
      
      if (uniqueOcc.includes("night out") || uniqueOcc.includes("date")) return `Create ${uniqueOcc.join("/")} styling content`;
      if (uniqueOcc.includes("weekend") && uniqueOcc.includes("errands")) return "Create errands/weekend styling content";
      if (uniqueOcc.includes("errands") && uniqueOcc.includes("travel")) return "Create errands/travel styling content";
      if (uniqueOcc.includes("weekend")) return "Create weekend styling content";
      if (uniqueOcc.includes("errands")) return "Create errands styling content";
      if (uniqueOcc.includes("work")) return "Create work styling content";
      
      return `Create ${uniqueOcc.join("/")} styling content`;
    };
    
    const getTopFeedback = (arr, count = 5) => {
      const freq = {};
      arr.forEach(item => {
        if (item && item !== '[]') {
          const clean = item.replace(/[\[\]"]/g, '').trim();
          if (clean) freq[clean] = (freq[clean] || 0) + 1;
        }
      });
      return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, count);
    };
    
    const formatTagsWithCounts = (tags) => {
      return tags.map(([tag, count]) => `"${tag}" x${count}`).join(', ');
    };
    
    const getDesignAction = (tag) => {
      const lower = tag.toLowerCase();
      if (lower.includes('clingy')) return { type: "Fit action", fix: "review fabric, lining, pattern ease, or test a looser cut" };
      if (lower.includes('uncomfortable')) return { type: "Fit action", fix: "review comfort, construction, seam placement, or fabric" };
      if (lower.includes('exposed')) return { type: "Design action", fix: "adjust neckline, length, or coverage" };
      if (lower.includes('structured')) return { type: "Design action", fix: "test softer construction or more fluid fabric" };
      if (lower.includes('lacked shape')) return { type: "Design action", fix: "add waist definition or stronger silhouette" };
      if (lower.includes('plain')) return { type: "Design action", fix: "add detail, colorway, or statement pairing" };
      if (lower.includes('hard to wear')) return { type: "Content action", fix: "create more wearable styling examples" };
      if (lower.includes('wrong for')) return { type: "Merchandising action", fix: "reposition for better occasion" };
      return { type: "Design action", fix: `address "${tag}" through fit or styling` };
    };
    
    pieces.forEach(piece => {
      const reviewCount = piece.ratingCount;
      const wouldWear = Math.round(piece.rewear * 100);
      const rating = piece.avgRating;
      
      if (reviewCount === 0) return;
      
      const negativeFeedback = getTopFeedback(piece.negativeComments, 5);
      const positiveFeedback = getTopFeedback(piece.positiveComments, 5);
      const occasions = piece.bestOccasions || [];
      const { badge, reason } = getConfidence(reviewCount);
      
      // Build what worked with actual tags
      let whatWorked = '';
      if (positiveFeedback.length > 0) {
        const posTags = formatTagsWithCounts(positiveFeedback.slice(0, 3));
        if (reviewCount <= 2) {
          whatWorked = `Initial positive tags: ${posTags}. Only ${reviewCount} review${reviewCount === 1 ? ' is' : 's are'} available, not enough for production decisions.`;
        } else {
          whatWorked = `Top positive tags: ${posTags}. ${rating.toFixed(1)}/5 rating, ${wouldWear}% would wear in real life`;
          if (occasions.length > 0) whatWorked += ` for ${occasions.slice(0, 2).join(' and ')}`;
          whatWorked += `.`;
        }
      } else {
        whatWorked = `${rating.toFixed(1)}/5 rating, ${wouldWear}% would wear in real life`;
        if (occasions.length > 0) whatWorked += ` for ${occasions.slice(0, 2).join(' and ')}`;
        whatWorked += `.`;
      }
      
      // Build what to watch with actual tags
      let whatToWatch = '';
      if (negativeFeedback.length > 0) {
        const negTags = formatTagsWithCounts(negativeFeedback.slice(0, 2));
        whatToWatch = `Top negative tags: ${negTags}. ${negativeFeedback[0][1]} user${negativeFeedback[0][1] > 1 ? 's' : ''} mentioned "${negativeFeedback[0][0]}."`;
      } else {
        whatToWatch = reviewCount <= 2 ? "Not enough data yet." : "No repeated watch-outs yet.";
      }
      
      // Determine action
      let decision, action, nextStep, actionType;
      
      if (reviewCount <= 2) {
        decision = "Do not act yet";
        action = "Continue gathering feedback";
        actionType = "Recommended action";
        nextStep = "Collect at least 5 ratings before making campaign, restock, or design decisions.";
      } else if (reviewCount <= 4) {
        if (rating >= 4.5 && wouldWear >= 70) {
          const isBrand = isBrandOccasion(occasions);
          decision = isBrand ? "Test in campaign" : "Test in content";
          action = isBrand ? "Test campaign styling" : getContentAction(occasions);
          actionType = "Recommended action";
          
          const occText = occasions.slice(0, 2).join('/');
          nextStep = `Create ${occText || 'styling'} content`;
          if (negativeFeedback.length > 0) {
            const { fix } = getDesignAction(negativeFeedback[0][0]);
            nextStep += `, but monitor fit/fabric. If "${negativeFeedback[0][0]}" repeats, ${fix}.`;
          } else {
            nextStep += ` and gather more feedback.`;
          }
        } else {
          decision = "Monitor";
          action = "Continue gathering feedback";
          actionType = "Recommended action";
          nextStep = "Need more reviews to identify patterns.";
        }
      } else if (reviewCount <= 9) {
        if (rating >= 4.5 && wouldWear >= 70) {
          const isBrand = isBrandOccasion(occasions);
          decision = isBrand ? "Feature in campaign" : "Feature in content";
          action = isBrand ? "Feature in campaign" : "Feature in styling content";
          actionType = negativeFeedback.filter(([t, c]) => c >= 2).length > 0 ? getDesignAction(negativeFeedback[0][0]).type : "Recommended action";
          
          nextStep = `Feature in ${isBrand ? 'campaign' : 'content'}`;
          if (negativeFeedback.filter(([t, c]) => c >= 2).length > 0) {
            const { fix } = getDesignAction(negativeFeedback[0][0]);
            nextStep += `, but ${fix} before scaling production.`;
          } else {
            nextStep += ` and consider increasing availability.`;
          }
        } else {
          decision = "Monitor";
          action = "Gather more data";
          actionType = "Recommended action";
          nextStep = "Continue collecting reviews.";
        }
      } else {
        if (rating >= 4.5 && wouldWear >= 70) {
          decision = "Consider restock";
          action = "Feature and consider production";
          actionType = negativeFeedback.filter(([t, c]) => c >= 3).length > 0 ? getDesignAction(negativeFeedback[0][0]).type : "Recommended action";
          
          nextStep = `Scale production and feature prominently`;
          if (negativeFeedback.filter(([t, c]) => c >= 3).length > 0) {
            const { fix } = getDesignAction(negativeFeedback[0][0]);
            nextStep += `, but ${fix} in next run.`;
          } else {
            nextStep += `.`;
          }
        }
      }
      
      if (decision) {
        const posData = positiveFeedback.length > 0 ? `, positive: ${formatTagsWithCounts(positiveFeedback.slice(0, 3))}` : '';
        const negData = negativeFeedback.length > 0 ? `, negative: ${formatTagsWithCounts(negativeFeedback.slice(0, 2))}` : '';
        
        actionsMap.set(piece.name, {
          piece: piece.name,
          decision,
          actionType,
          action,
          confidenceBadge: badge,
          confidenceReason: reason,
          whatWorked,
          whatToWatch,
          nextStep,
          data: `${reviewCount} reviews · ${rating.toFixed(1)}/5 rating · ${wouldWear}% would wear${posData}${negData}`,
          priority: badge
        });
      }
    });
    
    const priorityOrder = { 
      "High Confidence": 1, 
      "Medium Confidence": 2, 
      "Early Signal": 3, 
      "Low Confidence": 4 
    };
    
    actionsMap.forEach(action => designActions.push(action));
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
