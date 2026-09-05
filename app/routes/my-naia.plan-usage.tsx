// app/routes/my-naia.plan-usage.tsx
// /my-naia/plan-usage — real plan entitlement and usage.
// All values are derived from DB records. Nothing is hardcoded.
// Billing, upgrade flow, payment method and renewal dates are intentionally absent.

import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs, LinksFunction } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import { formatResetDate, getBillingWindow } from "~/lib/plan/billing-window.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const summary = await getEntitlementSummary(customer.id, customer.plan);
  return { summary };
}

// ── Display helpers ────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: "FREE" | "PAID" }) {
  return (
    <span style={{
      display: "inline-block",
      fontFamily: "var(--ff-ui)",
      fontSize: "0.65rem",
      letterSpacing: "0.25em",
      textTransform: "uppercase",
      padding: "0.2em 0.7em",
      border: "1px solid var(--fg-20)",
      borderRadius: "2px",
    }}>
      {plan === "PAID" ? "Paid Plan" : "Free Plan"}
    </span>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = used >= limit;
  return (
    <div style={{ marginTop: "0.5rem" }}>
      <div style={{
        height: "3px",
        background: "var(--fg-10)",
        borderRadius: "2px",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: atLimit ? "var(--c-alert, #c0392b)" : "var(--fg-55)",
          borderRadius: "2px",
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mn-section">
      <div className="mn-section-head">
        <div className="mn-eyebrow">{title}</div>
      </div>
      <div className="mn-section-body">{children}</div>
    </section>
  );
}

function MetricRow({ label, value, sub, bar }: {
  label: string;
  value: string;
  sub?: string;
  bar?: { used: number; limit: number };
}) {
  return (
    <div style={{ paddingBottom: "1.25rem", borderBottom: "1px solid var(--fg-08, var(--fg-10))" }}>
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>
        {label}
      </div>
      <div style={{ marginTop: "0.4rem", fontFamily: "var(--ff-display)", fontWeight: 300, fontSize: "1.35rem", letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--fg)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: "0.3rem", fontSize: "0.68rem", color: "var(--fg-55)", letterSpacing: "0.05em" }}>
          {sub}
        </div>
      )}
      {bar && <UsageBar used={bar.used} limit={bar.limit} />}
    </div>
  );
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function PlanUsagePage() {
  const { summary } = useLoaderData<typeof loader>();
  const { plan, styleMe, buySkip, vto, closet, personalisedTrend, windowLabel } = summary;

  // ── StyleMe copy ──────────────────────────────────────────────────────────
  const styleMeValue = `${styleMe.monthlyUsed} of ${styleMe.monthlyLimit} used`;
  const styleMeSub = styleMe.welcomeAvailable
    ? `Welcome session available · Resets ${styleMe.resetDate}`
    : `Resets ${styleMe.resetDate}`;

  // ── Buy or Skip copy ──────────────────────────────────────────────────────
  let buySkipValue: string;
  let buySkipSub: string | undefined;
  if (plan === "FREE") {
    buySkipValue = buySkip.introAvailable ? "1 introductory check available" : "Introductory check used";
    buySkipSub = undefined;
  } else {
    buySkipValue = `${buySkip.monthlyUsed} of ${buySkip.monthlyLimit} used`;
    buySkipSub = `Resets ${buySkip.resetDate}`;
  }

  // ── VTO copy ──────────────────────────────────────────────────────────────
  const vtoUsedDisplay = vto.monthlyCompleted;
  const vtoInFlightNote = vto.monthlyInFlight > 0 ? ` · ${vto.monthlyInFlight} generating` : "";
  const vtoValue = `${vtoUsedDisplay} of ${vto.monthlyLimit} used`;
  const vtoSub = `${vtoInFlightNote ? vtoInFlightNote.replace(" · ", "") + " · " : ""}Resets ${vto.resetDate}`.trim().replace(/^· /, "");

  // ── Closet copy ───────────────────────────────────────────────────────────
  const closetValue = `${closet.currentCount} of ${closet.limit} items`;
  const closetSub = closet.atCapacity ? "Closet full — remove items to add more" : undefined;

  // ── Trend Edit copy ───────────────────────────────────────────────────────
  const trendValue = personalisedTrend.monthlyLimit > 0 ? "1 included per month" : "Not included in your plan";

  return (
    <MyNaiaLayout>
      <div className="mn-content">

        <Section title="Your Plan">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <PlanBadge plan={plan} />
            <span style={{ fontSize: "0.72rem", color: "var(--fg-55)", letterSpacing: "0.05em" }}>
              {windowLabel}
            </span>
          </div>
        </Section>

        <Section title="Usage This Month">
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            <MetricRow
              label="StyleMe"
              value={styleMeValue}
              sub={styleMeSub}
              bar={{ used: styleMe.monthlyUsed, limit: styleMe.monthlyLimit }}
            />
            <div style={{ paddingTop: "1.25rem" }}>
              <MetricRow
                label="Buy or Skip"
                value={buySkipValue}
                sub={buySkipSub}
                bar={plan === "PAID" && buySkip.monthlyUsed != null && buySkip.monthlyLimit != null
                  ? { used: buySkip.monthlyUsed, limit: buySkip.monthlyLimit }
                  : undefined}
              />
            </div>
            <div style={{ paddingTop: "1.25rem" }}>
              <MetricRow
                label="Virtual Try-On"
                value={vtoValue}
                sub={vtoSub || undefined}
                bar={{ used: vtoUsedDisplay, limit: vto.monthlyLimit }}
              />
            </div>
            <div style={{ paddingTop: "1.25rem" }}>
              <MetricRow
                label="Personalised Trend Edit"
                value={trendValue}
              />
            </div>
          </div>
        </Section>

        <Section title="My Closet">
          <MetricRow
            label="Items"
            value={closetValue}
            sub={closetSub}
            bar={{ used: closet.currentCount, limit: closet.limit }}
          />
          {closet.atCapacity && (
            <div style={{ marginTop: "1rem" }}>
              <Link to="/closet" style={{ fontSize: "0.72rem", letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "underline", color: "var(--fg-55)" }}>
                Manage Closet
              </Link>
            </div>
          )}
        </Section>

      </div>
    </MyNaiaLayout>
  );
}
