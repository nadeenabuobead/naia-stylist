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
// Concurrency note: monthly quota checks are read-before-write and are NOT atomic.
// Two simultaneous requests from the same customer can both pass the check. This
// is acceptable for staging (low concurrency). Before enabling ENTITLEMENT_ENFORCEMENT
// in production, StyleMe and BuySkip guards must be wrapped in Serializable
// transactions (VTO already has this via createOrFindTryOnJob). Document this
// before flipping the production flag.

import type { CustomerPlan } from "@prisma/client";
import prisma from "~/db.server";
import { getLimits } from "./plan-limits.server";
import { getBillingWindow, formatResetDate } from "./billing-window.server";

// ── VTO stale threshold ────────────────────────────────────────────────────────
const VTO_IN_FLIGHT_STALE_MS = 10 * 60 * 1000; // 10 minutes

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
  monthlyLimit: number;
  monthlyUsed: number;
  welcomeAvailable: boolean;   // FREE only: first qualifying session hasn't happened yet
  resetDate: string;           // e.g. "1 October"
}

export interface BuySkipEntitlement {
  // FREE — lifetime one-time intro
  introAvailable: boolean;
  introUsed: boolean;
  // PAID — monthly
  monthlyLimit: number | null;  // null for FREE
  monthlyUsed: number | null;   // null for FREE
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
  monthlyLimit: number;        // 0 = not included
  monthlyUsed: null;           // V1: always null — no persisted event exists yet
}

export interface EntitlementSummary {
  plan: CustomerPlan;
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
  plan: CustomerPlan,
): Promise<EntitlementSummary> {
  const limits = getLimits(plan);
  const window = getBillingWindow();
  const resetDate = formatResetDate(window);
  const staleThreshold = new Date(Date.now() - VTO_IN_FLIGHT_STALE_MS);

  const qualifyingWhere = qualifyingStyleMeWhere(customerId);

  const [
    firstQualifyingSession,
    monthlyQualifyingCount,
    introBuySkipUsedCount,
    monthlyBuySkipUsed,
    vtoCompleted,
    vtoInFlight,
    closetCount,
  ] = await Promise.all([
    // StyleMe: first-ever qualifying root session (for welcome calculation)
    plan === "FREE"
      ? prisma.stylingSession.findFirst({
          where: qualifyingWhere,
          orderBy: { createdAt: "asc" },
          select: { id: true, createdAt: true },
        })
      : Promise.resolve(null),

    // StyleMe: qualifying root sessions in current window
    prisma.stylingSession.count({
      where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: window.end } },
    }),

    // BuySkip FREE: any usable analysis ever (lifetime intro check)
    plan === "FREE"
      ? prisma.buyOrSkipAnalysis.count({
          where: { customerId, verdict: { in: ["BUY", "SKIP", "MAYBE"] } },
        })
      : Promise.resolve(0),

    // BuySkip PAID: usable analyses in current window
    plan === "PAID"
      ? prisma.buyOrSkipAnalysis.count({
          where: {
            customerId,
            verdict: { in: ["BUY", "SKIP", "MAYBE"] },
            createdAt: { gte: window.start, lt: window.end },
          },
        })
      : Promise.resolve(0),

    // VTO: completed jobs in current window
    prisma.virtualTryOnJob.count({
      where: {
        customerId,
        status: "COMPLETED",
        createdAt: { gte: window.start, lt: window.end },
      },
    }),

    // VTO: genuinely active in-flight jobs (not stale)
    prisma.virtualTryOnJob.count({
      where: {
        customerId,
        status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
        lastActivityAt: { gte: staleThreshold },
      },
    }),

    // Closet: hard-delete model — every row is an active item
    prisma.closetItem.count({ where: { customerId } }),
  ]);

  // ── StyleMe calculation ──────────────────────────────────────────────────────
  // FREE: welcome session is additive (does not consume monthly slot).
  // If the first-ever qualifying session falls within the current window, subtract
  // it from the monthly count so it doesn't consume a monthly slot.
  const welcomeAvailable = plan === "FREE" && firstQualifyingSession == null;
  const welcomeInThisWindow =
    plan === "FREE" &&
    firstQualifyingSession != null &&
    firstQualifyingSession.createdAt >= window.start &&
    firstQualifyingSession.createdAt < window.end;

  const styleMeMonthlyUsed = monthlyQualifyingCount - (welcomeInThisWindow ? 1 : 0);

  return {
    plan,
    windowLabel: window.label,

    styleMe: {
      monthlyLimit: limits.styleMePerMonth,
      monthlyUsed: Math.max(0, styleMeMonthlyUsed),
      welcomeAvailable,
      resetDate,
    },

    buySkip: {
      introAvailable: plan === "FREE" && introBuySkipUsedCount === 0,
      introUsed: plan === "FREE" && introBuySkipUsedCount > 0,
      monthlyLimit: plan === "PAID" ? limits.buySkipPerMonth : null,
      monthlyUsed: plan === "PAID" ? monthlyBuySkipUsed : null,
      resetDate,
    },

    vto: {
      monthlyLimit: limits.vtoPerMonth,
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
      monthlyUsed: null, // V1: enforcement deferred — no persisted event exists
    },
  };
}

// ── Enforcement check ──────────────────────────────────────────────────────────
// Returns whether the customer may perform the given action right now.
// Called by route actions before executing the feature.

export type EntitlementFeature = "styleMe" | "buySkip" | "vto" | "closet";

export interface EntitlementCheck {
  allowed: boolean;
  reason?: "quota_exceeded" | "intro_used" | "at_capacity" | "feature_not_included";
}

export async function checkEntitlement(
  customerId: string,
  plan: CustomerPlan,
  feature: EntitlementFeature,
): Promise<EntitlementCheck> {
  const limits = getLimits(plan);
  const window = getBillingWindow();
  const staleThreshold = new Date(Date.now() - VTO_IN_FLIGHT_STALE_MS);

  switch (feature) {
    case "closet": {
      const count = await prisma.closetItem.count({ where: { customerId } });
      if (count >= limits.closetItems) return { allowed: false, reason: "at_capacity" };
      return { allowed: true };
    }

    case "styleMe": {
      const qualifyingWhere = qualifyingStyleMeWhere(customerId);
      const [firstEver, monthlyCount] = await Promise.all([
        plan === "FREE"
          ? prisma.stylingSession.findFirst({
              where: qualifyingWhere,
              orderBy: { createdAt: "asc" },
              select: { id: true, createdAt: true },
            })
          : Promise.resolve(null),
        prisma.stylingSession.count({
          where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: window.end } },
        }),
      ]);

      const welcomeAvailable = plan === "FREE" && firstEver == null;
      if (welcomeAvailable) return { allowed: true };

      const welcomeInThisWindow =
        plan === "FREE" &&
        firstEver != null &&
        firstEver.createdAt >= window.start &&
        firstEver.createdAt < window.end;
      const monthlyUsed = Math.max(0, monthlyCount - (welcomeInThisWindow ? 1 : 0));

      if (monthlyUsed < limits.styleMePerMonth) return { allowed: true };
      return { allowed: false, reason: "quota_exceeded" };
    }

    case "buySkip": {
      if (plan === "FREE") {
        const count = await prisma.buyOrSkipAnalysis.count({
          where: { customerId, verdict: { in: ["BUY", "SKIP", "MAYBE"] } },
        });
        if (count > 0) return { allowed: false, reason: "intro_used" };
        return { allowed: true };
      }
      // PAID
      const count = await prisma.buyOrSkipAnalysis.count({
        where: {
          customerId,
          verdict: { in: ["BUY", "SKIP", "MAYBE"] },
          createdAt: { gte: window.start, lt: window.end },
        },
      });
      if (count >= (limits.buySkipPerMonth ?? 0)) return { allowed: false, reason: "quota_exceeded" };
      return { allowed: true };
    }

    case "vto": {
      const [completed, inFlight] = await Promise.all([
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: "COMPLETED",
            createdAt: { gte: window.start, lt: window.end },
          },
        }),
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
            lastActivityAt: { gte: staleThreshold },
          },
        }),
      ]);
      if (completed + inFlight >= limits.vtoPerMonth) {
        return { allowed: false, reason: "quota_exceeded" };
      }
      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}
