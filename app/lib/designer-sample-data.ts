/**
 * DESIGNER_SAMPLE_DATA_ENABLED=true — staging/dev only.
 * Returns plausible fixture data for dashboard review without real customer records.
 * Accepts dateRangeDays to return period-appropriate data. Never writes to the database.
 */

export function getDesignerSampleData(dateRangeDays: number = 30) {
  // Scale factor relative to 365-day (all-time) baseline
  const scale =
    dateRangeDays === 7   ? 0.09 :
    dateRangeDays === 30  ? 0.27 :
    dateRangeDays === 90  ? 0.62 :
    1.0;

  // Round to positive integer
  const sc = (full: number, min = 1) => Math.max(min, Math.round(full * scale));

  const periodLabel = dateRangeDays === 365 ? "All time" : `Last ${dateRangeDays} days`;
  const prevLabel   = dateRangeDays === 365 ? "Prior year" : `Prior ${dateRangeDays} days`;

  const sessions     = sc(89);
  const reviews      = sc(67);
  const prevSessions = Math.max(1, Math.round(sessions * 0.79));
  const prevReviews  = Math.max(1, Math.round(reviews  * 0.75));

  // ── 5 Becoming product stories ──────────────────────────────────────────────
  // One canonical definition per product — referenced throughout the fixture.

  const VELVET_BLAZER = {
    name: "The Velvet Blazer",
    story: "Becoming Seen",
    category: "Outerwear",
    avgRating: 4.4,
    rewearRate: 0.83,
    sampleSize: sc(18),
    avgConfidenceLift: 2.1,
    strongestTransformation: "Uncertain → Confident",
    topDesiredFeelings: ["Confident", "Powerful"] as string[],
    bestPersonality: "Corporate Chic",
    bestOccasion: "Work presentation",
    mostCommonObjection: null as string | null,
    opportunityScore: 82,
    recommendation: "Make this a hero piece — style it across occasions with editorial storytelling.",
    recommendationReason:
      "Corporate Chic customers consistently achieve 'Confident' with this piece. 77% would wear it again and it delivers the highest confidence lift in the collection.",
  };

  const SILK_SLIP = {
    name: "Silk Slip Dress",
    story: "Becoming Whole",
    category: "Dresses",
    avgRating: 4.1,
    rewearRate: 0.62,
    sampleSize: sc(12),
    avgConfidenceLift: 1.5,
    strongestTransformation: "Underdressed → Elegant",
    topDesiredFeelings: ["Elegant", "Feminine"] as string[],
    bestPersonality: "Romantic",
    bestOccasion: "Date night",
    mostCommonObjection: "Not sure where to wear it" as string | null,
    opportunityScore: 68,
    recommendation: "Create styling guides showing 3 ways to wear it beyond eveningwear.",
    recommendationReason:
      "High save rate but customers hesitate because they can only imagine it for formal occasions. Styling content could unlock day-to-night rewear.",
  };

  const BIKER = {
    name: "Structured Biker Jacket",
    story: "Becoming Alive",
    category: "Outerwear",
    avgRating: 3.8,
    rewearRate: 0.78,
    sampleSize: sc(9),
    avgConfidenceLift: 1.2,
    strongestTransformation: "Comfortable → Edgy",
    topDesiredFeelings: ["Confident", "Edgy"] as string[],
    bestPersonality: "Edgy",
    bestOccasion: "Casual weekend",
    mostCommonObjection: "Too bold for my everyday style" as string | null,
    opportunityScore: 55,
    recommendation: "Focus on Edgy and Trendy audiences — avoid styling for conservative occasions.",
    recommendationReason:
      "Polarising piece with a devoted audience. Strong with the right segment but may not suit mainstream expansion.",
  };

  const TROUSERS = {
    name: "Tailored Wide-Leg Trousers",
    story: "Becoming Grounded",
    category: "Trousers",
    avgRating: 3.9,
    rewearRate: 0.69,
    sampleSize: sc(7),
    avgConfidenceLift: 1.3,
    strongestTransformation: "Underdressed → Put Together",
    topDesiredFeelings: ["Put Together", "Confident"] as string[],
    bestPersonality: "Effortlessly Chic",
    bestOccasion: "Work",
    mostCommonObjection: "Too long for my height" as string | null,
    opportunityScore: 48,
    recommendation: "Explore petite-friendly styling guidance or a shorter-length option.",
    recommendationReason:
      "11 of 38 customers have petite frames — a length objection is reducing rewear for a meaningful segment.",
  };

  const LINEN = {
    name: "Linen Column Dress",
    story: "Becoming Clear",
    category: "Dresses",
    avgRating: 4.3,
    rewearRate: 0.81,
    sampleSize: sc(11),
    avgConfidenceLift: 1.8,
    strongestTransformation: "Comfortable → Effortless",
    topDesiredFeelings: ["Effortless", "Comfortable"] as string[],
    bestPersonality: "Minimal",
    bestOccasion: "Everyday",
    mostCommonObjection: null as string | null,
    opportunityScore: 77,
    recommendation: "Increase recommendation frequency — this piece over-delivers relative to its exposure.",
    recommendationReason:
      "Minimal audience achieves high emotional outcomes. Currently underweighted in nAia recommendations — an easy improvement to unlock.",
  };

  // ── dashboard ────────────────────────────────────────────────────────────────

  const dashboard = {
    totalUsers: 42,
    totalLooks: sc(89),
    avgRating: 4.1,
    avgRewear: 0.73,
    avgAlignment: 0.81,

    // All-time profile data — not period-filtered
    onboarding: {
      totalProfiles: 38,
      styleDNADistribution: [
        { style: "corporate-chic", count: 14, percentage: 37 },
        { style: "romantic",       count: 11, percentage: 29 },
        { style: "minimal",        count: 8,  percentage: 21 },
        { style: "edgy",           count: 5,  percentage: 13 },
      ],
      desiredFeelings: [
        { feeling: "more-confident", count: 22, percentage: 58 },
        { feeling: "put-together",   count: 15, percentage: 39 },
        { feeling: "elegant",        count: 10, percentage: 26 },
        { feeling: "comfortable",    count: 8,  percentage: 21 },
      ],
      lifestyleDistribution: [
        { lifestyle: "social",    count: 18, percentage: 47 },
        { lifestyle: "work",      count: 14, percentage: 37 },
        { lifestyle: "everyday",  count: 12, percentage: 32 },
        { lifestyle: "weekend",   count: 9,  percentage: 24 },
      ],
      colorDistribution: [
        { color: "navy",  count: 20, percentage: 53 },
        { color: "black", count: 18, percentage: 47 },
        { color: "camel", count: 12, percentage: 32 },
        { color: "white", count: 10, percentage: 26 },
      ],
      commonStruggles: [
        { struggle: "I struggle to style what I own",    count: 16, percentage: 42 },
        { struggle: "Getting dressed takes too long",    count: 11, percentage: 29 },
        { struggle: "Nothing feels right for occasions", count: 8,  percentage: 21 },
      ],
    },

    topOccasions: [
      {
        name: "Dressing for special events",
        lookCount: sc(31), avgRating: 4.3, rewear: 0.77,
        topPieces: [VELVET_BLAZER.name, SILK_SLIP.name],
      },
      {
        name: "Work and professional settings",
        lookCount: sc(24), avgRating: 4.0, rewear: 0.71,
        topPieces: [VELVET_BLAZER.name, TROUSERS.name],
      },
      {
        name: "Everyday comfortable style",
        lookCount: sc(19), avgRating: 3.9, rewear: 0.68,
        topPieces: [LINEN.name],
      },
    ],

    positiveTags: [
      { name: "Confidence",   count: sc(34), topPieces: [VELVET_BLAZER.name, SILK_SLIP.name] },
      { name: "Elegant",      count: sc(27), topPieces: [LINEN.name, SILK_SLIP.name] },
      { name: "Put together", count: sc(22), topPieces: [TROUSERS.name] },
    ],

    negativeTags: [
      { name: "Too formal",    count: sc(8), topPieces: [BIKER.name] },
      { name: "Not practical", count: sc(5), topPieces: [SILK_SLIP.name] },
    ],

    topObjections: [
      { name: "Not sure where to wear it",              count: sc(7) },
      { name: "Too formal for the occasion",            count: sc(8) },
      { name: "Too long for my height",                 count: sc(5) },
      { name: "Not comfortable enough for all day",     count: sc(6) },
      { name: "Colour doesn't suit me",                 count: sc(4) },
    ],

    stylingNeeds: [
      { occasion: "Casual weekend",     need: "Casual weekend",     count: sc(12) },
      { occasion: "Gym and activewear", need: "Gym and activewear", count: sc(7) },
    ],

    conversionStats: [
      {
        productTitle: VELVET_BLAZER.name,
        recommended: sc(18), clicked: sc(12), clickRate: 67,
        tryon: sc(8), tryonRate: 67, wishlisted: sc(5),
      },
    ],

    bodyPatterns: [
      {
        preference: "Petite frame",
        userCount: 11,
        bestPieces: [SILK_SLIP.name, LINEN.name],
        struggles: ["Wide-leg trousers can overwhelm the frame"],
        implication: "Proportion-conscious styling is important for this group.",
      },
    ],

    // ── Product Intelligence piece arrays ─────────────────────────────────────

    topPieces: [
      {
        name: VELVET_BLAZER.name,
        category: VELVET_BLAZER.category,
        avgRating: VELVET_BLAZER.avgRating,
        ratingCount: VELVET_BLAZER.sampleSize,
        rewear: VELVET_BLAZER.rewearRate,
        helpedFeel: ["Confident", "Powerful", "Put Together"],
        bestOccasions: ["Work presentation", "Client meetings", "Events"],
        positiveComments: ["Makes me feel like I belong in the boardroom", "Elevates any outfit"],
        negativeComments: [],
        topDNA: ["Corporate Chic", "Effortlessly Chic"],
      },
      {
        name: LINEN.name,
        category: LINEN.category,
        avgRating: LINEN.avgRating,
        ratingCount: LINEN.sampleSize,
        rewear: LINEN.rewearRate,
        helpedFeel: ["Effortless", "Comfortable", "Put Together"],
        bestOccasions: ["Everyday", "Casual weekend", "Brunch"],
        positiveComments: ["I wear this constantly", "Looks expensive and feels easy"],
        negativeComments: [],
        topDNA: ["Minimal", "Effortlessly Chic"],
      },
    ],

    mixedPieces: [
      {
        name: SILK_SLIP.name,
        avgRating: SILK_SLIP.avgRating,
        rewear: SILK_SLIP.rewearRate,
        reason: "Highly rated but low rewear",
        friction: "Customers love how it looks but can't find occasions to wear it",
      },
    ],

    underperformingPieces: [
      {
        name: BIKER.name,
        weakSignals: ["Niche appeal", "Style polarisation"],
        rejectionReasons: [
          "Too bold for my everyday style",
          "Doesn't fit my work context",
        ],
      },
    ],

    watchPieces: [
      {
        name: TROUSERS.name,
        ratingCount: Math.min(TROUSERS.sampleSize, 2),
        avgRating: TROUSERS.avgRating,
      },
    ],

    piecesByDNA: [
      { name: VELVET_BLAZER.name, topDNA: ["Corporate Chic", "Effortlessly Chic"] },
      { name: SILK_SLIP.name,     topDNA: ["Romantic", "Feminine"] },
      { name: BIKER.name,         topDNA: ["Edgy", "Trendy"] },
      { name: TROUSERS.name,      topDNA: ["Effortlessly Chic", "Minimal"] },
      { name: LINEN.name,         topDNA: ["Minimal", "Effortlessly Chic"] },
    ],

    emotionalOutcomes: [
      { name: VELVET_BLAZER.name, emotions: ["Confident", "Powerful", "Put Together"] },
      { name: SILK_SLIP.name,     emotions: ["Elegant", "Feminine"] },
      { name: BIKER.name,         emotions: ["Edgy", "Confident"] },
      { name: TROUSERS.name,      emotions: ["Put Together", "Grounded"] },
      { name: LINEN.name,         emotions: ["Effortless", "Comfortable"] },
    ],

    productPairings: [
      {
        closetItem: "White cotton shirt",
        naiaPiece: VELVET_BLAZER.name,
        avgRating: 4.6,
        reviewCount: sc(9),
        rewearRate: 0.88,
      },
      {
        closetItem: "Straight-leg jeans",
        naiaPiece: LINEN.name,
        avgRating: 4.2,
        reviewCount: sc(6),
        rewearRate: 0.79,
      },
    ],

    // ── Design Opportunities tab data ─────────────────────────────────────────

    designActions: [
      {
        piece: VELVET_BLAZER.name,
        confidenceBadge: "High Confidence",
        actionType: "Expand",
        action: "Style this piece for three distinct occasions in your next campaign",
        performance: `★ ${VELVET_BLAZER.avgRating} avg rating · ${Math.round(VELVET_BLAZER.rewearRate * 100)}% would wear again · +${VELVET_BLAZER.avgConfidenceLift} confidence lift`,
        liked: "Customers feel powerful and appropriate for work — highest confidence lift in the collection",
        watch: "Can veer too formal if styled without a casual counterbalance",
        nextStep: "Commission editorial lookbook: The Blazer at Work, at an Exhibition Opening, and at Saturday Brunch",
        data: `n=${VELVET_BLAZER.sampleSize} reviews · ${VELVET_BLAZER.story} · Best with ${VELVET_BLAZER.bestPersonality}`,
      },
      {
        piece: SILK_SLIP.name,
        confidenceBadge: "Medium Confidence",
        actionType: "Resolve",
        action: "Create occasion-specific styling guides to unlock day-to-night wear",
        performance: `★ ${SILK_SLIP.avgRating} avg rating · ${Math.round(SILK_SLIP.rewearRate * 100)}% rewear (below average)`,
        liked: "Customers consistently describe it as beautiful and aspirational",
        watch: "Rewear is 21 points below the collection average — occasion ambiguity is the cause",
        nextStep: "Produce three styling guides: Desk to Dinner, Weekend Gallery Visit, Summer Wedding Guest",
        data: `n=${SILK_SLIP.sampleSize} reviews · ${SILK_SLIP.story} · Top objection: "${SILK_SLIP.mostCommonObjection}"`,
      },
      {
        piece: BIKER.name,
        confidenceBadge: "Medium Confidence",
        actionType: "Target",
        action: "Restrict nAia recommendations to Edgy and Trendy profiles",
        performance: `★ ${BIKER.avgRating} avg rating · ${Math.round(BIKER.rewearRate * 100)}% rewear among committed wearers`,
        liked: "Devoted fans give it 4.8+ and style it repeatedly — strong community fit",
        watch: "Mismatched styling for corporate or romantic profiles drives negative feedback",
        nextStep: "Add personality gating in nAia recommendation logic: only suggest to Edgy and Trendy profiles",
        data: `n=${BIKER.sampleSize} reviews · ${BIKER.story} · Best with ${BIKER.bestPersonality}`,
      },
      {
        piece: TROUSERS.name,
        confidenceBadge: "Early Signal",
        actionType: "Adapt",
        action: "Introduce petite-length option or styling guidance for shorter frames",
        performance: `★ ${TROUSERS.avgRating} avg rating · ${Math.round(TROUSERS.rewearRate * 100)}% rewear`,
        liked: "Customers love the silhouette and feel polished wearing it",
        watch: "11 of 38 customers flagged length as an obstacle — disproportionate rejection for petite frames",
        nextStep: "Commission petite styling content; explore a cropped or ankle-length SKU",
        data: `n=${TROUSERS.sampleSize} reviews · ${TROUSERS.story} · Objection: "${TROUSERS.mostCommonObjection}"`,
      },
      {
        piece: LINEN.name,
        confidenceBadge: "Medium Confidence",
        actionType: "Unlock",
        action: "Increase recommendation frequency for Minimal and Effortlessly Chic profiles",
        performance: `★ ${LINEN.avgRating} avg rating · ${Math.round(LINEN.rewearRate * 100)}% rewear · +${LINEN.avgConfidenceLift} confidence lift`,
        liked: "Highest rewear rate in the casual/everyday category — customers reach for this repeatedly",
        watch: "Currently under-indexed in nAia recommendations relative to its performance",
        nextStep: "Adjust recommendation weights: prioritise for Minimal profiles in Everyday and Casual Weekend sessions",
        data: `n=${LINEN.sampleSize} reviews · ${LINEN.story} · Best with ${LINEN.bestPersonality}`,
      },
    ],

    quotes: [
      {
        text: "This blazer makes me feel like I actually belong in the boardroom.",
        piece: VELVET_BLAZER.name,
      },
      {
        text: "The dress is beautiful but I never know where to wear it without feeling overdressed.",
        piece: SILK_SLIP.name,
      },
      {
        text: "I finally feel like my clothes match who I actually am.",
        piece: null as string | null,
      },
      {
        text: "I keep coming back to the same three pieces. At least now I know why.",
        piece: null as string | null,
      },
    ],
  };

  // ── kpis ─────────────────────────────────────────────────────────────────────

  const kpis = {
    passport:  { total: 38, completed: 31, completionRate: 82 },
    closet:    { totalCustomers: 42, customersWithCloset: 28, adoptionRate: 67, totalItems: 196, avgItems: 7.0 },
    buyOrSkip: { total: sc(54), buy: sc(32), skip: sc(14), maybe: sc(8), buyRate: 59 },
    confidence: {
      sampleSize: reviews,
      avgBefore: 5.4,
      avgAfter: 7.2,
      avgDelta: 1.8,
    },
    recentActivity: { sessions, reviews },
  };

  // ── phase4b2 ─────────────────────────────────────────────────────────────────

  const sessionsWithFeedback = Math.round(sessions * 0.61);
  const objTotal = Math.max(4, sc(11));

  const phase4b2 = {
    selfieAdoption: {
      migrationPending: false,
      customersWithSelfie: 19,
      totalCustomers: 42,
      adoptionRate: 45,
    },
    closetTryOnReadiness: {
      totalItems: 196,
      readyItems: 142,
      readinessRate: 72,
      pendingAssessmentItems: 31,
      ineligibleItems: 23,
    },
    vtoMetrics: {
      migrationPending: false,
      totalJobs: sc(31),
      completedJobs: sc(28),
      completionRate: 90,
      vtoFeedbackCount: sc(18),
      fidelityConcernCount: sc(3),
      fidelityConcernRate: 17,
    },
    feedbackEngagement: {
      migrationPending: false,
      totalSessions: sessions,
      sessionsWithFeedback,
      responseRate: 61,
    },
    feedbackDistribution: {
      migrationPending: false,
      love: Math.round(sessionsWithFeedback * 0.59),
      okay: Math.round(sessionsWithFeedback * 0.29),
      notForMe: Math.round(sessionsWithFeedback * 0.12),
      total: sessionsWithFeedback,
    },
    objectionInsights: {
      migrationPending: false,
      total: objTotal,
      colourObjections:       Math.max(0, sc(2)),
      fitObjections:          Math.max(0, sc(1)),
      tooRevealingObjections: Math.max(0, sc(1)),
      tooCoveredObjections:   0,
      tooFormalObjections:    Math.max(0, sc(3)),
      tooCasualObjections:    Math.max(0, sc(1)),
      notPracticalObjections: Math.max(0, sc(2)),
      alreadyOwnObjections:   Math.max(0, sc(1)),
    },
    postWearCompletion: {
      migrationPending: false,
      totalWithPostWear: sc(42),
      didWearItYes: sc(35),
      wearRate: 83,
      feltPositive: sc(30),
      positiveExperienceRate: 71,
    },
    designerInsights: [
      {
        type: "objection",
        pattern: "Colour mismatch",
        frequency: sc(8),
        threshold: 5,
        suggestion: "Consider expanding navy and camel options — 53% of profiles prefer these tones.",
      },
    ],
  };

  // ── advanced ─────────────────────────────────────────────────────────────────

  // Emotional transformations — fewer rows for short periods
  const allTransformations = [
    {
      startingMood: "Uncertain",
      desiredFeeling: "Confident",
      count: sc(22),
      achievedRate: 77,
      topProducts: [VELVET_BLAZER.name],
    },
    {
      startingMood: "Underdressed",
      desiredFeeling: "Elegant",
      count: sc(15),
      achievedRate: 67,
      topProducts: [SILK_SLIP.name],
    },
    {
      startingMood: "Comfortable",
      desiredFeeling: "Effortless",
      count: sc(12),
      achievedRate: 75,
      topProducts: [LINEN.name],
    },
  ];
  const emotionalTransformations =
    dateRangeDays === 7  ? allTransformations.slice(0, 1) :
    dateRangeDays === 30 ? allTransformations.slice(0, 2) :
    allTransformations;

  // Products by emotional impact — scale with period
  const allProductImpact = [
    {
      productTitle: VELVET_BLAZER.name,
      avgConfidenceLift: VELVET_BLAZER.avgConfidenceLift,
      sampleSize: VELVET_BLAZER.sampleSize,
      achievedRate: 77,
      rewearRate: Math.round(VELVET_BLAZER.rewearRate * 100),
      desiredFeelings: VELVET_BLAZER.topDesiredFeelings,
    },
    {
      productTitle: LINEN.name,
      avgConfidenceLift: LINEN.avgConfidenceLift,
      sampleSize: LINEN.sampleSize,
      achievedRate: 75,
      rewearRate: Math.round(LINEN.rewearRate * 100),
      desiredFeelings: LINEN.topDesiredFeelings,
    },
    {
      productTitle: SILK_SLIP.name,
      avgConfidenceLift: SILK_SLIP.avgConfidenceLift,
      sampleSize: SILK_SLIP.sampleSize,
      achievedRate: 67,
      rewearRate: Math.round(SILK_SLIP.rewearRate * 100),
      desiredFeelings: SILK_SLIP.topDesiredFeelings,
    },
    {
      productTitle: TROUSERS.name,
      avgConfidenceLift: TROUSERS.avgConfidenceLift,
      sampleSize: TROUSERS.sampleSize,
      achievedRate: 58,
      rewearRate: Math.round(TROUSERS.rewearRate * 100),
      desiredFeelings: TROUSERS.topDesiredFeelings,
    },
    {
      productTitle: BIKER.name,
      avgConfidenceLift: BIKER.avgConfidenceLift,
      sampleSize: BIKER.sampleSize,
      achievedRate: 62,
      rewearRate: Math.round(BIKER.rewearRate * 100),
      desiredFeelings: BIKER.topDesiredFeelings,
    },
  ];
  const productsByEmotionalImpact =
    dateRangeDays === 7  ? allProductImpact.slice(0, 2) :
    dateRangeDays === 30 ? allProductImpact.slice(0, 3) :
    dateRangeDays === 90 ? allProductImpact.slice(0, 4) :
    allProductImpact;

  // Journey analytics — live for 30D+ only
  const journeyLive = dateRangeDays !== 7;
  const journeyAnalytics = journeyLive ? {
    status: "live",
    totalEvents: sc(312),
    avgTouchpointsBeforePurchase: null as null,
    dataContract: null as null,
    eventTypeCounts: {
      STYLING_SESSION: sessions,
      CLOSET_UPLOAD: sc(48),
      POST_OUTFIT_REVIEW: reviews,
    },
  } : {
    status: "insufficient-data",
    totalEvents: sc(312),
    avgTouchpointsBeforePurchase: null as null,
    dataContract: null as null,
    eventTypeCounts: {} as Record<string, number>,
  };

  // Opportunity feed — 7 items, confidence scaled by period
  const hiConf   = sessions >= 50 ? "high"   : sessions >= 15 ? "medium" : "low";
  const midConf  = sessions >= 15 ? "medium" : "low";
  const loConf   = sessions >= 10 ? "medium" : "low";

  const opportunityFeed = [
    {
      id: "workwear-confidence-gap",
      type: "customer-need",
      confidence: hiConf,
      estimatedCommercialRelevance: "high",
      insight: "37% of customers identify as Corporate Chic — yet work presentation is under-served by the current range",
      customerNeed: "Professional women need a styled system for high-stakes work moments, not just individual pieces",
      evidence: `14 Corporate Chic profiles · ${sc(24)} work-occasion sessions · ${VELVET_BLAZER.avgRating} avg blazer rating`,
      timePeriod: periodLabel,
      suggestedAction: "Design a curated 'Work Presentation System' — 3 pieces that layer and interchange for different corporate moments",
    },
    {
      id: "velvet-blazer-anchor",
      type: "product-opportunity",
      confidence: hiConf,
      estimatedCommercialRelevance: "high",
      insight: `The Velvet Blazer has the highest confidence lift (+${VELVET_BLAZER.avgConfidenceLift}) and rewear rate (${Math.round(VELVET_BLAZER.rewearRate * 100)}%) in the collection`,
      customerNeed: "A reliable styling anchor that works for multiple contexts without rethinking the whole outfit",
      evidence: `n=${VELVET_BLAZER.sampleSize} reviews · ${Math.round(VELVET_BLAZER.rewearRate * 100)}% rewear · 77% achieve "Confident" feeling`,
      timePeriod: periodLabel,
      suggestedAction: "Position as hero piece across all workwear and event styling. Commission editorial content showing 5 ways to wear it",
    },
    {
      id: "occasion-gap-work-presentation",
      type: "occasion-gap",
      confidence: midConf,
      estimatedCommercialRelevance: "medium",
      insight: "Work presentation is the second most requested occasion but has only 1 strongly-performing piece",
      customerNeed: "Customers need a complete outfit, not just one statement piece, for high-stakes presentations",
      evidence: `${sc(24)} work-occasion sessions · only ${VELVET_BLAZER.name} rated 4.0+ for this context`,
      timePeriod: periodLabel,
      suggestedAction: "Identify 2 complementary pieces that pair with The Velvet Blazer for a complete corporate system",
    },
    {
      id: "silk-dress-consideration-friction",
      type: "product-friction",
      confidence: midConf,
      estimatedCommercialRelevance: "medium",
      insight: `The Silk Slip Dress has high aspiration but ${Math.round((1 - SILK_SLIP.rewearRate) * 100) - (100 - Math.round(VELVET_BLAZER.rewearRate * 100))} points below-average rewear`,
      customerNeed: "Customers want to wear it but need permission or guidance to make it feel appropriate for more occasions",
      evidence: `n=${SILK_SLIP.sampleSize} reviews · ${Math.round(SILK_SLIP.rewearRate * 100)}% rewear vs ${Math.round(VELVET_BLAZER.rewearRate * 100)}% collection leader · Top objection: "${SILK_SLIP.mostCommonObjection}"`,
      timePeriod: periodLabel,
      suggestedAction: "Create 3 styling guides: Desk to Dinner, Weekend Gallery, Summer Wedding Guest",
    },
    {
      id: "length-objection-signal",
      type: "fit-signal",
      confidence: midConf,
      estimatedCommercialRelevance: "medium",
      insight: "Length objection appears disproportionately from the 11 petite-frame customers in the sample",
      customerNeed: "Petite customers want the wide-leg silhouette but need it styled for their proportions",
      evidence: `11 of 38 profiles with petite frame · ${sc(5)} length objections on ${TROUSERS.name}`,
      timePeriod: periodLabel,
      suggestedAction: "Introduce ankle-length option or petite guide. Add height context to recommendation logic for this piece",
    },
    {
      id: "post-wear-retention",
      type: "retention-signal",
      confidence: hiConf,
      estimatedCommercialRelevance: "high",
      insight: `83% of customers wore their recommended look — above-average retention signal across the collection`,
      customerNeed: "Customers want their nAia pieces to feel like reliable wardrobe members, not one-off purchases",
      evidence: `${sc(35)} post-wear positives from ${sc(42)} post-wear reviews · 83% wear rate`,
      timePeriod: periodLabel,
      suggestedAction: "Feature rewear stories in customer communications. Build a 'wear it again' prompt into the post-wear flow",
    },
    {
      id: "edgy-audience-underserved",
      type: "audience-gap",
      confidence: loConf,
      estimatedCommercialRelevance: "low",
      insight: "13% of profiles identify as Edgy but fewer than 2 pieces serve this personality strongly",
      customerNeed: "Edgy customers want pieces that match their self-expression without compromising quality",
      evidence: `5 Edgy profiles · only ${BIKER.name} rated well for this segment · score ${BIKER.opportunityScore}`,
      timePeriod: periodLabel,
      suggestedAction: "Evaluate whether Edgy is a target audience for this collection — if yes, commission 2 more pieces for this segment",
    },
  ];

  const advanced = {
    emotionalJourney: {
      status: "live",
      sampleSize: reviews,
      intendedFeelingAchievedRate: 71,
      partlyAchievedRate: 18,
      avgConfidenceBefore: 5.4,
      avgConfidenceAfter: 7.2,
      avgConfidenceLift: 1.8,
      postWearPositiveRate: 71,
      emotionalTransformations,
      productsByEmotionalImpact,
      moodDistribution: [
        { mood: "Uncertain",    count: sc(28) },
        { mood: "Underdressed", count: sc(19) },
        { mood: "Comfortable",  count: sc(15) },
        { mood: "Confident",    count: sc(12) },
      ],
    },
    collectionHealth: {
      score: 64,
      factorsAvailable: 5,
      factorsTotal: 8,
      factors: {
        recommendationCoverage: { score: 70, label: "7 unique products recommended", weight: 15 },
        moodCoverage:           { score: 56, label: "4 starting moods addressed",    weight: 15 },
        occasionCoverage:       { score: 65, label: "3 occasions with 3+ looks",     weight: 15 },
        colourCoverage:         { score: 58, label: "4 preferred colours matched",   weight: 10 },
        fitCoverage:            { score: 62, label: "2 fit types addressed",         weight: 10 },
        emotionalOutcomes:      { score: 71, label: "71% feeling achievement rate",  weight: 20 },
        commercialPerformance:  { score: null, label: "awaiting-integration",        weight: 10 },
        returns:                { score: null, label: "awaiting-integration",        weight: 5  },
      },
      largestWeakness: "moodCoverage",
      strongestArea: "emotionalOutcomes",
      sampleSizeWarning: sessions < 10,
      reviewCount: reviews,
    },
    collectionEvolution: {
      status: "live",
      current: {
        label: periodLabel,
        sessions,
        reviews,
        avgRating: dateRangeDays <= 7 ? 4.0 : 4.2,
        rewearRate: dateRangeDays <= 7 ? 70 : 76,
      },
      previous: {
        label: prevLabel,
        sessions: prevSessions,
        reviews: prevReviews,
        avgRating: dateRangeDays <= 7 ? 3.8 : 3.9,
        rewearRate: dateRangeDays <= 7 ? 65 : 68,
      },
      ratingTrend: "up",
      sessionsTrend: "up",
      trendSummary: dateRangeDays <= 7
        ? `Rating +0.2 vs prior ${dateRangeDays} days.`
        : "Rating improved by 0.3 and session volume increased 26%.",
    },
    trustMetrics: {
      status: sessions >= 10 ? "live" : "insufficient-data",
      sampleSize: sessions,
      selectionRate: 78,
      feedbackResponseRate: 61,
      loveRate: 59,
      disagreementRate: 12,
      repeatCustomers: sc(14),
      totalCustomersWithSessions: 38,
    },
    journeyAnalytics,
    ltv: { dataContract: null },
    explainability: { dataContract: null },
    opportunityScores: [
      {
        productTitle: VELVET_BLAZER.name,
        score: VELVET_BLAZER.opportunityScore,
        sampleSize: VELVET_BLAZER.sampleSize,
        breakdown: { emotionalImpact: 88, versatility: 79, repeatWear: 83, personalityCoverage: 72, recommendationFit: null },
      },
      {
        productTitle: LINEN.name,
        score: LINEN.opportunityScore,
        sampleSize: LINEN.sampleSize,
        breakdown: { emotionalImpact: 78, versatility: 72, repeatWear: 81, personalityCoverage: 68, recommendationFit: null },
      },
      {
        productTitle: SILK_SLIP.name,
        score: SILK_SLIP.opportunityScore,
        sampleSize: SILK_SLIP.sampleSize,
        breakdown: { emotionalImpact: 72, versatility: 55, repeatWear: 62, personalityCoverage: 60, recommendationFit: null },
      },
    ],
    predictive: {
      status: "insufficient-data",
      signals: [],
      disclaimer: "Sample data — predictive signals not shown in sample mode.",
    },
    opportunityFeed,
  };

  // ── rel ───────────────────────────────────────────────────────────────────────

  const relStatus = sessions >= 10 ? "live" : "insufficient-data";

  const dnaMatrix = [
    {
      personality: "Corporate Chic",
      sessionCount: sc(24),
      avgRating: 4.3,
      rewearRate: 0.79,
      avgConfidenceLift: 2.0,
      feelingAchievedRate: 75,
      topProducts: [VELVET_BLAZER.name, TROUSERS.name],
      topDesiredFeelings: ["Confident", "Elegant"],
      topOccasions: ["Work", "Events"],
      prescriptive: "Corporate Chic customers achieve their best outcomes when styled for structured work contexts with The Velvet Blazer as anchor.",
    },
    {
      personality: "Romantic",
      sessionCount: sc(18),
      avgRating: 4.0,
      rewearRate: 0.72,
      avgConfidenceLift: 1.6,
      feelingAchievedRate: 67,
      topProducts: [SILK_SLIP.name],
      topDesiredFeelings: ["Elegant", "Feminine"],
      topOccasions: ["Events", "Date night"],
      prescriptive: "Romantic customers respond best to softly draped pieces. Occasion ambiguity is reducing rewear — styling content would help.",
    },
    ...(sessions >= 20 ? [{
      personality: "Minimal",
      sessionCount: sc(14),
      avgRating: 4.2,
      rewearRate: 0.80,
      avgConfidenceLift: 1.7,
      feelingAchievedRate: 72,
      topProducts: [LINEN.name, TROUSERS.name],
      topDesiredFeelings: ["Effortless", "Put Together"],
      topOccasions: ["Everyday", "Casual weekend"],
      prescriptive: "Minimal customers have the highest rewear rate in the sample. Clean silhouettes and neutral tones consistently deliver their desired outcomes.",
    }] : []),
  ];

  const emotionalChain = [
    {
      currentMood: "Uncertain",
      desiredFeeling: "Confident",
      count: sc(22),
      achievedRate: 77,
      avgRating: 4.4,
      topProducts: [VELVET_BLAZER.name],
    },
    {
      currentMood: "Underdressed",
      desiredFeeling: "Elegant",
      count: sc(15),
      achievedRate: 67,
      avgRating: 4.1,
      topProducts: [SILK_SLIP.name],
    },
    ...(sessions >= 20 ? [{
      currentMood: "Comfortable",
      desiredFeeling: "Effortless",
      count: sc(12),
      achievedRate: 75,
      avgRating: 4.3,
      topProducts: [LINEN.name],
    }] : []),
  ];

  const occasionProductMatrix = [
    {
      occasion: "Work presentation",
      count: sc(18),
      avgRating: 4.2,
      successRate: 74,
      topPersonalities: ["Corporate Chic", "Effortlessly Chic"],
      topDesiredFeelings: ["Confident", "Powerful"],
      topProducts: [
        { name: VELVET_BLAZER.name, avgRating: 4.4 },
        { name: TROUSERS.name,      avgRating: 3.9 },
      ],
    },
    {
      occasion: "Date night",
      count: sc(12),
      avgRating: 4.1,
      successRate: 66,
      topPersonalities: ["Romantic", "Feminine"],
      topDesiredFeelings: ["Elegant", "Feminine"],
      topProducts: [
        { name: SILK_SLIP.name, avgRating: 4.1 },
      ],
    },
    {
      occasion: "Casual weekend",
      count: sc(15),
      avgRating: 4.0,
      successRate: 71,
      topPersonalities: ["Minimal", "Effortlessly Chic"],
      topDesiredFeelings: ["Comfortable", "Effortless"],
      topProducts: [
        { name: LINEN.name, avgRating: 4.3 },
        { name: BIKER.name, avgRating: 3.8 },
      ],
    },
  ];

  const productNarratives = [VELVET_BLAZER, LINEN, SILK_SLIP, TROUSERS, BIKER].map((p) => ({
    name: p.name,
    opportunityScore: p.opportunityScore,
    avgRating: p.avgRating,
    rewearRate: p.rewearRate,
    bestPersonality: p.bestPersonality,
    bestOccasion: p.bestOccasion,
    mostCommonObjection: p.mostCommonObjection,
    sampleSize: p.sampleSize,
    avgConfidenceLift: p.avgConfidenceLift,
    strongestTransformation: p.strongestTransformation,
    topDesiredFeelings: p.topDesiredFeelings,
    recommendation: p.recommendation,
    recommendationReason: p.recommendationReason,
  }));

  const rel = {
    status: relStatus,
    sampleSize: sessions,
    totalSessions: sessions,
    dnaMatrix,
    emotionalChain,
    occasionProductMatrix,
    productNarratives,
  };

  return { dashboard, kpis, phase4b2, advanced, rel };
}
