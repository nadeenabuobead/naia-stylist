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

function ResultBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bos-result-block">
      <div className="bos-result-block-label">{label}</div>
      <div className="bos-result-block-body">{children}</div>
    </div>
  );
}

export default function BuyOrSkipResult() {
  const analysis = useLoaderData<typeof loader>();
  const fa = analysis.fullAnalysis;

  const renderablePairings: Array<{ name: string; reason: string | null }> = [];
  if (fa?.closetPairings && Array.isArray(fa.closetPairings)) {
    for (const p of fa.closetPairings) {
      if (!p || typeof p !== "object") continue;
      const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
      if (!name) continue;
      renderablePairings.push({ name, reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null });
    }
  }

  const occasions: string[] = Array.isArray(fa?.occasions) ? fa.occasions.filter((o: any) => typeof o === "string") : [];
  const verdict = fa?.verdict ?? analysis.verdict;
  const confidence = fa?.confidence ?? analysis.confidence;
  const finalThought = fa?.finalThought ?? analysis.reasoning;
  const details = fa?.detailedAnalysis ?? null;
  const naiaMatch = fa?.naiaMatch ?? null;
  const fillsGap = fa?.fillsGap ?? null;
  const styleDNAMatch = fa?.styleDNAMatch ?? null;

  const formattedDate = new Date(analysis.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <MyNaiaLayout>
      <Link to="/my-naia/buying-decisions" className="sp-back">← All Decisions</Link>

      {/* Section shell */}
      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Should I Buy This?</div>
        <h1 className="sp-shell-title">nAia's Recommendation</h1>
        <p className="sp-shell-desc">{formattedDate}</p>
      </div>

      {/* Item image */}
      {analysis.imageUrl && (
        <div className="bos-result-item-wrap">
          <img
            src={analysis.imageUrl}
            alt="Item assessed"
            className="bos-result-item-img"
          />
          <div className="bos-result-item-meta">
            {analysis.category && <span className="bos-result-item-tag">{analysis.category}</span>}
            {analysis.colors?.length > 0 && (
              <span className="bos-result-item-tag">{analysis.colors.join(", ")}</span>
            )}
          </div>
        </div>
      )}

      {/* Verdict */}
      <section className="bos-section bos-result">
        <div className="bos-verdict">{verdict}</div>
        {typeof confidence === "number" && confidence > 0 && (
          <div className="bos-confidence">{confidence}% confidence</div>
        )}
        {finalThought && (
          <p className="bos-result-summary">{finalThought}</p>
        )}

        {/* Step 2 inputs (if saved) */}
        {(analysis.forOccasion || analysis.whatLike || analysis.unsureAbout) && (
          <div className="bos-result-inputs">
            {analysis.forOccasion  && <div className="bos-result-input-row"><span className="bos-result-input-label">Considering for</span><span>{analysis.forOccasion}</span></div>}
            {analysis.whatLike     && <div className="bos-result-input-row"><span className="bos-result-input-label">What you like</span><span>{analysis.whatLike}</span></div>}
            {analysis.unsureAbout  && <div className="bos-result-input-row"><span className="bos-result-input-label">Unsure about</span><span>{analysis.unsureAbout}</span></div>}
            {analysis.colorNote    && <div className="bos-result-input-row"><span className="bos-result-input-label">Colour</span><span>{analysis.colorNote}</span></div>}
            {analysis.itemSize     && <div className="bos-result-input-row"><span className="bos-result-input-label">Size</span><span>{analysis.itemSize}</span></div>}
          </div>
        )}

        <div className="bos-result-blocks">
          {styleDNAMatch && (
            <ResultBlock label="Style DNA Match">
              <p>{styleDNAMatch}</p>
            </ResultBlock>
          )}
          {details && (
            <ResultBlock label="Why It Does Or Does Not Work">
              {details.silhouette  && <div><strong>Silhouette:</strong> {details.silhouette}</div>}
              {details.color       && <div><strong>Color:</strong> {details.color}</div>}
              {details.fabric      && <div><strong>Fabric:</strong> {details.fabric}</div>}
              {details.versatility && <div><strong>Versatility:</strong> {details.versatility}</div>}
            </ResultBlock>
          )}
          <ResultBlock label="Pairs With Your Closet">
            {renderablePairings.length > 0 ? (
              <ul className="bos-result-reasons">
                {renderablePairings.map((p, i) => (
                  <li key={i} className="bos-result-reason">
                    <span className="bos-result-reason-dash" aria-hidden />
                    <span><strong>{p.name}</strong>{p.reason && <span> — {p.reason}</span>}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No closet pairings were found for this item.{" "}
                <Link to="/closet">Add pieces to your wardrobe →</Link>
              </p>
            )}
            {fillsGap && <p style={{ color: "var(--naia-accent)", marginTop: "8px" }}>✓ {fillsGap}</p>}
          </ResultBlock>
          {naiaMatch && (
            <ResultBlock label="Pair It With From nAia">
              <div className="bos-naia-title">{typeof naiaMatch === "object" ? naiaMatch.title : naiaMatch}</div>
              {typeof naiaMatch === "object" && naiaMatch.reason && (
                <div className="bos-naia-reason">{naiaMatch.reason}</div>
              )}
              {typeof naiaMatch === "object" && naiaMatch.url && (
                <a href={naiaMatch.url} target="_blank" rel="noreferrer" className="bos-naia-link">Shop This Piece →</a>
              )}
            </ResultBlock>
          )}
          {occasions.length > 0 && (
            <ResultBlock label="Perfect For">
              <div className="bos-occasions">
                {occasions.map((occ, i) => (
                  <span key={i} className="bos-occasion-tag">{occ}</span>
                ))}
              </div>
            </ResultBlock>
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
