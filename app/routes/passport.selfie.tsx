// app/routes/passport.selfie.tsx
// Phase 4A8 — Selfie upload and styling analysis route.
//
// Security contract:
//   - Authenticated customer required on every request (loader + action)
//   - photoPublicId / photoFormat / signedUrl never appear in any serialised response
//   - Raw provider response is never stored — only validated SelfieStyleSignals
//   - Signed analysis URL is built server-side, passed to analyzeImage, then discarded
//   - File type, size, and dimensions are validated server-side from bytes, not MIME header
//   - Duplicate analysis is blocked while a "pending" record exists
//
// Intents (POST body field "_intent"):
//   "analyse"          — validate + upload + Layer 2 moderation + analyse + persist
//   "replace"          — same as analyse but bypasses pending guard and deletes old photo via overwrite
//   "retry-moderation" — re-run Layer 2 on stored selfie (used when prior attempt got MODERATION_UNAVAILABLE)
//   "reanalyse-selfie" — reanalyse existing stored selfie (after failure/deletion); no new upload required
//   "delete-photo"     — delete Cloudinary asset, clear photoPublicId, keep signals
//   "delete-analysis"  — clear signals only, keep photo for re-analysis
//   "delete-both"      — delete photo and clear all signals
//
// State model:
//   Photo state and analysis state are fully independent.
//   A stored photo is always shown when hasPhoto is true, regardless of analysis state.
//   Only an explicit delete-photo or delete-both action removes the photo.
//   Only an explicit delete-analysis or delete-both action removes the analysis.
//   Analysis failure/system errors never touch the photo reference.

import { useState, useRef } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { createHash } from "node:crypto";
import { redirect, useActionData, useLoaderData, useNavigation, Form, Link } from "react-router";
import { data } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { analyseSelfie, ANALYSIS_VERSION } from "~/lib/ai/selfie-analysis.server";
import type { SelfieAnalysisOutcome, SelfieStyleSignals } from "~/lib/ai/selfie-analysis";
import {
  validateSelfieFile,
  uploadSelfieToCloudinary,
  buildSelfieAnalysisUrl,
  buildSelfiePreviewUrl,
} from "~/lib/ai/selfie-upload.server";
import {
  beginSelfieAnalysis,
  completeSelfieAnalysis,
  failSelfieAnalysis,
  deleteSelfiePhoto,
  deleteAnalysisResult,
  deleteBoth,
  loadSelfieForDisplay,
  getSelfieForModeration,
  type BeginSelfieResult,
  type SelfieDisplayRecord,
} from "~/lib/ai/selfie-persistence.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import {
  buildContrastNote,
  buildNecklineSummary,
  buildNaiaUsageExplanation,
} from "~/lib/ai/selfie-styling-signals";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "Selfie Style Analysis | nAia" }];
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) throw redirect("/auth/shopify/login");

  // buildSelfiePreviewUrl generates a short-lived signed URL for browser display
  // (same pattern as NaiaModel); the photoPublicId itself is never serialised.
  let existing: SelfieDisplayRecord | null = null;
  try {
    existing = await loadSelfieForDisplay(customer.id, undefined, buildSelfiePreviewUrl);
    console.info("[selfie-loader] existing:", JSON.stringify({ hasPhoto: existing?.hasPhoto, analysisStatus: existing?.analysisStatus, consentAt: existing?.consentAt }));
  } catch (err) {
    // Table does not exist yet (migration not applied) — treat as no record
    console.error("[selfie-loader] loadSelfieForDisplay threw:", err instanceof Error ? err.message : String(err));
    existing = null;
  }

  return data({ existing });
}

// ── Action ────────────────────────────────────────────────────────────────────

type ActionResult =
  | { intent: "analyse" | "replace" | "retry-moderation" | "reanalyse-selfie"; outcome: SelfieAnalysisOutcome }
  | { intent: "delete-photo" | "delete-analysis" | "delete-both"; ok: boolean; errorCode?: string };

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) throw redirect("/auth/shopify/login");

  const formData = await request.formData();
  const intent = String(formData.get("_intent") ?? "analyse");

  // ── Deletion intents ───────────────────────────────────────────────────────

  if (intent === "delete-photo") {
    const result = await deleteSelfiePhoto(customer.id);
    return { intent: "delete-photo", ok: result.ok, errorCode: result.ok ? undefined : result.errorCode };
  }

  if (intent === "delete-analysis") {
    const result = await deleteAnalysisResult(customer.id);
    return { intent: "delete-analysis", ok: result.ok, errorCode: result.errorCode };
  }

  if (intent === "delete-both") {
    const result = await deleteBoth(customer.id);
    return { intent: "delete-both", ok: result.ok, errorCode: result.ok ? undefined : result.errorCode };
  }

  // ── Retry-moderation intent ────────────────────────────────────────────────
  // Re-runs Layer 2 on the stored selfie without requiring a new upload.
  // Used when a prior analyse/replace attempt returned MODERATION_UNAVAILABLE.

  if (intent === "retry-moderation") {
    const creds = await getSelfieForModeration(customer.id);
    if (!creds) {
      return { intent: "retry-moderation", outcome: { status: "invalid-input", reason: "No selfie on file to retry." } };
    }

    const retryUrl = buildSelfieAnalysisUrl(creds.publicId, creds.format);
    if (!retryUrl) {
      return { intent: "retry-moderation", outcome: { status: "system-failure", internalNote: "Cloudinary not configured for retry URL" } };
    }

    const retryModeration = await moderateImageContent(retryUrl);
    if (retryModeration.status === "MODERATION_UNAVAILABLE") {
      return { intent: "retry-moderation", outcome: { status: "moderation-unavailable" } };
    }
    if (retryModeration.status === "SAFETY_REJECT") {
      await deleteSelfiePhoto(customer.id);
      const customerIdHash = createHash("sha256").update(customer.id).digest("hex");
      void customerIdHash;
      return { intent: "retry-moderation", outcome: { status: "safety-rejected" } };
    }

    const runAnalysis = analyseSelfie;
    const retryOutcome = await runAnalysis(
      { imageUrl: retryUrl },
      { consentAt: creds.consentAt },
    );

    try {
      if (retryOutcome.status === "completed") {
        await completeSelfieAnalysis(customer.id, retryOutcome.signals, ANALYSIS_VERSION, new Date(retryOutcome.analysedAt));
      } else {
        await failSelfieAnalysis(customer.id);
      }
    } catch (err) {
      console.error("[selfie-action] retry-moderation persistence failed:", err instanceof Error ? err.message : String(err));
      return { intent: "retry-moderation", outcome: { status: "system-failure", internalNote: "retry-moderation persistence failed" } };
    }

    return { intent: "retry-moderation", outcome: retryOutcome };
  }

  // ── Reanalyse-selfie intent ────────────────────────────────────────────────
  // Reanalyses the existing stored selfie without requiring a new upload.
  // Used after analysis failure or after the customer deletes the analysis.
  // Runs the full pipeline: moderation + quality check + v2 analysis.
  // The server resolves the stored photo — client never supplies the image URL.

  if (intent === "reanalyse-selfie") {
    const creds = await getSelfieForModeration(customer.id);
    if (!creds) {
      return { intent: "reanalyse-selfie", outcome: { status: "invalid-input", reason: "No selfie on file to reanalyse." } };
    }

    // Reset analysis status to pending, preserving the existing photo reference.
    try {
      await beginSelfieAnalysis(
        customer.id,
        new Date(creds.consentAt),
        creds.publicId,
        creds.format,
        { forceReplace: true },
      );
    } catch (err) {
      console.error("[selfie-action] reanalyse-selfie begin failed:", err instanceof Error ? err.message : String(err));
      return { intent: "reanalyse-selfie", outcome: { status: "system-failure", internalNote: "reanalyse begin failed" } };
    }

    const reanalyseUrl = buildSelfieAnalysisUrl(creds.publicId, creds.format);
    if (!reanalyseUrl) {
      try { await failSelfieAnalysis(customer.id); } catch { /* best-effort */ }
      return { intent: "reanalyse-selfie", outcome: { status: "system-failure", internalNote: "Cloudinary not configured for reanalyse URL" } };
    }

    // Layer 2: global content safety moderation
    const moderation = await moderateImageContent(reanalyseUrl);
    if (moderation.status === "MODERATION_UNAVAILABLE") {
      return { intent: "reanalyse-selfie", outcome: { status: "moderation-unavailable" } };
    }
    if (moderation.status === "SAFETY_REJECT") {
      await deleteSelfiePhoto(customer.id);
      const customerIdHash = createHash("sha256").update(customer.id).digest("hex");
      void customerIdHash;
      return { intent: "reanalyse-selfie", outcome: { status: "safety-rejected" } };
    }

    // Full analysis — includes quality check + v2 styling analysis
    const reanalyseOutcome = await analyseSelfie(
      { imageUrl: reanalyseUrl },
      { consentAt: creds.consentAt },
    );

    try {
      if (reanalyseOutcome.status === "completed") {
        await completeSelfieAnalysis(customer.id, reanalyseOutcome.signals, ANALYSIS_VERSION, new Date(reanalyseOutcome.analysedAt));
      } else {
        await failSelfieAnalysis(customer.id);
      }
    } catch (err) {
      console.error("[selfie-action] reanalyse-selfie persistence failed:", err instanceof Error ? err.message : String(err));
      return { intent: "reanalyse-selfie", outcome: { status: "system-failure", internalNote: "reanalyse persistence failed" } };
    }

    return { intent: "reanalyse-selfie", outcome: reanalyseOutcome };
  }

  // ── Analyse / replace intents ──────────────────────────────────────────────

  const isReplace = intent === "replace";

  // Consent check
  if (formData.get("consent") !== "true") {
    return { intent: "analyse", outcome: { status: "consent-missing" } };
  }
  const consentAt = new Date();

  // File extraction
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { intent: "analyse", outcome: { status: "invalid-input", reason: "No photo provided." } };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // File validation (type, size, dimensions — from bytes, not header)
  const validation = validateSelfieFile(bytes, file.type || "application/octet-stream");
  if (!validation.ok) {
    return { intent: "analyse", outcome: { status: "invalid-input", reason: validation.reason } };
  }

  // Duplicate-analysis guard (bypassed for replace intent)
  let begin: BeginSelfieResult;
  try {
    begin = await beginSelfieAnalysis(
      customer.id,
      consentAt,
      null,
      null,
      { forceReplace: isReplace },
    );
  } catch (err) {
    console.error("[selfie-action] beginSelfieAnalysis (1) failed:", err instanceof Error ? err.message : String(err));
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure", internalNote: "beginSelfieAnalysis (1) failed" } };
  }
  if (begin.blocked) {
    return {
      intent: "analyse",
      outcome: { status: "invalid-input", reason: "An analysis is already in progress. Please wait." },
    };
  }

  // Upload to Cloudinary (private asset, overwrite=true so replace is atomic)
  const upload = await uploadSelfieToCloudinary(bytes, validation.canonicalMime, customer.id);
  if (!upload.ok) {
    console.error("[selfie-action] Cloudinary upload failed:", upload.errorCode);
    try { await failSelfieAnalysis(customer.id); } catch { /* best-effort cleanup */ }
    return {
      intent: "analyse",
      outcome: { status: "system-failure", internalNote: `Upload failed: ${upload.errorCode}` },
    };
  }

  // Update DB record with the confirmed public ID and format
  console.info("[selfie-action] upload ok, publicId:", upload.publicId, "format:", upload.format);
  try {
    const begin2 = await beginSelfieAnalysis(
      customer.id,
      consentAt,
      upload.publicId,
      upload.format,
      { forceReplace: true },
    );
    console.info("[selfie-action] beginSelfieAnalysis(2) ok, blocked:", begin2.blocked, "photoPublicId:", !begin2.blocked && begin2.record.photoPublicId);
  } catch (err) {
    console.error("[selfie-action] beginSelfieAnalysis (2) failed:", err instanceof Error ? err.message : String(err));
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure", internalNote: "beginSelfieAnalysis (2) failed" } };
  }

  // Build short-lived signed URL for analyzeImage — NEVER returned to browser
  const analysisUrl = buildSelfieAnalysisUrl(upload.publicId, upload.format);
  if (!analysisUrl) {
    try { await failSelfieAnalysis(customer.id); } catch { /* best-effort */ }
    return {
      intent: "analyse",
      outcome: { status: "system-failure", internalNote: "Cloudinary not configured for analysis URL" },
    };
  }

  // ── Layer 2: Global content safety moderation ──────────────────────────────
  {
    const moderation = await moderateImageContent(analysisUrl);
    if (moderation.status === "MODERATION_UNAVAILABLE") {
      return {
        intent: isReplace ? "replace" : "analyse",
        outcome: { status: "moderation-unavailable" },
      };
    }
    if (moderation.status === "SAFETY_REJECT") {
      await deleteSelfiePhoto(customer.id);
      const customerIdHash = createHash("sha256").update(customer.id).digest("hex");
      void customerIdHash;
      return {
        intent: isReplace ? "replace" : "analyse",
        outcome: { status: "safety-rejected" },
      };
    }
  }

  // Run analysis — provider call stays entirely server-side
  const outcome = await analyseSelfie(
    { imageUrl: analysisUrl },
    { consentAt: consentAt.toISOString() },
  );

  // Persist result — only validated signals stored; raw response discarded
  console.info("[selfie-action] analyseSelfie outcome:", outcome.status);
  try {
    if (outcome.status === "completed") {
      await completeSelfieAnalysis(
        customer.id,
        outcome.signals,
        ANALYSIS_VERSION,
        new Date(outcome.analysedAt),
      );
    } else {
      const failRec = await failSelfieAnalysis(customer.id);
      console.info("[selfie-action] failSelfieAnalysis ok, photoPublicId:", failRec.photoPublicId);
    }
  } catch (err) {
    console.error("[selfie-action] final persistence failed:", err instanceof Error ? err.message : String(err));
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure", internalNote: "final persistence failed" } };
  }

  return { intent: isReplace ? "replace" : "analyse", outcome };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelfieUploadPage() {
  const { existing } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<"delete-photo" | "delete-analysis" | "delete-both" | null>(null);
  const [showChooseDifferent, setShowChooseDifferent] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  // ── State derivation ───────────────────────────────────────────────────────

  // Fresh action outcome (present for the current render cycle after a form submit)
  const freshOutcome: SelfieAnalysisOutcome | null =
    actionData && "outcome" in actionData ? actionData.outcome : null;
  const analysisIntent = actionData && "outcome" in actionData ? actionData.intent : null;

  // DB state (from loader, reflects the current persisted record)
  const dbStatus = existing?.analysisStatus ?? null;

  // Photo state — independent of analysis state.
  // After safety-rejection the server explicitly deletes the photo; treat as no photo.
  const photoJustRejected = freshOutcome?.status === "safety-rejected";
  const photoExists = !photoJustRejected && (existing?.hasPhoto ?? false);

  // Selfie display URL: FileReader preview (fresh upload) takes precedence over
  // the server-generated signed URL (return visit). Signed URL expires in 1 hour.
  const selfieDisplayUrl = preview ?? (photoExists ? existing?.selfiePreviewUrl ?? null : null);

  // Analysis state — independent of photo state.
  const analysisCompleted =
    freshOutcome?.status === "completed" ||
    (dbStatus === "completed" && !freshOutcome);

  // Pending: DB says pending and there is no fresh action outcome overriding it.
  // (A fresh "invalid-input" from the blocked guard still leaves DB as pending.)
  const analysisPending = dbStatus === "pending" && !freshOutcome;

  // Display signals: fresh completed outcome takes precedence over DB signals.
  const displaySignals: SelfieStyleSignals | null = (() => {
    if (freshOutcome !== null && freshOutcome.status === "completed") return freshOutcome.signals;
    return existing?.signals ?? null;
  })();

  // ── Section visibility ────────────────────────────────────────────────────

  const showProcessing = analysisPending;
  const showModerationRetry = freshOutcome?.status === "moderation-unavailable";

  // Completed: analysis succeeded
  const showCompletedSection = analysisCompleted && displaySignals !== null;

  // Failed: system error or timeout (photo preserved, reanalyse available)
  const showFailedSection =
    photoExists &&
    !analysisPending &&
    !analysisCompleted &&
    (freshOutcome?.status === "system-failure" ||
      freshOutcome?.status === "timeout" ||
      (dbStatus === "failed" && !freshOutcome));

  // Deleted: analysis was explicitly removed (photo preserved, reanalyse available)
  const showDeletedSection =
    photoExists &&
    !analysisPending &&
    !analysisCompleted &&
    dbStatus === "deleted" &&
    !freshOutcome;

  // Quality failed: photo uploaded but quality check failed (photo preserved, different photo needed)
  const showQualityFailedSection =
    photoExists && freshOutcome?.status === "quality-failed";

  // Primary upload form: only when no photo is stored and we need a new one.
  const showPrimaryUploadForm = (() => {
    if (analysisPending) return false;
    if (freshOutcome?.status === "moderation-unavailable") return false;
    if (analysisCompleted) return false;
    if (showFailedSection || showDeletedSection || showQualityFailedSection) return false;
    if (freshOutcome?.status === "safety-rejected") return true;
    if (freshOutcome?.status === "consent-missing") return true;
    if (freshOutcome?.status === "invalid-input") return true;
    if (!photoExists && !freshOutcome) return true;
    return false;
  })();

  // ── Status label and description ──────────────────────────────────────────

  const statusLabel =
    analysisCompleted ? "Analysis complete" :
    freshOutcome?.status === "moderation-unavailable" ? "Photo review temporarily unavailable" :
    freshOutcome?.status === "safety-rejected" ? "Upload a new photo to continue" :
    freshOutcome?.status === "quality-failed" ? "Photo needs adjustment" :
    freshOutcome?.status === "consent-missing" ? "Consent required" :
    freshOutcome?.status === "invalid-input" ? "Cannot proceed" :
    (freshOutcome?.status === "system-failure" || freshOutcome?.status === "timeout") ? "Analysis unavailable" :
    analysisPending ? "Analysis in progress" :
    dbStatus === "failed" ? "Analysis unavailable" :
    dbStatus === "deleted" ? "Analysis removed" :
    photoExists ? "Selfie saved" :
    "Not started";

  // Supporting copy shown directly under the status label — replaces a separate
  // error card for system-failure / timeout / DB-failed states.
  const statusDescription: string | null =
    (freshOutcome?.status === "system-failure" || freshOutcome?.status === "timeout")
      ? "We couldn't complete your analysis this time." :
    (dbStatus === "failed" && !freshOutcome)
      ? "We couldn't complete your analysis this time." :
    (dbStatus === "deleted" && !freshOutcome)
      ? "Your analysis was removed. Your selfie is still saved — you can reanalyse it below." :
    null;

  // Outcome feedback card: shown only for specific error types that need
  // actionable inline guidance. system-failure / timeout handled by statusDescription.
  const showOutcomeFeedback =
    freshOutcome !== null &&
    freshOutcome.status !== "completed" &&
    freshOutcome.status !== "system-failure" &&
    freshOutcome.status !== "timeout" &&
    freshOutcome.status !== "moderation-unavailable";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setPreview(null); return; }
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      {/* Section shell */}
      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Personalisation · Optional</div>
        <h1 className="sp-shell-title">Selfie Style Analysis</h1>
        <p className="sp-shell-desc">
          Optional selfie-based guidance for colours near your face, necklines, hair direction,
          earrings, glasses and optional makeup direction. This feature is optional — StyleMe works
          without it.
        </p>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginTop: "8px" }}>
          This selfie is separate from My nAia Model and from your Closet photographs.
        </p>
      </div>

      {/* Current Status */}
      <div className="bos-section">
        <div className="bos-step-label">Current Status</div>
        <div className="psa-status-val">{statusLabel}</div>
        {statusDescription && (
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginTop: "6px", lineHeight: 1.6 }}>
            {statusDescription}
          </p>
        )}
      </div>

      {/* Outcome error feedback — only for specific types (not system-failure/timeout) */}
      {showOutcomeFeedback && freshOutcome && (
        <div className="bos-section">
          <OutcomeFeedback outcome={freshOutcome} />
        </div>
      )}

      {/* Your Selfie — shown whenever a photo is stored, regardless of analysis state */}
      {(selfieDisplayUrl || photoExists) && (
        <section className="bos-section">
          <div className="bos-step-label">Your Selfie</div>
          {selfieDisplayUrl ? (
            <div style={{ maxWidth: "360px" }}>
              <img
                src={selfieDisplayUrl}
                alt="Your selfie"
                style={{ display: "block", width: "100%", height: "auto" }}
              />
            </div>
          ) : (
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)" }}>
              Your selfie is stored privately.
            </p>
          )}
        </section>
      )}

      {/* Primary upload form — first selfie or after photo deletion */}
      {showPrimaryUploadForm && (
        <>
          <section className="bos-section">
            <div className="bos-step-label">Selfie Guidance</div>
            <ul className="psa-guidance-list">
              <li>· Front-facing, in natural daylight, without filters.</li>
              <li>· A neutral top and hair pulled back if possible.</li>
              <li>· Only the head and shoulders need to be visible.</li>
              <li>· Sharp, in focus, no heavy colour filters or flash.</li>
              <li>· Only one person in the frame.</li>
            </ul>
          </section>

          <section className="bos-section">
            <div className="bos-step-label">Upload Your Selfie</div>
            <UploadForm
              intent="analyse"
              isSubmitting={isSubmitting}
              preview={preview}
              onFileChange={handleFileChange}
              submitLabel="Start My Analysis"
            />
          </section>
        </>
      )}

      {/* Processing */}
      {showProcessing && (
        <section className="bos-section">
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", lineHeight: 1.75, color: "rgba(34,21,22,0.85)", maxWidth: "520px", marginBottom: "24px" }}>
            nAia is analysing your selfie. This usually takes a few moments.
          </p>
          <div className="psa-progress-track">
            <div className="psa-progress-fill" />
          </div>
          <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", gap: "12px" }}>
            <Form method="post" style={{ display: "inline" }}>
              <input type="hidden" name="_intent" value="delete-both" />
              <button type="submit" className="sp-btn-outline">Cancel Analysis</button>
            </Form>
            <Form method="post" style={{ display: "inline" }}>
              <input type="hidden" name="_intent" value="retry-moderation" />
              <button type="submit" className="sp-btn-outline">Retry Photo Review</button>
            </Form>
          </div>
        </section>
      )}

      {/* Moderation temporarily unavailable */}
      {showModerationRetry && (
        <section className="bos-section">
          <Form method="post">
            <input type="hidden" name="_intent" value="retry-moderation" />
            <button
              type="submit"
              disabled={isSubmitting}
              className={isSubmitting ? "sp-btn-outline" : "sp-btn-primary"}
              style={{ width: "100%", maxWidth: "360px", opacity: isSubmitting ? 0.65 : 1 }}
            >
              {isSubmitting ? "Checking…" : "Retry Photo Review"}
            </button>
          </Form>
        </section>
      )}

      {/* Analysis failed — photo saved, reanalyse or choose a different photo */}
      {showFailedSection && (
        <section className="bos-section">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
            <Form method="post">
              <input type="hidden" name="_intent" value="reanalyse-selfie" />
              <button
                type="submit"
                disabled={isSubmitting}
                className={isSubmitting ? "sp-btn-outline" : "sp-btn-primary"}
                style={{ width: "100%", opacity: isSubmitting ? 0.65 : 1 }}
              >
                {isSubmitting ? "Analysing…" : "Reanalyse This Selfie"}
              </button>
            </Form>
            <button
              type="button"
              className="sp-btn-outline"
              style={{ width: "100%" }}
              onClick={() => setShowChooseDifferent(v => !v)}
            >
              {showChooseDifferent ? "Cancel" : "Choose a Different Photo"}
            </button>
          </div>
          {showChooseDifferent && (
            <div style={{ marginTop: "24px" }}>
              <UploadForm
                intent="replace"
                isSubmitting={isSubmitting}
                preview={preview}
                onFileChange={handleFileChange}
                submitLabel="Replace and Reanalyse"
              />
            </div>
          )}
        </section>
      )}

      {/* Analysis deleted — photo saved, analyse this selfie or choose different */}
      {showDeletedSection && (
        <section className="bos-section">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
            <Form method="post">
              <input type="hidden" name="_intent" value="reanalyse-selfie" />
              <button
                type="submit"
                disabled={isSubmitting}
                className={isSubmitting ? "sp-btn-outline" : "sp-btn-primary"}
                style={{ width: "100%", opacity: isSubmitting ? 0.65 : 1 }}
              >
                {isSubmitting ? "Analysing…" : "Analyse This Selfie"}
              </button>
            </Form>
            <button
              type="button"
              className="sp-btn-outline"
              style={{ width: "100%" }}
              onClick={() => setShowChooseDifferent(v => !v)}
            >
              {showChooseDifferent ? "Cancel" : "Choose a Different Photo"}
            </button>
          </div>
          {showChooseDifferent && (
            <div style={{ marginTop: "24px" }}>
              <UploadForm
                intent="replace"
                isSubmitting={isSubmitting}
                preview={preview}
                onFileChange={handleFileChange}
                submitLabel="Replace and Reanalyse"
              />
            </div>
          )}
        </section>
      )}

      {/* Quality failed — photo bad, choose a different photo */}
      {showQualityFailedSection && (
        <section className="bos-section">
          <div style={{ maxWidth: "360px" }}>
            <UploadForm
              intent="replace"
              isSubmitting={isSubmitting}
              preview={preview}
              onFileChange={handleFileChange}
              submitLabel="Upload a Different Photo"
            />
          </div>
        </section>
      )}

      {/* Completed results */}
      {showCompletedSection && displaySignals && (
        <>
          {/* Your Analysis */}
          <section className="bos-section">
            <div className="bos-step-label">
              {analysisIntent === "replace" || analysisIntent === "reanalyse-selfie"
                ? "Updated Observations"
                : "Your Analysis"}
            </div>

            {/* Face & Feature Profile */}
            <AnalysisSubsection title="Face & Feature Profile" first>
              <dl className="sp-detail-list">
                <SignalRow label="Face Shape" value={displaySignals.faceShapeDirection} />
                {displaySignals.featureBalance && <SignalRow label="Feature Balance" value={displaySignals.featureBalance} />}
                {displaySignals.eyeShape && <SignalRow label="Eye Shape" value={displaySignals.eyeShape} />}
                {displaySignals.browShape && <SignalRow label="Brow Shape" value={displaySignals.browShape} />}
                {displaySignals.lipShape && <SignalRow label="Lip Shape" value={displaySignals.lipShape} />}
                <SignalRow label="Contrast" value={buildContrastNote(displaySignals.contrastLevel)} />
              </dl>
            </AnalysisSubsection>

            {/* Colour Direction */}
            <AnalysisSubsection title="Colour Direction">
              {displaySignals.colourTemperature && (
                <div style={{ marginBottom: "12px" }}>
                  <span style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", letterSpacing: "0.4px", padding: "3px 10px", border: "1px solid var(--naia-border)", textTransform: "capitalize" }}>
                    {displaySignals.colourTemperature} tone
                  </span>
                </div>
              )}
              <dl className="sp-detail-list">
                <SignalRow label="Colour Families" value={displaySignals.colourFamilies.join(", ")} />
              </dl>
              <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65, marginTop: "8px" }}>
                {displaySignals.colourExplanation}
              </p>
              {displaySignals.bestNeutrals && displaySignals.bestNeutrals.length > 0 && (
                <SwatchGroup label="Best Neutrals" swatches={displaySignals.bestNeutrals} />
              )}
              {displaySignals.everydayColours && displaySignals.everydayColours.length > 0 && (
                <SwatchGroup label="Everyday Colours" swatches={displaySignals.everydayColours} />
              )}
              {displaySignals.accentColours && displaySignals.accentColours.length > 0 && (
                <SwatchGroup label="Accent Colours" swatches={displaySignals.accentColours} />
              )}
              {displaySignals.useCareNearFace && displaySignals.useCareNearFace.length > 0 && (
                <SwatchGroup label="Use Carefully Near Face" swatches={displaySignals.useCareNearFace} />
              )}
            </AnalysisSubsection>

            {/* Necklines */}
            <AnalysisSubsection title="Necklines">
              {displaySignals.necklinesTop && displaySignals.necklinesTop.length > 0 ? (
                <TieredChips
                  top={displaySignals.necklinesTop}
                  also={displaySignals.necklinesAlso}
                  careful={displaySignals.necklinesCareful}
                />
              ) : (
                <dl className="sp-detail-list">
                  <SignalRow label="Necklines" value={buildNecklineSummary(displaySignals)} />
                </dl>
              )}
              <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65, marginTop: "10px" }}>
                {displaySignals.necklineExplanation}
              </p>
            </AnalysisSubsection>

            {/* Jewellery */}
            <AnalysisSubsection title="Jewellery">
              <dl className="sp-detail-list">
                <SignalRow
                  label="Earrings"
                  value={displaySignals.earringsTop?.length
                    ? displaySignals.earringsTop.join(", ")
                    : displaySignals.earringsDirection}
                />
                {displaySignals.earringsScale && <SignalRow label="Scale" value={displaySignals.earringsScale} />}
                {displaySignals.necklaceLengths && displaySignals.necklaceLengths.length > 0 && (
                  <SignalRow label="Necklaces" value={displaySignals.necklaceLengths.join(", ")} />
                )}
                {displaySignals.metalDirection && <SignalRow label="Metal" value={displaySignals.metalDirection} />}
              </dl>
            </AnalysisSubsection>

            {/* Glasses */}
            <AnalysisSubsection title="Glasses">
              {displaySignals.glassesTop && displaySignals.glassesTop.length > 0 ? (
                <TieredChips
                  top={displaySignals.glassesTop}
                  also={displaySignals.glassesAlso}
                  careful={displaySignals.glassesCareful}
                />
              ) : (
                <dl className="sp-detail-list">
                  <SignalRow label="Frames" value={displaySignals.glassesFrameDirection} />
                </dl>
              )}
            </AnalysisSubsection>

            {/* Hair Direction */}
            <AnalysisSubsection title="Hair Direction">
              <dl className="sp-detail-list">
                <SignalRow label="Length" value={displaySignals.hairLengthDirection} />
                <SignalRow label="Volume" value={displaySignals.hairVolumeDirection} />
                <SignalRow label="Parting" value={displaySignals.hairPartingDirection} />
                {displaySignals.hairLayers && <SignalRow label="Layers" value={displaySignals.hairLayers} />}
                {displaySignals.hairTextureDirection && <SignalRow label="Texture" value={displaySignals.hairTextureDirection} />}
                {displaySignals.hairUpdoDirection && <SignalRow label="Updo" value={displaySignals.hairUpdoDirection} />}
                {displaySignals.hairColourFamilies && displaySignals.hairColourFamilies.length > 0 && (
                  <SignalRow label="Hair Colour" value={displaySignals.hairColourFamilies.join(", ")} />
                )}
              </dl>
            </AnalysisSubsection>

            {/* Makeup Direction */}
            {(displaySignals.makeupComplexionFinish || displaySignals.makeupBlush ||
              displaySignals.makeupEyeshadow || displaySignals.makeupLipsEveryday ||
              displaySignals.makeupLipsRich || displaySignals.makeupColourDirection) && (
              <AnalysisSubsection title="Makeup Direction">
                <dl className="sp-detail-list">
                  {displaySignals.makeupComplexionFinish && <SignalRow label="Complexion" value={displaySignals.makeupComplexionFinish} />}
                  {displaySignals.makeupBlush && <SignalRow label="Blush" value={displaySignals.makeupBlush} />}
                  {displaySignals.makeupEyeshadow && <SignalRow label="Eyeshadow" value={displaySignals.makeupEyeshadow} />}
                  {displaySignals.makeupLipsEveryday && <SignalRow label="Everyday Lip" value={displaySignals.makeupLipsEveryday} />}
                  {displaySignals.makeupLipsRich && <SignalRow label="Evening Lip" value={displaySignals.makeupLipsRich} />}
                  {!displaySignals.makeupComplexionFinish && displaySignals.makeupColourDirection && (
                    <SignalRow label="Colour Direction" value={displaySignals.makeupColourDirection} />
                  )}
                </dl>
              </AnalysisSubsection>
            )}

            {/* Visual Style Formula */}
            {displaySignals.styleFormula && displaySignals.styleFormula.length > 0 && (
              <AnalysisSubsection title="Visual Style Formula">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                  {displaySignals.styleFormula.map(tag => (
                    <span
                      key={tag}
                      style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "12px", letterSpacing: "0.4px", padding: "6px 14px", border: "1px solid var(--naia-border)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {displaySignals.styleFormulaNote && (
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65 }}>
                    {displaySignals.styleFormulaNote}
                  </p>
                )}
              </AnalysisSubsection>
            )}
          </section>

          {/* How nAia Uses This */}
          <section className="bos-section">
            <div className="bos-step-label">How nAia Uses This</div>
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75 }}>
              {buildNaiaUsageExplanation()}
            </p>
          </section>

          {/* Manage */}
          <section className="bos-section">
            <div className="bos-step-label">Manage</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              {photoExists && (
                <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-photo")}>
                  Delete Selfie Only
                </button>
              )}
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-analysis")}>
                Delete Analysis Only
              </button>
              {photoExists && (
                <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-both")}>
                  Delete Both
                </button>
              )}
            </div>
          </section>

          {/* Update Photo — only when a photo is currently stored */}
          {photoExists && (
            <section className="bos-section">
              <div className="bos-step-label">Update Photo</div>
              <UploadForm
                intent="replace"
                isSubmitting={isSubmitting}
                preview={preview}
                onFileChange={handleFileChange}
                submitLabel="Replace and Re-analyse"
              />
            </section>
          )}
        </>
      )}

      {/* Privacy note */}
      <div className="sp-state-note" style={{ marginTop: "32px" }}>
        Your selfie is stored privately and can be managed or removed at any time.
      </div>

      {/* Confirmation modal */}
      {pending && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="psa-confirm-title">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Confirm Deletion</div>
            <h3 id="psa-confirm-title" className="dc-modal-title">
              {pending === "delete-photo"    ? "Delete Selfie Only" :
               pending === "delete-analysis" ? "Delete Analysis Only" :
               "Delete Selfie and Analysis"}
            </h3>
            <p className="dc-modal-desc">
              {pending === "delete-photo"
                ? "Your uploaded selfie will be removed. The previously generated analysis is still stored — you may delete it separately."
                : pending === "delete-analysis"
                ? "Your analysis will be removed. Your selfie remains private until you delete it or request a new analysis."
                : "Your selfie and your analysis will both be removed. You can create them again at any time."}
            </p>
            <div className="dc-modal-actions">
              <button type="button" className="sp-btn-ghost" onClick={() => setPending(null)}>Cancel</button>
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_intent" value={pending} />
                <button type="submit" className="sp-btn-outline" onClick={() => setPending(null)}>
                  Confirm
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadForm({
  intent,
  isSubmitting,
  preview,
  onFileChange,
  submitLabel,
}: {
  intent: "analyse" | "replace";
  isSubmitting: boolean;
  preview: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  submitLabel: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Form method="post" encType="multipart/form-data">
      <input type="hidden" name="_intent" value={intent} />

      {preview && (
        <div style={{ marginBottom: "20px", maxWidth: "360px" }}>
          <img src={preview} alt="Preview" style={{ display: "block", width: "100%", height: "auto" }} />
        </div>
      )}

      <div style={{ marginBottom: "20px" }}>
        <div className="psa-upload-tile">
          <div className="psa-upload-tile-label">
            {intent === "replace" ? "New Selfie" : "Your Selfie"}
          </div>
          <input
            ref={fileRef}
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp,image/heic"
            required
            onChange={onFileChange}
            style={{ display: "block", width: "100%", marginBottom: "6px" }}
          />
          <div style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "10px", letterSpacing: "0.3px", color: "var(--naia-muted)" }}>
            JPG, PNG, WEBP, HEIC — max 5 MB
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "24px", padding: "16px 20px", background: "rgba(34,21,22,0.03)", border: "1px solid var(--naia-border)" }}>
        <label className="psa-consent-row">
          <input type="checkbox" name="consent" value="true" id={`selfie-consent-${intent}`} required className="psa-consent-check" />
          <span>
            I consent to nAia analysing this photo to offer me personal styling guidance.
            I understand this is not a medical or diagnostic assessment. I can delete this
            photo and remove my analysis at any time.
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className={isSubmitting ? "sp-btn-outline" : "sp-btn-primary"}
        style={{ width: "100%", opacity: isSubmitting ? 0.65 : 1 }}
      >
        {isSubmitting ? "Analysing…" : submitLabel}
      </button>
    </Form>
  );
}

function OutcomeFeedback({ outcome }: { outcome: SelfieAnalysisOutcome }) {
  // system-failure and timeout: handled by statusDescription (no separate card)
  // moderation-unavailable: handled by the retry section
  // completed: no feedback needed
  let title = "";
  let message = "";

  if (outcome.status === "consent-missing") {
    title = "Consent required"; message = "Please tick the consent box to proceed.";
  } else if (outcome.status === "invalid-input") {
    title = "Cannot proceed"; message = (outcome as Extract<typeof outcome, { status: "invalid-input" }>).reason;
  } else if (outcome.status === "quality-failed") {
    title = "Photo needs adjustment";
    message = (outcome as Extract<typeof outcome, { status: "quality-failed" }>).guidance ?? "Please try a clearer photo.";
  } else if (outcome.status === "safety-rejected") {
    title = "Photo could not be accepted";
    message = "The photo could not be accepted. Please upload a clear photo of your face and shoulders without filters.";
  }

  if (!title) return null;
  return (
    <div className="psa-outcome-box">
      <div className="psa-outcome-title">{title}</div>
      <p className="psa-outcome-body">{message}</p>
    </div>
  );
}

// ── Analysis display sub-components ──────────────────────────────────────────

function AnalysisSubsection({
  title,
  children,
  first,
}: {
  title: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: first ? "16px" : "24px",
        ...(first ? {} : { paddingTop: "20px", borderTop: "1px solid var(--naia-border)" }),
      }}
    >
      <div
        style={{
          fontFamily: "var(--naia-ff-ui)",
          fontSize: "10px",
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: "var(--naia-muted)",
          marginBottom: "12px",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sp-detail-row">
      <dt className="sp-detail-label">{label}</dt>
      <dd className="sp-detail-value">{value}</dd>
    </div>
  );
}

function SwatchGroup({
  label,
  swatches,
}: {
  label: string;
  swatches: Array<{ name: string; hex: string }>;
}) {
  return (
    <div style={{ marginTop: "14px" }}>
      <div
        style={{
          fontFamily: "var(--naia-ff-ui)",
          fontSize: "11px",
          letterSpacing: "0.4px",
          color: "var(--naia-muted)",
          marginBottom: "8px",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        {swatches.map(s => (
          <div
            key={s.hex + s.name}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: s.hex,
                border: "1px solid rgba(0,0,0,0.1)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "var(--naia-ff-ui)",
                fontSize: "10px",
                textAlign: "center",
                color: "var(--naia-muted)",
                maxWidth: "58px",
                lineHeight: 1.3,
              }}
            >
              {s.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TieredChips({
  top,
  also,
  careful,
}: {
  top?: string[];
  also?: string[];
  careful?: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {top && top.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--naia-muted)",
              marginBottom: "6px",
            }}
          >
            Most Flattering
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {top.map(item => (
              <span
                key={item}
                style={{
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  border: "1px solid var(--naia-border)",
                  background: "rgba(34,21,22,0.04)",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
      {also && also.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--naia-muted)",
              marginBottom: "6px",
            }}
          >
            Also Works
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {also.map(item => (
              <span
                key={item}
                style={{
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  border: "1px solid var(--naia-border)",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
      {careful && careful.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--naia-muted)",
              marginBottom: "6px",
            }}
          >
            Use Carefully
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {careful.map(item => (
              <span
                key={item}
                style={{
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  border: "1px dashed var(--naia-border)",
                  opacity: 0.75,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
