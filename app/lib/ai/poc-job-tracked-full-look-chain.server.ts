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
// ── Issue 3 — execution timeout (still NOT resolved by code; documented) ───
// A full 3-step chain, each step polling runFashnTryOn's existing ~90s
// ceiling, is up to ~270s of synchronous wall-clock time in the worst case.
// No maxDuration/functions config exists anywhere in this repo today (and
// the pre-existing api.staging-full-look-vto.tsx prototype has the
// identical, already-flagged, never-resolved risk at a smaller ~90s scale).
// This module does not change that: it still runs all 3 steps synchronously
// within one call. It is safe here ONLY because every test below uses a
// mock fetch that resolves instantly — there is no real wall-clock risk
// until FASHN is real.
//
// Confirmed read-only (2026-11-02, via `vercel teams ls`): the team owning
// naia-stylist-staging is on Vercel's Hobby plan. Per Vercel's current
// documentation, Hobby's default AND maximum function duration under Fluid
// Compute (stated enabled by default) is 300s — which covers the ~270s
// worst case, by a 30-second margin, PROVIDED Fluid Compute is actually
// active for this specific project. That one fact could not be confirmed
// via any read-only CLI command (`vercel project inspect` does not surface
// it) — it needs a one-click Vercel Dashboard → Settings → Functions check,
// not a configuration change. If a platform timeout kill does occur
// mid-step, it is an abrupt termination, not a normal return — this
// module's own cleanup code (see markFailedBestEffort and the i === 0
// staleness check below) is what recovers from that, not anything that
// runs during the kill itself.
//
// Decision still required before the real run: either that one Dashboard
// confirmation, or restructuring onto the existing async submit-then-poll
// pattern (submitTryOnToProvider + the separate poll route) across multiple
// requests instead of one. Neither is decided or implemented here.
//
// ── Priority 1/2 corrections (2026-11-02) ───────────────────────────────────
// 1-2. Orphaned-job fix: every advanceTryOnJob failure now triggers a
//      best-effort FAILED-marking cleanup (markFailedBestEffort) so the
//      active-job lock is never left held by a job this function has
//      already given up on. That cleanup itself never throws — a second
//      database write is not guaranteed to succeed any more than the first.
// 3. Minimal safe stale-job signal: when the one-time reservation (i === 0)
//    is already claimed, the reason now distinguishes a job that has been
//    active for longer than STALE_ACTIVE_JOB_MS (a crashed/orphaned job)
//    from one genuinely resolved — "full_look_test_stale_job_needs_manual_review"
//    vs "full_look_test_already_attempted". This NEVER automatically
//    unblocks the lock or touches FASHN; it only gives whoever reviews it a
//    clearly different, actionable signal instead of an identical generic
//    refusal for both cases.
// 4. After a successful (and potentially already-billed) FASHN call, this
//    function never calls runFashnTryOn again for that same step under any
//    circumstance — a bookkeeping failure after that point reports
//    "step_outcome_uncertain" (distinct from "step_failed", since FASHN did
//    not report failure) rather than silently retrying or mischaracterizing
//    a paid success as a failure.
// 6. creditsUsed is now computed by one function (creditsUsedSoFar) used at
//    every return site, instead of two interchangeable-but-inconsistent
//    expressions.
// 7. garments.length !== MAX_CHAIN_LENGTH now fails closed immediately
//    (invalid_chain_length) instead of silently permitting a different
//    chain length.

import {
  checkCustomerCooldown,
  createOrFindTryOnJob,
  advanceTryOnJob,
} from "./my-naia-model.server.js";
import { runFashnTryOn, type RunTryOnOptions } from "./fashn-try-on.server.js";
import { MAX_CHAIN_LENGTH } from "./poc-sequential-full-look-vto.server.js";
import {
  ACTIVE_STATUSES,
  type VirtualTryOnConsent,
  type VirtualTryOnJobRecord,
} from "./virtual-try-on.types.js";

const RESERVATION_KEY_PREFIX = "fulllook-poc-reservation:";

// Reuses entitlement.server.ts's own VTO in-flight staleness threshold
// (same constant, same reasoning) rather than inventing a new one: a job
// still "active" well past the time any real step could legitimately take
// is a crashed/orphaned job, not one genuinely still in progress.
const STALE_ACTIVE_JOB_MS = 10 * 60 * 1000;

/**
 * Best-effort cleanup: marks a job FAILED so the active-job lock releases.
 * Never throws — a second database write is not guaranteed to succeed any
 * more than the first one was, and the caller already has a real result
 * (success or failure) to return regardless of whether this cleanup lands.
 * If this itself fails, the job stays active until STALE_ACTIVE_JOB_MS
 * makes it recognizable as stale on a later attempt (see i === 0 handling
 * below) — never silently retried, never left permanently unexplained.
 */
async function markFailedBestEffort(job: VirtualTryOnJobRecord, errorCode: string): Promise<void> {
  try {
    await advanceTryOnJob(job, "FAILED", { errorCode });
  } catch {
    // Swallowed deliberately. See doc comment above.
  }
}

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
  // Optional (2026-11-03) — extends the one-time reservation key so a NEW
  // value here claims a FRESH reservation instead of colliding with a prior
  // one. Omitted entirely by default: every existing and future caller that
  // doesn't pass this gets the exact original behavior — one permanent,
  // customer-scoped reservation, ever, full stop — which is the correct and
  // unchanged protection for a real, billable run. This exists only for a
  // mock-only, zero-billing-risk caller (the staging test route) that needs
  // to let the SAME QA account repeat the test across separate submissions
  // without a manual database deletion each time. Passing the per-submission
  // consent timestamp as this value is exactly that: deterministic within
  // one submission (so a genuine retry of the identical request still
  // collides correctly), but different across separate, deliberate attempts.
  reservationScope?: string;
}

export interface JobTrackedChainStepResult {
  label: string;
  jobId: string;
  ok: boolean;
}

export type JobTrackedChainReason =
  | "invalid_chain_length"
  | "duplicate_attempt_blocked"
  | "full_look_test_already_attempted"
  | "full_look_test_stale_job_needs_manual_review"
  | "job_creation_failed"
  | "step_outcome_uncertain"
  | "step_failed";

export type JobTrackedChainReport =
  | { ok: true; creditsUsed: number; steps: JobTrackedChainStepResult[]; finalImageDataUrl: string }
  | {
      ok: false;
      reason: JobTrackedChainReason;
      creditsUsed: number;
      steps: JobTrackedChainStepResult[];
      failedStepIndex?: number;
    };

export async function runJobTrackedFullLookChain(
  args: JobTrackedChainArgs,
  tryOnOptions: RunTryOnOptions = {},
): Promise<JobTrackedChainReport> {
  const { customerId, naiaModelId, bodyPublicId, garments, consent } = args;

  // ── Requirement #7 — this module exists for exactly one shape of request:
  // the three-garment Full-Look chain. A caller passing any other length is
  // a programming error, not a runtime condition to silently accept (e.g.
  // reporting a hollow {ok:true, creditsUsed:0} for an empty array). ───────
  if (garments.length !== MAX_CHAIN_LENGTH) {
    return { ok: false, reason: "invalid_chain_length", creditsUsed: 0, steps: [] };
  }

  // ── Cooldown — once, before step 1 only. See header for why. ─────────────
  const cooldown = await checkCustomerCooldown(customerId);
  if (!cooldown.ok) {
    return { ok: false, reason: "duplicate_attempt_blocked", creditsUsed: 0, steps: [] };
  }

  const steps: JobTrackedChainStepResult[] = [];
  const creditsUsedSoFar = () => steps.filter((s) => s.ok).length; // Requirement #6 — one expression, used everywhere.
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
        ? `${RESERVATION_KEY_PREFIX}${customerId}${args.reservationScope ? `:${args.reservationScope}` : ""}`
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
      return { ok: false, reason: "job_creation_failed", creditsUsed: creditsUsedSoFar(), steps };
    }

    if (!jobResult.created) {
      if (i === 0) {
        // The one-time reservation was already claimed. Requirement #3 — a
        // minimal, SAFE recovery signal: distinguish a legitimately
        // resolved prior attempt from one that has been sitting active far
        // longer than any real step could take (a crashed/orphaned job),
        // without ever assuming it is safe to reuse or resubmit. This never
        // unblocks the lock itself and never touches FASHN — it only gives
        // whoever is operating this test a clearly different, actionable
        // signal, so a genuinely stuck job doesn't read identically to a
        // deliberately completed one.
        const existing = jobResult.job;
        const isStale =
          (ACTIVE_STATUSES as readonly string[]).includes(existing.status) &&
          Date.now() - existing.lastActivityAt.getTime() > STALE_ACTIVE_JOB_MS;
        return {
          ok: false,
          reason: isStale ? "full_look_test_stale_job_needs_manual_review" : "full_look_test_already_attempted",
          creditsUsed: creditsUsedSoFar(),
          steps,
        };
      }
      // Steps 2+: in practice only reachable if some other, genuinely
      // concurrent request claimed a colliding key — treated the same as
      // any other concurrency block.
      return { ok: false, reason: "duplicate_attempt_blocked", creditsUsed: creditsUsedSoFar(), steps };
    }

    const job = jobResult.job;
    priorJobId = job.id;

    // ── Requirements #1/#2 — if this fails, no FASHN call has happened yet
    // for this step (zero billing risk), so best-effort cleanup is purely
    // about releasing the lock, not about an uncertain paid outcome. ───────
    const submitted = await advanceTryOnJob(job, "SUBMITTED", {});
    if (!submitted.ok) {
      await markFailedBestEffort(job, "state_error_before_submission");
      return { ok: false, reason: "job_creation_failed", creditsUsed: creditsUsedSoFar(), steps };
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
      // FASHN itself reported failure — not billed, per FASHN's own policy.
      await markFailedBestEffort(submitted.job, result.code);
      steps.push({ label: garment.label, jobId: job.id, ok: false });
      return { ok: false, reason: "step_failed", creditsUsed: creditsUsedSoFar(), steps, failedStepIndex: i };
    }

    // ── Requirement #4 — the FASHN call above already succeeded (and is
    // potentially already billed). From here on, NOTHING in this function
    // ever calls runFashnTryOn again for this same step, no matter what
    // happens next — only our own bookkeeping may fail, never the paid
    // operation being silently repeated. If the bookkeeping can't confirm
    // completion, the honest answer is "uncertain," not "failed" (FASHN did
    // not fail) and not "succeeded" (we can't confirm the record) — the
    // image this step produced is still used to advance the chain in
    // memory (currentModelImage below), because the generation itself
    // genuinely happened; what's uncertain is only whether this job's row
    // correctly reflects that. ────────────────────────────────────────────
    const processing = await advanceTryOnJob(submitted.job, "PROCESSING", { predictionId: result.predictionId });
    if (!processing.ok) {
      await markFailedBestEffort(submitted.job, "state_error_after_provider_success");
      steps.push({ label: garment.label, jobId: job.id, ok: true });
      return { ok: false, reason: "step_outcome_uncertain", creditsUsed: creditsUsedSoFar(), steps, failedStepIndex: i };
    }

    const completed = await advanceTryOnJob(processing.job, "COMPLETED", {});
    if (!completed.ok) {
      await markFailedBestEffort(processing.job, "state_error_after_provider_success");
      steps.push({ label: garment.label, jobId: job.id, ok: true });
      return { ok: false, reason: "step_outcome_uncertain", creditsUsed: creditsUsedSoFar(), steps, failedStepIndex: i };
    }

    steps.push({ label: garment.label, jobId: job.id, ok: true });
    currentModelImage = result.outputDataUrl;
  }

  return { ok: true, creditsUsed: creditsUsedSoFar(), steps, finalImageDataUrl: currentModelImage };
}
