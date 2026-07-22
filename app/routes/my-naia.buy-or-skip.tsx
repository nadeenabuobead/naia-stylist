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

export default function MyNaiaBuyOrSkip() {
  const { decisions } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout currentPath="/my-naia/buy-or-skip">

      <section className="mn-section-shell" style={{ borderTop: 0, paddingTop: 0 }}>
        <div className="mn-section-shell-header">
          <div>
            <p className="mn-section-shell-eyebrow">Buy or Skip</p>
            <h1 className="mn-section-shell-title">Your purchase decisions.</h1>
          </div>
          <Link to="/buyskip" className="mn-btn-primary">
            Start a New Decision
          </Link>
        </div>
        <p className="mn-section-shell-desc">
          When you&#8217;re unsure about a piece, nAia checks it against your style profile,
          wardrobe, and preferences — then tells you whether to buy it or walk away.
        </p>
      </section>

      {decisions.length === 0 ? (
        <div>
          <p className="mn-state-note" style={{ marginBottom: "var(--naia-sp-6)" }}>
            No decisions yet. The next time you&#8217;re unsure about a purchase, let
            nAia weigh in.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--naia-sp-3)",
              maxWidth: "32rem",
            }}
          >
            <p
              style={{
                fontFamily: "var(--naia-ff-ui)",
                fontSize: "0.65rem",
                textTransform: "uppercase",
                letterSpacing: "0.28em",
                color: "rgba(34, 21, 22, 0.55)",
                margin: 0,
              }}
            >
              nAia weighs
            </p>
            {[
              "Style Passport",
              "My Closet",
              "Fit & Coverage Preferences",
              "Previous Buy or Skip Decisions",
              "Styling Feedback",
            ].map((item) => (
              <span key={item} className="mn-bos-evidence-chip">
                {item}
              </span>
            ))}
            <div style={{ marginTop: "var(--naia-sp-2)" }}>
              <Link to="/buyskip" className="mn-btn-primary">
                Start a New Decision
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <section className="mn-section-rule">
            <div className="mn-section-rule-header">
              <span className="mn-section-rule-eyebrow">
                {decisions.length} {decisions.length === 1 ? "Decision" : "Decisions"}
              </span>
            </div>
            <div className="mn-decision-list">
              {decisions.map((item) => (
                <div key={item.id} className="mn-decision-row">
                  <p className="mn-decision-date">{fmtDate(item.createdAt)}</p>
                  <p className="mn-decision-product">{item.productName ?? "Unnamed item"}</p>
                  {item.styleNotes && (
                    <p
                      style={{
                        fontFamily: "var(--naia-ff-body)",
                        fontSize: "0.85rem",
                        fontStyle: "italic",
                        lineHeight: "1.6",
                        color: "rgba(34, 21, 22, 0.65)",
                        margin: 0,
                      }}
                    >
                      {item.styleNotes}
                    </p>
                  )}
                  <p className="mn-decision-verdict">
                    {VERDICT_LABELS[item.verdict] ?? item.verdict}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div style={{ marginTop: "var(--naia-sp-8)" }}>
            <Link to="/buyskip" className="mn-btn-outline">
              Start a New Decision
            </Link>
          </div>
        </>
      )}

    </MyNaiaLayout>
  );
}
