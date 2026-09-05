// app/lib/plan/plan-limits.server.ts
// Central authoritative source for all plan entitlement limits.
// No React component, route, or action may hardcode limits — they call getLimits().

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
    vtoPerMonth: 3,
    personalisedTrendPerMonth: 1,
    publicTrendReports: true,
  },
};

export function getLimits(plan: CustomerPlan): EntitlementLimits {
  return LIMITS[plan];
}
