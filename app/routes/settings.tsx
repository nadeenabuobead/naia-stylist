// app/routes/settings.tsx
// Settings & Privacy V1 — every visible control is genuinely implemented.
//
// What this page does:
//   - Displays account name + email (read-only)
//   - Exposes real server-backed deletion for My nAia Model (body) photos
//   - The selfie-based visual-analysis feature is V1-deactivated — no controls for it here
//   - Provides honest mailto links for data export and account deletion requests
//   - Explains how nAia personalises the experience (informational only)
//   - Exposes real server-backed Closet photo removal — individually
//     (delete-closet-photo, image fields only, garment kept) and in bulk
//     (delete-all-closet-photos) — see closet-photo-privacy.server.ts
//   - Exposes real server-backed deletion for VTO result images (bulk; job
//     records are preserved)
//   - Exposes real server-backed deletion for Buy or Skip uploaded images
//     (verdict/history preserved)
//
// What is intentionally absent:
//   - Communication preferences (no schema or backend — removed until built)
//   - Shopify address management (managed by NADINE/Shopify — not a nAia setting)
//   - Immediate account deletion (requires cross-feature cascade audit)
//   - Personalisation opt-out (no backend preference exists)

import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { data } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { conciseFamilyName } from "~/lib/customer-name-display";
import {
  deleteNaiaModelPhoto,
  withdrawSaveModelConsent,
} from "~/lib/ai/my-naia-model.server";
import {
  deleteCustomerVtoResults,
  customerHasVtoResults,
} from "~/lib/ai/fashn-tryon-service.server";
import {
  deleteCustomerBosImages,
  customerHasBosImages,
  deleteOneBosImage,
  listCustomerBosImages,
} from "~/lib/buy-or-skip-privacy.server";
import {
  deleteClosetItemPhoto,
  deleteAllClosetPhotos,
  listCustomerClosetPhotos,
} from "~/lib/closet-photo-privacy.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "Settings & Privacy | nAia" }];
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);

  const [modelRecord, hasVtoResults, hasBosImages, closetPhotos, bosPhotos] = await Promise.all([
    prisma.naiaModel.findUnique({
      where: { customerId: customer.id },
      select: { facePublicId: true, bodyPublicId: true, saveModelConsentAt: true },
    }),
    customerHasVtoResults(customer.id),
    customerHasBosImages(customer.id),
    listCustomerClosetPhotos(customer.id),
    listCustomerBosImages(customer.id),
  ]);

  // Derive public-safe booleans — private IDs never leave the server.
  // hasFace is V1-internal only: it is never surfaced as its own control (the
  // face-photo slot is not customer-facing in V1) — it only widens the "remove
  // all" bulk action's visibility for legacy accounts that still have one.
  const hasFace = modelRecord !== null && modelRecord.facePublicId !== null;
  const hasBody = modelRecord !== null && modelRecord.bodyPublicId !== null;

  return data({
    firstName:     customer.firstName,
    lastName:      customer.lastName,
    email:         customer.email,
    model:         modelRecord  !== null ? { hasFace,  hasBody }     : null,
    hasVtoResults,
    hasBosImages,
    closetPhotos,
    bosPhotos,
  });
}

// ── Action ────────────────────────────────────────────────────────────────────

const VALID_INTENTS = new Set([
  "delete-model-body",
  "delete-model-all",
  "delete-vto-results",
  "delete-bos-images",
  "delete-bos-image",
  "delete-selected-bos-images",
  "delete-closet-photo",
  "delete-selected-closet-photos",
  "delete-all-closet-photos",
]);

type DestructiveIntent =
  | "delete-model-body"
  | "delete-model-all"
  | "delete-vto-results"
  | "delete-bos-images"
  | "delete-bos-image"
  | "delete-selected-bos-images"
  | "delete-closet-photo"
  | "delete-selected-closet-photos"
  | "delete-all-closet-photos";

type Intent = DestructiveIntent;

const SUCCESS_MESSAGES: Record<Intent, string> = {
  "delete-model-body":        "Your saved body photo has been removed from your nAia Model.",
  "delete-model-all":         "Your saved nAia Model photos and consent have been permanently removed.",
  "delete-vto-results":       "Your saved Virtual Try-On preview images have been permanently removed.",
  "delete-bos-images":        "Your Buy or Skip uploaded images have been removed. Your decision history has been kept.",
  "delete-bos-image":         "Your Buy or Skip photo has been removed. The decision is kept.",
  "delete-selected-bos-images": "The selected Buy or Skip photos have been removed. Your decisions and history are kept.",
  "delete-closet-photo":      "Your Closet photo has been removed. The item is kept.",
  "delete-selected-closet-photos": "The selected Closet photos have been removed. Your Closet items are kept.",
  "delete-all-closet-photos": "All your Closet photos have been removed. Your Closet items and their details are kept.",
};

// Parses the JSON-array-of-ids formData field used by the multi-select
// "remove selected photos" intents. Returns null for anything that isn't a
// non-empty array of non-empty strings — the caller treats that as a 400.
function parseItemIds(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string" || !raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every((id) => typeof id === "string" && id.length > 0)) return null;
  return parsed;
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData  = await request.formData();
  const intent    = formData.get("intent");

  if (typeof intent !== "string" || !VALID_INTENTS.has(intent)) {
    return data({ ok: false as const, error: "Invalid request." }, { status: 400 });
  }

  const typed = intent as Intent;

  switch (typed) {
    case "delete-model-body": {
      const r = await deleteNaiaModelPhoto(customer.id, "body");
      if (!r.ok) return data({ ok: false as const, error: "Could not remove your body photo. Please try again." }, { status: 500 });
      break;
    }
    case "delete-model-all": {
      // withdrawSaveModelConsent always clears DB references and consent; partial Cloudinary
      // failures are non-blocking because the DB record is cleared regardless.
      await withdrawSaveModelConsent(customer.id);
      break;
    }
    case "delete-vto-results": {
      // Removes all COMPLETED VTO result images from Cloudinary. Job records are preserved.
      // Partial Cloudinary failures are non-blocking — failedAssets can be retried.
      await deleteCustomerVtoResults(customer.id);
      break;
    }
    case "delete-bos-images": {
      // Removes uploaded garment images from BOS analyses. Verdict and history are preserved.
      await deleteCustomerBosImages(customer.id);
      break;
    }
    case "delete-bos-image": {
      const analysisId = formData.get("itemId");
      if (typeof analysisId !== "string" || !analysisId) {
        return data({ ok: false as const, error: "Missing item." }, { status: 400 });
      }
      const r = await deleteOneBosImage(analysisId, customer.id);
      if (!r.deleted) return data({ ok: false as const, error: "Could not remove that photo. Please try again." }, { status: 404 });
      break;
    }
    case "delete-selected-bos-images": {
      const itemIds = parseItemIds(formData.get("itemIds"));
      if (!itemIds) return data({ ok: false as const, error: "No photos selected." }, { status: 400 });
      let removed = 0;
      for (const id of itemIds) {
        const r = await deleteOneBosImage(id, customer.id);
        if (r.deleted) removed++;
      }
      if (removed === 0) return data({ ok: false as const, error: "Could not remove the selected photos. Please try again." }, { status: 404 });
      break;
    }
    case "delete-closet-photo": {
      const itemId = formData.get("itemId");
      if (typeof itemId !== "string" || !itemId) {
        return data({ ok: false as const, error: "Missing item." }, { status: 400 });
      }
      const r = await deleteClosetItemPhoto(itemId, customer.id);
      if (!r.deleted) return data({ ok: false as const, error: "Could not remove that photo. Please try again." }, { status: 404 });
      break;
    }
    case "delete-selected-closet-photos": {
      const itemIds = parseItemIds(formData.get("itemIds"));
      if (!itemIds) return data({ ok: false as const, error: "No photos selected." }, { status: 400 });
      let removed = 0;
      for (const id of itemIds) {
        const r = await deleteClosetItemPhoto(id, customer.id);
        if (r.deleted) removed++;
      }
      if (removed === 0) return data({ ok: false as const, error: "Could not remove the selected photos. Please try again." }, { status: 404 });
      break;
    }
    case "delete-all-closet-photos": {
      // Removes every uploaded Closet image. Items, names, categories, and all
      // other garment details are preserved — only the image fields are cleared.
      await deleteAllClosetPhotos(customer.id);
      break;
    }
  }

  return data({ ok: true as const, intent: typed, message: SUCCESS_MESSAGES[typed] });
}

// ── Confirmation specs ────────────────────────────────────────────────────────

const CONFIRM: Record<DestructiveIntent, { title: string; body: string; cta: string }> = {
  "delete-model-body": {
    title: "Remove saved body photo",
    body:  "Your saved body photo will be permanently deleted from your nAia Model. Virtual try-ons that use this photo will require a new one. Your styling history is not affected.",
    cta:   "Remove body photo",
  },
  "delete-model-all": {
    title: "Remove saved nAia Model photo",
    body:  "This is the photo you saved for virtual try-ons. Removing it stops virtual previews until you upload a new one. Your styling history and Closet are not affected.",
    cta:   "Remove photo",
  },
  "delete-vto-results": {
    title: "Remove Virtual Try-On preview images",
    body:  "All generated Virtual Try-On preview images will be permanently deleted. Your saved nAia Model photo is not affected — only the generated previews are removed. Your try-on history (dates and products tried) remains on your account.",
    cta:   "Remove preview images",
  },
  "delete-bos-images": {
    title: "Remove Buy or Skip uploaded images",
    body:  "The garment photos you uploaded for Buy or Skip analyses will be permanently deleted. Your Buy or Skip decisions, verdicts, and reasoning are kept — only the uploaded images are removed.",
    cta:   "Remove uploaded images",
  },
  "delete-bos-image": {
    title: "Remove this Buy or Skip photo",
    body:  "This item's uploaded photo will be permanently deleted. Its decision, verdict, and reasoning stay in your Buy or Skip history.",
    cta:   "Remove photo",
  },
  "delete-selected-bos-images": {
    title: "Remove selected photos",
    body:  "The photos you selected will be permanently deleted. Your Buy or Skip decisions, verdicts, and reasoning are kept — only the selected images are removed.",
    cta:   "Remove selected",
  },
  "delete-closet-photo": {
    title: "Remove this Closet photo",
    body:  "This item's photo will be permanently deleted. The item itself — its name, category, and details — stays in your Closet, along with any StyleMe, Trend Edit, or Buy or Skip history that references it.",
    cta:   "Remove photo",
  },
  "delete-selected-closet-photos": {
    title: "Remove selected photos",
    body:  "The photos you selected will be permanently deleted. Your Closet items and their details are kept — only the selected photos are removed.",
    cta:   "Remove selected",
  },
  "delete-all-closet-photos": {
    title: "Remove all Closet photos",
    body:  "Every photo you've uploaded to your Closet will be permanently deleted. Your Closet items and their details are kept — only the photos are removed.",
    cta:   "Remove all Closet photos",
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ControlRow({
  intent,
  label,
  description,
  buttonLabel,
  onOpen,
}: {
  intent: DestructiveIntent;
  label: string;
  description: string;
  buttonLabel: string;
  onOpen: (k: DestructiveIntent) => void;
}) {
  return (
    <div className="set-control-row">
      <div>
        <div className="set-control-title set-control-title--destructive">{label}</div>
        <p className="set-control-desc">{description}</p>
      </div>
      <button type="button" className="sp-btn-outline" onClick={() => onOpen(intent)}>
        {buttonLabel}
      </button>
    </div>
  );
}

// Resolved thumbnailUrl is already a fresh, ownership-checked signed URL (or
// null when nothing could be resolved) — see listCustomerClosetPhotos. The
// onError handler is the second line of defence: if that URL still 404s by
// the time the browser requests it (e.g. the signed URL's short window
// elapsed between render and paint), this swaps to the same intentional
// placeholder rather than ever showing a native broken-image icon.
function ClosetPhotoThumb({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div className="set-closet-photo-placeholder" aria-label="No image">No image</div>;
  }
  return <img src={src} alt={alt} className="set-closet-photo-img" onError={() => setBroken(true)} />;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { firstName, lastName, email, model, hasVtoResults, hasBosImages, closetPhotos, bosPhotos } = useLoaderData<typeof loader>();
  const fetcher     = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  // Only destructive actions open the confirmation modal; consent is
  // reversible and applies immediately. itemIds carries the gallery's
  // multi-select batch (delete-selected-*) — every other intent ignores it.
  const [pending, setPending] = useState<{ intent: DestructiveIntent; itemIds?: string[] } | null>(null);
  const openConfirm = (intent: DestructiveIntent) => setPending({ intent });
  const openConfirmForSelection = (intent: DestructiveIntent, itemIds: string[]) => setPending({ intent, itemIds });

  // Which photo-management gallery (if any) is currently expanded. Settings
  // & Privacy's default view never shows every stored photo — the gallery
  // only opens once the customer explicitly chooses to manage individual
  // photos, per the "clean controls, not a photo gallery" product direction.
  const [expandedGallery, setExpandedGallery] = useState<"closet" | "bos" | null>(null);
  const [closetSelected, setClosetSelected] = useState<Set<string>>(new Set());
  const [bosSelected, setBosSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSet(next);
  };
  const closeGallery = () => {
    setExpandedGallery(null);
    setClosetSelected(new Set());
    setBosSelected(new Set());
  };

  const fullName    = [firstName, conciseFamilyName(lastName)].filter(Boolean).join(" ") || null;
  const isSubmitting = fetcher.state !== "idle";
  const actionData  = fetcher.data;

  // Close modal and refresh loader state after a successful deletion.
  useEffect(() => {
    if (actionData?.ok) {
      setPending(null);
      setExpandedGallery(null);
      setClosetSelected(new Set());
      setBosSelected(new Set());
      revalidator.revalidate();
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasModelSection  = model  !== null;

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Settings & Privacy</div>
        <h1 className="sp-shell-title">Settings & <span className="sp-shell-accent">privacy.</span></h1>
      </div>

      {/* ── Account Details ───────────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Account Details</div>
        <h2 className="set-section-title">Account Details</h2>
        <dl className="sp-detail-list">
          {fullName && (
            <div className="sp-detail-row">
              <dt className="sp-detail-label">Name</dt>
              <dd className="sp-detail-value">{fullName}</dd>
            </div>
          )}
          {email && (
            <div className="sp-detail-row">
              <dt className="sp-detail-label">Email</dt>
              <dd className="sp-detail-value">{email}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* ── My nAia Model ─────────────────────────────────────────────────── */}
      {hasModelSection && (
        <section className="bos-section">
          <div className="set-section-eyebrow">My nAia Model</div>
          <h2 className="set-section-title">My nAia Model</h2>
          <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
            This is the photo you saved for virtual try-ons. Removing it stops virtual previews until you upload a new one. Your styling history and Closet are not affected.
          </p>
          <div className="set-controls">
            {(model.hasFace || model.hasBody) && (
              <ControlRow
                intent="delete-model-all"
                label="Remove saved nAia Model photo"
                description="Permanently deletes the photo you saved for your nAia Model."
                buttonLabel="Remove photo"
                onOpen={openConfirm}
              />
            )}
            {!model.hasFace && !model.hasBody && (
              <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)" }}>
                You have no saved nAia Model photos on file.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── My Closet Photos ─────────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">My Closet Photos</div>
        <h2 className="set-section-title">My Closet Photos</h2>
        <p className="sp-shell-desc" style={{ marginBottom: "16px" }}>
          Photos you upload to your Closet are stored privately. You can remove individual photos without deleting the Closet item, or remove all Closet photos at once.
        </p>

        {expandedGallery !== "closet" ? (
          <div className="set-gallery-actions" style={{ marginTop: 0 }}>
            {closetPhotos.length > 0 && (
              <>
                <button type="button" className="sp-btn-outline" onClick={() => setExpandedGallery("closet")}>
                  Choose photos to remove
                </button>
                <button type="button" className="sp-btn-outline" onClick={() => openConfirm("delete-all-closet-photos")}>
                  Remove all photos
                </button>
              </>
            )}
            <Link to="/closet" className="sp-btn-outline" style={{ display: "inline-block", textDecoration: "none" }}>
              Go to My Closet
            </Link>
          </div>
        ) : (
          <>
            <div className="set-closet-photo-grid">
              {closetPhotos.map((item) => {
                const selected = closetSelected.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`set-closet-photo-card set-select-card${selected ? " set-select-card--selected" : ""}`}
                    onClick={() => toggleSelected(closetSelected, setClosetSelected, item.id)}
                  >
                    <input
                      type="checkbox"
                      className="set-select-checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(closetSelected, setClosetSelected, item.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${item.name ?? "Closet item"}`}
                    />
                    <ClosetPhotoThumb src={item.thumbnailUrl} alt={item.name ?? "Closet item"} />
                    <div className="set-closet-photo-name">{item.name ?? "Untitled item"}</div>
                  </div>
                );
              })}
            </div>
            <div className="set-gallery-actions">
              <span className="set-gallery-count">{closetSelected.size} selected</span>
              <button
                type="button"
                className="sp-btn-primary"
                disabled={closetSelected.size === 0}
                onClick={() => openConfirmForSelection("delete-selected-closet-photos", [...closetSelected])}
              >
                Remove selected
              </button>
              <button type="button" className="sp-btn-ghost" onClick={closeGallery}>
                Cancel
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Virtual Try-On Preview Images ─────────────────────────────────── */}
      {hasVtoResults && (
        <section className="bos-section">
          <div className="set-section-eyebrow">Virtual Try-On</div>
          <h2 className="set-section-title">Virtual Try-On Preview Images</h2>
          <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
            Generated try-on previews are stored privately on your account. View or remove individual previews in My nAia Model — removing them does not affect your saved nAia Model photo or your try-on history.
          </p>
          <div className="set-gallery-actions" style={{ marginTop: 0 }}>
            <Link to="/my-naia-model#try-on-previews" className="sp-btn-outline" style={{ textDecoration: "none" }}>
              Manage previews
            </Link>
            <button type="button" className="sp-btn-outline" onClick={() => openConfirm("delete-vto-results")}>
              Delete all previews
            </button>
          </div>
        </section>
      )}

      {/* ── Buy or Skip Uploaded Images ───────────────────────────────────── */}
      {hasBosImages && (
        <section className="bos-section">
          <div className="set-section-eyebrow">Buy or Skip</div>
          <h2 className="set-section-title">Buy or Skip Uploaded Images</h2>
          <p className="sp-shell-desc" style={{ marginBottom: "16px" }}>
            Images you upload for Buy or Skip are stored privately. You can remove individual uploaded images or remove them all. Your decisions, recommendations and history are kept.
          </p>

          {expandedGallery !== "bos" ? (
            <div className="set-gallery-actions" style={{ marginTop: 0 }}>
              <button type="button" className="sp-btn-outline" onClick={() => setExpandedGallery("bos")}>
                Choose images to remove
              </button>
              <button type="button" className="sp-btn-outline" onClick={() => openConfirm("delete-bos-images")}>
                Remove all images
              </button>
            </div>
          ) : (
            <>
              <div className="set-closet-photo-grid">
                {bosPhotos.map((item) => {
                  const selected = bosSelected.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`set-closet-photo-card set-select-card${selected ? " set-select-card--selected" : ""}`}
                      onClick={() => toggleSelected(bosSelected, setBosSelected, item.id)}
                    >
                      <input
                        type="checkbox"
                        className="set-select-checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(bosSelected, setBosSelected, item.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${item.productName ?? "Buy or Skip item"}`}
                      />
                      <ClosetPhotoThumb src={item.thumbnailUrl} alt={item.productName ?? "Buy or Skip item"} />
                      <div className="set-closet-photo-name">{item.productName ?? "Untitled item"}</div>
                    </div>
                  );
                })}
              </div>
              <div className="set-gallery-actions">
                <span className="set-gallery-count">{bosSelected.size} selected</span>
                <button
                  type="button"
                  className="sp-btn-primary"
                  disabled={bosSelected.size === 0}
                  onClick={() => openConfirmForSelection("delete-selected-bos-images", [...bosSelected])}
                >
                  Remove selected
                </button>
                <button type="button" className="sp-btn-ghost" onClick={closeGallery}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── How nAia personalises your experience ────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">HOW YOUR INFORMATION IS USED</div>
        <h2 className="set-section-title">Personalisation</h2>
        <p className="sp-shell-desc">
          {/* Data-sharing / marketing claims require sign-off from the Privacy Policy — omitted until approved. */}
          nAia personalises your styling experience using information you provide directly — your Style Passport, your Closet, your post-wear feedback, and your interactions with StyleMe.
        </p>
        <p className="sp-shell-desc" style={{ marginTop: "12px" }}>
          nAia may also use aggregated, coarsened patterns across customers — never your individual
          Style Passport, Closet, Closet photographs, Taste observations, or named identity — to help
          inform design decisions. See our Privacy Policy for details.
        </p>
      </section>

      {/* ── Your Data & Privacy ───────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Your Data & Privacy</div>
        <h2 className="set-section-title">Your Data</h2>
        <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
          Use the options below to request a copy of your data or to request deletion of your account. Requests are processed within 30 days in accordance with our Privacy Policy. For other queries, contact{" "}
          <a
            href="mailto:privacy@naiabynadine.com"
            style={{ color: "var(--naia-accent)" }}
          >
            privacy@naiabynadine.com
          </a>
          .
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <a
            href="mailto:privacy@naiabynadine.com?subject=Data%20export%20request%20—%20nAia"
            className="sp-btn-outline"
            style={{ textDecoration: "none" }}
          >
            Request a copy of my data
          </a>
          <a
            href="mailto:privacy@naiabynadine.com?subject=Account%20deletion%20request%20—%20nAia"
            className="sp-btn-outline"
            style={{ textDecoration: "none" }}
          >
            Request account deletion
          </a>
        </div>
      </section>

      {/* Sign Out lives in the authenticated left nav (Account group) now —
          not duplicated here. See MyNaiaLayout.tsx. */}

      {/* ── Server-backed success feedback ───────────────────────────────── */}
      {actionData?.ok && (
        <div className="sp-state-note" style={{ marginTop: "32px" }}>
          {actionData.message}
        </div>
      )}

      {/* ── Server-backed error feedback ─────────────────────────────────── */}
      {actionData && !actionData.ok && (
        <div
          className="sp-state-note"
          style={{ marginTop: "32px", borderColor: "var(--naia-destructive, #c0392b)", color: "var(--naia-destructive, #c0392b)" }}
        >
          {actionData.error}
        </div>
      )}

      {/* ── Confirmation modal ────────────────────────────────────────────── */}
      {pending && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Confirm</div>
            <h3 id="settings-confirm-title" className="dc-modal-title">{CONFIRM[pending.intent].title}</h3>
            <p className="dc-modal-desc">{CONFIRM[pending.intent].body}</p>
            <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", color: "var(--naia-muted)", marginBottom: "8px" }}>
              This action cannot be undone.
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
                onClick={() =>
                  fetcher.submit(
                    pending.itemIds
                      ? { intent: pending.intent, itemIds: JSON.stringify(pending.itemIds) }
                      : { intent: pending.intent },
                    { method: "post" },
                  )
                }
              >
                {isSubmitting ? "Removing…" : CONFIRM[pending.intent].cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
