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
// Read surfaces, one set per Customer Profile tab that needed a new
// data-fetcher (Summary/Passport/Closet-summary/Buy-or-Skip list already
// existed in closet-intelligence.server.ts / buyskip-admin.server.ts and are
// reused, not duplicated, by the route):
//   getAdminCustomerClosetGallery       — Closet tab: full gallery with real resolved images
//   getAdminCustomerStyleMeSessions     — StyleMe tab: session cards + collage previews
//   getAdminCustomerStyleMeSessionDetail — StyleMe "View →": full single-session detail
//   getAdminCustomerNoticingFeedback    — "What nAia Is Noticing & Feedback" tab: CONFIRMED/REJECTED only, human-readable
//   getAdminCustomerTrendEditUsage      — Trend Edits tab: usage rows + best-effort title + hasSnapshot flag
//   getAdminCustomerTrendEditDetail     — Trend Edits "View →": the exact stored snapshot, or "not stored"
//   getAdminCustomerVtoHistory          — VTO / My nAia Model tab: operational history only
//   getAdminCustomerActivity           — Activity tab: derived timeline, no new event table
//   getAdminCustomerLifetimeUsage       — Membership & Usage tab: lifetime counts, kept separate from current-cycle entitlement numbers

import prisma from "~/db.server";
import { loadStrongestConfirmedTendency } from "~/lib/ai/taste-reconcile.server";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "~/lib/cloudinary-admin.server";
import { resolveCollageImages, resolveItemImage, type ResolvableOutfitItem } from "~/lib/styleme/look-image-resolution.server";
import { getEditorialReportBySlug } from "~/lib/editorial-reports.server";
import type { TrendEditSnapshot } from "~/lib/plan/personalised-trend-edit-usage.server";
import {
  STYLEME_STATE_LABELS,
  STYLEME_INTENTION_LABELS,
  STYLEME_FIT_COMFORT_LABELS,
  styleMeOccasionLabel,
  styleMeFormalityLabel,
  humanizeSlug,
} from "~/lib/styleme/session-vocabulary";
import {
  POST_WEAR_WORE_IT_OPTIONS,
  POST_WEAR_FEELING_OPTIONS,
  POST_WEAR_COMFORT_OPTIONS,
} from "~/routes/post-wear-review";

// ── StyleMe admin-display label resolution ───────────────────────────────────
//
// Every StyleMe field Admin shows must read the same label the customer saw —
// see session-vocabulary.ts (state/intention/fit-comfort/occasion/formality)
// and post-wear-review.tsx (the post-wear answer scales) for the canonical
// definitions. Where no canonical customer-facing label exists for a value —
// it's a purely internal engine/provenance concept the customer never saw —
// humanizeSlug formats the raw value into readable prose instead of hiding it
// or inventing meaning that was never shown to anyone.

function optionLabel(value: string | null | undefined, options: { value: string; label: string }[]): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? humanizeSlug(value);
}

function stateLabel(id: string | null): string | null {
  if (!id) return null;
  return STYLEME_STATE_LABELS[id] ?? humanizeSlug(id);
}

function intentionLabel(id: string): string {
  return STYLEME_INTENTION_LABELS[id] ?? humanizeSlug(id);
}

function fitComfortLabel(id: string): string {
  return STYLEME_FIT_COMFORT_LABELS[id] ?? humanizeSlug(id);
}

/** AnchorProvenance is an internal routing concept (schema.prisma) the
 *  customer never sees as "AUTO"/"MANUAL" text — this is the one field with
 *  no customer-facing equivalent to reuse, so it gets its own minimal,
 *  plain-English translation rather than exposing the raw enum. */
function anchorSourceLabel(provenance: string | null): string | null {
  if (provenance === "AUTO") return "nAia chose it";
  if (provenance === "MANUAL") return "Customer selected it";
  return null;
}

function humanizeArray(ids: readonly string[]): string[] {
  return ids.map((id) => humanizeSlug(id));
}

const THUMBNAIL_TRANSFORMATION = "w_160,h_160,c_fill,q_60";

/**
 * Resolves one ClosetItem's display image using the exact same canonical
 * private-delivery path the customer-facing Closet page and Buy/Skip admin
 * reader already use: signed Cloudinary URL from imagePublicId+imageFormat
 * when present (with an ownership check, since this is an admin reader),
 * falling back to the legacy public imageUrl. Never thumbnailUrl alone —
 * that legacy field is null for every private-upload record, which is why
 * the gallery previously showed "No image" for items that do have a photo.
 */
function resolveClosetItemImageUrl(
  item: { imagePublicId: string | null; imageFormat: string | null; imageUrl: string | null },
  customerId: string,
): string | null {
  if (item.imagePublicId && item.imageFormat) {
    const cfg = getCloudinaryConfig();
    if (!cfg) return null;
    const ownership = validatePublicIdOwnership(item.imagePublicId, customerId);
    if (!ownership.ok) return null;
    return buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private", undefined, undefined, THUMBNAIL_TRANSFORMATION);
  }
  if (item.imageUrl) return item.imageUrl;
  return null;
}

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
        imageUrl: true,
        imagePublicId: true,
        imageFormat: true,
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
      thumbnailUrl: resolveClosetItemImageUrl(item, customerId),
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

// The exact select shape resolveCollageImages/resolveItemImage expect — same
// shape used by my-naia._index.tsx and style-me/_index.tsx so the admin tab's
// preview is generated by the identical shared resolver, not a second one.
const STYLEME_COLLAGE_ITEM_SELECT = {
  itemType: true,
  closetItemId: true,
  productTitle: true,
  productImageUrl: true,
  closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true } },
} as const;

export interface AdminStyleMeSuggestionSummary {
  id: string;
  outfitName: string | null;
  selected: boolean;
  savedAsLook: boolean;
  itemCount: number;
  /** Resolved via the shared StyleMe collage resolver — never a raw stored heroImageUrl. */
  collageImages: string[];
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
  /** Human-readable — same label the customer saw, never the stored canonical/slug ID. */
  occasion: string | null;
  state: string | null;
  intentions: string[];
  /** Closet-only, NADINE-eligible-included, or both — derived from styleFrom/styleMeMode, never guessed. */
  source: string;
  /** True once this session actually produced a generated suggestion — distinguishes
   *  "no image because nothing resolved" from "no image because nothing was ever generated". */
  hasCompletedLook: boolean;
  suggestions: AdminStyleMeSuggestionSummary[];
  review: {
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
 * + PostOutfitReview), newest first. This is the list/card view for the
 * StyleMe tab; getAdminCustomerStyleMeSessionDetail below is the full
 * single-session detail reached via "View →".
 *
 * Bounded to the most recent RECENT_LIMIT sessions — this is the heaviest
 * query in the module (each session nests suggestions, each suggestion
 * nests items + an outcome), so the cap matters most here.
 */
export async function getAdminCustomerStyleMeSessions(
  customerId: string,
): Promise<{ items: AdminStyleMeSessionSummary[]; totalCount: number }> {
  const cloudinaryConfig = getCloudinaryConfig();
  const [sessions, totalCount] = await Promise.all([
  prisma.stylingSession.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: {
      id: true,
      createdAt: true,
      occasion: true,
      state: true,
      intentions: true,
      styleFrom: true,
      styleMeMode: true,
      suggestions: {
        select: {
          id: true,
          outfitName: true,
          selected: true,
          savedAsLook: true,
          items: { select: STYLEME_COLLAGE_ITEM_SELECT },
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
    occasion: styleMeOccasionLabel(session.occasion),
    state: stateLabel(session.state),
    intentions: session.intentions.map(intentionLabel),
    source: describeStyleMeSource(session.styleFrom, session.styleMeMode),
    hasCompletedLook: session.suggestions.length > 0,
    suggestions: session.suggestions.map((s: (typeof session.suggestions)[number]) => ({
      id: s.id,
      outfitName: s.outfitName,
      selected: s.selected,
      savedAsLook: s.savedAsLook,
      itemCount: s.items.length,
      collageImages: resolveCollageImages(s.items as ResolvableOutfitItem[], { customerId, cloudinaryConfig }).resolvedImages,
      outcome: s.outcome
        ? {
            outcomeStatus: humanizeSlug(s.outcome.outcomeStatus),
            goalOutcome: optionLabel(s.outcome.goalOutcome, [{ value: "yes", label: "Yes" }, { value: "somewhat", label: "Somewhat" }, { value: "no", label: "No" }]),
            whatWorked: humanizeArray(s.outcome.whatWorked),
            whatFeltOff: humanizeArray(s.outcome.whatFeltOff),
            didntWearReasons: humanizeArray(s.outcome.didntWearReasons),
            submittedAt: s.outcome.submittedAt,
          }
        : null,
    })),
    review: session.review
      ? {
          additionalNotes: session.review.additionalNotes,
          objections: session.review.objections,
          createdAt: session.review.createdAt,
        }
      : null,
  }));

  return { items: mapped, totalCount };
}

// ── StyleMe session detail (full, single-session) ────────────────────────────

export interface AdminStyleMeItemDetail {
  id: string;
  itemType: string;
  /** "closet" when sourced from the customer's own Closet, "nadine" for a NADINE/Shopify product. */
  itemSource: "closet" | "nadine";
  name: string | null;
  imageUrl: string | null;
  garmentRelationships: string[];
  stylingNotes: string | null;
  productUrl: string | null;
  productPrice: number | null;
}

export interface AdminStyleMeSuggestionDetail {
  id: string;
  createdAt: Date;
  status: string | null;
  outfitName: string | null;
  collageImages: string[];
  whyThisWorks: string | null;
  confidenceBoost: string | null;
  selected: boolean;
  savedAsLook: boolean;
  items: AdminStyleMeItemDetail[];
  outcome: {
    outcomeStatus: string;
    changeTypes: string[];
    otherChangeNote: string | null;
    goalOutcome: string | null;
    selectedDirection: string | null;
    whatWorked: string[];
    whatFeltOff: string[];
    didntWearReasons: string[];
    reasonOtherNote: string | null;
    submittedAt: Date;
  } | null;
}

export interface AdminStyleMeSessionDetail {
  id: string;
  createdAt: Date;
  /** Every field below is human-readable — the same label the customer saw,
   *  never the stored canonical ID/slug. See the label-resolution helpers
   *  above (session-vocabulary.ts is the canonical source for all of them). */
  occasion: string | null;
  state: string | null;
  intentions: string[];
  source: string;
  bodyNeeds: string[];
  formality: string | null;
  anchorSource: string | null;
  suggestions: AdminStyleMeSuggestionDetail[];
  review: {
    overallFeeling: number | null;
    feltLikeHer: string | null;
    desiredFeelingAchieved: string | null;
    wouldWearAgain: string | null;
    physicallyComfortable: string | null;
    additionalNotes: string | null;
    objections: string | null;
    confidenceBefore: number | null;
    confidenceAfter: number | null;
    didWearIt: string | null;
    feelingAnswer: string | null;
    fitFeedback: string | null;
    coverageFeedback: string | null;
    colourFeedback: string | null;
    createdAt: Date;
  } | null;
}

/**
 * Full detail for one StyleMe session, scoped to the given customer — returns
 * null (not the record) when the session belongs to a different customer,
 * the same ownership-scoping pattern getAdminCustomerBuySkipUploadDetail
 * uses, so a guessed/stale URL cannot reach another customer's session.
 *
 * Shows only what is durably persisted and what the current frozen StyleMe
 * V1 product actually produces; never fabricates a field that is null
 * because it was never collected for that session. Deliberately does NOT
 * select or return: currentMood/desiredFeeling/specificNeeds/bodyPreference/
 * styleDNA/weather/timeOfDay (all hardcoded null at every current Rev-3
 * write site — dead/legacy, not part of the product the customer uses
 * today), practicalIds (a derived internal engine signal with no
 * customer-facing equivalent — the customer-chosen intentions it derives
 * from are already shown), moodDescription (an internal JSON metadata
 * envelope — schemaVersion/handles/alternatives — that was never real
 * customer-facing "mood" text despite the column name), the legacy
 * perfume/hairstyle/makeup/song outputs, workedTags/didntWorkTags (dead,
 * no current write site), and the raw closetAnchorId (a database ID).
 */
export async function getAdminCustomerStyleMeSessionDetail(
  customerId: string,
  sessionId: string,
): Promise<AdminStyleMeSessionDetail | null> {
  const cloudinaryConfig = getCloudinaryConfig();
  const session = await prisma.stylingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      customerId: true,
      createdAt: true,
      occasion: true,
      state: true,
      intentions: true,
      styleFrom: true,
      styleMeMode: true,
      bodyNeeds: true,
      formalityConditional: true,
      anchorProvenance: true,
      suggestions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          status: true,
          outfitName: true,
          whyThisWorks: true,
          confidenceBoost: true,
          selected: true,
          savedAsLook: true,
          items: {
            select: {
              id: true,
              productUrl: true,
              productPrice: true,
              stylingNotes: true,
              ...STYLEME_COLLAGE_ITEM_SELECT,
              closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true, garmentRelationships: true } },
            },
          },
          outcome: {
            select: {
              outcomeStatus: true,
              changeTypes: true,
              otherChangeNote: true,
              goalOutcome: true,
              selectedDirection: true,
              whatWorked: true,
              whatFeltOff: true,
              didntWearReasons: true,
              reasonOtherNote: true,
              submittedAt: true,
            },
          },
        },
      },
      review: {
        select: {
          overallFeeling: true,
          feltLikeHer: true,
          desiredFeelingAchieved: true,
          wouldWearAgain: true,
          physicallyComfortable: true,
          additionalNotes: true,
          objections: true,
          confidenceBefore: true,
          confidenceAfter: true,
          didWearIt: true,
          feelingAnswer: true,
          fitFeedback: true,
          coverageFeedback: true,
          colourFeedback: true,
          createdAt: true,
        },
      },
    },
  });
  if (!session || session.customerId !== customerId) return null;

  return {
    id: session.id,
    createdAt: session.createdAt,
    occasion: styleMeOccasionLabel(session.occasion),
    state: stateLabel(session.state),
    intentions: session.intentions.map(intentionLabel),
    source: describeStyleMeSource(session.styleFrom, session.styleMeMode),
    bodyNeeds: session.bodyNeeds.map(fitComfortLabel),
    formality: styleMeFormalityLabel(session.formalityConditional),
    anchorSource: anchorSourceLabel(session.anchorProvenance),
    suggestions: session.suggestions.map((s: (typeof session.suggestions)[number]) => ({
      id: s.id,
      createdAt: s.createdAt,
      status: s.status,
      outfitName: s.outfitName,
      collageImages: resolveCollageImages(s.items as ResolvableOutfitItem[], { customerId, cloudinaryConfig }).resolvedImages,
      whyThisWorks: s.whyThisWorks,
      confidenceBoost: s.confidenceBoost,
      selected: s.selected,
      savedAsLook: s.savedAsLook,
      items: s.items.map((it: (typeof s.items)[number]) => ({
        id: it.id,
        itemType: it.itemType,
        itemSource: it.closetItemId ? "closet" : "nadine",
        name: it.closetItemId ? (it.closetItem?.name ?? null) : it.productTitle,
        imageUrl: resolveItemImage(it as ResolvableOutfitItem, { customerId, cloudinaryConfig }),
        garmentRelationships: it.closetItem?.garmentRelationships ?? [],
        stylingNotes: it.stylingNotes,
        productUrl: it.productUrl,
        productPrice: it.productPrice,
      })),
      outcome: s.outcome
        ? {
            outcomeStatus: humanizeSlug(s.outcome.outcomeStatus),
            changeTypes: humanizeArray(s.outcome.changeTypes),
            otherChangeNote: s.outcome.otherChangeNote,
            goalOutcome: optionLabel(s.outcome.goalOutcome, [{ value: "yes", label: "Yes" }, { value: "somewhat", label: "Somewhat" }, { value: "no", label: "No" }]),
            selectedDirection: s.outcome.selectedDirection ? humanizeSlug(s.outcome.selectedDirection) : null,
            whatWorked: humanizeArray(s.outcome.whatWorked),
            whatFeltOff: humanizeArray(s.outcome.whatFeltOff),
            didntWearReasons: humanizeArray(s.outcome.didntWearReasons),
            reasonOtherNote: s.outcome.reasonOtherNote,
            submittedAt: s.outcome.submittedAt,
          }
        : null,
    })),
    review: session.review
      ? {
          overallFeeling: session.review.overallFeeling,
          feltLikeHer: session.review.feltLikeHer,
          desiredFeelingAchieved: session.review.desiredFeelingAchieved,
          wouldWearAgain: session.review.wouldWearAgain,
          physicallyComfortable: session.review.physicallyComfortable,
          additionalNotes: session.review.additionalNotes,
          objections: session.review.objections,
          confidenceBefore: session.review.confidenceBefore,
          confidenceAfter: session.review.confidenceAfter,
          didWearIt: optionLabel(session.review.didWearIt, POST_WEAR_WORE_IT_OPTIONS),
          feelingAnswer: optionLabel(session.review.feelingAnswer, POST_WEAR_FEELING_OPTIONS),
          fitFeedback: optionLabel(session.review.fitFeedback, POST_WEAR_COMFORT_OPTIONS),
          coverageFeedback: optionLabel(session.review.coverageFeedback, POST_WEAR_COMFORT_OPTIONS),
          colourFeedback: optionLabel(session.review.colourFeedback, POST_WEAR_COMFORT_OPTIONS),
          createdAt: session.review.createdAt,
        }
      : null,
  };
}

// ── What nAia Is Noticing & Feedback (Taste & Evidence, admin read) ─────────
//
// This is an Admin PRESENTATION change only — reconcileObservations' states,
// thresholds, and evidence weighting are untouched (see taste-reconcile.server.ts).
// What changes here is which rows this tab surfaces and which fields it shows.
//
// Which rows: only CONFIRMED and REJECTED. Both states correspond to a
// moment the customer's own screen actually rendered that observation's text:
//   - CONFIRMED rows are exactly what loadConfirmedTendencies (the real
//     customer-facing "What nAia Is Noticing" reader) shows as individual
//     cards.
//   - REJECTED is reached ONLY via computeState's
//     `if (customerFeedback === "not-quite") return "REJECTED"` branch — i.e.
//     only after the customer saw a CONFIRMED card and told nAia it was
//     wrong. It is therefore also a genuinely customer-facing moment, even
//     though the card then disappears from their live page.
// CANDIDATE is deliberately excluded: loadConfirmedTendencies only ever
// returns a bare count for CANDIDATE rows (`candidateCount`), never
// individual claimText — the customer has never actually read a CANDIDATE
// observation's wording, so showing it here as though they had would
// misrepresent what was surfaced. SUPPRESSED is excluded because it is a
// purely internal contradiction/threshold outcome the customer never sees
// in any form, not even a count.
//
// Which fields: only the human-readable ones a customer's own experience
// already exposed or could have exposed — observation text (claimText),
// a plain-English status, their actual feedback choice, and the optional
// not-quite reason/note they themselves provided. Raw internal mechanics
// (dimension, value, observationFamily, effectiveSupport, distinctSources,
// wSupport/wContradict, generation) are intentionally NOT part of this
// type — an operator needing those for debugging has the underlying
// StyleTendency row available through other tooling; this tab is a
// customer-understanding surface, not a Taste-engine debug console.

export type AdminNoticingStatus = "Confirmed" | "Rejected";
export type AdminNoticingFeedback = "Accurate" | "Not quite" | "Awaiting feedback";

export interface AdminNoticingObservation {
  id: string;
  /** Human-readable observation text as the customer actually saw it (claimText). */
  observationText: string;
  status: AdminNoticingStatus;
  customerFeedback: AdminNoticingFeedback;
  notQuiteReason: string | null;
  notQuiteNote: string | null;
  /** When this observation (this generation) first existed — not a "surfaced to customer" event log, since none is stored. */
  surfacedAt: Date;
  /** When the customer actually gave feedback — null when still awaiting it. */
  feedbackAt: Date | null;
}

function noticingCustomerFeedbackLabel(customerFeedback: string | null): AdminNoticingFeedback {
  if (customerFeedback === "accurate") return "Accurate";
  if (customerFeedback === "not-quite") return "Not quite";
  return "Awaiting feedback";
}

/**
 * Every customer-visible Noticing observation for one customer — CONFIRMED
 * and REJECTED StyleTendency rows only (see rationale above), presented in
 * the plain-English shape a non-engineer operator needs. Read-only: never
 * writes StyleTendency, never touches TasteEvidence directly.
 *
 * Not take-bounded: StyleTendency cardinality is bounded by distinct
 * observation keys × generations-since-correction, not activity volume —
 * even a very active customer has on the order of tens of rows.
 */
export async function getAdminCustomerNoticingFeedback(
  customerId: string,
): Promise<AdminNoticingObservation[]> {
  const rows = await prisma.styleTendency.findMany({
    where: { customerId, state: { in: ["CONFIRMED", "REJECTED"] } },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      state: true,
      claimText: true,
      customerFeedback: true,
      customerFeedbackAt: true,
      notQuiteReason: true,
      notQuiteNote: true,
      createdAt: true,
    },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    // claimText is generated for every CONFIRMED/REJECTED row during
    // reconciliation; the fallback below is deliberately generic — never the
    // raw dimension/value key — for the rare pre-claimText historical row.
    observationText: r.claimText ?? "An observation nAia shared with this customer.",
    status: r.state === "REJECTED" ? "Rejected" : "Confirmed",
    customerFeedback: noticingCustomerFeedbackLabel(r.customerFeedback),
    notQuiteReason: r.notQuiteReason,
    notQuiteNote: r.notQuiteNote,
    surfacedAt: r.createdAt,
    feedbackAt: r.customerFeedbackAt,
  }));
}

// ── Trend Edits usage ─────────────────────────────────────────────────────────

export interface AdminTrendEditUsageRow {
  id: string;
  reportSlug: string;
  reportTitle: string;
  periodKey: string;
  createdAt: Date;
  /** True once a generation actually captured the exact generated content — see getAdminCustomerTrendEditDetail. */
  hasSnapshot: boolean;
}

/**
 * Personalised Trend Edit usage history. For rows written before snapshot
 * persistence existed, reportTitle is best-effort resolved from the live
 * editorial report (falling back to the raw slug if that report no longer
 * resolves) — resolving a title is not the same as fabricating the
 * generated content, which this function never attempts.
 *
 * Not take-bounded: one row per customer per report per calendar month
 * (@@unique(customerId, reportSlug, periodKey)), so this grows with calendar
 * time, not activity volume — low cardinality even after years of use.
 */
export async function getAdminCustomerTrendEditUsage(
  customerId: string,
): Promise<AdminTrendEditUsageRow[]> {
  const rows = await prisma.personalisedTrendEditUsage.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, reportSlug: true, periodKey: true, createdAt: true, snapshot: true },
  });

  return Promise.all(rows.map(async (r: (typeof rows)[number]) => {
    const snapshot = r.snapshot as unknown as TrendEditSnapshot | null;
    let reportTitle = snapshot?.reportTitle ?? null;
    if (!reportTitle) {
      const report = await getEditorialReportBySlug(r.reportSlug);
      reportTitle = report?.title ?? r.reportSlug;
    }
    return {
      id: r.id,
      reportSlug: r.reportSlug,
      reportTitle,
      periodKey: r.periodKey,
      createdAt: r.createdAt,
      hasSnapshot: snapshot != null,
    };
  }));
}

/**
 * Full stored snapshot for one Personalised Trend Edit usage row, scoped to
 * the given customer — returns null (not the record) when the row belongs
 * to a different customer, same ownership-scoping pattern as every other
 * detail fetcher in this module. Returns { hasSnapshot: false } rather than
 * fabricated content when the row predates snapshot persistence.
 */
export async function getAdminCustomerTrendEditDetail(
  customerId: string,
  usageId: string,
): Promise<{ hasSnapshot: boolean; snapshot: TrendEditSnapshot | null; createdAt: Date } | null> {
  const row = await prisma.personalisedTrendEditUsage.findUnique({
    where: { id: usageId },
    select: { customerId: true, createdAt: true, snapshot: true },
  });
  if (!row || row.customerId !== customerId) return null;
  const snapshot = row.snapshot as unknown as TrendEditSnapshot | null;
  return { hasSnapshot: snapshot != null, snapshot, createdAt: row.createdAt };
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

// ── Lifetime usage (distinct from getEntitlementSummary's current-cycle counts) ──

export interface AdminLifetimeUsage {
  styleMeSessions: number;
  buySkipAnalyses: number;
  vtoJobsCompleted: number;
  personalisedTrendEdits: number;
}

/**
 * Pure lifetime counts — no window filter at all, unlike every number in
 * getEntitlementSummary (which is already correctly scoped to the current
 * membership cycle via getUsageWindow()). Kept entirely separate from, and
 * never substituted for, the current-cycle numbers the progress bars use —
 * see MembershipUsageSection in admin.naia.customers.$customerId.tsx, which
 * labels these explicitly as "Lifetime: N", never as a "used / limit" ratio.
 */
export async function getAdminCustomerLifetimeUsage(customerId: string): Promise<AdminLifetimeUsage> {
  const [styleMeSessions, buySkipAnalyses, vtoJobsCompleted, personalisedTrendEdits] = await Promise.all([
    prisma.stylingSession.count({ where: { customerId, parentSessionId: null } }),
    prisma.buyOrSkipAnalysis.count({ where: { customerId } }),
    prisma.virtualTryOnJob.count({ where: { customerId, status: "COMPLETED" } }),
    prisma.personalisedTrendEditUsage.count({ where: { customerId } }),
  ]);
  return { styleMeSessions, buySkipAnalyses, vtoJobsCompleted, personalisedTrendEdits };
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
