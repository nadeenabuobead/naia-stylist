// app/routes/admin.naia.customers.$customerId.buyskip.$analysisId.tsx
//
// nAia Admin — Buy/Skip upload detail.
// Read-only. One customer's single Buy/Skip submission: image, verdict,
// reasoning, outcome, and — where the record has it — the deterministic
// foundation evidence (product facts, duplicate evidence, constraint
// evidence) computed by app/lib/buyskip/*.server.ts.
//
// This is NOT a Closet item page. A Buy/Skip upload is never Closet
// ownership, never fed to Wardrobe Intelligence as ownership, and never
// turned into Taste evidence just because it was uploaded.
//
// Auth: requireAdminSession.

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { ReactNode } from "react";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  getAdminCustomerBuySkipUploadDetail,
  type AdminBuySkipUploadDetail,
} from "~/lib/admin/buyskip-admin.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  const { customerId, analysisId } = params;
  if (!customerId || !analysisId) throw new Response("Not found", { status: 404 });
  // Scoped to customerId — an analysis belonging to a different customer
  // returns null here, never the record, so a guessed/stale URL can't leak it.
  const upload = await getAdminCustomerBuySkipUploadDetail(customerId, analysisId);
  if (!upload) throw new Response("Not found", { status: 404 });
  return Response.json({ customerId, upload });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function displayDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function verdictStyle(verdict: string): { color: string; background: string; border: string } {
  const v = verdict.toUpperCase();
  if (v === "BUY") return { color: "#86efac", background: "#052e16", border: "1px solid #166534" };
  if (v.startsWith("SKIP")) return { color: "#fca5a5", background: "#2e0a0a", border: "1px solid #7f1d1d" };
  return { color: "#9ca3af", background: "#1f2937", border: "1px solid #374151" };
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <tr>
      <th style={{ whiteSpace: "nowrap", verticalAlign: "top", paddingTop: "0.4rem", fontSize: "0.72rem", color: "#9ca3af" }}>{label}</th>
      <td style={{ fontSize: "0.82rem", color: "#d1d5db" }}>{value}</td>
    </tr>
  );
}

// ── Foundation evidence rendering (app/lib/buyskip/decision-evidence.server.ts) ──
// Defensive/structural, not strictly typed — this is read back from a JSON
// column, and older analyses (pre product-foundation work) won't have it.

function ProductFactRow({ label, fact }: { label: string; fact: unknown }) {
  if (!isRecord(fact)) return null;
  const value = fact.value;
  if (value === null || value === undefined) return null;
  const display = Array.isArray(value) ? value.join(", ") : String(value);
  return (
    <tr>
      <th style={{ whiteSpace: "nowrap", verticalAlign: "top", paddingTop: "0.3rem", fontSize: "0.7rem", color: "#9ca3af" }}>{label}</th>
      <td style={{ fontSize: "0.78rem", color: "#d1d5db" }}>
        {display}{" "}
        <span style={{ fontSize: "0.62rem", color: "#6b7280" }}>
          ({String(fact.status ?? "unknown")} · {String(fact.provenance ?? "")})
        </span>
      </td>
    </tr>
  );
}

function DecisionEvidenceSection({ decisionEvidence }: { decisionEvidence: unknown }) {
  if (!isRecord(decisionEvidence)) return null;
  const pf = isRecord(decisionEvidence.productFacts) ? decisionEvidence.productFacts : null;
  const dup = isRecord(decisionEvidence.duplicateEvidence) ? decisionEvidence.duplicateEvidence : null;
  const con = isRecord(decisionEvidence.constraintEvidence) ? decisionEvidence.constraintEvidence : null;
  const colour = isRecord(decisionEvidence.colourPreferenceEvidence) ? decisionEvidence.colourPreferenceEvidence : null;
  const need = isRecord(decisionEvidence.wardrobeNeed) ? decisionEvidence.wardrobeNeed : null;
  const outcomeHistory = isRecord(decisionEvidence.outcomeHistory) ? decisionEvidence.outcomeHistory : null;

  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Decision Evidence</h2>
        <span style={{ fontSize: "0.65rem", background: "#0c1a2e", color: "#93c5fd", border: "1px solid #1e3a5f", borderRadius: "3px", padding: "0.05rem 0.35rem" }}>
          B — COMPUTED, NOT MODEL-DECIDED
        </span>
      </div>
      <div className="na-card__body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {pf && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>Product Facts</p>
            <table className="na-field-table">
              <tbody>
                {Object.entries(pf).filter(([k]) => k !== "observationConfidence").map(([k, v]) => (
                  <ProductFactRow key={k} label={k} fact={v} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dup && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>Duplicate Evidence</p>
            <p style={{ fontSize: "0.82rem", color: "#d1d5db", marginBottom: "0.3rem" }}>
              Overlap: <strong>{String(dup.overlap)}</strong> · {String(dup.sameSlotCandidateCount ?? 0)} same-category candidate(s) considered
            </p>
            {Array.isArray(dup.matches) && dup.matches.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.78rem", color: "#9ca3af" }}>
                {dup.matches.map((m, i) => isRecord(m) ? (
                  <li key={i}>{String(m.closetItemName)} — matched on {Array.isArray(m.matchedFields) ? m.matchedFields.join(", ") : ""}</li>
                ) : null)}
              </ul>
            )}
          </div>
        )}

        {con && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              Hard-Constraint Evidence {con.hasHardViolation === true && <span style={{ color: "#fca5a5" }}>— VIOLATION</span>}
            </p>
            {Array.isArray(con.checks) && con.checks.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.78rem", color: "#9ca3af" }}>
                {con.checks.map((c, i) => isRecord(c) ? (
                  <li key={i} style={{ color: c.state === "violated" ? "#fca5a5" : "#9ca3af" }}>
                    {String(c.label)}: {String(c.state)} — {String(c.reason)}
                  </li>
                ) : null)}
              </ul>
            ) : (
              <p style={{ fontSize: "0.78rem", color: "#6b7280" }}>No declared hard requirements to check.</p>
            )}
            {con.deferredToResolvedPassport === true && (
              <p style={{ fontSize: "0.72rem", color: "#fbbf24", marginTop: "0.3rem" }}>
                A free-text cultural/religious dressing requirement exists on this customer's Passport — deferred to the canonical Passport resolver, not evaluated here.
              </p>
            )}
          </div>
        )}

        {colour && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              Colour Preference {colour.status === "conflict" && <span style={{ color: "#fbbf24" }}>— advisory, not a violation</span>}
            </p>
            <p style={{ fontSize: "0.78rem", color: colour.status === "conflict" ? "#fbbf24" : "#9ca3af" }}>
              {String(colour.reason ?? "")}
            </p>
            {typeof colour.determinedBy === "string" && colour.determinedBy !== "none" && (
              <p style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: "0.25rem" }}>
                Determined by: <strong>{colour.determinedBy}</strong>
              </p>
            )}
            <table className="na-field-table" style={{ marginTop: "0.3rem" }}>
              <tbody>
                <Field label="Declared colour" value={Array.isArray(colour.declaredColours) && colour.declaredColours.length > 0 ? colour.declaredColours.join(", ") : null} />
                <Field label="Vision colour" value={typeof colour.detectedColour === "string" ? colour.detectedColour : null} />
                <Field label="Observation confidence" value={typeof colour.observationConfidence === "string" ? colour.observationConfidence : null} />
                <Field label="Avoid colours" value={Array.isArray(colour.avoidColours) && colour.avoidColours.length > 0 ? colour.avoidColours.join(", ") : null} />
              </tbody>
            </table>
            {colour.disagreement === true && (
              <p style={{ fontSize: "0.68rem", color: "#93c5fd", marginTop: "0.3rem" }}>
                Declared and vision colour reads disagree — declared evidence took precedence, vision's read is recorded for reference only.
              </p>
            )}
            <p style={{ fontSize: "0.65rem", color: "#6b7280", marginTop: "0.3rem" }}>
              Never contributes to Hard-Constraint Evidence above and cannot change the verdict on its own — Passport's avoidColors is a stated preference ("colours you usually avoid"), not an exclusion rule.
            </p>
          </div>
        )}

        {need && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>Wardrobe Need</p>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
              {String(need.status)} — {String(need.reason ?? "")}
            </p>
          </div>
        )}

        {outcomeHistory && outcomeHistory.available === true && (
          <div>
            <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
              Outcome History <span style={{ color: "#93c5fd" }}>— B3, advisory evidence only</span>
            </p>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
              {String(outcomeHistory.category ?? "")}: {String(outcomeHistory.lovedCount ?? 0)} previous purchase{outcomeHistory.lovedCount === 1 ? "" : "s"} loved, {String(outcomeHistory.returnedCount ?? 0)} returned
            </p>
            {Array.isArray(outcomeHistory.provenanceIds) && outcomeHistory.provenanceIds.length > 0 && (
              <p style={{ fontSize: "0.65rem", color: "#6b7280", marginTop: "0.2rem" }}>
                From {outcomeHistory.provenanceIds.length} prior outcome record{outcomeHistory.provenanceIds.length === 1 ? "" : "s"} — this customer's own, never another customer's.
              </p>
            )}
            <p style={{ fontSize: "0.65rem", color: "#6b7280", marginTop: "0.3rem" }}>
              Derived from this customer's own explicit post-purchase reports only — never from a past nAia verdict. Not read by the verdict or the AI prompt in this phase; evidence only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminBuySkipUploadDetailPage() {
  const { customerId, upload } = useLoaderData() as { customerId: string; upload: AdminBuySkipUploadDetail };
  const fa = upload.fullAnalysis;
  const vStyle = verdictStyle(upload.displayVerdict);
  const decisionEvidence = isRecord(fa) ? fa.decisionEvidence : null;

  return (
    <div className="na-page">
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to={`/admin/naia/customers/${customerId}`} style={{ fontSize: "0.78rem", color: "#6b7280", textDecoration: "none" }}>
          ← Customer
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
        <h1 className="na-page-heading" style={{ margin: 0 }}>{upload.itemType ?? upload.category ?? "Buy / Skip Upload"}</h1>
        <span style={{ fontSize: "0.75rem", padding: "0.1rem 0.55rem", borderRadius: "4px", ...vStyle }}>{upload.displayVerdict}</span>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "1.5rem" }}>
        Submitted {displayDateTime(upload.createdAt)} · customer-submitted purchase candidate, not a Closet item.
      </p>

      {upload.verdictOverridden && isRecord(fa) && (
        <div className="na-card" style={{ marginBottom: "1.25rem", borderColor: "#7f1d1d" }}>
          <div className="na-card__body" style={{ fontSize: "0.82rem", color: "#fca5a5" }}>
            This verdict was downgraded from the model's original <strong>{String(fa.modelVerdict ?? "BUY")}</strong>
            {typeof fa.modelConfidence === "number" ? <> (confidence {fa.modelConfidence})</> : null} by a
            confirmed hard-constraint violation. {String(fa.verdictOverrideReason ?? "")} The persisted confidence is
            null — it described the discarded verdict, not this one.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.25rem", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="na-card">
            <div className="na-card__body">
              {upload.imageUrl ? (
                <img src={upload.imageUrl} alt="" style={{ width: "100%", borderRadius: "5px", display: "block" }} />
              ) : (
                <div style={{
                  width: "100%", aspectRatio: "1", borderRadius: "5px", background: "#111827",
                  border: "1px solid #1f2937", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: "0.75rem", color: "#4b5563" }}>No image available</span>
                </div>
              )}
            </div>
          </div>

          <div className="na-card">
            <div className="na-card__header"><h2 className="na-card__title">Details</h2></div>
            <div className="na-card__body">
              <table className="na-field-table">
                <tbody>
                  <Field label="Category" value={upload.category} />
                  <Field label="Confidence" value={upload.confidence != null ? `${upload.confidence}%` : null} />
                  <Field label="Analysis ID" value={<code style={{ fontSize: "10px", wordBreak: "break-all" }}>{upload.id}</code>} />
                </tbody>
              </table>
            </div>
          </div>

          {upload.outcome && (
            <div className="na-card">
              <div className="na-card__header"><h2 className="na-card__title">Customer Outcome</h2></div>
              <div className="na-card__body">
                <table className="na-field-table">
                  <tbody>
                    <Field label="Decision" value={upload.outcome.decision.toLowerCase().replace(/_/g, " ")} />
                    <Field
                      label="Post-purchase"
                      value={upload.outcome.postPurchaseOutcome ? upload.outcome.postPurchaseOutcome.toLowerCase().replace(/_/g, " ") : null}
                    />
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="na-card">
            <div className="na-card__header"><h2 className="na-card__title">Reasoning</h2></div>
            <div className="na-card__body">
              <p style={{ fontSize: "0.85rem", color: "#d1d5db", lineHeight: 1.5 }}>
                {(isRecord(fa) && typeof fa.finalThought === "string" ? fa.finalThought : null) ?? upload.reasoning ?? "No reasoning recorded."}
              </p>
              {isRecord(fa) && (
                <table className="na-field-table" style={{ marginTop: "0.75rem" }}>
                  <tbody>
                    <Field label="Buy if" value={typeof fa.buyIf === "string" ? fa.buyIf : null} />
                    <Field label="Skip if" value={typeof fa.skipIf === "string" ? fa.skipIf : null} />
                    <Field label="Better direction" value={typeof fa.betterDirection === "string" ? fa.betterDirection : null} />
                    <Field label="Fills gap (Closet-scoped, not WI)" value={typeof fa.fillsGap === "string" ? fa.fillsGap : null} />
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {decisionEvidence ? (
            <DecisionEvidenceSection decisionEvidence={decisionEvidence} />
          ) : (
            <div className="na-card">
              <div className="na-card__body">
                <p style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                  No deterministic decision evidence on this record — it predates the product-foundation work.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
