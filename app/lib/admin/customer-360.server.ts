// app/lib/admin/customer-360.server.ts
//
// nAia Admin — Customer 360 data access.
// Read-only. Every export here is scoped to one customerId, passed in by the
// caller (always the path param on admin.naia.customers.$customerId.tsx) —
// never derived from a query string or request body.
//
// This module is a NEW, separate admin surface over tables the frozen
// customer-facing Noticing/Passport V1 also reads (StyleTendency,
// TasteEvidence). It never writes either table, and nothing it exports is
// reachable from the NADINE Designer Intelligence dashboard — see
// app/lib/ai/taste-evidence-consumer-boundary.test.ts, which enumerates every
// approved reader of the taste engine and fails the build if a new one
// appears outside that list.
//
// Six read surfaces, one per Customer Profile tab that needed a new
// data-fetcher (Summary/Passport/Closet-summary/Buy-or-Skip already existed
// in closet-intelligence.server.ts / buyskip-admin.server.ts and are reused,
// not duplicated, by the route):
//   getAdminCustomerClosetGallery   — Closet tab: full gallery, not counts
//   getAdminCustomerStyleMeSessions — StyleMe tab: session + suggestion + outcome + review
//   getAdminCustomerLearningFeedback — Learning & Feedback tab: all StyleTendency states
//   getAdminCustomerTrendEditUsage  — Trend Edits tab: usage rows only, no report content
//   getAdminCustomerVtoHistory      — VTO / My nAia Model tab: operational history only
//   getAdminCustomerActivity        — Activity tab: derived timeline, no new event table

import prisma from "~/db.server";
import { loadStrongestConfirmedTendency } from "~/lib/ai/taste-reconcile.server";

// ── Closet gallery ───────────────────────────────────────────────────────────

export interface AdminClosetGalleryItem {
  id: string;
  name: string | null;
  brand: string | null;
  category: string;
  subcategory: string | null;
  thumbnailUrl: string | null;
  colors: string[];
  material: string | null;
  garmentRelationships: string[];
  customerNote: string | null;
  favorite: boolean;
  timesWorn: number;
  reviewStatus: string;
  createdAt: Date;
}

/**
 * Full Closet gallery for one customer — image, name, brand, category,
 * colours, material, garment relationship, and the customer's own note
 * (the "relevant feedback" this tab is meant to carry — a free-text signal
 * the customer attached to the piece, not an inferred rating).
 *
 * Does not recompute or re-derive anything Closet Intelligence already
 * classified (silhouette, formality, confidence, etc.) — this is the
 * customer-centric read of items already classified there, not a rebuild.
 */
export async function getAdminCustomerClosetGallery(
  customerId: string,
): Promise<AdminClosetGalleryItem[]> {
  const items = await prisma.closetItem.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      subcategory: true,
      thumbnailUrl: true,
      colors: true,
      material: true,
      garmentRelationships: true,
      customerNote: true,
      favorite: true,
      timesWorn: true,
      createdAt: true,
      adminReview: { select: { reviewStatus: true } },
    },
  });

  return items.map((item: (typeof items)[number]) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    category: item.category,
    subcategory: item.subcategory,
    thumbnailUrl: item.thumbnailUrl,
    colors: item.colors,
    material: item.material,
    garmentRelationships: item.garmentRelationships,
    customerNote: item.customerNote,
    favorite: item.favorite,
    timesWorn: item.timesWorn,
    reviewStatus: item.adminReview?.reviewStatus ?? "unreviewed",
    createdAt: item.createdAt,
  }));
}

// ── StyleMe sessions ──────────────────────────────────────────────────────────

export interface AdminStyleMeSuggestionSummary {
  id: string;
  outfitName: string | null;
  heroImageUrl: string | null;
  selected: boolean;
  savedAsLook: boolean;
  itemCount: number;
  outcome: {
    outcomeStatus: string;
    goalOutcome: string | null;
    whatWorked: string[];
    whatFeltOff: string[];
    didntWearReasons: string[];
    submittedAt: Date;
  } | null;
}

export interface AdminStyleMeSessionSummary {
  id: string;
  createdAt: Date;
  occasion: string | null;
  currentMood: string | null;
  desiredFeeling: string | null;
  state: string | null;
  intentions: string[];
  /** Closet-only, NADINE-eligible-included, or both — derived from styleFrom/styleMeMode, never guessed. */
  source: string;
  suggestions: AdminStyleMeSuggestionSummary[];
  review: {
    workedTags: string | null;
    didntWorkTags: string | null;
    additionalNotes: string | null;
    objections: string | null;
    createdAt: Date;
  } | null;
}

function describeStyleMeSource(styleFrom: string, styleMeMode: string | null): string {
  if (styleMeMode === "nadine") return "Closet + NADINE";
  if (styleMeMode === "naia") return "Closet only";
  // Pre-styleMeMode historical rows fall back to the older styleFrom field.
  if (styleFrom === "NAIA") return "Closet only (legacy)";
  if (styleFrom === "CLOSET") return "Closet only (legacy)";
  return "Closet + NADINE (legacy)";
}

/**
 * Every StyleMe session for one customer — what nAia gave them (occasion,
 * constraints, suggestion, outfit) and what they thought of it (StyleMeOutcome
 * + PostOutfitReview), newest first.
 */
export async function getAdminCustomerStyleMeSessions(
  customerId: string,
): Promise<AdminStyleMeSessionSummary[]> {
  const sessions = await prisma.stylingSession.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      occasion: true,
      currentMood: true,
      desiredFeeling: true,
      state: true,
      intentions: true,
      styleFrom: true,
      styleMeMode: true,
      suggestions: {
        select: {
          id: true,
          outfitName: true,
          heroImageUrl: true,
          selected: true,
          savedAsLook: true,
          items: { select: { id: true } },
          outcome: {
            select: {
              outcomeStatus: true,
              goalOutcome: true,
              whatWorked: true,
              whatFeltOff: true,
              didntWearReasons: true,
              submittedAt: true,
            },
          },
        },
      },
      review: {
        select: {
          workedTags: true,
          didntWorkTags: true,
          additionalNotes: true,
          objections: true,
          createdAt: true,
        },
      },
    },
  });

  return sessions.map((session: (typeof sessions)[number]) => ({
    id: session.id,
    createdAt: session.createdAt,
    occasion: session.occasion,
    currentMood: session.currentMood,
    desiredFeeling: session.desiredFeeling,
    state: session.state,
    intentions: session.intentions,
    source: describeStyleMeSource(session.styleFrom, session.styleMeMode),
    suggestions: session.suggestions.map((s: (typeof session.suggestions)[number]) => ({
      id: s.id,
      outfitName: s.outfitName,
      heroImageUrl: s.heroImageUrl,
      selected: s.selected,
      savedAsLook: s.savedAsLook,
      itemCount: s.items.length,
      outcome: s.outcome
        ? {
            outcomeStatus: s.outcome.outcomeStatus,
            goalOutcome: s.outcome.goalOutcome,
            whatWorked: s.outcome.whatWorked,
            whatFeltOff: s.outcome.whatFeltOff,
            didntWearReasons: s.outcome.didntWearReasons,
            submittedAt: s.outcome.submittedAt,
          }
        : null,
    })),
    review: session.review
      ? {
          workedTags: session.review.workedTags,
          didntWorkTags: session.review.didntWorkTags,
          additionalNotes: session.review.additionalNotes,
          objections: session.review.objections,
          createdAt: session.review.createdAt,
        }
      : null,
  }));
}

// ── Learning & Feedback (Taste & Evidence, admin read) ───────────────────────

export interface AdminLearningFeedbackRow {
  id: string;
  dimension: string;
  value: string;
  state: string;
  observationFamily: string;
  claimText: string | null;
  rationaleText: string | null;
  effectiveSupport: number;
  distinctSources: number;
  customerFeedback: string | null;
  customerFeedbackAt: Date | null;
  notQuiteReason: string | null;
  notQuiteNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every StyleTendency row for one customer, every state included —
 * CANDIDATE, CONFIRMED, SUPPRESSED, and REJECTED. The frozen customer-facing
 * "What nAia Is Noticing" surface only ever shows CONFIRMED rows the
 * customer hasn't corrected away (see loadConfirmedTendencies); this admin
 * read is deliberately wider, since an operator needs to see what nAia
 * tried and the customer rejected, not only what survived.
 *
 * Read-only: never writes StyleTendency, never touches TasteEvidence
 * directly (the evidence ledger, as opposed to the reconciled tendency, is
 * not needed for this tab).
 */
export async function getAdminCustomerLearningFeedback(
  customerId: string,
): Promise<AdminLearningFeedbackRow[]> {
  const rows = await prisma.styleTendency.findMany({
    where: { customerId },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      dimension: true,
      value: true,
      state: true,
      observationFamily: true,
      claimText: true,
      rationaleText: true,
      effectiveSupport: true,
      distinctSources: true,
      customerFeedback: true,
      customerFeedbackAt: true,
      notQuiteReason: true,
      notQuiteNote: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows;
}

// ── Trend Edits usage ─────────────────────────────────────────────────────────

export interface AdminTrendEditUsageRow {
  id: string;
  reportSlug: string;
  periodKey: string;
  createdAt: Date;
}

/**
 * Personalised Trend Edit usage history. Usage ledger only — the generated
 * report's content is not persisted anywhere in this codebase, so it is not
 * available here either. The tab must say so rather than reconstructing it.
 */
export async function getAdminCustomerTrendEditUsage(
  customerId: string,
): Promise<AdminTrendEditUsageRow[]> {
  return prisma.personalisedTrendEditUsage.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, reportSlug: true, periodKey: true, createdAt: true },
  });
}

// ── VTO / My nAia Model ───────────────────────────────────────────────────────

export interface AdminNaiaModelSummary {
  hasFacePhoto: boolean;
  hasBodyPhoto: boolean;
  bodyModerationStatus: string | null;
  photoAnalysisConsentAt: Date | null;
  saveModelConsentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminVtoJobSummary {
  id: string;
  productHandle: string;
  provider: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
}

/**
 * VTO / My nAia Model operational history — whether a model exists and its
 * moderation state, plus every try-on job and its outcome. Deliberately not
 * an image archive: no Cloudinary public IDs or signed URLs are returned,
 * only the operational facts an operator needs (did a job run, did it
 * finish, what product).
 */
export async function getAdminCustomerVtoHistory(
  customerId: string,
): Promise<{ model: AdminNaiaModelSummary | null; jobs: AdminVtoJobSummary[] }> {
  const [model, jobs] = await Promise.all([
    prisma.naiaModel.findUnique({
      where: { customerId },
      select: {
        facePublicId: true,
        bodyPublicId: true,
        bodyModerationStatus: true,
        photoAnalysisConsentAt: true,
        saveModelConsentAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.virtualTryOnJob.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productHandle: true,
        provider: true,
        status: true,
        createdAt: true,
        completedAt: true,
        errorCode: true,
      },
    }),
  ]);

  return {
    model: model
      ? {
          hasFacePhoto: model.facePublicId != null,
          hasBodyPhoto: model.bodyPublicId != null,
          bodyModerationStatus: model.bodyModerationStatus,
          photoAnalysisConsentAt: model.photoAnalysisConsentAt,
          saveModelConsentAt: model.saveModelConsentAt,
          createdAt: model.createdAt,
          updatedAt: model.updatedAt,
        }
      : null,
    jobs,
  };
}

// ── Activity (derived timeline) ───────────────────────────────────────────────

export interface AdminActivityEvent {
  timestamp: Date;
  label: string;
  detail: string | null;
}

/**
 * A derived activity timeline — not a new source of truth. Merges the
 * domain tables that already record something the customer did or received,
 * sorted newest first. Deliberately excludes page views / clicks: every row
 * here corresponds to a real styling, purchase-decision, feedback, or
 * generation event.
 */
export async function getAdminCustomerActivity(customerId: string): Promise<AdminActivityEvent[]> {
  const [
    sessions,
    outcomes,
    reviews,
    buySkipAnalyses,
    buySkipOutcomes,
    tendencyFeedback,
    trendEditUsage,
    vtoJobs,
    savedLooks,
  ] = await Promise.all([
    prisma.stylingSession.findMany({
      where: { customerId },
      select: { id: true, createdAt: true, occasion: true },
    }),
    prisma.styleMeOutcome.findMany({
      where: { customerId },
      select: { submittedAt: true, outcomeStatus: true },
    }),
    prisma.postOutfitReview.findMany({
      where: { customerId },
      select: { createdAt: true },
    }),
    prisma.buyOrSkipAnalysis.findMany({
      where: { customerId },
      select: { id: true, createdAt: true, verdict: true },
    }),
    prisma.buySkipOutcome.findMany({
      where: { analysis: { customerId } },
      select: { updatedAt: true, decision: true },
    }),
    prisma.styleTendency.findMany({
      where: { customerId, customerFeedbackAt: { not: null } },
      select: { customerFeedbackAt: true, customerFeedback: true, dimension: true, value: true },
    }),
    prisma.personalisedTrendEditUsage.findMany({
      where: { customerId },
      select: { createdAt: true, reportSlug: true },
    }),
    prisma.virtualTryOnJob.findMany({
      where: { customerId },
      select: { createdAt: true, productHandle: true, status: true },
    }),
    prisma.savedLook.findMany({
      where: { customerId },
      select: { createdAt: true, name: true },
    }),
  ]);

  const events: AdminActivityEvent[] = [];

  for (const s of sessions) {
    events.push({ timestamp: s.createdAt, label: "Started StyleMe", detail: s.occasion });
  }
  for (const o of outcomes) {
    events.push({
      timestamp: o.submittedAt,
      label: "StyleMe outcome recorded",
      detail: o.outcomeStatus.replace(/-/g, " "),
    });
  }
  for (const r of reviews) {
    events.push({ timestamp: r.createdAt, label: "Post-outfit review submitted", detail: null });
  }
  for (const b of buySkipAnalyses) {
    events.push({ timestamp: b.createdAt, label: "Buy/Skip analysis", detail: b.verdict });
  }
  for (const bo of buySkipOutcomes) {
    events.push({
      timestamp: bo.updatedAt,
      label: "Buy/Skip decision recorded",
      detail: bo.decision.toLowerCase().replace(/_/g, " "),
    });
  }
  for (const t of tendencyFeedback) {
    if (!t.customerFeedbackAt) continue;
    events.push({
      timestamp: t.customerFeedbackAt,
      label: `Noticing feedback: ${t.customerFeedback}`,
      detail: `${t.dimension}:${t.value}`,
    });
  }
  for (const u of trendEditUsage) {
    events.push({ timestamp: u.createdAt, label: "Personalised Trend Edit generated", detail: u.reportSlug });
  }
  for (const j of vtoJobs) {
    events.push({ timestamp: j.createdAt, label: "Virtual try-on job", detail: `${j.productHandle} (${j.status})` });
  }
  for (const sl of savedLooks) {
    events.push({ timestamp: sl.createdAt, label: "Saved a look", detail: sl.name });
  }

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events;
}

// ── Summary — strongest current CONFIRMED Noticing observation ──────────────

export interface AdminStrongestTendencySummary {
  dimension: string;
  value: string;
  claimText: string | null;
  rationaleText: string | null;
}

/**
 * Reuses the exact same CONFIRMED-only query the customer-facing Overview
 * page uses (loadStrongestConfirmedTendency) — the Summary tab shows nothing
 * an operator couldn't also see reflected back to the customer themselves.
 */
export async function getAdminCustomerStrongestTendency(
  customerId: string,
): Promise<AdminStrongestTendencySummary | null> {
  const tendency = await loadStrongestConfirmedTendency(customerId);
  if (!tendency) return null;
  return {
    dimension: tendency.dimension,
    value: tendency.value,
    claimText: tendency.claimText,
    rationaleText: tendency.rationaleText,
  };
}
