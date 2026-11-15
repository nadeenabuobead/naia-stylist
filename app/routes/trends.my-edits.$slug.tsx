import { useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useFetcher, redirect, data } from "react-router";
import type { MembershipStatus } from "@prisma/client";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import type { TrendReportData } from "~/lib/trend-reports";
import {
  getEditorialReportBySlug,
  getPublishedEditorialReports,
} from "~/lib/editorial-reports.server";
import {
  getEffectiveEditionPeriod,
  formatEditionMonthLabel,
  getEditionNumberMap,
  formatEditionNumber,
} from "~/lib/editorial-report-edition";
import {
  getShopperEvidence,
  buildShopperEdit,
  hydrateShopperEditImages,
  type ShopperEdit,
} from "~/lib/trend-evidence.server";
import {
  matchNadineProduct,
  type NadineProductRecommendation,
} from "~/lib/trend-product-recommendation.server";
import { checkEntitlement, reservePersonalisedTrendSlot, resolveEffectiveMembershipStatus, type EntitlementCheck } from "~/lib/plan/entitlement.server";
import {
  getTrendEditUsageState,
  getMostRecentArchivedSnapshot,
  type TrendEditSnapshot,
} from "~/lib/plan/personalised-trend-edit-usage.server";
import { getUsageWindow } from "~/lib/plan/usage-window.server";
import {
  emitTrendEditGenerated,
  recordJourneyEventAwaited,
  hashCustomerId,
} from "~/lib/ai/journey-events.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import TrendEditReportBody, { TREND_EDIT_REPORT_BODY_CSS } from "~/components/trends/TrendEditReportBody";
import naiaStyles from "~/styles/naia-design-system.css?url";

type LoaderData = {
  report: TrendReportData;
  edit: ShopperEdit | null;
  hasProfile: boolean;
  generationFailed: boolean;
  nadineRecommendation: NadineProductRecommendation | null;
  reportIndex: number;
  /** Real chronological edition number (01 = earliest edition period
   *  among all published reports) — same numbering as the public Trend
   *  Reports pages, never derived from reportIndex. */
  editionNumber: number | null;
  /** Customer has no personalised-trend entitlement at all (never a member,
   *  or a membership tier with a zero allowance) — show the membership
   *  upsell. Mutually exclusive with monthlyQuotaExhausted; see
   *  resolveTrendEditBlockState for how the two are told apart. */
  membershipRequired: boolean;
  /** Customer IS entitled, but has already used this period's one
   *  Personalised Trend Edit — on ANY report, since the allowance is
   *  account-wide, not per-report (see checkEntitlement's personalisedTrend
   *  case). Must never show the membership upsell to a customer who is
   *  already a member. */
  monthlyQuotaExhausted: boolean;
  /** A generation happened this period, but predates snapshot persistence —
   *  its exact content was never captured. Never regenerated, never
   *  backfilled — see getTrendEditUsageState. */
  historicalUnavailable: boolean;
  /** Set when `edit` is the customer's own archive from an earlier period —
   *  nothing was generated yet this period, so getMostRecentArchivedSnapshot
   *  supplied this instead of a fresh generation. Reopening it never writes,
   *  never regenerates, and never counts against this period's allowance.
   *  The customer can still explicitly generate a fresh edit for the
   *  current period via the "generate-new" action below. */
  archivedPeriodLabel: string | null;
};

/**
 * Tells a genuinely non-member apart from a MEMBER who has simply used this
 * period's one allowance — checkEntitlement's personalisedTrend case returns
 * the SAME reason ("quota_exceeded") for both a zero-allowance NONE customer
 * and a MEMBER whose count has reached their limit of 1 (see
 * entitlement.server.ts's `limits.personalisedTrendPerMonth <= 0` short
 * circuit), so the reason string alone cannot distinguish them — membership
 * status is the only reliable signal.
 *
 * "at_capacity" is a distinct EntitlementCheck reason used by other features
 * (e.g. closet) — personalisedTrend's own switch case never actually returns
 * it today, so this branch is defensive only. If it ever did, this routes it
 * explicitly to the same monthly-allowance state rather than letting it fall
 * through unexamined: a MEMBER blocked for any reason must never see the
 * membership upsell, since they already have the membership it's asking them
 * to join.
 */
function resolveTrendEditBlockState(
  membershipStatus: MembershipStatus,
  reason: EntitlementCheck["reason"],
): "membership_required" | "monthly_quota_exhausted" {
  if (membershipStatus !== "MEMBER") return "membership_required";
  void reason; // every reason a MEMBER can be blocked for maps to the same message today
  return "monthly_quota_exhausted";
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap",
  },
];

export function meta({ data }: { data?: LoaderData }) {
  if (!data?.report) return [{ title: "Report Not Found | My nAia" }];
  return [{ title: `My Edit — ${data.report.title} | My nAia` }];
}

// Generates (or re-generates, for the explicit "generate-new" action) a
// fresh edit from CURRENT Passport/Closet state and records it as this
// period's usage row. Shared by the loader's auto-generate-on-first-view
// path (no archive exists yet for this report) and the action's explicit
// "generate this month's edit" path (an archive exists, but the customer
// chose to produce a new one anyway) — the generation + write logic must
// never diverge between the two callers.
async function generateAndRecordEdit(
  customer: { id: string; membershipStatus: MembershipStatus },
  report: TrendReportData,
): Promise<{
  edit: ShopperEdit | null;
  nadineRecommendation: NadineProductRecommendation | null;
  hasProfile: boolean;
  generationFailed: boolean;
}> {
  try {
    const evidence = await getShopperEvidence(customer.id);
    const rawEdit = evidence.hasProfile ? buildShopperEdit(report, evidence) : null;
    const nadineRecommendation =
      rawEdit ? matchNadineProduct(report, evidence, rawEdit) : null;

    // For Modern Tailoring: when the shopper's only closet evidence is a TOP
    // (the softer counterpart) and a NADINE piece fills the missing tailored
    // anchor, name the product directly in the Look To Try so the outfit
    // formula matches the recommendation card below it.
    let edit = rawEdit;
    if (
      rawEdit &&
      nadineRecommendation &&
      report.slug === "modern-tailoring-spring-2026" &&
      rawEdit.worthInvestingStatement === null &&
      rawEdit.evidenceClosetItems.length > 0 &&
      rawEdit.evidenceClosetItems[0].category === "TOPS"
    ) {
      const topName = rawEdit.evidenceClosetItems[0].name;
      edit = {
        ...rawEdit,
        aLookToTry: `Your ${topName} + ${nadineRecommendation.title} + a clean straight or wide-leg trouser + minimal flats.`,
      };
    }

    // Usage recording — fired only for a genuine personalised edit (never a
    // locked/empty/failed state). Two independent writes, two independent
    // purposes:
    //   - reservePersonalisedTrendSlot (below): the customer entitlement/
    //     usage source of truth (PersonalisedTrendEditUsage, written via its
    //     own recordPersonalisedTrendEditUsage call) — this is what Plan &
    //     Usage and checkEntitlement read. Idempotent create-if-absent; the
    //     DB unique constraint is the race-safety authority. No longer a
    //     direct call from this file — see that function's own comment for
    //     why (fixed 2026-11-12, fix/stripe-clerk-phase1-security).
    //   - emitTrendEditGenerated: analytics only (JourneyEvent, hashed
    //     customerId) — never read for quota or Plan & Usage.
    // Both share one periodKey from getUsageWindow(), so the idempotency
    // boundary and the monthly count window can never drift apart. Neither
    // write ever blocks the response.
    if (edit) {
      const { periodKey } = getUsageWindow();
      try {
        const snapshot: TrendEditSnapshot = {
          schemaVersion: "trend-edit-snapshot-v1",
          reportSlug: report.slug,
          reportTitle: report.title,
          reportSeason: report.season,
          generatedAt: new Date().toISOString(),
          edit,
          nadineRecommendation,
        };
        // Unconditional, fail-closed: re-verifies the ACCOUNT-WIDE monthly
        // count and writes in one Serializable transaction, closing the race
        // where a concurrent generation for a DIFFERENT report this same
        // period already consumed the one allowance between this function's
        // own caller checking checkEntitlement and reaching this write — see
        // reservePersonalisedTrendSlot's own comment for why the per-report
        // unique constraint alone never caught that. Losing this race is
        // rare enough, and consuming no quota either way, that failing the
        // response honestly is simpler and safer than rendering generated
        // content with no persisted row behind it. Previously gated behind
        // ENTITLEMENT_ENFORCEMENT === "true" with an uncounted-write fallback
        // — fixed 2026-11-12, see fix/stripe-clerk-phase1-security.
        {
          const reservation = await reservePersonalisedTrendSlot(customer.id, customer.membershipStatus, report.slug, snapshot);
          if (!reservation.allowed) {
            console.error(
              `trend_edit_quota_race_lost customer=${hashCustomerId(customer.id)} report=${report.slug} period=${periodKey}`,
            );
            return { edit: null, nadineRecommendation: null, hasProfile: false, generationFailed: true };
          }
        }
        // Defensive verification, not a retry/self-heal: a genuine first
        // generation must never leave a row with a null snapshot. This
        // never writes again on a bad result — see getTrendEditUsageState's
        // own "legacy_no_snapshot" handling for why a stuck-null row must
        // stay untouched rather than being retried into existing.
        const verify = await getTrendEditUsageState(customer.id, report.slug);
        if (verify.status !== "snapshotted") {
          console.error(
            `trend_edit_snapshot_write_unverified customer=${hashCustomerId(customer.id)} report=${report.slug} period=${periodKey} status=${verify.status}`,
          );
        }
      } catch (writeError) {
        console.error(
          `trend_edit_snapshot_write_failed customer=${hashCustomerId(customer.id)} report=${report.slug} period=${periodKey}`,
          writeError,
        );
      }
      try {
        await recordJourneyEventAwaited(
          emitTrendEditGenerated({
            customerId: customer.id,
            slug: report.slug,
            closetItemCount: evidence.closetItems.length,
          }),
          `trend_edit_generated:${hashCustomerId(customer.id)}:${report.slug}:${periodKey}:v1`,
        );
      } catch {
        /* never let usage-event recording block the response */
      }
    }

    return { edit, nadineRecommendation, hasProfile: evidence.hasProfile, generationFailed: false };
  } catch (error) {
    console.error("Shopper trend edit generation failed:", error);
    return { edit: null, nadineRecommendation: null, hasProfile: false, generationFailed: true };
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);

  const [report, allPublished] = await Promise.all([
    getEditorialReportBySlug(params.slug ?? ""),
    getPublishedEditorialReports(),
  ]);
  if (!report) throw new Response("Not Found", { status: 404 });
  const reportIndex = allPublished.findIndex((r) => r.slug === report.slug);
  // Real chronological edition number — same numbering as the public
  // Trend Reports pages and My Trend Edits listing, never derived from
  // reportIndex (which only drives the decorative tint cycle).
  const editionNumber = getEditionNumberMap(allPublished).get(getEffectiveEditionPeriod(report) ?? "") ?? null;

  // Frozen-at-first-generation behaviour: once this customer has a stored
  // snapshot for this report in the current period, EVERY later view this
  // period renders that exact stored snapshot — never a fresh regeneration
  // from whatever Passport/Closet state happens to look like today. Without
  // this, a customer could see Edit A on first visit while a changed Closet
  // silently produced Edit B on a later visit, and Admin's stored snapshot
  // (frozen at Edit A) would permanently disagree with what the customer is
  // currently looking at. No second generation-history system here — this
  // reads the same PersonalisedTrendEditUsage row the usage/quota logic
  // already owns.
  //
  // Three distinct states, not two: "no row yet" and "row exists but
  // predates snapshot persistence" must never collapse into the same
  // "generate" behavior — see getTrendEditUsageState. A legacy row
  // (snapshot: null) means a generation already happened this period before
  // snapshot capture existed; it is NEVER regenerated and NEVER backfilled —
  // the customer sees an honest historical-unavailable state instead.
  const usageState = await getTrendEditUsageState(customer.id, report.slug);
  if (usageState.status === "snapshotted") {
    // Re-resolves Closet images fresh from the stored snapshot's
    // closetItemIds — never rewrites the snapshot itself. See
    // hydrateShopperEditImages for why the persisted imageUrl can be stale.
    const hydratedEdit = await hydrateShopperEditImages(usageState.snapshot.edit, customer.id);
    return {
      report,
      edit: hydratedEdit,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: usageState.snapshot.nadineRecommendation,
      reportIndex,
      editionNumber,
      membershipRequired: false,
      monthlyQuotaExhausted: false,
      historicalUnavailable: false,
      archivedPeriodLabel: null,
    } satisfies LoaderData;
  }
  if (usageState.status === "legacy_no_snapshot") {
    return {
      report,
      edit: null,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
      reportIndex,
      editionNumber,
      membershipRequired: false,
      monthlyQuotaExhausted: false,
      historicalUnavailable: true,
      archivedPeriodLabel: null,
    } satisfies LoaderData;
  }

  // usageState.status === "none" — nothing generated yet THIS period. Before
  // auto-generating, check the customer's own archive: "My Trend Edits must
  // work as a real archive" — a report generated in an earlier period must
  // stay reopenable anytime, and reopening it must never write a new row,
  // regenerate, or count against this period's one-generation allowance.
  // Only when no archive exists at all (a genuinely first-ever view of this
  // report) does the page fall through to auto-generating below — the
  // existing, unchanged first-time behavior.
  const archived = await getMostRecentArchivedSnapshot(customer.id, report.slug);
  if (archived) {
    const hydratedEdit = await hydrateShopperEditImages(archived.snapshot.edit, customer.id);
    return {
      report,
      edit: hydratedEdit,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: archived.snapshot.nadineRecommendation,
      reportIndex,
      editionNumber,
      membershipRequired: false,
      monthlyQuotaExhausted: false,
      historicalUnavailable: false,
      archivedPeriodLabel: archived.periodLabel,
    } satisfies LoaderData;
  }

  // Personalised Trend Edit is a membership feature, AND a MEMBER only gets
  // one NEW generation per month, account-wide across every report (see
  // checkEntitlement's personalisedTrend case — the count has no reportSlug
  // filter). Unconditional, fail-closed (same as every other reserve*/check
  // path in this file) — a blocked customer sees one of two distinct
  // states: never-a-member gets the membership upsell, an already-entitled
  // MEMBER who used this month's allowance (possibly on a different report)
  // gets an honest monthly-allowance message instead — see
  // resolveTrendEditBlockState. No Closet/Passport read happens for either
  // blocked state — nothing to leak, nothing generated, nothing to count.
  // Previously gated behind ENTITLEMENT_ENFORCEMENT === "true" — fixed
  // 2026-11-12, see fix/stripe-clerk-phase1-security.
  {
    const entitlement = await checkEntitlement(customer.id, customer.membershipStatus, "personalisedTrend");
    if (!entitlement.allowed) {
      // The enforcement decision above already comes from the corrected
      // allowance (checkEntitlement -> resolveEffectiveContext), so a stale
      // cached MEMBER with no real subscription is already blocked
      // correctly — this just makes sure the MESSAGE shown matches that
      // same corrected reality instead of the raw cache.
      const effectiveMembershipStatus = await resolveEffectiveMembershipStatus(customer.id, customer.membershipStatus);
      const blockState = resolveTrendEditBlockState(effectiveMembershipStatus, entitlement.reason);
      return {
        report,
        edit: null,
        hasProfile: false,
        generationFailed: false,
        nadineRecommendation: null,
        reportIndex,
        editionNumber,
        membershipRequired: blockState === "membership_required",
        monthlyQuotaExhausted: blockState === "monthly_quota_exhausted",
        historicalUnavailable: false,
        archivedPeriodLabel: null,
      } satisfies LoaderData;
    }
  }

  const generated = await generateAndRecordEdit(customer, report);
  return {
    report,
    reportIndex,
    editionNumber,
    membershipRequired: false,
    monthlyQuotaExhausted: false,
    historicalUnavailable: false,
    archivedPeriodLabel: null,
    ...generated,
  } satisfies LoaderData;
}

// Explicit customer action, only reachable from the "archived" state's own
// button: produces a genuinely NEW generation for the current period from
// current Passport/Closet state, consuming this period's one-generation
// allowance. Re-checks state server-side rather than trusting the client —
// if the current period already has its own row by the time this runs (a
// race, or a stale view), this is a safe no-op; the redirect's reload
// resolves to whatever the server-side state actually is.
export async function action({ request, params }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const report = await getEditorialReportBySlug(params.slug ?? "");
  if (!report) throw new Response("Not Found", { status: 404 });

  const formData = await request.formData();
  if (formData.get("intent") !== "generate-new") {
    return data({ ok: false as const, error: "Invalid request." }, { status: 400 });
  }

  // Unconditional, fail-closed — previously generated unconditionally
  // whenever ENTITLEMENT_ENFORCEMENT was anything but "true". Fixed
  // 2026-11-12, see fix/stripe-clerk-phase1-security.
  const usageState = await getTrendEditUsageState(customer.id, report.slug);
  if (usageState.status === "none") {
    const entitlement = await checkEntitlement(customer.id, customer.membershipStatus, "personalisedTrend");
    if (entitlement.allowed) {
      await generateAndRecordEdit(customer, report);
    }
    // Blocked — reload shows the archive again rather than a new edit.
  }

  return redirect(request.url);
}

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const css = `
  .tmd-page { padding: 48px 0 96px; }

  /* ── Back link ───────────────────────────────────────────────── */
  .tmd-back {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    text-decoration: none;
    margin-bottom: 40px;
    transition: color 0.2s;
  }
  .tmd-back:hover { color: #7a1e28; }

  /* ── Action buttons ─────────────────────────────────────────── */
  .tmd-action-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 32px;
  }
  .tmd-action-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border: 1px solid rgba(26,17,9,0.18);
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.24em;
    text-transform: uppercase; color: #1a1109; background: transparent;
    cursor: pointer; text-decoration: none; transition: border-color 0.2s, color 0.2s;
  }
  .tmd-action-btn:hover { border-color: #7a1e28; color: #7a1e28; }
  .tmd-action-btn.active { color: #7a1e28; border-color: #7a1e28; }
  @media (max-width: 767px) { .tmd-action-row { display: none; } }

  /* ── Hero tinted block ───────────────────────────────────────── */
  .tmd-hero {
    position: relative;
    overflow: hidden;
    padding: 36px;
    margin-bottom: 48px;
  }
  .tmd-hero-num {
    position: absolute;
    right: -16px;
    top: -40px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(10rem, 14vw, 14rem);
    font-weight: 200;
    line-height: 1;
    color: rgba(26,17,9,0.05);
    pointer-events: none;
    user-select: none;
    z-index: 0;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .tmd-hero-inner { position: relative; z-index: 1; }
  .tmd-hero-kicker {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 16px;
  }
  .tmd-hero-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(2.4rem, 5vw, 4rem);
    font-weight: 200;
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #1a1109;
    margin: 0 0 20px;
  }
  .tmd-hero-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #7a1e28;
  }
  .tmd-hero-subtitle {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(26,17,9,0.68);
    line-height: 1.7;
    max-width: 40rem;
    margin-bottom: 24px;
  }
  .tmd-hero-public-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    opacity: 0.8;
    transition: opacity 0.2s;
  }
  .tmd-hero-public-link:hover { opacity: 1; }

  /* ── Archive banner — shown only when nothing has been generated yet
     this period and the page is instead reopening a past period's edit ── */
  .tmd-archive-banner {
    display: flex; flex-wrap: wrap; align-items: center; gap: 16px;
    padding: 20px 24px; margin-bottom: 32px;
    background: rgba(26,17,9,0.04); border: 1px solid rgba(26,17,9,0.12);
  }
  .tmd-archive-banner-text {
    flex: 1; min-width: 220px;
    font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 0.95rem;
    line-height: 1.6; color: rgba(26,17,9,0.75); margin: 0;
  }
  .tmd-archive-banner-btn {
    flex-shrink: 0; border: 1px solid rgba(26,17,9,0.6); border-radius: 9999px;
    padding: 10px 20px; background: transparent; cursor: pointer;
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.24em;
    text-transform: uppercase; color: #1a1109; transition: background 0.2s, color 0.2s;
  }
  .tmd-archive-banner-btn:hover { background: #1a1109; color: #f5f0e8; }
  .tmd-archive-banner-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Divider, section labels, body text, reading box, evidence panel,
     closet items, low-data notice, and bullet lists now live in
     TREND_EDIT_REPORT_BODY_CSS (app/components/trends/TrendEditReportBody),
     shared with the Admin Customer 360 Trend Edit detail view. */

  /* ── State boxes ─────────────────────────────────────────────── */
  .tmd-state {
    padding: 48px 40px;
    border: 1px solid rgba(26,17,9,0.08);
    background: rgba(255,255,255,0.45);
    text-align: center;
  }
  .tmd-state-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    font-style: italic;
    color: #1a1109;
    line-height: 1.7;
    margin-bottom: 28px;
    max-width: 34rem;
    margin-left: auto;
    margin-right: auto;
  }
  .tmd-state-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(26,17,9,0.80);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tmd-state-btn:hover { background: #1a1109; color: #f5f0e8; }

  /* ── Footer CTA ──────────────────────────────────────────────── */
  .tmd-footer {
    margin-top: 60px;
    padding: 36px 36px;
    background: #2a1e17;
    color: #f0ebe2;
  }
  .tmd-footer-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(240,235,226,0.50);
    margin-bottom: 16px;
  }
  .tmd-footer-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(240,235,226,0.75);
    line-height: 1.7;
    max-width: 36rem;
    margin-bottom: 24px;
  }
  .tmd-footer-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(240,235,226,0.6);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #f0ebe2;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tmd-footer-btn:hover { background: #f0ebe2; color: #1a1109; }

  /* NADINE product card and "Already yours" strip now live in
     TREND_EDIT_REPORT_BODY_CSS (app/components/trends/TrendEditReportBody),
     shared with the Admin Customer 360 Trend Edit detail view. */
`;

export function ErrorBoundary() {
  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <style>{TREND_EDIT_REPORT_BODY_CSS}</style>
      <div className="tmd-page">
        <Link to="/trends/my-edits" className="tmd-back">← My Trend Edits</Link>
        <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.1rem", fontStyle: "italic", color: "rgba(26,17,9,0.60)" }}>
          This edit could not be found.
        </p>
      </div>
    </MyNaiaLayout>
  );
}

export default function MyTrendEditDetail() {
  const { report, edit, hasProfile, generationFailed, nadineRecommendation, reportIndex, editionNumber, membershipRequired, monthlyQuotaExhausted, historicalUnavailable, archivedPeriodLabel } = useLoaderData() as LoaderData;
  const tint = TINTS[Math.max(0, reportIndex) % TINTS.length];
  const num = formatEditionNumber(editionNumber) ?? String(Math.max(0, reportIndex)).padStart(2, "0");

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const generateFetcher = useFetcher();
  const isGenerating = generateFetcher.state !== "idle";

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const fallbackCopy = () => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch { return false; }
    };
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = fallbackCopy(); }
    } else { ok = fallbackCopy(); }
    setCopyStatus(ok ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  };

  const downloadMyEdit = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxW = pageW - margin * 2;
    let y = 20;
    const addText = (text: string, size: number, style: string, color: number[], spaceAfter?: number) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", style || "normal");
      doc.setTextColor(...(color as [number, number, number]));
      const lines = doc.splitTextToSize(String(text || ""), maxW);
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
      y += spaceAfter || 4;
    };
    doc.setFontSize(24); doc.setFont("helvetica", "bolditalic"); doc.setTextColor(34, 21, 22);
    doc.text("nAia", margin, y); y += 8;
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(139, 32, 53);
    doc.text("MY TREND EDIT · " + report.season.toUpperCase(), margin, y); y += 10;
    doc.setDrawColor(34, 21, 22); doc.line(margin, y, pageW - margin, y); y += 10;
    addText(report.title, 20, "bold", [34, 21, 22], 6);
    if (edit?.subTitle) addText(edit.subTitle, 12, "italic", [122, 111, 106], 10);
    if (edit?.yourVersion) { addText("YOUR VERSION", 8, "bold", [139, 32, 53], 3); addText(edit.yourVersion, 11, "normal", [34, 21, 22], 10); }
    if (edit?.evidenceStyleDna) { addText("YOUR STYLE DNA SAYS", 8, "bold", [139, 32, 53], 3); addText(edit.evidenceStyleDna, 10, "normal", [34, 21, 22], 8); }
    if (edit?.evidencePassportSays) { addText("YOUR PASSPORT SAYS", 8, "bold", [139, 32, 53], 3); addText(edit.evidencePassportSays, 10, "normal", [34, 21, 22], 8); }
    if (edit?.evidenceReviews) { addText("YOUR RATINGS SAY", 8, "bold", [139, 32, 53], 3); addText(edit.evidenceReviews, 10, "normal", [34, 21, 22], 8); }
    if (edit?.yourBestRouteIn) { addText("YOUR BEST ROUTE IN", 8, "bold", [139, 32, 53], 3); addText(edit.yourBestRouteIn, 10, "normal", [34, 21, 22], 8); }
    if (edit?.aLookToTry) { addText("A LOOK TO TRY", 8, "bold", [139, 32, 53], 3); addText(edit.aLookToTry, 10, "normal", [34, 21, 22], 8); }
    if (edit?.worthInvestingStatement) { addText("WORTH INVESTING IN", 8, "bold", [139, 32, 53], 3); addText(edit.worthInvestingStatement, 10, "normal", [34, 21, 22], 8); }
    if (edit?.partToTake?.length) { addText("THE PART TO TAKE", 8, "bold", [139, 32, 53], 3); addText(edit.partToTake.join("\n"), 10, "normal", [34, 21, 22], 8); }
    if (nadineRecommendation && !edit?.worthInvestingStatement) { addText("A NADINE PIECE FOR THIS GAP", 8, "bold", [139, 32, 53], 3); addText(`${nadineRecommendation.title} — ${nadineRecommendation.personalExplanation}`, 10, "normal", [34, 21, 22], 8); }
    if (edit?.theBalanceToProtect) { addText("THE BALANCE TO PROTECT", 8, "bold", [139, 32, 53], 3); addText(edit.theBalanceToProtect, 10, "normal", [34, 21, 22], 8); }
    if (edit?.partToLeave?.length) { addText("THE PART TO LEAVE", 8, "bold", [139, 32, 53], 3); addText(edit.partToLeave.join("\n"), 10, "normal", [34, 21, 22], 8); }
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 111, 106);
    doc.text("nAia Trend Reports · Your personalised edit", margin, 285);
    doc.save("my-edit-" + report.title.replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".pdf");
  };

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <style>{TREND_EDIT_REPORT_BODY_CSS}</style>
      <div className="tmd-page">
        <Link to="/trends/my-edits" className="tmd-back">← My Trend Edits</Link>

        {edit && (
          <div className="tmd-action-row">
            <button className={`tmd-action-btn${copyStatus === "copied" ? " active" : ""}`} onClick={copyLink}>
              {copyStatus === "copied" ? "Copied ✓" : copyStatus === "error" ? "Failed" : "Copy link"}
            </button>
            <button className="tmd-action-btn" onClick={downloadMyEdit}>Download My Edit</button>
          </div>
        )}

        {/* Hero tinted block */}
        <div className="tmd-hero" style={{ background: tint }}>
          <span className="tmd-hero-num" aria-hidden="true">{num}</span>
          <div className="tmd-hero-inner">
            <div className="tmd-hero-kicker">
              {formatEditionNumber(editionNumber) && `Edition ${formatEditionNumber(editionNumber)} · `}
              {report.season} · {formatEditionMonthLabel(getEffectiveEditionPeriod(report))} · personal edit
            </div>
            <h1 className="tmd-hero-title">
              {report.title.split(" ").slice(0, -1).join(" ")}<br />
              <em>{report.title.split(" ").slice(-1)[0]}</em>
            </h1>
            {edit && <p className="tmd-hero-subtitle">{edit.subTitle}</p>}
            <Link to={`/trend-reports/${report.slug}`} className="tmd-hero-public-link">
              Read the public report →
            </Link>
          </div>
        </div>

        {/* State: membership required — never a member, or a zero-allowance tier */}
        {membershipRequired ? (
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your Personalised Trend Edit is a nAia Membership feature. Join to see this direction read through your own Style Passport and Closet.
            </p>
            <Link to="/my-naia/plan-usage" className="tmd-state-btn">Explore nAia Membership →</Link>
          </div>
        ) : monthlyQuotaExhausted ? (
          /* State: already a MEMBER, but this period's one allowance is used —
             possibly by a different report entirely, since the allowance is
             account-wide. Must never show the "Join" upsell to a customer
             who is already a member. */
          <div className="tmd-state">
            <p className="tmd-state-text">
              You&rsquo;ve used this month&rsquo;s Personalised Trend Edit.
              <br /><br />
              Your next new edit will be available next month. You can still revisit your saved edits in My Trend Edits.
            </p>
            <Link to="/trends/my-edits" className="tmd-state-btn">Back to My Trend Edits →</Link>
          </div>
        ) : generationFailed ? (
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your nAia Edit is taking a moment. Please try again shortly.
            </p>
            <Link to={`/trend-reports/${report.slug}`} className="tmd-state-btn">
              Back to the report →
            </Link>
          </div>
        ) : historicalUnavailable ? (
          /* State: a generation happened earlier this period, before we
             started saving the full edit — never regenerated, never
             backfilled. */
          <div className="tmd-state">
            <p className="tmd-state-text">
              You already received a nAia Edit for this report earlier this period, and we can&rsquo;t reopen it in its original form. Check back once this period resets for a fresh personalised edit.
            </p>
            <Link to="/trends/my-edits" className="tmd-state-btn">Back to My Trend Edits →</Link>
          </div>
        ) : !hasProfile ? (
          /* State: passport incomplete */
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your nAia Edit reads this report through your Passport — and yours isn&rsquo;t complete yet. Finish it to see what this direction means for you specifically.
            </p>
            <Link to="/passport" className="tmd-state-btn">Complete Your Passport →</Link>
          </div>
        ) : edit ? (
          /* Full edit */
          <>
            {archivedPeriodLabel && (
              /* Nothing has been generated yet THIS period — this is the
                 customer's own archive from an earlier one. Reopening it
                 never regenerated or consumed this period's allowance;
                 this is the only path that does. */
              <div className="tmd-archive-banner">
                <p className="tmd-archive-banner-text">
                  This is the edit nAia generated for you in {archivedPeriodLabel}. Your Style Passport or Closet may have changed since then.
                </p>
                <generateFetcher.Form method="post">
                  <input type="hidden" name="intent" value="generate-new" />
                  <button type="submit" className="tmd-archive-banner-btn" disabled={isGenerating}>
                    {isGenerating ? "Generating…" : "Generate this month’s edit"}
                  </button>
                </generateFetcher.Form>
              </div>
            )}
            <TrendEditReportBody edit={edit} nadineRecommendation={nadineRecommendation} />

            {/* Footer CTA */}
            <div className="tmd-footer">
              <div className="tmd-footer-eyebrow">build a sharper edit</div>
              <p className="tmd-footer-body">
                Add your most-worn pieces and rate your outfits so nAia can read your real style world more precisely.
              </p>
              <Link to="/closet" className="tmd-footer-btn">Open My Closet →</Link>
            </div>
          </>
        ) : null}
      </div>
    </MyNaiaLayout>
  );
}
