import { useState, useEffect } from "react";
import {
  Link,
  useLoaderData,
  useFetcher,
  useRevalidator,
  type ActionFunctionArgs,
  type LinksFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { data } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { withTransientRetry } from "~/lib/prisma-transient-retry.server";
import prisma from "~/db.server";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  validateImageUrlOwnership,
  buildPrivateDownloadUrl,
} from "~/lib/cloudinary-admin.server";
import { deleteOneBosDecision } from "~/lib/buy-or-skip-privacy.server";
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

  const analyses: Array<{
    id: string;
    createdAt: Date;
    imageUrl: string | null;
    imagePublicId: string | null;
    imageFormat: string | null;
    verdict: string;
    confidence: number | null;
    category: string | null;
    reasoning: string;
    outcome: { decision: string; postPurchaseOutcome: string | null } | null;
    // Plain, standalone, read-only list query — never inside a
    // $transaction, never followed by a write in this branch — safe to
    // retry once on a transient connection-pool error (see
    // prisma-transient-retry.server.ts's own caller contract).
  }> = await withTransientRetry(() =>
    prisma.buyOrSkipAnalysis.findMany({
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
    }),
  );

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
      if (!resolvedImageUrl && a.imageUrl && validateImageUrlOwnership(a.imageUrl, naiaCustomer.id)) {
        resolvedImageUrl = a.imageUrl;
      }

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

// Deletes one complete Buy or Skip decision/history entry. Distinct from
// Settings & Privacy's "Remove all images" (which clears uploaded images only
// and keeps decisions, recommendations, and history) — this removes the
// decision itself, scoped to the authenticated customer.
export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "delete-decision") {
    return data({ ok: false as const, error: "Invalid request." }, { status: 400 });
  }

  const analysisId = formData.get("analysisId");
  if (typeof analysisId !== "string" || !analysisId) {
    return data({ ok: false as const, error: "Invalid request." }, { status: 400 });
  }

  const result = await deleteOneBosDecision(analysisId, naiaCustomer.id);
  if (!result.deleted) {
    return data({ ok: false as const, error: "Decision not found." }, { status: 404 });
  }

  return data({ ok: true as const, analysisId });
}

export default function BuyingDecisions() {
  const { decisions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [pending, setPending] = useState<string | null>(null);

  const isSubmitting = fetcher.state !== "idle";
  const actionData = fetcher.data;

  useEffect(() => {
    if (actionData?.ok) {
      setPending(null);
      revalidator.revalidate();
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmRemove = () => {
    if (!pending) return;
    fetcher.submit({ intent: "delete-decision", analysisId: pending }, { method: "post" });
  };

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
            <div key={d.id} className="bos-decision-card-wrap">
              <Link to={`/buyskip/${d.id}`} className="bos-decision-card">
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
              <button
                type="button"
                className="bos-decision-remove"
                aria-label="Remove this decision"
                onClick={() => setPending(d.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "40px" }}>
        <Link to="/buyskip" className="sp-btn-primary">Assess Another Piece</Link>
      </div>

      {/* ── Confirmation modal ────────────────────────────────────────────── */}
      {pending && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="bos-decision-confirm-title">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Confirm</div>
            <h3 id="bos-decision-confirm-title" className="dc-modal-title">Remove this decision?</h3>
            <p className="dc-modal-desc">
              This will remove this Buy or Skip decision from your history.
            </p>
            <div className="dc-modal-actions">
              <button
                type="button"
                className="sp-btn-ghost"
                onClick={() => setPending(null)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sp-btn-primary"
                disabled={isSubmitting}
                onClick={confirmRemove}
              >
                {isSubmitting ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
