// app/routes/settings.tsx
// Settings & Privacy V1 — every visible control is genuinely implemented.
//
// What this page does:
//   - Displays account name + email (read-only)
//   - Exposes real server-backed deletion for My nAia Model (body) photos —
//     a single "Remove saved nAia Model photo" control (one source photo,
//     no face/body distinction)
//   - The selfie-based visual-analysis feature is V1-deactivated — no controls for it here
//   - 2026-10-19: real data export (instant client-side download, built from
//     app/lib/customer-privacy.server.ts) and real, immediate account
//     deletion — no longer mailto links. See the "delete-account" and
//     "request-data-export" intents below. Account deletion is entirely
//     independent of any subscription/billing state (no Stripe integration
//     exists yet, and this must stay a separate concern once one does).
//   - Explains how nAia personalises the experience (informational only)
//   - Exposes real server-backed BULK deletion for Closet photos, Buy or
//     Skip uploaded images, and VTO previews. Individual (per-item) removal
//     is NOT offered here — Settings & Privacy is a privacy/deletion
//     control surface, not a photo gallery. Each section instead links to
//     the feature page where that content actually lives and where
//     per-item management belongs:
//       Closet photos        -> /closet            (closet-photo-privacy.server.ts)
//       Buy or Skip images    -> /my-naia/buying-decisions (buy-or-skip-privacy.server.ts)
//       VTO previews          -> /my-naia-model#try-on-previews (fashn-tryon-service.server.ts)
//
// What is intentionally absent:
//   - Communication preferences (no schema or backend — removed until built)
//   - Shopify address management (managed by NADINE/Shopify — not a nAia setting)
//   - Personalisation opt-out (no backend preference exists)

import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { data, redirect } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { clerkClient } from "@clerk/react-router/server";
import { compileCustomerExport, eraseCustomerData } from "~/lib/customer-privacy.server";
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
} from "~/lib/buy-or-skip-privacy.server";
import {
  deleteAllClosetPhotos,
  customerHasClosetPhotos,
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

  const [modelRecord, hasVtoResults, hasBosImages, hasClosetPhotos] = await Promise.all([
    prisma.naiaModel.findUnique({
      where: { customerId: customer.id },
      select: { facePublicId: true, bodyPublicId: true, saveModelConsentAt: true },
    }),
    customerHasVtoResults(customer.id),
    customerHasBosImages(customer.id),
    customerHasClosetPhotos(customer.id),
  ]);

  // Derive public-safe booleans — private IDs never leave the server.
  // hasFace is V1-internal only: it is never surfaced as its own control (the
  // face-photo slot is not customer-facing in V1) — it only widens the single
  // "Remove saved nAia Model photo" control's visibility for legacy accounts
  // that still have one.
  const hasFace = modelRecord !== null && modelRecord.facePublicId !== null;
  const hasBody = modelRecord !== null && modelRecord.bodyPublicId !== null;

  return data({
    firstName:     customer.firstName,
    lastName:      customer.lastName,
    email:         customer.email,
    model:         modelRecord  !== null ? { hasFace,  hasBody }     : null,
    hasVtoResults,
    hasBosImages,
    hasClosetPhotos,
  });
}

// ── Action ────────────────────────────────────────────────────────────────────

const VALID_INTENTS = new Set([
  "delete-model-body",
  "delete-model-all",
  "delete-vto-results",
  "delete-bos-images",
  "delete-all-closet-photos",
  "request-data-export",
  "delete-account",
]);

type DestructiveIntent =
  | "delete-model-body"
  | "delete-model-all"
  | "delete-vto-results"
  | "delete-bos-images"
  | "delete-all-closet-photos"
  | "delete-account";

type Intent = DestructiveIntent | "request-data-export";

const SUCCESS_MESSAGES: Record<DestructiveIntent, string> = {
  "delete-model-body":        "Your saved body photo has been removed from your nAia Model.",
  "delete-model-all":         "Your saved nAia Model photos and consent have been permanently removed.",
  "delete-vto-results":       "Your saved Virtual Try-On preview images have been permanently removed.",
  "delete-bos-images":        "Your Buy or Skip uploaded images have been removed. Your decision history has been kept.",
  "delete-all-closet-photos": "All your Closet photos have been removed. Your Closet items and their details are kept.",
  "delete-account":           "Your account and all associated data have been permanently deleted.",
};

export async function action(args: ActionFunctionArgs) {
  const { request } = args;
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
    case "delete-all-closet-photos": {
      // Removes every uploaded Closet image. Items, names, categories, and all
      // other garment details are preserved — only the image fields are cleared.
      await deleteAllClosetPhotos(customer.id);
      break;
    }
    case "request-data-export": {
      // Self-service version of the same compile step the Shopify
      // customers/data_request webhook triggers — one implementation,
      // two entry points (see customer-privacy.server.ts). Returned
      // directly in the response for a client-side download; nothing is
      // emailed, nothing is written to disk server-side.
      const exportData = await compileCustomerExport(customer.id);
      return data({ ok: true as const, intent: "request-data-export" as const, exportData });
    }
    case "delete-account": {
      // Entirely independent of any subscription/billing state — there is
      // no Stripe integration yet, and this must never be conflated with a
      // cancellation flow even once one exists. eraseCustomerData deletes
      // this exact Customer row (and, via cascade, everything referencing
      // it), which also invalidates the NaiaSession this very request is
      // authenticated by — so the response clears the session cookie and
      // redirects, the same pattern /auth/logout already uses, rather than
      // returning to a page for a customer who no longer has an account.
      await eraseCustomerData(customer.id);
      // Clerk (2026-11-04) — erase nAia's own data FIRST, Clerk cleanup
      // second: if the Clerk call below ever fails, the actual PII-bearing
      // erasure has already succeeded (the real compliance obligation) and
      // a stale, now-unlinked Clerk login is a minor, recoverable leftover
      // (worst case: signing back in just creates a fresh, empty account —
      // not a privacy problem). The reverse order would risk the opposite:
      // Clerk account gone, nAia row silently orphaned with no login path
      // left to ever erase it through this same flow again.
      //
      // Deleting the Clerk user outright (not just revoking one session) is
      // what "delete my account" should mean — it also ends every session
      // for this identity, not just the one making this request, and there
      // is no Clerk-hosted email/password left over once nAia's own PII is
      // gone, which revoking a session alone would not address.
      if (customer.clerkUserId) {
        await clerkClient(args).users.deleteUser(customer.clerkUserId).catch(() => {});
      }
      return redirect("/auth/signed-out");
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
    title: "Remove all saved try-on previews",
    body:  "All generated Virtual Try-On preview images will be permanently deleted. Your saved nAia Model photo is not affected — only the generated previews are removed. Your try-on history (dates and products tried) remains on your account.",
    cta:   "Remove all previews",
  },
  "delete-bos-images": {
    title: "Remove all Buy or Skip uploaded images",
    body:  "The garment photos you uploaded for Buy or Skip analyses will be permanently deleted. Your Buy or Skip decisions, verdicts, and reasoning are kept — only the uploaded images are removed.",
    cta:   "Remove all images",
  },
  "delete-all-closet-photos": {
    title: "Remove all Closet photos",
    body:  "Every photo you've uploaded to your Closet will be permanently deleted. Your Closet items and their details are kept — only the photos are removed.",
    cta:   "Remove all Closet photos",
  },
  "delete-account": {
    title: "Permanently delete your account",
    body:  "This deletes your account and everything in it — Style Passport, Closet, StyleMe history, Buy or Skip decisions, Virtual Try-On results, and your nAia Model photo. This cannot be undone, and there is no recovery period. You'll be signed out immediately. This is separate from any subscription — it does not cancel a membership, and cancelling a membership does not delete your account.",
    cta:   "Permanently delete my account",
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

// ── Component ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { firstName, lastName, email, model, hasVtoResults, hasBosImages, hasClosetPhotos } = useLoaderData<typeof loader>();
  const fetcher     = useFetcher<typeof action>();
  // Separate fetcher for data export — it's not destructive, doesn't use the
  // confirm modal, and triggering a client-side download on its response
  // shouldn't be entangled with the delete-flow's modal-close/revalidate logic.
  const exportFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  // Only destructive actions open the confirmation modal; consent is
  // reversible and applies immediately. Every intent here is a bulk action —
  // Settings & Privacy never manages a single item, so no itemId is needed.
  const [pending, setPending] = useState<DestructiveIntent | null>(null);
  const openConfirm = (intent: DestructiveIntent) => setPending(intent);

  const fullName    = [firstName, conciseFamilyName(lastName)].filter(Boolean).join(" ") || null;
  const isSubmitting = fetcher.state !== "idle";
  const actionData  = fetcher.data;

  // Close modal and refresh loader state after a successful deletion.
  // delete-account redirects server-side (new session, signed out) and never
  // reaches this component again, so it needs no special case here.
  useEffect(() => {
    if (actionData?.ok) {
      setPending(null);
      revalidator.revalidate();
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data export: build the download entirely client-side from the JSON the
  // action already returned — no server-side file, no email, nothing to clean up.
  useEffect(() => {
    if (exportFetcher.data?.ok && exportFetcher.data.intent === "request-data-export") {
      const blob = new Blob([JSON.stringify(exportFetcher.data.exportData, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `naia-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }, [exportFetcher.data]);

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
          To remove a specific Closet photo, manage that item in My Closet. Or remove all Closet photos here at once.
        </p>
        <div className="set-action-row">
          <Link to="/closet" className="sp-btn-outline" style={{ display: "inline-block", textDecoration: "none" }}>
            Go to My Closet
          </Link>
          {hasClosetPhotos && (
            <button type="button" className="sp-btn-outline" onClick={() => openConfirm("delete-all-closet-photos")}>
              Remove all Closet photos
            </button>
          )}
        </div>
      </section>

      {/* ── Virtual Try-On Preview Images ─────────────────────────────────── */}
      {hasVtoResults && (
        <section className="bos-section">
          <div className="set-section-eyebrow">Virtual Try-On</div>
          <h2 className="set-section-title">Virtual Try-On Preview Images</h2>
          <p className="sp-shell-desc" style={{ marginBottom: "16px" }}>
            To view or delete a specific try-on preview, go to My nAia Model. Or remove all saved try-on previews here at once.
          </p>
          <div className="set-action-row">
            <Link to="/my-naia-model#try-on-previews" className="sp-btn-outline" style={{ textDecoration: "none" }}>
              Go to My nAia Model
            </Link>
            <button type="button" className="sp-btn-outline" onClick={() => openConfirm("delete-vto-results")}>
              Remove all previews
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
            To remove a specific uploaded image, open the relevant Buy or Skip result. Or remove all Buy or Skip uploaded images here at once. Your decisions, recommendations and history will remain.
          </p>
          <div className="set-action-row">
            <Link to="/my-naia/buying-decisions" className="sp-btn-outline" style={{ textDecoration: "none" }}>
              Go to Buy or Skip
            </Link>
            <button type="button" className="sp-btn-outline" onClick={() => openConfirm("delete-bos-images")}>
              Remove all images
            </button>
          </div>
        </section>
      )}

      {/* ── How nAia personalises your experience ────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">HOW YOUR INFORMATION IS USED</div>
        <h2 className="set-section-title">Personalisation</h2>
        <p className="sp-shell-desc">
          {/* Data-sharing / marketing claims require sign-off from the Privacy Policy — omitted until approved. */}
          nAia personalises your styling experience using information you provide directly — your Style Passport, your Closet, your post-wear feedback and your interactions with StyleMe.
        </p>
      </section>

      {/* ── Your Data & Privacy ───────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Your Data & Privacy</div>
        <h2 className="set-section-title">Your Data</h2>
        <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
          Download a copy of your data instantly, or permanently delete your account below, in accordance with our Privacy Policy. For other queries, contact{" "}
          <a
            href="mailto:privacy@naiabynadine.com"
            style={{ color: "var(--naia-accent)" }}
          >
            privacy@naiabynadine.com
          </a>
          .
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <button
            type="button"
            className="sp-btn-outline"
            disabled={exportFetcher.state !== "idle"}
            onClick={() => exportFetcher.submit({ intent: "request-data-export" }, { method: "post" })}
          >
            {exportFetcher.state !== "idle" ? "Preparing…" : "Download a copy of my data"}
          </button>
          <button
            type="button"
            className="sp-btn-outline"
            style={{ color: "var(--naia-danger, #b3261e)", borderColor: "var(--naia-danger, #b3261e)" }}
            onClick={() => openConfirm("delete-account")}
          >
            Permanently delete my account
          </button>
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
            <h3 id="settings-confirm-title" className="dc-modal-title">{CONFIRM[pending].title}</h3>
            <p className="dc-modal-desc">{CONFIRM[pending].body}</p>
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
                onClick={() => fetcher.submit({ intent: pending }, { method: "post" })}
              >
                {isSubmitting ? "Removing…" : CONFIRM[pending].cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
