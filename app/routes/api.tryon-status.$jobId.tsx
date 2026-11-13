// app/routes/api.tryon-status.$jobId.tsx
// M2 — VTO job status polling (session-authenticated).
//
// GET /api/tryon-status/:jobId
//
// Called every 3s by the client's useTryOn hook until terminal state.
// Makes a single FASHN status check per invocation — the client owns polling frequency.
// When FASHN returns completed, this route uploads the result and advances the job.
//
// Security contract:
//   - Session cookie auth only (getCurrentNaiaCustomer) — never Shopify proxy.
//   - Job ownership enforced before any status or result is returned.
//   - FASHN_API_KEY stays server-side only.
//   - Result URLs are short-lived signed Cloudinary URLs; Cache-Control: no-store.
//   - Only COMPLETED jobs return a resultUrl.
//   - No measurement, body shape, or fit information is inferred or returned.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  uploadTryOnResult,
  buildTryOnResultUrl,
  checkResultOwnership,
  isSourcePhotoStillValid,
  completeTryOnJobIfSourceStillValid,
  customerHasOutstandingVtoSweepObligation,
  deriveTryOnResultPublicId,
} from "~/lib/ai/fashn-tryon-service.server";
import { advanceTryOnJob } from "~/lib/ai/my-naia-model.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import prisma from "~/db.server";
import type { VirtualTryOnJobRecord } from "~/lib/ai/virtual-try-on.types";

const FASHN_BASE = "https://api.fashn.ai";

type FashnStatus = "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";

interface FashnStatusBody {
  status: FashnStatus;
  output?: string[];
  error?: string;
}

// A concurrent account erasure (customer-privacy.server.ts) hard-deletes
// VirtualTryOnJob rows outright, not just the source photo. If erasure's
// delete lands between this request's own read of `job` and this specific
// write, advanceTryOnJob's underlying prisma.virtualTryOnJob.update throws
// Prisma's "record to update not found" (P2025) — expected and benign here
// (the job's owning customer is gone; there's nothing left to protect or
// expose), so it's tolerated ONLY in this one identified context. Any other
// error code or exception is rethrown unchanged — this must never become a
// blanket swallow of unrelated database errors.
function isRecordNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2025";
}

async function markFailedTolerantOfErasureRace(
  job: VirtualTryOnJobRecord,
  errorCode: string,
): Promise<void> {
  try {
    await advanceTryOnJob(job, "FAILED", { errorCode });
  } catch (err) {
    if (!isRecordNotFoundError(err)) throw err;
    console.info("naia:job-vanished-during-source-deleted-cleanup", {
      jobId: job.id,
      errorCode,
    });
  }
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  // 1. Auth — session cookie only
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return data({ status: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { jobId } = params;
  if (!jobId) {
    return data({ status: "NOT_FOUND" }, { status: 404 });
  }

  // 2. Load job — full record so advanceTryOnJob has all fields it needs
  const job = await prisma.virtualTryOnJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return data({ status: "NOT_FOUND" }, { status: 404 });
  }

  // 3. Ownership — internal DB IDs only; never accept ownership from the client
  if (!checkResultOwnership(job.customerId, customer.id)) {
    return data({ status: "FORBIDDEN" }, { status: 403 });
  }

  // 4. Terminal: already completed — build fresh signed URL (10-min expiry)
  if (job.status === "COMPLETED") {
    // Fail closed while a body-photo-deletion cleanup obligation is
    // outstanding for this customer — the underlying Cloudinary asset may
    // not have been swept yet. Never serve a signed URL in that window.
    if (await customerHasOutstandingVtoSweepObligation(job.customerId)) {
      return data({ status: "FAILED" }, { headers: { "Cache-Control": "no-store" } });
    }
    const resultUrl = buildTryOnResultUrl(customer.id, job.id);
    if (!resultUrl) return data({ status: "FAILED" });
    return data(
      { status: "COMPLETED", resultUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 5. Terminal: failure states
  if (
    job.status === "FAILED" ||
    job.status === "CANCELED" ||
    job.status === "TIMED_OUT"
  ) {
    return data({ status: "FAILED" });
  }

  // 6. In-progress (CREATED / SUBMITTED / PROCESSING) — check FASHN once
  const predictionId = job.predictionId;
  if (!predictionId) {
    // Job submitted but predictionId not yet persisted — keep polling
    return data({ status: "PROCESSING" });
  }

  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) {
    return data({ status: "PROCESSING" });
  }

  let fashnBody: FashnStatusBody;
  try {
    const res = await fetch(`${FASHN_BASE}/v1/status/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return data({ status: "PROCESSING" });
    fashnBody = (await res.json()) as FashnStatusBody;
  } catch {
    return data({ status: "PROCESSING" });
  }

  // 7a. FASHN completed — upload result and advance job
  if (fashnBody.status === "completed") {
    const outputs = fashnBody.output;
    if (!Array.isArray(outputs) || outputs.length === 0) {
      await advanceTryOnJob(job as unknown as VirtualTryOnJobRecord, "FAILED", {
        errorCode: "PROVIDER_FAILED",
      });
      return data({ status: "FAILED" });
    }

    // Deletion-during-processing guard — the source body photo may have
    // been deleted (Settings, or account erasure) while this job sat at
    // FASHN. Re-check BEFORE persisting anything: if the source is gone,
    // never upload or expose the result at all.
    if (!(await isSourcePhotoStillValid(job.naiaModelId, job.customerId, job.productHandle, job.requestFingerprint))) {
      await markFailedTolerantOfErasureRace(job as unknown as VirtualTryOnJobRecord, "SOURCE_DELETED");
      return data({ status: "FAILED" });
    }

    // outputDataUrl is a base64 data URL — never logged
    const outputDataUrl = outputs[0];
    const uploadResult = await uploadTryOnResult(customer.id, job.id, outputDataUrl);
    if (!uploadResult.ok) {
      await advanceTryOnJob(job as unknown as VirtualTryOnJobRecord, "FAILED", {
        errorCode: "UPLOAD_FAILED",
      });
      return data({ status: "FAILED" });
    }

    // Locked completion — closes the read-then-write race the two-call
    // pattern above still left open: re-validates the source photo AND
    // persists COMPLETED inside one transaction, holding a real Postgres
    // row lock on the NaiaModel row for the duration, so a concurrent photo
    // deletion can never land in between the check and the write. See
    // completeTryOnJobIfSourceStillValid's own header comment for why plain
    // row locking (not Serializable) is the correct mechanism here, and why
    // nothing needs to change on the deletion side.
    const completion = await completeTryOnJobIfSourceStillValid(
      job as unknown as VirtualTryOnJobRecord,
      job.naiaModelId,
      job.productHandle,
      job.requestFingerprint,
      predictionId,
    );

    if (!completion.ok) {
      // The asset just uploaded is an orphan: delete it, and if that
      // deletion itself fails, durably record it for retry rather than
      // silently losing track of it — same pattern already used for
      // account-erasure Cloudinary failures.
      const orphanPublicId = deriveTryOnResultPublicId(customer.id, job.id);
      const cleanup = await deleteCloudinaryAsset(orphanPublicId, "private");
      if (!cleanup.ok) {
        await prisma.pendingCloudinaryDeletion.upsert({
          where: { publicId: orphanPublicId },
          create: {
            customerId: customer.id,
            publicId: orphanPublicId,
            resourceType: "image",
            deliveryType: "private",
            context: "vto-race-condition-cleanup",
            attemptCount: 1,
            lastAttemptAt: new Date(),
            lastError: cleanup.errorCode ?? "deletion failed after source photo was deleted mid-job",
          },
          update: {
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
            lastError: cleanup.errorCode ?? "deletion failed after source photo was deleted mid-job (repeat)",
          },
        });
      }
      await markFailedTolerantOfErasureRace(job as unknown as VirtualTryOnJobRecord, "SOURCE_DELETED");
      return data({ status: "FAILED" });
    }

    // Build fresh result URL — never cached. The job row was already marked
    // COMPLETED inside completeTryOnJobIfSourceStillValid's own transaction.
    const resultUrl = buildTryOnResultUrl(customer.id, job.id);
    if (!resultUrl) return data({ status: "FAILED" });

    return data(
      { status: "COMPLETED", resultUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 7b. FASHN failure
  if (fashnBody.status === "failed" || fashnBody.status === "canceled") {
    await advanceTryOnJob(job as unknown as VirtualTryOnJobRecord, "FAILED", {
      errorCode: "PROVIDER_FAILED",
    });
    return data({ status: "FAILED" });
  }

  // 7c. Still in progress (starting | in_queue | processing)
  return data({ status: "PROCESSING" });
}
