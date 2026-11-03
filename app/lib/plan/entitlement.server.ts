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
//
// Phase 2 (billing-cycle-aware windows + add-on entitlements): every
// function below now resolves its window and allowances through
// resolveEffectiveContext(), which looks up the customer's current
// ENTITLED subscription (ACTIVE/PAST_DUE only — see
// isSubscriptionStatusEntitled) and, only when one exists, layers on
// applicable add-on grants. For a customer with no such subscription —
// which, before Phase 3's real billing wiring, is every customer — this
// resolves to EXACTLY today's behaviour: the calendar-month window and the
// bare membership allowance, no add-ons. Nothing here changes behaviour
// until real or synthetic Subscription/BillingTransaction rows exist.
// ENTITLEMENT_ENFORCEMENT itself is untouched — this phase only makes the
// window/allowance CALCULATION billing-aware, it does not change which
// features are gated behind the flag today.

import type { MembershipStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import prisma from "~/db.server";
import { getMembershipAllowances, getEffectiveVtoLimit, getEffectiveStyleMeLimit } from "./plan-limits.server";
import { getUsageWindow, formatResetDate, type SubscriptionWindowInput, type UsageWindow } from "./usage-window.server";

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

// ── Subscription resolution (Phase 2) ───────────────────────────────────────────
// A subscription is entitled — eligible to influence allowance/window
// calculation at all — only in these two statuses. INCOMPLETE (checkout
// started, no confirmed payment), CANCELED (ended), and EXPIRED must all be
// treated as "no subscription" by every function below, exactly as if the
// customer had never subscribed. PAST_DUE is included deliberately: the
// approved 7-day grace period for a failed renewal retains access.
const ENTITLED_SUBSCRIPTION_STATUSES = ["ACTIVE", "PAST_DUE"] as const satisfies readonly SubscriptionStatus[];

export function isSubscriptionStatusEntitled(status: SubscriptionStatus): boolean {
  return (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

export type EntitledSubscription = {
  id: string;
  planType: "MONTHLY" | "ANNUAL";
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  status: SubscriptionStatus;
};

// Looks up the customer's current entitled subscription, if any. Before
// Phase 3 (real billing), every customer has zero Subscription rows, so
// this returns null for everyone today — the richer behaviour below only
// activates once real or synthetic rows exist.
async function getCurrentSubscription(customerId: string): Promise<EntitledSubscription | null> {
  return prisma.subscription.findFirst({
    where: { customerId, status: { in: [...ENTITLED_SUBSCRIPTION_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, planType: true, currentPeriodStart: true, currentPeriodEnd: true, status: true },
  });
}

// Narrows a Subscription record to what getUsageWindow needs. A null
// currentPeriodStart/End can't actually occur for an ACTIVE/PAST_DUE row in
// practice (those dates are set on first payment confirmation, before
// status ever becomes ACTIVE) — handled defensively anyway, falling back
// to the calendar-month window rather than crashing on a malformed record.
function toWindowInput(subscription: EntitledSubscription | null): SubscriptionWindowInput | null {
  if (!subscription || !subscription.currentPeriodStart || !subscription.currentPeriodEnd) return null;
  return {
    planType: subscription.planType,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}

// ── Add-on totals (Phase 2) ──────────────────────────────────────────────────────
// StyleMe/VTO boosts are one-time, current-usage-period-only top-ups — an
// EXACT match against the resolved window's own start/end, not a loose
// date-range overlap, so a boost bought for a different period can never
// silently apply to this one. Closet expansions are cumulative and
// permanent while membership is active — no period filter at all, matching
// addonAppliesToPeriodStart/End being left null on those rows.
export interface AddonTotals {
  styleMeBoost: number;
  vtoBoost: number;
  closetExpansion: number;
}

async function getApplicableAddonTotals(customerId: string, window: UsageWindow): Promise<AddonTotals> {
  const [styleMe, vto, closet] = await Promise.all([
    prisma.billingTransaction.aggregate({
      where: {
        customerId,
        type: "ADDON_STYLEME_BOOST",
        status: "SUCCEEDED",
        addonAppliesToPeriodStart: window.start,
        addonAppliesToPeriodEnd: window.end,
      },
      _sum: { addonQuantityGranted: true },
    }),
    prisma.billingTransaction.aggregate({
      where: {
        customerId,
        type: "ADDON_VTO_BOOST",
        status: "SUCCEEDED",
        addonAppliesToPeriodStart: window.start,
        addonAppliesToPeriodEnd: window.end,
      },
      _sum: { addonQuantityGranted: true },
    }),
    prisma.billingTransaction.aggregate({
      where: { customerId, type: "ADDON_CLOSET_EXPANSION", status: "SUCCEEDED" },
      _sum: { addonQuantityGranted: true },
    }),
  ]);
  return {
    styleMeBoost: styleMe._sum.addonQuantityGranted ?? 0,
    vtoBoost: vto._sum.addonQuantityGranted ?? 0,
    closetExpansion: closet._sum.addonQuantityGranted ?? 0,
  };
}

// ── Effective allowances (Phase 2) ──────────────────────────────────────────────
// Base membership allowance, boosted by add-ons — but ONLY while the
// customer's subscription is genuinely entitled (getCurrentSubscription
// already filters to ACTIVE/PAST_DUE, so reaching the add-on branch below
// at all already proves entitlement). An expired, canceled, or
// never-confirmed subscription gets the bare base allowance (0 for NONE)
// regardless of any add-on purchased in the past — add-ons boost an active
// membership, they do not survive past it and never substitute for one.
// This is what keeps requirement 7 true even for a customer with add-on
// history: losing the subscription loses the boost along with the base
// allowance, in the same step, because both come from the same branch.
export interface EffectiveAllowances {
  closetItems: number;
  styleMePerMonth: number;
  buySkipPerMonth: number;
  vtoPerMonth: number;
  personalisedTrendPerMonth: number;
}

export interface EffectiveEntitlementContext {
  window: UsageWindow;
  allowances: EffectiveAllowances;
  subscription: EntitledSubscription | null;
}

// DI surface for resolveEffectiveContext and everything that calls it —
// mirrors the existing _runTransaction convention (RunReservationFn) rather
// than introducing a second, differently-shaped pattern. Every public
// function below threads this through as one optional trailing parameter,
// defaulting to the real Prisma-backed implementations, so every existing
// caller (routes, and every pre-Phase-2 test exercising these functions
// with a mocked _runTransaction) is completely unaffected — they simply
// never pass it, and get real subscription/add-on lookups exactly as they
// would without this parameter existing.
export interface EffectiveContextDeps {
  getSubscription?: (customerId: string) => Promise<EntitledSubscription | null>;
  getAddonTotals?: (customerId: string, window: UsageWindow) => Promise<AddonTotals>;
}

export async function resolveEffectiveContext(
  customerId: string,
  membershipStatus: MembershipStatus,
  deps: EffectiveContextDeps = {},
): Promise<EffectiveEntitlementContext> {
  const _getSubscription = deps.getSubscription ?? getCurrentSubscription;
  const _getAddonTotals = deps.getAddonTotals ?? getApplicableAddonTotals;

  const subscription = await _getSubscription(customerId);
  const window = getUsageWindow(toWindowInput(subscription));
  const base = getMembershipAllowances(membershipStatus);
  // Staging-only overrides (VTO_MONTHLY_LIMIT_OVERRIDE / STYLEME_MONTHLY_LIMIT_OVERRIDE)
  // apply to the base figure regardless of billing — they are a QA tool, not
  // a billing concept, and add-ons layer on top of whichever base is active.
  const effectiveStyleMeBase = getEffectiveStyleMeLimit(membershipStatus);
  const effectiveVtoBase = getEffectiveVtoLimit(membershipStatus);

  if (!subscription) {
    return {
      window,
      subscription: null,
      allowances: {
        closetItems: base.closetItems,
        styleMePerMonth: effectiveStyleMeBase,
        buySkipPerMonth: base.buySkipPerMonth,
        vtoPerMonth: effectiveVtoBase,
        personalisedTrendPerMonth: base.personalisedTrendPerMonth,
      },
    };
  }

  const addons = await _getAddonTotals(customerId, window);
  return {
    window,
    subscription,
    allowances: {
      closetItems: base.closetItems + addons.closetExpansion,
      styleMePerMonth: effectiveStyleMeBase + addons.styleMeBoost,
      buySkipPerMonth: base.buySkipPerMonth,
      vtoPerMonth: effectiveVtoBase + addons.vtoBoost,
      personalisedTrendPerMonth: base.personalisedTrendPerMonth,
    },
  };
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
  _contextDeps: EffectiveContextDeps = {},
): Promise<EntitlementSummary> {
  const { window, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
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

  // VTO: completed jobs in current window. isTest excludes the proper,
  // schema-level test-job flag; the productHandle prefix exclusion is the
  // older, staging-only mock-harness heuristic — kept alongside rather than
  // dropped here, since reconciling whether one supersedes the other is a
  // separate, later concern (not decided by this merge).
  const vtoCompleted = await prisma.virtualTryOnJob.count({
    where: {
      customerId,
      status: "COMPLETED",
      isTest: false,
      createdAt: { gte: window.start, lt: window.end },
      NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
    },
  });

  // VTO: genuinely active in-flight jobs (not stale, not a test job)
  const vtoInFlight = await prisma.virtualTryOnJob.count({
    where: {
      customerId,
      status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
      isTest: false,
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
      monthlyLimit: allowances.styleMePerMonth,
      monthlyUsed: monthlyQualifyingCount,
      resetDate,
    },

    buySkip: {
      monthlyLimit: allowances.buySkipPerMonth,
      monthlyUsed: monthlyBuySkipUsed,
      resetDate,
    },

    vto: {
      monthlyLimit: allowances.vtoPerMonth,
      monthlyCompleted: vtoCompleted,
      monthlyInFlight: vtoInFlight,
      resetDate,
    },

    closet: {
      currentCount: closetCount,
      limit: allowances.closetItems,
      atCapacity: closetCount >= allowances.closetItems,
    },

    personalisedTrend: {
      // monthlyUsed is a real count (PersonalisedTrendEditUsage), not the
      // null the incoming commit's own "V1: enforcement deferred" stance
      // predates — that table and its tracking query exist now (see
      // monthlyPersonalisedTrendUsed above). allowances, not limits — this
      // function's own resolveEffectiveContext destructure never declares
      // a `limits` binding.
      monthlyLimit: allowances.personalisedTrendPerMonth,
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
  _contextDeps: EffectiveContextDeps = {},
): Promise<EntitlementCheck> {
  const { window, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
  const staleThreshold = new Date(Date.now() - VTO_IN_FLIGHT_STALE_MS);

  switch (feature) {
    case "closet": {
      const count = await prisma.closetItem.count({
        where: {
          customerId,
          ...(options?.excludeItemId ? { id: { not: options.excludeItemId } } : {}),
        },
      });
      if (count >= allowances.closetItems) return { allowed: false, reason: "at_capacity" };
      return { allowed: true };
    }

    case "styleMe": {
      const monthlyUsed = await prisma.stylingSession.count({
        where: { ...qualifyingStyleMeWhere(customerId), createdAt: { gte: window.start, lt: window.end } },
      });
      if (monthlyUsed < allowances.styleMePerMonth) return { allowed: true };
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
      if (count >= allowances.buySkipPerMonth) return { allowed: false, reason: "quota_exceeded" };
      return { allowed: true };
    }

    case "vto": {
      const [completed, inFlight] = await Promise.all([
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: "COMPLETED",
            isTest: false,
            createdAt: { gte: window.start, lt: window.end },
            NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
          },
        }),
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
            isTest: false,
            lastActivityAt: { gte: staleThreshold },
            NOT: { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
          },
        }),
      ]);
      if (completed + inFlight >= allowances.vtoPerMonth) {
        return { allowed: false, reason: "quota_exceeded" };
      }
      return { allowed: true };
    }

    case "personalisedTrend": {
      // Binary membership short-circuit first — NONE has zero allowance
      // regardless of usage, same as every other feature's zero-limit case.
      if (allowances.personalisedTrendPerMonth <= 0) return { allowed: false, reason: "quota_exceeded" };
      // Real count against PersonalisedTrendEditUsage — the customer
      // entitlement/usage source of truth. JourneyEvent is never read here.
      const count = await prisma.personalisedTrendEditUsage.count({
        where: { customerId, createdAt: { gte: window.start, lt: window.end } },
      });
      if (count >= allowances.personalisedTrendPerMonth) return { allowed: false, reason: "quota_exceeded" };
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
  _contextDeps: EffectiveContextDeps = {},
): Promise<ReserveResult<Awaited<ReturnType<typeof prisma.stylingSession.create>>>> {
  // Resolved once, before the retry loop — same shape as before Phase 2
  // (the base allowance/window were already computed once up front); the
  // addition here is that the resolution itself can now include a billing-
  // cycle window and add-on boost. A concurrent add-on purchase landing in
  // the same instant as a reservation attempt is not specially guarded —
  // that's no different from a concurrent membership change mid-reservation,
  // which this design never tried to close atomically either; the actual
  // race this function exists to close is the count-vs-limit race, below.
  const { window, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
  const effectiveLimit = allowances.styleMePerMonth;
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
  _contextDeps: EffectiveContextDeps = {},
): Promise<ReserveResult<Awaited<ReturnType<typeof prisma.buyOrSkipAnalysis.create>>>> {
  // No add-on type exists for Buy or Skip in the approved catalog (StyleMe,
  // VTO, and Closet are the only add-ons) — allowances.buySkipPerMonth is
  // always just the base membership figure, resolved the same way as
  // before Phase 2, just now through the shared resolver.
  const { window, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);

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
        if (used >= allowances.buySkipPerMonth) {
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
  _contextDeps: EffectiveContextDeps = {},
): Promise<ReserveResult<Awaited<ReturnType<typeof prisma.closetItem.create>>>> {
  // Closet capacity is unconditional (not behind ENTITLEMENT_ENFORCEMENT),
  // so this now runs resolveEffectiveContext's extra subscription lookup on
  // every closet upload — one cheap, indexed findFirst, accepted as the
  // cost of correctly layering in cumulative Closet-expansion add-ons here.
  // A lapsed/canceled subscription falls back to the bare base allowance
  // (0 for NONE) via the same branch that drops the add-on boost — the cap
  // can drop, but nothing here ever deletes an existing ClosetItem; it only
  // ever gates NEW creates, exactly as before Phase 2.
  const { allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        // Closet is a hard-delete model — every row is an active item, no
        // window filter (matches checkEntitlement's "closet" case and
        // getEntitlementSummary's own count exactly).
        const used = await tx.closetItem.count({ where: { customerId } });
        if (used >= allowances.closetItems) {
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
