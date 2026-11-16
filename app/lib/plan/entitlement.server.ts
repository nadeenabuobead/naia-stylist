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
// reserveClosetSlot, reserveStyleMeSlot, reserveBuySkipSlot, and the VTO/
// Trend-Edit checks are ALL unconditional, fail-closed enforcement — no
// feature's quota check is gated behind an environment flag. (Until
// 2026-11-12, four of the five were gated behind
// ENTITLEMENT_ENFORCEMENT === "true" with no other branch, so an unset/
// false flag silently skipped the check entirely — see
// fix/stripe-clerk-phase1-security for the fix and
// project_stripe_clerk_audit_2026_11_12 for how it was found.)
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
// This phase only made the window/allowance CALCULATION billing-aware; it
// did not touch which features were enforced. See the unconditional-
// enforcement note above for that separate, later fix.

import type { MembershipStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import prisma from "~/db.server";
import { getMembershipAllowances, getEffectiveVtoLimit, getEffectiveStyleMeLimit } from "./plan-limits.server";
import { getUsageWindow, formatResetDate, type SubscriptionWindowInput, type UsageWindow } from "./usage-window.server";
import { recordPersonalisedTrendEditUsage, type TrendEditSnapshot } from "./personalised-trend-edit-usage.server";
import { assertPublicIdAvailable, AssetPendingDeletionError } from "../cloudinary-deletion-claim.server";
import { FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES } from "../ai/full-look-handle-constants";
import { isTransientDatabaseError, DatabaseUnavailableError } from "../prisma-transient-retry.server";

// ── VTO stale threshold ────────────────────────────────────────────────────────
const VTO_IN_FLIGHT_STALE_MS = 10 * 60 * 1000; // 10 minutes

// ── Mock-VTO exclusion — reconciling two independent mechanisms ───────────────
// Wardrobe Intelligence's staging-only Full-Look VTO mock harness
// (poc-job-tracked-full-look-chain.server.ts, on a separate, as-yet-unmerged
// branch — integrate/wi-security-20261021, commit 4d896b1) marks its mock
// jobs by writing productHandle values prefixed "fulllook-poc:" — a
// namespace confirmed (independently re-verified here, not just taken on
// trust) to be written ONLY by that harness; no real customer-facing VTO
// path, api.trigger-tryon.tsx included, ever produces a handle with this
// shape, and a colon isn't even a valid character in a real Shopify product
// handle, so this can never collide with real data by construction.
//
// Phase 2 (this branch) independently introduced VirtualTryOnJob.isTest for
// the same purpose — a dedicated, explicit boolean, set server-side at job
// creation, rather than inferred from a naming convention on a field that
// exists for an unrelated reason. Both mechanisms now apply at every VTO
// quota-counting call site, OR'd together (a job is excluded if EITHER
// condition matches):
//   - the isTest column, required to be off: not yet set true anywhere (the
//     field defaults off and nothing flips it yet) — this is forward cover
//     for whenever a mock harness is built that marks the field directly.
//   - NOT productHandle startsWith "fulllook-poc:": excludes WI's EXISTING
//     mock jobs today, on this branch and after it merges, without
//     requiring WI's harness to change at all.
// This way: existing WI mock jobs remain excluded unconditionally (the
// productHandle filter alone guarantees it); a real customer's real usage
// is unaffected by either filter (neither pattern ever matches real data);
// and once the branches merge, WI's harness can be updated to ALSO flip the
// isTest column on (the more robust, explicit mechanism) without needing
// this file to change again — both conditions would simply agree.
const MOCK_VTO_PRODUCT_HANDLE_PREFIX = "fulllook-poc:";

// 2026-11-14 — Full-Look VTO charges exactly 1 credit per completed outfit
// (founder decision), not 1 per garment step. A full-look chain writes one
// VirtualTryOnJob row per garment (fulllook-real:step{1,2,3}:...) — only
// the FINAL step's row (step3) should ever count toward quota, identically
// to a single-item job. Steps 1 and 2 are internal chain bookkeeping
// (never a customer-facing preview — see full-look-tryon-real.server.ts's
// own intermediate-image comment) and must never be counted, in either
// direction: not toward vtoCompleted (a completed outfit must cost exactly
// 1, not 3) and not toward vtoInFlight (an in-flight intermediate step
// must not phantom-block the customer from starting anything else while
// their own chain is still only partway through). Imported (not
// redefined, see the import at the top of this file) from
// full-look-tryon-real.server.ts, which already owns the step-numbering
// convention — re-exported here too so existing test imports
// (`from "./entitlement.server"`) keep working.
export { FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES };

function excludingMockAndIntermediateFullLookHandles() {
  return [
    { productHandle: { startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX } },
    ...FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES.map((prefix) => ({ productHandle: { startsWith: prefix } })),
  ];
}

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

// PAST_DUE's grace period is 7 days — see the schema's PAST_DUE enum
// comment. This is enforced HERE, independently of the connected Stripe
// account's own dunning/retry schedule: Phase 3 security review (2026-11)
// found that nothing previously enforced this boundary, so a subscription
// could grant paid access for as long as Stripe kept retrying a failed
// renewal, including a "paid access, indefinitely" outcome if the account
// were ever configured with a very long or unlimited retry window. A
// PAST_DUE row whose grace period has elapsed is treated exactly as if it
// were EXPIRED — the stored status column is left as-is (no write here;
// this is a read-time filter, not a reconciliation job) and gets corrected
// for real the next time a webhook syncs this subscription.
const PAST_DUE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function isPastDueGraceExpired(pastDueSince: Date | null, now: Date = new Date()): boolean {
  if (!pastDueSince) return false;
  return now.getTime() - pastDueSince.getTime() > PAST_DUE_GRACE_PERIOD_MS;
}

// Customer-facing display only — never consulted for an access decision.
// By the time anything calls this, isPastDueGraceExpired has already run
// (inside getCurrentSubscription) and denied access if the grace period
// is over; this only turns the same already-elapsed duration into a
// "days left" figure for messaging. Returns null when not currently in a
// PAST_DUE grace period at all (no pastDueSince, or already expired).
export function getPastDueGraceDaysRemaining(pastDueSince: Date | null, now: Date = new Date()): number | null {
  if (!pastDueSince || isPastDueGraceExpired(pastDueSince, now)) return null;
  const remainingMs = PAST_DUE_GRACE_PERIOD_MS - (now.getTime() - pastDueSince.getTime());
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil(remainingMs / DAY_MS));
}

export type EntitledSubscription = {
  id: string;
  planType: "MONTHLY" | "ANNUAL";
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  status: SubscriptionStatus;
  // Display-only (see getPastDueGraceDaysRemaining) — never re-checked here
  // for an access decision; isPastDueGraceExpired below already made that
  // call before this object is ever returned.
  pastDueSince: Date | null;
};

// Looks up the customer's current entitled subscription, if any. Before
// Phase 3 (real billing), every customer has zero Subscription rows, so
// this returns null for everyone today — the richer behaviour below only
// activates once real or synthetic rows exist.
async function getCurrentSubscription(customerId: string): Promise<EntitledSubscription | null> {
  const sub = await prisma.subscription.findFirst({
    where: { customerId, status: { in: [...ENTITLED_SUBSCRIPTION_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, planType: true, currentPeriodStart: true, currentPeriodEnd: true, status: true, pastDueSince: true },
  });
  if (!sub) return null;
  if (sub.status === "PAST_DUE" && isPastDueGraceExpired(sub.pastDueSince)) {
    // Grace period elapsed — never grant paid access past this boundary,
    // regardless of what Stripe's own retry schedule is still doing.
    return null;
  }
  // Founder Decision 16 — a full refund of the customer's CURRENT period,
  // or a dispute lost against it, revokes access regardless of the
  // Subscription's own ACTIVE/PAST_DUE status column (webhook-handler.
  // server.ts's refund/dispute handling writes these independently of the
  // ordinary subscription-status sync, same relationship pastDueSince has
  // to this function). AccessRevocation is the correctness source of
  // truth — queried directly here (an indexed lookup), not via a
  // denormalized flag on Subscription: safely maintaining such a flag
  // under concurrent webhook deliveries (two independent revocation-
  // causing events landing near-simultaneously) would need its own proven-
  // atomic update path this implementation does not have, so the direct
  // query is correct by construction instead. Fail-closed by construction
  // for every paid feature: every entitlement entry point (checkEntitlement,
  // every reserve*Slot, getEntitlementSummary) calls resolveEffectiveContext,
  // which calls this function — there is no alternate path that could
  // bypass this check.
  const revoked = await prisma.accessRevocation.findFirst({
    where: { subscriptionId: sub.id, resolvedAt: null },
    select: { id: true },
  });
  if (revoked) return null;
  return sub;
}

// getCurrentSubscription only ever returns an ACTIVE/PAST_DUE row or null —
// it cannot distinguish "this customer has never had a Subscription row"
// from "this customer has a real Subscription row, but it's INCOMPLETE,
// CANCELED, or EXPIRED." Those two null-shaped outcomes must be treated
// differently below, so a separate existence check (any status, any row)
// is needed to tell them apart. A plain count — not a second findFirst — is
// enough since only existence, not the row's content, is needed here.
async function hasAnySubscriptionRecord(customerId: string): Promise<boolean> {
  const count = await prisma.subscription.count({ where: { customerId } });
  return count > 0;
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
  // The upper bound every QUOTA-COUNTING query must use in its createdAt
  // filter — NOT window.end. Financial-safety fix (2026-11): for a
  // subscription whose renewal has failed (PAST_DUE/"unpaid", within the
  // 7-day grace period), the provider does not advance currentPeriodEnd —
  // window.end stays frozen at the stale, already-elapsed boundary. Any
  // createdAt filter using window.end directly as `lt` would then exclude
  // EVERYTHING created from that point onward (today's new usage included)
  // from the count entirely, since it falls strictly AFTER that frozen
  // boundary — making quota enforcement silently unlimited for the entire
  // grace period, for any customer who had not already exhausted their
  // allowance before the renewal failed. countingEnd is never allowed to
  // fall behind "now": it is window.end when that's still in the future,
  // and "now" (plus 1ms, to keep the upper bound exclusive-safe) otherwise
  // — so new usage is always counted against the SAME allowance rather
  // than silently escaping it. Display (window.label/formatResetDate) and
  // add-on exact-period matching (addonAppliesToPeriodStart/End) must
  // keep using window.end itself, unchanged — only counting queries use
  // this field.
  countingEnd: Date;
  allowances: EffectiveAllowances;
  subscription: EntitledSubscription | null;
  // The membership status actually backed by a real, currently-entitled
  // Subscription row (or its absence) — same correction already applied to
  // `allowances` above, just no longer discarded after computing them. See
  // the two branches below for exactly when this diverges from the raw
  // `membershipStatus` parameter callers pass in: never when a real
  // ACTIVE/PAST_DUE subscription exists (this forces MEMBER even if the
  // cache says NONE, so a lagging cache can never under-grant a real
  // payer), and only trusts the raw cache as-is when there has NEVER been
  // any tracked Subscription row for this customer — a genuinely stale
  // cached MEMBER with a tracked-but-not-entitled row (INCOMPLETE/CANCELED/
  // EXPIRED) is always corrected to NONE here, exactly like `allowances`.
  effectiveMembershipStatus: MembershipStatus;
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
  hasAnySubscriptionRecord?: (customerId: string) => Promise<boolean>;
}

export async function resolveEffectiveContext(
  customerId: string,
  membershipStatus: MembershipStatus,
  deps: EffectiveContextDeps = {},
): Promise<EffectiveEntitlementContext> {
  const _getSubscription = deps.getSubscription ?? getCurrentSubscription;
  const _getAddonTotals = deps.getAddonTotals ?? getApplicableAddonTotals;
  const _hasAnySubscriptionRecord = deps.hasAnySubscriptionRecord ?? hasAnySubscriptionRecord;

  const subscription = await _getSubscription(customerId);
  const now = new Date();
  const window = getUsageWindow(toWindowInput(subscription), now);
  // See EffectiveEntitlementContext.countingEnd's own comment — never let
  // the counting upper bound fall behind "now".
  const countingEnd = window.end > now ? window.end : new Date(now.getTime() + 1);

  if (!subscription) {
    // Null here is ambiguous on its own (see hasAnySubscriptionRecord above)
    // — resolve it before trusting the cached membershipStatus. A customer
    // with a real, tracked Subscription row that simply isn't ACTIVE/PAST_DUE
    // (INCOMPLETE/CANCELED/EXPIRED) must be forced to the NONE-equivalent
    // allowance even if membershipStatus is still a stale cached MEMBER —
    // the Subscription row is the source of truth once it exists. Only a
    // customer with NO Subscription row at all gets to keep the pre-Phase-3
    // fallback of trusting membershipStatus as-is.
    const hasTrackedSubscription = await _hasAnySubscriptionRecord(customerId);
    const fallbackStatus: MembershipStatus = hasTrackedSubscription ? "NONE" : membershipStatus;
    const fallbackBase = getMembershipAllowances(fallbackStatus);
    return {
      window,
      countingEnd,
      subscription: null,
      allowances: {
        closetItems: fallbackBase.closetItems,
        styleMePerMonth: getEffectiveStyleMeLimit(fallbackStatus),
        buySkipPerMonth: fallbackBase.buySkipPerMonth,
        vtoPerMonth: getEffectiveVtoLimit(fallbackStatus),
        personalisedTrendPerMonth: fallbackBase.personalisedTrendPerMonth,
      },
      effectiveMembershipStatus: fallbackStatus,
    };
  }

  // Reached only when getCurrentSubscription found an ACTIVE/PAST_DUE row —
  // the real Subscription row already proves entitlement, regardless of
  // what the cache says. Correctness fix: the allowance lookups below now
  // actually honor that stated intent by using "MEMBER" directly rather
  // than the raw `membershipStatus` parameter — a lagging cache write
  // (e.g. membershipStatus still reads NONE immediately after a webhook
  // created the Subscription row but hasn't yet synced Customer) must
  // never under-grant a real payer their allowance, matching
  // effectiveMembershipStatus below exactly.
  const base = getMembershipAllowances("MEMBER");
  // Staging-only overrides (VTO_MONTHLY_LIMIT_OVERRIDE / STYLEME_MONTHLY_LIMIT_OVERRIDE)
  // apply to the base figure regardless of billing — they are a QA tool, not
  // a billing concept, and add-ons layer on top of whichever base is active.
  const effectiveStyleMeBase = getEffectiveStyleMeLimit("MEMBER");
  const effectiveVtoBase = getEffectiveVtoLimit("MEMBER");
  const addons = await _getAddonTotals(customerId, window);
  return {
    window,
    countingEnd,
    subscription,
    allowances: {
      closetItems: base.closetItems + addons.closetExpansion,
      styleMePerMonth: effectiveStyleMeBase + addons.styleMeBoost,
      buySkipPerMonth: base.buySkipPerMonth,
      vtoPerMonth: effectiveVtoBase + addons.vtoBoost,
      personalisedTrendPerMonth: base.personalisedTrendPerMonth,
    },
    // A real ACTIVE/PAST_DUE (within grace, not revoked — see
    // getCurrentSubscription) subscription was just found, so this customer
    // IS effectively a member regardless of what the cached column says —
    // never under-grant a real payer because of a lagging cache write.
    effectiveMembershipStatus: "MEMBER",
  };
}

// A customer's true membership state, corrected for a stale cached
// Customer.membershipStatus the same way `allowances`/`getEntitlementSummary`
// already are — exposed standalone, without the DB-logging/window-counting
// work full resolveEffectiveContext also does, for call sites that need only
// this one value (e.g. trends.my-edits.$slug.tsx picking which "blocked"
// message to show). Reuses resolveEffectiveContext's own single
// getCurrentSubscription/hasAnySubscriptionRecord lookup shape — no new
// query pattern.
export async function resolveEffectiveMembershipStatus(
  customerId: string,
  membershipStatus: MembershipStatus,
  deps: EffectiveContextDeps = {},
): Promise<MembershipStatus> {
  const { effectiveMembershipStatus } = await resolveEffectiveContext(customerId, membershipStatus, deps);
  return effectiveMembershipStatus;
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
  // See EffectiveEntitlementContext.effectiveMembershipStatus — this is
  // that same corrected value, surfaced here so membership-gated UI can
  // stop reading the raw, potentially-stale `membershipStatus` field above
  // directly. `membershipStatus` itself is left unchanged/still returned
  // for any caller that genuinely wants the raw cached column.
  effectiveMembershipStatus: MembershipStatus;
  styleMe: StyleMeEntitlement;
  buySkip: BuySkipEntitlement;
  vto: VTOEntitlement;
  closet: ClosetEntitlement;
  personalisedTrend: PersonalisedTrendEntitlement;
  windowLabel: string;
  // Non-null only while a renewal payment has failed and the 7-day grace
  // period (PAST_DUE_GRACE_PERIOD_MS) hasn't elapsed, OR a Checkout attempt
  // via an asynchronous payment method (e.g. a bank debit) is still waiting
  // to clear — purely informational, for Plan & Usage messaging. Access
  // itself was already decided before this summary is built (see
  // getCurrentSubscription, which never returns an INCOMPLETE row at all);
  // this field never feeds back into any entitlement check. PAYMENT_PENDING
  // is for a RETURNING visit with no checkout= redirect param — the one-time
  // redirect banner (my-naia.plan-usage.tsx's own checkoutOutcome) already
  // covers the immediate post-checkout case on its own.
  billingAlert: { status: "PAST_DUE"; graceDaysRemaining: number } | { status: "PAYMENT_PENDING" } | null;
  // Whether this customer has a real Stripe billing relationship to
  // manage — a Subscription row (any status) with a providerCustomerId —
  // computed with the EXACT same check api.billing-portal.tsx itself
  // performs before opening the portal, so this field and that route's
  // own no_billing_account outcome can never disagree. Deliberately
  // independent of effectiveMembershipStatus/membershipStatus above: a
  // customer can be entitled with no billing account to manage (a stale
  // cache with no real subscription — the Subscribe-vs-Manage bug this
  // field exists to close) or have a real billing account with no CURRENT
  // entitlement (e.g. a canceled subscription they may still want to view
  // invoices for, or resume). Subscribe-vs-Manage-Membership must be
  // decided from THIS field, never from membership tier.
  hasBillingAccount: boolean;
}

// Mirrors api.billing-portal.tsx's own eligibility check exactly (most
// recent Subscription row, any status, non-null providerCustomerId) — a
// separate dedicated query, not reused from resolveEffectiveContext's
// `subscription`, because that one is deliberately restricted to
// ACTIVE/PAST_DUE-and-not-revoked and would miss a real billing account
// behind a CANCELED/EXPIRED/INCOMPLETE subscription.
async function defaultFindMostRecentProviderCustomerId(customerId: string): Promise<string | null> {
  const sub = await prisma.subscription.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { providerCustomerId: true },
  });
  return sub?.providerCustomerId ?? null;
}

export async function hasManageableBillingAccount(
  customerId: string,
  deps: { findMostRecentProviderCustomerId?: (customerId: string) => Promise<string | null> } = {},
): Promise<boolean> {
  const find = deps.findMostRecentProviderCustomerId ?? defaultFindMostRecentProviderCustomerId;
  return (await find(customerId)) !== null;
}

// ── Main function ──────────────────────────────────────────────────────────────

export async function getEntitlementSummary(
  customerId: string,
  membershipStatus: MembershipStatus,
  _contextDeps: EffectiveContextDeps = {},
  _billingAccountDeps: { findMostRecentProviderCustomerId?: (customerId: string) => Promise<string | null> } = {},
): Promise<EntitlementSummary> {
  const { window, countingEnd, allowances, subscription, effectiveMembershipStatus } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
  const hasBillingAccount = await hasManageableBillingAccount(customerId, _billingAccountDeps);
  // getCurrentSubscription (inside resolveEffectiveContext) only ever
  // returns an ACTIVE/PAST_DUE row — an INCOMPLETE one (a Checkout attempt
  // via an asynchronous payment method still waiting to clear) is
  // deliberately invisible to it, since it must never grant access. This
  // is the one place that INCOMPLETE state gets surfaced anyway, purely
  // for messaging — only queried when there's no already-entitled
  // subscription, keeping the common (ACTIVE/PAST_DUE/no-subscription-at-
  // all) case at zero extra queries.
  const pendingAsyncPayment = subscription
    ? null
    : await prisma.subscription.findFirst({
        where: { customerId, status: "INCOMPLETE" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
  const billingAlert: EntitlementSummary["billingAlert"] =
    subscription?.status === "PAST_DUE"
      ? { status: "PAST_DUE", graceDaysRemaining: getPastDueGraceDaysRemaining(subscription.pastDueSince) ?? 0 }
      : pendingAsyncPayment
      ? { status: "PAYMENT_PENDING" }
      : null;
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

  // StyleMe: qualifying root sessions in current window. Uses countingEnd,
  // not window.end — see EffectiveEntitlementContext.countingEnd: every
  // OTHER function in this file already reads through countingEnd, which
  // this one had not yet been updated to match until this merge.
  const monthlyQualifyingCount = await prisma.stylingSession.count({
    where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: countingEnd } },
  });

  // BuySkip: usable analyses in current window
  const monthlyBuySkipUsed = await prisma.buyOrSkipAnalysis.count({
    where: {
      customerId,
      verdict: { in: ["BUY", "SKIP", "MAYBE"] },
      createdAt: { gte: window.start, lt: countingEnd },
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
      createdAt: { gte: window.start, lt: countingEnd },
      NOT: excludingMockAndIntermediateFullLookHandles(),
    },
  });

  // VTO: genuinely active in-flight jobs (not stale, not a test job)
  const vtoInFlight = await prisma.virtualTryOnJob.count({
    where: {
      customerId,
      status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
      isTest: false,
      lastActivityAt: { gte: staleThreshold },
      NOT: excludingMockAndIntermediateFullLookHandles(),
    },
  });

  // Closet: hard-delete model — every row is an active item
  const closetCount = await prisma.closetItem.count({ where: { customerId } });

  // Personalised Trend Edit: completed-edit usage rows in current window.
  // PersonalisedTrendEditUsage is the customer entitlement/usage source of
  // truth — JourneyEvent's trend_edit_generated is analytics-only and is
  // never read here.
  const monthlyPersonalisedTrendUsed = await prisma.personalisedTrendEditUsage.count({
    where: { customerId, createdAt: { gte: window.start, lt: countingEnd } },
  });

  return {
    membershipStatus,
    effectiveMembershipStatus,
    hasBillingAccount,
    windowLabel: window.label,
    billingAlert,

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
  const { window, countingEnd, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
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
        where: { ...qualifyingStyleMeWhere(customerId), createdAt: { gte: window.start, lt: countingEnd } },
      });
      if (monthlyUsed < allowances.styleMePerMonth) return { allowed: true };
      return { allowed: false, reason: "quota_exceeded" };
    }

    case "buySkip": {
      const count = await prisma.buyOrSkipAnalysis.count({
        where: {
          customerId,
          verdict: { in: ["BUY", "SKIP", "MAYBE"] },
          createdAt: { gte: window.start, lt: countingEnd },
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
            NOT: excludingMockAndIntermediateFullLookHandles(),
            createdAt: { gte: window.start, lt: countingEnd },
          },
        }),
        prisma.virtualTryOnJob.count({
          where: {
            customerId,
            status: { in: ["CREATED", "SUBMITTED", "PROCESSING"] },
            isTest: false,
            lastActivityAt: { gte: staleThreshold },
            NOT: excludingMockAndIntermediateFullLookHandles(),
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
        where: { customerId, createdAt: { gte: window.start, lt: countingEnd } },
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
// before either commits. Every route calls this unconditionally now — see
// the fail-closed note at the top of this file.
//
// A P2002 (unique constraint — e.g. BuySkip's idempotencyKey) is NOT caught
// here; it propagates so the caller's own existing idempotent-repeat handling
// (already required to exist for duplicate submissions) runs unchanged.

export type RunReservationFn = <T>(
  fn: (tx: Pick<typeof prisma, "stylingSession" | "buyOrSkipAnalysis" | "closetItem" | "personalisedTrendEditUsage" | "pendingCloudinaryDeletion">) => Promise<T>,
) => Promise<T>;

const _runReservationTransaction: RunReservationFn = (fn) =>
  prisma.$transaction(
    (tx: Pick<typeof prisma, "stylingSession" | "buyOrSkipAnalysis" | "closetItem" | "personalisedTrendEditUsage" | "pendingCloudinaryDeletion">) => fn(tx),
    { isolationLevel: "Serializable" },
  );

export type ReserveResult<T> =
  | { allowed: true; record: T }
  | { allowed: false; reason: "quota_exceeded" | "at_capacity" | "asset_pending_deletion" };

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
  const { window, countingEnd, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
  const effectiveLimit = allowances.styleMePerMonth;
  const qualifyingWhere = qualifyingStyleMeWhere(customerId);

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        const used = await tx.stylingSession.count({
          where: { ...qualifyingWhere, createdAt: { gte: window.start, lt: countingEnd } },
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

// Closes a real, found-not-hypothetical race (2026-11-04 review): the
// monthly Personalised Trend Edit allowance is ONE, ACCOUNT-WIDE ACROSS
// EVERY REPORT (checkEntitlement's own "personalisedTrend" count has no
// reportSlug filter — see trends.my-edits.$slug.tsx's own comment on why).
// PersonalisedTrendEditUsage's @@unique([customerId, reportSlug, periodKey])
// constraint only ever protected a DIFFERENT race — a duplicate submission
// for the SAME report — and recordPersonalisedTrendEditUsage's own doc
// comment said exactly that constraint was "the final authority," which is
// true for that race and not this one. Two concurrent generations for TWO
// DIFFERENT reports in the same period both pass checkEntitlement's
// non-atomic count check and both write successfully — the unique
// constraint never conflicts between them, so nothing stops a second edit
// this function wasn't entitled to.
export async function reservePersonalisedTrendSlot(
  customerId: string,
  membershipStatus: MembershipStatus,
  reportSlug: string,
  snapshot?: TrendEditSnapshot,
  _runTransaction: RunReservationFn = _runReservationTransaction,
  _contextDeps: EffectiveContextDeps = {},
): Promise<ReserveResult<Awaited<ReturnType<typeof recordPersonalisedTrendEditUsage>>>> {
  const { window, countingEnd, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
  if (allowances.personalisedTrendPerMonth <= 0) return { allowed: false, reason: "quota_exceeded" };

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        // Account-wide — no reportSlug filter — matching checkEntitlement's
        // own count exactly, not the narrower per-report uniqueness
        // recordPersonalisedTrendEditUsage's own constraint protects.
        const used = await tx.personalisedTrendEditUsage.count({
          where: { customerId, createdAt: { gte: window.start, lt: countingEnd } },
        });
        if (used >= allowances.personalisedTrendPerMonth) {
          return { allowed: false, reason: "quota_exceeded" };
        }
        // Delegates the actual write to the one canonical writer, passing
        // this transaction's own client — a genuinely concurrent duplicate
        // for THIS exact report+period still resolves through its upsert
        // to the existing row, not a thrown P2002 or a second row. Same
        // idempotency contract as before, now inside the same transaction
        // that also closes the account-wide quota race.
        const record = await recordPersonalisedTrendEditUsage(customerId, reportSlug, snapshot, tx);
        return { allowed: true, record };
      });
    } catch (e) {
      if (isSerializationError(e) && attempt < MAX_TX_RETRIES) continue;
      throw e;
    }
  }
  // Unreachable — loop always returns or throws.
  throw new Error("Unexpected exit from reservePersonalisedTrendSlot retry loop");
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
  const { window, countingEnd, allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);

  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      return await _runTransaction(async (tx) => {
        const used = await tx.buyOrSkipAnalysis.count({
          where: {
            customerId,
            verdict: { in: ["BUY", "SKIP", "MAYBE"] },
            createdAt: { gte: window.start, lt: countingEnd },
          },
        });
        if (used >= allowances.buySkipPerMonth) {
          return { allowed: false, reason: "quota_exceeded" };
        }
        // Must run LAST, inside this same Serializable transaction — see
        // cloudinary-deletion-claim.server.ts for why checking this earlier,
        // or outside the transaction, would reopen the exact race it closes.
        try {
          await assertPublicIdAvailable(tx, analysisData.imagePublicId);
        } catch (e) {
          if (e instanceof AssetPendingDeletionError) return { allowed: false, reason: "asset_pending_deletion" };
          throw e;
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
  // Closet capacity has always been unconditional (a storage cap, not a
  // trial gate — see closet._index.tsx), so this runs
  // resolveEffectiveContext's extra subscription lookup on every closet
  // upload — one cheap, indexed findFirst, accepted as the
  // cost of correctly layering in cumulative Closet-expansion add-ons here.
  // A lapsed/canceled subscription falls back to the bare base allowance
  // (0 for NONE) via the same branch that drops the add-on boost — the cap
  // can drop, but nothing here ever deletes an existing ClosetItem; it only
  // ever gates NEW creates, exactly as before Phase 2.
  //
  // Both resolveEffectiveContext and the transaction below now run inside
  // the same per-attempt try block, and the catch retries on a transient
  // connection failure (P2024 pool-exhaustion, etc. — see
  // prisma-transient-retry.server.ts) as well as a P2034 serialization
  // conflict. This is safe to retry from scratch in both cases: a P2024
  // means Prisma failed to even acquire a connection, so neither
  // resolveEffectiveContext's read nor any statement inside the
  // transaction callback ran — there is nothing to duplicate.
  for (let attempt = 0; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      const { allowances } = await resolveEffectiveContext(customerId, membershipStatus, _contextDeps);
      return await _runTransaction(async (tx) => {
        // Closet is a hard-delete model — every row is an active item, no
        // window filter (matches checkEntitlement's "closet" case and
        // getEntitlementSummary's own count exactly).
        const used = await tx.closetItem.count({ where: { customerId } });
        if (used >= allowances.closetItems) {
          return { allowed: false, reason: "at_capacity" };
        }
        // Must run LAST, inside this same Serializable transaction — see
        // cloudinary-deletion-claim.server.ts.
        try {
          await assertPublicIdAvailable(tx, itemData.imagePublicId as string | undefined);
        } catch (e) {
          if (e instanceof AssetPendingDeletionError) return { allowed: false, reason: "asset_pending_deletion" };
          throw e;
        }
        const record = await tx.closetItem.create({ data: itemData });
        return { allowed: true, record };
      });
    } catch (e) {
      if ((isSerializationError(e) || isTransientDatabaseError(e)) && attempt < MAX_TX_RETRIES) continue;
      if (isTransientDatabaseError(e)) throw new DatabaseUnavailableError(e);
      throw e;
    }
  }
  throw new Error("Unexpected exit from reserveClosetSlot retry loop");
}
