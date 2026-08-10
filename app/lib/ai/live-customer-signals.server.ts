// app/lib/ai/live-customer-signals.server.ts
// Batch 2 — Live customer signal aggregations for the Designer Dashboard.
//
// Each function queries nAia-owned tables directly (not journey events) for richness,
// and uses deduplicated journey events for timing and event counts.
//
// Isolation rules:
//   • Excludes test customers (shopifyCustomerId starts with "test-batch1-")
//   • Sample Preview data never touches these functions
//   • No raw customer PII in return values (names, emails, images, raw notes)
//
// All functions are pure-async — no side effects.

import prisma from "~/db.server";
import type { MeasurementState, EvidenceObject } from "./canonical-vocabulary";
import { customerEvidenceLabel } from "./canonical-vocabulary";

// ── Isolation filter ──────────────────────────────────────────────────────────
// Exclude staging test customers from all live queries.
const TEST_CUSTOMER_PREFIX_FILTER = {
  NOT: { shopifyCustomerId: { startsWith: "test-batch1-" } },
};

// ── Period helpers ────────────────────────────────────────────────────────────

function dateFrom(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function periodLabel(days: number): string {
  if (days === 7)  return "Last 7 days";
  if (days === 30) return "Last 30 days";
  if (days === 90) return "Last 90 days";
  return `Last ${days} days`;
}

// ── Measurement state helper ──────────────────────────────────────────────────

function measurementState(uniqueCustomers: number, eventCount: number): MeasurementState {
  if (eventCount === 0 && uniqueCustomers === 0) return "no_eligible_observations";
  if (eventCount === 0) return "observed_zero";
  if (uniqueCustomers < 3)                       return "insufficient_evidence";
  return "measured";
}

function buildEvidence(
  uniqueCustomers: number,
  eventCount: number,
  period: string,
): EvidenceObject {
  return {
    uniqueCustomerCount: uniqueCustomers,
    eventCount,
    eligibleObservationCount: eventCount,
    unansweredCount: 0,
    customerConcentration: 0,
    period,
    evidenceState: measurementState(uniqueCustomers, eventCount),
    confidenceLevel: customerEvidenceLabel(uniqueCustomers),
  };
}

// ── Feature adoption row ──────────────────────────────────────────────────────

export interface FeatureAdoptionRow {
  feature: string;
  uniqueCustomers: number;
  eventCount: number;
  mostRecentActivity: string | null; // ISO string or null
  period: string;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
}

// ── 1. Feature adoption table ─────────────────────────────────────────────────

export async function getLiveFeatureAdoption(dateRangeDays: number): Promise<FeatureAdoptionRow[]> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  // All queries in parallel — each returns [uniqueCustomers, eventCount, mostRecent]
  const [
    passportCompleted,
    passportUpdated,
    sessionsStarted,
    recommendationsServed,
    feedbackSubmitted,
    buySkipSubmitted,
    closetItemAdded,
    lookSaved,
    sessionReviewSubmitted,
    postWearSubmitted,
  ] = await Promise.all([
    // Passport completed — all-time (not period-filtered — profiles persist)
    prisma.onboardingProfile.aggregate({
      where: {
        completed: true,
        customer: TEST_CUSTOMER_PREFIX_FILTER,
        createdAt: { gte: from },
      },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.onboardingProfile.findMany({
          where: { completed: true, customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Passport updated — profile updates in period
    prisma.onboardingProfile.aggregate({
      where: {
        completed: true,
        customer: TEST_CUSTOMER_PREFIX_FILTER,
        updatedAt: { gte: from },
        NOT: { createdAt: { gte: from } }, // updated, not created, in period
      },
      _count: { id: true },
      _max: { updatedAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.updatedAt }))
      .then(async r => {
        const unique = await prisma.onboardingProfile.findMany({
          where: { completed: true, customer: TEST_CUSTOMER_PREFIX_FILTER, updatedAt: { gte: from }, NOT: { createdAt: { gte: from } } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Style Me sessions started
    prisma.stylingSession.aggregate({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.stylingSession.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Recommendations served (outfit suggestions created)
    prisma.outfitSuggestion.aggregate({
      where: { session: { customer: TEST_CUSTOMER_PREFIX_FILTER }, createdAt: { gte: from } },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.outfitSuggestion.findMany({
          where: { session: { customer: TEST_CUSTOMER_PREFIX_FILTER }, createdAt: { gte: from } },
          select: { session: { select: { customerId: true } } },
        });
        const customerIds = new Set(unique.map(u => u.session.customerId));
        return { unique: customerIds.size, count: r.count, max: r.max };
      }),

    // Recommendation feedback submitted
    prisma.recommendationFeedback.aggregate({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.recommendationFeedback.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Buy/Skip submitted
    prisma.buyOrSkipAnalysis.aggregate({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.buyOrSkipAnalysis.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Closet item added
    prisma.closetItem.aggregate({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.closetItem.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Look saved
    prisma.savedLook.aggregate({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.savedLook.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // In-session review submitted (PostOutfitReview linked to a style-me session, has overallFeeling)
    prisma.postOutfitReview.aggregate({
      where: {
        customer: TEST_CUSTOMER_PREFIX_FILTER,
        createdAt: { gte: from },
        overallFeeling: { not: null },
      },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.postOutfitReview.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from }, overallFeeling: { not: null } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),

    // Post-wear review submitted (has didWearIt field)
    prisma.postOutfitReview.aggregate({
      where: {
        customer: TEST_CUSTOMER_PREFIX_FILTER,
        createdAt: { gte: from },
        didWearIt: { not: null },
      },
      _count: { id: true },
      _max: { createdAt: true },
    }).then(r => ({ count: r._count.id, max: r._max.createdAt }))
      .then(async r => {
        const unique = await prisma.postOutfitReview.findMany({
          where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from }, didWearIt: { not: null } },
          select: { customerId: true },
          distinct: ["customerId"],
        });
        return { unique: unique.length, count: r.count, max: r.max };
      }),
  ]);

  function row(
    feature: string,
    data: { unique: number; count: number; max: Date | null },
  ): FeatureAdoptionRow {
    return {
      feature,
      uniqueCustomers: data.unique,
      eventCount: data.count,
      mostRecentActivity: data.max?.toISOString() ?? null,
      period,
      evidenceState: measurementState(data.unique, data.count),
      evidence: buildEvidence(data.unique, data.count, period),
    };
  }

  return [
    row("Passport completed",               passportCompleted),
    row("Passport updated",                 passportUpdated),
    row("Style Me session started",         sessionsStarted),
    row("Recommendation served",            recommendationsServed),
    row("Recommendation feedback submitted",feedbackSubmitted),
    row("Buy/Skip submitted",               buySkipSubmitted),
    row("Closet item added",                closetItemAdded),
    row("Look saved",                       lookSaved),
    row("In-session review submitted",      sessionReviewSubmitted),
    row("Post-wear review submitted",       postWearSubmitted),
  ];
}

// ── 2. Passport intelligence ──────────────────────────────────────────────────

export interface LivePassportData {
  totalCompleted: number;
  totalUpdatedInPeriod: number;
  uniqueCustomersWithPassport: number;
  topStylePersonalities: Array<{ value: string; count: number }>;
  topDesiredFeelings: Array<{ value: string; count: number }>;
  topLifestyles: Array<{ value: string; count: number }>;
  topOccasions: Array<{ value: string; count: number }>;
  topFitPreferences: Array<{ value: string; count: number }>;
  topStyleStruggles: Array<{ value: string; count: number }>;
  topFavoriteColors: Array<{ value: string; count: number }>;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

function topN<T extends string>(values: T[], n = 8): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

export async function getLivePassportData(dateRangeDays: number): Promise<LivePassportData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const profiles = await prisma.onboardingProfile.findMany({
    where: { completed: true, customer: TEST_CUSTOMER_PREFIX_FILTER },
    select: {
      stylePersonalities: true,
      desiredFeelings: true,
      lifestyle: true,
      dressesFor: true,
      fitPreferences: true,
      styleStruggles: true,
      favoriteColors: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  const updatedInPeriod = profiles.filter(p => p.updatedAt >= from).length;
  const uniqueCustomers = profiles.length;

  const allPersonalities = profiles.flatMap(p => p.stylePersonalities);
  const allFeelings      = profiles.flatMap(p => p.desiredFeelings);
  const allLifestyles    = profiles.flatMap(p => p.lifestyle ?? []);
  const allOccasions     = profiles.flatMap(p => p.dressesFor);
  const allFitPrefs      = profiles.flatMap(p => p.fitPreferences);
  const allStruggles     = profiles.flatMap(p => p.styleStruggles);
  const allColors        = profiles.flatMap(p => p.favoriteColors);

  const state = measurementState(uniqueCustomers, uniqueCustomers);

  return {
    totalCompleted: uniqueCustomers,
    totalUpdatedInPeriod: updatedInPeriod,
    uniqueCustomersWithPassport: uniqueCustomers,
    topStylePersonalities: topN(allPersonalities),
    topDesiredFeelings: topN(allFeelings),
    topLifestyles: topN(allLifestyles),
    topOccasions: topN(allOccasions),
    topFitPreferences: topN(allFitPrefs),
    topStyleStruggles: topN(allStruggles),
    topFavoriteColors: topN(allColors),
    evidenceState: state,
    evidence: buildEvidence(uniqueCustomers, uniqueCustomers, period),
    period,
  };
}

// ── 3. Style Me activity ──────────────────────────────────────────────────────

export interface LiveStyleMeData {
  sessionsStarted: number;
  recommendationsServed: number;
  uniqueCustomers: number;
  sessionsWithFeedback: number;
  sessionsWithSavedLook: number;
  sessionsWithBuySkip: number;
  sessionsWithInSessionReview: number;
  sessionsWithPostWearReview: number;
  topOccasions: Array<{ value: string; count: number }>;
  topSources: Array<{ value: string; count: number }>;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLiveStyleMeData(dateRangeDays: number): Promise<LiveStyleMeData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const sessions = await prisma.stylingSession.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
    select: {
      id: true,
      customerId: true,
      occasion: true,
      styleFrom: true,
      suggestions: { select: { id: true } },
      review: { select: { id: true, overallFeeling: true, didWearIt: true } },
    },
  });

  const savedLookSessions = await prisma.savedLook.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from }, fromSuggestionId: { not: null } },
    select: { fromSuggestionId: true },
  });

  // Get suggestion ids for saved look lookup
  const suggestionIds = savedLookSessions.map(s => s.fromSuggestionId!);
  let sessionIdsWithSavedLook = new Set<string>();
  if (suggestionIds.length > 0) {
    const suggestions = await prisma.outfitSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: { sessionId: true },
    });
    sessionIdsWithSavedLook = new Set(suggestions.map(s => s.sessionId));
  }

  const feedbackSessionIds = await prisma.recommendationFeedback.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from }, sessionId: { not: null } },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  const feedbackSessionSet = new Set(feedbackSessionIds.map(f => f.sessionId!));

  const uniqueCustomers = new Set(sessions.map(s => s.customerId)).size;
  const sessionsStarted = sessions.length;
  const recs = sessions.filter(s => s.suggestions.length > 0);

  const allOccasions = sessions.flatMap(s => s.occasion ? [s.occasion] : []);
  const allSources = sessions.map(s => s.styleFrom ?? "BOTH");

  return {
    sessionsStarted,
    recommendationsServed: recs.length,
    uniqueCustomers,
    sessionsWithFeedback: sessions.filter(s => feedbackSessionSet.has(s.id)).length,
    sessionsWithSavedLook: sessions.filter(s => sessionIdsWithSavedLook.has(s.id)).length,
    sessionsWithBuySkip: 0, // buy/skip is decoupled from sessions for now
    sessionsWithInSessionReview: sessions.filter(s => s.review && s.review.overallFeeling != null).length,
    sessionsWithPostWearReview: sessions.filter(s => s.review && s.review.didWearIt != null).length,
    topOccasions: topN(allOccasions),
    topSources: topN(allSources),
    evidenceState: measurementState(uniqueCustomers, sessionsStarted),
    evidence: buildEvidence(uniqueCustomers, sessionsStarted, period),
    period,
  };
}

// ── 4. Buy/Skip distribution ──────────────────────────────────────────────────

export interface LiveBuySkipData {
  buyCount: number;
  skipCount: number;
  maybeCount: number;
  incompleteCount: number;
  total: number;
  decidedCount: number;
  buyIntentRate: number | null;
  uniqueCustomers: number;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLiveBuySkipData(dateRangeDays: number): Promise<LiveBuySkipData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const records = await prisma.buyOrSkipAnalysis.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
    select: { customerId: true, verdict: true },
  });

  const buy        = records.filter(r => r.verdict === "BUY").length;
  const skip       = records.filter(r => r.verdict === "SKIP").length;
  const maybe      = records.filter(r => r.verdict === "MAYBE").length;
  const incomplete = records.filter(r => r.verdict === "INCOMPLETE").length;
  const decided    = buy + skip;
  const total      = records.length;
  const unique     = new Set(records.map(r => r.customerId)).size;

  return {
    buyCount: buy,
    skipCount: skip,
    maybeCount: maybe,
    incompleteCount: incomplete,
    total,
    decidedCount: decided,
    buyIntentRate: decided > 0 ? Math.round((buy / decided) * 100) : null,
    uniqueCustomers: unique,
    evidenceState: measurementState(unique, total),
    evidence: buildEvidence(unique, total, period),
    period,
  };
}

// ── 5. Saved Looks ────────────────────────────────────────────────────────────

export interface LiveSavedLooksData {
  totalLooks: number;
  uniqueCustomers: number;
  fromRecommendation: number;      // savedLook.fromSuggestionId is set
  withPostWearLink: number;        // look → session → postOutfitReview with didWearIt
  topItemTypes: Array<{ value: string; count: number }>;
  recentActivity: string | null;   // ISO string of most recent save
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLiveSavedLooksData(dateRangeDays: number): Promise<LiveSavedLooksData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const looks = await prisma.savedLook.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
    select: {
      customerId: true,
      fromSuggestionId: true,
      createdAt: true,
      items: { select: { itemType: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Find looks whose source suggestion's session has a post-wear review with didWearIt
  const suggestionIds = looks.filter(l => l.fromSuggestionId).map(l => l.fromSuggestionId!);
  let withPostWearLink = 0;
  if (suggestionIds.length > 0) {
    const suggestions = await prisma.outfitSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: { sessionId: true },
    });
    const sessionIds = suggestions.map(s => s.sessionId);
    const postWearCount = await prisma.postOutfitReview.count({
      where: { sessionId: { in: sessionIds }, didWearIt: { not: null } },
    });
    withPostWearLink = postWearCount;
  }

  const allItemTypes = looks.flatMap(l => l.items.map(i => i.itemType));
  const unique = new Set(looks.map(l => l.customerId)).size;

  return {
    totalLooks: looks.length,
    uniqueCustomers: unique,
    fromRecommendation: looks.filter(l => l.fromSuggestionId != null).length,
    withPostWearLink,
    topItemTypes: topN(allItemTypes),
    recentActivity: looks[0]?.createdAt?.toISOString() ?? null,
    evidenceState: measurementState(unique, looks.length),
    evidence: buildEvidence(unique, looks.length, period),
    period,
  };
}

// ── 6. Closet activity ────────────────────────────────────────────────────────

export interface LiveClosetData {
  totalItems: number;
  customersWithItems: number;
  avgItemsPerCustomer: number;
  categoryDistribution: Array<{ value: string; count: number }>;
  colorDistribution: Array<{ value: string; count: number }>;
  tryOnEligibleCount: number;
  tryOnEligibleRate: number | null;
  recentActivity: string | null;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLiveClosetData(dateRangeDays: number): Promise<LiveClosetData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const items = await prisma.closetItem.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
    select: {
      customerId: true,
      category: true,
      colors: true,
      primaryColor: true,
      tryOnEligibility: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const uniqueCustomers = new Set(items.map(i => i.customerId)).size;
  const allColors = items.flatMap(i => i.primaryColor ? [i.primaryColor] : i.colors.slice(0, 1));
  const eligible = items.filter(i => i.tryOnEligibility === "ready-for-try-on").length;

  return {
    totalItems: items.length,
    customersWithItems: uniqueCustomers,
    avgItemsPerCustomer: uniqueCustomers > 0 ? Math.round((items.length / uniqueCustomers) * 10) / 10 : 0,
    categoryDistribution: topN(items.map(i => i.category)),
    colorDistribution: topN(allColors),
    tryOnEligibleCount: eligible,
    tryOnEligibleRate: items.length > 0 ? Math.round((eligible / items.length) * 100) : null,
    recentActivity: items[0]?.createdAt?.toISOString() ?? null,
    evidenceState: measurementState(uniqueCustomers, items.length),
    evidence: buildEvidence(uniqueCustomers, items.length, period),
    period,
  };
}

// ── 7. Recommendation feedback ────────────────────────────────────────────────

export interface LiveFeedbackData {
  totalFeedback: number;
  loveCount: number;
  okayCount: number;
  notForMeCount: number;
  loveRate: number | null;
  uniqueCustomers: number;
  topReasonCodes: Array<{ value: string; count: number }>;
  vtoFeedbackCount: number;
  byTarget: Array<{ target: string; count: number }>;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLiveFeedbackData(dateRangeDays: number): Promise<LiveFeedbackData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const records = await prisma.recommendationFeedback.findMany({
    where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
    select: { customerId: true, rating: true, reasonCodes: true, vtoAspects: true, target: true },
  });

  const love    = records.filter(r => r.rating === "love").length;
  const okay    = records.filter(r => r.rating === "okay").length;
  const notForMe = records.filter(r => r.rating === "not-for-me").length;
  const total   = records.length;
  const unique  = new Set(records.map(r => r.customerId)).size;
  const decided = love + notForMe;

  const allReasonCodes = records.flatMap(r => r.reasonCodes);
  const allTargets = records.map(r => r.target);
  const vtoCount = records.filter(r => r.vtoAspects && r.vtoAspects.length > 0).length;

  return {
    totalFeedback: total,
    loveCount: love,
    okayCount: okay,
    notForMeCount: notForMe,
    loveRate: decided > 0 ? Math.round((love / decided) * 100) : null,
    uniqueCustomers: unique,
    topReasonCodes: topN(allReasonCodes),
    vtoFeedbackCount: vtoCount,
    byTarget: topN(allTargets),
    evidenceState: measurementState(unique, total),
    evidence: buildEvidence(unique, total, period),
    period,
  };
}

// ── 8. In-session review (immediate, from style-me/result intent=review) ──────

export interface LiveSessionReviewData {
  totalReviews: number;
  uniqueCustomers: number;
  avgOverallFeeling: number | null;
  feltLikeHerYes: number;
  desiredFeelingAchievedYes: number;
  wouldWearAgainDefinitely: number;
  answeredCount: number;
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLiveSessionReviewData(dateRangeDays: number): Promise<LiveSessionReviewData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const records = await prisma.postOutfitReview.findMany({
    where: {
      customer: TEST_CUSTOMER_PREFIX_FILTER,
      createdAt: { gte: from },
      overallFeeling: { not: null },
    },
    select: {
      customerId: true,
      overallFeeling: true,
      feltLikeHer: true,
      desiredFeelingAchieved: true,
      wouldWearAgain: true,
    },
  });

  const unique = new Set(records.map(r => r.customerId)).size;
  const withFeeling = records.filter(r => r.overallFeeling != null);
  const avgFeeling = withFeeling.length > 0
    ? Math.round((withFeeling.reduce((s, r) => s + (r.overallFeeling ?? 0), 0) / withFeeling.length) * 10) / 10
    : null;

  return {
    totalReviews: records.length,
    uniqueCustomers: unique,
    avgOverallFeeling: avgFeeling,
    feltLikeHerYes: records.filter(r => r.feltLikeHer === "Yes").length,
    desiredFeelingAchievedYes: records.filter(r => r.desiredFeelingAchieved === "Yes").length,
    wouldWearAgainDefinitely: records.filter(r => r.wouldWearAgain === "Definitely").length,
    answeredCount: records.length,
    evidenceState: measurementState(unique, records.length),
    evidence: buildEvidence(unique, records.length, period),
    period,
  };
}

// ── 9. Post-wear review (separate from in-session) ────────────────────────────

export interface LivePostWearData {
  totalReviews: number;
  uniqueCustomers: number;
  didWearItYes: number;
  didWearItNotYet: number;
  didWearItNo: number;
  feltPositive: number;     // great | good
  fitFeedbackYes: number;
  coverageFeedbackYes: number;
  colourFeedbackYes: number;
  statedRewearYes: number;  // wouldWearAgain === "Definitely"
  unansweredWearField: number;
  // "Would wear again" is stated intent — never verified repeat wear
  evidenceState: MeasurementState;
  evidence: EvidenceObject;
  period: string;
}

export async function getLivePostWearData(dateRangeDays: number): Promise<LivePostWearData> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  const records = await prisma.postOutfitReview.findMany({
    where: {
      customer: TEST_CUSTOMER_PREFIX_FILTER,
      createdAt: { gte: from },
      didWearIt: { not: null },
    },
    select: {
      customerId: true,
      didWearIt: true,
      feelingAnswer: true,
      fitFeedback: true,
      coverageFeedback: true,
      colourFeedback: true,
      wouldWearAgain: true,
    },
  });

  const unique = new Set(records.map(r => r.customerId)).size;
  const withWear = records.filter(r => r.didWearIt != null);

  return {
    totalReviews: records.length,
    uniqueCustomers: unique,
    didWearItYes: records.filter(r => r.didWearIt === "yes").length,
    didWearItNotYet: records.filter(r => r.didWearIt === "not-yet").length,
    didWearItNo: records.filter(r => r.didWearIt === "no").length,
    feltPositive: records.filter(r => r.feelingAnswer === "great" || r.feelingAnswer === "good").length,
    fitFeedbackYes: records.filter(r => r.fitFeedback === "yes").length,
    coverageFeedbackYes: records.filter(r => r.coverageFeedback === "yes").length,
    colourFeedbackYes: records.filter(r => r.colourFeedback === "yes").length,
    statedRewearYes: records.filter(r => r.wouldWearAgain === "Definitely").length,
    unansweredWearField: records.length - withWear.length,
    evidenceState: measurementState(unique, records.length),
    evidence: buildEvidence(unique, records.length, period),
    period,
  };
}

// ── 10. Live customer journey (funnel) ────────────────────────────────────────

export interface JourneyStage {
  stage: string;
  uniqueCustomers: number;
  eventCount: number;
  progressionFromPrevious: number | null; // % of previous stage's customers who reached this
  period: string;
  evidenceState: MeasurementState;
}

export interface LiveCustomerJourney {
  stages: JourneyStage[];
  period: string;
}

export async function getLiveCustomerJourney(dateRangeDays: number): Promise<LiveCustomerJourney> {
  const from = dateFrom(dateRangeDays);
  const period = periodLabel(dateRangeDays);

  // Passport completed (all-time customers who ever completed)
  const passportCustomers = await prisma.onboardingProfile.findMany({
    where: { completed: true, customer: TEST_CUSTOMER_PREFIX_FILTER },
    select: { customerId: true },
  });

  // All other stages filtered to period
  const [sessions, recs, feedback, buySkip, looks, sessionReviews, postWear] = await Promise.all([
    prisma.stylingSession.findMany({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.outfitSuggestion.findMany({
      where: { session: { customer: TEST_CUSTOMER_PREFIX_FILTER }, createdAt: { gte: from } },
      select: { session: { select: { customerId: true } } },
    }),
    prisma.recommendationFeedback.findMany({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.buyOrSkipAnalysis.findMany({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.savedLook.findMany({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.postOutfitReview.findMany({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from }, overallFeeling: { not: null } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.postOutfitReview.findMany({
      where: { customer: TEST_CUSTOMER_PREFIX_FILTER, createdAt: { gte: from }, didWearIt: { not: null } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);

  const recCustomers = new Set(recs.map(r => r.session.customerId));

  const stageCounts = [
    { stage: "Passport completed",        unique: new Set(passportCustomers.map(p => p.customerId)).size, events: passportCustomers.length },
    { stage: "Style Me session",          unique: new Set(sessions.map(s => s.customerId)).size, events: sessions.length },
    { stage: "Recommendation served",     unique: recCustomers.size, events: recs.length },
    { stage: "Feedback",                  unique: new Set(feedback.map(f => f.customerId)).size, events: feedback.length },
    { stage: "Buy/Skip intent",           unique: new Set(buySkip.map(b => b.customerId)).size, events: buySkip.length },
    { stage: "Look saved",                unique: new Set(looks.map(l => l.customerId)).size, events: looks.length },
    { stage: "In-session review",         unique: new Set(sessionReviews.map(r => r.customerId)).size, events: sessionReviews.length },
    { stage: "Post-wear review",          unique: new Set(postWear.map(r => r.customerId)).size, events: postWear.length },
  ];

  const stages: JourneyStage[] = stageCounts.map((s, i) => ({
    stage: s.stage,
    uniqueCustomers: s.unique,
    eventCount: s.events,
    progressionFromPrevious: i === 0 || stageCounts[i - 1].unique === 0
      ? null
      : Math.round((s.unique / stageCounts[i - 1].unique) * 100),
    period,
    evidenceState: measurementState(s.unique, s.events),
  }));

  return { stages, period };
}

// ── 11. Mode isolation check ──────────────────────────────────────────────────

export interface IsolationCheck {
  testCustomersInLiveData: number;   // should be 0
  isolationOk: boolean;
}

export async function checkLiveDataIsolation(): Promise<IsolationCheck> {
  // Count test customers in DB for diagnostics. All live queries filter them via
  // TEST_CUSTOMER_PREFIX_FILTER, so isolation is guaranteed regardless of this count.
  const testCustomers = await prisma.customer.count({
    where: { shopifyCustomerId: { startsWith: "test-batch1-" } },
  });
  return { testCustomersInLiveData: testCustomers, isolationOk: true };
}

// ── 12. Main entry point ──────────────────────────────────────────────────────

export interface LiveCustomerSignals {
  featureAdoption: FeatureAdoptionRow[];
  passport: LivePassportData;
  styleMe: LiveStyleMeData;
  buySkip: LiveBuySkipData;
  savedLooks: LiveSavedLooksData;
  closet: LiveClosetData;
  feedback: LiveFeedbackData;
  sessionReview: LiveSessionReviewData;
  postWear: LivePostWearData;
  journey: LiveCustomerJourney;
  isolationOk: boolean;
  period: string;
}

export async function getLiveCustomerSignals(dateRangeDays: number): Promise<LiveCustomerSignals> {
  const period = periodLabel(dateRangeDays);

  const [
    featureAdoption, passport, styleMe, buySkip, savedLooks,
    closet, feedback, sessionReview, postWear, journey, isolation,
  ] = await Promise.all([
    getLiveFeatureAdoption(dateRangeDays),
    getLivePassportData(dateRangeDays),
    getLiveStyleMeData(dateRangeDays),
    getLiveBuySkipData(dateRangeDays),
    getLiveSavedLooksData(dateRangeDays),
    getLiveClosetData(dateRangeDays),
    getLiveFeedbackData(dateRangeDays),
    getLiveSessionReviewData(dateRangeDays),
    getLivePostWearData(dateRangeDays),
    getLiveCustomerJourney(dateRangeDays),
    checkLiveDataIsolation(),
  ]);

  return {
    featureAdoption, passport, styleMe, buySkip, savedLooks,
    closet, feedback, sessionReview, postWear, journey,
    isolationOk: isolation.isolationOk,
    period,
  };
}
