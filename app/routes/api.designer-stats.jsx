import prisma from "../db.server";


export async function loader({ request }) {
  const url = new URL(request.url);
  const dateRange = url.searchParams.get("dateRange") || "30";
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - parseInt(dateRange));
  try {
    // Fetch all reviews with sessions and items
    const reviews = await prisma.postOutfitReview.findMany({
      include: {
        session: {
          select: {
            id: true,
            styleDNA: true,
            currentMood: true,
            desiredFeeling: true,
            occasion: true,
            bodyPreference: true,
            selectedSuggestionId: true,
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
            onboardingProfile: {
              select: {
                stylePersonalities: true,
              }
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // TEMPORARY DEBUG: Check if workedTags exist on first review with suggestions
    const testReview = reviews.find(r => r.session?.suggestions?.length > 0 && r.workedTags);
    if (testReview) {
      console.log("🔴 TEST REVIEW FOUND:");
      console.log("  ID:", testReview.id.slice(0, 8));
      console.log("  workedTags:", testReview.workedTags);
      console.log("  typeof:", typeof testReview.workedTags);
      console.log("  session has suggestions:", !!testReview.session?.suggestions?.length);
    } else {
      console.log("🔴 NO TEST REVIEW FOUND - no reviews have both suggestions and workedTags");
    }
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
    
    reviews.filter(r => r.session?.suggestions?.length > 0).forEach(review => {
      const selectedSuggestion = review.session.suggestions.find(
        s => s.id === review.session.selectedSuggestionId
      ) || review.session.suggestions[0];
      
      if (!selectedSuggestion) return;
      console.log("🔍 PIECE STATS - Review:", review.id.slice(0,8), "has suggestions:", !!selectedSuggestion, "items count:", selectedSuggestion.items?.length || 0);
      
      if (!selectedSuggestion.items || selectedSuggestion.items.length === 0) {
        console.log("⚠️ NO ITEMS in suggestion", selectedSuggestion.id);
        return;
      }
      
      selectedSuggestion.items.forEach(item => {
        // Skip if no product title
        if (!item.productTitle) return;
        
        // Skip closet items (these have closetItemId OR are known closet pieces)
        if (item.closetItemId) return;
        const titleLower = item.productTitle.toLowerCase();
        if (titleLower === 'white top' || titleLower === 'black top' || 
            titleLower.includes('your ') || titleLower.includes('layer') || 
            titleLower.includes('pair your') || titleLower.includes('complemented')) {
          return;
        }
        
        const pieceName = item.productTitle;
        
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
        console.log(`DEBUG DNA - piece: ${pieceName}, profile DNA:`, review.customer?.onboardingProfile?.stylePersonalities, 'session DNA:', review.session?.styleDNA);
        let styleDNA = review.customer?.onboardingProfile?.stylePersonalities || review.session.styleDNA;
        if (styleDNA) {
          // stylePersonalities is already an array, styleDNA from session needs parsing
          let dna = styleDNA;
          if (typeof styleDNA === 'string') {
            try {
              dna = JSON.parse(styleDNA);
            } catch (e) {
              dna = [];
            }
          }
          if (Array.isArray(dna) && dna.length > 0) {
            stats.styleDNA.push(...dna);
          }
        }
        
        // Tags
        // Tags
        if (review.workedTags) {
          console.log("🔍 CHECKING workedTags - Review:", review.id.slice(0,8), "workedTags exists:", !!review.workedTags, "value:", review.workedTags);
          try {
        console.log("Processing review - workedTags:", review.workedTags, "for pieces:", selectedSuggestion.items.map(i => i.productTitle));
            let tags = review.workedTags;
            // Parse if string (may need double parse due to double-encoding)
            if (typeof tags === 'string') {
              tags = JSON.parse(tags);
              // Check if still a string (double-encoded)
              if (typeof tags === 'string') {
                tags = JSON.parse(tags);
              }
            }
            // If array, already parsed correctly
            if (Array.isArray(tags)) {
              stats.workedTags.push(...tags.filter(Boolean));
              console.log("✅ PUSHED TO STATS - piece:", pieceName, "now has", stats.workedTags.length, "worked tags");
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

    // Collect quotes from ALL reviews (including those without suggestions)
    reviews.forEach(review => {
      if (review.additionalNotes) {
        // Try to find which piece this quote is about
        const suggestion = review.session?.suggestions?.find(
          s => s.id === review.session.selectedSuggestionId
        ) || review.session?.suggestions?.[0];
        
        if (suggestion?.items?.length > 0) {
          // Add quote to each piece in the outfit
          suggestion.items.forEach(item => {
          if (!item.shopifyProductId) return;
            if (!item.shopifyProductId || !item.productTitle) return;
            const pieceName = item.productTitle;
            if (pieceStats[pieceName] && !pieceStats[pieceName].quotes.includes(review.additionalNotes)) {
              pieceStats[pieceName].quotes.push(review.additionalNotes);
            }
          });
        }
      }
    });

    console.log("📊 PIECE STATS after forEach - Total pieces:", Object.keys(pieceStats).length);
    Object.entries(pieceStats).forEach(([name, stats]) => {
      console.log(`  ${name}: workedTags=${stats.workedTags.length}, didntWorkTags=${stats.didntWorkTags.length}`);
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
      .filter(p => p.ratingCount >= 2)
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
      .filter(p => p.ratingCount >= 2)
      .filter(p => {
        const nameLower = p.name.toLowerCase();
        return !nameLower.includes('white top') && 
               !nameLower.includes('black top') && 
               !nameLower.includes('your ') &&
               nameLower !== 'top' &&
               nameLower !== 'bottom';
      })
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
      .filter(p => p.ratingCount >= 2)
      .filter(p => {
        const nameLower = p.name.toLowerCase();
        return !nameLower.includes('white top') && 
               !nameLower.includes('black top') && 
               !nameLower.includes('your ') &&
               nameLower !== 'top' &&
               nameLower !== 'bottom';
      })
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
        // Remove " x1", " x2" etc. from tag names
        const cleanTag = tag.replace(/\s+x\d+$/i, '').trim();
        if (!tagStats.negative[cleanTag]) {
          tagStats.negative[cleanTag] = { name: cleanTag, count: 0, pieces: [] };
        }
        tag = cleanTag;
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
      include: { onboardingProfile: { select: { stylePersonalities: true } } },
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
    
    // Also collect from styling sessions
    const sessions = await prisma.stylingSession.findMany({
      where: { styleDNA: { not: null, not: "[]" } },
      select: { styleDNA: true }
    });
    
    sessions.forEach(s => {
      try {
        const dnas = JSON.parse(s.styleDNA);
        if (Array.isArray(dnas)) {
          dnas.forEach(dna => {
            dnaCount[dna] = (dnaCount[dna] || 0) + 1;
          });
        }
      } catch {}
    });
    
    // Calculate total selections (users can pick multiple)
    const totalDNASelections = Object.values(dnaCount).reduce((sum, count) => sum + count, 0);
    
    const styleDNA = Object.entries(dnaCount)
      .map(([name, count]) => ({
        name,
        count,
        percentage: totalDNASelections > 0 ? Math.round((count / totalDNASelections) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // 9. Pieces by DNA
    const piecesByDNA = pieces
      .filter(p => p.topDNA.length > 0)
      .slice(0, 15);

    // 10. Body Patterns - with piece performance
    // Product Pairing Insights
    const pairingStats = {};
    
    reviews.filter(r => r.session?.suggestions?.length > 0).forEach(review => {
      const suggestion = review.session.suggestions.find(
        s => s.id === review.session.selectedSuggestionId
      ) || review.session.suggestions[0];
      
      if (!suggestion?.items || suggestion.items.length < 2) return;
      
      // Find closet items and nAia pieces in the outfit
      const closetItems = suggestion.items.filter(item => {
        if (item.closetItemId) return true;
        if (!item.productTitle) return false;
        const title = item.productTitle.toLowerCase();
        // Only exact matches for known closet items
        return title === 'white top' || 
               title === 'black top' || 
               title === 'your white top' ||
               title === 'your black top';
      });
      const naiaItems = suggestion.items.filter(item => 
        !closetItems.includes(item) &&
        item.productTitle &&
        !item.productTitle.toLowerCase().includes('white top') &&
        !item.productTitle.toLowerCase().includes('black top')
      );
      
      // Create pairings
      closetItems.forEach(closetItem => {
        naiaItems.forEach(naiaItem => {
          const closetName = closetItem.productTitle || `Closet item ${closetItem.closetItemId}`;
          const naiaName = naiaItem.productTitle;
          const pairKey = `${closetName}|||${naiaName}`;
          
          if (!pairingStats[pairKey]) {
            pairingStats[pairKey] = {
              closetItem: closetName,
              naiaPiece: naiaName,
              ratings: [],
              rewearYes: 0,
              rewearTotal: 0
            };
          }
          
          if (review.overallFeeling) {
            pairingStats[pairKey].ratings.push(review.overallFeeling);
          }
          pairingStats[pairKey].rewearTotal++;
          if (review.wouldWearAgain === "Definitely") {
            pairingStats[pairKey].rewearYes++;
          }
        });
      });
    });
    
    const productPairings = Object.values(pairingStats)
      .filter(p => {
        if (p.ratings.length === 0) return false;
        // Exclude AI-generated descriptions
        const naia = p.naiaPiece.toLowerCase();
        return !naia.includes('layer') && 
               !naia.includes('pair your') && 
               !naia.includes('complemented') &&
               !naia.includes('wear your');
      })
      .map(p => ({
        closetItem: p.closetItem,
        naiaPiece: p.naiaPiece,
        avgRating: p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length,
        reviewCount: p.ratings.length,
        rewearRate: p.rewearYes / p.rewearTotal
      }))
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);

    // Objection Tracker
    const objectionStats = {};
    reviews.forEach(review => {
      if (review.objections) {
        try {
          const list = JSON.parse(review.objections);
          if (Array.isArray(list)) {
            list.forEach(obj => {
              if (obj === "Nothing — I'd wear it") return;
              if (!objectionStats[obj]) objectionStats[obj] = { name: obj, count: 0, pieces: [] };
              objectionStats[obj].count++;
              const suggestion = review.session?.suggestions?.find(s => s.id === review.session.selectedSuggestionId) || review.session?.suggestions?.[0];
              if (suggestion?.items) {
                suggestion.items.forEach(item => {
          if (!item.shopifyProductId) return;
                  if (!item.shopifyProductId || !item.productTitle) return;
                  const pieceName = item.productTitle;
                  if (!objectionStats[obj].pieces.includes(pieceName)) objectionStats[obj].pieces.push(pieceName);
                });
              }
            });
          }
        } catch (e) {}
      }
    });
    const topObjections = Object.values(objectionStats).sort((a,b) => b.count - a.count).slice(0,10).map(o => ({ name: o.name, count: o.count, topPieces: o.pieces.slice(0,3) }));


    const bodyStats = {};
    console.log("🔍 STARTING BODY STATS CALCULATION");
    
    console.log("🔍 BODY PREFS DEBUG - Body preferences found:", reviews.map(r => r.session.bodyPreference).filter(Boolean));
    reviews.filter(r => r.session?.suggestions?.length > 0).forEach(review => {
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
          console.log("🔍 Review", review.id.slice(0,8), "has suggestions:", selectedSuggestion ? "YES" : "NO", "items:", selectedSuggestion?.items?.length || 0);
        selectedSuggestion.items.forEach(item => {
          if (!item.shopifyProductId || !item.productTitle) return;
          const pieceName = item.productTitle;
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
    
    console.log("🔍 BODY STATS RESULT:", Object.keys(bodyStats), "Total entries:", Object.keys(bodyStats).length);
    const bodyPatterns = Object.entries(bodyStats)
      .map(([preference, data]) => {
        const piecePerformance = Object.entries(data.pieces)
          .map(([name, perf]) => ({ name, ...perf, score: perf.good - perf.bad }))
          .filter(p => {
            // Exclude closet items
            const nameLower = p.name.toLowerCase();
            return !nameLower.includes('white top') && 
                   !nameLower.includes('black top') && 
                   !nameLower.includes('your ') &&
                   nameLower !== 'top' &&
                   nameLower !== 'bottom';
          })
          .sort((a, b) => b.score - a.score);
        
        // Get fit concerns (negative tags related to fit)
        const struggles = [];
        reviews.forEach(r => {
          if (r.session?.bodyPreference === preference && r.didntWorkTags) {
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
        
        // Design implication
        let implication = '';
        const prefLower = preference.toLowerCase();
        if (prefLower.includes('elongate') || prefLower.includes('leg')) {
          implication = 'Continue using vertical lines, higher waist placement, and styling that lengthens the leg line.';
        } else if (prefLower.includes('balance') || prefLower.includes('proportion')) {
          implication = 'Focus on pieces that create visual balance through strategic volume.';
        } else if (prefLower.includes('structure') || prefLower.includes('define')) {
          implication = 'Prioritize tailoring, waist definition, architectural lines.';
        } else if (prefLower.includes('comfort') || prefLower.includes('ease')) {
          implication = 'Emphasize soft fabrics, relaxed fits, forgiving silhouettes.';
        } else {
          implication = 'Continue current design direction based on positive performance.';
        }
        
        return {
          preference,
          userCount: data.count,
          bestPieces: piecePerformance.filter(p => p.score > 0).slice(0, 3),
          struggles: uniqueStruggles.length > 0 ? uniqueStruggles.slice(0, 3) : ['No repeated fit concerns yet'],
          implication
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
    // Collect ALL quotes from reviews
    const allQuotes = [];
    reviews.forEach(review => {
      if (review.additionalNotes && review.additionalNotes.length > 10) {
        const suggestion = review.session?.suggestions?.find(
          s => s.id === review.session.selectedSuggestionId
        ) || review.session?.suggestions?.[0];
        
        // Build the full look description
        const outfitParts = [];
        
        // Add all items (closet + nAia, excluding AI descriptions)
        if (suggestion?.items) {
          suggestion.items.forEach(item => {
            if (!item.productTitle) return;
            const title = item.productTitle.toLowerCase();
            // Only exclude AI-generated descriptions
            if (title.includes('layer') || title.includes('pair ') || 
                title.includes('wear ') || title.includes('complement')) return;
            outfitParts.push(item.productTitle);
          });
        }
        
        // Add styling details
        const stylingDetails = [];
        if (suggestion.makeupVibeRec) stylingDetails.push(suggestion.makeupVibeRec);
        if (suggestion.hairstyleRec) stylingDetails.push(suggestion.hairstyleRec);
        if (suggestion.perfumeRec) stylingDetails.push(suggestion.perfumeRec);
        if (suggestion.songRec) stylingDetails.push(`Song: ${suggestion.songRec}`);
        
        let pieceName = outfitParts.join(' + ');
        if (stylingDetails.length > 0) {
          pieceName += ` (${stylingDetails.join(', ')})`;
        }
        
        if (!pieceName) return; // Skip if empty
        allQuotes.push({ text: review.additionalNotes, piece: pieceName });
      }
    });
    
    const quotes = allQuotes.slice(0, 10);


    // Design Actions - PIECE-SPECIFIC tags only
    console.log("DEBUG - Pieces being tracked:", pieces.map(p => p.name));
    const designActions = [];
    
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
    
    const formatTags = (tags) => tags.map(([tag]) => tag).join(', ');
    const formatTagsShort = (tags) => tags.map(([tag]) => tag.toLowerCase().replace('helped me feel more ', '').replace('i liked the ', '')).join(', ');
    
    const categorizeFix = (tags) => {
      if (!tags || tags.length === 0) return null;
      
      const fitIssues = [];
      const emotionalIssues = [];
      const stylingIssues = [];
      const occasionIssues = [];
      
      tags.forEach(([tag, count]) => {
        const lower = tag.toLowerCase();
        if (lower.includes('clingy') || lower.includes('uncomfortable') || lower.includes('lacked shape') || 
            lower.includes('structured') || lower.includes('exposed')) {
          fitIssues.push([tag, count]);
        } else if (lower.includes('didn\'t create') || lower.includes('didn\'t feel like me')) {
          emotionalIssues.push([tag, count]);
        } else if (lower.includes('hard to wear') || lower.includes('too much') || lower.includes('plain')) {
          stylingIssues.push([tag, count]);
        } else if (lower.includes('wrong for')) {
          occasionIssues.push([tag, count]);
        } else {
          stylingIssues.push([tag, count]);
        }
      });
      
      return { fitIssues, emotionalIssues, stylingIssues, occasionIssues };
    };
    
    const getRecommendedFix = (categories, reviewCount, hasPositiveConfidence) => {
      if (!categories) return "Collect at least 5 ratings before making decisions.";
      
      const { fitIssues, emotionalIssues, stylingIssues, occasionIssues } = categories;
      
      if (reviewCount <= 2) {
        return "Collect at least 5 ratings before making campaign, restock, design, or positioning decisions.";
      }
      
      let fixes = [];
      
      if (fitIssues.length > 0) {
        const [tag] = fitIssues[0];
        const lower = tag.toLowerCase();
        if (lower.includes('clingy')) fixes.push("review fabric, lining, pattern ease, or test a looser cut");
        else if (lower.includes('uncomfortable')) fixes.push("review comfort, construction, seam placement");
        else if (lower.includes('exposed')) fixes.push("review coverage options or neckline");
        else if (lower.includes('structured')) fixes.push("test softer construction or fluid fabric");
        else if (lower.includes('lacked shape')) fixes.push("add waist definition or tailoring");
      }
      
      if (emotionalIssues.length > 0) {
        const [tag] = emotionalIssues[0];
        const lower = tag.toLowerCase();
        if (lower.includes('didn\'t create') && hasPositiveConfidence) {
          fixes.push("review emotional pairing");
        } else if (lower.includes('didn\'t create')) {
          fixes.push("review emotional positioning and outfit pairing");
        } else if (lower.includes('didn\'t feel like me')) {
          fixes.push("review style DNA match");
        }
      }
      
      if (stylingIssues.length > 0) {
        const [tag] = stylingIssues[0];
        const lower = tag.toLowerCase();
        if (lower.includes('hard to wear')) fixes.push("create more wearable styling examples");
        else if (lower.includes('too much')) fixes.push("create toned-down styling");
        else if (lower.includes('plain')) fixes.push("add detail or statement pairing");
      }
      
      if (occasionIssues.length > 0) {
        fixes.push("reposition for better occasion");
      }
      
      if (fixes.length === 0) {
        if (reviewCount <= 4) return "Continue gathering feedback to confirm patterns.";
        if (reviewCount <= 9) return "Consider featuring in content and increasing availability.";
        return "Scale production and feature prominently.";
      }
      
      return fixes.join('; ');
    };
    
    const getAction = (positiveTags, negativeTags, occasions, reviewCount, rating, wouldWear) => {
      if (reviewCount <= 2) return "Continue gathering feedback";
      if (rating < 4.5 || wouldWear < 70) return "Monitor performance";
      
      const occ = occasions.slice(0, 2).join('/') || 'styling';
      const hasConfidence = positiveTags.some(([tag]) => tag.toLowerCase().includes('confident'));
      const hasEmotionalMismatch = negativeTags.some(([tag]) => tag.toLowerCase().includes('didn\'t create'));
      
      if (hasConfidence && hasEmotionalMismatch) {
        return `Test confidence-led ${occ} styling`;
      }
      
      if (!positiveTags || positiveTags.length === 0) {
        return `Create ${occ} styling content`;
      }
      
      const topTag = positiveTags[0][0].toLowerCase();
      if (topTag.includes('right for the occasion')) return `Create ${occ} content`;
      if (topTag.includes('confident')) return `Feature in confidence messaging`;
      if (topTag.includes('easy to imagine')) return `Feature as wearable hero`;
      if (topTag.includes('flattering') || topTag.includes('silhouette')) return `Highlight silhouette in ${occ} styling`;
      if (topTag.includes('polished')) return `Position for elevated styling`;
      if (topTag.includes('attractive')) return `Position for date/night out`;
      
      return `Create ${occ} styling content`;
    };
    
    // Create actions for EACH PIECE with its OWN tags
    pieces.forEach(piece => {
      const reviewCount = piece.ratingCount;
      const wouldWear = Math.round(piece.rewear * 100);
      const rating = piece.avgRating;
      
      if (reviewCount === 0) return;
      
      const occasions = piece.bestOccasions || [];
      const occasionText = occasions.slice(0, 2).join('/') || 'styling';
      
      // PIECE-SPECIFIC tags from piece.positiveComments and piece.negativeComments
      const positiveFeedback = getTopFeedback(piece.workedTags || [], 5);
      const negativeFeedback = getTopFeedback((piece.didntWorkTags || []).filter(t => !t.toLowerCase().includes('everything worked')), 5);
      
      // Validate: tag count cannot exceed review count
      const validPositive = positiveFeedback.filter(([tag, count]) => count <= reviewCount);
      const validNegative = negativeFeedback.filter(([tag, count]) => count <= reviewCount);
      
      // Confidence
      let confidenceBadge;
      if (reviewCount <= 2) confidenceBadge = "Low Confidence";
      else if (reviewCount <= 4) confidenceBadge = "Early Signal";
      else if (reviewCount <= 9) confidenceBadge = "Medium Confidence";
      else confidenceBadge = "High Confidence";
      
      // Performance signal
      let performance = `${reviewCount} reviews · ${rating.toFixed(1)}/5 · ${wouldWear}% would wear`;
      if (occasions.length > 0) performance += ` · Best for ${occasionText}`;
      
      // What customers liked
      let liked = validPositive.length > 0 ? formatTagsShort(validPositive.slice(0, 3)) : "No positive tags yet";
      
      // What to watch
      let watch = '';
      if (reviewCount <= 2) {
        watch = "Not enough data yet";
      } else if (validNegative.length === 0) {
        watch = "No watch-outs yet";
      } else {
        const tags = validNegative.slice(0, 2).map(([tag, count]) => `${tag.toLowerCase()} x${count}`).join(', ');
        watch = tags;
      }
      
      // Primary action
      const hasPositiveConfidence = validPositive.some(([tag]) => tag.toLowerCase().includes('confident'));
      const action = getAction(validPositive, validNegative, occasions, reviewCount, rating, wouldWear);
      
      // Recommended fix
      const categories = categorizeFix(validNegative);
      let nextStep = getRecommendedFix(categories, reviewCount, hasPositiveConfidence);
      
      // Make it action-oriented
      if (reviewCount > 2 && validNegative.length > 0 && rating >= 4.5 && wouldWear >= 70) {
        nextStep = `Test ${occasionText} styling; ${nextStep}`;
      }
      
      // Data line
      const posData = validPositive.length > 0 ? ` · positive: ${formatTags(validPositive.slice(0, 3))}` : '';
      const negData = validNegative.length > 0 ? ` · negative: ${validNegative.map(([tag, count]) => `${tag} x${count}`).join(', ')}` : '';
      
      designActions.push({
        piece: piece.name,
        actionType: "Primary Action",
        action,
        confidenceBadge,
        performance,
        liked,
        watch,
        nextStep,
        data: `${reviewCount} reviews · ${rating.toFixed(1)}/5 · ${wouldWear}% would wear${posData}${negData}`,
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

    // Styling-to-Shopping Conversion Stats
    const productConversion = {};
    reviews.forEach(review => {
      const suggestion = review.session?.suggestions?.find(s => s.id === review.session.selectedSuggestionId) || review.session?.suggestions?.[0];
      if (suggestion?.items) {
        suggestion.items.forEach(item => {
          if (!item.shopifyProductId) return;
          const key = item.shopifyProductId || item.productTitle;
          if (!key) return;
          if (!productConversion[key]) {
            productConversion[key] = { productTitle: item.productTitle, recommended: 0, clicked: 0, tryon: 0, wishlisted: 0 };
          }
          productConversion[key].recommended++;
        });
      }
    });
    const events = await prisma.stylingEvent.findMany({ where: { createdAt: { gte: dateFrom } } });
    events.forEach(event => {
      const key = event.productId;
      if (!productConversion[key]) {
        productConversion[key] = { productTitle: event.productTitle, recommended: 0, clicked: 0, tryon: 0, wishlisted: 0 };
      }
      if (event.eventType === "clicked") productConversion[key].clicked++;
      if (event.eventType === "tryon") productConversion[key].tryon++;
      if (event.eventType === "wishlisted") productConversion[key].wishlisted++;
    });
    const conversionStats = Object.values(productConversion).filter(p => p.recommended > 0).map(p => ({ ...p, clickRate: p.recommended > 0 ? (p.clicked / p.recommended * 100).toFixed(1) : 0, tryonRate: p.clicked > 0 ? (p.tryon / p.clicked * 100).toFixed(1) : 0 })).sort((a, b) => b.recommended - a.recommended).slice(0, 10);


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
      productPairings,
      topObjections,
      conversionStats,
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
