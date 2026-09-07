// app/lib/plan/plan-limits.server.ts
// Central authoritative source for membership allowances, pricing, and add-on catalog.
// No React component, route, or action may hardcode limits — they call getMembershipAllowances().
// This file is pure constants — no Prisma queries, no env reads (those belong in callers).
//
// Staging QA overrides (never set these in production):
//   VTO_MONTHLY_LIMIT_OVERRIDE=<n>     — raises effective VTO limit for display and enforcement
//   STYLEME_MONTHLY_LIMIT_OVERRIDE=<n> — raises effective StyleMe limit for display and enforcement
// When absent/invalid, the membership's natural limit applies.

import type { MembershipStatus } from "@prisma/client";

export interface MembershipAllowances {
  closetItems: number;
  styleMePerMonth: number;
  buySkipPerMonth: number;
  vtoPerMonth: number;
  personalisedTrendPerMonth: number;
}

const MEMBERSHIP_ALLOWANCES: Record<MembershipStatus, MembershipAllowances> = {
  NONE: {
    closetItems: 0,
    styleMePerMonth: 0,
    buySkipPerMonth: 0,
    vtoPerMonth: 0,
    personalisedTrendPerMonth: 0,
  },
  MEMBER: {
    closetItems: 250,
    styleMePerMonth: 8,
    buySkipPerMonth: 5,
    vtoPerMonth: 10,
    personalisedTrendPerMonth: 1,
  },
};

// Commercial membership pricing — not billing state, just the catalog facts.
export const MEMBERSHIP_PRICING = {
  monthly: { amount: 39, currency: "AED" },
  annual:  { amount: 299, currency: "AED" },
} as const;

// Add-on catalog — drives the Coming Soon UI display.
// No billing integration yet; these are display-only until purchasing is implemented.
export interface AddonDefinition {
  label: string;
  description: string;
  price: string;
  separator?: boolean; // visual divider before Closet Expansion
}

export const ADDON_CATALOG: AddonDefinition[] = [
  { label: "StyleMe Pack",      description: "+5 StyleMe sessions",                               price: "AED 15" },
  { label: "VTO Pack",          description: "+10 Virtual Try-Ons",                               price: "AED 10" },
  { label: "Buy or Skip Pack",  description: "+5 checks",                                          price: "AED 10" },
  { label: "Trend Edit Add-on", description: "+1 Personalised Trend Edit",                        price: "AED 10" },
  { label: "nAia Boost",        description: "+5 StyleMe / +5 Buy or Skip / +10 VTO / +1 Trend Edit", price: "AED 25" },
  { label: "Closet Expansion",  description: "+100 Closet spaces",                                price: "AED 5/month", separator: true },
];

export function getMembershipAllowances(status: MembershipStatus): MembershipAllowances {
  return MEMBERSHIP_ALLOWANCES[status];
}

// Returns the effective VTO monthly limit for display and enforcement.
// STYLEME_MONTHLY_LIMIT_OVERRIDE overrides the membership's natural limit on staging.
// Production behavior is unchanged when the env var is absent.
export function getEffectiveVtoLimit(status: MembershipStatus): number {
  const override = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
  if (override) {
    const parsed = parseInt(override, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return MEMBERSHIP_ALLOWANCES[status].vtoPerMonth;
}

// Returns the effective StyleMe monthly limit for display and enforcement.
// STYLEME_MONTHLY_LIMIT_OVERRIDE overrides the membership's natural limit on staging.
// Production behavior is unchanged when the env var is absent.
export function getEffectiveStyleMeLimit(status: MembershipStatus): number {
  const override = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
  if (override) {
    const parsed = parseInt(override, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return MEMBERSHIP_ALLOWANCES[status].styleMePerMonth;
}
