// app/routes/api.tryon-result.$jobId.tsx
// Phase 4A5 — Virtual try-on result delivery (proxy-auth gated).
//
// Proxy HMAC validates logged_in_customer_id before any result is returned.
// Ownership check ensures the requesting customer owns the job.
// Only COMPLETED jobs return a result URL — all other states are 404 (fail-closed).
// Result URL is short-lived (10-min expiry); never persisted or logged.
// No FASHN calls. No Prisma mutations.

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { buildTryOnResultUrl, checkResultOwnership } from "~/lib/ai/fashn-tryon-service.server";

export async function loader({ params, request }: LoaderFunctionArgs) {
  // 1. Validate Shopify app-proxy HMAC — throws on invalid/missing signature
  try {
    await authenticate.public.appProxy(request);
  } catch (_) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const shopifyId = url.searchParams.get("logged_in_customer_id") || null;

  // Guests cannot access try-on results
  if (!shopifyId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { jobId } = params;
  if (!jobId) {
    return new Response("Not Found", { status: 404 });
  }

  // 2. Resolve internal customer ID from proxy-verified shopifyId
  const customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: shopifyId },
    select: { id: true },
  });
  if (!customer) {
    return new Response("Not Found", { status: 404 });
  }

  // 3. Load job
  const job = await prisma.virtualTryOnJob.findUnique({
    where: { id: jobId },
    select: { customerId: true, status: true, id: true },
  });

  // Fail-closed: only COMPLETED jobs with verified ownership return a result
  if (!job || job.status !== "COMPLETED") {
    return new Response("Not Found", { status: 404 });
  }

  if (!checkResultOwnership(job.customerId, customer.id)) {
    return new Response("Forbidden", { status: 403 });
  }

  // 4. Generate short-lived result URL (contains signed credential — must not be logged or cached)
  const resultUrl = buildTryOnResultUrl(customer.id, job.id);
  if (!resultUrl) {
    return new Response("Service Unavailable", { status: 503 });
  }

  return Response.json(
    { resultUrl, expiresInSeconds: 600 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
