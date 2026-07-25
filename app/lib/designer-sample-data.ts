/**
 * DESIGNER_SAMPLE_DATA_ENABLED=true — staging/dev only.
 * Returns plausible-looking fixture data so the dashboard is reviewable
 * without real customer records. Never writes to the database.
 */

export function getDesignerSampleData() {
  const dashboard = {
    totalUsers: 42,
    totalLooks: 89,
    avgRating: 4.1,
    avgRewear: 0.73,
    avgAlignment: 0.81,
    onboarding: {
      totalProfiles: 38,
      styleDNADistribution: [
        { style: "classic", count: 14, percentage: 37 },
        { style: "romantic", count: 11, percentage: 29 },
        { style: "minimal", count: 8, percentage: 21 },
        { style: "bold", count: 5, percentage: 13 },
      ],
      desiredFeelings: [
        { feeling: "more-confident", count: 22, percentage: 58 },
        { feeling: "put-together", count: 15, percentage: 39 },
        { feeling: "elegant", count: 10, percentage: 26 },
        { feeling: "comfortable", count: 8, percentage: 21 },
      ],
      lifestyleDistribution: [
        { lifestyle: "event", count: 18, percentage: 47 },
        { lifestyle: "work", count: 14, percentage: 37 },
        { lifestyle: "everyday", count: 12, percentage: 32 },
        { lifestyle: "weekend", count: 9, percentage: 24 },
      ],
      colorDistribution: [
        { color: "navy", count: 20, percentage: 53 },
        { color: "black", count: 18, percentage: 47 },
        { color: "camel", count: 12, percentage: 32 },
        { color: "white", count: 10, percentage: 26 },
      ],
    },
    topOccasions: [
      { name: "Dressing for special events", lookCount: 31, avgRating: 4.3, rewear: 0.77, topPieces: ["The Velvet Blazer", "Silk Slip Dress"] },
      { name: "Work and professional settings", lookCount: 24, avgRating: 4.0, rewear: 0.71, topPieces: ["Tailored Trousers", "Linen Shirt"] },
      { name: "Everyday comfortable style", lookCount: 19, avgRating: 3.9, rewear: 0.68, topPieces: ["Jersey Wrap Dress"] },
    ],
    positiveTags: [
      { name: "Confidence", count: 34, topPieces: ["The Velvet Blazer", "Silk Slip Dress"] },
      { name: "Elegant", count: 27, topPieces: ["Crepe Midi Dress"] },
      { name: "Put together", count: 22, topPieces: ["Tailored Trousers"] },
    ],
    negativeTags: [
      { name: "Too formal", count: 8, topPieces: ["Structured Blazer"] },
      { name: "Not practical", count: 5, topPieces: ["Slip Dress"] },
    ],
    topObjections: [
      { name: "Too formal for the occasion", count: 8 },
      { name: "Not comfortable enough for all day", count: 6 },
      { name: "Colour doesn't suit me", count: 4 },
    ],
    stylingNeeds: [
      { occasion: "Casual weekend", need: "Casual weekend", count: 12 },
      { occasion: "Gym and activewear", need: "Gym and activewear", count: 7 },
    ],
    conversionStats: [
      {
        productTitle: "The Velvet Blazer",
        recommended: 18,
        clicked: 12,
        clickRate: 67,
        tryon: 8,
        tryonRate: 67,
        wishlisted: 5,
      },
    ],
    bodyPatterns: [
      {
        preference: "Petite frame",
        userCount: 11,
        bestPieces: ["Wrap Midi Dress", "High-Waist Trousers"],
        struggles: ["Oversized silhouettes can overwhelm"],
        implication: "Proportion-conscious styling is important for this group.",
      },
    ],
  };

  const kpis = {
    passport: { total: 38, completed: 31, completionRate: 82 },
    closet: { totalCustomers: 42, customersWithCloset: 28, adoptionRate: 67, totalItems: 196, avgItems: 7.0 },
    buyOrSkip: { total: 54, buy: 32, skip: 14, maybe: 8, buyRate: 59 },
    confidence: { sampleSize: 89, avgBefore: 5.4, avgAfter: 7.2, avgDelta: 1.8 },
    recentActivity: { sessions: 24, reviews: 18 },
  };

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
    },
    vtoMetrics: {
      migrationPending: false,
      totalJobs: 31,
      completedJobs: 28,
      completionRate: 90,
      vtoFeedbackCount: 18,
      fidelityConcernCount: 3,
      fidelityConcernRate: 17,
    },
    feedbackEngagement: {
      migrationPending: false,
      totalSessions: 67,
      sessionsWithFeedback: 41,
      responseRate: 61,
    },
    feedbackDistribution: {
      migrationPending: false,
      love: 24,
      okay: 12,
      notForMe: 5,
      total: 41,
    },
    objectionInsights: {
      migrationPending: false,
      colourObjections: 2,
      fitObjections: 1,
      tooRevealingObjections: 1,
      tooCoveredObjections: 0,
      tooFormalObjections: 3,
      tooCasualObjections: 1,
      notPracticalObjections: 2,
      alreadyOwnObjections: 1,
    },
    postWearCompletion: {
      migrationPending: false,
      totalWithPostWear: 42,
      didWearItYes: 35,
      wearRate: 83,
      feltPositive: 30,
      positiveExperienceRate: 71,
    },
    designerInsights: [
      {
        type: "objection",
        pattern: "Colour mismatch",
        frequency: 8,
        threshold: 5,
        suggestion: "Consider expanding navy and camel options — 53% of profiles prefer these tones.",
      },
    ],
  };

  const advanced = {
    emotionalJourney: {
      status: "live",
      sampleSize: 89,
      intendedFeelingAchievedRate: 71,
      partlyAchievedRate: 18,
      avgConfidenceBefore: 5.4,
      avgConfidenceAfter: 7.2,
      avgConfidenceLift: 1.8,
      postWearPositiveRate: 71,
      emotionalTransformations: [
        { from: "Uncertain", to: "Confident", count: 22, avgRating: 4.4, topProducts: ["The Velvet Blazer"] },
        { from: "Underdressed", to: "Elegant", count: 15, avgRating: 4.2, topProducts: ["Crepe Midi Dress"] },
      ],
      productsByEmotionalImpact: [
        { product: "The Velvet Blazer", avgLift: 2.1, sessions: 18, feeling: "Confident" },
        { product: "Crepe Midi Dress", avgLift: 1.7, sessions: 12, feeling: "Elegant" },
      ],
      moodDistribution: [
        { mood: "Uncertain", count: 28 },
        { mood: "Underdressed", count: 19 },
        { mood: "Comfortable", count: 15 },
        { mood: "Confident", count: 12 },
      ],
    },
    collectionHealth: {
      score: 64,
      factorsAvailable: 5,
      factorsTotal: 8,
      factors: {
        recommendationCoverage: { score: 70, label: "7 unique products recommended", weight: 15 },
        moodCoverage: { score: 56, label: "4 starting moods addressed", weight: 15 },
        occasionCoverage: { score: 65, label: "3 occasions with 3+ looks", weight: 15 },
        colourCoverage: { score: 58, label: "4 preferred colours matched", weight: 10 },
        fitCoverage: { score: 62, label: "2 fit types addressed", weight: 10 },
        emotionalOutcomes: { score: 71, label: "71% feeling achievement rate", weight: 20 },
        commercialPerformance: { score: null, label: "awaiting-integration", weight: 10 },
        returns: { score: null, label: "awaiting-integration", weight: 5 },
      },
      largestWeakness: "moodCoverage",
      strongestArea: "emotionalOutcomes",
      sampleSizeWarning: false,
      reviewCount: 89,
    },
    collectionEvolution: {
      status: "live",
      current: { label: "Last 30 days", sessions: 24, reviews: 18, avgRating: 4.2, rewearRate: 76 },
      previous: { label: "Previous 30 days", sessions: 19, reviews: 14, avgRating: 3.9, rewearRate: 68 },
      ratingTrend: "up",
      sessionsTrend: "up",
      trendSummary: "Rating improved by 0.3 and session volume increased 26%.",
    },
    trustMetrics: {
      status: "live",
      sampleSize: 67,
      selectionRate: 78,
      feedbackResponseRate: 61,
      loveRate: 59,
      disagreementRate: 12,
      repeatCustomers: 14,
      totalCustomersWithSessions: 38,
    },
    journeyAnalytics: {
      status: "live",
      totalEvents: 312,
      avgTouchpointsBeforePurchase: null,
      dataContract: null,
    },
    ltv: { dataContract: null },
    explainability: { dataContract: null },
    opportunityScores: [
      {
        productTitle: "The Velvet Blazer",
        score: 82,
        sampleSize: 18,
        breakdown: { emotionalImpact: 88, versatility: 79, repeatWear: 83, personalityCoverage: 72, recommendationFit: null },
      },
      {
        productTitle: "Crepe Midi Dress",
        score: 71,
        sampleSize: 12,
        breakdown: { emotionalImpact: 75, versatility: 68, repeatWear: 72, personalityCoverage: 65, recommendationFit: null },
      },
    ],
    predictive: {
      status: "insufficient-data",
      signals: [],
      disclaimer: "Sample data — predictive signals not shown in sample mode.",
    },
  };

  const rel = {
    status: "live",
    sampleSize: 67,
    totalSessions: 67,
    dnaMatrix: [
      {
        personality: "Classic",
        sessionCount: 24,
        avgRating: 4.3,
        avgRewear: 0.79,
        avgConfidenceLift: 2.0,
        desiredFeelingAchievedRate: 75,
        topProducts: ["The Velvet Blazer", "Tailored Trousers"],
        topDesiredFeelings: ["Confident", "Elegant"],
        topOccasions: ["Work", "Events"],
      },
      {
        personality: "Romantic",
        sessionCount: 18,
        avgRating: 4.0,
        avgRewear: 0.72,
        avgConfidenceLift: 1.6,
        desiredFeelingAchievedRate: 67,
        topProducts: ["Silk Slip Dress", "Floral Wrap Dress"],
        topDesiredFeelings: ["Feminine", "Confident"],
        topOccasions: ["Events", "Date night"],
      },
    ],
    emotionalChain: [
      {
        currentMood: "Uncertain",
        desiredFeeling: "Confident",
        count: 22,
        achievedRate: 77,
        topProducts: ["The Velvet Blazer"],
      },
      {
        currentMood: "Underdressed",
        desiredFeeling: "Elegant",
        count: 15,
        achievedRate: 67,
        topProducts: ["Crepe Midi Dress"],
      },
    ],
    occasionProductMatrix: [
      {
        occasion: "Dressing for special events",
        sessionCount: 31,
        avgRating: 4.3,
        topProducts: ["The Velvet Blazer", "Silk Slip Dress"],
      },
    ],
    productNarratives: [
      {
        name: "The Velvet Blazer",
        opportunityScore: 82,
        avgRating: 4.4,
        rewearRate: 0.83,
        bestPersonality: "Classic",
        bestOccasion: "Events",
        mostCommonObjection: null,
        sampleSize: 18,
      },
      {
        name: "Crepe Midi Dress",
        opportunityScore: 71,
        avgRating: 4.1,
        rewearRate: 0.72,
        bestPersonality: "Romantic",
        bestOccasion: "Date night",
        mostCommonObjection: "Too formal for everyday",
        sampleSize: 12,
      },
    ],
  };

  return { dashboard, kpis, phase4b2, advanced, rel };
}
