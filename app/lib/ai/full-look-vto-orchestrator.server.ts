// app/lib/ai/full-look-vto-orchestrator.server.ts
//
// Customer-facing orchestration over the REAL, persisted full-look chain
// (full-look-tryon-real.server.ts) — that module's own mechanics (submit-
// then-poll, idempotent resume, per-step VirtualTryOnJob persistence) are
// reused entirely unmodified. This file only decides:
//   - which 3 of a real OutfitSuggestion's items become the chain's 3
//     garments (selectFullLookGarments)
//   - what reservationScope to use so a page refresh resumes the SAME
//     attempt, while an explicit retry after failure gets a genuinely new
//     one (resolveCurrentAttemptScope / startNewAttemptScope)
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

import prisma from "../../db.server.js";
import {
  startOrResumeFullLookChain,
  advanceFullLookChain,
  continueToFinalStep,
  REAL_PRODUCT_HANDLE_PREFIX,
  type FullLookChainContext,
  type FullLookRealGarmentInput,
} from "./full-look-tryon-real.server.js";
import { MAX_CHAIN_LENGTH } from "./poc-sequential-full-look-vto.server.js";
import { buildTryOnResultUrl } from "./fashn-tryon-service.server.js";
import { resolveItemImage, type ResolvableOutfitItem } from "~/lib/styleme/look-image-resolution.server";
import { getCloudinaryConfig, type CloudinaryConfig } from "~/lib/cloudinary-admin.server";
import type { OutfitItemType } from "@prisma/client";

const STEP1_HANDLE_PREFIX = `${REAL_PRODUCT_HANDLE_PREFIX}:step1:`;
const FINAL_STEP_HANDLE_PREFIX = `${REAL_PRODUCT_HANDLE_PREFIX}:step${MAX_CHAIN_LENGTH}:`;

// ── Garment selection ────────────────────────────────────────────────────────
//
// The chain is architecturally fixed at exactly MAX_CHAIN_LENGTH (3) steps
// — idempotency-key derivation, product-handle naming, and the chain-walk
// logic all assume it. A real OutfitSuggestion can have anywhere from 1 to
// 8 items across every OutfitItemType. This priority order picks the 3
// pieces that most visibly change how a full-body try-on reads: a DRESS
// replaces the TOP+BOTTOM pairing outright (never selects both a dress and
// a top/bottom); OUTERWEAR and SHOES fill the remaining slots next.
// BAG/ACCESSORY/JEWELRY are never selected — small items FASHN's
// tryon-max isn't built to visibly change on a full-body render, matching
// this chain's own fixture precedent (trousers/shirt/blazer — BOTTOM,
// TOP, OUTERWEAR — see full-look-tryon-real.server.test.ts's own fixtures).
//
// This is a pragmatic default, not a locked product decision — flagged
// explicitly for review, same as the chain's existing QA-pause/pricing
// comments flag their own open questions.
const CATEGORY_PRIORITY: readonly OutfitItemType[] = ["DRESS", "TOP", "BOTTOM", "OUTERWEAR", "SHOES"];

export interface SelectableOutfitItem extends Omit<ResolvableOutfitItem, "closetItem"> {
  itemType: OutfitItemType;
  productTitle: string | null;
  closetItem?: {
    name: string | null;
    imageUrl?: string | null;
    imagePublicId?: string | null;
    imageFormat?: string | null;
    category?: string | null;
  } | null;
}

// Fewer than MAX_CHAIN_LENGTH resolvable items (category match AND a real
// image) → null. Full-Look VTO is simply not offered for this suggestion;
// single-item VTO (showTryOnSection in style-me/result.tsx) is completely
// unaffected and remains available regardless.
export function selectFullLookGarments(
  items: readonly SelectableOutfitItem[],
  ctx: { customerId: string; cloudinaryConfig: CloudinaryConfig | null },
): FullLookRealGarmentInput[] | null {
  const hasDress = items.some((i) => i.itemType === "DRESS");
  const chosen: SelectableOutfitItem[] = [];
  for (const category of CATEGORY_PRIORITY) {
    if (hasDress && (category === "TOP" || category === "BOTTOM")) continue;
    const match = items.find((i) => i.itemType === category && !chosen.includes(i));
    if (match) chosen.push(match);
    if (chosen.length === MAX_CHAIN_LENGTH) break;
  }
  if (chosen.length < MAX_CHAIN_LENGTH) return null;

  const garments: FullLookRealGarmentInput[] = [];
  for (const item of chosen) {
    const imageUrl = resolveItemImage(item, ctx);
    if (!imageUrl) return null; // any unresolved image — decline rather than submit a broken chain
    const label = item.productTitle ?? item.closetItem?.name ?? item.itemType;
    garments.push({ label, productImageUrl: imageUrl });
  }
  return garments;
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
async function countAttempts(customerId: string, outfitSuggestionId: string): Promise<number> {
  return prisma.virtualTryOnJob.count({
    where: { customerId, outfitSuggestionId, productHandle: { startsWith: STEP1_HANDLE_PREFIX } },
  });
}

function scopeFor(outfitSuggestionId: string, attemptIndex: number): string {
  return `${outfitSuggestionId}:a${attemptIndex}`;
}

// Resume (the default for every page load / poll): reuse the LATEST
// existing attempt, or attempt 0 if none exists yet. Never creates a new
// attempt on its own — only startNewAttemptScope does that.
export async function resolveCurrentAttemptScope(customerId: string, outfitSuggestionId: string): Promise<string> {
  const count = await countAttempts(customerId, outfitSuggestionId);
  const latestIndex = Math.max(0, count - 1);
  return scopeFor(outfitSuggestionId, latestIndex);
}

// Retry: only ever called explicitly, after the customer's current
// attempt reached FAILED. One past the latest existing attempt — by
// construction, this can never collide with a dead key.
export async function startNewAttemptScope(customerId: string, outfitSuggestionId: string): Promise<string> {
  const count = await countAttempts(customerId, outfitSuggestionId);
  return scopeFor(outfitSuggestionId, count);
}

// ── Auto-advance ──────────────────────────────────────────────────────────────

export type OrchestratorStatus =
  | { status: "PROCESSING" }
  | { status: "COMPLETED"; resultUrl: string }
  | { status: "FAILED"; errorCode?: string }
  | { status: "NOT_STARTED" }
  | { status: "ERROR"; reason: string };

// advanceFullLookChain pauses exactly once (AWAITING_CONTINUE, between
// steps 2 and 3) for the internal QA harness's human-review checkpoint —
// founder decision: a real customer sees one continuous generation, never
// an extra "continue?" step. continueToFinalStep is itself idempotent and
// safe to call repeatedly (re-derives the chain's position from DB state
// alone; see its own doc comment) — calling it immediately here, inside
// the SAME request that just observed the pause, is exactly that: one of
// its already-anticipated callers, not a new code path in that file.
async function advanceAutomatically(ctx: FullLookChainContext): Promise<OrchestratorStatus> {
  const result = await advanceFullLookChain(ctx);

  switch (result.status) {
    case "AWAITING_CONTINUE": {
      const cont = await continueToFinalStep(ctx);
      if (!cont.ok) return { status: "ERROR", reason: cont.reason };
      // Final step is now submitted (not completed) — PROCESSING is
      // accurate; the next poll will observe its real status.
      return { status: "PROCESSING" };
    }
    case "COMPLETED":
      return { status: "COMPLETED", resultUrl: result.resultUrl };
    case "FAILED":
      return { status: "FAILED", errorCode: result.errorCode ?? undefined };
    case "NOT_STARTED":
      return { status: "NOT_STARTED" };
    case "PROCESSING":
      return { status: "PROCESSING" };
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

export async function startFullLookOutfit(
  baseCtx: Omit<FullLookChainContext, "reservationScope">,
  opts: { forceNewAttempt?: boolean } = {},
): Promise<OrchestratorStatus> {
  const scope = opts.forceNewAttempt
    ? await startNewAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId)
    : await resolveCurrentAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId);
  const ctx: FullLookChainContext = { ...baseCtx, reservationScope: scope };

  const start = await startOrResumeFullLookChain(ctx);
  if (!start.ok) return { status: "ERROR", reason: start.reason };
  return advanceAutomatically(ctx);
}

export async function pollFullLookOutfit(
  baseCtx: Omit<FullLookChainContext, "reservationScope">,
): Promise<OrchestratorStatus> {
  const scope = await resolveCurrentAttemptScope(baseCtx.customerId, baseCtx.outfitSuggestionId);
  const ctx: FullLookChainContext = { ...baseCtx, reservationScope: scope };
  return advanceAutomatically(ctx);
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
