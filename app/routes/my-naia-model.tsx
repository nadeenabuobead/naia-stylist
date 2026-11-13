// app/routes/my-naia-model.tsx
// Authenticated My nAia Model route.
// Loader: reads NaiaModel record from DB; generates per-request signed URLs (never stored).
// Actions: save-photo, delete-photo, save-consent, withdraw-consent, withdraw-photo-analysis-consent.
//
// Privacy contract:
//   - Photo URLs are signed per-request and never persisted or returned to the loader as-is.
//   - save-photo returns a signed previewUrl for immediate client display.
//   - Deletion is Cloudinary-first (see deleteNaiaModelPhoto).

import { useState, useEffect } from "react";
import { data, type LinksFunction, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import {
  loadNaiaModel,
  saveNaiaModelPhoto,
  deleteNaiaModelPhoto,
  saveNaiaModelConsent,
  withdrawPhotoAnalysisConsent,
  computeModelReadinessFromRecord,
  buildModelPreviewUrl,
  POLICY_VERSION,
} from "~/lib/ai/my-naia-model.server";
import {
  listCustomerVtoPreviews,
  deleteOneVtoResult,
  deleteCustomerVtoResults,
  deleteNaiaModelBodyPhotoAndVtoResults,
  withdrawSaveModelConsentAndVtoResults,
} from "~/lib/ai/fashn-tryon-service.server";
import NaiaModelPhotoUpload from "~/components/NaiaModelPhotoUpload";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "My nAia Model | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const model = await loadNaiaModel(customer.id);
  const readiness = computeModelReadinessFromRecord(model);

  // Per-request time-limited private_download URL — never persisted. Null if config missing.
  // V1 is body-only customer-facing; the face slot (facePublicId) is kept in the server
  // action/service layer for reactivation but is not surfaced to this page.
  const bodyDeliveryUrl = model?.bodyPublicId
    ? buildModelPreviewUrl(model.bodyPublicId, model.bodyFormat ?? null, model.deliveryType ?? "private")
    : null;

  // Your Try-On Previews — conceptually and visually separate from the saved
  // source photo above. Every entry here is a generated result, never the
  // model photo itself. previewUrl is a fresh signed URL per request (see
  // listCustomerVtoPreviews) — never persisted, same contract as bodyDeliveryUrl.
  const previews = await listCustomerVtoPreviews(customer.id);

  return data({
    customerId: customer.id,
    bodyDeliveryUrl,
    saveModelConsentGiven: !!model?.saveModelConsentAt,
    readiness,
    previews,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-photo") {
    const slot = formData.get("slot") as "face" | "body";
    const publicId = formData.get("publicId") as string;
    const version = (formData.get("version") as string) || null;    // browser-supplied; superseded by Admin API verification
    const format = (formData.get("format") as string) || null;      // browser-supplied; superseded by Admin API verification
    const deliveryType = "private"; // never read from browser — prevents delivery-type downgrade

    if (!slot || !publicId) {
      return data({ ok: false, error: "Missing required fields." }, { status: 400 });
    }

    const result = await saveNaiaModelPhoto(customer.id, slot, publicId, version, format, deliveryType);
    if (!result.ok) {
      return data({ ok: false, error: result.error }, { status: 422 });
    }

    if (result.orphanPublicId) {
      // Old Cloudinary asset could not be deleted — safe to ignore (stale ref to a replaced asset).
      // A background cleanup job can retry using model.deliveryType.
      console.warn("naia:orphan-asset", { customerId: customer.id, slot, orphanPublicId: result.orphanPublicId });
    }

    // Return a time-limited private_download URL for immediate client preview.
    // This URL expires in 10 minutes and is never persisted or logged.
    const previewUrl = buildModelPreviewUrl(publicId, format, deliveryType);
    return data({ ok: true, previewUrl });
  }

  if (intent === "delete-photo") {
    const slot = formData.get("slot") as "face" | "body";
    if (!slot) {
      return data({ ok: false, error: "Missing slot." }, { status: 400 });
    }

    if (slot === "body") {
      // Cascades to any already-COMPLETED VTO results derived from this
      // photo — see deleteNaiaModelBodyPhotoAndVtoResults's own header
      // comment in fashn-tryon-service.server.ts. Face-slot deletion below
      // is unaffected and unchanged: VTO results are never derived from the
      // face photo.
      const result = await deleteNaiaModelBodyPhotoAndVtoResults(customer.id);
      if (result.staleReference) {
        // Cloudinary asset deleted but DB clear failed. DB still references deleted asset.
        // Any preview URL generated for it will 404 — no privacy risk.
        // Log for retry; return ok so the client clears its local state.
        console.warn("naia:stale-reference", { customerId: customer.id, slot });
      }
      if (!result.ok && !result.staleReference) {
        return data({ ok: false, error: "Could not delete photo. Please try again." }, { status: 500 });
      }
      if (result.vtoResultsPendingCleanup.length > 0) {
        // The photo is gone; some saved try-on previews could not be
        // removed from Cloudinary on this attempt and are durably queued
        // for retry (PendingCloudinaryDeletion), not silently dropped.
        console.warn("naia:vto-cleanup-pending", {
          customerId: customer.id,
          pending: result.vtoResultsPendingCleanup.length,
        });
        return data({ ok: true, vtoResultsPendingCleanup: true });
      }
      return data({ ok: true });
    }

    // Face slot — unchanged: no VTO cascade, same as before this fix.
    const result = await deleteNaiaModelPhoto(customer.id, slot);
    if (result.staleReference) {
      console.warn("naia:stale-reference", { customerId: customer.id, slot });
    }
    if (!result.ok && !result.staleReference) {
      return data({ ok: false, error: "Could not delete photo. Please try again." }, { status: 500 });
    }
    return data({ ok: true });
  }

  if (intent === "save-consent") {
    const types: ("photoAnalysis" | "saveModel")[] = [];
    if (formData.get("photoAnalysis") === "true") types.push("photoAnalysis");
    if (formData.get("saveModel") === "true") types.push("saveModel");

    await saveNaiaModelConsent(customer.id, types, POLICY_VERSION);
    return data({ ok: true });
  }

  if (intent === "withdraw-consent") {
    // Withdraws save-model consent: deletes Cloudinary assets, clears DB
    // references, and cascades to any COMPLETED VTO results (body is always
    // cleared by this path regardless of Cloudinary outcome) — see
    // withdrawSaveModelConsentAndVtoResults's header comment.
    const result = await withdrawSaveModelConsentAndVtoResults(customer.id);
    if (!result.ok && result.failedAssets.length > 0) {
      console.warn("naia:partial-withdrawal", { customerId: customer.id, failedAssets: result.failedAssets });
    }
    if (result.vtoResultsPendingCleanup.length > 0) {
      console.warn("naia:vto-cleanup-pending", {
        customerId: customer.id,
        pending: result.vtoResultsPendingCleanup.length,
      });
      return data({ ok: true, vtoResultsPendingCleanup: true });
    }
    return data({ ok: true });
  }

  if (intent === "withdraw-photo-analysis-consent") {
    // Withdraws photo-analysis consent only. Does not touch photos or save-model consent.
    await withdrawPhotoAnalysisConsent(customer.id);
    return data({ ok: true });
  }

  if (intent === "delete-one-preview") {
    const jobId = formData.get("jobId") as string;
    if (!jobId) return data({ ok: false, error: "Missing preview." }, { status: 400 });
    const result = await deleteOneVtoResult(jobId, customer.id);
    if (!result.deleted) return data({ ok: false, error: "Could not remove that preview. Please try again." }, { status: 404 });
    return data({ ok: true });
  }

  if (intent === "delete-all-previews") {
    // Removes every generated result image. Job rows (usage/history) and the
    // saved source/model photo are both untouched.
    await deleteCustomerVtoResults(customer.id);
    return data({ ok: true });
  }

  return data({ ok: false, error: "Unknown action." }, { status: 400 });
}

// Resolved previewUrl is already a fresh, ownership-checked signed URL (or
// null when the job predates signed delivery) — see listCustomerVtoPreviews.
// onError is the second line of defence: if a preview's image has been
// deleted (individually or via bulk removal), the derived URL 404s and this
// swaps to the same intentional "Preview removed" state rather than ever
// showing a native broken-image icon.
function VtoPreviewThumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div className="set-closet-photo-placeholder" aria-label="Preview removed">Preview removed</div>;
  }
  return <img src={src} alt="Your Virtual Try-On preview" className="set-closet-photo-img" onError={() => setBroken(true)} />;
}

export default function MyNaiaModelRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const { previews } = loaderData;
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [pending, setPending] = useState<{ intent: "delete-one-preview" | "delete-all-previews"; jobId?: string } | null>(null);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if ((fetcher.data as { ok?: boolean } | undefined)?.ok) {
      setPending(null);
      revalidator.revalidate();
    }
  }, [fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Personalisation · Virtual Try-On</div>
        <h1 className="sp-shell-title">MY nAia <span className="sp-shell-accent">model.</span></h1>
        <p className="sp-shell-desc">
          Photos added to My nAia Model are stored privately so nAia can reuse them for your styling
          and try-on experiences. You can replace or remove them at any time.
        </p>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginTop: "8px" }}>
          Virtual previews show styling direction and silhouette rather than exact physical fit.
        </p>
      </div>

      {/* ── Your nAia Model Photo ─────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Your nAia Model Photo</div>
        <h2 className="set-section-title">Your nAia Model Photo</h2>
        <NaiaModelPhotoUpload {...loaderData} />
      </section>

      {/* ── Your Try-On Previews ──────────────────────────────────────────── */}
      <section className="bos-section" id="try-on-previews">
        <div className="set-section-eyebrow">Your Try-On Previews</div>
        <h2 className="set-section-title">Your Try-On Previews</h2>
        <p className="sp-shell-desc" style={{ marginBottom: "16px" }}>
          These are the Virtual Try-On previews nAia has generated for you. They are separate from
          your saved nAia Model photo above — removing a preview never affects that photo.
        </p>

        {previews.length === 0 ? (
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)" }}>
            You have no saved Try-On previews yet.
          </p>
        ) : (
          <>
            <div className="vto-preview-grid">
              {previews.map((preview) => (
                <div key={preview.jobId} className="set-closet-photo-card">
                  <VtoPreviewThumb src={preview.previewUrl} />
                  <div className="set-closet-photo-name">
                    {preview.label}
                    <br />
                    <span style={{ opacity: 0.6 }}>
                      {new Date(preview.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sp-btn-outline"
                    style={{ width: "100%", fontSize: "11px", padding: "7px 10px" }}
                    onClick={() => setPending({ intent: "delete-one-preview", jobId: preview.jobId })}
                  >
                    Delete Preview
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "16px" }}>
              <button
                type="button"
                className="sp-btn-outline"
                onClick={() => setPending({ intent: "delete-all-previews" })}
              >
                Delete All Try-On Previews
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Confirmation modal ────────────────────────────────────────────── */}
      {pending && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="vto-confirm-title">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Confirm</div>
            <h3 id="vto-confirm-title" className="dc-modal-title">
              {pending.intent === "delete-one-preview" ? "Delete this preview" : "Delete all Try-On previews"}
            </h3>
            <p className="dc-modal-desc">
              {pending.intent === "delete-one-preview"
                ? "This generated preview will be permanently deleted. Your other previews, your saved nAia Model photo, and your try-on history are not affected."
                : "All of your generated Try-On previews will be permanently deleted. Your saved nAia Model photo and your try-on history are not affected."}
            </p>
            <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", color: "var(--naia-muted)", marginBottom: "8px" }}>
              This action cannot be undone.
            </p>
            <div className="dc-modal-actions">
              <button type="button" className="sp-btn-ghost" onClick={() => setPending(null)} disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className="sp-btn-primary"
                disabled={isSubmitting}
                onClick={() =>
                  fetcher.submit(
                    pending.intent === "delete-one-preview"
                      ? { intent: "delete-one-preview", jobId: pending.jobId! }
                      : { intent: "delete-all-previews" },
                    { method: "post" },
                  )
                }
              >
                {isSubmitting ? "Deleting…" : pending.intent === "delete-one-preview" ? "Delete preview" : "Delete all previews"}
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
