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

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const summary = await getEntitlementSummary(customer.id, customer.membershipStatus);
  return { summary };
}

// ── Display helpers ────────────────────────────────────────────────────────────

function UsageBar({ used, limit, exhausted }: { used: number; limit: number; exhausted: boolean }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div style={{ marginTop: "0.5rem" }}>
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
        <div className="mn-eyebrow">{title}</div>
        {right && <div style={{ fontSize: "0.62rem", color: "var(--fg-40, var(--fg-55))", letterSpacing: "0.1em", textTransform: "uppercase" }}>{right}</div>}
      </div>
      <div className="mn-section-body">{children}</div>
    </section>
  );
}

function UsageRow({ label, value, sub, bar }: {
  label: string;
  value: string;
  sub?: string;
  bar?: { used: number; limit: number; exhausted: boolean };
}) {
  return (
    <div style={{ paddingBottom: "1rem", borderBottom: "1px solid var(--fg-08, var(--fg-10))" }}>
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
  const { summary } = useLoaderData<typeof loader>();
  const { membershipStatus, styleMe, buySkip, vto, closet, personalisedTrend } = summary;
  const isMember = membershipStatus === "MEMBER";
  const pricing = `AED ${MEMBERSHIP_PRICING.monthly.amount}/month · AED ${MEMBERSHIP_PRICING.annual.amount}/year`;

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
                  value={personalisedTrend.monthlyLimit > 0 ? "1 included this month" : "Not included"}
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
            {ADDON_CATALOG.map((addon, i) => (
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
                  borderBottom: i < ADDON_CATALOG.length - 1 && !ADDON_CATALOG[i + 1]?.separator
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
