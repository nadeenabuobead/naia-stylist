// app/routes/my-naia.plan-usage.tsx
// /my-naia/plan-usage — nAia Membership account page.
// Shows membership allowances, monthly usage, closet capacity, and add-on catalog.
// Billing, purchase flows, renewal dates and subscription state are intentionally absent.

import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs, LinksFunction } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import { MEMBERSHIP_PRICING, ADDON_CATALOG } from "~/lib/plan/plan-limits.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

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
  return { summary, membershipPricing: MEMBERSHIP_PRICING, addonCatalog };
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
  const { summary, membershipPricing, addonCatalog } = useLoaderData<typeof loader>();
  const { membershipStatus, styleMe, buySkip, vto, closet, personalisedTrend } = summary;
  const isMember = membershipStatus === "MEMBER";
  const pricing = `AED ${membershipPricing.monthly.amount}/month · AED ${membershipPricing.annual.amount}/year`;

  // ── StyleMe
  const smValue = usageLabel(styleMe.monthlyUsed, styleMe.monthlyLimit, "sessions");
  const smExhausted = styleMe.monthlyUsed >= styleMe.monthlyLimit;

  // ── Buy or Skip
  const bsValue = usageLabel(buySkip.monthlyUsed, buySkip.monthlyLimit, "checks");
  const bsExhausted = buySkip.monthlyUsed >= buySkip.monthlyLimit;

  // ── VTO
  const vtoUsed = vto.monthlyCompleted;
  const vtoExhausted = vtoUsed >= vto.monthlyLimit;
  const vtoValue = usageLabel(vtoUsed, vto.monthlyLimit, "try-ons");
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

        {/* ── Membership header ─────────────────────────────────────── */}
        <section className="mn-section">
          <div className="mn-section-body">
            <div style={{ fontFamily: "var(--ff-display)", fontWeight: 300, fontSize: "1.5rem", letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg)" }}>
              nAia Membership
            </div>
            <div style={{ marginTop: "0.4rem", fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.08em" }}>
              {pricing}
            </div>
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

        {!isMember && (
          <div style={{ paddingTop: "0.5rem", paddingBottom: "1.5rem", fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.05em" }}>
            Public Trend Reports are free for everyone.
          </div>
        )}

      </div>
    </MyNaiaLayout>
  );
}
