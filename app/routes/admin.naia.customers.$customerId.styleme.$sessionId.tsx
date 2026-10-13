// app/routes/admin.naia.customers.$customerId.styleme.$sessionId.tsx
//
// nAia Admin — StyleMe session detail.
// Read-only. Everything durably stored for one customer's StyleMe session:
// request/occasion/constraints, the generated outfit suggestion(s) and their
// collage, every OutfitItem, StyleMeOutcome, and PostOutfitReview. Never
// fabricates a field that was never collected for a given session.
//
// Auth: requireAdminSession.

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { ReactNode } from "react";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  getAdminCustomerStyleMeSessionDetail,
  type AdminStyleMeSessionDetail,
} from "~/lib/admin/customer-360.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  const { customerId, sessionId } = params;
  if (!customerId || !sessionId) throw new Response("Not found", { status: 404 });
  // Scoped to customerId — a session belonging to a different customer
  // returns null here, never the record, so a guessed/stale URL can't leak it.
  const session = await getAdminCustomerStyleMeSessionDetail(customerId, sessionId);
  if (!session) throw new Response("Not found", { status: 404 });
  return Response.json({ customerId, session });
}

function displayDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  const display = Array.isArray(value) ? value.join(", ") : value;
  return (
    <tr>
      <th style={{ whiteSpace: "nowrap", verticalAlign: "top", paddingTop: "0.4rem", fontSize: "0.72rem", color: "#9ca3af" }}>{label}</th>
      <td style={{ fontSize: "0.82rem", color: "#d1d5db" }}>{display}</td>
    </tr>
  );
}

export default function AdminStyleMeSessionDetailPage() {
  const { customerId, session } = useLoaderData() as { customerId: string; session: AdminStyleMeSessionDetail };

  return (
    <div className="na-page">
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to={`/admin/naia/customers/${customerId}`} style={{ fontSize: "0.78rem", color: "#6b7280", textDecoration: "none" }}>
          ← Customer
        </Link>
      </div>

      <h1 className="na-page-heading" style={{ marginBottom: "0.25rem" }}>StyleMe Session</h1>
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "1.5rem" }}>
        {displayDateTime(session.createdAt)} · {session.source}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.25rem", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="na-card">
            <div className="na-card__header"><h2 className="na-card__title">Request</h2></div>
            <div className="na-card__body">
              <table className="na-field-table">
                <tbody>
                  <Field label="Occasion" value={session.occasion} />
                  <Field label="State" value={session.state} />
                  <Field label="Intention" value={session.intentions} />
                  <Field label="Formality" value={session.formality} />
                  <Field label="Fit / comfort" value={session.bodyNeeds} />
                  <Field label="Anchor source" value={session.anchorSource} />
                </tbody>
              </table>
            </div>
          </div>

          {session.review && (
            <div className="na-card">
              <div className="na-card__header"><h2 className="na-card__title">Post-Outfit Review</h2></div>
              <div className="na-card__body">
                <table className="na-field-table">
                  <tbody>
                    <Field label="Did wear it" value={session.review.didWearIt} />
                    <Field label="Overall feeling" value={session.review.overallFeeling != null ? `${session.review.overallFeeling}/5` : null} />
                    <Field label="Feeling" value={session.review.feelingAnswer} />
                    <Field label="Felt like her" value={session.review.feltLikeHer} />
                    <Field label="Desired feeling achieved" value={session.review.desiredFeelingAchieved} />
                    <Field label="Would wear again" value={session.review.wouldWearAgain} />
                    <Field label="Physically comfortable" value={session.review.physicallyComfortable} />
                    <Field label="Fit feedback" value={session.review.fitFeedback} />
                    <Field label="Coverage feedback" value={session.review.coverageFeedback} />
                    <Field label="Colour feedback" value={session.review.colourFeedback} />
                    <Field label="Confidence before → after" value={session.review.confidenceBefore != null && session.review.confidenceAfter != null ? `${session.review.confidenceBefore} → ${session.review.confidenceAfter}` : null} />
                    <Field label="Additional notes" value={session.review.additionalNotes} />
                    <Field label="Objections" value={session.review.objections} />
                    <Field label="Submitted" value={displayDateTime(session.review.createdAt)} />
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {session.suggestions.length === 0 ? (
            <div className="na-card"><div className="na-card__body"><p className="na-empty">No suggestions were generated for this session.</p></div></div>
          ) : session.suggestions.map((s, i) => (
            <div key={s.id} className="na-card">
              <div className="na-card__header">
                <h2 className="na-card__title">{s.outfitName ?? `Suggestion ${i + 1}`}</h2>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {s.selected && <span className="na-badge na-badge--reviewed">SELECTED</span>}
                  {s.savedAsLook && <span className="na-badge na-badge--ready">SAVED</span>}
                </div>
              </div>
              <div className="na-card__body">
                {s.collageImages.length > 0 && (
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                    {s.collageImages.map((url, idx) => (
                      <img key={idx} src={url} alt="" style={{ width: "90px", height: "120px", objectFit: "cover", borderRadius: "5px", border: "1px solid #1f2937" }} />
                    ))}
                  </div>
                )}

                {s.collageImages.length === 0 && (
                  <p style={{ fontSize: "0.72rem", color: "#6b7280", fontStyle: "italic", marginBottom: "1rem" }}>
                    {s.items.length > 0 ? "No item image resolved for this look." : "No completed look for this suggestion."}
                  </p>
                )}

                <table className="na-field-table" style={{ marginBottom: "1rem" }}>
                  <tbody>
                    <Field label="Why this works" value={s.whyThisWorks} />
                    <Field label="Confidence boost" value={s.confidenceBoost} />
                    <Field label="Status" value={s.status} />
                  </tbody>
                </table>

                <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
                  Items ({s.items.length})
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {s.items.map(it => (
                    <div key={it.id} style={{ display: "flex", gap: "0.6rem", alignItems: "center", padding: "0.4rem", border: "1px solid #1f2937", borderRadius: "5px" }}>
                      {it.imageUrl ? (
                        <img src={it.imageUrl} alt="" style={{ width: "36px", height: "36px", borderRadius: "4px", objectFit: "cover" }} />
                      ) : (
                        <div className="na-thumb--placeholder" style={{ fontSize: "0.5rem" }}>No image</div>
                      )}
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: "0.8rem", color: "#e5e7eb" }}>{it.name ?? "Unnamed item"}</span>
                        <span className="na-badge na-badge--not-analyzed" style={{ marginLeft: "0.4rem" }}>
                          {it.itemSource === "closet" ? "CLOSET" : "NADINE"}
                        </span>
                        {it.garmentRelationships.length > 0 && (
                          <p style={{ fontSize: "0.68rem", color: "#9ca3af", margin: "0.15rem 0 0" }}>{it.garmentRelationships.join(", ")}</p>
                        )}
                        {it.stylingNotes && (
                          <p style={{ fontSize: "0.68rem", color: "#9ca3af", margin: "0.15rem 0 0" }}>{it.stylingNotes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {s.outcome && (
                  <div style={{ marginTop: "1rem", borderTop: "1px solid #1f2937", paddingTop: "0.75rem" }}>
                    <p style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
                      StyleMe Outcome
                    </p>
                    <table className="na-field-table">
                      <tbody>
                        <Field label="Outcome" value={s.outcome.outcomeStatus} />
                        <Field label="Goal response" value={s.outcome.goalOutcome} />
                        <Field label="Selected direction" value={s.outcome.selectedDirection} />
                        <Field label="What worked" value={s.outcome.whatWorked} />
                        <Field label="What felt off" value={s.outcome.whatFeltOff} />
                        <Field label="Why didn't wear" value={s.outcome.didntWearReasons} />
                        <Field label="Change types" value={s.outcome.changeTypes} />
                        <Field label="Customer comment" value={s.outcome.otherChangeNote ?? s.outcome.reasonOtherNote} />
                        <Field label="Submitted" value={displayDateTime(s.outcome.submittedAt)} />
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
