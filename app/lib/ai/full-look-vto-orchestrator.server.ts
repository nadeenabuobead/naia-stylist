// app/lib/ai/full-look-vto-orchestrator.server.ts
//
// Customer-facing orchestration over the REAL, persisted full-look chain
// (full-look-tryon-real.server.ts) — that module's own mechanics (submit-
// then-poll, idempotent resume, per-step VirtualTryOnJob persistence) are
// reused entirely unmodified. This file only decides:
//   - which (3-FULL_LOOK_MAX_GARMENTS) of a real OutfitSuggestion's items
//     become the chain's garments (selectFullLookGarments)
//   - what reservationScope to use so a page refresh resumes the SAME
//     attempt, an explicit retry after failure gets a genuinely new one,
//     and a plain start whose latest attempt already died (or whose
//     garment selection has genuinely changed) gets a fresh one too,
//     automatically (resolveCurrentAttemptScope / startNewAttemptScope /
//     startFullLookOutfit's own terminal-state check)
//   - automatically continuing past the chain's one human-review pause,
//     so a real customer sees one continuous generation (advanceAutomatically)
//   - finding an already-completed result so revisiting never regenerates
//     or re-charges (findCompletedFullLookForSuggestion)
//
// Intended as the real replacement for api.staging-full-look-vto.tsx's
// customer-facing trigger (that route never persists anything — see its
// own header). The internal QA harnesses (staging.full-look-vto-real.tsx,
// api.staging-full-look-vto-sweep.ts) are untouched and keep using
// full-look-tryon-real.server.ts directly, with their own fixed test-only
// reservationScope — this module is never imported by either.

import { createHash } from "node:crypto";
import prisma from "../../db.server.js";
import {
  startOrResumeFullLookChain,
  advanceFullLookChain,
  continueToFinalStep,
  walkFullLookChainJobs,
  recoverFailedUploadStep,
  REAL_PRODUCT_HANDLE_PREFIX,
  REAL_RESERVATION_KEY_PREFIX,
  type FullLookChainContext,
  type FullLookRealGarmentInput,
  type IntermediateStepPreview,
} from "./full-look-tryon-real.server.js";
import { FULL_LOOK_MAX_GARMENTS, FULL_LOOK_FINAL_STEP_HANDLE_PREFIX } from "./full-look-handle-constants.js";
import { buildTryOnResultUrl } from "./fashn-tryon-service.server.js";
import { resolveItemImage, type ResolvableOutfitItem } from "~/lib/styleme/look-image-resolution.server";
import { getCloudinaryConfig, type CloudinaryConfig } from "~/lib/cloudinary-admin.server";
import type { OutfitItemType } from "@prisma/client";

const STEP1_HANDLE_PREFIX = `${REAL_PRODUCT_HANDLE_PREFIX}:step1:`;
const FINAL_STEP_HANDLE_PREFIX = FULL_LOOK_FINAL_STEP_HANDLE_PREFIX;

// ── Garment selection ────────────────────────────────────────────────────────
//
// 2026-11-15 — widened from a fixed 3-piece, clothing-only selection after
// real QA surfaced it silently dropping recommended footwear and
// accessories (e.g. brown Chelsea boots, a baseball cap) even though both
// were available and FASHN's tryon-max documents support for "clothing,
// shoes, hats, jewelry, bags, and other wearable fashion items" — there
// was never a technical reason to exclude them, only an inherited POC-era
// 3-item scope assumption.
//
// Every OutfitItemType is now eligible, selected up to FULL_LOOK_MAX_
// GARMENTS (5 — a cost/complexity ceiling, not a FASHN limit) in priority
// order: a DRESS replaces the TOP+BOTTOM pairing outright (never selects
// both a dress and a top/bottom); OUTERWEAR, SHOES, then ACCESSORY fill
// the remaining slots next (footwear and headwear read more in a
// full-body shot than a bag or jewelry typically do); BAG and JEWELRY are
// lowest priority, included when room remains.
//
// Still a pragmatic default, not a locked product decision — flagged
// explicitly for review, same as the chain's existing QA-pause/pricing
// comments flag their own open questions.
const CATEGORY_PRIORITY: readonly OutfitItemType[] = [
  "DRESS", "TOP", "BOTTOM", "OUTERWEAR", "SHOES", "ACCESSORY", "BAG", "JEWELRY",
];

export interface SelectableOutfitItem extends Omit<ResolvableOutfitItem, "closetItem"> {
  itemType: OutfitItemType;
  productTitle: string | null;
  // Stable identities (2026-11-15) — present on every real OutfitItem row
  // (Prisma scalars, not something this interface invents). Used to detect
  // when "the same suggestion" has genuinely different pieces now (a
  // closet item was swapped, or a wider category set now resolves more of
  // them) — see computeGarmentFingerprint below. Neither is required: a
  // caller that can't supply them (none currently) still gets a
  // deterministic fingerprint via the image-URL fallback.
  closetItemId?: string | null;
  shopifyProductId?: string | null;
  closetItem?: {
    name: string | null;
    imageUrl?: string | null;
    imagePublicId?: string | null;
    imageFormat?: string | null;
    category?: string | null;
  } | null;
}

export interface GarmentSelectionResult {
  garments: FullLookRealGarmentInput[];
  // Labels of recommended, available pieces that did NOT make it into this
  // chain — either because the outfit had more eligible CATEGORIES than
  // FULL_LOOK_MAX_GARMENTS allows, or because a category had more than one
  // matching item and only the first was selected (2026-11-20 — see the
  // sameCategoryOmitted comment below). Both are real, available pieces;
  // never because of a resolution failure (an unresolvable image still
  // declines the whole chain, see below). Requirement: nAia must disclose
  // this, never present the result as if it were the complete recommended
  // look. Empty when nothing was omitted.
  omittedLabels: string[];
  // 2026-11-15 — a short, stable identity for THIS exact chosen garment
  // set, baked into the reservation scope (see scopeFor) so a chain whose
  // garments have genuinely changed — e.g. a wider category set now
  // resolving boots/a cap that an older code version excluded — can never
  // resume a prior, incompatible attempt's data. Two calls with the same
  // chosen pieces (by stable id, or by image URL when no id exists) always
  // produce the same fingerprint; any real change to WHICH pieces were
  // chosen produces a different one.
  fingerprint: string;
}

function garmentIdentityKey(item: SelectableOutfitItem): string {
  const stableId = item.closetItemId ?? item.shopifyProductId ?? null;
  // Falls back to the image URL (captures "version" too — a replaced
  // closet photo gets a new URL) when no catalog/closet id is present.
  return stableId ? `id:${stableId}` : `img:${item.productImageUrl ?? item.closetItem?.imageUrl ?? ""}`;
}

export function computeGarmentFingerprint(chosen: readonly SelectableOutfitItem[]): string {
  const identity = chosen.map(garmentIdentityKey).join("|");
  // Short, fixed-length hash — keeps the reservation scope (and therefore
  // the idempotencyKey it feeds into) bounded regardless of how many
  // pieces or how long their identities are.
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

// Fewer than 3 resolvable items (category match AND a real image) → null.
// Full-Look VTO is simply not offered for this suggestion; single-item VTO
// (showTryOnSection in style-me/result.tsx) is completely unaffected and
// remains available regardless. This floor is unchanged from the original
// design — only the ceiling and category set grew.
export function selectFullLookGarments(
  items: readonly SelectableOutfitItem[],
  ctx: { customerId: string; cloudinaryConfig: CloudinaryConfig | null },
): GarmentSelectionResult | null {
  const hasDress = items.some((i) => i.itemType === "DRESS");
  const eligible: SelectableOutfitItem[] = [];
  // 2026-11-20 BUG FIX — a SECOND item of the same category (e.g. two
  // ACCESSORY pieces, a cap and a scarf) used to vanish with no disclosure
  // at all: the old `.find()` only ever looked at the FIRST match per
  // category, so a same-category runner-up was never added to `eligible`
  // and therefore never reached `omitted`/`omittedLabels` either. It just
  // disappeared from the response, violating omittedLabels' own disclosure
  // requirement (below) for any customer whose outfit genuinely has 2+
  // items of one category — not an edge case. Selection itself is
  // unchanged: `matches[0]` is the exact same "first in input order" item
  // `.find()` already picked, so `chosen`/the fingerprint are unaffected —
  // only which same-category runners-up get disclosed as omitted changes.
  const sameCategoryOmitted: SelectableOutfitItem[] = [];
  for (const category of CATEGORY_PRIORITY) {
    if (hasDress && (category === "TOP" || category === "BOTTOM")) continue;
    const matches = items.filter((i) => i.itemType === category);
    if (matches.length === 0) continue;
    eligible.push(matches[0]);
    if (matches.length > 1) sameCategoryOmitted.push(...matches.slice(1));
  }
  if (eligible.length < 3) return null;

  const chosen = eligible.slice(0, FULL_LOOK_MAX_GARMENTS);
  // Ceiling-dropped pieces (outfit had more eligible CATEGORIES than the
  // 5-slot ceiling allows) plus same-category runners-up (above) — both
  // are real, available pieces that didn't make it into the chain, and
  // omittedLabels' own contract (below) covers both equally.
  const omitted = [...eligible.slice(FULL_LOOK_MAX_GARMENTS), ...sameCategoryOmitted];

  const garments: FullLookRealGarmentInput[] = [];
  for (const item of chosen) {
    const imageUrl = resolveItemImage(item, ctx);
    if (!imageUrl) return null; // any unresolved image — decline rather than submit a broken chain
    const label = item.productTitle ?? item.closetItem?.name ?? item.itemType;
    garments.push({ label, productImageUrl: imageUrl });
  }
  const omittedLabels = omitted.map((item) => item.productTitle ?? item.closetItem?.name ?? item.itemType);
  // computeGarmentFingerprint(chosen) — unchanged input (chosen is
  // identical to before this fix), so the fingerprint, and therefore the
  // reservation scope it feeds, are unaffected by this disclosure-only fix.
  return { garments, omittedLabels, fingerprint: computeGarmentFingerprint(chosen) };
}

// ── Attempt scope — retry-safe idempotency ───────────────────────────────────
//
// Step 0's idempotency key is scoped to reservationScope (see
// getFullLookStepIdempotencyKey's own doc comment, full-look-tryon-real.
// server.ts) — reusing the SAME scope resumes the existing chain
// idempotently (safe refresh, never a duplicate FASHN call); a NEW scope
// starts a genuinely independent chain. Without this, retrying after a
// FAILED step 0 would be stuck forever: step 0's default (unscoped) key is
// deterministic per customer, so createOrFindTryOnJob would just find the
// same dead FAILED row every time and never submit again.
//
// "How many attempts exist" is counted directly off step1's own rows —
// every attempt creates exactly one new step1 row, since each attempt's
// reservationScope (and therefore idempotencyKey) differs. Fully
// server-computed from DB state, never trusting a client-supplied scope —
// the one hard invariant FullLookChainContext.reservationScope's own doc
// comment requires.
//
// 2026-11-15 — fingerprint is now baked into the scope string itself (not
// used to filter this count). The numeric index only needs to be unique
// PER FINGERPRINT, and it already is: two different fingerprints can
// freely compute the same numeric index without ever colliding, because
// the full scope string ("{suggestionId}:a{index}:{fingerprint}")
// differs. This is also what fixes the real QA bug: an outfit resolved
// under an older code version (fewer eligible categories, e.g. 3 pieces)
// has a DIFFERENT fingerprint than the same outfit resolved now (5
// pieces) — so the new request can never find, and therefore can never
// resume or replay, that old, incompatible chain's data. It simply
// computes a fresh scope and starts fresh, with no special-case
// comparison logic required.
// 2026-11-16 BUG FIX — both this and findLatestAttemptIndex (below) used to
// filter ONLY by productHandle's step1 prefix. recoverFullLookStep can
// recover step1 specifically (confirmed live: Attempt C, job
// cmwhxjd0w0001l607s25kwvq1), and its recovery row reuses that SAME step1
// productHandle (by design — same garment, same role) while using a
// completely different idempotencyKey namespace
// (getFullLookStepRecoveryIdempotencyKey's "fulllook-real-recovery:...",
// never "fulllook-real-reservation:..."). That row is therefore NOT a true
// step-0 reservation and must never be mistaken for one — the added
// idempotencyKey filter is the only thing that distinguishes them, since
// productHandle alone cannot.
function step0ReservationWhere(customerId: string, outfitSuggestionId: string) {
  return {
    customerId,
    outfitSuggestionId,
    productHandle: { startsWith: STEP1_HANDLE_PREFIX },
    idempotencyKey: { startsWith: REAL_RESERVATION_KEY_PREFIX },
  };
}

async function countAttempts(customerId: string, outfitSuggestionId: string): Promise<number> {
  return prisma.virtualTryOnJob.count({
    where: step0ReservationWhere(customerId, outfitSuggestionId),
  });
}

function scopeFor(outfitSuggestionId: string, attemptIndex: number, fingerprint: string): string {
  return `${outfitSuggestionId}:a${attemptIndex}:${fingerprint}`;
}

// A step-0 row's own idempotencyKey IS "fulllook-real-reservation:{customerId}:{reservationScope}",
// and reservationScope IS scopeFor's own "{outfitSuggestionId}:a{N}:{fingerprint}"
// (or, for a row created before fingerprint-embedding existed, the shorter
// "{outfitSuggestionId}:a{N}" with no trailing fingerprint). Reading N
// directly out of the row that actually used it is the one way to recover
// the true latest index with zero ambiguity, regardless of which format
// era created it.
function parseAttemptIndexFromStep0Key(
  idempotencyKey: string,
  customerId: string,
  outfitSuggestionId: string,
): number | null {
  const prefix = `${REAL_RESERVATION_KEY_PREFIX}${customerId}:${outfitSuggestionId}:a`;
  if (!idempotencyKey.startsWith(prefix)) return null;
  const match = /^(\d+)/.exec(idempotencyKey.slice(prefix.length));
  return match ? Number(match[1]) : null;
}

// 2026-11-15 BUG FIX — resolveCurrentAttemptScope used to compute
// latestIndex as count-1, inferring "which attempt is latest" from how
// MANY step1 rows exist right now. That breaks the instant a new attempt's
// own step1 row is created: the very next read sees a count that already
// includes it, so latestIndex comes out ONE HIGHER than the index that
// attempt actually used — making a customer's own genuinely in-progress
// attempt permanently unreachable by their own next refresh (confirmed
// live: a customer's step-1 FASHN call had completed, but every
// subsequent poll resolved to a fresh, empty scope one index ahead,
// showing "Try This Look On" instead of resuming it). Fixed by reading
// which index the MOST RECENTLY CREATED step-0 row actually used,
// directly off its own idempotencyKey, instead of inferring it from a
// count that shifts the moment that very row comes into existence.
async function findLatestAttemptIndex(customerId: string, outfitSuggestionId: string): Promise<number> {
  const latest = await prisma.virtualTryOnJob.findFirst({
    where: step0ReservationWhere(customerId, outfitSuggestionId),
    orderBy: [{ createdAt: "desc" }],
    select: { idempotencyKey: true },
  });
  if (!latest) return 0;
  return parseAttemptIndexFromStep0Key(latest.idempotencyKey, customerId, outfitSuggestionId) ?? 0;
}

// Resume (the default for every page load / poll): reuse the LATEST
// existing attempt, or attempt 0 if none exists yet. Never creates a new
// attempt on its own — only startNewAttemptScope does that.
export async function resolveCurrentAttemptScope(
  customerId: string,
  outfitSuggestionId: string,
  fingerprint: string,
): Promise<string> {
  const latestIndex = await findLatestAttemptIndex(customerId, outfitSuggestionId);
  return scopeFor(outfitSuggestionId, latestIndex, fingerprint);
}

// Retry: only ever called explicitly, after the customer's current
// attempt reached FAILED. One past the latest existing attempt — by
// construction, this can never collide with a dead key.
export async function startNewAttemptScope(
  customerId: string,
  outfitSuggestionId: string,
  fingerprint: string,
): Promise<string> {
  const count = await countAttempts(customerId, outfitSuggestionId);
  return scopeFor(outfitSuggestionId, count, fingerprint);
}

// ── Auto-advance ──────────────────────────────────────────────────────────────

// stepIndex/totalSteps (2026-11-15) — genuine generation-stage progress for
// the loading UI, not a simulated/fake progress bar. stepIndex is 0-based
// (matching advanceFullLookChain's own convention); totalSteps is THIS
// chain's own real garment count (3-5, from ctx.garments.length — chain
// length varies per outfit, see selectFullLookGarments), included so the
// client never needs to compute or guess it.
export type OrchestratorStatus =
  | { status: "PROCESSING"; stepIndex: number; totalSteps: number }
  | { status: "COMPLETED"; resultUrl: string }
  | { status: "FAILED"; errorCode?: string }
  | { status: "NOT_STARTED" }
  // checkCustomerCooldown's own "another generation is already in flight"
  // / "just finished, wait a beat" rejections — a normal, expected business
  // condition, not a server error. Distinguished from ERROR below so the
  // route can return a controlled, user-friendly response (its own HTTP
  // status, not a 500) and the client can show accurate copy instead of
  // "we couldn't create your try-on" for something that never actually
  // failed.
  | { status: "BUSY"; reason: "ACTIVE_JOB" | "COOLDOWN" }
  | { status: "ERROR"; reason: string }
  // 2026-11-16 — CONFIRMED DEFECT FIX. A step just completed (its result
  // was recovered/persisted from FASHN regardless — see
  // advanceFullLookChain's own STEP_COMPLETE_AWAITING_AUTHORIZATION
  // comment), but the next garment's submission is new, genuinely billable
  // FASHN work and was NOT authorized by this call (pollFullLookOutfit,
  // used by the GET loader, always passes allowSubmitNext: false). Never
  // confuse this with PROCESSING: nothing is in flight at FASHN right now.
  // Only startFullLookOutfit (the POST action, consent-checked) can move
  // the chain past this.
  // intermediatePreviewUrls (2026-11-20) — ONLY ever populated for the one
  // pre-final AWAITING_CONTINUE pause (see advanceAutomatically's
  // AWAITING_CONTINUE case below): advanceFullLookChain's own
  // buildIntermediatePreviews already computes a signed, short-lived,
  // customer-scoped Cloudinary URL per completed-so-far step specifically
  // for that pause ("these are exactly the images the tester needs to
  // see" — full-look-tryon-real.server.ts), and this field stops the GET
  // loader from discarding it. The ordinary STEP_COMPLETE_AWAITING_
  // AUTHORIZATION pause (ctx.advanceAutomatically's other branch landing
  // here) has no intermediates computed for it at all — this field is
  // deliberately absent/undefined there, not a gap: that pause has no
  // intermediate image of its own waiting to be seen that isn't already
  // the customer's own displayed step result. Read-only/additive: never
  // set when allowSubmitNext is true (the POST/start path always
  // continues past this pause in the same request instead of surfacing
  // it — see below).
  | { status: "AWAITING_AUTHORIZATION"; stepIndex: number; totalSteps: number; intermediatePreviewUrls?: IntermediateStepPreview[] };

const BUSY_REASONS = new Set(["ACTIVE_JOB", "COOLDOWN"]);

// advanceFullLookChain pauses exactly once (AWAITING_CONTINUE, one step
// before whichever step is final for THIS chain's own garment count) for
// the internal QA harness's human-review checkpoint —
// founder decision: a real customer sees one continuous generation, never
// an extra "continue?" step. continueToFinalStep is itself idempotent and
// safe to call repeatedly (re-derives the chain's position from DB state
// alone; see its own doc comment) — calling it immediately here, inside
// the SAME request that just observed the pause, is exactly that: one of
// its already-anticipated callers, not a new code path in that file.
//
// 2026-11-16 — allowSubmitNext gates every place this function would
// otherwise submit a NEW step (continueToFinalStep here; the equivalent
// gate for a non-final next step lives inside advanceFullLookChain
// itself). false for pollFullLookOutfit (GET — never initiates paid
// work); true for startFullLookOutfit (POST — explicit, consent-checked).
async function advanceAutomatically(
  ctx: FullLookChainContext,
  opts: { allowSubmitNext: boolean },
): Promise<OrchestratorStatus> {
  const result = await advanceFullLookChain(ctx, undefined, undefined, opts);

  switch (result.status) {
    case "AWAITING_CONTINUE": {
      if (!opts.allowSubmitNext) {
        // The pause itself is just information (nothing submitted to
        // reach it) — only continuing PAST it (continueToFinalStep, a new
        // FASHN submission) needs authorization. result.intermediates is
        // already computed by advanceFullLookChain specifically for this
        // pause (see buildIntermediatePreviews) — surface it instead of
        // discarding it, so a GET/poll hitting this exact state is finally
        // the one place a tester (or a real customer's own client) can see
        // the "one before final" step's own output image before it is
        // deleted at chain completion (cleanupIntermediateStepResults).
        return {
          status: "AWAITING_AUTHORIZATION",
          stepIndex: ctx.garments.length - 2,
          totalSteps: ctx.garments.length,
          intermediatePreviewUrls: result.intermediates,
        };
      }
      const cont = await continueToFinalStep(ctx);
      if (!cont.ok) return { status: "ERROR", reason: cont.reason };
      // Final step is now submitted (not completed) — PROCESSING is
      // accurate; the next poll will observe its real status.
      return { status: "PROCESSING", stepIndex: ctx.garments.length - 1, totalSteps: ctx.garments.length };
    }
    case "COMPLETED":
      return { status: "COMPLETED", resultUrl: result.resultUrl };
    case "FAILED":
      return { status: "FAILED", errorCode: result.errorCode ?? undefined };
    case "NOT_STARTED":
      return { status: "NOT_STARTED" };
    case "PROCESSING":
      return { status: "PROCESSING", stepIndex: result.stepIndex, totalSteps: ctx.garments.length };
    case "STEP_COMPLETE_AWAITING_AUTHORIZATION":
      return { status: "AWAITING_AUTHORIZATION", stepIndex: result.completedStepIndex, totalSteps: ctx.garments.length };
    case "SUBMIT_ERROR":
      return { status: "ERROR", reason: result.reason };
    case "EXPIRED":
      // The one pause this chain has expired (QA_PAUSE_EXPIRY_MS, 30 min)
      // without continuing — should never actually happen for a real
      // customer now that this module auto-continues in the same request
      // that observes the pause, but handled explicitly rather than
      // falling through, since "never happens" is not "cannot happen".
      return { status: "FAILED", errorCode: "continue_window_expired" };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

// A chain in one of these statuses can never advance again on its own —
// resuming it for an EXPLICIT start would just replay the same dead
// failure forever. COMPLETED is deliberately excluded: that's handled by
// findCompletedFullLookForSuggestion before this function is ever called,
// and advanceFullLookChain's own COMPLETED detection handles it correctly
// regardless — this set exists only to detect "nothing more will ever
// happen here," not "something happened here."
const TERMINAL_DEAD_STATUSES = new Set(["FAILED", "CANCELED", "TIMED_OUT"]);

export async function startFullLookOutfit(
  baseCtx: Omit<FullLookChainContext, "reservationScope">,
  fingerprint: string,
  opts: { forceNewAttempt?: boolean } = {},
): Promise<OrchestratorStatus> {
  let scope = opts.forceNewAttempt
    ? await startNewAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId, fingerprint)
    : await resolveCurrentAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId, fingerprint);

  // 2026-11-15 REGRESSION FIX — a plain (non-retry) explicit start used to
  // unconditionally resume whatever the latest matching-fingerprint
  // attempt was, even if it had already reached a dead terminal state —
  // silently replaying an old failure instead of giving this click a real
  // attempt. Checked via a pure DB read (walkFullLookChainJobs — no FASHN
  // I/O, no cost) and ONLY on an explicit, non-retry start: a passive GET
  // poll (pollFullLookOutfit, below) must keep reporting the true FAILED
  // state so the UI's "Try Again" affordance stays meaningful, not
  // auto-retry behind the customer's back. forceNewAttempt is excluded
  // here too — it already computes a genuinely new scope unconditionally,
  // so this check would be redundant (and the existingJobs read for the
  // brand-new scope would always be empty anyway).
  if (!opts.forceNewAttempt) {
    const existingJobs = await walkFullLookChainJobs(baseCtx.customerId, undefined, scope);
    const lastJob = existingJobs[existingJobs.length - 1];
    if (lastJob && TERMINAL_DEAD_STATUSES.has(lastJob.status)) {
      scope = await startNewAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId, fingerprint);
    }
  }

  const ctx: FullLookChainContext = { ...baseCtx, reservationScope: scope };

  const start = await startOrResumeFullLookChain(ctx);
  if (!start.ok) {
    if (BUSY_REASONS.has(start.reason)) {
      return { status: "BUSY", reason: start.reason as "ACTIVE_JOB" | "COOLDOWN" };
    }
    return { status: "ERROR", reason: start.reason };
  }
  // Explicit, consented POST (start or retry) — authorized to submit a
  // new step.
  return advanceAutomatically(ctx, { allowSubmitNext: true });
}

// 2026-11-16 — CONFIRMED DEFECT FIX. Used exclusively by the GET loader
// (api.full-look-vto.tsx), which fires automatically on every page mount
// and every 3s poll with no consent check and no explicit customer action.
// Before this fix, this function's own advanceAutomatically call could
// submit a brand-new, genuinely billable FASHN prediction purely as a
// side effect of loading or refreshing the page. allowSubmitNext: false
// makes this strictly a status check: it still recovers and persists
// whatever the CURRENT step's FASHN result already is (pollFullLookRealStep
// runs unconditionally — that's free, since the prediction was already
// paid for), but it can never submit the next one.
export async function pollFullLookOutfit(
  baseCtx: Omit<FullLookChainContext, "reservationScope">,
  fingerprint: string,
): Promise<OrchestratorStatus> {
  const scope = await resolveCurrentAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId, fingerprint);
  const ctx: FullLookChainContext = { ...baseCtx, reservationScope: scope };
  return advanceAutomatically(ctx, { allowSubmitNext: false });
}

// ── Recovery (2026-11-16) — the ONLY entry point to recoverFailedUploadStep ──
//
// Reused machinery, new purpose: resolves the SAME current scope every
// other entry point uses, walks it with the SAME walkFullLookChainJobs,
// and only ever acts if the chain's own LATEST step is FAILED — never
// touches any other job, never guesses which step to recover from client
// input (the client never supplies a jobId; this always resolves it
// server-side from the authenticated session's own current state, the
// same discipline as everything else in this file).
export type RecoveryOutcome =
  | { status: "RECOVERED"; alreadyRecovered: boolean }
  | { status: "NOT_RECOVERABLE"; reason: string }
  | { status: "ERROR"; reason: string };

export async function recoverFullLookStep(
  baseCtx: Omit<FullLookChainContext, "reservationScope">,
  fingerprint: string,
): Promise<RecoveryOutcome> {
  const scope = await resolveCurrentAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId, fingerprint);
  const ctx: FullLookChainContext = { ...baseCtx, reservationScope: scope };

  const jobs = await walkFullLookChainJobs(ctx.customerId, undefined, scope);
  const lastJob = jobs[jobs.length - 1];
  if (!lastJob) {
    return { status: "NOT_RECOVERABLE", reason: "NO_CHAIN_STARTED" };
  }
  if (lastJob.status !== "FAILED") {
    // Nothing to recover — PROCESSING/COMPLETED/CREATED/SUBMITTED all mean
    // the latest step either already succeeded or is still legitimately
    // in flight. Recovery is only ever for a genuinely dead step.
    return { status: "NOT_RECOVERABLE", reason: "LATEST_STEP_NOT_FAILED" };
  }

  const result = await recoverFailedUploadStep(ctx, lastJob);
  if (!result.ok) {
    return { status: "ERROR", reason: result.reason };
  }
  return { status: "RECOVERED", alreadyRecovered: result.alreadyRecovered };
}

// ── Existing-result lookup — never regenerate on revisit ─────────────────────
//
// Reopening StyleMe History or My nAia Model must show the already-
// completed result, not re-trigger generation (which would both waste a
// FASHN call and, without this, risk re-charging the credit the founder
// decision says a completed outfit costs exactly once).

export interface CompletedFullLookResult {
  jobId: string;
  resultUrl: string;
  completedAt: Date | null;
}

export async function findCompletedFullLookForSuggestion(
  customerId: string,
  outfitSuggestionId: string,
): Promise<CompletedFullLookResult | null> {
  const job = await prisma.virtualTryOnJob.findFirst({
    where: {
      customerId,
      outfitSuggestionId,
      productHandle: { startsWith: FINAL_STEP_HANDLE_PREFIX },
      status: "COMPLETED",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!job) return null;
  const resultUrl = buildTryOnResultUrl(customerId, job.id);
  if (!resultUrl) return null;
  return { jobId: job.id, resultUrl, completedAt: job.completedAt };
}
