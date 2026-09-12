// nAia Admin — Closet Intelligence item detail.
//
// Independent auth: requireNaiaAdminAccess called here, not inherited from parent.
// Nested route loaders can execute independently/in parallel (React Router v7).
//
// Provenance honesty:
//   hasSnapshot=true  → show "AI SNAPSHOT" section with model/schema/timestamp
//   hasSnapshot=false → show "AI provenance unavailable — Current stored classification shown below"
//
// Review status labels: "AI ONLY" | "REVIEWED" | "OVERRIDDEN"
// Phase 3 note: "EFFECTIVE VALUE USED BY nAia" (with override wiring) is NOT shown here.

import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireNaiaAdminAccess } from "~/lib/naia-admin-auth.server";
import {
  getClosetItemDetail,
  type ClosetItemDetail,
} from "~/lib/admin/closet-intelligence.server";
import {
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
} from "~/lib/cloudinary-admin.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireNaiaAdminAccess(request);

  const itemId = params.itemId;
  if (!itemId) throw new Response("Not found", { status: 404 });

  const item = await getClosetItemDetail(itemId);
  if (!item) throw new Response("Closet item not found", { status: 404 });

  // Generate signed URL for the garment image if it's a private Cloudinary asset.
  // Fall through to thumbnailUrl for public assets or non-Cloudinary uploads.
  let garmentImageUrl: string | null = null;
  if (item.imagePublicId) {
    try {
      const cfg = getCloudinaryConfig();
      if (cfg) {
        garmentImageUrl = buildPrivateDownloadUrl(
          cfg,
          item.imagePublicId,
          item.imageFormat ?? "jpg",
          "private",
        );
      } else {
        garmentImageUrl = item.thumbnailUrl;
      }
    } catch {
      garmentImageUrl = item.thumbnailUrl;
    }
  } else {
    garmentImageUrl = item.thumbnailUrl;
  }

  return Response.json({ item, garmentImageUrl });
}

// ── Classification field display config ───────────────────────────────────────

type ClassificationField = {
  label: string;
  key: keyof ClosetItemDetail["classification"];
  type: "string" | "boolean" | "array";
};

const CLASSIFICATION_FIELDS: ClassificationField[] = [
  { label: "Subcategory",       key: "subcategory",        type: "string" },
  { label: "Silhouette",        key: "silhouette",         type: "string" },
  { label: "Formality",         key: "formality",          type: "string" },
  { label: "Style personality", key: "stylePersonality",   type: "string" },
  { label: "Fit profile",       key: "fitProfile",         type: "string" },
  { label: "Hem length",        key: "hemLength",          type: "string" },
  { label: "Top length",        key: "topLength",          type: "string" },
  { label: "Waist shape",       key: "waistShape",         type: "string" },
  { label: "Sleeve length",     key: "sleeveLength",       type: "string" },
  { label: "Neckline coverage", key: "necklineCoverage",   type: "string" },
  { label: "Shoulder coverage", key: "shoulderCoverage",   type: "boolean" },
  { label: "Midriff exposed",   key: "midriffExposed",     type: "boolean" },
  { label: "Material",          key: "material",           type: "string" },
  { label: "Pattern",           key: "pattern",            type: "string" },
  { label: "Primary colour",    key: "primaryColor",       type: "string" },
  { label: "Colours",           key: "colors",             type: "array" },
  { label: "Occasions",         key: "occasions",          type: "array" },
  { label: "Seasons",           key: "seasons",            type: "array" },
  { label: "Style tags",        key: "styleTags",          type: "array" },
  { label: "Garment relationships", key: "garmentRelationships", type: "array" },
];

const REVIEW_BADGE_CLASS: Record<string, string> = {
  "AI ONLY":  "na-badge--ai-only",
  REVIEWED:   "na-badge--reviewed",
  OVERRIDDEN: "na-badge--overridden",
};

const ANALYSIS_BADGE_CLASS: Record<string, string> = {
  ready:        "na-badge--ready",
  failed:       "na-badge--failed",
  pending:      "na-badge--pending",
  not_analyzed: "na-badge--not-analyzed",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClosetItemDetailPage() {
  const { item, garmentImageUrl } = useLoaderData() as {
    item: ClosetItemDetail;
    garmentImageUrl: string | null;
  };

  const fc = item.fieldConfidence as Record<string, unknown> | null;

  function getFieldConfidence(key: string): string | null {
    if (!fc) return null;
    const val = fc[key];
    if (val === "high" || val === "medium" || val === "low") return val;
    return null;
  }

  function renderFieldValue(field: ClassificationField): React.ReactNode {
    const raw = item.classification[field.key];

    if (field.type === "boolean") {
      if (raw === null || raw === undefined) return <span className="na-null">—</span>;
      return <span>{raw ? "Yes" : "No"}</span>;
    }

    if (field.type === "array") {
      const arr = raw as string[];
      if (!arr || arr.length === 0) return <span className="na-null">—</span>;
      return (
        <div className="na-chips">
          {arr.map((v, i) => (
            <span key={i} className="na-chip">{v}</span>
          ))}
        </div>
      );
    }

    // string
    if (raw === null || raw === undefined || raw === "") {
      return <span className="na-null">—</span>;
    }
    return <span>{String(raw)}</span>;
  }

  const displayDate = (d: Date | string | null) =>
    d
      ? new Date(d).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  return (
    <>
      {/* ── Back link ── */}
      <Link to="/app/naia-admin/closet" className="na-back">
        ← Closet Intelligence
      </Link>

      <h1 className="na-page-heading" style={{ marginBottom: "0.5rem" }}>
        {item.name ?? "Unnamed item"}
      </h1>

      {/* ── Meta strip ── */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem", alignItems: "center" }}>
        <span className={`na-badge ${ANALYSIS_BADGE_CLASS[item.analysisStatus] ?? "na-badge--not-analyzed"}`}>
          {item.analysisStatus.replace(/_/g, " ")}
        </span>
        <span className={`na-badge ${REVIEW_BADGE_CLASS[item.displayReviewStatus] ?? "na-badge--ai-only"}`}>
          {item.displayReviewStatus}
        </span>
        <span style={{ fontSize: "12px", color: "#6b7280" }}>{item.category}</span>
        {item.classification.subcategory && (
          <span style={{ fontSize: "12px", color: "#6b7280" }}>· {item.classification.subcategory}</span>
        )}
        <span style={{ fontSize: "12px", color: "#9ca3af" }}>
          Customer: {item.customerEmail ?? item.customerId}
        </span>
      </div>

      <div className="na-detail-grid">

        {/* ── Left: garment image + provenance ── */}
        <div className="na-detail-sidebar">

          {/* Garment image */}
          <div className="na-card" style={{ overflow: "hidden", marginBottom: "1.25rem" }}>
            {garmentImageUrl ? (
              <img
                src={garmentImageUrl}
                alt={item.name ?? "Garment"}
                className="na-item-img"
              />
            ) : (
              <div className="na-item-img--placeholder">
                <span style={{ fontSize: "40px", opacity: 0.3 }}>☐</span>
                <span>No image</span>
              </div>
            )}
          </div>

          {/* Provenance */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">AI Provenance</h2>
            </div>
            <div className="na-card__body">
              {item.hasSnapshot ? (
                <>
                  <p className="na-provenance-label">AI SNAPSHOT</p>

                  {item.latestSnapshot && (
                    <table className="na-field-table">
                      <tbody>
                        <tr>
                          <th>Model</th>
                          <td><code style={{ fontSize: "11px" }}>{item.latestSnapshot.analysisModel}</code></td>
                        </tr>
                        <tr>
                          <th>Schema version</th>
                          <td><code style={{ fontSize: "11px" }}>{item.latestSnapshot.analysisSchemaVersion}</code></td>
                        </tr>
                        <tr>
                          <th>Analyzed</th>
                          <td>{displayDate(item.latestSnapshot.analyzedAt)}</td>
                        </tr>
                        <tr>
                          <th>Snapshot ID</th>
                          <td><code style={{ fontSize: "10px", wordBreak: "break-all" }}>{item.latestSnapshot.id}</code></td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  {/* Snapshot history */}
                  {item.snapshotHistory.length > 1 && (
                    <div style={{ marginTop: "1rem" }}>
                      <p className="na-provenance-label">ANALYSIS HISTORY ({item.snapshotHistory.length} runs)</p>
                      {item.snapshotHistory.map((s) => (
                        <div className="na-snapshot-row" key={s.id}>
                          <span style={{ color: "#374151" }}>
                            {new Date(s.analyzedAt).toLocaleDateString("en-GB", {
                              day: "2-digit", month: "short", year: "numeric",
                            })}
                          </span>
                          <code style={{ fontSize: "10px", color: "#6b7280" }}>{s.analysisModel}</code>
                          <code style={{ fontSize: "9px", color: "#9ca3af" }}>v{s.analysisSchemaVersion}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="na-provenance-unavailable">
                  <strong>AI provenance unavailable</strong>
                  <p style={{ margin: "0.35rem 0 0", fontSize: "12px" }}>
                    No analysis snapshot exists for this item. The classification shown
                    below reflects the current stored values — their origin is unknown.
                    Re-analyzing will create a snapshot.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Admin review record */}
          {item.adminReview && (
            <div className="na-card">
              <div className="na-card__header">
                <h2 className="na-card__title">Admin Review</h2>
                <span className={`na-badge ${REVIEW_BADGE_CLASS[item.displayReviewStatus] ?? "na-badge--ai-only"}`}>
                  {item.displayReviewStatus}
                </span>
              </div>
              <div className="na-card__body">
                <table className="na-field-table">
                  <tbody>
                    {item.adminReview.reviewedBy && (
                      <tr>
                        <th>Reviewed by</th>
                        <td>{item.adminReview.reviewedBy}</td>
                      </tr>
                    )}
                    {item.adminReview.reviewedAt && (
                      <tr>
                        <th>Reviewed at</th>
                        <td>{displayDate(item.adminReview.reviewedAt)}</td>
                      </tr>
                    )}
                    {item.adminReview.adminNotes && (
                      <tr>
                        <th>Notes</th>
                        <td style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
                          {item.adminReview.adminNotes}
                        </td>
                      </tr>
                    )}
                    {item.adminReview.overrides && Object.keys(item.adminReview.overrides).length > 0 && (
                      <tr>
                        <th>Override fields</th>
                        <td>
                          <div className="na-chips">
                            {Object.keys(item.adminReview.overrides).map((k) => (
                              <span key={k} className="na-chip" style={{ background: "#ede9fe", color: "#4c1d95" }}>
                                {k}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: classification + debug ── */}
        <div className="na-detail-main">

          {/* Current classification */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">
                {item.hasSnapshot ? "Current Classification" : "Stored Classification"}
              </h2>
              <span className="na-card__subtitle">
                {item.hasSnapshot
                  ? "Values on ClosetItem after customer-precedence merge"
                  : "Stored values — AI provenance unavailable (see left panel)"}
              </span>
            </div>
            <div className="na-card__body" style={{ padding: 0 }}>
              <table className="na-field-table">
                <thead>
                  <tr>
                    <th style={{ width: "28%" }}>Field</th>
                    <th>Value</th>
                    <th style={{ width: "110px" }}>AI Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {CLASSIFICATION_FIELDS.map((field) => {
                    const conf = getFieldConfidence(field.key);
                    return (
                      <tr key={field.key}>
                        <th>{field.label}</th>
                        <td>{renderFieldValue(field)}</td>
                        <td>
                          {conf
                            ? (
                              <span className="na-conf">
                                <span className={`na-conf__dot na-conf__dot--${conf}`} />
                                {conf}
                              </span>
                            )
                            : <span className="na-null">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Latest snapshot raw analysis (if available) */}
          {item.latestSnapshot && (
            <div className="na-card">
              <div className="na-card__header">
                <h2 className="na-card__title">Raw AI Analysis (Latest Snapshot)</h2>
                <span className="na-card__subtitle">
                  What Claude returned before customer-precedence merge
                </span>
              </div>
              <div className="na-card__body">
                <details>
                  <summary className="na-json-expand" style={{ display: "inline-block", cursor: "pointer" }}>
                    Show raw JSON
                  </summary>
                  <pre className="na-json-pre">
                    {JSON.stringify(item.latestSnapshot.normalizedAnalysis, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}

          {/* Full fieldConfidence debug */}
          {item.fieldConfidence && (
            <div className="na-card">
              <div className="na-card__header">
                <h2 className="na-card__title">Field Confidence (debug)</h2>
              </div>
              <div className="na-card__body">
                <details>
                  <summary className="na-json-expand" style={{ display: "inline-block", cursor: "pointer" }}>
                    Show fieldConfidence JSON
                  </summary>
                  <pre className="na-json-pre">
                    {JSON.stringify(item.fieldConfidence, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}

          {/* Item metadata */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">Item Metadata</h2>
            </div>
            <div className="na-card__body" style={{ padding: 0 }}>
              <table className="na-field-table">
                <tbody>
                  <tr><th>Item ID</th><td><code style={{ fontSize: "11px" }}>{item.id}</code></td></tr>
                  <tr><th>Customer ID</th><td><code style={{ fontSize: "11px" }}>{item.customerId}</code></td></tr>
                  <tr><th>Customer email</th><td>{item.customerEmail ?? <span className="na-null">unknown</span>}</td></tr>
                  <tr><th>Created</th><td>{displayDate(item.createdAt)}</td></tr>
                  <tr><th>Last analyzed</th><td>{item.analyzedAt ? displayDate(item.analyzedAt) : <span className="na-null">—</span>}</td></tr>
                  {item.analysisSchemaVersion && (
                    <tr><th>Schema version</th><td><code style={{ fontSize: "11px" }}>{item.analysisSchemaVersion}</code></td></tr>
                  )}
                  {item.imagePublicId && (
                    <tr><th>Cloudinary public ID</th><td><code style={{ fontSize: "11px", wordBreak: "break-all" }}>{item.imagePublicId}</code></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
