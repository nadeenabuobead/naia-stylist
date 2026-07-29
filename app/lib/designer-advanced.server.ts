// app/lib/designer-advanced.server.ts
// Advanced intelligence KPIs for the Designer Dashboard.
// Phases A–L as specified. Queries are narrow selects only — no full includes.
// Privacy: no customer names, emails, photos, raw feedback text, signed URLs.
// Each section carries a `status` field so the dashboard renders correctly
// at any stage of data availability.

import prisma from "~/db.server";

// ── Status type ────────────────────────────────────────────────────────────────
export type KPIStatus = "live" | "awaiting-integration" | "insufficient-data" | "experimental";

// ── A. Emotional Journey Intelligence ─────────────────────────────────────────
export interface EmotionalTransformation {
  startingMood: string;
  desiredFeeling: string;
  achievedRate: number; // 0–100
  count: number;
}

export interface ProductEmotionalImpact {
  productTitle: string;
  desiredFeelings: string[];
  achievedRate: number; // 0–100 — desiredFeelingAchieved === "Yes"
  avgConfidenceLift: number;
  rewearRate: number;
  sampleSize: number;
}

export interface EmotionalJourneyKPI {
  status: KPIStatus;
  sampleSize: number;
  moodDistribution: Array<{ mood: string; count: number }>;
  desiredFeelingDistribution: Array<{ feeling: string; count: number }>;
  intendedFeelingAchievedRate: number | null; // % Yes from desiredFeelingAchieved
  partlyAchievedRate: number | null;
  avgConfidenceBefore: number | null;
  avgConfidenceAfter: number | null;
  avgConfidenceLift: number | null;
  postWearPositiveRate: number | null;
  postWearSampleSize: number;
  emotionalTransformations: EmotionalTransformation[];
  productsByEmotionalImpact: ProductEmotionalImpact[];
}

// ── B. Customer Journey Analytics ─────────────────────────────────────────────
export interface JourneyAnalyticsKPI {
  status: KPIStatus;
  totalEvents: number;
  eventTypeCounts: Record<string, number>;
  dataContract: {
    requiredEvents: string[];
    description: string;
  };
}

// ── C. LTV Intelligence ────────────────────────────────────────────────────────
export interface LTVKpi {
  status: "awaiting-integration";
  dataContract: {
    requiredIntegrations: string[];
    events: string[];
  };
}

// ── D. Collection Evolution ────────────────────────────────────────────────────
export interface CollectionPeriodMetrics {
  label: string;
  sessions: number;
  reviews: number;
  avgRating: number | null;
  rewearRate: number | null;
  feedbackResponseRate: number | null;
}

export interface CollectionEvolutionKPI {
  status: KPIStatus;
  current: CollectionPeriodMetrics;
  previous: CollectionPeriodMetrics;
  ratingTrend: "improving" | "stable" | "declining" | null;
  sessionsTrend: "growing" | "stable" | "declining" | null;
}

// ── E. AI Learning Dashboard ───────────────────────────────────────────────────
export interface AILearningKPI {
  status: "awaiting-integration";
  dataContract: { requiredTables: string[]; description: string };
}

// ── F. Trust Metrics ──────────────────────────────────────────────────────────
export interface TrustMetricsKPI {
  status: KPIStatus;
  sampleSize: number;
  selectionRate: number;        // % sessions with selectedSuggestionId set
  repeatUsageRate: number;      // % customers with >1 session
  feedbackResponseRate: number; // from RecommendationFeedback
  disagreementRate: number;     // not-for-me rate from feedback
  loveRate: number;
  repeatCustomers: number;
  totalCustomersWithSessions: number;
}

// ── G. Experimentation ────────────────────────────────────────────────────────
export interface ExperimentationKPI {
  status: "awaiting-integration";
  dataContract: { requiredTable: string; fields: string[] };
}

// ── H. Predictive Intelligence ────────────────────────────────────────────────
export interface PredictiveSignal {
  type: "occasion" | "mood" | "feeling" | "product";
  label: string;
  evidence: string;
  confidence: "very-low" | "low" | "medium";
  sampleSize: number;
  period: string;
}

export interface PredictiveKPI {
  status: KPIStatus;
  signals: PredictiveSignal[];
  disclaimer: string;
}

// ── I. Commercial Opportunity Score ───────────────────────────────────────────
export interface ProductOpportunityScore {
  productTitle: string;
  score: number | null; // 0–100, null if insufficient data
  breakdown: {
    emotionalImpact: number | null;   // 0–25 from rating × rewear
    versatility: number | null;       // 0–15 from occasion breadth
    repeatWear: number | null;        // 0–20 from rewear rate
    personalityCoverage: number | null; // 0–15 from DNA breadth
    recommendationFit: number | null; // 0–25 from love feedback rate
    conversion: "awaiting-integration";
    saveIntent: "awaiting-integration";
  };
  sampleSize: number;
  insufficientData: boolean;
  missingFactors: string[];
}

// ── J. Collection Health Score ────────────────────────────────────────────────
export interface CollectionHealthScore {
  score: number | null; // 0–100 partial, null if no data
  factorsAvailable: number;
  factorsTotal: number;
  factors: {
    recommendationCoverage: { score: number | null; label: string; weight: number };
    moodCoverage: { score: number | null; label: string; weight: number };
    occasionCoverage: { score: number | null; label: string; weight: number };
    colourCoverage: { score: number | null; label: string; weight: number };
    fitCoverage: { score: number | null; label: string; weight: number };
    emotionalOutcomes: { score: number | null; label: string; weight: number };
    commercialPerformance: { score: null; label: "awaiting-integration"; weight: number };
    returns: { score: null; label: "awaiting-integration"; weight: number };
  };
  largestWeakness: string | null;
  strongestArea: string | null;
  sampleSizeWarning: boolean;
  reviewCount: number;
}

// ── K. Designer Opportunity Feed ───────────────────────────────────────────────
export interface DesignerOpportunity {
  id: string;
  insight: string;
  customerSegment: string;
  customerNeed: string;
  evidence: string;
  affectedProducts: string[];
  estimatedCommercialRelevance: "high" | "medium" | "low" | "unknown";
  confidence: "high" | "medium" | "low";
  timePeriod: string;
  suggestedAction: string;
  status: "new" | "reviewing" | "actioned" | "dismissed";
}

// ── L. Recommendation Explainability ─────────────────────────────────────────
export interface ExplainabilityKPI {
  status: "awaiting-integration";
  dataContract: { requiredFields: string[]; description: string };
}

// ── Master return type ────────────────────────────────────────────────────────
export interface AdvancedKPIs {
  emotionalJourney: EmotionalJourneyKPI;
  journeyAnalytics: JourneyAnalyticsKPI;
  ltv: LTVKpi;
  collectionEvolution: CollectionEvolutionKPI;
  aiLearning: AILearningKPI;
  trustMetrics: TrustMetricsKPI;
  experimentation: ExperimentationKPI;
  predictive: PredictiveKPI;
  opportunityScores: ProductOpportunityScore[];
  collectionHealth: CollectionHealthScore;
  opportunityFeed: DesignerOpportunity[];
  explainability: ExplainabilityKPI;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function freq<T extends string | null | undefined>(
  arr: T[],
): Array<{ key: string; count: number }> {
  const map: Record<string, number> = {};
  for (const v of arr) {
    if (v) map[v] = (map[v] || 0) + 1;
  }
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

// ── A. Emotional Journey ──────────────────────────────────────────────────────
async function getEmotionalJourney(dateFrom: Date): Promise<EmotionalJourneyKPI> {
  try {
    // Fetch session + review pairs with emotional fields
    const reviews = await prisma.postOutfitReview.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: {
        overallFeeling: true,
        desiredFeelingAchieved: true,
        wouldWearAgain: true,
        confidenceBefore: true,
        confidenceAfter: true,
        didWearIt: true,
        feelingAnswer: true,
        session: {
          select: {
            currentMood: true,
            desiredFeeling: true,
            suggestions: {
              select: {
                items: {
                  select: {
                    productTitle: true,
                    closetItemId: true,
                    shopifyProductId: true,
                  },
                },
              },
              where: { selected: true },
              take: 1,
            },
          },
        },
      },
    });

    const n = reviews.length;
    // Minimum 5 reviewed sessions required for emotional journey signals.
    if (n < 5) {
      return {
        status: "insufficient-data",
        sampleSize: n,
        moodDistribution: [],
        desiredFeelingDistribution: [],
        intendedFeelingAchievedRate: null,
        partlyAchievedRate: null,
        avgConfidenceBefore: null,
        avgConfidenceAfter: null,
        avgConfidenceLift: null,
        postWearPositiveRate: null,
        postWearSampleSize: 0,
        emotionalTransformations: [],
        productsByEmotionalImpact: [],
      };
    }

    const moods = freq(reviews.map((r) => r.session?.currentMood));
    const feelings = freq(reviews.map((r) => r.session?.desiredFeeling));

    const withAchieved = reviews.filter((r) => r.desiredFeelingAchieved);
    const achievedYes = withAchieved.filter((r) => r.desiredFeelingAchieved === "Yes").length;
    const achievedPartly = withAchieved.filter((r) => r.desiredFeelingAchieved === "Partly").length;

    const withConf = reviews.filter(
      (r) => r.confidenceBefore != null && r.confidenceAfter != null,
    );
    const avgBefore =
      withConf.length > 0
        ? withConf.reduce((s, r) => s + r.confidenceBefore!, 0) / withConf.length
        : null;
    const avgAfter =
      withConf.length > 0
        ? withConf.reduce((s, r) => s + r.confidenceAfter!, 0) / withConf.length
        : null;

    const postWear = reviews.filter((r) => (r as any).didWearIt != null);
    const postWearPositive = postWear.filter(
      (r) => (r as any).feelingAnswer === "great" || (r as any).feelingAnswer === "good",
    ).length;

    // Emotional transformations (mood → desired feeling → achieved rate)
    const transformMap: Record<string, { yes: number; total: number }> = {};
    for (const r of reviews) {
      const mood = r.session?.currentMood;
      const feeling = r.session?.desiredFeeling;
      if (!mood || !feeling) continue;
      const key = `${mood}→${feeling}`;
      if (!transformMap[key]) transformMap[key] = { yes: 0, total: 0 };
      transformMap[key].total++;
      if (r.desiredFeelingAchieved === "Yes") transformMap[key].yes++;
    }
    const emotionalTransformations: EmotionalTransformation[] = Object.entries(transformMap)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([key, v]) => {
        const [startingMood, desiredFeeling] = key.split("→");
        return {
          startingMood,
          desiredFeeling,
          achievedRate: pct(v.yes, v.total),
          count: v.total,
        };
      });

    // Product emotional impact
    const productMap: Record<
      string,
      { feelings: string[]; achieved: number; total: number; confidenceDeltas: number[]; rewearYes: number; rewearTotal: number }
    > = {};

    for (const r of reviews) {
      const feeling = r.session?.desiredFeeling;
      const items = r.session?.suggestions?.[0]?.items ?? [];
      const naiaItems = items.filter(
        (i) => !i.closetItemId && i.shopifyProductId && i.productTitle,
      );
      for (const item of naiaItems) {
        const name = item.productTitle!;
        if (!productMap[name]) {
          productMap[name] = { feelings: [], achieved: 0, total: 0, confidenceDeltas: [], rewearYes: 0, rewearTotal: 0 };
        }
        const entry = productMap[name];
        if (feeling) entry.feelings.push(feeling);
        entry.total++;
        if (r.desiredFeelingAchieved === "Yes") entry.achieved++;
        if (r.confidenceBefore != null && r.confidenceAfter != null) {
          entry.confidenceDeltas.push(r.confidenceAfter - r.confidenceBefore);
        }
        entry.rewearTotal++;
        if (r.wouldWearAgain === "Definitely") entry.rewearYes++;
      }
    }

    const productsByEmotionalImpact: ProductEmotionalImpact[] = Object.entries(productMap)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => b[1].achieved / b[1].total - a[1].achieved / a[1].total)
      .slice(0, 10)
      .map(([productTitle, v]) => ({
        productTitle,
        desiredFeelings: [...new Set(v.feelings)].slice(0, 3),
        achievedRate: pct(v.achieved, v.total),
        avgConfidenceLift:
          v.confidenceDeltas.length > 0
            ? parseFloat(
                (v.confidenceDeltas.reduce((a, b) => a + b, 0) / v.confidenceDeltas.length).toFixed(1),
              )
            : 0,
        rewearRate: v.rewearTotal > 0 ? pct(v.rewearYes, v.rewearTotal) : 0,
        sampleSize: v.total,
      }));

    return {
      status: "live",
      sampleSize: n,
      moodDistribution: moods.map((m) => ({ mood: m.key, count: m.count })),
      desiredFeelingDistribution: feelings.map((f) => ({ feeling: f.key, count: f.count })),
      intendedFeelingAchievedRate: withAchieved.length >= 3 ? pct(achievedYes, withAchieved.length) : null,
      partlyAchievedRate: withAchieved.length >= 3 ? pct(achievedPartly, withAchieved.length) : null,
      avgConfidenceBefore: avgBefore != null ? parseFloat(avgBefore.toFixed(1)) : null,
      avgConfidenceAfter: avgAfter != null ? parseFloat(avgAfter.toFixed(1)) : null,
      avgConfidenceLift:
        avgBefore != null && avgAfter != null
          ? parseFloat((avgAfter - avgBefore).toFixed(1))
          : null,
      postWearPositiveRate: postWear.length >= 3 ? pct(postWearPositive, postWear.length) : null,
      postWearSampleSize: postWear.length,
      emotionalTransformations,
      productsByEmotionalImpact,
    };
  } catch (e) {
    console.error("AdvancedKPIs: emotionalJourney failed", e);
    return {
      status: "insufficient-data",
      sampleSize: 0,
      moodDistribution: [],
      desiredFeelingDistribution: [],
      intendedFeelingAchievedRate: null,
      partlyAchievedRate: null,
      avgConfidenceBefore: null,
      avgConfidenceAfter: null,
      avgConfidenceLift: null,
      postWearPositiveRate: null,
      postWearSampleSize: 0,
      emotionalTransformations: [],
      productsByEmotionalImpact: [],
    };
  }
}

// ── B. Journey Analytics ──────────────────────────────────────────────────────
async function getJourneyAnalytics(dateFrom: Date): Promise<JourneyAnalyticsKPI> {
  try {
    const events = await prisma.journeyEvent.findMany({
      where: { occurredAt: { gte: dateFrom } },
      select: { type: true },
    });

    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;

    return {
      status: events.length >= 5 ? "live" : "insufficient-data",
      totalEvents: events.length,
      eventTypeCounts: counts,
      dataContract: {
        requiredEvents: [
          "session_started",
          "recommendation_served",
          "feedback_given",
          "vto_initiated",
          "vto_feedback_given",
          "post_wear_submitted",
          "product_intelligence_viewed",
          // Future: cart_added, checkout_started, order_placed, product_page_viewed, saved_look_created
        ],
        description:
          "Full journey mapping (Passport → StyleMe → Saved Look → Return → Purchase) requires cart_added, checkout_started, and order_placed events from Shopify webhooks.",
      },
    };
  } catch (e) {
    console.error("AdvancedKPIs: journeyAnalytics failed", e);
    return {
      status: "insufficient-data",
      totalEvents: 0,
      eventTypeCounts: {},
      dataContract: {
        requiredEvents: ["cart_added", "checkout_started", "order_placed"],
        description: "JourneyEvent table may not be applied — run migration 20260718000000.",
      },
    };
  }
}

// ── D. Collection Evolution ────────────────────────────────────────────────────
async function getCollectionEvolution(
  dateFrom: Date,
  dateRangeDays: number,
): Promise<CollectionEvolutionKPI> {
  try {
    const previousFrom = new Date(dateFrom);
    previousFrom.setDate(previousFrom.getDate() - dateRangeDays);

    const [currSessions, currReviews, prevSessions, prevReviews] = await Promise.all([
      prisma.stylingSession.count({ where: { createdAt: { gte: dateFrom } } }),
      prisma.postOutfitReview.findMany({
        where: { createdAt: { gte: dateFrom } },
        select: { overallFeeling: true, wouldWearAgain: true },
      }),
      prisma.stylingSession.count({ where: { createdAt: { gte: previousFrom, lt: dateFrom } } }),
      prisma.postOutfitReview.findMany({
        where: { createdAt: { gte: previousFrom, lt: dateFrom } },
        select: { overallFeeling: true, wouldWearAgain: true },
      }),
    ]);

    const avgRating = (rs: typeof currReviews) =>
      rs.length > 0 ? parseFloat((rs.reduce((s, r) => s + (r.overallFeeling ?? 0), 0) / rs.length).toFixed(2)) : null;
    // Denominator: only reviews where the field was answered (stated rewear intent).
    const rewearRate = (rs: typeof currReviews) => {
      const answered = rs.filter((r) => r.wouldWearAgain !== null && r.wouldWearAgain !== undefined);
      return answered.length > 0 ? pct(answered.filter((r) => r.wouldWearAgain === "Definitely").length, answered.length) : null;
    };

    const currRating = avgRating(currReviews);
    const prevRating = avgRating(prevReviews);

    let ratingTrend: CollectionEvolutionKPI["ratingTrend"] = null;
    if (currRating != null && prevRating != null) {
      const diff = currRating - prevRating;
      ratingTrend = diff > 0.2 ? "improving" : diff < -0.2 ? "declining" : "stable";
    }

    let sessionsTrend: CollectionEvolutionKPI["sessionsTrend"] = null;
    if (currSessions > 0 && prevSessions > 0) {
      const ratio = currSessions / prevSessions;
      sessionsTrend = ratio > 1.1 ? "growing" : ratio < 0.9 ? "declining" : "stable";
    }

    const periodLabel = (from: Date, to: Date) =>
      `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

    const now = new Date();
    return {
      status: currReviews.length >= 3 || currSessions >= 3 ? "live" : "insufficient-data",
      current: {
        label: periodLabel(dateFrom, now),
        sessions: currSessions,
        reviews: currReviews.length,
        avgRating: currRating,
        rewearRate: rewearRate(currReviews),
        feedbackResponseRate: null, // needs join — reported separately from phase4b2
      },
      previous: {
        label: periodLabel(previousFrom, dateFrom),
        sessions: prevSessions,
        reviews: prevReviews.length,
        avgRating: prevRating,
        rewearRate: rewearRate(prevReviews),
        feedbackResponseRate: null,
      },
      ratingTrend,
      sessionsTrend,
    };
  } catch (e) {
    console.error("AdvancedKPIs: collectionEvolution failed", e);
    return {
      status: "insufficient-data",
      current: { label: "Current period", sessions: 0, reviews: 0, avgRating: null, rewearRate: null, feedbackResponseRate: null },
      previous: { label: "Previous period", sessions: 0, reviews: 0, avgRating: null, rewearRate: null, feedbackResponseRate: null },
      ratingTrend: null,
      sessionsTrend: null,
    };
  }
}

// ── F. Trust Metrics ──────────────────────────────────────────────────────────
async function getTrustMetrics(dateFrom: Date): Promise<TrustMetricsKPI> {
  try {
    const sessions = await prisma.stylingSession.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: { customerId: true, selectedSuggestionId: true },
    });

    const total = sessions.length;
    const selected = sessions.filter((s) => s.selectedSuggestionId != null).length;

    // Repeat customers
    const customerSessionCounts: Record<string, number> = {};
    for (const s of sessions) {
      customerSessionCounts[s.customerId] = (customerSessionCounts[s.customerId] || 0) + 1;
    }
    const uniqueCustomers = Object.keys(customerSessionCounts).length;
    const repeatCustomers = Object.values(customerSessionCounts).filter((c) => c > 1).length;

    // Feedback rates (from RecommendationFeedback)
    let feedbackResponseRate = 0;
    let disagreementRate = 0;
    let loveRate = 0;
    try {
      const feedback = await (prisma as any).recommendationFeedback.findMany({
        where: { createdAt: { gte: dateFrom } },
        select: { rating: true, sessionId: true },
      });
      const feedbackSessionIds = new Set(feedback.map((f: any) => f.sessionId).filter(Boolean));
      feedbackResponseRate = total > 0 ? pct(feedbackSessionIds.size, total) : 0;
      const totalFeedback = feedback.length;
      const notForMe = feedback.filter((f: any) => f.rating === "not-for-me").length;
      const love = feedback.filter((f: any) => f.rating === "love").length;
      disagreementRate = totalFeedback > 0 ? pct(notForMe, totalFeedback) : 0;
      loveRate = totalFeedback > 0 ? pct(love, totalFeedback) : 0;
    } catch {
      // RecommendationFeedback migration may not be applied — acceptable
    }

    return {
      status: total >= 5 ? "live" : "insufficient-data",
      sampleSize: total,
      selectionRate: total > 0 ? pct(selected, total) : 0,
      repeatUsageRate: uniqueCustomers > 0 ? pct(repeatCustomers, uniqueCustomers) : 0,
      feedbackResponseRate,
      disagreementRate,
      loveRate,
      repeatCustomers,
      totalCustomersWithSessions: uniqueCustomers,
    };
  } catch (e) {
    console.error("AdvancedKPIs: trustMetrics failed", e);
    return {
      status: "insufficient-data",
      sampleSize: 0,
      selectionRate: 0,
      repeatUsageRate: 0,
      feedbackResponseRate: 0,
      disagreementRate: 0,
      loveRate: 0,
      repeatCustomers: 0,
      totalCustomersWithSessions: 0,
    };
  }
}

// ── H. Predictive Intelligence ────────────────────────────────────────────────
async function getPredictive(dateFrom: Date): Promise<PredictiveKPI> {
  try {
    // Split date range in half to compare recent vs earlier
    const midpoint = new Date((dateFrom.getTime() + Date.now()) / 2);

    const [recentSessions, earlierSessions] = await Promise.all([
      prisma.stylingSession.findMany({
        where: { createdAt: { gte: midpoint } },
        select: { occasion: true, currentMood: true, desiredFeeling: true },
      }),
      prisma.stylingSession.findMany({
        where: { createdAt: { gte: dateFrom, lt: midpoint } },
        select: { occasion: true, currentMood: true, desiredFeeling: true },
      }),
    ]);

    const signals: PredictiveSignal[] = [];

    // Occasions growing in the recent half
    const recentOccasions = freq(recentSessions.map((s) => s.occasion));
    const earlierOccasions: Record<string, number> = {};
    for (const s of earlierSessions) {
      if (s.occasion) earlierOccasions[s.occasion] = (earlierOccasions[s.occasion] || 0) + 1;
    }

    for (const { key: occasion, count: recentCount } of recentOccasions.slice(0, 5)) {
      const prevCount = earlierOccasions[occasion] ?? 0;
      if (recentCount > prevCount + 1 && recentCount >= 3) {
        signals.push({
          type: "occasion",
          label: occasion,
          evidence: `${recentCount} requests in recent period vs ${prevCount} earlier`,
          confidence: recentCount >= 5 ? "low" : "very-low",
          sampleSize: recentCount,
          period: "recent half of selected date range",
        });
      }
    }

    // Moods growing
    const recentMoods = freq(recentSessions.map((s) => s.currentMood));
    const earlierMoods: Record<string, number> = {};
    for (const s of earlierSessions) {
      if (s.currentMood) earlierMoods[s.currentMood] = (earlierMoods[s.currentMood] || 0) + 1;
    }
    for (const { key: mood, count: recentCount } of recentMoods.slice(0, 5)) {
      const prevCount = earlierMoods[mood] ?? 0;
      if (recentCount > prevCount + 1 && recentCount >= 3) {
        signals.push({
          type: "mood",
          label: mood,
          evidence: `${recentCount} styling requests starting from "${mood}" mood, up from ${prevCount}`,
          confidence: "very-low",
          sampleSize: recentCount,
          period: "recent half of selected date range",
        });
      }
    }

    return {
      status: signals.length > 0 ? "experimental" : "insufficient-data",
      signals: signals.slice(0, 8),
      disclaimer:
        "All predictive signals are experimental. Confidence is very low until each signal has 20+ data points. Never act on these signals alone — cross-reference with broader sales and customer feedback data.",
    };
  } catch (e) {
    console.error("AdvancedKPIs: predictive failed", e);
    return {
      status: "insufficient-data",
      signals: [],
      disclaimer: "Insufficient data to generate predictive signals for this period.",
    };
  }
}

// ── I. Commercial Opportunity Scores ─────────────────────────────────────────
async function getOpportunityScores(dateFrom: Date): Promise<ProductOpportunityScore[]> {
  try {
    const reviews = await prisma.postOutfitReview.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: {
        overallFeeling: true,
        wouldWearAgain: true,
        desiredFeelingAchieved: true,
        session: {
          select: {
            occasion: true,
            styleDNA: true,
            suggestions: {
              select: {
                items: {
                  select: {
                    productTitle: true,
                    closetItemId: true,
                    shopifyProductId: true,
                  },
                },
              },
              where: { selected: true },
              take: 1,
            },
          },
        },
      },
    });

    const map: Record<
      string,
      {
        ratings: number[];
        rewearYes: number;
        rewearTotal: number;
        occasions: Set<string>;
        dnaTokens: string[];
        achievedYes: number;
        achievedTotal: number;
      }
    > = {};

    for (const r of reviews) {
      const items = r.session?.suggestions?.[0]?.items ?? [];
      for (const item of items) {
        if (!item.productTitle || item.closetItemId || !item.shopifyProductId) continue;
        const name = item.productTitle;
        if (!map[name]) {
          map[name] = {
            ratings: [],
            rewearYes: 0,
            rewearTotal: 0,
            occasions: new Set(),
            dnaTokens: [],
            achievedYes: 0,
            achievedTotal: 0,
          };
        }
        const e = map[name];
        if (r.overallFeeling) e.ratings.push(r.overallFeeling);
        e.rewearTotal++;
        if (r.wouldWearAgain === "Definitely") e.rewearYes++;
        if (r.session?.occasion) e.occasions.add(r.session.occasion);
        if (r.session?.styleDNA) {
          try {
            const dna = JSON.parse(r.session.styleDNA as string);
            if (Array.isArray(dna)) e.dnaTokens.push(...dna);
          } catch {}
        }
        if (r.desiredFeelingAchieved != null) {
          e.achievedTotal++;
          if (r.desiredFeelingAchieved === "Yes") e.achievedYes++;
        }
      }
    }

    // Get feedback love rates
    const feedbackMap: Record<string, { love: number; total: number }> = {};
    try {
      const feedback = await (prisma as any).recommendationFeedback.findMany({
        where: { createdAt: { gte: dateFrom }, shopifyProductId: { not: null } },
        select: { shopifyProductId: true, rating: true, target: true },
      });
      for (const f of feedback) {
        const pid = f.shopifyProductId as string;
        if (!feedbackMap[pid]) feedbackMap[pid] = { love: 0, total: 0 };
        feedbackMap[pid].total++;
        if (f.rating === "love") feedbackMap[pid].love++;
      }
    } catch {}

    const results: ProductOpportunityScore[] = [];
    const ALL_OCCASIONS = new Set(Object.values(map).flatMap((v) => [...v.occasions]));
    const ALL_DNA = new Set(Object.values(map).flatMap((v) => v.dnaTokens));

    for (const [productTitle, data] of Object.entries(map)) {
      const sampleSize = data.rewearTotal;
      const insufficient = sampleSize < 3;

      const avgRating =
        data.ratings.length > 0
          ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length
          : null;
      const rewearRate = sampleSize > 0 ? data.rewearYes / sampleSize : null;

      // Emotional impact: rating × rewear, normalized to 0–25
      const emotionalImpact =
        avgRating != null && rewearRate != null
          ? parseFloat(((avgRating / 5) * rewearRate * 25).toFixed(1))
          : null;

      // Versatility: occasion breadth, 0–15
      const versatility =
        ALL_OCCASIONS.size > 0
          ? parseFloat(((data.occasions.size / Math.min(ALL_OCCASIONS.size, 8)) * 15).toFixed(1))
          : null;

      // Repeat wear: 0–20
      const repeatWear = rewearRate != null ? parseFloat((rewearRate * 20).toFixed(1)) : null;

      // Personality coverage: 0–15
      const uniqueDNA = new Set(data.dnaTokens);
      const personalityCoverage =
        ALL_DNA.size > 0 && uniqueDNA.size > 0
          ? parseFloat(((uniqueDNA.size / Math.min(ALL_DNA.size, 6)) * 15).toFixed(1))
          : null;

      // Recommendation fit from feedback: 0–25
      const fbEntry = feedbackMap[productTitle];
      const recommendationFit =
        fbEntry && fbEntry.total >= 3
          ? parseFloat(((fbEntry.love / fbEntry.total) * 25).toFixed(1))
          : null;

      const availableFactors = [
        emotionalImpact,
        versatility,
        repeatWear,
        personalityCoverage,
        recommendationFit,
      ].filter((v) => v != null);
      const missingFactors: string[] = [];
      if (recommendationFit == null) missingFactors.push("recommendation feedback (< 3 records)");
      missingFactors.push("conversion data (awaiting checkout integration)");
      missingFactors.push("save intent (awaiting wishlist integration)");

      const partialScore =
        !insufficient && availableFactors.length >= 2
          ? parseFloat(availableFactors.reduce((a, b) => a + b!, 0).toFixed(0))
          : null;

      results.push({
        productTitle,
        score: partialScore,
        breakdown: {
          emotionalImpact,
          versatility,
          repeatWear,
          personalityCoverage,
          recommendationFit,
          conversion: "awaiting-integration",
          saveIntent: "awaiting-integration",
        },
        sampleSize,
        insufficientData: insufficient,
        missingFactors,
      });
    }

    return results
      .filter((r) => !r.insufficientData && r.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 15);
  } catch (e) {
    console.error("AdvancedKPIs: opportunityScores failed", e);
    return [];
  }
}

// ── J. Collection Health Score ────────────────────────────────────────────────
async function getCollectionHealth(dateFrom: Date): Promise<CollectionHealthScore> {
  try {
    const [sessions, reviews, profiles] = await Promise.all([
      prisma.stylingSession.findMany({
        where: { createdAt: { gte: dateFrom } },
        select: { occasion: true, currentMood: true, desiredFeeling: true },
      }),
      prisma.postOutfitReview.findMany({
        where: { createdAt: { gte: dateFrom } },
        select: {
          overallFeeling: true,
          wouldWearAgain: true,
          session: {
            select: {
              bodyPreference: true,
              suggestions: {
                select: { items: { select: { shopifyProductId: true, closetItemId: true } } },
                where: { selected: true },
                take: 1,
              },
            },
          },
        },
      }),
      prisma.onboardingProfile.findMany({
        where: { completed: true },
        select: { favoriteColors: true, fitPreferences: true, dressesFor: true },
      }),
    ]);

    const sampleSizeWarning = reviews.length < 10;

    // Recommendation coverage: % unique products recommended at all
    const recommendedProducts = new Set<string>();
    for (const r of reviews) {
      const items = r.session?.suggestions?.[0]?.items ?? [];
      for (const item of items) {
        if (item.shopifyProductId && !item.closetItemId) recommendedProducts.add(item.shopifyProductId);
      }
    }
    const recCoverage = recommendedProducts.size > 0 ? Math.min(100, recommendedProducts.size * 10) : 0;

    // Mood coverage: unique moods × session volume weight so that
    // very few sessions cannot produce a misleadingly high score.
    const uniqueMoods = new Set(sessions.map((s) => s.currentMood).filter(Boolean));
    const moodVolumeWeight = Math.min(sessions.length, 10) / 10; // 0.0–1.0
    const moodCoverage = uniqueMoods.size > 0
      ? Math.min(100, Math.round(uniqueMoods.size * 14 * moodVolumeWeight))
      : 0;

    // Occasion coverage
    const uniqueOccasions = new Set(sessions.map((s) => s.occasion).filter(Boolean));
    const occasionCoverage = uniqueOccasions.size > 0 ? Math.min(100, uniqueOccasions.size * 10) : 0;

    // Colour coverage: % of top profile colors present in sessions
    const profileColors = new Set(profiles.flatMap((p) => p.favoriteColors ?? []));
    const sessionFeelings = new Set(sessions.map((s) => s.desiredFeeling).filter(Boolean));
    const colourCoverage = profileColors.size > 0 ? Math.min(100, Math.round((Math.min(profileColors.size, 8) / 8) * 100)) : 0;

    // Fit coverage: fit preferences with good-performing products
    const profileFitPrefs = new Set(profiles.flatMap((p) => p.fitPreferences ?? []));
    const sessionFitPrefs = new Set(
      reviews
        .map((r) => r.session?.bodyPreference)
        .filter(Boolean),
    );
    const fitCoverage =
      profileFitPrefs.size > 0
        ? pct(
            [...sessionFitPrefs].filter((f) => profileFitPrefs.has(f!)).length,
            profileFitPrefs.size,
          )
        : null;

    // Emotional outcomes: avg rewear rate
    const rewearRate =
      reviews.length > 0
        ? pct(reviews.filter((r) => r.wouldWearAgain === "Definitely").length, reviews.length)
        : null;

    // Build factor scores (weights sum to ~100 for live factors)
    const factors: CollectionHealthScore["factors"] = {
      recommendationCoverage: { score: recCoverage, label: `${recommendedProducts.size} unique products recommended`, weight: 15 },
      moodCoverage: { score: moodCoverage, label: `${uniqueMoods.size} unique moods addressed`, weight: 15 },
      occasionCoverage: { score: occasionCoverage, label: `${uniqueOccasions.size} unique occasions covered`, weight: 15 },
      colourCoverage: { score: colourCoverage, label: `${profileColors.size} profile colors captured`, weight: 10 },
      fitCoverage: { score: fitCoverage ?? 0, label: fitCoverage != null ? `${fitCoverage}% of fit preferences addressed` : "Insufficient data", weight: 10 },
      emotionalOutcomes: { score: rewearRate ?? 0, label: rewearRate != null ? `${rewearRate}% would wear again` : "Insufficient data", weight: 20 },
      commercialPerformance: { score: null, label: "awaiting-integration", weight: 10 },
      returns: { score: null, label: "awaiting-integration", weight: 5 },
    };

    const liveFactors = Object.entries(factors).filter(([, f]) => f.score != null);
    const factorsAvailable = liveFactors.length;
    const factorsTotal = Object.keys(factors).length;

    // Weighted partial score (only live factors, re-normalized)
    const totalLiveWeight = liveFactors.reduce((s, [, f]) => s + f.weight, 0);
    const score =
      factorsAvailable >= 3 && reviews.length >= 5
        ? Math.round(
            liveFactors.reduce((s, [, f]) => s + (f.score! * f.weight) / 100, 0) *
              (100 / totalLiveWeight),
          )
        : null;

    // Find weakest and strongest live factors
    const sortedLive = liveFactors.sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0));
    const largestWeakness = sortedLive[0]?.[0] ?? null;
    const strongestArea = sortedLive[sortedLive.length - 1]?.[0] ?? null;

    return {
      score,
      factorsAvailable,
      factorsTotal,
      factors,
      largestWeakness,
      strongestArea,
      sampleSizeWarning,
      reviewCount: reviews.length,
    };
  } catch (e) {
    console.error("AdvancedKPIs: collectionHealth failed", e);
    return {
      score: null,
      factorsAvailable: 0,
      factorsTotal: 8,
      factors: {
        recommendationCoverage: { score: null, label: "Error", weight: 15 },
        moodCoverage: { score: null, label: "Error", weight: 15 },
        occasionCoverage: { score: null, label: "Error", weight: 15 },
        colourCoverage: { score: null, label: "Error", weight: 10 },
        fitCoverage: { score: null, label: "Error", weight: 10 },
        emotionalOutcomes: { score: null, label: "Error", weight: 20 },
        commercialPerformance: { score: null, label: "awaiting-integration", weight: 10 },
        returns: { score: null, label: "awaiting-integration", weight: 5 },
      },
      largestWeakness: null,
      strongestArea: null,
      sampleSizeWarning: true,
    };
  }
}

// ── K. Designer Opportunity Feed ───────────────────────────────────────────────
async function getOpportunityFeed(dateFrom: Date): Promise<DesignerOpportunity[]> {
  const opportunities: DesignerOpportunity[] = [];

  try {
    // Emerging occasions with no strong product coverage
    const sessions = await prisma.stylingSession.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: { occasion: true, desiredFeeling: true },
    });

    const occasionCounts: Record<string, number> = {};
    for (const s of sessions) {
      if (s.occasion) occasionCounts[s.occasion] = (occasionCounts[s.occasion] || 0) + 1;
    }

    for (const [occasion, count] of Object.entries(occasionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      if (count >= 3) {
        opportunities.push({
          id: `occasion-${occasion.toLowerCase().replace(/\s+/g, "-")}`,
          insight: `${count} styling sessions requested "${occasion}" occasion`,
          customerSegment: "All",
          customerNeed: `Styling options for ${occasion}`,
          evidence: `${count} StyleMe requests for this occasion in the period`,
          affectedProducts: [],
          estimatedCommercialRelevance: count >= 8 ? "high" : count >= 5 ? "medium" : "low",
          confidence: count >= 8 ? "high" : count >= 5 ? "medium" : "low",
          timePeriod: `Last ${Math.round((Date.now() - dateFrom.getTime()) / 86400000)} days`,
          suggestedAction: `Ensure strong product coverage for ${occasion} — review which pieces are being recommended and whether there are gaps.`,
          status: "new",
        });
      }
    }

    // Objection signals from existing feedback objections
    const objectionReviews = await prisma.postOutfitReview.findMany({
      where: { createdAt: { gte: dateFrom }, objections: { not: null } },
      select: { objections: true },
    });

    const objCount: Record<string, number> = {};
    for (const r of objectionReviews) {
      try {
        const list = JSON.parse(r.objections as string) as string[];
        for (const obj of list) {
          if (obj !== "Nothing — I'd wear it") objCount[obj] = (objCount[obj] || 0) + 1;
        }
      } catch {}
    }

    for (const [obj, count] of Object.entries(objCount).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      if (count >= 2) {
        opportunities.push({
          id: `objection-${obj.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`,
          insight: `"${obj}" cited ${count} times as reason not to wear recommended pieces`,
          customerSegment: "Customers who reviewed outfits",
          customerNeed: "Resolution of styling barrier",
          evidence: `${count} outfit reviews cited this as an objection`,
          affectedProducts: [],
          estimatedCommercialRelevance: count >= 5 ? "medium" : "low",
          confidence: count >= 5 ? "medium" : "low",
          timePeriod: `Last ${Math.round((Date.now() - dateFrom.getTime()) / 86400000)} days`,
          suggestedAction: `Investigate which products are most often objected to for this reason. Consider alternative styling or product adjustments.`,
          status: "new",
        });
      }
    }

    // Feedback objections from RecommendationFeedback
    try {
      const feedbackObjCount: Record<string, number> = {};
      const fbRecords = await (prisma as any).recommendationFeedback.findMany({
        where: { createdAt: { gte: dateFrom }, rating: { in: ["okay", "not-for-me"] } },
        select: { reasonCodes: true },
      });
      for (const f of fbRecords) {
        for (const code of f.reasonCodes as string[]) {
          feedbackObjCount[code] = (feedbackObjCount[code] || 0) + 1;
        }
      }
      for (const [code, count] of Object.entries(feedbackObjCount).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
        if (count >= 3) {
          const label = code.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          opportunities.push({
            id: `feedback-${code}`,
            insight: `${count} non-love feedback responses cite "${label}"`,
            customerSegment: "Customers who provided recommendation feedback",
            customerNeed: "Better fit with preferences",
            evidence: `${count} feedback reason code occurrences`,
            affectedProducts: [],
            estimatedCommercialRelevance: count >= 8 ? "high" : "medium",
            confidence: count >= 8 ? "high" : "medium",
            timePeriod: `Last ${Math.round((Date.now() - dateFrom.getTime()) / 86400000)} days`,
            suggestedAction: `Review which products receive "${label}" feedback most often and assess design or recommendation logic changes.`,
            status: "new",
          });
        }
      }
    } catch {}
  } catch (e) {
    console.error("AdvancedKPIs: opportunityFeed failed", e);
  }

  return opportunities.slice(0, 12);
}

// ── Master export ─────────────────────────────────────────────────────────────
export async function getAdvancedKPIs(dateRangeDays = 30): Promise<AdvancedKPIs> {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - dateRangeDays);

  const [emotionalJourney, journeyAnalytics, collectionEvolution, trustMetrics, predictive, opportunityScores, collectionHealth, opportunityFeed] =
    await Promise.all([
      getEmotionalJourney(dateFrom),
      getJourneyAnalytics(dateFrom),
      getCollectionEvolution(dateFrom, dateRangeDays),
      getTrustMetrics(dateFrom),
      getPredictive(dateFrom),
      getOpportunityScores(dateFrom),
      getCollectionHealth(dateFrom),
      getOpportunityFeed(dateFrom),
    ]);

  return {
    emotionalJourney,
    journeyAnalytics,
    collectionEvolution,
    trustMetrics,
    predictive,
    opportunityScores,
    collectionHealth,
    opportunityFeed,

    ltv: {
      status: "awaiting-integration",
      dataContract: {
        requiredIntegrations: ["Shopify Orders webhook", "Shopify Customers webhook"],
        events: ["order_placed", "order_refunded", "customer_created"],
      },
    },

    aiLearning: {
      status: "awaiting-integration",
      dataContract: {
        requiredTables: ["RecommendationAccuracyLog", "ScoreCalibrationLog"],
        description:
          "Recommendation accuracy tracking requires logging each scored suggestion with its final outcome (accepted, purchased, returned). Add a RecommendationAccuracyLog table recording: suggestionId, matchScore, scoreBreakdown, outcome, outcomeAt.",
      },
    },

    experimentation: {
      status: "awaiting-integration",
      dataContract: {
        requiredTable: "DesignerExperiment",
        fields: [
          "id", "name", "hypothesis", "productId", "variantDescription",
          "audienceSegment", "startDate", "endDate", "exposureCount",
          "purchaseIntentRate", "emotionalResponseSummary", "recommendationScore",
          "savesCount", "conversionRate", "confidence", "result", "recommendedAction",
          "status",
        ],
      },
    },

    explainability: {
      status: "awaiting-integration",
      dataContract: {
        requiredFields: [
          "explanation_text", "explanation_agreement", "explanation_rejected",
          "explanation_to_click", "explanation_to_save", "explanation_to_purchase",
          "explanation_version", "product_id", "session_id", "customer_segment",
        ],
        description:
          "Explainability analytics requires tracking whether customers agree with the AI explanation for each recommendation. Add explanationAgreed, explanationVersion fields to RecommendationFeedback and/or OutfitSuggestion.",
      },
    },
  };
}
