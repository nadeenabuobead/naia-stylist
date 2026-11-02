// app/lib/ai/poc-job-tracked-full-look-chain.server.ts
//
// PROOF OF CONCEPT, Stage 2B — wraps the sequential full-look VTO chain
// (poc-sequential-full-look-vto.server.ts's own approach) with the REAL
// production VirtualTryOnJob lifecycle (checkCustomerCooldown,
// createOrFindTryOnJob, advanceTryOnJob — all from my-naia-model.server.ts,
// unmodified), instead of running the chain with no DB record at all.
//
// NOT REGISTERED anywhere; not wired to staging.full-look-vto-test.tsx yet.
// FASHN itself is still only ever reached through an injected tryOnOptions
// (a mock in every test here) — this module adds job bookkeeping, nothing
// about the provider call or the model photo changes.
//
// ── Issue 1 — cooldown placement (fixed) ─────────────────────────────────────
// checkCustomerCooldown enforces a 2-second post-completion buffer AND an
// active-job check (my-naia-model.server.ts:662-684). Calling it before
// EVERY step would self-block the chain: step N's job is marked COMPLETED
// microseconds before step N+1's cooldown check runs in the same synchronous
// request, so `elapsed` is reliably well under 2000ms and the chain would
// block itself on its own prior step almost every time. Confirmed by reading
// checkCustomerCooldown's own body, not assumed.
//
// Fix: checkCustomerCooldown is called exactly ONCE, before step 1 — where
// it is doing its real job (refusing a chain that starts right on top of
// some OTHER recent/active VTO work for this customer). Steps 2 and 3 go
// straight to createOrFindTryOnJob, which still fully protects against a
// genuinely concurrent, unrelated request (its own Serializable active-job
// check is untouched and still runs for every step) — only the redundant,
// self-defeating cooldown re-check is skipped, and only for continuation
// steps of this same, already-authorized chain.
//
// ── Issue 2 — race-safe single-attempt reservation (fixed) ──────────────────
// The previous design's "has a prior job for this customer's test prefix
// ever existed" was a plain COUNT query — read-then-decide, not atomic.
// This version instead uses VirtualTryOnJob.idempotencyKey's EXISTING
// `@unique` database constraint as the reservation itself: step 1 always
// requests the exact same, deterministic key for a given customer
// (RESERVATION_KEY_PREFIX + customerId). createOrFindTryOnJob's own
// behaviour is what makes this safe — "same idempotency key + same
// customer → return the existing row" is backed by a real unique-constraint
// race (P2002), inside the function's own fast-path AND inside its
// Serializable transaction's duplicate-key handling, not by a count the
// caller computed and could already be stale by the time it acts on it.
// If `created` comes back false, this customer has already claimed this
// one-time reservation before — successfully, unsuccessfully, or still in
// flight — and the chain refuses, full stop, regardless of that prior job's
// status. No new schema, no new field: the reservation IS the existing
// unique idempotency key.
//
// ── Issue 3 — execution timeout (NOT resolved here, flagged) ────────────────
// A full 3-step chain, each step polling runFashnTryOn's existing ~90s
// ceiling, is up to ~270s of synchronous wall-clock time in the worst case.
// No maxDuration/functions config exists anywhere in this repo today (and
// the pre-existing api.staging-full-look-vto.tsx prototype has the
// identical, already-flagged, never-resolved risk at a smaller ~90s scale).
// This module does not change that: it still runs all 3 steps synchronously
// within one call. It is safe here ONLY because every test below uses a
// mock fetch that resolves instantly — there is no real wall-clock risk
// until FASHN is real. Before the real run, this needs either a verified,
// explicitly-approved execution-time allowance, or restructuring onto the
// existing async submit-then-poll pattern (submitTryOnToProvider +
// the separate poll route) across multiple requests instead of one. Neither
// is decided or implemented here — this is a known, reported blocker, not a
// silently-resolved one.

import {
  checkCustomerCooldown,
  createOrFindTryOnJob,
  advanceTryOnJob,
} from "./my-naia-model.server.js";
import { runFashnTryOn, type RunTryOnOptions } from "./fashn-try-on.server.js";
import type { VirtualTryOnConsent } from "./virtual-try-on.types.js";

const RESERVATION_KEY_PREFIX = "fulllook-poc-reservation:";

export interface JobTrackedChainGarmentInput {
  label: string;
  category: string;
  subcategory: string | null;
  productImageUrl: string;
}

export interface JobTrackedChainArgs {
  customerId: string;
  naiaModelId: string | null;
  bodyPublicId: string | null;
  initialModelImageDataUrl: string;
  garments: readonly JobTrackedChainGarmentInput[]; // already ordered body-outward by the caller
  consent: VirtualTryOnConsent;
}

export interface JobTrackedChainStepResult {
  label: string;
  jobId: string;
  ok: boolean;
}

export type JobTrackedChainReport =
  | { ok: true; creditsUsed: number; steps: JobTrackedChainStepResult[]; finalImageDataUrl: string }
  | {
      ok: false;
      reason: "duplicate_attempt_blocked" | "full_look_test_already_attempted" | "job_creation_failed" | "step_failed";
      creditsUsed: number;
      steps: JobTrackedChainStepResult[];
      failedStepIndex?: number;
    };

export async function runJobTrackedFullLookChain(
  args: JobTrackedChainArgs,
  tryOnOptions: RunTryOnOptions = {},
): Promise<JobTrackedChainReport> {
  const { customerId, naiaModelId, bodyPublicId, garments, consent } = args;

  // ── Cooldown — once, before step 1 only. See header for why. ─────────────
  const cooldown = await checkCustomerCooldown(customerId);
  if (!cooldown.ok) {
    return { ok: false, reason: "duplicate_attempt_blocked", creditsUsed: 0, steps: [] };
  }

  const steps: JobTrackedChainStepResult[] = [];
  let currentModelImage = args.initialModelImageDataUrl;
  let priorJobId: string | null = null;

  for (let i = 0; i < garments.length; i++) {
    const garment = garments[i];

    // ── Issue 2's fix: step 1's key is deterministic and customer-scoped —
    // the one-time reservation. Steps 2+ use a key derived from step 1's own
    // (freshly created, globally unique) job id — never reused, never
    // colliding, and not itself a second reservation check. ────────────────
    const idempotencyKey =
      i === 0
        ? `${RESERVATION_KEY_PREFIX}${customerId}`
        : `fulllook-poc-step:${priorJobId}:${i + 1}`;

    const jobResult = await createOrFindTryOnJob({
      customerId,
      naiaModelId,
      productHandle: `fulllook-poc:step${i + 1}:${garment.label}`,
      bodyPublicId,
      virtualTryOnConsentAt: new Date(consent.consentedAt),
      idempotencyKey,
    });

    if (!jobResult.ok) {
      return { ok: false, reason: "job_creation_failed", creditsUsed: steps.length, steps };
    }

    if (!jobResult.created) {
      // Step 1: this exact customer already claimed the one-time
      // reservation before (any status) — refuse, regardless of step index,
      // though in practice this can only happen at i === 0.
      return {
        ok: false,
        reason: i === 0 ? "full_look_test_already_attempted" : "duplicate_attempt_blocked",
        creditsUsed: steps.length,
        steps,
      };
    }

    const job = jobResult.job;
    priorJobId = job.id;

    const submitted = await advanceTryOnJob(job, "SUBMITTED", {});
    if (!submitted.ok) {
      return { ok: false, reason: "job_creation_failed", creditsUsed: steps.length, steps };
    }

    const result = await runFashnTryOn(
      {
        customerId,
        modelImageDataUrl: currentModelImage,
        productImageUrl: garment.productImageUrl,
        productHandle: job.productHandle,
        consent,
      },
      tryOnOptions,
    );

    if (!result.ok) {
      await advanceTryOnJob(submitted.job, "FAILED", { errorCode: result.code });
      steps.push({ label: garment.label, jobId: job.id, ok: false });
      return { ok: false, reason: "step_failed", creditsUsed: steps.filter((s) => s.ok).length, steps, failedStepIndex: i };
    }

    const processing = await advanceTryOnJob(submitted.job, "PROCESSING", { predictionId: result.predictionId });
    if (!processing.ok) {
      return { ok: false, reason: "job_creation_failed", creditsUsed: steps.filter((s) => s.ok).length, steps };
    }
    await advanceTryOnJob(processing.job, "COMPLETED", {});

    steps.push({ label: garment.label, jobId: job.id, ok: true });
    currentModelImage = result.outputDataUrl;
  }

  return { ok: true, creditsUsed: steps.length, steps, finalImageDataUrl: currentModelImage };
}
