// app/routes/api.closet-assess.ts
// POST /api/closet-assess
// Runs Stage B visual-content assessment for a pending-assessment closet item.
// Called by the client immediately after a successful Add or Edit that required Stage B.
//
// Security contract:
//   - Customer identity is resolved from the authenticated session only.
//   - customerId, imagePublicId, and imageUrl are NEVER accepted from the client.
//   - Item ownership is enforced: item.customerId must match the authenticated customer.
//   - Idempotency: if the item's tryOnEligibility is already resolved, the stored result
//     is returned immediately without calling the AI again.
//   - Stage B is AWAITED within this request — no fire-and-forget, no background work.
//   - The DB is written before the response is sent.
//
// Failure contract:
//   - Timeout or AI system failure → respond { eligible: "pending-assessment", assessmentFailed: true }.
//     The DB is NOT updated on failure — the item stays pending for client-side retry.
//   - A genuine Stage B result (including "not-supported" from not-fashion-item) is always persisted.

import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { buildPrivateDownloadUrl, getCloudinaryConfig } from "~/lib/cloudinary-admin.server";
import { assessClosetEligibilityStageB } from "~/lib/ai/closet-eligibility.server";
import { PRISMA_CATEGORY_MAP } from "~/lib/ai/closet-eligibility";

// 50 s — generous ceiling; Vercel maxDuration in vercel.json is 60 s for this endpoint.
const ASSESS_TIMEOUT_MS = 50_000;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) return data({ error: "Not authenticated" }, { status: 401 });
  const customer = await prisma.customer.findUnique({ where: { id: naiaCustomer.id } });
  if (!customer) return data({ error: "Not authenticated" }, { status: 401 });

  // ── Parse body ────────────────────────────────────────────────────────────
  // Accept only itemId — all other values are loaded from the DB.
  const formData = await request.formData();
  const itemId = (formData.get("itemId") as string | null)?.trim();
  if (!itemId) return data({ error: "itemId required" }, { status: 400 });

  // ── Ownership ─────────────────────────────────────────────────────────────
  const item = await prisma.closetItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      customerId: true,
      category: true,
      imagePublicId: true,
      imageFormat: true,
      tryOnEligibility: true,
      tryOnCustomerHint: true,
    },
  });
  if (!item || item.customerId !== customer.id) {
    return data({ error: "Item not found" }, { status: 404 });
  }

  // ── Idempotency ───────────────────────────────────────────────────────────
  // If assessment is already complete, return the stored result without re-running AI.
  if (item.tryOnEligibility !== "pending-assessment") {
    return data({ eligible: item.tryOnEligibility, customerHint: item.tryOnCustomerHint });
  }

  // ── Image required ────────────────────────────────────────────────────────
  if (!item.imagePublicId) {
    await prisma.closetItem.update({
      where: { id: itemId },
      data: { tryOnEligibility: "not-supported", tryOnInternalNote: "No imagePublicId — cannot assess." },
    });
    return data({ eligible: "not-supported", customerHint: null });
  }

  // ── Build signed URL server-side ──────────────────────────────────────────
  // Never trust a URL or publicId from the client.
  const cfg = getCloudinaryConfig();
  const imageUrl = buildPrivateDownloadUrl(
    cfg,
    item.imagePublicId,
    item.imageFormat ?? "jpg",
    "private",
  );

  // ── Resolve category ──────────────────────────────────────────────────────
  const category = PRISMA_CATEGORY_MAP[item.category] ?? "unsupported";

  // ── Stage B — awaited fully inside this request ───────────────────────────
  const timeoutSignal = new Promise<null>(resolve =>
    setTimeout(() => resolve(null), ASSESS_TIMEOUT_MS),
  );
  const result = await Promise.race([
    assessClosetEligibilityStageB(imageUrl, category),
    timeoutSignal,
  ]);

  // Timeout: keep item in pending-assessment so client can retry.
  if (result === null) {
    return data({ eligible: "pending-assessment" as const, assessmentFailed: true, customerHint: null });
  }

  // AI/system failure: same retryable treatment; do NOT persist.
  if (result.visualIssues.includes("visual-assessment-failed")) {
    return data({ eligible: "pending-assessment" as const, assessmentFailed: true, customerHint: null });
  }

  // ── Persist before responding ─────────────────────────────────────────────
  await prisma.closetItem.update({
    where: { id: itemId },
    data: {
      tryOnEligibility: result.eligible,
      tryOnAssessedAt: new Date(result.assessedAt),
      tryOnCustomerHint: result.customerHint,
      tryOnInternalNote: result.internalNote,
    },
  });

  return data({ eligible: result.eligible, customerHint: result.customerHint });
}
