// app/lib/ai/full-look-tryon-real.server.ts
//
// REAL Full-Look VTO — async, submit-then-poll chain across 3 garments.
//
// NOT REGISTERED anywhere yet; invoked only by staging.full-look-vto-real.tsx
// (itself unregistered — see that file's own header). No code in this module
// runs against a live customer photo or a real FASHN credential unless that
// route is both registered AND reached by an explicitly authorised staging
// test account.
//
// WHY THIS EXISTS, NOT A REUSE OF poc-job-tracked-full-look-chain.server.ts:
// that module (and the runFashnTryOn it calls) submits-AND-polls-to-completion
// INSIDE one request, up to 90s per step — safe only because every test of it
// uses a mock fetch that resolves instantly. A real 3-step chain that way is
// up to ~270s of held-open synchronous request time, which the single-garment
// production path (fashn-tryon-service.server.ts's submitTryOnJob) was
// deliberately built to avoid at even ONE step's 90s ceiling ("exceeding
// Vercel's 60s timeout" — that file's own comment). This module extends THAT
// proven pattern instead: every exported function here does at most one
// FASHN HTTP call (one submit POST, or one status GET) per invocation. There
// is no poll loop anywhere in this file. A multi-minute chain is completed
// across many short, cheap requests — driven by a client polling loop, same
// as api.tryon-status.$jobId.tsx already does for one garment — never by one
// long-held request.
//
// JOB TRACKING: no new Prisma model. Each of the 3 garment steps gets its own
// ordinary VirtualTryOnJob row, created via the existing createOrFindTryOnJob/
// advanceTryOnJob state machine (my-naia-model.server.ts, unmodified) — the
// exact mechanism poc-job-tracked-full-look-chain.server.ts already proved
// out for job bookkeeping (just not for the provider call itself, which here
// is submit-then-poll, not submit-and-poll-to-completion). The chain's
// current position is never stored as a separate field: step 0's job id is
// deterministic per customer (REAL_RESERVATION_KEY_PREFIX + customerId);
// step 1 and step 2's idempotency keys are each deterministically derived
// from the PRIOR step's own (already-created, globally unique) job id. So
// "where is this chain right now" is always reconstructible by walking
// step 0 → step 1 → step 2 via these deterministic keys and stopping at the
// first job that isn't COMPLETED yet — no new schema, and a browser refresh
// just re-derives the same walk from the same keys.
//
// KEYS ARE A SEPARATE NAMESPACE FROM THE MOCK CHAIN: REAL_RESERVATION_KEY_PREFIX
// ("fulllook-real-reservation:") and the real productHandle prefix
// ("fulllook-real:") are deliberately distinct from the mock POC's
// "fulllook-poc-reservation:" / "fulllook-poc:" — a real job can never
// collide with, resume, or be confused with a mock job, and entitlement.server.ts's
// MOCK_VTO_PRODUCT_HANDLE_PREFIX exclusion (scoped to "fulllook-poc:") does
// NOT apply to these rows, so they are NOT excluded from real VTO usage
// counting — see the large comment on BILLING below.
//
// INTERMEDIATE IMAGE PERSISTENCE: step N's output (for N < 2, i.e. not the
// final step) must survive until a LATER, separate request submits step N+1
// — it cannot be kept in memory. Reuses the exact same private-Cloudinary
// primitives fashn-tryon-service.server.ts already uses for the FINAL result
// (uploadCloudinaryPrivate / buildPrivateDownloadUrl, both unmodified), under
// a distinct, clearly-named public-id namespace
// ("naia-tryon-fulllook-intermediate/{customerId}/{jobId}") so an
// intermediate step's image is never confused with, or retained alongside,
// the one real deliverable (the final result, uploaded via the existing,
// unmodified uploadTryOnResult/deriveTryOnResultPublicId — approved for this
// reuse explicitly). Intermediate images are a private implementation
// detail of the chain, never a customer-facing preview, and never reachable
// via buildTryOnResultUrl (which only ever derives the FINAL result's public
// id). RETENTION (2026-11-03): advanceFullLookChain deletes every prior
// step's intermediate asset the moment the chain reaches a terminal state
// (COMPLETED or FAILED) — by then each one has already served its one
// purpose (feeding the next step) or never will. Best-effort: a delete
// failure is swallowed, not retried or surfaced, since by that point the
// chain's own outcome is already decided and an orphaned intermediate asset
// is a storage-hygiene issue, not a correctness or privacy-blocking one (it
// is still private, ownership-scoped by its customerId-prefixed path, and
// not linked from anywhere a customer could reach). Still a real-rollout
// gap this does NOT close: there is no scheduled/background sweep for a
// chain that is abandoned mid-flight (e.g. the customer never returns to
// poll again) — that case is outside this authorised test's scope.
//
// BILLING / VTO ALLOWANCE (verified, not decided here): this module makes NO
// new decision about how 3 real FASHN calls should count against a
// customer's VTO allowance. It reuses exactly the policy
// staging.full-look-vto-test.tsx already adopted and documented for its own
// quota PRE-CHECK (hasQuotaRoomForFullLookChain, exported from that file,
// reused unmodified here): a 3-garment Full-Look costs MAX_CHAIN_LENGTH (3)
// VTO units, checked via getMembershipAllowances(status).vtoPerMonth and
// getEntitlementSummary — deliberately isolated from the pre-existing,
// unresolved VTO_MONTHLY_LIMIT_OVERRIDE scoping bug, and unconditional
// regardless of ENTITLEMENT_ENFORCEMENT. That file's own comment already
// flags this as "PROVISIONAL POLICY, not a final pricing decision" — still
// true here. What is NEW in this module is that, unlike the mock chain, a
// real completed chain's 3 VirtualTryOnJob rows (productHandle prefix
// "fulllook-real:", not "fulllook-poc:") are NOT excluded by
// entitlement.server.ts's MOCK_VTO_PRODUCT_HANDLE_PREFIX filter — so they
// fall into the EXISTING, unmodified vtoCompleted/vtoInFlight counting
// queries automatically, with no new entitlement code required. The net,
// de facto effect: one real 3-garment Full-Look consumes 3 of the
// customer's monthly VTO units once all 3 steps complete. Whether a
// completed Full-Look SHOULD instead cost 1 unit (one "outfit" try-on) is an
// open product decision this module does not make or assume — flagged
// separately for explicit confirmation before any customer-facing rollout.
//
// NO AUTO-RETRY: a step whose FASHN call has already succeeded is never
// resubmitted by this module under any code path — advancing to the next
// step always uses that step's OWN already-completed output, never a fresh
// call. A step that FASHN reports as failed is marked FAILED and never
// retried automatically; a status check that itself errors (network/parse)
// leaves the job exactly as it was (still PROCESSING) so a later poll simply
// re-checks status — never re-submits — which is free, not billable.

import {
  checkCustomerCooldown,
  createOrFindTryOnJob,
  advanceTryOnJob,
} from "./my-naia-model.server.js";
import {
  submitTryOnToProvider,
  isValidModelImageDataUrl,
} from "./fashn-try-on.server.js";
import {
  downloadModelPhotoAsDataUrl,
  uploadTryOnResult,
  buildTryOnResultUrl,
} from "./fashn-tryon-service.server.js";
import {
  uploadCloudinaryPrivate,
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
  deleteCloudinaryAsset,
  type CloudinaryConfig,
  type DeleteAssetFn,
} from "../cloudinary-admin.server.js";
import { MAX_CHAIN_LENGTH } from "./poc-sequential-full-look-vto.server.js";
import type { VirtualTryOnConsent, VirtualTryOnJobRecord } from "./virtual-try-on.types.js";
import prisma from "../../db.server.js";

// Real DB implementation — the default for every caller except tests, which
// inject a mock via WalkChainDeps._findJobFn instead.
async function defaultFindJobByIdempotencyKey(
  where: { idempotencyKey: string },
): Promise<VirtualTryOnJobRecord | null> {
  return prisma.virtualTryOnJob.findUnique({
    where: { idempotencyKey: where.idempotencyKey },
  }) as Promise<VirtualTryOnJobRecord | null>;
}

// ── Key namespaces — distinct from the mock chain's "fulllook-poc*" keys ────

const REAL_RESERVATION_KEY_PREFIX = "fulllook-real-reservation:";
const REAL_STEP_KEY_PREFIX = "fulllook-real-step:";
export const REAL_PRODUCT_HANDLE_PREFIX = "fulllook-real";

export function getFullLookStepIdempotencyKey(
  customerId: string,
  stepIndex: number,
  priorJobId: string | null,
): string {
  if (stepIndex === 0) return `${REAL_RESERVATION_KEY_PREFIX}${customerId}`;
  return `${REAL_STEP_KEY_PREFIX}${priorJobId}:${stepIndex}`;
}

// ── Model-photo format pre-flight ────────────────────────────────────────────
//
// My nAia Model accepts heic/heif at upload time (my-naia-model.server.ts's
// ALLOWED_FORMATS), but downloadModelPhotoAsDataUrl's formatToMimeSubtype
// maps anything that isn't jpg/jpeg/webp to a "png" MIME label — silently
// mislabeling real HEIC/HEIF bytes as image/png rather than transcoding them.
// This has never been exercised against a real HEIC photo in this codebase.
// Rather than let a real, billable FASHN submission be the first place that
// surfaces, this chain refuses up front with a clear, distinct reason.
const COMPATIBLE_BODY_FORMATS = new Set(["jpg", "jpeg", "png", "webp"]);

export function isCompatibleModelPhotoFormat(bodyFormat: string | null): boolean {
  const f = (bodyFormat ?? "jpg").toLowerCase();
  return COMPATIBLE_BODY_FORMATS.has(f);
}

// ── Intermediate (non-final) step image persistence ─────────────────────────
//
// Distinct Cloudinary namespace from deriveTryOnResultPublicId's
// "naia-tryon/{customerId}/{jobId}" — this is a private implementation
// detail of the chain (the input to the NEXT step), never a customer-facing
// preview and never exposed through buildTryOnResultUrl.

export function deriveIntermediateStepPublicId(customerId: string, jobId: string): string {
  return `naia-tryon-fulllook-intermediate/${customerId}/${jobId}`;
}

export async function uploadIntermediateStepResult(
  customerId: string,
  jobId: string,
  outputDataUrl: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  const publicId = deriveIntermediateStepPublicId(customerId, jobId);
  const result = await uploadCloudinaryPrivate(publicId, outputDataUrl, "private", _fetch, _getConfig);
  if (!result.ok) return { ok: false, errorCode: result.errorCode };
  return { ok: true };
}

export async function downloadIntermediateStepResult(
  customerId: string,
  jobId: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true; dataUrl: string } | { ok: false; errorCode: string }> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };
  const publicId = deriveIntermediateStepPublicId(customerId, jobId);
  // Uploaded above via output_format:"png" (FASHN's own fixed output format).
  const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, "png", "private");
  try {
    const res = await _fetch(downloadUrl);
    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    if (!isValidModelImageDataUrl(dataUrl)) return { ok: false, errorCode: "INVALID_MODEL_IMAGE" };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── FASHN status check — single call, no poll loop ──────────────────────────
// Mirrors api.tryon-status.$jobId.tsx's own inline fetch exactly (same URL,
// same header, same response shape) — factored out once here because this
// chain needs it at up to 3 distinct steps instead of 1.

const FASHN_BASE = "https://api.fashn.ai";

export type FashnStatus = "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";

export interface FashnStatusBody {
  status: FashnStatus;
  output?: string[];
  error?: string;
}

export type CheckStatusResult =
  | { ok: true; body: FashnStatusBody }
  | { ok: false }; // network/parse error — caller must NOT treat this as failure or success

export async function checkFashnPredictionStatus(
  predictionId: string,
  _fetch: typeof fetch = fetch,
  _getApiKey: () => string | undefined = () => process.env.FASHN_API_KEY,
): Promise<CheckStatusResult> {
  const apiKey = _getApiKey();
  if (!apiKey) return { ok: false };
  try {
    const res = await _fetch(`${FASHN_BASE}/v1/status/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as FashnStatusBody;
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

// ── Chain garment shape ───────────────────────────────────────────────────────

export interface FullLookRealGarmentInput {
  label: string;
  productImageUrl: string;
}

export interface FullLookChainContext {
  customerId: string;
  naiaModelId: string | null;
  bodyPublicId: string | null;
  bodyFormat: string | null;
  deliveryType: string;
  garments: readonly FullLookRealGarmentInput[]; // exactly MAX_CHAIN_LENGTH, ordered
  consent: VirtualTryOnConsent;
  // Applied ONLY to the final (outerwear) step's FASHN request — see
  // submitFullLookRealStep's own stepIndex check. Omitted entirely for
  // steps 0 and 1, which always keep the prior "fast", no-prompt behavior
  // unchanged. Both optional; omitting either here falls back to
  // submitTryOnToProvider's own defaults (generation_mode "fast", no prompt).
  finalStepPrompt?: string;
  finalStepGenerationMode?: "fast" | "balanced" | "quality";
}

// ── Walk the chain via deterministic keys — no new schema ───────────────────
//
// Returns the jobs found so far, in step order, stopping at the first step
// that has no job yet. A customer with no chain started returns [].

async function findJobByIdempotencyKey(
  key: string,
  _findJobFn: (where: { idempotencyKey: string }) => Promise<VirtualTryOnJobRecord | null>,
): Promise<VirtualTryOnJobRecord | null> {
  return _findJobFn({ idempotencyKey: key });
}

export interface WalkChainDeps {
  _findJobFn: (where: { idempotencyKey: string }) => Promise<VirtualTryOnJobRecord | null>;
}

export async function walkFullLookChainJobs(
  customerId: string,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
): Promise<VirtualTryOnJobRecord[]> {
  const jobs: VirtualTryOnJobRecord[] = [];
  let priorJobId: string | null = null;
  for (let i = 0; i < MAX_CHAIN_LENGTH; i++) {
    const key = getFullLookStepIdempotencyKey(customerId, i, priorJobId);
    const job = await findJobByIdempotencyKey(key, deps._findJobFn);
    if (!job) break;
    jobs.push(job);
    if (job.status !== "COMPLETED") break; // chain is parked here until this step resolves
    priorJobId = job.id;
  }
  return jobs;
}

// ── Submit one step (create-or-find job, download input image, submit) ──────

export type SubmitStepResult =
  | { ok: true; job: VirtualTryOnJobRecord; alreadySubmitted: boolean }
  | { ok: false; reason: string; job?: VirtualTryOnJobRecord };

async function markFailedBestEffort(job: VirtualTryOnJobRecord, errorCode: string): Promise<void> {
  try {
    await advanceTryOnJob(job, "FAILED", { errorCode });
  } catch {
    // Best-effort only — see poc-job-tracked-full-look-chain.server.ts's
    // identical convention and rationale.
  }
}

export async function submitFullLookRealStep(
  ctx: FullLookChainContext,
  stepIndex: number,
  priorJobId: string | null,
): Promise<SubmitStepResult> {
  const garment = ctx.garments[stepIndex];
  const idempotencyKey = getFullLookStepIdempotencyKey(ctx.customerId, stepIndex, priorJobId);

  const jobResult = await createOrFindTryOnJob({
    customerId: ctx.customerId,
    naiaModelId: ctx.naiaModelId,
    productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step${stepIndex + 1}:${garment.label}`,
    bodyPublicId: ctx.bodyPublicId,
    virtualTryOnConsentAt: new Date(ctx.consent.consentedAt),
    idempotencyKey,
  });

  if (!jobResult.ok) {
    return { ok: false, reason: jobResult.code };
  }

  // Idempotent resume: a job already exists for this exact step (duplicate
  // request, or a refresh after step 0 was already submitted) — never
  // submit a second FASHN call for it. The caller polls its current state.
  if (!jobResult.created) {
    return { ok: true, job: jobResult.job, alreadySubmitted: true };
  }

  const job = jobResult.job;

  const submitted = await advanceTryOnJob(job, "SUBMITTED", {});
  if (!submitted.ok) {
    await markFailedBestEffort(job, "state_error_before_submission");
    return { ok: false, reason: "STATE_ERROR", job };
  }

  // ── Resolve this step's input model image — zero FASHN calls yet ──────────
  const inputImage =
    stepIndex === 0
      ? await downloadModelPhotoAsDataUrl(ctx.bodyPublicId as string, ctx.bodyFormat, ctx.deliveryType)
      : await downloadIntermediateStepResult(ctx.customerId, priorJobId as string);

  if (!inputImage.ok) {
    await markFailedBestEffort(submitted.job, inputImage.errorCode);
    return { ok: false, reason: inputImage.errorCode, job: submitted.job };
  }

  // ── Final-step-only tuning — see FullLookChainContext's own doc comment.
  // Steps 0 and 1 never reach this branch; their request is byte-identical
  // to before (no prompt, generation_mode "fast" via submitTryOnToProvider's
  // own default). ─────────────────────────────────────────────────────────
  const isFinalStep = stepIndex === MAX_CHAIN_LENGTH - 1;

  // ── Submit only — no poll. Returns immediately with a predictionId. ──────
  const fashnResult = await submitTryOnToProvider({
    customerId: ctx.customerId,
    modelImageDataUrl: inputImage.dataUrl,
    productImageUrl: garment.productImageUrl,
    productHandle: job.productHandle,
    consent: ctx.consent,
    ...(isFinalStep
      ? { prompt: ctx.finalStepPrompt, generationMode: ctx.finalStepGenerationMode }
      : {}),
  });

  if (!fashnResult.ok) {
    await markFailedBestEffort(submitted.job, fashnResult.code);
    return { ok: false, reason: fashnResult.code, job: submitted.job };
  }

  const processing = await advanceTryOnJob(submitted.job, "PROCESSING", {
    predictionId: fashnResult.predictionId,
  });
  if (!processing.ok) {
    // FASHN call already succeeded (and is potentially already billed) —
    // never resubmitted. Bookkeeping failure only; the step itself ran.
    return { ok: false, reason: "STATE_ERROR_AFTER_PROVIDER_SUCCESS", job: submitted.job };
  }

  return { ok: true, job: processing.job, alreadySubmitted: false };
}

// ── Poll one step — single status check, no loop ─────────────────────────────

export type PollStepResult =
  | { status: "PROCESSING" }
  | { status: "STEP_COMPLETE"; job: VirtualTryOnJobRecord } // intermediate step done; caller submits next
  | { status: "COMPLETED"; job: VirtualTryOnJobRecord; resultUrl: string } // final step done
  | { status: "FAILED"; job: VirtualTryOnJobRecord };

export async function pollFullLookRealStep(
  ctx: FullLookChainContext,
  job: VirtualTryOnJobRecord,
  stepIndex: number,
): Promise<PollStepResult> {
  if (job.status === "COMPLETED") {
    if (stepIndex === MAX_CHAIN_LENGTH - 1) {
      const resultUrl = buildTryOnResultUrl(ctx.customerId, job.id);
      if (!resultUrl) return { status: "FAILED", job };
      return { status: "COMPLETED", job, resultUrl };
    }
    return { status: "STEP_COMPLETE", job };
  }
  if (job.status === "FAILED" || job.status === "CANCELED" || job.status === "TIMED_OUT") {
    return { status: "FAILED", job };
  }

  const predictionId = job.predictionId;
  if (!predictionId) return { status: "PROCESSING" }; // SUBMITTED but not yet persisted

  const check = await checkFashnPredictionStatus(predictionId);
  if (!check.ok) {
    // Network/parse error on the STATUS CHECK — free, not billable. Leave the
    // job exactly as it is; a later poll simply checks again. Never resubmit.
    return { status: "PROCESSING" };
  }

  const fashnStatus = check.body.status;

  if (fashnStatus === "completed") {
    const outputs = check.body.output;
    if (!Array.isArray(outputs) || outputs.length === 0 || typeof outputs[0] !== "string") {
      await markFailedBestEffort(job, "PROVIDER_FAILED");
      return { status: "FAILED", job };
    }
    const outputDataUrl = outputs[0];

    const isFinal = stepIndex === MAX_CHAIN_LENGTH - 1;
    const upload = isFinal
      ? await uploadTryOnResult(ctx.customerId, job.id, outputDataUrl)
      : await uploadIntermediateStepResult(ctx.customerId, job.id, outputDataUrl);

    if (!upload.ok) {
      await markFailedBestEffort(job, "UPLOAD_FAILED");
      return { status: "FAILED", job };
    }

    const completed = await advanceTryOnJob(job, "COMPLETED", { predictionId });
    if (!completed.ok) {
      // FASHN succeeded and the result is already safely uploaded; only our
      // own status transition failed to persist. Report FAILED rather than
      // silently retrying — a human can inspect the uploaded asset directly.
      return { status: "FAILED", job };
    }

    if (isFinal) {
      const resultUrl = buildTryOnResultUrl(ctx.customerId, completed.job.id);
      if (!resultUrl) return { status: "FAILED", job: completed.job };
      return { status: "COMPLETED", job: completed.job, resultUrl };
    }
    return { status: "STEP_COMPLETE", job: completed.job };
  }

  if (fashnStatus === "failed" || fashnStatus === "canceled") {
    await markFailedBestEffort(job, "PROVIDER_FAILED");
    return { status: "FAILED", job };
  }

  // starting | in_queue | processing
  return { status: "PROCESSING" };
}

// ── Top-level: advance the chain by exactly one unit of work ────────────────
//
// Used by both the submit action (to kick off / resume step 0) and the
// status loader (to poll the current step and, if it just completed and
// isn't final, immediately submit the next one in the SAME request — one
// extra cheap POST, never a poll loop).

export type ChainAdvanceResult =
  | { status: "NOT_STARTED" }
  | { status: "PROCESSING"; stepIndex: number }
  | { status: "COMPLETED"; resultUrl: string }
  | { status: "FAILED"; failedStepIndex: number; errorCode: string | null }
  | { status: "SUBMIT_ERROR"; reason: string };

// ── Intermediate-image retention — best-effort cleanup at chain's end ───────
//
// Called exactly once per chain: the moment a poll call OBSERVES the fresh
// PROCESSING → COMPLETED/FAILED transition (see the two call sites below).
// A later poll against an already-terminal chain takes the fast path at the
// top of advanceFullLookChain and never reaches here again, so this never
// re-fires on every subsequent poll. jobIds is every step BEFORE the
// terminal one — the only steps that could ever have an intermediate asset
// (the terminal step's own output either became the real result, via
// uploadTryOnResult, or was never produced at all).
async function cleanupIntermediateStepResults(
  customerId: string,
  jobIds: readonly string[],
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<void> {
  for (const jobId of jobIds) {
    try {
      await _deleteAsset(deriveIntermediateStepPublicId(customerId, jobId), "private");
    } catch {
      // Best-effort only — see this module's own RETENTION comment above.
    }
  }
}

export async function advanceFullLookChain(
  ctx: FullLookChainContext,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
): Promise<ChainAdvanceResult> {
  const jobs = await walkFullLookChainJobs(ctx.customerId, deps);

  if (jobs.length === 0) {
    return { status: "NOT_STARTED" };
  }

  const lastJob = jobs[jobs.length - 1];
  const lastStepIndex = jobs.length - 1;

  if (lastJob.status === "FAILED" || lastJob.status === "CANCELED" || lastJob.status === "TIMED_OUT") {
    return { status: "FAILED", failedStepIndex: lastStepIndex, errorCode: lastJob.errorCode };
  }

  if (lastJob.status === "COMPLETED" && lastStepIndex === MAX_CHAIN_LENGTH - 1) {
    const resultUrl = buildTryOnResultUrl(ctx.customerId, lastJob.id);
    if (!resultUrl) return { status: "SUBMIT_ERROR", reason: "NOT_CONFIGURED" };
    return { status: "COMPLETED", resultUrl };
  }

  const poll = await pollFullLookRealStep(ctx, lastJob, lastStepIndex);

  if (poll.status === "FAILED") {
    await cleanupIntermediateStepResults(ctx.customerId, jobs.slice(0, -1).map((j) => j.id));
    return { status: "FAILED", failedStepIndex: lastStepIndex, errorCode: poll.job.errorCode };
  }
  if (poll.status === "COMPLETED") {
    await cleanupIntermediateStepResults(ctx.customerId, jobs.slice(0, -1).map((j) => j.id));
    return { status: "COMPLETED", resultUrl: poll.resultUrl };
  }
  if (poll.status === "PROCESSING") {
    return { status: "PROCESSING", stepIndex: lastStepIndex };
  }

  // STEP_COMPLETE — this step is done but isn't final; submit the next one
  // now, within this same request (one more cheap POST, no poll loop).
  const nextIndex = lastStepIndex + 1;
  const submit = await submitFullLookRealStep(ctx, nextIndex, poll.job.id);
  if (!submit.ok) {
    return { status: "SUBMIT_ERROR", reason: submit.reason };
  }
  return { status: "PROCESSING", stepIndex: nextIndex };
}

// ── Start the chain — called once by the submit action ──────────────────────
//
// Cooldown is checked exactly once, only when nothing has been submitted yet
// — same placement and rationale as poc-job-tracked-full-look-chain.server.ts
// ("Issue 1"): checking it again before a later step would self-block the
// chain on its own just-completed prior step.

export type StartChainResult =
  | { ok: true; stepIndex: number }
  | { ok: false; reason: string };

export async function startOrResumeFullLookChain(
  ctx: FullLookChainContext,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
): Promise<StartChainResult> {
  if (ctx.garments.length !== MAX_CHAIN_LENGTH) {
    return { ok: false, reason: "invalid_chain_length" };
  }

  const jobs = await walkFullLookChainJobs(ctx.customerId, deps);

  if (jobs.length > 0) {
    // Chain already started (by this request or an earlier one) — resume,
    // never re-submit step 0. The status loader drives actual progress.
    return { ok: true, stepIndex: jobs.length - 1 };
  }

  const cooldown = await checkCustomerCooldown(ctx.customerId);
  if (!cooldown.ok) {
    return { ok: false, reason: cooldown.reason };
  }

  const submit = await submitFullLookRealStep(ctx, 0, null);
  if (!submit.ok) {
    return { ok: false, reason: submit.reason };
  }
  return { ok: true, stepIndex: 0 };
}
