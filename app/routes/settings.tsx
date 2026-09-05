// app/routes/settings.tsx
// Settings & Privacy V1 — every visible control is genuinely implemented.
//
// What this page does:
//   - Displays account name + email (read-only)
//   - Exposes real server-backed deletion for Selfie Analysis and My nAia Model photos
//   - Provides honest mailto links for data export and account deletion requests
//   - Explains how nAia personalises the experience (informational only)
//   - Explains Closet photo management (delete via My Closet)
//
// What is intentionally absent:
//   - Communication preferences (no schema or backend — removed until built)
//   - Shopify address management (managed by NADINE/Shopify — not a nAia setting)
//   - VTO result image deletion (no deletion helper exists — privacy gap, flagged separately)
//   - BuyOrSkip image deletion (no customer-facing deletion path — privacy gap)
//   - Immediate account deletion (requires cross-feature cascade audit)
//   - Personalisation opt-out (no backend preference exists)

import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link, Form } from "react-router";
import { data } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import {
  deleteSelfiePhoto,
  deleteAnalysisResult,
  deleteBoth,
} from "~/lib/ai/selfie-persistence.server";
import {
  deleteNaiaModelPhoto,
  withdrawSaveModelConsent,
} from "~/lib/ai/my-naia-model.server";
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

  const [selfieRecord, modelRecord] = await Promise.all([
    prisma.selfieAnalysis.findUnique({
      where: { customerId: customer.id },
      select: { photoPublicId: true, photoDeletedAt: true, analysisStatus: true, analysisResult: true },
    }),
    prisma.naiaModel.findUnique({
      where: { customerId: customer.id },
      select: { facePublicId: true, bodyPublicId: true, saveModelConsentAt: true },
    }),
  ]);

  // Derive public-safe booleans — private IDs never leave the server.
  const hasPhoto    = selfieRecord !== null && selfieRecord.photoPublicId !== null && selfieRecord.photoDeletedAt === null;
  const hasAnalysis = selfieRecord !== null && selfieRecord.analysisStatus === "completed" && selfieRecord.analysisResult !== null;
  const hasFace     = modelRecord !== null && modelRecord.facePublicId !== null;
  const hasBody     = modelRecord !== null && modelRecord.bodyPublicId !== null;

  return data({
    firstName: customer.firstName,
    lastName:  customer.lastName,
    email:     customer.email,
    selfie:    selfieRecord !== null ? { hasPhoto, hasAnalysis }  : null,
    model:     modelRecord  !== null ? { hasFace,  hasBody }      : null,
  });
}

// ── Action ────────────────────────────────────────────────────────────────────

const VALID_INTENTS = new Set([
  "delete-selfie-photo",
  "delete-selfie-analysis",
  "delete-selfie-both",
  "delete-model-face",
  "delete-model-body",
  "delete-model-all",
]);

type Intent =
  | "delete-selfie-photo"
  | "delete-selfie-analysis"
  | "delete-selfie-both"
  | "delete-model-face"
  | "delete-model-body"
  | "delete-model-all";

const SUCCESS_MESSAGES: Record<Intent, string> = {
  "delete-selfie-photo":    "Your selfie photo has been permanently removed.",
  "delete-selfie-analysis": "Your Selfie Style Analysis has been permanently removed.",
  "delete-selfie-both":     "Your selfie photo and Selfie Style Analysis have both been permanently removed.",
  "delete-model-face":      "Your saved face photo has been removed from your nAia Model.",
  "delete-model-body":      "Your saved body photo has been removed from your nAia Model.",
  "delete-model-all":       "Your saved nAia Model photos and consent have been permanently removed.",
};

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData  = await request.formData();
  const intent    = formData.get("intent");

  if (typeof intent !== "string" || !VALID_INTENTS.has(intent)) {
    return data({ ok: false as const, error: "Invalid request." }, { status: 400 });
  }

  const typed = intent as Intent;

  switch (typed) {
    case "delete-selfie-photo": {
      const r = await deleteSelfiePhoto(customer.id);
      if (!r.ok) return data({ ok: false as const, error: "Could not remove your selfie photo. Please try again." }, { status: 500 });
      break;
    }
    case "delete-selfie-analysis": {
      const r = await deleteAnalysisResult(customer.id);
      if (!r.ok) return data({ ok: false as const, error: "Could not remove your analysis. Please try again." }, { status: 500 });
      break;
    }
    case "delete-selfie-both": {
      const r = await deleteBoth(customer.id);
      if (!r.ok) return data({ ok: false as const, error: "Could not remove your selfie and analysis. Please try again." }, { status: 500 });
      break;
    }
    case "delete-model-face": {
      const r = await deleteNaiaModelPhoto(customer.id, "face");
      if (!r.ok) return data({ ok: false as const, error: "Could not remove your face photo. Please try again." }, { status: 500 });
      break;
    }
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
  }

  return data({ ok: true as const, intent: typed, message: SUCCESS_MESSAGES[typed] });
}

// ── Confirmation specs ────────────────────────────────────────────────────────

const CONFIRM: Record<Intent, { title: string; body: string; cta: string }> = {
  "delete-selfie-photo": {
    title: "Remove selfie photo",
    body:  "Your uploaded selfie will be permanently deleted. Your existing Selfie Style Analysis is kept and will continue to personalise your experience.",
    cta:   "Remove selfie photo",
  },
  "delete-selfie-analysis": {
    title: "Remove Selfie Style Analysis",
    body:  "Your Selfie Style Analysis will be permanently deleted. Your selfie photo is kept and you can run a new analysis at any time.",
    cta:   "Remove analysis",
  },
  "delete-selfie-both": {
    title: "Remove selfie and analysis",
    body:  "Your selfie photo and your Selfie Style Analysis will both be permanently deleted. You can create them again at any time from your Style Passport.",
    cta:   "Remove both",
  },
  "delete-model-face": {
    title: "Remove saved face photo",
    body:  "Your saved face photo will be permanently deleted from your nAia Model. Virtual try-ons that use this photo will require a new one. Your body photo and styling history are not affected.",
    cta:   "Remove face photo",
  },
  "delete-model-body": {
    title: "Remove saved body photo",
    body:  "Your saved body photo will be permanently deleted from your nAia Model. Virtual try-ons that use this photo will require a new one. Your face photo and styling history are not affected.",
    cta:   "Remove body photo",
  },
  "delete-model-all": {
    title: "Remove all saved nAia Model photos",
    body:  "Both your saved face and body photos will be permanently deleted and your consent to save them will be withdrawn. Virtual previews will no longer be available until you upload new photos. Your styling history and Closet are not affected.",
    cta:   "Remove all model photos",
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ControlRow({
  intent,
  label,
  description,
  onOpen,
}: {
  intent: Intent;
  label: string;
  description: string;
  onOpen: (k: Intent) => void;
}) {
  return (
    <div className="set-control-row">
      <div>
        <div className="set-control-title set-control-title--destructive">{label}</div>
        <p className="set-control-desc">{description}</p>
      </div>
      <button type="button" className="sp-btn-outline" onClick={() => onOpen(intent)}>
        Continue
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { firstName, lastName, email, selfie, model } = useLoaderData<typeof loader>();
  const fetcher     = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [pending, setPending] = useState<Intent | null>(null);

  const fullName    = [firstName, lastName].filter(Boolean).join(" ") || "—";
  const isSubmitting = fetcher.state !== "idle";
  const actionData  = fetcher.data;

  // Close modal and refresh loader state after a successful deletion.
  useEffect(() => {
    if (actionData?.ok) {
      setPending(null);
      revalidator.revalidate();
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSelfieSection = selfie !== null;
  const hasModelSection  = model  !== null;

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Settings & Privacy</div>
        <h1 className="sp-shell-title">YOUR <span className="sp-shell-accent">account.</span></h1>
      </div>

      {/* ── Account Details ───────────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Account Details</div>
        <h2 className="set-section-title">Account Details</h2>
        <dl className="sp-detail-list">
          <div className="sp-detail-row">
            <dt className="sp-detail-label">Name</dt>
            <dd className="sp-detail-value">{fullName}</dd>
          </div>
          <div className="sp-detail-row">
            <dt className="sp-detail-label">Email</dt>
            <dd className="sp-detail-value">{email || "—"}</dd>
          </div>
        </dl>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", fontStyle: "italic", color: "var(--naia-muted)", marginTop: "12px" }}>
          To update your name or email, please visit your NADINE account settings.
        </p>
      </section>

      {/* ── Selfie Style Analysis ─────────────────────────────────────────── */}
      {hasSelfieSection && (
        <section className="bos-section">
          <div className="set-section-eyebrow">Selfie Style Analysis</div>
          <h2 className="set-section-title">Selfie Style Analysis</h2>
          <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
            Your selfie photo and the style signals derived from it are stored securely. You can remove either independently or together.
          </p>
          <div className="set-controls">
            {selfie.hasPhoto && (
              <ControlRow
                intent="delete-selfie-photo"
                label="Remove selfie photo"
                description="Permanently deletes your uploaded selfie. Your style analysis result is kept."
                onOpen={setPending}
              />
            )}
            {selfie.hasAnalysis && (
              <ControlRow
                intent="delete-selfie-analysis"
                label="Remove Selfie Style Analysis"
                description="Permanently deletes your analysis result. Your selfie photo is kept."
                onOpen={setPending}
              />
            )}
            {selfie.hasPhoto && selfie.hasAnalysis && (
              <ControlRow
                intent="delete-selfie-both"
                label="Remove selfie photo and analysis"
                description="Permanently deletes both your selfie photo and your style analysis."
                onOpen={setPending}
              />
            )}
            {!selfie.hasPhoto && !selfie.hasAnalysis && (
              <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)" }}>
                You have no selfie photo or analysis on file.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── My nAia Model ─────────────────────────────────────────────────── */}
      {hasModelSection && (
        <section className="bos-section">
          <div className="set-section-eyebrow">My nAia Model</div>
          <h2 className="set-section-title">My nAia Model</h2>
          <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
            These are the photos you saved to enable virtual try-ons. Removing them stops virtual previews until you upload new ones. Your styling history and Closet are not affected.
          </p>
          <div className="set-controls">
            {model.hasFace && (
              <ControlRow
                intent="delete-model-face"
                label="Remove saved face photo"
                description="Permanently deletes your face photo from your nAia Model. Your body photo is kept."
                onOpen={setPending}
              />
            )}
            {model.hasBody && (
              <ControlRow
                intent="delete-model-body"
                label="Remove saved body photo"
                description="Permanently deletes your body photo from your nAia Model. Your face photo is kept."
                onOpen={setPending}
              />
            )}
            {(model.hasFace || model.hasBody) && (
              <ControlRow
                intent="delete-model-all"
                label="Remove all saved nAia Model photos"
                description="Permanently deletes both your face and body photos and withdraws consent to save them."
                onOpen={setPending}
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
          Photos you have uploaded to your Closet are stored privately. To remove a Closet photo, delete the corresponding item from your Closet — the photo is removed with it.
        </p>
        <Link to="/closet" className="sp-btn-outline" style={{ display: "inline-block", textDecoration: "none" }}>
          Go to My Closet
        </Link>
      </section>

      {/* ── How nAia personalises your experience ────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">How nAia works</div>
        <h2 className="set-section-title">Personalisation</h2>
        <p className="sp-shell-desc">
          nAia personalises your styling experience using information you provide directly — your Style Passport, your Closet, your post-wear feedback, and your interactions with StyleMe. Your data is never sold or shared with third parties for marketing.
        </p>
      </section>

      {/* ── Your Data & Privacy ───────────────────────────────────────────── */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Your Data & Privacy</div>
        <h2 className="set-section-title">Your Data</h2>
        <p className="sp-shell-desc" style={{ marginBottom: "20px" }}>
          To request a copy of your data or to request account deletion, contact us at{" "}
          <a
            href="mailto:privacy@naiabynadine.com?subject=Data%20request%20—%20nAia"
            style={{ color: "var(--naia-accent)" }}
          >
            privacy@naiabynadine.com
          </a>
          . Requests are processed within 30 days in accordance with our Privacy Policy.
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

      {/* ── Sign Out ─────────────────────────────────────────────────────── */}
      <section className="bos-section">
        <Form method="post" action="/auth/logout">
          <button type="submit" className="sp-btn-ghost">Sign Out</button>
        </Form>
      </section>

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
                onClick={() =>
                  fetcher.submit({ intent: pending }, { method: "post" })
                }
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
