// app/lib/cloudinary-orphan-sweep.server.ts
//
// Cleans up Cloudinary assets that were uploaded to a customer's own
// naia-wardrobe/{customerId}/ folder but never ended up referenced by any
// live DB row — the "upload now, commit later" gap in the Closet and
// Buy-or-Skip add-flows (confirmed: the uploaded publicId lives only in
// React component state, never resumable once the page is left or
// reloaded — see project memory for the verification). VTO model photos
// and selfies do NOT have this gap (they commit within one request), but
// they share the SAME Cloudinary folder, so this module's reference check
// must protect them too — see PROTECTED_MODELS below.
//
// Two entry points:
//   - sweepCustomerForErasure: synchronous, immediate, no age threshold —
//     called from customer-privacy.server.ts so account deletion doesn't
//     wait on the ordinary grace period.
//   - runBoundedSweep: the cron/admin-triggered multi-customer job — bounded
//     by time, customer count, and Cloudinary's own rate limit; resumable
//     via a stored cursor; guarded against overlapping runs. See
//     CloudinarySweepRun's schema comment.
//
// Concurrency: see cloudinary-deletion-claim.server.ts for how the
// recheck-then-claim step is made atomic against a concurrent commit via
// Serializable transactions, not a plain recheck.

import prisma from "../db.server";
import {
  listCloudinaryAssetsByPrefix,
  deleteCloudinaryAsset,
  type CloudinaryListedAsset,
} from "./cloudinary-admin.server";
import { claimPublicIdForDeletion, resolveClaim, recordClaimFailure } from "./cloudinary-deletion-claim.server";
import type { Prisma } from "@prisma/client";

const DELIVERY_TYPES = ["private", "authenticated"] as const;

// Every live model whose Cloudinary asset shares the naia-wardrobe/{customerId}/
// folder. Confirmed by a full schema + upload-route audit (not assumed) —
// see project memory for the inventory. PostOutfitReview.woreItPhotoUrl was
// also checked and confirmed dead (zero write sites) — deliberately not
// included here.
type SweepTxClient = Pick<
  typeof prisma,
  "closetItem" | "buyOrSkipAnalysis" | "naiaModel" | "selfieAnalysis" | "pendingCloudinaryDeletion"
>;

async function referencedPublicIds(tx: SweepTxClient, customerId: string): Promise<Set<string>> {
  const [closetItems, bosItems, model, selfie] = await Promise.all([
    tx.closetItem.findMany({ where: { customerId, imagePublicId: { not: null } }, select: { imagePublicId: true } }),
    tx.buyOrSkipAnalysis.findMany({ where: { customerId, imagePublicId: { not: null } }, select: { imagePublicId: true } }),
    tx.naiaModel.findUnique({ where: { customerId }, select: { facePublicId: true, bodyPublicId: true } }),
    tx.selfieAnalysis.findUnique({ where: { customerId }, select: { photoPublicId: true } }),
  ]);
  const ids = new Set<string>();
  for (const i of closetItems) if (i.imagePublicId) ids.add(i.imagePublicId);
  for (const i of bosItems) if (i.imagePublicId) ids.add(i.imagePublicId);
  if (model?.facePublicId) ids.add(model.facePublicId);
  if (model?.bodyPublicId) ids.add(model.bodyPublicId);
  if (selfie?.photoPublicId) ids.add(selfie.photoPublicId);
  return ids;
}

// Mirrors entitlement.server.ts's own transaction-retry convention
// (isSerializationError/MAX_TX_RETRIES) exactly — not re-exported from
// there because its RunReservationFn's tx type is narrower than what this
// module needs (it doesn't include naiaModel/selfieAnalysis/
// pendingCloudinaryDeletion). Same Prisma error code, same retry bound.
const MAX_TX_RETRIES = 2;
function isSerializationError(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2034";
}

async function runSerializable<T>(fn: (tx: SweepTxClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction((tx: SweepTxClient) => fn(tx), { isolationLevel: "Serializable" });
    } catch (e) {
      if (isSerializationError(e) && attempt < MAX_TX_RETRIES) continue;
      throw e;
    }
  }
  throw new Error("Unexpected exit from runSerializable retry loop");
}

export interface SweepOutcome {
  checked: number;
  deleted: number;
  skippedRecent: number;
  // Covers both "already referenced before this run started" and "a
  // concurrent commit won the race and referenced it during the atomic
  // recheck" — the Serializable transaction treats both identically
  // (claimed = false), and both are the correct, safe outcome.
  skippedReferenced: number;
  failedAssets: string[];
  rateLimited: boolean;
}

function emptyOutcome(): SweepOutcome {
  return { checked: 0, deleted: 0, skippedRecent: 0, skippedReferenced: 0, failedAssets: [], rateLimited: false };
}

interface SweepOptions {
  minAgeMs: number; // 0 = no grace period (account-erasure mode)
  dryRun: boolean;
  maxAssetsPerDeliveryType?: number;
}

// Sweeps exactly one customer's naia-wardrobe/{customerId}/ folder, across
// both delivery types. Safe to call repeatedly (idempotent: an asset
// already deleted or already referenced is simply skipped next time).
export async function sweepCustomer(customerId: string, opts: SweepOptions): Promise<SweepOutcome> {
  const outcome = emptyOutcome();
  const prefix = `naia-wardrobe/${customerId}/`;
  const now = Date.now();

  for (const deliveryType of DELIVERY_TYPES) {
    let cursor: string | null = null;
    do {
      const page = await listCloudinaryAssetsByPrefix(prefix, deliveryType, {
        cursor,
        maxResults: opts.maxAssetsPerDeliveryType ?? 100,
      });
      if (!page.ok) {
        if (page.errorCode === "RATE_LIMITED") outcome.rateLimited = true;
        break; // move on; this customer's remaining assets (if any) are picked up next run
      }

      for (const asset of page.assets) {
        outcome.checked++;
        await processCandidate(customerId, asset, opts, now, outcome);
      }

      cursor = page.nextCursor;
      if (page.rateLimitRemaining !== null && page.rateLimitRemaining < 20) {
        outcome.rateLimited = true;
        cursor = null; // stop paginating this customer; resume next run
      }
    } while (cursor);
  }

  return outcome;
}

async function processCandidate(
  customerId: string,
  asset: CloudinaryListedAsset,
  opts: SweepOptions,
  now: number,
  outcome: SweepOutcome,
): Promise<void> {
  const ageMs = asset.createdAt ? now - new Date(asset.createdAt).getTime() : 0;
  if (opts.minAgeMs > 0 && ageMs < opts.minAgeMs) {
    outcome.skippedRecent++;
    return;
  }

  // Phase 1 — atomic recheck + claim, Serializable, DB-only, fast. This is
  // the step that must be race-free against reserveClosetSlot/
  // reserveBuySkipSlot/the two direct commit paths — see
  // cloudinary-deletion-claim.server.ts.
  let claimed = false;
  try {
    claimed = await runSerializable(async (tx) => {
      const referenced = await referencedPublicIds(tx, customerId);
      if (referenced.has(asset.publicId)) return false;
      if (!opts.dryRun) {
        await claimPublicIdForDeletion(tx, {
          customerId,
          publicId: asset.publicId,
          resourceType: asset.resourceType || "image",
          deliveryType: asset.type,
          context: opts.minAgeMs === 0 ? "account-erasure" : "abandoned-upload-sweep",
        });
      }
      return true;
    });
  } catch {
    outcome.failedAssets.push(asset.publicId);
    return;
  }

  if (!claimed) {
    outcome.skippedReferenced++;
    return;
  }
  if (opts.dryRun) {
    outcome.deleted++; // "would delete" — dry-run never calls Cloudinary or writes a claim row
    return;
  }

  // Phase 2 — the slow external call, deliberately OUTSIDE the transaction.
  const del = await deleteCloudinaryAsset(asset.publicId, asset.type);
  if (del.ok) {
    await resolveClaim(asset.publicId);
    outcome.deleted++;
  } else {
    await recordClaimFailure(asset.publicId, del.errorCode ?? "UNKNOWN");
    outcome.failedAssets.push(asset.publicId);
  }
}

// Immediate, no-grace-period sweep for exactly one customer — called from
// eraseCustomerData. Small and synchronous by construction (one folder);
// still paginated defensively in case that assumption is ever wrong.
export async function sweepCustomerForErasure(customerId: string): Promise<SweepOutcome> {
  return sweepCustomer(customerId, { minAgeMs: 0, dryRun: false });
}

const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000; // 24h — see project memory for why this is safe
const SOFT_DEADLINE_MS = 240_000; // leaves headroom under Vercel Hobby's 300s function cap
const DEFAULT_MAX_CUSTOMERS_PER_RUN = 200;
const STALE_RUN_MS = 10 * 60 * 1000; // a RUNNING row older than this is treated as crashed, not active

export interface BoundedSweepOptions {
  mode: "SCHEDULED" | "ADMIN";
  dryRun: boolean;
  maxCustomers?: number;
  softDeadlineMs?: number;
  graceMs?: number;
}

export interface BoundedSweepResult {
  runId: string;
  startedExisting: false | string; // false, or the id of the still-running row that blocked this attempt
  customersChecked: number;
  assetsChecked: number;
  assetsDeleted: number;
  assetsSkippedRecent: number;
  assetsSkippedReferenced: number;
  failures: number;
  stoppedReason: "TIME_BUDGET" | "CUSTOMER_CAP" | "RATE_LIMIT" | "COMPLETED_ALL" | "ERROR" | "ALREADY_RUNNING";
  cursorCustomerId: string | null;
}

// The cron/admin-triggered job. Never processes "all customers" unbounded —
// stops at whichever limit is hit first and persists where it left off.
export async function runBoundedSweep(opts: BoundedSweepOptions): Promise<BoundedSweepResult> {
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const maxCustomers = opts.maxCustomers ?? DEFAULT_MAX_CUSTOMERS_PER_RUN;
  const softDeadlineMs = opts.softDeadlineMs ?? SOFT_DEADLINE_MS;
  const deadline = Date.now() + softDeadlineMs;

  const active = await prisma.cloudinarySweepRun.findFirst({
    where: { status: "RUNNING", startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    return {
      runId: active.id,
      startedExisting: active.id,
      customersChecked: 0,
      assetsChecked: 0,
      assetsDeleted: 0,
      assetsSkippedRecent: 0,
      assetsSkippedReferenced: 0,
      failures: 0,
      stoppedReason: "ALREADY_RUNNING",
      cursorCustomerId: null,
    };
  }

  // Resume from the last completed run's cursor, if any.
  const lastRun = await prisma.cloudinarySweepRun.findFirst({ orderBy: { startedAt: "desc" } });
  const resumeFrom = lastRun?.stoppedReason !== "COMPLETED_ALL" ? lastRun?.cursorCustomerId ?? null : null;

  const run = await prisma.cloudinarySweepRun.create({
    data: { status: "RUNNING", mode: opts.mode, dryRun: opts.dryRun, cursorCustomerId: resumeFrom },
  });

  const totals = { customersChecked: 0, assetsChecked: 0, assetsDeleted: 0, assetsSkippedRecent: 0, assetsSkippedReferenced: 0, failures: 0 };
  let stoppedReason: BoundedSweepResult["stoppedReason"] = "COMPLETED_ALL";
  let lastCustomerId: string | null = resumeFrom;

  try {
    const customers = await prisma.customer.findMany({
      where: resumeFrom ? { id: { gt: resumeFrom } } : undefined,
      orderBy: { id: "asc" },
      select: { id: true },
      take: maxCustomers,
    });

    for (const customer of customers) {
      if (Date.now() > deadline) {
        stoppedReason = "TIME_BUDGET";
        break;
      }
      const outcome = await sweepCustomer(customer.id, { minAgeMs: graceMs, dryRun: opts.dryRun });
      totals.customersChecked++;
      totals.assetsChecked += outcome.checked;
      totals.assetsDeleted += outcome.deleted;
      totals.assetsSkippedRecent += outcome.skippedRecent;
      totals.assetsSkippedReferenced += outcome.skippedReferenced;
      totals.failures += outcome.failedAssets.length;
      lastCustomerId = customer.id;

      if (outcome.rateLimited) {
        stoppedReason = "RATE_LIMIT";
        break;
      }
    }
    if (totals.customersChecked >= maxCustomers && stoppedReason === "COMPLETED_ALL") {
      stoppedReason = "CUSTOMER_CAP";
    }
  } catch {
    stoppedReason = "ERROR";
  }

  await prisma.cloudinarySweepRun.update({
    where: { id: run.id },
    data: {
      status: stoppedReason === "ERROR" ? "FAILED" : "COMPLETED",
      finishedAt: new Date(),
      cursorCustomerId: lastCustomerId,
      customersChecked: totals.customersChecked,
      assetsChecked: totals.assetsChecked,
      assetsDeleted: totals.assetsDeleted,
      assetsSkippedRecent: totals.assetsSkippedRecent,
      assetsSkippedReferenced: totals.assetsSkippedReferenced,
      failures: totals.failures,
      stoppedReason,
    },
  });

  return { runId: run.id, startedExisting: false, ...totals, stoppedReason, cursorCustomerId: lastCustomerId };
}
