import { Link, useLoaderData, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "~/lib/cloudinary-admin.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "My Decisions | nAia" }];
}

function buildOutcomeSummary(
  outcome: { decision: string; postPurchaseOutcome: string | null } | null | undefined,
): string | null {
  if (!outcome) return null;
  const DECISION: Record<string, string> = {
    BOUGHT_IT:      "BOUGHT IT",
    DIDNT_BUY_IT:   "DIDN'T BUY IT",
    STILL_DECIDING: "STILL DECIDING",
  };
  const POST: Record<string, string> = {
    LOVE_IT:     "LOVE IT",
    ITS_OKAY:    "IT'S OKAY",
    RETURNED_IT: "RETURNED IT",
  };
  const dLabel = DECISION[outcome.decision] ?? outcome.decision;
  if (
    outcome.decision === "BOUGHT_IT" &&
    outcome.postPurchaseOutcome &&
    POST[outcome.postPurchaseOutcome]
  ) {
    return `${dLabel} · ${POST[outcome.postPurchaseOutcome]}`;
  }
  return dLabel;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const cloudinaryConfig = getCloudinaryConfig();

  const analyses = await prisma.buyOrSkipAnalysis.findMany({
    where: { customerId: naiaCustomer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      imageUrl: true,
      imagePublicId: true,
      imageFormat: true,
      verdict: true,
      confidence: true,
      category: true,
      reasoning: true,
      outcome: {
        select: { decision: true, postPurchaseOutcome: true },
      },
    },
  });

  return data({
    decisions: analyses.map(a => {
      // Prefer private signed URL; fall back to stored imageUrl for pre-S0 analyses.
      let resolvedImageUrl: string | null = null;
      if (a.imagePublicId && a.imageFormat && cloudinaryConfig) {
        const ownership = validatePublicIdOwnership(a.imagePublicId, naiaCustomer.id);
        if (ownership.ok) {
          resolvedImageUrl = buildPrivateDownloadUrl(
            cloudinaryConfig, a.imagePublicId, a.imageFormat, "private",
          );
        }
      }
      if (!resolvedImageUrl && a.imageUrl) resolvedImageUrl = a.imageUrl;

      return {
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        resolvedImageUrl,
        verdict: a.verdict,
        confidence: a.confidence,
        category: a.category,
        reasoning: a.reasoning,
        outcomeSummary: buildOutcomeSummary(a.outcome),
      };
    }),
  });
}

export default function BuyingDecisions() {
  const { decisions } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout compact>
      <Link to="/my-naia" className="mn-back-link">← Back to Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Buy or Skip</div>
        <h1 className="sp-shell-title">My Decisions</h1>
        <p className="sp-shell-desc">
          Every item nAia has assessed for you. Tap any decision to review the full recommendation.
        </p>
      </div>

      {decisions.length === 0 ? (
        <div className="bos-decisions-empty">
          <p className="bos-decisions-empty-text">No decisions yet.</p>
          <Link to="/buyskip" className="sp-btn-primary">Assess Your First Piece</Link>
        </div>
      ) : (
        <div className="bos-decisions-grid">
          {decisions.map(d => (
            <Link key={d.id} to={`/buyskip/${d.id}`} className="bos-decision-card">
              <div className="bos-decision-thumb-wrap">
                {d.resolvedImageUrl
                  ? <img src={d.resolvedImageUrl} alt="Assessed item" className="bos-decision-thumb" />
                  : <div className="bos-decision-thumb-placeholder">◇</div>
                }
              </div>
              <div className="bos-decision-body">
                <div className={`bos-decision-verdict bos-decision-verdict--${d.verdict.toLowerCase()}`}>
                  {d.verdict}
                </div>
                {d.category && <div className="bos-decision-category">{d.category}</div>}
                {d.outcomeSummary && (
                  <div className="bos-decision-outcome" data-testid="bos-decision-outcome">
                    {d.outcomeSummary}
                  </div>
                )}
                <div className="bos-decision-date">
                  {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div style={{ marginTop: "40px" }}>
        <Link to="/buyskip" className="sp-btn-primary">Assess Another Piece</Link>
      </div>
    </MyNaiaLayout>
  );
}
