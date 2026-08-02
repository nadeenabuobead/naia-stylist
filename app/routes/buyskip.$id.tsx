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

export default function BuyOrSkipResult() {
  const analysis = useLoaderData<typeof loader>();
  const fa = analysis.fullAnalysis;

  // ── Derived display values ────────────────────────────────────────────────
  const verdict       = fa?.verdict        ?? analysis.verdict;
  const confidence    = fa?.confidence     ?? analysis.confidence;
  const finalThought  = fa?.finalThought   ?? analysis.reasoning;
  const details       = fa?.detailedAnalysis ?? null;
  const naiaMatch     = fa?.naiaMatch      ?? null;
  const styleDNAMatch = fa?.styleDNAMatch  ?? null;
  const occasionFit   = fa?.occasionFit    ?? null;
  const whatLikeEval  = fa?.whatLikeEval   ?? null;
  const concernEval   = fa?.concernEval    ?? null;
  const beforeYouBuy: string[] = Array.isArray(fa?.beforeYouBuy)
    ? fa.beforeYouBuy.filter((s: any) => typeof s === "string" && s.trim())
    : [];
  const buyIf  = typeof fa?.buyIf  === "string" && fa.buyIf.trim()  ? fa.buyIf.trim()  : null;
  const skipIf = typeof fa?.skipIf === "string" && fa.skipIf.trim() ? fa.skipIf.trim() : null;

  // Specific item type (AI-detected) takes priority over saved category
  const displayType = fa?.itemType ?? analysis.category;

  const renderablePairings: Array<{ name: string; reason: string | null }> = [];
  if (fa?.closetPairings && Array.isArray(fa.closetPairings)) {
    for (const p of fa.closetPairings) {
      if (!p || typeof p !== "object") continue;
      const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
      if (!name) continue;
      renderablePairings.push({
        name,
        reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null,
      });
    }
  }

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

      {/* Item image — larger, no letterboxing */}
      {analysis.imageUrl && (
        <div className="bos-result-item-wrap">
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
            {analysis.colors?.length > 0 && (
              <span className="bos-result-item-tag">{analysis.colors.join(", ")}</span>
            )}
            {analysis.itemSize && (
              <span className="bos-result-item-tag">SIZE {analysis.itemSize}</span>
            )}
          </div>
        </div>
      )}

      <section className="bos-section bos-result">

        {/* Verdict + match percentage on one line */}
        <div className="bos-verdict">
          {verdict}
          {typeof confidence === "number" && confidence > 0 && (
            <span className="bos-verdict-match"> — {confidence}% MATCH</span>
          )}
        </div>

        {/* Strong practical sentence — style + occasion + main condition */}
        {finalThought && (
          <p className="bos-result-summary">{finalThought}</p>
        )}

        {/* ── Why It Works ─────────────────────────────────────────────── */}
        <div className="bos-result-section">
          <div className="bos-result-section-label">Why It Works</div>
          <div className="bos-result-section-body">
            {/* Occasion evaluated first when customer entered one */}
            {analysis.forOccasion && occasionFit && (
              <div className="bos-result-section-row">
                <strong>For {cap(analysis.forOccasion)}</strong>
                {" — "}
                {occasionFit.fits ? "Yes." : "Not ideal."}{" "}
                {occasionFit.explanation}
                {occasionFit.stylingTip && (
                  <span>{" "}{occasionFit.stylingTip}</span>
                )}
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
                  What you like — {cap(whatLikeEval.aspect || analysis.whatLike || "")}
                </strong>
                {" — "}
                {cap(whatLikeEval.agreement)}.{" "}{whatLikeEval.explanation}
              </div>
            )}
          </div>
        </div>

        {/* ── Before You Buy ───────────────────────────────────────────── */}
        {(concernEval || beforeYouBuy.length > 0) && (
          <div className="bos-result-section">
            <div className="bos-result-section-label">Before You Buy</div>
            <div className="bos-result-section-body">
              {concernEval && (
                <div className="bos-result-section-row">
                  <strong>
                    Your concern — {cap(concernEval.concern || analysis.unsureAbout || "")}
                  </strong>
                  {" — "}
                  {cap(concernEval.justified)}.{" "}{concernEval.explanation}
                </div>
              )}
              {beforeYouBuy.map((point: string, i: number) => (
                <div key={i} className="bos-result-section-row">{point}</div>
              ))}
            </div>
          </div>
        )}

        {/* ── Wear It With — only confirmed closet items, never invented ── */}
        {renderablePairings.length > 0 && (
          <div className="bos-result-section">
            <div className="bos-result-section-label">Wear It With</div>
            <ul className="bos-result-reasons">
              {renderablePairings.slice(0, 3).map((p, i) => (
                <li key={i} className="bos-result-reason">
                  <span className="bos-result-reason-dash" aria-hidden />
                  <span>
                    <strong>{p.name}</strong>
                    {p.reason && <span> — {p.reason}</span>}
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

        {/* ── Pair It With NADINE — visually secondary ─────────────────── */}
        {naiaMatch && (
          <div className="bos-result-section bos-result-section--nadine">
            <div className="bos-result-section-label">Pair It With NADINE</div>
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
        )}

        {/* ── Final Condition ───────────────────────────────────────────── */}
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

        <div className="sp-actions" style={{ marginTop: "40px" }}>
          <Link to="/buyskip" className="sp-btn-primary">Assess Another Piece</Link>
          <Link to="/my-naia/buying-decisions" className="sp-btn-outline">View All Decisions</Link>
        </div>
      </section>
    </MyNaiaLayout>
  );
}
