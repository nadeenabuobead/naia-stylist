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
} from "~/lib/ai/fashn-tryon-service.server";
import { advanceTryOnJob } from "~/lib/ai/my-naia-model.server";
import prisma from "~/db.server";
import type { VirtualTryOnJobRecord } from "~/lib/ai/virtual-try-on.types";

const FASHN_BASE = "https://api.fashn.ai";

type FashnStatus = "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";

interface FashnStatusBody {
  status: FashnStatus;
  output?: string[];
  error?: string;
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

    // outputDataUrl is a base64 data URL — never logged
    const outputDataUrl = outputs[0];
    const uploadResult = await uploadTryOnResult(customer.id, job.id, outputDataUrl);
    if (!uploadResult.ok) {
      await advanceTryOnJob(job as unknown as VirtualTryOnJobRecord, "FAILED", {
        errorCode: "UPLOAD_FAILED",
      });
      return data({ status: "FAILED" });
    }

    await advanceTryOnJob(job as unknown as VirtualTryOnJobRecord, "COMPLETED", {
      predictionId,
    });

    // Build fresh result URL — never cached
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
