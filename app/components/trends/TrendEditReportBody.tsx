// app/components/trends/TrendEditReportBody.tsx
//
// The actual Personalised Trend Edit report body — sections 01 through 06
// exactly as the customer sees them at trends.my-edits.$slug.tsx. Shared
// between that customer route and the Admin Customer 360 Trend Edit detail
// route so the two renderings can never drift (same conditionals, same
// copy, same styling). Page-specific chrome — hero, back link, copy/
// download actions, footer CTA, membership/generation-failed/no-profile
// states — stays in each caller; this component renders only the report
// content itself.
//
// IMPORTANT: ShopperEdit / NadineProductRecommendation are imported
// type-only from .server modules — erased at compile time, so this
// component stays safe to render from either a server loader's data or
// (if ever needed) a client bundle. Do not change these to value imports.

import type { ShopperEdit, EvidenceClosetItem } from "~/lib/trend-evidence.server";
import type { NadineProductRecommendation } from "~/lib/trend-product-recommendation.server";

export const TREND_EDIT_REPORT_BODY_CSS = `
  /* ── Divider ─────────────────────────────────────────────────── */
  .tmd-divider { height: 1px; background: rgba(26,17,9,0.10); margin: 36px 0; }

  /* ── Section labels ──────────────────────────────────────────── */
  .tmd-section-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 18px;
  }
  .tmd-section { margin-bottom: 40px; }

  /* ── Body text ───────────────────────────────────────────────── */
  .tmd-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.1rem;
    line-height: 1.85;
    color: rgba(26,17,9,0.85);
  }

  /* ── Reading box (why this matters) ─────────────────────────── */
  .tmd-reading-box {
    padding: 28px 32px;
    border-left: 3px solid #7a1e28;
    background: rgba(122,30,40,0.04);
    margin-bottom: 40px;
  }

  /* ── Evidence panel ──────────────────────────────────────────── */
  .tmd-evidence {
    border: 1px solid rgba(122,30,40,0.12);
    background: rgba(255,255,255,0.40);
  }
  .tmd-evidence-row { padding: 20px 24px; }
  .tmd-evidence-row + .tmd-evidence-row {
    border-top: 1px solid rgba(26,17,9,0.07);
  }
  .tmd-evidence-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.52rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.40);
    margin-bottom: 10px;
  }

  /* Closet items */
  .tmd-closet-grid {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .tmd-closet-item { flex: 0 0 calc(50% - 8px); max-width: 180px; }
  .tmd-closet-img {
    width: 100%;
    aspect-ratio: 3/4;
    object-fit: cover;
    background: rgba(26,17,9,0.04);
  }
  .tmd-closet-name {
    font-family: 'Space Mono', monospace;
    font-size: 0.5rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-top: 8px;
    margin-bottom: 4px;
  }
  .tmd-closet-note {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.88rem;
    font-style: italic;
    color: rgba(26,17,9,0.58);
    line-height: 1.5;
  }

  .tmd-low-data {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.88rem;
    font-style: italic;
    color: rgba(26,17,9,0.50);
    margin-top: 14px;
    line-height: 1.6;
  }

  /* ── Bullet lists (invest/skip) ──────────────────────────────── */
  .tmd-dash-list { list-style: none; margin: 0; padding: 0; }
  .tmd-dash-list li {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    font-style: italic;
    line-height: 1.7;
    color: rgba(26,17,9,0.82);
    padding: 10px 0;
    border-bottom: 1px solid rgba(26,17,9,0.07);
  }
  .tmd-dash-list li::before { content: '— '; color: #7a1e28; }

  /* ── NADINE product card ─────────────────────────────────────── */
  .tmd-nadine-card {
    margin-top: 24px;
    border: 1px solid rgba(26,17,9,0.12);
    background: rgba(240,235,226,0.35);
    overflow: hidden;
  }
  .tmd-nadine-card-inner {
    display: flex;
    flex-direction: row;
    align-items: stretch;
  }
  .tmd-nadine-card-image-col {
    width: 180px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .tmd-nadine-card-image-col img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tmd-nadine-card-copy {
    padding: 20px 24px;
    flex: 1;
    min-width: 0;
  }
  .tmd-nadine-card-no-image {
    padding: 20px 24px;
  }
  .tmd-nadine-card-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #7a1e28;
    margin-bottom: 8px;
  }
  .tmd-nadine-card-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    font-style: italic;
    font-weight: 400;
    color: #1a1109;
    margin: 0 0 10px;
  }
  .tmd-nadine-card-explanation {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-weight: 300;
    line-height: 1.6;
    color: rgba(26,17,9,0.75);
    margin: 0 0 14px;
  }
  .tmd-nadine-card-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
  }
  .tmd-nadine-card-link:hover { text-decoration: underline; }
  @media (max-width: 600px) {
    .tmd-nadine-card-inner { flex-direction: column; }
    .tmd-nadine-card-image-col { width: 100%; height: 260px; }
  }

  /* ── ALREADY YOURS strip (sections 03 / 04) ───────────────────── */
  .tmd-already-yours {
    margin-top: 18px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex-wrap: wrap;
  }
  .tmd-already-yours-label {
    font-family: 'Space Mono', monospace;
    font-size: 0.5rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: #7a1e28;
    white-space: nowrap;
    padding-top: 6px;
  }
  .tmd-already-yours-items {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tmd-already-yours-item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(240,235,226,0.5);
    padding: 5px 10px 5px 5px;
    border: 1px solid rgba(26,17,9,0.08);
  }
  .tmd-already-yours-img {
    width: 38px;
    height: 38px;
    object-fit: cover;
    display: block;
    flex-shrink: 0;
  }
  .tmd-already-yours-name {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.82rem;
    font-weight: 300;
    color: rgba(26,17,9,0.72);
  }
`;

export interface TrendEditReportBodyProps {
  edit: ShopperEdit;
  nadineRecommendation: NadineProductRecommendation | null;
}

export default function TrendEditReportBody({ edit, nadineRecommendation }: TrendEditReportBodyProps) {
  const hasEvidence =
    edit.evidenceStyleDna ||
    edit.evidencePassportSays ||
    edit.evidenceClosetItems.length > 0 ||
    edit.evidenceReviews;

  return (
    <>
      {/* 01 / WHY THIS MATTERS TO YOU */}
      <div className="tmd-reading-box">
        <div className="tmd-section-label">01 / Why this matters to you</div>
        <p className="tmd-body">{edit.yourVersion}</p>
      </div>

      {/* 02 / YOUR nAia EVIDENCE */}
      {hasEvidence && (
        <>
          <div className="tmd-section">
            <div className="tmd-section-label">02 / Your nAia Evidence</div>
            <div className="tmd-evidence">
              {edit.evidenceStyleDna && (
                <div className="tmd-evidence-row">
                  <div className="tmd-evidence-label">Your style DNA says</div>
                  <p className="tmd-body" style={{ fontSize: "1rem" }}>{edit.evidenceStyleDna}</p>
                </div>
              )}
              {edit.evidencePassportSays && (
                <div className="tmd-evidence-row">
                  <div className="tmd-evidence-label">Your Passport says</div>
                  <p className="tmd-body" style={{ fontSize: "1rem" }}>{edit.evidencePassportSays}</p>
                </div>
              )}
              {edit.evidenceClosetItems.length > 0 && (
                <div className="tmd-evidence-row">
                  <div className="tmd-evidence-label">Your Closet shows</div>
                  <div className="tmd-closet-grid">
                    {edit.evidenceClosetItems.map((item: EvidenceClosetItem, i: number) => (
                      <div key={i} className="tmd-closet-item">
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt={item.name} className="tmd-closet-img" />
                        )}
                        <div className="tmd-closet-name">{item.name}</div>
                        <p className="tmd-closet-note">{item.roleNote}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {edit.evidenceReviews && (
                <div className="tmd-evidence-row">
                  <div className="tmd-evidence-label">Your reviews suggest</div>
                  <p className="tmd-body" style={{ fontSize: "1rem" }}>{edit.evidenceReviews}</p>
                </div>
              )}
            </div>
            {edit.lowDataNotice && (
              <p className="tmd-low-data">{edit.lowDataNotice}</p>
            )}
          </div>
          <div className="tmd-divider" />
        </>
      )}

      {/* 03 / YOUR ROUTE IN */}
      <div className="tmd-section">
        <div className="tmd-section-label">03 / Your route in</div>
        <p className="tmd-body">{edit.yourBestRouteIn}</p>
        {edit.routeInItems.length > 0 && (
          <div className="tmd-already-yours">
            <span className="tmd-already-yours-label">Already yours</span>
            <div className="tmd-already-yours-items">
              {edit.routeInItems.map((item: EvidenceClosetItem, i: number) => (
                <div key={i} className="tmd-already-yours-item">
                  {item.imageUrl && (
                    <img src={item.imageUrl} alt={item.name} className="tmd-already-yours-img" />
                  )}
                  <span className="tmd-already-yours-name">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 04 / A LOOK TO TRY */}
      <div className="tmd-section">
        <div className="tmd-section-label">04 / A look to try</div>
        <p className="tmd-body">{edit.aLookToTry}</p>
        {edit.lookToTryItems.length > 0 && (
          <div className="tmd-already-yours">
            <span className="tmd-already-yours-label">Already yours</span>
            <div className="tmd-already-yours-items">
              {edit.lookToTryItems.map((item: EvidenceClosetItem, i: number) => (
                <div key={i} className="tmd-already-yours-item">
                  {item.imageUrl && (
                    <img src={item.imageUrl} alt={item.name} className="tmd-already-yours-img" />
                  )}
                  <span className="tmd-already-yours-name">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tmd-divider" />

      {/* 05 / WORTH INVESTING IN */}
      <div className="tmd-section">
        <div className="tmd-section-label">05 / Worth investing in</div>
        {edit.worthInvestingStatement ? (
          <p className="tmd-body">{edit.worthInvestingStatement}</p>
        ) : (
          <>
            <ul className="tmd-dash-list">
              {edit.partToTake.map((bullet: string, i: number) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
            {nadineRecommendation && (
              <div className="tmd-nadine-card">
                <div className="tmd-nadine-card-inner">
                  {nadineRecommendation.imageUrl && (
                    <div className="tmd-nadine-card-image-col">
                      <img
                        src={nadineRecommendation.imageUrl}
                        alt={nadineRecommendation.title}
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className={nadineRecommendation.imageUrl ? "tmd-nadine-card-copy" : "tmd-nadine-card-no-image"}>
                    <div className="tmd-nadine-card-eyebrow">A NADINE piece for this gap</div>
                    <p className="tmd-nadine-card-title">{nadineRecommendation.title}</p>
                    <p className="tmd-nadine-card-explanation">
                      {nadineRecommendation.personalExplanation}
                    </p>
                    {nadineRecommendation.url && (
                      <a
                        href={nadineRecommendation.url}
                        className="tmd-nadine-card-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        VIEW PIECE →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 06 / HOLD OFF ON */}
      <div className="tmd-section">
        <div className="tmd-section-label">06 / Hold off on</div>
        <p className="tmd-body" style={{ marginBottom: "16px" }}>{edit.theBalanceToProtect}</p>
        <ul className="tmd-dash-list">
          {edit.partToLeave.map((bullet: string, i: number) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
