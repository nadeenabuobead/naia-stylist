import { Link, useLoaderData, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

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
    },
  });

  // Not found or belongs to another customer — redirect rather than 404 to avoid leaking existence
  if (!analysis || analysis.customerId !== naiaCustomer.id) {
    return redirect("/my-naia/buying-decisions");
  }

  return data({
    id: analysis.id,
    createdAt: analysis.createdAt.toISOString(),
    imageUrl: analysis.imageUrl,
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
  });
}

function cap(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// TEMP-DEPLOY-MARKER: remove before final merge — used to verify which JS bundle staging serves
const DEPLOY_BUILD = "bos-fix-2026-08-03-v4";

export default function BuyOrSkipResult() {
  const analysis = useLoaderData<typeof loader>();
  const fa = analysis.fullAnalysis;

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
        {/* TEMP-DEPLOY-MARKER: remove before final merge */}
        <p style={{ fontSize: "10px", fontFamily: "monospace", color: "rgba(0,0,0,0.35)", marginTop: "4px", letterSpacing: "0.05em" }}>
          {DEPLOY_BUILD} · {displayVerdict}
        </p>
      </div>

      {/* ── Desktop hero: image left, verdict + summary right ──────────────── */}
      <div className="bos-result-hero">
        {/* Left: image + tags */}
        {analysis.imageUrl && (
          <div className="bos-result-hero-image">
            <img
              src={analysis.imageUrl}
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
            {typeof confidence === "number" && confidence > 0 && (
              <span className="bos-verdict-match"> — {confidence}% MATCH</span>
            )}
          </div>
          {finalThought && (
            <p className="bos-result-summary">{finalThought}</p>
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

        {/* ── NADINE section — only shown when AI returns a genuine complement ── */}
        {naiaMatch && (
          <div className="bos-result-section bos-result-section--nadine">
            <div className="bos-result-section-label">Pair It With NADINE</div>
            <div className="bos-naia-inner">
              {typeof naiaMatch === "object" && naiaMatch.imageUrl && (
                <a
                  href={typeof naiaMatch === "object" && naiaMatch.url ? naiaMatch.url : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="bos-naia-img-link"
                  aria-label={`Shop ${typeof naiaMatch === "object" ? naiaMatch.title : naiaMatch}`}
                >
                  <img
                    src={naiaMatch.imageUrl}
                    alt={typeof naiaMatch === "object" ? naiaMatch.title : String(naiaMatch)}
                    className="bos-naia-img"
                  />
                </a>
              )}
              <div className="bos-naia-details">
                <div className="bos-naia-title">
                  {typeof naiaMatch === "object" ? naiaMatch.title : naiaMatch}
                </div>
                {typeof naiaMatch === "object" && naiaMatch.reason && (
                  <div className="bos-naia-reason">{naiaMatch.reason}</div>
                )}
                {typeof naiaMatch === "object" && naiaMatch.url && (
                  <a
                    href={naiaMatch.url}
                    target="_blank"
                    rel="noreferrer"
                    className="bos-naia-link"
                  >
                    Shop This Piece →
                  </a>
                )}
              </div>
            </div>
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

        <div className="sp-actions" style={{ marginTop: "40px" }}>
          <Link to="/buyskip" className="sp-btn-primary">Assess Another Piece</Link>
          <Link to="/my-naia/buying-decisions" className="sp-btn-outline">View All Decisions</Link>
        </div>
      </section>
    </MyNaiaLayout>
  );
}
