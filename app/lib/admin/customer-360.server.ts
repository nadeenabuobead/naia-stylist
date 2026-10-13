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

// ── Bounding — V1 protection against unbounded lifetime history ─────────────
//
// The Customer Profile page loads every tab's data up front on a single page
// open. Closet, StyleMe, and VTO rows accumulate with customer activity over
// time and have no natural upper bound, so each is capped to the most recent
// RECENT_LIMIT rows (newest first — the ordering already in place) with a
// sibling totalCount so the tab can say "showing 25 of 143" rather than
// silently truncating. This is a static cap, not pagination: no cursor, no
// "Load more". If an operator needs deeper history than this, that is a
// follow-up, not a V1 requirement.
//
// StyleTendency (Learning & Feedback) and PersonalisedTrendEditUsage (Trend
// Edits) are deliberately NOT capped here — their cardinality is bounded by
// something other than activity volume (StyleTendency: distinct
// dimension/value observation keys × generations-since-correction, typically
// a few dozen rows even for a very active customer; PersonalisedTrendEditUsage:
// one row per customer per report per calendar month, @@unique-enforced). Capping
// either risks hiding real REJECTED/CONFIRMED history or a usage month for no
// real protection.
const RECENT_LIMIT = 25;

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
 *
 * Bounded to the most recent RECENT_LIMIT items (see note above) — returns
 * totalCount alongside so the tab can show "showing N of total".
 */
export async function getAdminCustomerClosetGallery(
  customerId: string,
): Promise<{ items: AdminClosetGalleryItem[]; totalCount: number }> {
  const [items, totalCount] = await Promise.all([
    prisma.closetItem.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
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
    }),
    prisma.closetItem.count({ where: { customerId } }),
  ]);

  return {
    items: items.map((item: (typeof items)[number]) => ({
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
    })),
    totalCount,
  };
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
 *
 * Bounded to the most recent RECENT_LIMIT sessions — this is the heaviest
 * query in the module (each session nests suggestions, each suggestion
 * nests items + an outcome), so the cap matters most here.
 */
export async function getAdminCustomerStyleMeSessions(
  customerId: string,
): Promise<{ items: AdminStyleMeSessionSummary[]; totalCount: number }> {
  const [sessions, totalCount] = await Promise.all([
  prisma.stylingSession.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
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
  }),
  prisma.stylingSession.count({ where: { customerId } }),
  ]);

  const mapped = sessions.map((session: (typeof sessions)[number]) => ({
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

  return { items: mapped, totalCount };
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
 *
 * Not take-bounded: unlike Closet/StyleMe/VTO, StyleTendency rows don't grow
 * with activity volume — reconcileObservations collapses evidence onto one
 * row per (observationKey, generation), so even a very active customer has
 * on the order of tens of rows, not one per feedback event. Capping it would
 * risk hiding REJECTED history for no real protection.
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
 *
 * Not take-bounded: one row per customer per report per calendar month
 * (@@unique(customerId, reportSlug, periodKey)), so this grows with calendar
 * time, not activity volume — low cardinality even after years of use.
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
 *
 * jobs is bounded to the most recent RECENT_LIMIT — one row per try-on
 * attempt, so this does grow with activity volume.
 */
export async function getAdminCustomerVtoHistory(
  customerId: string,
): Promise<{ model: AdminNaiaModelSummary | null; jobs: AdminVtoJobSummary[]; jobsTotalCount: number }> {
  const [model, jobs, jobsTotalCount] = await Promise.all([
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
      take: RECENT_LIMIT,
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
    prisma.virtualTryOnJob.count({ where: { customerId } }),
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
    jobsTotalCount,
  };
}

// ── Activity (derived timeline) ───────────────────────────────────────────────

export interface AdminActivityEvent {
  timestamp: Date;
  label: string;
  detail: string | null;
}

// Every event below is placed at a durable, already-persisted timestamp
// field — never an inferred or reconstructed one. In particular:
//   - VirtualTryOnJob uses completedAt when the job has actually finished,
//     falling back to createdAt only while it's still in flight — pairing
//     createdAt with a later-reached status (e.g. showing "COMPLETED" at the
//     moment the job merely started) would misrepresent when that status was
//     actually reached.
//   - StyleTendency contributes only an explicit customer-feedback event at
//     customerFeedbackAt (proven by that column being non-null) — it does
//     NOT synthesize separate CREATED/CONFIRMED/REJECTED transition events,
//     because no per-transition timestamp is durably stored; state changes
//     silently inside reconcileObservations with only updatedAt moving, which
//     is not reliable enough to label as a specific transition. Current state
//     is shown independently in the Learning & Feedback tab instead.
//   - BuySkipOutcome uses updatedAt deliberately: decision and
//     postPurchaseOutcome are written together in a single upsert (see
//     recordOutcome() in api.wishlist.jsx), so updatedAt genuinely is "when
//     the currently-known decision was last written" — not a fabricated
//     separate event.

// Per-source cap feeding the merged timeline — keeps nine independent queries
// each bounded before they're combined and re-sorted, rather than letting any
// single source stream unbounded lifetime rows into memory.
const ACTIVITY_SOURCE_LIMIT = 50;
// Final cap on the merged, sorted timeline shown to the operator.
const ACTIVITY_DISPLAY_LIMIT = 50;

/**
 * A derived activity timeline — not a new source of truth. Merges the
 * domain tables that already record something the customer did or received,
 * sorted newest first. Deliberately excludes page views / clicks: every row
 * here corresponds to a real styling, purchase-decision, feedback, or
 * generation event.
 *
 * Each source query is independently bounded to the most recent
 * ACTIVITY_SOURCE_LIMIT rows before merging, and the merged result is capped
 * to ACTIVITY_DISPLAY_LIMIT — this is a lifetime-history source (nine tables,
 * one page load), so it is the most important fetcher in this module to
 * bound.
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
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { id: true, createdAt: true, occasion: true },
    }),
    prisma.styleMeOutcome.findMany({
      where: { customerId },
      orderBy: { submittedAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { submittedAt: true, outcomeStatus: true },
    }),
    prisma.postOutfitReview.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { createdAt: true },
    }),
    prisma.buyOrSkipAnalysis.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { id: true, createdAt: true, verdict: true },
    }),
    prisma.buySkipOutcome.findMany({
      where: { analysis: { customerId } },
      orderBy: { updatedAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { updatedAt: true, decision: true, postPurchaseOutcome: true },
    }),
    prisma.styleTendency.findMany({
      where: { customerId, customerFeedbackAt: { not: null } },
      orderBy: { customerFeedbackAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { customerFeedbackAt: true, customerFeedback: true, dimension: true, value: true },
    }),
    prisma.personalisedTrendEditUsage.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { createdAt: true, reportSlug: true },
    }),
    prisma.virtualTryOnJob.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
      select: { createdAt: true, completedAt: true, productHandle: true, status: true },
    }),
    prisma.savedLook.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_SOURCE_LIMIT,
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
    // decision and postPurchaseOutcome are always written together in a
    // single upsert (see recordOutcome() in api.wishlist.jsx), so there is
    // exactly one durable timestamp for this row: updatedAt. That timestamp
    // proves "the outcome row was last written at this instant" — it does
    // NOT prove when the decision was first made versus when
    // postPurchaseOutcome was added, since both can change in the same
    // upsert. Labeling this "decision recorded" would overstate what's
    // known; "outcome updated" with both current values in the detail is
    // the truthful read of this one row.
    const detailParts = [bo.decision.toLowerCase().replace(/_/g, " ")];
    if (bo.postPurchaseOutcome) detailParts.push(bo.postPurchaseOutcome.toLowerCase().replace(/_/g, " "));
    events.push({
      timestamp: bo.updatedAt,
      label: "Buy/Skip outcome updated",
      detail: detailParts.join(" · "),
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
    // completedAt is only set once the job actually reaches a terminal
    // state — use it when present so the event timestamp matches when that
    // status was really reached, not when the job merely started.
    if (j.completedAt) {
      events.push({ timestamp: j.completedAt, label: "Virtual try-on job finished", detail: `${j.productHandle} (${j.status})` });
    } else {
      events.push({ timestamp: j.createdAt, label: "Virtual try-on job started", detail: `${j.productHandle} (${j.status})` });
    }
  }
  for (const sl of savedLooks) {
    events.push({ timestamp: sl.createdAt, label: "Saved a look", detail: sl.name });
  }

  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events.slice(0, ACTIVITY_DISPLAY_LIMIT);
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
