import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

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

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const decisions = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId: customer.id },
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      productName: true,
      verdict: true,
      createdAt: true,
      fitsHerStyle: true,
      styleNotes: true,
    },
  });
  return { decisions };
}

export default function BuyingDecisionsPage() {
  const { decisions } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              <div className="mn-eyebrow">Buy or Skip</div>
              <h1
                style={{
                  fontFamily: "var(--ff-display)",
                  fontWeight: 200,
                  marginTop: "0.75rem",
                  fontSize: "clamp(1.875rem, 5vw, 2.5rem)",
                  lineHeight: 1,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                Buying Decisions
              </h1>
            </div>
            <Link to="/my-naia/buy-or-skip" className="mn-btn-primary" style={{ flexShrink: 0 }}>
              Start a New Decision
            </Link>
          </div>
          <p
            style={{
              marginTop: "1rem",
              maxWidth: "42rem",
              fontSize: "0.9rem",
              lineHeight: 1.75,
              color: "var(--fg-75)",
            }}
          >
            A record of every time you asked nAia whether to buy or skip a piece.
          </p>
        </section>

        {decisions.length === 0 ? (
          <p className="mn-state-note">
            No decisions yet. The next time you&#8217;re unsure about a purchase, let nAia weigh in.
          </p>
        ) : (
          <section>
            <div className="mn-section-head">
              <div className="mn-eyebrow">{decisions.length} {decisions.length === 1 ? "Decision" : "Decisions"}</div>
            </div>

            <div className="mn-section-body">
              <div className="mn-decision-list">
                {decisions.map((item) => (
                  <div key={item.id} className="mn-decision-row">
                    <div className="mn-decision-info">
                      <div className="mn-decision-date">{fmtDate(item.createdAt)}</div>
                      <div
                        className="mn-decision-product"
                        style={{
                          fontFamily: "var(--ff-display)",
                          fontWeight: 300,
                          fontSize: "1.125rem",
                          letterSpacing: "0.02em",
                          textTransform: "uppercase",
                        }}
                      >
                        {item.productName ?? "Unnamed item"}
                      </div>
                      {item.styleNotes && (
                        <div className="mn-decision-notes">{item.styleNotes}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.75rem", flexShrink: 0 }}>
                      <span className={`mn-verdict-pill ${VERDICT_CSS[item.verdict] ?? "mn-verdict-skip"}`}>
                        {VERDICT_LABELS[item.verdict] ?? item.verdict}
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="mn-btn-outline"
                          style={{ padding: "0.375rem 0.75rem", fontSize: "0.62rem" }}
                        >
                          View Assessment
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </MyNaiaLayout>
  );
}
