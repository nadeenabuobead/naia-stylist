// app/lib/plan/plan-limits.server.ts
// Central authoritative source for all plan entitlement limits.
// No React component, route, or action may hardcode limits — they call getLimits().
//
// Staging QA overrides (never set these in production):
//   VTO_MONTHLY_LIMIT_OVERRIDE=<n>     — raises effective VTO limit for all plans
//   STYLEME_MONTHLY_LIMIT_OVERRIDE=<n> — raises effective StyleMe limit for all plans
// When absent/invalid, the plan's natural limit applies.

import type { CustomerPlan } from "@prisma/client";

export interface EntitlementLimits {
  closetItems: number;
  styleMePerMonth: number;
  welcomeStyleMe: boolean;   // one-time additive bonus (FREE only)
  buySkipIntroLifetime: boolean; // one-time lifetime intro check (FREE only)
  buySkipPerMonth: number;   // 0 for FREE (no recurring monthly)
  vtoPerMonth: number;
  personalisedTrendPerMonth: number; // 0 = not included
  publicTrendReports: true;  // unlimited for both plans
}

const LIMITS: Record<CustomerPlan, EntitlementLimits> = {
  FREE: {
    closetItems: 50,
    styleMePerMonth: 1,
    welcomeStyleMe: true,
    buySkipIntroLifetime: true,
    buySkipPerMonth: 0,
    vtoPerMonth: 1,
    personalisedTrendPerMonth: 0,
    publicTrendReports: true,
  },
  PAID: {
    closetItems: 250,
    styleMePerMonth: 8,
    welcomeStyleMe: false,
    buySkipIntroLifetime: false,
    buySkipPerMonth: 5,
    vtoPerMonth: 10,
    personalisedTrendPerMonth: 1,
    publicTrendReports: true,
  },
};

export function getLimits(plan: CustomerPlan): EntitlementLimits {
  return LIMITS[plan];
}

// Returns the effective VTO monthly limit for display and enforcement.
// When VTO_MONTHLY_LIMIT_OVERRIDE is a valid positive integer, it overrides
// the plan's natural limit for all tiers — use this on staging only.
// Production behavior is unchanged when the env var is absent.
export function getEffectiveVtoLimit(plan: CustomerPlan): number {
  const override = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
  if (override) {
    const parsed = parseInt(override, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return LIMITS[plan].vtoPerMonth;
}

// Returns the effective StyleMe monthly limit for display and enforcement.
// When STYLEME_MONTHLY_LIMIT_OVERRIDE is a valid positive integer, it overrides
// the plan's natural limit for all tiers — use this on staging only.
// Production behavior is unchanged when the env var is absent.
export function getEffectiveStyleMeLimit(plan: CustomerPlan): number {
  const override = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
  if (override) {
    const parsed = parseInt(override, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return LIMITS[plan].styleMePerMonth;
}
