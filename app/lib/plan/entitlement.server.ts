// app/lib/plan/entitlement.server.ts
// Entitlement service — all usage queries and quota checks live here.
// Both the Plan & Usage page and the Overview consume getEntitlementSummary().
// Enforcement guards call checkEntitlement() before allowing a feature action.
//
// VTO stale-job threshold: 10 minutes. A CREATED/SUBMITTED/PROCESSING job whose
// lastActivityAt is older than 10 minutes is excluded from quota reservation.
// This exceeds the client polling window (~2 min) and FASHN's expected processing
// time by a safe margin. No background process transitions stale jobs to TIMED_OUT,
// so the threshold prevents a stuck job from permanently blocking future VTO use.
//
// Concurrency note: checkEntitlement() itself is still read-before-write and NOT
// atomic — it answers "is there room right now," nothing more. It remains useful
// as a cheap early fast-fail before expensive work (e.g. skip the AI call
// entirely for a customer clearly already over quota). The actual race — two
// simultaneous requests both passing that read before either writes its
// usage-consuming row — is closed by reserveStyleMeSlot/reserveBuySkipSlot/
// reserveClosetSlot below, which re-verify the count and perform the create in
// one Serializable transaction, mirroring VTO's existing createOrFindTryOnJob.
// Callers should use checkEntitlement for display/early-exit and the reserve*
// functions for the actual quota-consuming write.
//
// reserveClosetSlot, unlike the other two, is NOT behind ENTITLEMENT_ENFORCEMENT
// — Closet capacity enforcement is unconditional by existing design (see
// closet._index.tsx's own "immediate — no flag required" comment; it's a
// storage cap, not a trial gate), so the atomic version is unconditional too.
// The other two only take their atomic path once ENTITLEMENT_ENFORCEMENT is on.

import type { MembershipStatus, Prisma } from "@prisma/client";
import prisma from "~/db.server";
import { getMembershipAllowances, getEffectiveVtoLimit, getEffectiveStyleMeLimit } from "./plan-limits.server";
import { getUsageWindow, formatResetDate } from "./usage-window.server";

// ── VTO stale threshold ────────────────────────────────────────────────────────
const VTO_IN_FLIGHT_STALE_MS = 10 * 60 * 1000; // 10 minutes

// ── Mock-only staging test exclusion (2026-11-03) ──────────────────────────────
// productHandle values of this exact shape are written ONLY by the staging-only
// Full-Look VTO mock harness (poc-job-tracked-full-look-chain.server.ts /
// staging.full-look-vto-test.tsx) — confirmed by grep across the codebase, no
// real customer-facing VTO path (api.trigger-tryon.tsx included) ever produces
// a Shopify product handle with this prefix. Excluding it here means a real
// customer's real usage is completely unaffected (they never have a row that
// matches), while the one staging QA account's repeated mock runs stop
// counting against its own monthly VTO allowance. Real VTO accounting,
// production billing protections, and every other feature's quota logic are
// untouched by this constant.
const MOCK_VTO_PRODUCT_HANDLE_PREFIX = "fulllook-poc:";

// ── Transaction retry (mirrors my-naia-model.server.ts's VTO job creation) ────
const MAX_TX_RETRIES = 2;

function isSerializationError(e: unknown): boolean {
  // Prisma P2034: Transaction failed due to a write conflict or a deadlock.
  return (e as any)?.code === "P2034";
}

// ── Qualifying StyleMe condition ───────────────────────────────────────────────
// A StyleMe session counts toward quota only if it is a root session (parentSessionId = null)
// AND it successfully produced at least one OutfitSuggestion with non-null moodDescription
// that is NOT the "no-eligible-product" failure encoding.
function qualifyingStyleMeWhere(customerId: string) {
  return {
    customerId,
    parentSessionId: null,
    suggestions: {
      some: {
        AND: [
          { moodDescription: { not: null } },
          { moodDescription: { not: { contains: '"outcome":"no-eligible-product"' } } },
        ],
      },
    },
  } as const;
}

// ── Entitlement summary types ──────────────────────────────────────────────────

export interface StyleMeEntitlement {
  monthlyLimit: number;  // effectiveMonthlyBase (override ?? catalog base)
  monthlyUsed: number;
  resetDate: string;     // e.g. "1 October"
}

export interface BuySkipEntitlement {
  monthlyLimit: number;
  monthlyUsed: number;
  resetDate: string;
}

export interface VTOEntitlement {
  monthlyLimit: number;
  monthlyCompleted: number;    // successfully delivered (COMPLETED status)
  monthlyInFlight: number;     // actively generating (non-stale CREATED/SUBMITTED/PROCESSING)
  resetDate: string;
}

export interface ClosetEntitlement {
  currentCount: number;
  limit: number;
  atCapacity: boolean;
}

export interface PersonalisedTrendEntitlement {
  monthlyLimit: number;  // 1 for MEMBER, 0 for NONE
  monthlyUsed: number;   // real count from PersonalisedTrendEditUsage, current window
}

export interface EntitlementSummary {
  membershipStatus: MembershipStatus;
  styleMe: StyleMeEntitlement;
  buySkip: BuySkipEntitlement;
  vto: VTOEntitlement;
  closet: ClosetEntitlement;
  personalisedTrend: PersonalisedTrendEntitlement;
  windowLabel: string;
}

// ── Main function ──────────────────────────────────────────────────────────────

export async function getEntitlementSummary(
  customerId: string,
  membershipStatus: MembershipStatus,
): Promise<EntitlementSummary> {
  const limits = getMembershipAllowances(membershipStatus);
  const effectiveVtoLimit = getEffectiveVtoLimit(membershipStatus);
  const effectiveStyleMeLimit = getEffectiveStyleMeLimit(membershipStatus);
  const window = getUsageWindow();
  const resetDate = formatResetDate(window);
  const staleThreshold = new Date(Date.now() - VTO_IN_FLIGHT_STALE_MS);

  const qualifyingWhere = qualifyingStyleMeWhere(customerId);

  // Sequential, not Promise.all: the pooled DATABASE_URL runs this app with
  // connection_limit=1 per serverless instance, so N concurrent queries never
  // actually run in parallel at the DB — they just all queue for the same one
  // connection. Firing them as Promise.all only maximises how many queries are
  // simultaneously waiting on that queue, which is what was pushing requests
  // (this function is a major contributor, called from the main Overview
  // loader) past the pool's 10s connection-wait timeout under any real load.
  // Awaiting one at a time means each query holds and releases the connection
  // before the next asks for it — same data, no queuing.

  // StyleMe: qualifying root sessions in current window
  const monthlyQualifyingCount = await prisma.stylingSession.count({
    where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: window.end } },
  });

  // BuySkip: usable analyses in current window
  const monthlyBuySkipUsed = await prisma.buyOrSkipAnalysis.count({
    where: {
      customerId,
      verdict: { in: ["BUY", "SKIP", "MAYBE"] },
      createdAt: { gte: window.start, lt: window.end },
    },
  });

  // VTO: completed jobs in current window
  const vtoCompleted = await prisma.virtualTryOnJob.count({
    where: {
      customerId,
      status: "COMPLETED",
      createdAt: { gte: window.start, lt: window.end },
      NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
    },
  });

  // VTO: genuinely active in-flight jobs (not stale)
  const vtoInFlight = await prisma.virtualTryOnJob.count({
    where: {
      customerId,
      status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
      lastActivityAt: { gte: staleThreshold },
      NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
    },
  });

  // Closet: hard-delete model — every row is an active item
  const closetCount = await prisma.closetItem.count({ where: { customerId } });

  // Personalised Trend Edit: completed-edit usage rows in current window.
  // PersonalisedTrendEditUsage is the customer entitlement/usage source of
  // truth — JourneyEvent's trend_edit_generated is analytics-only and is
  // never read here.
  const monthlyPersonalisedTrendUsed = await prisma.personalisedTrendEditUsage.count({
    where: { customerId, createdAt: { gte: window.start, lt: window.end } },
  });

  return {
    membershipStatus,
    windowLabel: window.label,

    styleMe: {
      monthlyLimit: effectiveStyleMeLimit,
      monthlyUsed: monthlyQualifyingCount,
      resetDate,
    },

    buySkip: {
      monthlyLimit: limits.buySkipPerMonth,
      monthlyUsed: monthlyBuySkipUsed,
      resetDate,
    },

    vto: {
      monthlyLimit: effectiveVtoLimit,
      monthlyCompleted: vtoCompleted,
      monthlyInFlight: vtoInFlight,
      resetDate,
    },

    closet: {
      currentCount: closetCount,
      limit: limits.closetItems,
      atCapacity: closetCount >= limits.closetItems,
    },

    personalisedTrend: {
      monthlyLimit: limits.personalisedTrendPerMonth,
      monthlyUsed: monthlyPersonalisedTrendUsed,
    },
  };
}

// ── Enforcement check ──────────────────────────────────────────────────────────
// Returns whether the customer may perform the given action right now.
// Called by route actions before executing the feature.

export type EntitlementFeature = "styleMe" | "buySkip" | "vto" | "closet" | "personalisedTrend";

export interface EntitlementCheck {
  allowed: boolean;
  reason?: "quota_exceeded" | "at_capacity";
}

export async function checkEntitlement(
  customerId: string,
  membershipStatus: MembershipStatus,
  feature: EntitlementFeature,
  // excludeItemId: for a closet replace-in-progress, the old item being replaced
  // is still present in the table at check time but is about to be removed as
  // part of the same operation — exclude it so an at-capacity customer can swap
  // one piece for another without being blocked by a slot that is already
  // spoken for. Ignored by every feature other than "closet".
  options?: { excludeItemId?: string },
): Promise<EntitlementCheck> {
  const limits = getMembershipAllowances(membershipStatus);
  const window = getUsageWindow();
  const staleThreshold = new Date(Date.now() - VTO_IN_FLIGHT_STALE_MS);

  switch (feature) {
    case "closet": {
      const count = await prisma.closetItem.count({
        where: {
          customerId,
          ...(options?.excludeItemId ? { id: { not: options.excludeItemId } } : {}),
        },
      });
      if (count >= limits.closetItems) return { allowed: false, reason: "at_capacity" };
      return { allowed: true };
    }

    case "styleMe": {
      const effectiveStyleMeLimit = getEffectiveStyleMeLimit(membershipStatus);
      const monthlyUsed = await prisma.stylingSession.count({
        where: { ...qualifyingStyleMeWhere(customerId), createdAt: { gte: window.start, lt: window.end } },
      });
      if (monthlyUsed < effectiveStyleMeLimit) return { allowed: true };
      return { allowed: false, reason: "quota_exceeded" };
    }

    case "buySkip": {
      const count = await prisma.buyOrSkipAnalysis.count({
        where: {
          customerId,
          verdict: { in: ["BUY", "SKIP", "MAYBE"] },
          createdAt: { gte: window.start, lt: window.end },
        },
      });
      if (count >= limits.buySkipPerMonth) return { allowed: false, reason: "quota_exceeded" };
      return { allowed: true };
    }

    case "vto": {
      const effectiveVtoLimit = getEffectiveVtoLimit(membershipStatus);
      const [completed, inFlight] = await Promise.all([
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: "COMPLETED",
            createdAt: { gte: window.start, lt: window.end },
            NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
          },
        }),
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
            lastActivityAt: { gte: staleThreshold },
            NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
          },
        }),
      ]);
      if (completed + inFlight >= effectiveVtoLimit) {
        return { allowed: false, reason: "quota_exceeded" };
      }
      return { allowed: true };
    }

    case "personalisedTrend": {
      // Binary membership short-circuit first — NONE has zero allowance
      // regardless of usage, same as every other feature's zero-limit case.
      if (limits.personalisedTrendPerMonth <= 0) return { allowed: false, reason: "quota_exceeded" };
      // Real count against PersonalisedTrendEditUsage — the customer
      // entitlement/usage source of truth. JourneyEvent is never read here.
      const count = await prisma.personalisedTrendEditUsage.count({
        where: { customerId, createdAt: { gte: window.start, lt: window.end } },
      });
      if (count >= limits.personalisedTrendPerMonth) return { allowed: false, reason: "quota_exceeded" };
      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}

// ── Atomic reservation ──────────────────────────────────────────────────────────
// Closes the race checkEntitlement() cannot: re-verifies the monthly count and
// performs the caller's create inside one Serializable transaction, so two
// concurrent requests from the same customer cannot both pass the count check
// before either commits. Only called from a route when ENTITLEMENT_ENFORCEMENT
// is enabled — when it's off, callers keep creating directly, unchanged.
//
// A P2002 (unique constraint — e.g. BuySkip's idempotencyKey) is NOT caught
// here; it propagates so the caller's own existing idempotent-repeat handling
// (already required to exist for duplicate submissions) runs unchanged.

export type RunReservationFn = <T>(
  fn: (tx: Pick<typeof prisma, "stylingSession" | "buyOrSkipAnalysis" | "closetItem">) => Promise<T>,
) => Promise<T>;

const _runReservationTransaction: RunReservationFn = (fn) =>
  prisma.$transaction(
    (tx: Pick<typeof prisma, "stylingSession" | "buyOrSkipAnalysis" | "closetItem">) => fn(tx),
    { isolationLevel: "Serializable" },
  );

export type ReserveResult<T> =
  | { allowed: true; record: T }
  | { allowed: false; reason: "quota_exceeded" | "at_capacity" };

export async function reserveStyleMeSlot(
  customerId: string,
  membershipStatus: MembershipStatus,
  sessionData: Prisma.StylingSessionUncheckedCreateInput,
  _runTransaction: RunReservationFn = _runReservationTransaction,
): Promise<ReserveResult<Awaited<ReturnType<typeof prisma.stylingSession.create>>>> {
  const effectiveLimit = getEffectiveStyleMeLimit(membershipStatus);
  const window = getUsageWindow();
  const qualifyingWhere = qualifyingStyleMeWhere(customerId);

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        const used = await tx.stylingSession.count({
          where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: window.end } },
        });
        if (used >= effectiveLimit) {
          return { allowed: false, reason: "quota_exceeded" };
        }
        const record = await tx.stylingSession.create({ data: sessionData });
        return { allowed: true, record };
      });
    } catch (e) {
      if (isSerializationError(e) && attempt < MAX_TX_RETRIES) continue;
      throw e;
    }
  }
  // Unreachable — loop always returns or throws.
  throw new Error("Unexpected exit from reserveStyleMeSlot retry loop");
}

export async function reserveBuySkipSlot(
  customerId: string,
  membershipStatus: MembershipStatus,
  analysisData: Prisma.BuyOrSkipAnalysisUncheckedCreateInput,
  _runTransaction: RunReservationFn = _runReservationTransaction,
): Promise<ReserveResult<Awaited<ReturnType<typeof prisma.buyOrSkipAnalysis.create>>>> {
  const limits = getMembershipAllowances(membershipStatus);
  const window = getUsageWindow();

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        const used = await tx.buyOrSkipAnalysis.count({
          where: {
            customerId,
            verdict: { in: ["BUY", "SKIP", "MAYBE"] },
            createdAt: { gte: window.start, lt: window.end },
          },
        });
        if (used >= limits.buySkipPerMonth) {
          return { allowed: false, reason: "quota_exceeded" };
        }
        const record = await tx.buyOrSkipAnalysis.create({ data: analysisData });
        return { allowed: true, record };
      });
    } catch (e) {
      if (isSerializationError(e) && attempt < MAX_TX_RETRIES) continue;
      throw e;
    }
  }
  throw new Error("Unexpected exit from reserveBuySkipSlot retry loop");
}

export async function reserveClosetSlot(
  customerId: string,
  membershipStatus: MembershipStatus,
  itemData: Prisma.ClosetItemCreateInput,
  _runTransaction: RunReservationFn = _runReservationTransaction,
): Promise<ReserveResult<Awaited<ReturnType<typeof prisma.closetItem.create>>>> {
  const limits = getMembershipAllowances(membershipStatus);

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        // Closet is a hard-delete model — every row is an active item, no
        // window filter (matches checkEntitlement's "closet" case and
        // getEntitlementSummary's own count exactly).
        const used = await tx.closetItem.count({ where: { customerId } });
        if (used >= limits.closetItems) {
          return { allowed: false, reason: "at_capacity" };
        }
        const record = await tx.closetItem.create({ data: itemData });
        return { allowed: true, record };
      });
    } catch (e) {
      if (isSerializationError(e) && attempt < MAX_TX_RETRIES) continue;
      throw e;
    }
  }
  throw new Error("Unexpected exit from reserveClosetSlot retry loop");
}
