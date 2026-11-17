// app/routes/my-naia.plan-usage.tsx
// /my-naia/plan-usage — nAia Membership account page.
// Shows membership allowances, monthly usage, closet capacity, and add-on catalog.
// Add-on purchase flows remain intentionally absent (see CUSTOMER_FACING_ADDON_LABELS
// below) — only the membership subscribe flow is wired, to the Phase 3 Stripe
// checkout implementation (POST /api/billing-checkout).

import { useEffect, useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs, LinksFunction } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import { MEMBERSHIP_PRICING, ADDON_CATALOG } from "~/lib/plan/plan-limits.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import TermsAcceptanceCheckbox from "~/components/checkout/TermsAcceptanceCheckbox";
import EarlyServiceConsentCheckbox from "~/components/checkout/EarlyServiceConsentCheckbox";
import ServicePerformanceAcknowledgement from "~/components/checkout/ServicePerformanceAcknowledgement";
import DelayedStartNotice from "~/components/checkout/DelayedStartNotice";
import { computeDelayedStart } from "~/lib/delayed-start";
import { CURRENT_TERMS_VERSION } from "~/lib/terms-acceptance.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

// The only two values api.billing-checkout.tsx ever puts in this param
// (successUrl/cancelUrl) — anything else is treated as absent. Arriving
// here with ?checkout=success is NEVER proof of payment on its own: it
// only means Stripe Checkout itself completed, not that the subscription
// webhook has landed. membershipStatus (isMember below) is written
// exclusively by that webhook, so it alone decides whether the member
// view renders — this param only selects which one-time banner copy to
// show alongside whatever isMember already says.
type CheckoutOutcome = "success" | "cancelled" | null;

function parseCheckoutOutcome(value: string | null): CheckoutOutcome {
  return value === "success" || value === "cancelled" ? value : null;
}

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

// Pure string transform, exported so it can be verified directly — this
// file's own component tests use renderToString (no DOM, no commit phase),
// so a useEffect calling window.history.replaceState can never actually
// run under them. Keeping the one meaningful piece of logic (which param
// to drop, which to keep) in a plain function means it's genuinely tested,
// rather than only "obviously correct" by inspection of an untestable
// effect. Removes ONLY the "checkout" param; every other query param and
// any hash fragment pass through unchanged.
export function stripCheckoutParamFromUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("checkout");
  return `${url.pathname}${url.search}${url.hash}`;
}

// ── Customer-facing add-on allowlist ──────────────────────────────────────────
// ADDON_CATALOG in plan-limits.server.ts is the full historical/internal add-on
// catalog — other code may still rely on entries that are not yet approved for
// customer display. Only the two add-ons below are approved for the Plan & Usage
// page today. This allowlist is presentation-only: it does not mutate or trim
// ADDON_CATALOG itself, so adding to it later does not require touching this file.
export const CUSTOMER_FACING_ADDON_LABELS: ReadonlySet<string> = new Set([
  "StyleMe Pack",
  "VTO Pack",
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const summary = await getEntitlementSummary(customer.id, customer.membershipStatus);
  const addonCatalog = ADDON_CATALOG.filter((addon) => CUSTOMER_FACING_ADDON_LABELS.has(addon.label));
  const checkoutOutcome = parseCheckoutOutcome(new URL(request.url).searchParams.get("checkout"));
  // Mirrors api.billing-checkout.tsx's own fail-closed gate exactly — if
  // that route would 503 "terms_not_configured" right now, this page must
  // not show a working-looking Subscribe flow that leads straight into
  // that wall. See the "Membership checkout" section below.
  const termsConfigured = CURRENT_TERMS_VERSION !== null;
  return { summary, membershipPricing: MEMBERSHIP_PRICING, addonCatalog, checkoutOutcome, termsConfigured };
}

// ── Display helpers ────────────────────────────────────────────────────────────

function UsageBar({ used, limit, exhausted }: { used: number; limit: number; exhausted: boolean }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    // Decorative — the "X of Y used" text rendered alongside this bar is the
    // accessible equivalent, so the bar itself is hidden from assistive tech.
    <div style={{ marginTop: "0.5rem" }} aria-hidden="true">
      <div style={{ height: "3px", background: "var(--fg-10)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: exhausted ? "var(--c-alert, #c0392b)" : "var(--fg-55)",
          borderRadius: "2px",
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="mn-section">
      <div className="mn-section-head" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <h2 className="mn-eyebrow" style={{ margin: 0, font: "inherit" }}>{title}</h2>
        {right && <div style={{ fontSize: "0.62rem", color: "var(--fg-40, var(--fg-55))", letterSpacing: "0.1em", textTransform: "uppercase" }}>{right}</div>}
      </div>
      <div className="mn-section-body">{children}</div>
    </section>
  );
}

function UsageRow({ label, value, sub, bar, last }: {
  label: string;
  value: string;
  sub?: string;
  bar?: { used: number; limit: number; exhausted: boolean };
  // The section wrapper (.mn-section) below already supplies its own
  // top border, immediately adjacent to this row's own border-bottom when
  // this is the last row in the list — two stacked lines with nothing
  // between them. Omit only the last row's border; every other row keeps
  // its separator unchanged.
  last?: boolean;
}) {
  return (
    <div style={last ? { paddingBottom: "1rem" } : { paddingBottom: "1rem", borderBottom: "1px solid var(--fg-08, var(--fg-10))" }}>
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>
        {label}
      </div>
      <div style={{ marginTop: "0.35rem", fontFamily: "var(--ff-display)", fontWeight: 300, fontSize: "1.25rem", letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--fg)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: "0.25rem", fontSize: "0.68rem", color: "var(--fg-55)", letterSpacing: "0.05em" }}>
          {sub}
        </div>
      )}
      {bar && <UsageBar used={bar.used} limit={bar.limit} exhausted={bar.exhausted} />}
    </div>
  );
}

function usageLabel(used: number, limit: number, unit: string): string {
  if (used > limit) return `${used} ${unit} used · ${limit} included this month`;
  return `${used} of ${limit} used`;
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function PlanUsagePage() {
  const { summary, membershipPricing, addonCatalog, checkoutOutcome, termsConfigured } = useLoaderData<typeof loader>();
  // checkoutOutcome came from a ?checkout=success|cancelled query param on
  // THIS page load, read once by the loader and never re-read afterward —
  // so leaving it in the URL has no further effect on this render, but it
  // means an ordinary page refresh re-sends that same param, the loader
  // parses it again, and the one-time banner below reappears every time,
  // indefinitely. Strip the param from the visible URL (history.
  // replaceState, no navigation, no loader re-run) right after this
  // render has already used it for its one intended showing — a refresh
  // from this point on carries no checkout param, so the banner correctly
  // does not return. See stripCheckoutParamFromUrl's own comment for why
  // the actual param-handling logic lives there, not inline here.
  useEffect(() => {
    if (checkoutOutcome === null) return;
    window.history.replaceState(null, "", stripCheckoutParamFromUrl(window.location.href));
  }, [checkoutOutcome]);
  const { effectiveMembershipStatus, hasBillingAccount, styleMe, buySkip, vto, closet, personalisedTrend, billingAlert } = summary;
  // effectiveMembershipStatus, not the raw cached membershipStatus — see
  // entitlement.server.ts's EntitlementSummary comment. Governs usage
  // meters / "what you get" below — entitlement, not billing eligibility.
  const isMember = effectiveMembershipStatus === "MEMBER";
  // Subscribe-vs-Manage-Membership is a DIFFERENT question from isMember
  // above: it's "does this customer have a real Stripe billing account to
  // manage," not "are they currently entitled." hasBillingAccount is the
  // exact same check api.billing-portal.tsx itself performs before
  // opening the portal, so Manage Membership is shown if and only if
  // clicking it will actually succeed — never the "no billing account
  // found" dead end a membership-tier-only gate could produce. Still a
  // strict either/or (same shape as before, just a different gating
  // field): a lapsed customer who already has a real billing account sees
  // Manage Membership, not Subscribe — Stripe's own portal is the single
  // correct entry point once a real account exists, same as today.
  const showSubscribeButtons = !hasBillingAccount;
  const showManageMembership = hasBillingAccount;
  const pricing = `AED ${membershipPricing.monthly.amount}/month · AED ${membershipPricing.annual.amount}/year`;
  const [checkingAgain, setCheckingAgain] = useState(false);

  const [subscribing, setSubscribing] = useState<"MONTHLY" | "ANNUAL" | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  // Required — see TermsAcceptanceCheckbox's own default. Gates the
  // Subscribe/Choose Annual buttons below, but that's a courtesy, not
  // the real enforcement: api.billing-checkout.tsx rejects the same
  // request server-side if this were ever bypassed.
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Starts unchecked, as required (Legal handoff W1) — EarlyServiceConsentCheckbox's
  // own default. Sent to the server below for completeness of the
  // submission path, but has no effect anywhere yet; see
  // api.billing-checkout.tsx's own comment on why.
  const [earlyServiceConsent, setEarlyServiceConsent] = useState(false);

  async function handleSubscribe(planType: "MONTHLY" | "ANNUAL") {
    setSubscribing(planType);
    setSubscribeError(null);
    try {
      const res = await fetch("/api/billing-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planType, termsAccepted, earlyServiceConsent }),
      });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setSubscribeError(
        data.code === "subscription_already_exists"
          ? "You already have a membership in progress — check your email or try again shortly."
          : data.code === "auth_required"
          ? "Your session expired — please sign in again."
          : data.code === "terms_not_accepted"
          ? "Please accept the Terms of Service to continue."
          : "Could not start checkout. Please try again.",
      );
    } catch {
      setSubscribeError("Could not reach the checkout service. Please try again.");
    } finally {
      setSubscribing(null);
    }
  }

  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handleManageMembership() {
    setOpeningPortal(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing-portal", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setPortalError(
        data.code === "no_billing_account"
          ? "No billing account found for your membership yet — please contact support."
          : data.code === "auth_required"
          ? "Your session expired — please sign in again."
          : "Could not open billing management right now. Please try again.",
      );
    } catch {
      setPortalError("Could not reach the billing management service. Please try again.");
    } finally {
      setOpeningPortal(false);
    }
  }

  // ── StyleMe
  const smValue = usageLabel(styleMe.monthlyUsed, styleMe.monthlyLimit, "sessions");
  const smExhausted = styleMe.monthlyUsed >= styleMe.monthlyLimit;

  // ── Buy or Skip
  const bsValue = usageLabel(buySkip.monthlyUsed, buySkip.monthlyLimit, "checks");
  const bsExhausted = buySkip.monthlyUsed >= buySkip.monthlyLimit;

  // ── VTO
  // Copy-format consistency only: unlike usageLabel()'s "X of Y used" /
  // over-limit split (still used by StyleMe, Buy or Skip, and Trend Edit
  // below, unchanged), this row always renders the "used · included this
  // month" shape regardless of whether the limit is exceeded. No arithmetic
  // change — vtoUsed/vtoExhausted/the bar are unaffected.
  const vtoUsed = vto.monthlyCompleted;
  const vtoExhausted = vtoUsed >= vto.monthlyLimit;
  const vtoValue = `${vtoUsed} used · ${vto.monthlyLimit} included this month`;
  const vtoSub = vto.monthlyInFlight > 0 ? `${vto.monthlyInFlight} generating` : undefined;

  // ── Closet
  const closetExhausted = closet.currentCount >= closet.limit;
  const closetValue = closet.currentCount > closet.limit
    ? `${closet.currentCount} items · ${closet.limit} included`
    : `${closet.currentCount} of ${closet.limit} items`;

  // ── Personalised Trend Edit — monthlyUsed is a real count from
  // PersonalisedTrendEditUsage (never JourneyEvent). NONE has monthlyLimit 0
  // and shows "Not included"; usageLabel's own over-limit branch already
  // renders an anomaly (e.g. 2 used while enforcement is disabled) as plain
  // descriptive text, never a subtraction that could go negative.
  const trendEditExhausted = personalisedTrend.monthlyUsed >= personalisedTrend.monthlyLimit;
  const trendEditValue = personalisedTrend.monthlyLimit > 0
    ? usageLabel(personalisedTrend.monthlyUsed, personalisedTrend.monthlyLimit, "edits")
    : "Not included";

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Your Account</div>
        <h1 className="sp-shell-title">Plans &amp; <span className="sp-shell-accent">usage.</span></h1>
      </div>

      <div className="mn-content">

        {/* ── Checkout outcome (one-time, from the Stripe redirect) ──── */}
        {/* checkoutOutcome alone never implies membership — isMember (from
            summary.effectiveMembershipStatus, authoritative-subscription-
            corrected) still decides which copy applies for "success". */}
        {checkoutOutcome === "success" && isMember && (
          <div style={{ padding: "0.9rem 1.1rem", marginBottom: "1rem", borderRadius: "4px", background: "var(--c-success-bg, #e8f5e9)", color: "var(--c-success, #1f7a4d)", fontSize: "0.78rem", letterSpacing: "0.03em" }}>
            Payment confirmed — welcome to nAia Membership.
          </div>
        )}
        {checkoutOutcome === "success" && !isMember && (
          <div style={{ padding: "0.9rem 1.1rem", marginBottom: "1rem", borderRadius: "4px", background: "var(--fg-05, #f0f0f0)", color: "var(--fg)", fontSize: "0.78rem", letterSpacing: "0.03em" }}>
            Payment received. We&apos;re confirming your membership now — this can take a few moments.
            {" "}
            <button
              type="button"
              onClick={() => { setCheckingAgain(true); window.location.reload(); }}
              disabled={checkingAgain}
              style={{ marginLeft: "0.4rem", padding: "0.2rem 0.6rem", fontSize: "0.72rem", letterSpacing: "0.05em", background: "transparent", color: "var(--fg)", border: "1px solid var(--fg-40, var(--fg-55))", borderRadius: "2px", cursor: checkingAgain ? "default" : "pointer" }}
            >
              {checkingAgain ? "Checking…" : "Check again"}
            </button>
          </div>
        )}
        {checkoutOutcome === "cancelled" && (
          <div style={{ padding: "0.9rem 1.1rem", marginBottom: "1rem", borderRadius: "4px", background: "var(--fg-05, #f0f0f0)", color: "var(--fg)", fontSize: "0.78rem", letterSpacing: "0.03em" }}>
            Checkout was cancelled. No payment was made — you can try again anytime.
          </div>
        )}

        {/* ── PAST_DUE grace-period notice ─────────────────────────────── */}
        {/* Purely a reflection of summary.billingAlert — never recomputes or
            widens the 7-day grace period itself (that happened server-side,
            in entitlement.server.ts, before this page ever ran). */}
        {billingAlert?.status === "PAST_DUE" && (
          <div style={{ padding: "0.9rem 1.1rem", marginBottom: "1rem", borderRadius: "4px", background: "var(--sev-high-bg, #fdefe2)", color: "var(--sev-high, #b5560f)", fontSize: "0.78rem", letterSpacing: "0.03em" }}>
            We couldn&apos;t process your last payment. You have {billingAlert.graceDaysRemaining} {billingAlert.graceDaysRemaining === 1 ? "day" : "days"} left to update your payment method before access pauses.
            {" "}
            <button
              type="button"
              onClick={handleManageMembership}
              disabled={openingPortal}
              style={{ marginLeft: "0.4rem", padding: "0.2rem 0.6rem", fontSize: "0.72rem", letterSpacing: "0.05em", background: "transparent", color: "inherit", border: "1px solid currentColor", borderRadius: "2px", cursor: openingPortal ? "default" : "pointer" }}
            >
              {openingPortal ? "Opening…" : "Update payment method"}
            </button>
          </div>
        )}

        {/* ── Pending asynchronous-payment notice (RETURNING visit) ────── */}
        {/* Distinct from the one-time checkoutOutcome=="success" banner
            above: that one covers the moment right after the Stripe
            redirect, while the payment method a customer chose (e.g. a
            bank debit) can take several business days to actually clear —
            long after they've left this page. This covers a LATER visit,
            with no checkout= param at all, while that same attempt is
            still genuinely pending (Subscription.status === "INCOMPLETE"),
            so they never wonder whether they need to try again. Suppressed
            whenever the one-time redirect banner is already showing, to
            avoid saying the same thing twice in one view. */}
        {billingAlert?.status === "PAYMENT_PENDING" && checkoutOutcome === null && (
          <div style={{ padding: "0.9rem 1.1rem", marginBottom: "1rem", borderRadius: "4px", background: "var(--fg-05, #f0f0f0)", color: "var(--fg)", fontSize: "0.78rem", letterSpacing: "0.03em" }}>
            Your membership payment is still processing — some payment methods (like bank transfers) can take a
            few business days to clear. We&apos;ll activate your membership automatically the moment it does. If
            this has been more than a few days, please contact support.
          </div>
        )}

        {/* ── Membership header ─────────────────────────────────────── */}
        <section className="mn-section">
          <div className="mn-section-body">
            <div style={{ fontFamily: "var(--ff-display)", fontWeight: 300, fontSize: "1.5rem", letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg)" }}>
              nAia Membership
            </div>
            <div style={{ marginTop: "0.4rem", fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.08em" }}>
              {pricing}
            </div>
            {/* ── Checkout not yet available (no approved Terms version) ──
                Correctness review, 2026-11-17: api.billing-checkout.tsx
                now fails closed (503 terms_not_configured) whenever
                CURRENT_TERMS_VERSION is null — showing a working-looking
                disclosure, checkboxes, and enabled buttons here would
                walk the customer straight into that wall, and would make
                the placeholder consent wording look like an effective,
                activated checkout flow rather than what it actually is:
                prepared, but not yet legally approved. This notice is
                the explicit, honest alternative — distinct from the
                normal flow below, never shown at the same time as it. */}
            {showSubscribeButtons && !termsConfigured && (
              <div style={{ marginTop: "1rem", fontSize: "0.78rem", color: "var(--fg-55)", letterSpacing: "0.03em", lineHeight: 1.6, maxWidth: "32rem" }}>
                Membership subscriptions aren&apos;t open yet — final Terms of Service approval is pending. Check
                back soon.
              </div>
            )}
            {showSubscribeButtons && termsConfigured && (
              <>
                {/* ── Price, tax, recurring-billing, cancellation and
                    payment-obligation disclosure — shown before either
                    plan button, not after choosing one, since it applies
                    identically to both. Figures (AED 39/299) are read
                    from membershipPricing above, never hardcoded here, so
                    this can never drift from what Stripe actually
                    charges. Cancellation wording describes this app's own
                    tracked cancelAtPeriodEnd behaviour (entitlement.
                    server.ts) — the live Stripe Customer Portal's own
                    cancellation default is a Dashboard configuration this
                    code has never set or verified; if that configuration
                    ever diverges from "cancel at period end," this copy
                    needs updating to match. Tax wording states the
                    tax-inclusive pricing mechanism (tax_behavior:
                    "inclusive" + automatic_tax, already configured) —
                    it is not a claim of registered compliance in every
                    jurisdiction; UK VAT/Ireland OSS registration remains
                    pending and separate, per Founder Decision 18. */}
                <div style={{ marginTop: "1rem", fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.03em", lineHeight: 1.6, maxWidth: "32rem" }}>
                  The price shown already includes any applicable tax. Whichever plan you choose below renews
                  automatically at that price every billing period until you cancel. You can cancel anytime from
                  your account&apos;s billing settings — access continues until the end of the period you&apos;ve
                  already paid for. Your payment method is charged when you confirm.
                </div>
                <div style={{ marginTop: "0.85rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.78rem" }}>
                  <TermsAcceptanceCheckbox checked={termsAccepted} onChange={setTermsAccepted} />
                  <EarlyServiceConsentCheckbox checked={earlyServiceConsent} onChange={setEarlyServiceConsent} />
                  {/* Decision 2 (2026-11-17) — "if early start is not
                      requested, do not activate paid service silently."
                      Unchecked is the DelayedStartNotice branch: plain
                      service-start/first-billing dates, computed fresh on
                      every render (today's date, never stale), so
                      unchecking never reads as "nothing happens." Checked
                      is the existing immediate-activation path above —
                      unchanged. */}
                  {!earlyServiceConsent && <DelayedStartNotice dates={computeDelayedStart(new Date())} />}
                  <ServicePerformanceAcknowledgement />
                </div>
              </>
            )}
            {showSubscribeButtons && termsConfigured && (
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => handleSubscribe("MONTHLY")}
                  disabled={subscribing !== null || !termsAccepted}
                  style={{
                    padding: "0.65rem 1.4rem",
                    fontSize: "0.72rem",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    background: "var(--fg)",
                    color: "var(--bg, #fff)",
                    border: "none",
                    borderRadius: "2px",
                    cursor: subscribing !== null ? "default" : "pointer",
                    opacity: subscribing !== null ? 0.6 : 1,
                  }}
                >
                  {subscribing === "MONTHLY" ? "Starting checkout…" : `Subscribe Monthly — AED ${membershipPricing.monthly.amount}`}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubscribe("ANNUAL")}
                  disabled={subscribing !== null || !termsAccepted}
                  style={{
                    padding: "0.65rem 1.4rem",
                    fontSize: "0.72rem",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    background: "transparent",
                    color: "var(--fg)",
                    border: "1px solid var(--fg-40, var(--fg-55))",
                    borderRadius: "2px",
                    cursor: subscribing !== null ? "default" : "pointer",
                    opacity: subscribing !== null ? 0.6 : 1,
                  }}
                >
                  {subscribing === "ANNUAL" ? "Starting checkout…" : `Choose Annual — AED ${membershipPricing.annual.amount}`}
                </button>
              </div>
            )}
            {subscribeError && (
              <div style={{ marginTop: "0.6rem", fontSize: "0.72rem", color: "var(--c-alert, #c0392b)", letterSpacing: "0.03em" }}>
                {subscribeError}
              </div>
            )}
          </div>
        </section>

        {isMember ? (
          <>
            {/* ── This Month ──────────────────────────────────────────── */}
            <Section title="This Month" right={`Usage resets ${styleMe.resetDate}`}>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <UsageRow
                  label="StyleMe"
                  value={smValue}
                  bar={{ used: styleMe.monthlyUsed, limit: styleMe.monthlyLimit, exhausted: smExhausted }}
                />
                <UsageRow
                  label="Buy or Skip"
                  value={bsValue}
                  bar={{ used: buySkip.monthlyUsed, limit: buySkip.monthlyLimit, exhausted: bsExhausted }}
                />
                <UsageRow
                  label="Virtual Try-On"
                  value={vtoValue}
                  sub={vtoSub}
                  bar={{ used: vtoUsed, limit: vto.monthlyLimit, exhausted: vtoExhausted }}
                />
                <UsageRow
                  label="Personalised Trend Edit"
                  value={trendEditValue}
                  bar={personalisedTrend.monthlyLimit > 0
                    ? { used: personalisedTrend.monthlyUsed, limit: personalisedTrend.monthlyLimit, exhausted: trendEditExhausted }
                    : undefined}
                  last
                />
              </div>
            </Section>

            {/* ── My Closet ──────────────────────────────────────────── */}
            <Section title="My Closet">
              <UsageRow
                label="Items"
                value={closetValue}
                sub={closetExhausted ? "Closet full — remove items to add more" : undefined}
                bar={{ used: closet.currentCount, limit: closet.limit, exhausted: closetExhausted }}
              />
              <div style={{ marginTop: "0.75rem" }}>
                <Link to="/closet" style={{ fontSize: "0.72rem", letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "underline", color: "var(--fg-55)" }}>
                  Manage Closet
                </Link>
              </div>
            </Section>
          </>
        ) : (
          /* ── NONE: what's included ─────────────────────────────────── */
          <Section title="What you get">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {[
                "StyleMe — 8 sessions/month",
                "Buy or Skip — 5 checks/month",
                "Virtual Try-On — 10/month",
                "Personalised Trend Edit — 1/month",
                "Closet — 250 items",
                "Full Style Passport",
                "What nAia Is Noticing",
                "Personal style learning",
                "StyleMe history",
              ].map((item) => (
                <div key={item} style={{ fontSize: "0.82rem", color: "var(--fg-80, var(--fg))", letterSpacing: "0.03em", lineHeight: 1.5 }}>
                  {item}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Add-ons ────────────────────────────────────────────────── */}
        <Section title="Add-ons" right="Coming soon">
          <div style={{ display: "flex", flexDirection: "column" }}>
            {addonCatalog.map((addon, i) => (
              <div key={addon.label}>
                {addon.separator && (
                  <div style={{ borderTop: "1px solid var(--fg-10)", margin: "0.5rem 0" }} />
                )}
                <div style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "0.55rem 0",
                  borderBottom: i < addonCatalog.length - 1 && !addonCatalog[i + 1]?.separator
                    ? "1px solid var(--fg-05, var(--fg-10))"
                    : "none",
                }}>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "var(--fg)", letterSpacing: "0.04em" }}>{addon.label}</span>
                    <span style={{ marginLeft: "0.6rem", fontSize: "0.68rem", color: "var(--fg-55)", letterSpacing: "0.03em" }}>{addon.description}</span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.05em", whiteSpace: "nowrap", flexShrink: 0 }}>{addon.price}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Included with nAia (MEMBER only) ───────────────────────── */}
        {isMember && (
          <Section title="Included with nAia">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[
                "Full Style Passport",
                "Closet — 250 items",
                "What nAia Is Noticing",
                "Personal style learning",
                "StyleMe history",
              ].map((item) => (
                <div key={item} style={{ fontSize: "0.82rem", color: "var(--fg-80, var(--fg))", letterSpacing: "0.03em", lineHeight: 1.5 }}>
                  {item}
                </div>
              ))}
            </div>
            <div style={{ marginTop: "1.25rem", fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.05em", borderTop: "1px solid var(--fg-08, var(--fg-10))", paddingTop: "1rem" }}>
              Public Trend Reports are free for everyone.
            </div>
          </Section>
        )}

        {/* ── Manage Membership (has a real billing account, any
            membership tier — see showManageMembership above) ─────────── */}
        {showManageMembership && (
          <Section title="Membership">
            <button
              type="button"
              onClick={handleManageMembership}
              disabled={openingPortal}
              style={{
                padding: "0.65rem 1.4rem",
                fontSize: "0.72rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: "transparent",
                color: "var(--fg)",
                border: "1px solid var(--fg-40, var(--fg-55))",
                borderRadius: "2px",
                cursor: openingPortal ? "default" : "pointer",
                opacity: openingPortal ? 0.6 : 1,
              }}
            >
              {openingPortal ? "Opening…" : "Manage Membership"}
            </button>
            <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", color: "var(--fg-55)", letterSpacing: "0.03em" }}>
              Update your payment method, view invoices, or cancel your membership.
            </div>
            {portalError && (
              <div style={{ marginTop: "0.6rem", fontSize: "0.72rem", color: "var(--c-alert, #c0392b)", letterSpacing: "0.03em" }}>
                {portalError}
              </div>
            )}
          </Section>
        )}

        {!isMember && (
          <div style={{ paddingTop: "0.5rem", paddingBottom: "1.5rem", fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.05em" }}>
            Public Trend Reports are free for everyone.
          </div>
        )}

      </div>
    </MyNaiaLayout>
  );
}
