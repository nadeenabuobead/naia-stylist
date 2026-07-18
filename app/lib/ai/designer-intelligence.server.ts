// app/lib/ai/designer-intelligence.server.ts
// Phase 4B2 — Designer Intelligence aggregation contract.
// Connects Phase 4B1 feedback signals, VTO metrics, selfie adoption,
// and closet try-on readiness to the existing designer dashboard.
//
// Design constraints:
//   • SOFT_RANK signals only — never HARD_FILTER
//   • Minimum-data thresholds before surfacing any trend
//   • Migration guards for Phase 4A8 and Phase 4B1 tables
//   • Privacy: no customer names/emails/photos/raw feedback text/signed URLs
//   • Designer suggestions are restrained internal notes — no automatic changes

import prisma from "~/db.server";

// ── Migration guard ───────────────────────────────────────────────────────────

export function isMigrationError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as any).code as string | undefined;
  if (code === "P2021" || code === "P2022") return true;
  const msg = e.message;
  return (
    msg.includes("Unknown field") ||
    msg.includes("does not exist in the current database") ||
    (msg.includes("The table") && msg.includes("does not exist"))
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VTO_INACCURACY_ASPECTS = new Set([
  "garment-looks-inaccurate",
  "layering-looks-inaccurate",
  "colour-looks-inaccurate",
  "accessory-placement-inaccurate",
]);

export const MINIMUM_RECORDS_FOR_TREND = 5;

// ── KPI types ─────────────────────────────────────────────────────────────────

export interface FeedbackEngagementKPI {
  totalSessions: number;
  sessionsWithFeedback: number;
  feedbackResponseRate: number; // 0–100
  migrationPending: boolean;
}

export interface FeedbackDistributionKPI {
  love: number;
  okay: number;
  notForMe: number;
  total: number;
  loveRate: number;     // 0–100
  okayRate: number;
  notForMeRate: number;
  migrationPending: boolean;
}

export interface ObjectionInsightsKPI {
  colourObjections: number;
  fitObjections: number;
  tooRevealingObjections: number;
  tooCoveredObjections: number;
  tooFormalObjections: number;
  tooCasualObjections: number;
  notPracticalObjections: number;
  alreadyOwnObjections: number;
  total: number; // okay + not-for-me feedback records (the denominator)
  migrationPending: boolean;
}

export interface MostLovedProduct {
  shopifyProductId: string;
  loveCount: number;
  okayCount: number;
  notForMeCount: number;
}

export interface PostWearCompletionKPI {
  totalWithPostWear: number;
  didWearItYes: number;
  feltPositive: number; // feelingAnswer === "great" or "good"
  wearRate: number;     // 0–100
  positiveExperienceRate: number; // 0–100
  migrationPending: boolean;
}

export interface VTOMetricsKPI {
  totalJobs: number;
  completedJobs: number;
  vtoFeedbackCount: number;
  fidelityConcernCount: number;
  fidelityConcernRate: number; // 0–100
  migrationPending: boolean;
}

export interface SelfieAdoptionKPI {
  customersWithSelfie: number;
  totalCustomers: number;
  adoptionRate: number; // 0–100
  migrationPending: boolean;
}

export interface ClosetTryOnReadinessKPI {
  totalItems: number;
  readyItems: number;
  pendingAssessmentItems: number;
  ineligibleItems: number;
  readinessRate: number; // 0–100
}

export type InsightCategory =
  | "colour"
  | "fit"
  | "coverage"
  | "formality"
  | "vto-fidelity"
  | "post-wear"
  | "selfie"
  | "closet-readiness";

export type SignalStrength = "weak" | "moderate" | "strong";

export interface DesignerInsight {
  category: InsightCategory;
  signal: string;     // brief description of what the data shows
  threshold: SignalStrength;
  suggestion: string; // restrained internal action suggestion
}

export interface Phase4B2KPIs {
  feedbackEngagement: FeedbackEngagementKPI;
  feedbackDistribution: FeedbackDistributionKPI;
  objectionInsights: ObjectionInsightsKPI;
  mostLovedProducts: MostLovedProduct[];
  mostLovedMigrationPending: boolean;
  postWearCompletion: PostWearCompletionKPI;
  vtoMetrics: VTOMetricsKPI;
  selfieAdoption: SelfieAdoptionKPI;
  closetTryOnReadiness: ClosetTryOnReadinessKPI;
  designerInsights: DesignerInsight[];
}

// ── Empty-state constructors ─────────────────────────────────────────────────

export function emptyFeedbackEngagement(totalSessions = 0, migrationPending = true): FeedbackEngagementKPI {
  return { totalSessions, sessionsWithFeedback: 0, feedbackResponseRate: 0, migrationPending };
}

export function emptyFeedbackDistribution(migrationPending = true): FeedbackDistributionKPI {
  return { love: 0, okay: 0, notForMe: 0, total: 0, loveRate: 0, okayRate: 0, notForMeRate: 0, migrationPending };
}

export function emptyObjectionInsights(migrationPending = true): ObjectionInsightsKPI {
  return {
    colourObjections: 0, fitObjections: 0, tooRevealingObjections: 0, tooCoveredObjections: 0,
    tooFormalObjections: 0, tooCasualObjections: 0, notPracticalObjections: 0, alreadyOwnObjections: 0,
    total: 0, migrationPending,
  };
}

export function emptyPostWearCompletion(migrationPending = true): PostWearCompletionKPI {
  return { totalWithPostWear: 0, didWearItYes: 0, feltPositive: 0, wearRate: 0, positiveExperienceRate: 0, migrationPending };
}

// ── Pure aggregation functions ────────────────────────────────────────────────
// These are pure functions — no DB calls, fully testable with any data fixture.

export function aggregateFeedbackEngagement(
  totalSessions: number,
  sessionIdsWithFeedback: ReadonlySet<string>,
): FeedbackEngagementKPI {
  const sessionsWithFeedback = sessionIdsWithFeedback.size;
  return {
    totalSessions,
    sessionsWithFeedback,
    feedbackResponseRate: totalSessions > 0
      ? Math.round((sessionsWithFeedback / totalSessions) * 100)
      : 0,
    migrationPending: false,
  };
}

export function aggregateFeedbackDistribution(
  records: ReadonlyArray<{ rating: string }>,
): FeedbackDistributionKPI {
  const love    = records.filter(r => r.rating === "love").length;
  const okay    = records.filter(r => r.rating === "okay").length;
  const notForMe = records.filter(r => r.rating === "not-for-me").length;
  const total   = love + okay + notForMe;
  return {
    love, okay, notForMe, total,
    loveRate:     total > 0 ? Math.round((love    / total) * 100) : 0,
    okayRate:     total > 0 ? Math.round((okay    / total) * 100) : 0,
    notForMeRate: total > 0 ? Math.round((notForMe / total) * 100) : 0,
    migrationPending: false,
  };
}

export function aggregateObjectionInsights(
  records: ReadonlyArray<{ rating: string; reasonCodes: string[] }>,
): ObjectionInsightsKPI {
  // Only okay + not-for-me have reason codes worth aggregating
  const withReasons = records.filter(r => r.rating === "okay" || r.rating === "not-for-me");
  const total = withReasons.length;

  let colour = 0, fit = 0, tooRevealing = 0, tooCovered = 0,
      tooFormal = 0, tooCasual = 0, notPractical = 0, alreadyOwn = 0;

  for (const r of withReasons) {
    if (r.reasonCodes.includes("colour-not-for-me"))    colour++;
    if (r.reasonCodes.includes("fit-shape-not-for-me")) fit++;
    if (r.reasonCodes.includes("too-revealing"))        tooRevealing++;
    if (r.reasonCodes.includes("too-covered"))          tooCovered++;
    if (r.reasonCodes.includes("too-formal"))           tooFormal++;
    if (r.reasonCodes.includes("too-casual"))           tooCasual++;
    if (r.reasonCodes.includes("not-practical"))        notPractical++;
    if (r.reasonCodes.includes("already-own-similar"))  alreadyOwn++;
  }

  return {
    colourObjections: colour,
    fitObjections: fit,
    tooRevealingObjections: tooRevealing,
    tooCoveredObjections: tooCovered,
    tooFormalObjections: tooFormal,
    tooCasualObjections: tooCasual,
    notPracticalObjections: notPractical,
    alreadyOwnObjections: alreadyOwn,
    total,
    migrationPending: false,
  };
}

export function aggregateMostLovedProducts(
  records: ReadonlyArray<{ shopifyProductId: string | null; rating: string }>,
  minLoveCount = 3,
): MostLovedProduct[] {
  // Privacy: never includes customerId or any customer PII — shopifyProductId is a product ref
  const byProduct = new Map<string, { love: number; okay: number; notForMe: number }>();

  for (const r of records) {
    if (!r.shopifyProductId) continue;
    const id = r.shopifyProductId;
    if (!byProduct.has(id)) byProduct.set(id, { love: 0, okay: 0, notForMe: 0 });
    const entry = byProduct.get(id)!;
    if (r.rating === "love")         entry.love++;
    else if (r.rating === "okay")    entry.okay++;
    else if (r.rating === "not-for-me") entry.notForMe++;
  }

  return Array.from(byProduct.entries())
    .filter(([, e]) => e.love >= minLoveCount)
    .sort((a, b) => b[1].love - a[1].love)
    .map(([id, e]) => ({
      shopifyProductId: id,
      loveCount: e.love,
      okayCount: e.okay,
      notForMeCount: e.notForMe,
    }));
}

export function aggregatePostWearCompletion(
  records: ReadonlyArray<{ didWearIt: string | null; feelingAnswer: string | null }>,
): PostWearCompletionKPI {
  const totalWithPostWear = records.length;
  const didWearItYes = records.filter(r => r.didWearIt === "yes").length;
  const feltPositive = records.filter(r => r.feelingAnswer === "great" || r.feelingAnswer === "good").length;

  return {
    totalWithPostWear,
    didWearItYes,
    feltPositive,
    wearRate: totalWithPostWear > 0 ? Math.round((didWearItYes / totalWithPostWear) * 100) : 0,
    positiveExperienceRate: totalWithPostWear > 0 ? Math.round((feltPositive / totalWithPostWear) * 100) : 0,
    migrationPending: false,
  };
}

export function aggregateVTOMetrics(
  jobs: ReadonlyArray<{ status: string }>,
  feedbackRecords: ReadonlyArray<{ vtoAspects: string[] }>,
): VTOMetricsKPI {
  const totalJobs     = jobs.length;
  const completedJobs = jobs.filter(j => j.status === "COMPLETED").length;
  const vtoFeedbackCount = feedbackRecords.length;
  const fidelityConcernCount = feedbackRecords.filter(f =>
    f.vtoAspects.some(a => VTO_INACCURACY_ASPECTS.has(a)),
  ).length;

  return {
    totalJobs,
    completedJobs,
    vtoFeedbackCount,
    fidelityConcernCount,
    fidelityConcernRate: vtoFeedbackCount > 0
      ? Math.round((fidelityConcernCount / vtoFeedbackCount) * 100)
      : 0,
    migrationPending: false,
  };
}

export function aggregateClosetTryOnReadiness(
  items: ReadonlyArray<{ tryOnEligibility: string | null }>,
): ClosetTryOnReadinessKPI {
  const totalItems         = items.length;
  const readyItems          = items.filter(i => i.tryOnEligibility === "ready-for-try-on").length;
  const pendingAssessmentItems = items.filter(i => i.tryOnEligibility === "pending-assessment").length;
  const ineligibleItems    = items.filter(i =>
    i.tryOnEligibility === "needs-clearer-photo" || i.tryOnEligibility === "not-supported",
  ).length;

  return {
    totalItems,
    readyItems,
    pendingAssessmentItems,
    ineligibleItems,
    readinessRate: totalItems > 0 ? Math.round((readyItems / totalItems) * 100) : 0,
  };
}

// ── Designer insights — pure function ─────────────────────────────────────────
// Takes fully-computed KPIs, returns restrained internal suggestions.
// Never automatically changes products, StyleMe logic, or customer profiles.

function signalStrength(count: number): SignalStrength {
  if (count >= MINIMUM_RECORDS_FOR_TREND) return "strong";
  if (count >= 3) return "moderate";
  return "weak";
}

export function generateDesignerInsights(kpis: Phase4B2KPIs): DesignerInsight[] {
  const insights: DesignerInsight[] = [];
  const { objectionInsights: obj, vtoMetrics, postWearCompletion, selfieAdoption, closetTryOnReadiness } = kpis;

  // ── Objection signals ───────────────────────────────────────────────────────
  // Surface only when there is enough non-love feedback to form a pattern
  if (!obj.migrationPending && obj.total >= 3) {
    if (obj.colourObjections >= 3) {
      insights.push({
        category: "colour",
        signal: `${obj.colourObjections} of ${obj.total} non-love responses cite colour as an objection`,
        threshold: signalStrength(obj.colourObjections),
        suggestion: "Review colourways — consider adding neutral or warm-toned alternatives to key pieces.",
      });
    }

    if (obj.fitObjections >= 3) {
      insights.push({
        category: "fit",
        signal: `${obj.fitObjections} of ${obj.total} non-love responses cite fit or shape as an objection`,
        threshold: signalStrength(obj.fitObjections),
        suggestion: "Review silhouette ease and proportions — investigate which pieces are most cited.",
      });
    }

    const coverageCount = obj.tooRevealingObjections + obj.tooCoveredObjections;
    if (coverageCount >= 3) {
      insights.push({
        category: "coverage",
        signal: `${coverageCount} coverage objections (${obj.tooRevealingObjections} too revealing, ${obj.tooCoveredObjections} too covered)`,
        threshold: signalStrength(coverageCount),
        suggestion: "Investigate neckline and hemline preferences — customers may be split on coverage levels.",
      });
    }

    const formalityCount = obj.tooFormalObjections + obj.tooCasualObjections;
    if (formalityCount >= 3) {
      insights.push({
        category: "formality",
        signal: `${formalityCount} formality mismatches (${obj.tooFormalObjections} too formal, ${obj.tooCasualObjections} too casual)`,
        threshold: signalStrength(formalityCount),
        suggestion: "Review occasion-to-piece mapping — styling anchors may need adjustment.",
      });
    }
  }

  // ── VTO fidelity ────────────────────────────────────────────────────────────
  if (!vtoMetrics.migrationPending && vtoMetrics.vtoFeedbackCount >= 3) {
    if (vtoMetrics.fidelityConcernRate >= 30) {
      insights.push({
        category: "vto-fidelity",
        signal: `${vtoMetrics.fidelityConcernRate}% of VTO previews received fidelity concerns (${vtoMetrics.fidelityConcernCount} of ${vtoMetrics.vtoFeedbackCount})`,
        threshold: signalStrength(vtoMetrics.fidelityConcernCount),
        suggestion: "Review garment imagery — flat-lay or model shots may yield better drape accuracy in previews.",
      });
    }
  }

  // ── Post-wear experience ────────────────────────────────────────────────────
  if (!postWearCompletion.migrationPending && postWearCompletion.totalWithPostWear >= MINIMUM_RECORDS_FOR_TREND) {
    if (postWearCompletion.wearRate < 60) {
      insights.push({
        category: "post-wear",
        signal: `${postWearCompletion.wearRate}% of post-wear reviewers report actually wearing the look (${postWearCompletion.didWearItYes} of ${postWearCompletion.totalWithPostWear})`,
        threshold: signalStrength(postWearCompletion.totalWithPostWear),
        suggestion: "Post-wear follow-through is below expectations — review whether recommended looks are practical enough for real life.",
      });
    }
  }

  // ── Selfie adoption ─────────────────────────────────────────────────────────
  if (!selfieAdoption.migrationPending && selfieAdoption.totalCustomers >= 10) {
    if (selfieAdoption.adoptionRate < 10) {
      insights.push({
        category: "selfie",
        signal: `Selfie adoption is at ${selfieAdoption.adoptionRate}% (${selfieAdoption.customersWithSelfie} of ${selfieAdoption.totalCustomers} customers)`,
        threshold: "weak",
        suggestion: "Consider surfacing selfie analysis earlier in the styling flow to increase personalisation adoption.",
      });
    }
  }

  // ── Closet try-on readiness ─────────────────────────────────────────────────
  if (closetTryOnReadiness.totalItems >= 5 && closetTryOnReadiness.readinessRate < 30) {
    insights.push({
      category: "closet-readiness",
      signal: `Only ${closetTryOnReadiness.readinessRate}% of closet items are ready for virtual try-on (${closetTryOnReadiness.readyItems} of ${closetTryOnReadiness.totalItems})`,
      threshold: "weak",
      suggestion: "Many closet items lack eligibility — review upload quality guidance shown to customers.",
    });
  }

  return insights;
}

// ── DB fetching — server-only ─────────────────────────────────────────────────
// All Phase 4A8/4B1 tables are wrapped in migration guards.
// VirtualTryOnJob and ClosetItem are always live (applied in Phase 4A2/4A6).

export async function getPhase4B2KPIs(dateRangeDays = 30): Promise<Phase4B2KPIs> {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - dateRangeDays);

  // ── VirtualTryOnJob — always live ─────────────────────────────────────────
  let vtoJobs: Array<{ status: string }> = [];
  try {
    vtoJobs = await prisma.virtualTryOnJob.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: { status: true },
    });
  } catch (e) {
    console.error("Phase4B2: VirtualTryOnJob query failed", e);
  }

  // ── StyleMe sessions — always live ────────────────────────────────────────
  let totalSessions = 0;
  try {
    totalSessions = await prisma.stylingSession.count({
      where: { createdAt: { gte: dateFrom } },
    });
  } catch (e) {
    console.error("Phase4B2: stylingSession count failed", e);
  }

  // ── ClosetItem try-on readiness — always live ─────────────────────────────
  let closetItems: Array<{ tryOnEligibility: string | null }> = [];
  try {
    closetItems = await prisma.closetItem.findMany({
      select: { tryOnEligibility: true },
    });
  } catch (e) {
    console.error("Phase4B2: closetItem query failed", e);
  }

  // ── Customer count — always live ──────────────────────────────────────────
  let totalCustomers = 0;
  try {
    totalCustomers = await prisma.customer.count();
  } catch (e) {
    console.error("Phase4B2: customer count failed", e);
  }

  // ── RecommendationFeedback — Phase 4B1, migration guard ──────────────────
  type RawFeedback = {
    rating: string;
    reasonCodes: string[];
    vtoAspects: string[];
    sessionId: string | null;
    shopifyProductId: string | null;
    target: string;
  };

  let feedbackRecords: RawFeedback[] = [];
  let feedbackMigrationPending = false;

  try {
    feedbackRecords = await (prisma as any).recommendationFeedback.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: {
        rating: true,
        reasonCodes: true,
        vtoAspects: true,
        sessionId: true,
        shopifyProductId: true,
        target: true,
      },
    });
  } catch (e) {
    if (isMigrationError(e)) {
      feedbackMigrationPending = true;
    } else {
      console.error("Phase4B2: RecommendationFeedback query failed", e);
      feedbackMigrationPending = true;
    }
  }

  // ── PostOutfitReview 4B1 columns — migration guard ───────────────────────
  type RawPostWear = { didWearIt: string | null; feelingAnswer: string | null };
  let postWearRecords: RawPostWear[] = [];
  let postWearMigrationPending = false;

  try {
    const raw = await prisma.postOutfitReview.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: { didWearIt: true, feelingAnswer: true } as any,
    });
    // Only keep records that have the 4B1 columns present
    postWearRecords = (raw as RawPostWear[]).filter(r => "didWearIt" in r && r.didWearIt !== null);
  } catch (e) {
    if (isMigrationError(e)) {
      postWearMigrationPending = true;
    } else {
      console.error("Phase4B2: PostOutfitReview 4B1 columns query failed", e);
      postWearMigrationPending = true;
    }
  }

  // ── SelfieAnalysis — Phase 4A8, migration guard ──────────────────────────
  let selfieCount = 0;
  let selfieMigrationPending = false;

  try {
    selfieCount = await (prisma as any).selfieAnalysis.count({
      where: { analysisStatus: "completed" },
    });
  } catch (e) {
    if (isMigrationError(e)) {
      selfieMigrationPending = true;
    } else {
      console.error("Phase4B2: SelfieAnalysis query failed", e);
      selfieMigrationPending = true;
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────

  const sessionIdsWithFeedback = new Set(
    feedbackRecords.map(r => r.sessionId).filter((id): id is string => id !== null),
  );

  const feedbackEngagement: FeedbackEngagementKPI = feedbackMigrationPending
    ? emptyFeedbackEngagement(totalSessions, true)
    : aggregateFeedbackEngagement(totalSessions, sessionIdsWithFeedback);

  const feedbackDistribution: FeedbackDistributionKPI = feedbackMigrationPending
    ? emptyFeedbackDistribution(true)
    : aggregateFeedbackDistribution(feedbackRecords);

  const objectionInsights: ObjectionInsightsKPI = feedbackMigrationPending
    ? emptyObjectionInsights(true)
    : aggregateObjectionInsights(feedbackRecords);

  const mostLovedProducts = feedbackMigrationPending
    ? []
    : aggregateMostLovedProducts(feedbackRecords);

  const vtoFeedbackRecords = feedbackMigrationPending
    ? []
    : feedbackRecords.filter(r => r.target === "vto-preview");

  const vtoMetrics: VTOMetricsKPI = {
    ...aggregateVTOMetrics(vtoJobs, vtoFeedbackRecords),
    migrationPending: feedbackMigrationPending,
  };

  const postWearCompletion: PostWearCompletionKPI = postWearMigrationPending
    ? emptyPostWearCompletion(true)
    : aggregatePostWearCompletion(postWearRecords);

  const selfieAdoption: SelfieAdoptionKPI = selfieMigrationPending
    ? { customersWithSelfie: 0, totalCustomers, adoptionRate: 0, migrationPending: true }
    : {
        customersWithSelfie: selfieCount,
        totalCustomers,
        adoptionRate: totalCustomers > 0 ? Math.round((selfieCount / totalCustomers) * 100) : 0,
        migrationPending: false,
      };

  const closetTryOnReadiness = aggregateClosetTryOnReadiness(closetItems);

  const kpisWithoutInsights: Phase4B2KPIs = {
    feedbackEngagement,
    feedbackDistribution,
    objectionInsights,
    mostLovedProducts,
    mostLovedMigrationPending: feedbackMigrationPending,
    postWearCompletion,
    vtoMetrics,
    selfieAdoption,
    closetTryOnReadiness,
    designerInsights: [],
  };

  return { ...kpisWithoutInsights, designerInsights: generateDesignerInsights(kpisWithoutInsights) };
}
