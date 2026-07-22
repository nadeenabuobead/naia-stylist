import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const VERDICT_LABELS: Record<string, string> = {
  BUY: "Buy it",
  SKIP: "Skip it",
  MAYBE: "Maybe",
};

const VERDICT_CSS: Record<string, string> = {
  BUY: "mn-verdict-buy",
  SKIP: "mn-verdict-skip",
  MAYBE: "mn-verdict-maybe",
};

const EVIDENCE_ITEMS = [
  "Style Passport",
  "My Closet",
  "Fit & Coverage Preferences",
  "Previous Buy or Skip Decisions",
  "Styling Feedback",
];

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const decisions = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId: customer.id },
    take: 10,
    orderBy: { createdAt: "desc" },
    select: { id: true, productName: true, verdict: true, createdAt: true, fitsHerStyle: true, styleNotes: true },
  });
  return { decisions };
}

export default function MyNaiaBuyOrSkip() {
  const { decisions } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">

        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div className="mn-eyebrow">Buy or Skip</div>
              <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(1.875rem,5vw,2.25rem)", lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                Your Purchase Decisions
              </h1>
            </div>
            <Link to="/buyskip" className="mn-btn-primary" style={{ flexShrink: 0 }}>
              New Decision
            </Link>
          </div>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            When you&#8217;re unsure about a piece, nAia checks it against your style profile,
            wardrobe, and preferences — then tells you whether to buy it or walk away.
          </p>
        </section>

        {decisions.length === 0 ? (
          <>
            <p className="mn-state-note">
              No decisions yet. The next time you&#8217;re unsure about a purchase, let nAia weigh in.
            </p>

            <section className="mn-section">
              <div className="mn-section-head">
                <div className="mn-eyebrow">nAia weighs</div>
              </div>
              <div className="mn-section-body">
                <div className="mn-evidence-chips">
                  {EVIDENCE_ITEMS.map((item) => (
                    <div key={item} className="mn-evidence-chip">
                      <span className="mn-evidence-chip-dot" aria-hidden="true" />
                      {item}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: "2rem" }}>
                  <Link to="/buyskip" className="mn-btn-primary">Start a New Decision</Link>
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="mn-section">
            <div className="mn-section-head">
              <div className="mn-eyebrow">
                {decisions.length} {decisions.length === 1 ? "Decision" : "Decisions"}
              </div>
            </div>
            <div className="mn-section-body">
              <div className="mn-decision-list">
                {decisions.map((item) => (
                  <div key={item.id} className="mn-decision-row">
                    <div className="mn-decision-info">
                      <div className="mn-decision-date">{fmtDate(item.createdAt)}</div>
                      <div className="mn-decision-product">{item.productName ?? "Unnamed item"}</div>
                      {item.styleNotes && (
                        <div className="mn-decision-notes">{item.styleNotes}</div>
                      )}
                    </div>
                    <span className={`mn-verdict-pill ${VERDICT_CSS[item.verdict] ?? "mn-verdict-skip"}`}>
                      {VERDICT_LABELS[item.verdict] ?? item.verdict}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "2.5rem" }}>
                <Link to="/buyskip" className="mn-btn-outline">Start a New Decision</Link>
              </div>
            </div>
          </section>
        )}

      </div>
    </MyNaiaLayout>
  );
}
