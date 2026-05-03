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
        category: (() => {
          const n = p.name.toLowerCase();
          if (n.includes('pant') || n.includes('trouser')) return 'Pants';
          if (n.includes('jacket') || n.includes('blazer') || n.includes('coat')) return 'Outerwear';
          if (n.includes('dress')) return 'Dress';
          if (n.includes('skirt')) return 'Skirt';
          if (n.includes('top') || n.includes('shirt') || n.includes('blouse')) return 'Top';
          return p.category || 'Clothing';
        })(),
        avgRating,
        ratingCount,
        rewear,
        helpedFeel: getMostCommon(p.helpedFeel, 3),
        bestOccasions: getMostCommon(p.occasions, 3),
        topDNA: getMostCommon(p.styleDNA, 3),
        positiveComments: getMostCommon(p.workedTags, 3),
        negativeComments: (() => {
          const freq = {};
          p.didntWorkTags.forEach(item => {
            if (item && item !== '[]') {
              const clean = item.replace(/[\[\]"]/g, '').trim();
              if (clean) freq[clean] = (freq[clean] || 0) + 1;
            }
          });
          return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tag, count]) => `${tag} x${count}`);
        })(),
        quotes: p.quotes,
        avgConfidenceBoost,
        startingMoods: getMostCommon(p.moods, 3),
      };
    });

    // 2. Top Performing (nAia products only, exclude closet items)
    const topPieces = pieces
      .filter(p => p.ratingCount >= 3)
      .filter(p => {
        // Exclude common closet item names
        const name = p.name.toLowerCase();
        return !name.includes('white top') && 
               !name.includes('black top') && 
               !name.includes('jeans') &&
               !name.includes('your ') &&
               name !== 'top' &&
               name !== 'bottom' &&
               name !== 'dress';
      })
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
        // Get all reviews from users with this preference (bodyPreference is on session)
        const preferenceSessions = reviews.filter(r => r.session?.bodyPreference === preference);
        
        // Track piece performance for this preference
        const pieceStats = {};
        
        preferenceSessions.forEach(review => {
          if (review.session.suggestions && review.session.suggestions.length > 0) {
            const suggestion = review.session.suggestions[0];
            if (suggestion.items) {
              suggestion.items.forEach(item => {
                // Exclude closet items
                const nameLower = item.productTitle.toLowerCase();
                if (nameLower.includes('white top') || 
                    nameLower.includes('black top') || 
                    nameLower.includes('your ') ||
                    nameLower === 'top' ||
                    nameLower === 'bottom') {
                  return;
                }
                
                if (!pieceStats[item.productTitle]) {
                  pieceStats[item.productTitle] = {
                    name: item.productTitle,
                    goodCount: 0,
                    badCount: 0,
                    totalRatings: 0,
                    avgRating: 0,
                    wouldWear: 0,
                    wouldWearCount: 0
                  };
                }
                
                const stats = pieceStats[item.productTitle];
                
                if (review.rating) {
                  stats.totalRatings++;
                  stats.avgRating = ((stats.avgRating * (stats.totalRatings - 1)) + review.rating) / stats.totalRatings;
                  
                  // Good = high rating + would wear
                  if (review.rating >= 4 && review.wouldWearAgain) {
                    stats.goodCount++;
                  }
                  // Bad = low rating or wouldn't wear
                  if (review.rating < 3 || review.wouldWearAgain === false) {
                    stats.badCount++;
                  }
                }
                
                if (review.wouldWearAgain !== null) {
                  stats.wouldWear += review.wouldWearAgain ? 1 : 0;
                  stats.wouldWearCount++;
                }
              });
            }
          }
        });
        
        // Calculate score for each piece (good performance - bad performance)
        const rankedPieces = Object.values(pieceStats)
          .filter(p => p.totalRatings >= 1)
          .map(p => ({
            ...p,
            score: p.goodCount - p.badCount,
            wearRate: p.wouldWearCount > 0 ? p.wouldWear / p.wouldWearCount : 0
          }))
          .sort((a, b) => b.score - a.score);
        
        // Get fit concerns
        const struggles = [];
        preferenceSessions.forEach(r => {
          if (r.didntWorkTags) {
            try {
              const tags = JSON.parse(r.didntWorkTags);
              tags.forEach(tag => {
                if (tag.toLowerCase().includes('clingy') ||
                    tag.toLowerCase().includes('tight') ||
                    tag.toLowerCase().includes('loose') ||
                    tag.toLowerCase().includes('uncomfortable') ||
                    tag.toLowerCase().includes('exposed')) {
                  struggles.push(tag);
                }
              });
            } catch (e) {}
          }
        });
        
        const uniqueStruggles = [...new Set(struggles)];
        
        // Design implication - adjust confidence based on sample size
        let implication = '';
        const prefLower = preference.toLowerCase();
        const userCount = data.count;
        
        if (userCount === 1) {
          implication = 'Early directional signal only. Continue collecting feedback before using this as a design decision.';
        } else if (userCount <= 2) {
          implication = 'Early preference signal. Continue collecting rated looks before drawing design conclusions.';
        } else if (userCount <= 4) {
          if (rankedPieces.length === 0) {
            implication = 'Continue collecting rated looks before drawing a design conclusion.';
          } else if (prefLower.includes('elongate') || prefLower.includes('leg')) {
            implication = 'Early signal that vertical lines, longer silhouettes, or waist placement may support this preference. Continue testing before making design decisions.';
          } else if (prefLower.includes('balance') || prefLower.includes('proportion')) {
            implication = 'Early signal that pieces creating visual balance through strategic volume may support this preference. Continue testing.';
          } else if (prefLower.includes('structure') || prefLower.includes('define') || prefLower.includes('add structure')) {
            implication = 'Early signal that tailoring, waist definition, or architectural lines may support this preference. Continue testing.';
          } else if (prefLower.includes('comfort') || prefLower.includes('ease')) {
            implication = 'Early signal that soft fabrics, relaxed fits, or forgiving silhouettes may support this preference. Continue testing.';
          } else {
            implication = 'Early preference signal. Continue testing pieces that support this fit need.';
          }
        } else {
          // 5+ users - more confident
          if (prefLower.includes('elongate') || prefLower.includes('leg')) {
            implication = 'Continue using vertical lines, higher waist placement, and styling that lengthens the leg line.';
          } else if (prefLower.includes('balance') || prefLower.includes('proportion')) {
            implication = 'Focus on pieces that create visual balance through strategic volume.';
          } else if (prefLower.includes('structure') || prefLower.includes('define') || prefLower.includes('add structure')) {
            implication = 'Prioritize tailoring, waist definition, and architectural lines.';
          } else if (prefLower.includes('comfort') || prefLower.includes('ease')) {
            implication = 'Emphasize soft fabrics, relaxed fits, and forgiving silhouettes.';
          } else {
            implication = 'Continue current design direction based on positive performance.';
          }
        }
        
        // Determine piece signal state
        let bestPieces = [];
        let pieceSignal = 'Not enough rated looks yet to identify a clear piece signal';
        
        if (rankedPieces.length > 0) {
          bestPieces = rankedPieces.filter(p => p.score > 0).slice(0, 3).map(p => p.name);
          pieceSignal = bestPieces.length > 0 ? 'pieces' : 'Not enough rated looks yet to identify a clear piece signal';
        } else if (preferenceSessions.length === 0) {
          pieceSignal = 'No nAia piece signal yet';
        }
        
        return {
          preference,
          userCount: data.count,
          bestPieces,
          pieceSignal,
          struggles: uniqueStruggles.length > 0 ? uniqueStruggles.slice(0, 3) : [],
          implication,
          confidence: data.count <= 2 ? 'Low confidence' : 
                     data.count <= 4 ? 'Early signal' : 
                     data.count <= 9 ? 'Medium confidence' : 
                     'Strong signal'
        };
      })
      .sort((a, b) => b.userCount - a.userCount)