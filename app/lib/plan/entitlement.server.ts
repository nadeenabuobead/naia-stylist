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

import type { MembershipStatus } from "@prisma/client";
import prisma from "~/db.server";
import { getMembershipAllowances, getEffectiveVtoLimit, getEffectiveStyleMeLimit } from "./plan-limits.server";
import { getUsageWindow, formatResetDate } from "./usage-window.server";

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
  monthlyUsed: null;     // V1: always null — no persisted usage event exists yet
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

  const [
    monthlyQualifyingCount,
    monthlyBuySkipUsed,
    vtoCompleted,
    vtoInFlight,
    closetCount,
  ] = await Promise.all([
    // StyleMe: qualifying root sessions in current window
    prisma.stylingSession.count({
      where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: window.end } },
    }),

    // BuySkip: usable analyses in current window
    prisma.buyOrSkipAnalysis.count({
      where: {
        customerId,
        verdict: { in: ["BUY", "SKIP", "MAYBE"] },
        createdAt: { gte: window.start, lt: window.end },
      },
    }),

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
      monthlyUsed: null, // V1: enforcement deferred — no persisted usage event exists
    },
  };
}

// ── Enforcement check ──────────────────────────────────────────────────────────
// Returns whether the customer may perform the given action right now.
// Called by route actions before executing the feature.

export type EntitlementFeature = "styleMe" | "buySkip" | "vto" | "closet";

export interface EntitlementCheck {
  allowed: boolean;
  reason?: "quota_exceeded" | "at_capacity";
}

export async function checkEntitlement(
  customerId: string,
  membershipStatus: MembershipStatus,
  feature: EntitlementFeature,
): Promise<EntitlementCheck> {
  const limits = getMembershipAllowances(membershipStatus);
  const window = getUsageWindow();
  const staleThreshold = new Date(Date.now() - VTO_IN_FLIGHT_STALE_MS);

  switch (feature) {
    case "closet": {
      const count = await prisma.closetItem.count({ where: { customerId } });
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
      if (completed + inFlight >= effectiveVtoLimit) {
        return { allowed: false, reason: "quota_exceeded" };
      }
      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}
