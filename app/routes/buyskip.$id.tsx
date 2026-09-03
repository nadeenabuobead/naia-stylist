import { Link, useLoaderData, useFetcher, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { useState, useEffect } from "react";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "~/lib/cloudinary-admin.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { VtoExperience } from "~/components/VtoExperience";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta({ data: loaderData }: any) {
  const verdict = (loaderData as any)?.verdict ?? "Decision";
  return [{ title: `${verdict} | Buy or Skip | nAia` }];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const { id } = params;

  if (!id) return redirect("/buyskip");

  const analysis = await prisma.buyOrSkipAnalysis.findUnique({
    where: { id },
    select: {
      id: true,
      customerId: true,
      createdAt: true,
      imageUrl: true,
      imagePublicId: true,
      imageFormat: true,
      verdict: true,
      reasoning: true,
      confidence: true,
      category: true,
      colors: true,
      forOccasion: true,
      whatLike: true,
      unsureAbout: true,
      colorNote: true,
      itemSize: true,
      fullAnalysis: true,
      outcome: {
        select: {
          decision: true,
          postPurchaseOutcome: true,
        },
      },
    },
  });

  // Not found or belongs to another customer — redirect rather than 404 to avoid leaking existence
  if (!analysis || analysis.customerId !== naiaCustomer.id) {
    return redirect("/my-naia/buying-decisions");
  }

  // Generate a short-lived signed URL for the item image.
  // S0 records: use imagePublicId + imageFormat — never expose the raw private asset.
  // Legacy records: fall back to imageUrl (public CDN URL stored at creation time).
  let itemImageUrl: string | null = null;
  if (analysis.imagePublicId && analysis.imageFormat) {
    const cfg = getCloudinaryConfig();
    if (cfg) {
      // Re-verify ownership before generating the signed URL — prevents a DB-level
      // corruption from leaking another customer's image.
      const ownership = validatePublicIdOwnership(analysis.imagePublicId, naiaCustomer.id);
      if (ownership.ok) {
        itemImageUrl = buildPrivateDownloadUrl(cfg, analysis.imagePublicId, analysis.imageFormat, "private");
      }
    }
  } else if (analysis.imageUrl) {
    // Legacy record — imageUrl was persisted before S0; use it for backward compatibility.
    itemImageUrl = analysis.imageUrl;
  }

  const vtoEnabled = process.env.VTO_UI_ENABLED === "true";
  // VTO requires: S0 pipeline (imagePublicId) + completed AI analysis (verdict + fullAnalysis).
  // imagePublicId alone is not sufficient — the analysis must have completed successfully.
  const vtoSupported = !!(
    analysis.imagePublicId &&
    analysis.imageFormat &&
    analysis.verdict &&
    analysis.fullAnalysis
  );
  const naiaModel = vtoEnabled && vtoSupported ? await loadNaiaModel(naiaCustomer.id) : null;
  const naiaModelIsReady = computeModelReadinessFromRecord(naiaModel).isReadyForTryOn;

  return data({
    id: analysis.id,
    createdAt: analysis.createdAt.toISOString(),
    itemImageUrl,
    verdict: analysis.verdict,
    reasoning: analysis.reasoning,
    confidence: analysis.confidence,
    category: analysis.category,
    colors: analysis.colors,
    forOccasion: analysis.forOccasion,
    whatLike: analysis.whatLike,
    unsureAbout: analysis.unsureAbout,
    colorNote: analysis.colorNote,
    itemSize: analysis.itemSize,
    fullAnalysis: analysis.fullAnalysis as Record<string, any> | null,
    vtoEnabled,
    vtoSupported,
    naiaModelIsReady,
    outcome: analysis.outcome ?? null,
  });
}

function cap(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Outcome helpers ───────────────────────────────────────────────────────────
const OUTCOME_DECISION_LABELS: Record<string, string> = {
  "bought-it":      "I BOUGHT IT",
  "didnt-buy-it":   "I DIDN'T BUY IT",
  "still-deciding": "STILL DECIDING",
};
const OUTCOME_POST_LABELS: Record<string, string> = {
  "love-it":     "LOVE IT",
  "its-okay":    "IT'S OKAY",
  "returned-it": "RETURNED IT",
};

function dbDecisionToClient(d: string): string {
  if (d === "BOUGHT_IT") return "bought-it";
  if (d === "DIDNT_BUY_IT") return "didnt-buy-it";
  if (d === "STILL_DECIDING") return "still-deciding";
  return "";
}
function dbPostOutcomeToClient(p: string | null | undefined): string | null {
  if (p === "LOVE_IT") return "love-it";
  if (p === "ITS_OKAY") return "its-okay";
  if (p === "RETURNED_IT") return "returned-it";
  return null;
}

export default function BuyOrSkipResult() {
  const analysis = useLoaderData<typeof loader>();
  const fa = analysis.fullAnalysis;

  // ── Outcome UX state ──────────────────────────────────────────────────────
  const loaderOutcome = (analysis as any).outcome as { decision: string; postPurchaseOutcome: string | null } | null ?? null;
  const outcomeFetcher = useFetcher<{ success?: boolean; error?: string }>();

  const [outcomeDecision, setOutcomeDecision] = useState<string | null>(
    loaderOutcome ? dbDecisionToClient(loaderOutcome.decision) : null,
  );
  const [outcomePost, setOutcomePost] = useState<string | null>(
    loaderOutcome ? dbPostOutcomeToClient(loaderOutcome.postPurchaseOutcome) : null,
  );
  // Start in editing mode when no saved outcome exists
  const [isOutcomeEditing, setIsOutcomeEditing] = useState<boolean>(!loaderOutcome);

  // Collapse to summary on successful save
  useEffect(() => {
    if (outcomeFetcher.data?.success) {
      setIsOutcomeEditing(false);
    }
  }, [outcomeFetcher.data]);

  const isOutcomeSaving = outcomeFetcher.state === "submitting" || outcomeFetcher.state === "loading";
  const outcomeSaveError = outcomeFetcher.data && !outcomeFetcher.data.success
    ? (outcomeFetcher.data.error ?? "Could not save. Please try again.")
    : null;

  function handleOutcomeSave() {
    if (!outcomeDecision) return;
    const body: Record<string, string> = { analysisId: analysis.id, decision: outcomeDecision };
    if (outcomeDecision === "bought-it" && outcomePost) {
      body.postPurchaseOutcome = outcomePost;
    }
    outcomeFetcher.submit(body, {
      method: "POST",
      action: "/api/wishlist?action=outcome",
      encType: "application/json",
    });
  }

  // ── Derived display values ────────────────────────────────────────────────
  // displayVerdict is the single canonical verdict string used for BOTH the badge
  // label and the section heading. Computed once from fullAnalysis.verdict (which
  // preserves "SKIP FOR NOW"), normalised to remove any whitespace variation from
  // AI output. Never re-derived from the DB field separately.
  const displayVerdict = String(
    (fa?.verdict ?? analysis.verdict) ?? ""
  ).trim().replace(/\s+/g, " ").toUpperCase();

  // Deterministic heading — inline mapping so there is no indirection layer
  const analysisHeading =
    displayVerdict === "BUY"
      ? "Why It Works"
      : displayVerdict === "SKIP FOR NOW" || displayVerdict === "MAYBE"
        ? "Why It May Not Work Yet"
        : "Why It Doesn't Work";

  const skipResult = displayVerdict === "SKIP" || displayVerdict === "SKIP FOR NOW";

  const confidence    = fa?.confidence     ?? analysis.confidence;
  const finalThought  = fa?.finalThought   ?? analysis.reasoning;
  const details       = fa?.detailedAnalysis ?? null;
  const naiaMatch     = fa?.naiaMatch      ?? null;
  const styleDNAMatch = fa?.styleDNAMatch  ?? null;
  const occasionFit   = fa?.occasionFit    ?? null;
  const whatLikeEval  = fa?.whatLikeEval   ?? null;
  const concernEval   = fa?.concernEval    ?? null;
  const detectedColor: string | null = typeof fa?.detectedColor === "string" && fa.detectedColor.trim()
    ? fa.detectedColor.trim() : null;
  const stripByBPrefix = (s: string) =>
    s.replace(/^(Fit\s*(?:&|and)\s*Practical\s*Solution|Wearability)\s*:\s*/i, "");
  const beforeYouBuy: string[] = Array.isArray(fa?.beforeYouBuy)
    ? fa.beforeYouBuy
        .filter((s: any) => typeof s === "string" && s.trim())
        .map((s: string) => stripByBPrefix(s.trim()))
    : [];
  const buyIf  = typeof fa?.buyIf  === "string" && fa.buyIf.trim()  ? fa.buyIf.trim()  : null;
  const skipIf = typeof fa?.skipIf === "string" && fa.skipIf.trim() ? fa.skipIf.trim() : null;
  const betterDirection: string | null = typeof fa?.betterDirection === "string" && fa.betterDirection.trim()
    ? fa.betterDirection.trim() : null;

  const displayType = fa?.itemType ?? analysis.category;

  // Customer-selected colours from the form
  const selectedColors: string[] = Array.isArray(analysis.colors) ? analysis.colors : [];
  // Detected colour differs from selected when the AI read a different hue from the image
  const showDetected = detectedColor
    && selectedColors.length > 0
    && !selectedColors.some(c => detectedColor.toLowerCase().includes(c.toLowerCase()));

  const renderablePairings: Array<{ occasion: string | null; name: string; reason: string | null }> = [];
  if (fa?.closetPairings && Array.isArray(fa.closetPairings)) {
    for (const p of fa.closetPairings) {
      if (!p || typeof p !== "object") continue;
      const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
      if (!name) continue;
      renderablePairings.push({
        occasion: typeof p.occasion === "string" && p.occasion.trim() ? p.occasion.trim() : null,
        name,
        reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null,
      });
    }
  }

  const concernSolutions: string[] = Array.isArray(concernEval?.solutions)
    ? concernEval.solutions.filter((s: any) => typeof s === "string" && s.trim())
    : [];

  const formattedDate = new Date(analysis.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <MyNaiaLayout>
      <Link to="/my-naia/buying-decisions" className="sp-back">← All Decisions</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Should I Buy This?</div>
        <h1 className="sp-shell-title">nAia's Recommendation</h1>
        <p className="sp-shell-desc">{formattedDate}</p>
      </div>

      {/* ── Desktop hero: image left, verdict + summary right ──────────────── */}
      <div className="bos-result-hero">
        {/* Left: image + tags */}
        {analysis.itemImageUrl && (
          <div className="bos-result-hero-image">
            <img
              src={analysis.itemImageUrl}
              alt="Item assessed"
              className="bos-result-item-img"
            />
            <div className="bos-result-item-meta">
              {displayType && (
                <span className="bos-result-item-tag">
                  {typeof displayType === "string" ? displayType.toUpperCase() : displayType}
                </span>
              )}
              {selectedColors.length > 0 && (
                <span className="bos-result-item-tag">{selectedColors.join(", ")}</span>
              )}
              {/* Detected colour — only shown when it differs from customer-selected */}
              {showDetected && (
                <span className="bos-result-item-tag bos-result-item-tag--detected">
                  {detectedColor}
                  <span className="bos-result-item-tag-sub">Image-detected colour</span>
                </span>
              )}
              {analysis.itemSize && (
                <span className="bos-result-item-tag">SIZE {analysis.itemSize}</span>
              )}
            </div>
          </div>
        )}

        {/* Right: verdict + match + summary */}
        <div className="bos-result-hero-content">
          <div className="bos-verdict">
            {displayVerdict}
          </div>
          {finalThought && (
            <p className="bos-result-summary">{finalThought}</p>
          )}
          {analysis.vtoEnabled && analysis.vtoSupported && (
            <VtoExperience
              source="buyskip"
              analysisId={analysis.id}
              garmentTitle={analysis.category ? `Your ${String(analysis.category).toLowerCase()}` : "this item"}
              naiaModelIsReady={analysis.naiaModelIsReady}
              isAuthenticated={true}
            />
          )}
        </div>
      </div>

      <section className="bos-section bos-result">

        {/* ── Why It Works / May Not Work Yet / Doesn't Work ───────────────── */}
        <div className="bos-result-section">
          <div className="bos-result-section-label">{analysisHeading}</div>
          <div className="bos-result-section-body">

            {skipResult ? (
              <>
                {/* SKIP / SKIP FOR NOW — fit blockers and practical reality first ──
                    1. Fit & measurement uncertainty (beforeYouBuy[0])
                    2. Wear frequency / lifestyle reality  (beforeYouBuy[1])
                    3. Occasion mismatch — only when occasion does not fit
                    4. Reality check — only when AI disagrees with what customer likes
                    5. Brief positive — only when occasion fits (other factors block)  */}

                {/* 1. Fit blocker */}
                {beforeYouBuy[0] && (
                  <div className="bos-result-section-row">
                    <strong>Fit & Measurements</strong>{" — "}{beforeYouBuy[0]}
                  </div>
                )}

                {/* 2. Wear frequency */}
                {beforeYouBuy[1] && (
                  <div className="bos-result-section-row">
                    <strong>Wear Frequency</strong>{" — "}{beforeYouBuy[1]}
                  </div>
                )}

                {/* 3. Occasion blocker */}
                {(analysis.forOccasion || occasionFit?.occasion) && occasionFit && !occasionFit.fits && (
                  <div className="bos-result-section-row">
                    <strong>
                      Occasion — Not Ideal for{" "}
                      {cap(
                        typeof occasionFit.occasion === "string" && occasionFit.occasion.trim()
                          ? occasionFit.occasion.trim()
                          : analysis.forOccasion
                      )}
                    </strong>
                    {". "}
                    {occasionFit.explanation}
                    {occasionFit.stylingTip && <span>{" "}{occasionFit.stylingTip}</span>}
                  </div>
                )}

                {/* 4. Reality check */}
                {whatLikeEval && (whatLikeEval.agreement === "disagree" || whatLikeEval.agreement === "partly agree") && (
                  <div className="bos-result-section-row">
                    <strong>
                      {cap(whatLikeEval.aspect || analysis.whatLike || "")} — Reality Check
                    </strong>
                    {" — "}
                    {whatLikeEval.explanation}
                  </div>
                )}

                {/* 5. Brief positive — only when occasion fits (other factors block) */}
                {(analysis.forOccasion || occasionFit?.occasion) && occasionFit && occasionFit.fits && (
                  <div className="bos-result-section-row">
                    <strong>
                      Occasion — Works for{" "}
                      {cap(
                        typeof occasionFit.occasion === "string" && occasionFit.occasion.trim()
                          ? occasionFit.occasion.trim()
                          : analysis.forOccasion
                      )}
                    </strong>
                    {", though other factors block this purchase. "}
                    {occasionFit.explanation}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* BUY — positive framing, current order ──────────────────────── */}

                {/* Occasion */}
                {(analysis.forOccasion || occasionFit?.occasion) && occasionFit && (
                  <div className="bos-result-section-row">
                    <strong>
                      Occasion Match — {occasionFit.fits ? "Strong" : "Not Ideal"}{" for "}
                      {cap(
                        typeof occasionFit.occasion === "string" && occasionFit.occasion.trim()
                          ? occasionFit.occasion.trim()
                          : analysis.forOccasion
                      )}
                    </strong>
                    {". "}
                    {occasionFit.explanation}
                    {occasionFit.stylingTip && <span>{" "}{occasionFit.stylingTip}</span>}
                  </div>
                )}

                {styleDNAMatch && (
                  <div className="bos-result-section-row">
                    <strong>Style match</strong>{" — "}{styleDNAMatch}
                  </div>
                )}

                {details?.color && (
                  <div className="bos-result-section-row">
                    <strong>Colour</strong>{" — "}{details.color}
                  </div>
                )}

                {details?.silhouette && (
                  <div className="bos-result-section-row">
                    <strong>Silhouette</strong>{" — "}{details.silhouette}
                  </div>
                )}

                {whatLikeEval && (
                  <div className="bos-result-section-row">
                    <strong>
                      {whatLikeEval.agreement === "disagree"
                        ? `${cap(whatLikeEval.aspect || analysis.whatLike || "")} — Reality Check`
                        : `What you like — ${cap(whatLikeEval.aspect || analysis.whatLike || "")}`
                      }
                    </strong>
                    {" — "}
                    {whatLikeEval.agreement !== "disagree" && `${cap(whatLikeEval.agreement)}. `}
                    {whatLikeEval.explanation}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Before You Buy ──────────────────────────────────────────────────
            SKIP / SKIP FOR NOW: only "Your Concern" when customer entered one.
              Fit & Wearability are already shown as blockers above.
            BUY: all three blocks (Concern + Fit + Wearability).             */}
        {((concernEval && analysis.unsureAbout) || (!skipResult && beforeYouBuy.length > 0)) && (
          <div className="bos-result-section">
            <div className="bos-result-section-label">Before You Buy</div>
            <div className="bos-byb-blocks">

              {/* Your Concern — only when customer entered a concern */}
              {concernEval && analysis.unsureAbout && (
                <div className="bos-byb-block">
                  <div className="bos-byb-block-label">Your Concern</div>
                  <div className="bos-byb-block-verdict">{cap(concernEval.justified)}</div>
                  <div className="bos-byb-block-text">{concernEval.explanation}</div>
                  {concernSolutions.length > 0 && (
                    <ul className="bos-concern-solutions">
                      {concernSolutions.map((s: string, i: number) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Fit & Practical Solution — BUY only (moved to analysis section for SKIP) */}
              {!skipResult && beforeYouBuy[0] && (
                <div className="bos-byb-block">
                  <div className="bos-byb-block-label">Fit & Practical Solution</div>
                  <div className="bos-byb-block-text">{beforeYouBuy[0]}</div>
                </div>
              )}

              {/* Wearability — BUY only (moved to analysis section for SKIP) */}
              {!skipResult && beforeYouBuy[1] && (
                <div className="bos-byb-block">
                  <div className="bos-byb-block-label">Wearability</div>
                  <div className="bos-byb-block-text">{beforeYouBuy[1]}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Wear It With — confirmed closet items only ───────────────────── */}
        {renderablePairings.length > 0 && (
          <div className="bos-result-section">
            <div className="bos-result-section-label">Wear It With</div>
            <ul className="bos-result-reasons">
              {renderablePairings.slice(0, 3).map((p, i) => (
                <li key={i} className="bos-result-reason">
                  <span className="bos-result-reason-dash" aria-hidden />
                  <span>
                    {p.occasion
                      ? <><strong>{p.occasion}</strong>{" — "}{p.name}</>
                      : <strong>{p.name}</strong>
                    }
                    {!p.occasion && p.reason && <span> — {p.reason}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {fa?.fillsGap && (
              <p style={{ color: "var(--naia-accent)", marginTop: "10px", fontSize: "13px" }}>
                ✓ {fa.fillsGap}
              </p>
            )}
          </div>
        )}

        {/* ── Final Condition ───────────────────────────────────────────────── */}
        {(buyIf || skipIf) && (
          <div className="bos-result-section bos-final-condition">
            <div className="bos-result-section-label">Final Condition</div>
            <div className="bos-result-section-body">
              {buyIf && (
                <div className="bos-final-condition-row">
                  <strong>Buy it if</strong> — {buyIf}
                </div>
              )}
              {skipIf && (
                <div className="bos-final-condition-row">
                  <strong>Skip it if</strong> — {skipIf}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── A Better Direction — required for every SKIP / SKIP FOR NOW ───── */}
        {skipResult && (
          <div className="bos-result-section">
            <div className="bos-result-section-label">A Better Direction</div>
            {betterDirection && <p className="bos-better-direction-text">{betterDirection}</p>}
            <Link to="/buyskip" className="bos-better-direction-btn">Analyze a Better Option</Link>
          </div>
        )}

        {/* ── What Happened? — optional customer-reported outcome ────────── */}
        <div className="bos-outcome" data-testid="bos-outcome">
          <div className="bos-outcome-q">WHAT HAPPENED?</div>

          {/* Summary view — shown when outcome is saved and not editing */}
          {!isOutcomeEditing && outcomeDecision && (
            <div className="bos-outcome-summary" data-testid="bos-outcome-summary">
              <div className="bos-outcome-summary-decision" data-testid="bos-outcome-summary-decision">
                {OUTCOME_DECISION_LABELS[outcomeDecision] ?? outcomeDecision}
              </div>
              {outcomeDecision === "bought-it" && outcomePost && (
                <div className="bos-outcome-summary-post" data-testid="bos-outcome-summary-post">
                  {OUTCOME_POST_LABELS[outcomePost] ?? outcomePost}
                </div>
              )}
              {outcomeFetcher.data?.success && (
                <div className="bos-outcome-summary-saved" data-testid="bos-outcome-saved-msg">SAVED</div>
              )}
              <button
                type="button"
                className="bos-outcome-edit-btn"
                onClick={() => setIsOutcomeEditing(true)}
                data-testid="bos-outcome-edit"
              >
                EDIT
              </button>
            </div>
          )}

          {/* Form view — shown when no saved outcome, or when editing */}
          {isOutcomeEditing && (
            <div data-testid="bos-outcome-form">
              <div className="bos-outcome-options">
                {(["bought-it", "didnt-buy-it", "still-deciding"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`bos-outcome-option${outcomeDecision === d ? " bos-outcome-option--selected" : ""}`}
                    onClick={() => {
                      setOutcomeDecision(d);
                      if (d !== "bought-it") setOutcomePost(null);
                    }}
                    data-testid={`bos-outcome-${d}`}
                  >
                    {OUTCOME_DECISION_LABELS[d]}
                  </button>
                ))}
              </div>

              {/* Post-purchase follow-up — only when bought-it is selected */}
              {outcomeDecision === "bought-it" && (
                <div className="bos-outcome-followup" data-testid="bos-outcome-followup">
                  <div className="bos-outcome-followup-q">AND HOW DID IT WORK OUT?</div>
                  <div className="bos-outcome-options">
                    {(["love-it", "its-okay", "returned-it"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`bos-outcome-option${outcomePost === p ? " bos-outcome-option--selected" : ""}`}
                        onClick={() => setOutcomePost(p)}
                        data-testid={`bos-outcome-post-${p}`}
                      >
                        {OUTCOME_POST_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bos-outcome-save-row">
                <button
                  type="button"
                  className="sp-btn-outline"
                  onClick={handleOutcomeSave}
                  disabled={!outcomeDecision || isOutcomeSaving}
                  data-testid="bos-outcome-save"
                >
                  {isOutcomeSaving ? "SAVING..." : "SAVE"}
                </button>
                {outcomeSaveError && (
                  <span className="bos-outcome-error-msg" data-testid="bos-outcome-error">
                    {outcomeSaveError}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sp-actions" style={{ marginTop: "40px" }}>
          <Link to="/buyskip" className="sp-btn-primary">Assess Another Piece</Link>
          <Link to="/my-naia/buying-decisions" className="sp-btn-outline">View All Decisions</Link>
        </div>
      </section>
    </MyNaiaLayout>
  );
}
