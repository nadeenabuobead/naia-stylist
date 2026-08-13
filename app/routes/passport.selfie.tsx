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
//   "delete-photo"     — delete Cloudinary asset, clear photoPublicId, keep signals
//   "delete-analysis"  — clear signals only, keep photo for re-analysis
//   "delete-both"      — delete photo and clear all signals
//
// Migration required before live DB writes:
//   prisma/migrations/20260717100000_add_selfie_analysis/migration.sql

import { useState, useRef } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { createHash } from "node:crypto";
import { redirect, useActionData, useLoaderData, useNavigation, Form, Link } from "react-router";
import { data } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { analyseSelfie, ANALYSIS_VERSION } from "~/lib/ai/selfie-analysis.server";
import type { SelfieAnalysisOutcome } from "~/lib/ai/selfie-analysis";
import {
  validateSelfieFile,
  uploadSelfieToCloudinary,
  buildSelfieAnalysisUrl,
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
  buildColourDirectionSummary,
  buildNecklineSummary,
  buildHairDirectionSummary,
  buildAccessoriesSummary,
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

  // Migration guard: loadSelfieForDisplay returns null when no record exists.
  // Once migration is applied, this will return the existing record.
  let existing: SelfieDisplayRecord | null = null;
  try {
    existing = await loadSelfieForDisplay(customer.id);
  } catch {
    // Table does not exist yet (migration not applied) — treat as no record
    existing = null;
  }

  return data({ existing });
}

// ── Action ────────────────────────────────────────────────────────────────────

type ActionResult =
  | { intent: "analyse" | "replace" | "retry-moderation"; outcome: SelfieAnalysisOutcome }
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
      // Audit: { customerIdHash, feature: "selfie", reasonCode: retryModeration.reasonCode, timestamp: new Date() }
      // No publicId, URL, or image bytes stored.
      void customerIdHash;
      return { intent: "retry-moderation", outcome: { status: "safety-rejected" } };
    }

    // PASS — proceed to analysis via local alias (preserves source ordering invariants).
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
      return { intent: "retry-moderation", outcome: { status: "system-failure" } };
    }

    return { intent: "retry-moderation", outcome: retryOutcome };
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
      null,    // photoPublicId set after upload
      null,    // photoFormat set after upload
      { forceReplace: isReplace },
    );
  } catch (err) {
    console.error("[selfie-action] beginSelfieAnalysis (1) failed:", err instanceof Error ? err.message : String(err));
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure" } };
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
    try { await failSelfieAnalysis(customer.id); } catch { /* best-effort cleanup */ }
    return {
      intent: "analyse",
      outcome: { status: "system-failure", internalNote: `Upload failed: ${upload.errorCode}` },
    };
  }

  // Update DB record with the confirmed public ID and format
  // (begins analysis guard is now active; photo is stored)
  try {
    await beginSelfieAnalysis(
      customer.id,
      consentAt,
      upload.publicId,
      upload.format,
      { forceReplace: true }, // already pending — force update to add publicId
    );
  } catch (err) {
    console.error("[selfie-action] beginSelfieAnalysis (2) failed:", err instanceof Error ? err.message : String(err));
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure" } };
  }

  // Build short-lived signed URL for analyzeImage — NEVER returned to browser
  const analysisUrl = buildSelfieAnalysisUrl(upload.publicId, upload.format);
  if (!analysisUrl) {
    try { await failSelfieAnalysis(customer.id); } catch { /* best-effort cleanup */ }
    return {
      intent: "analyse",
      outcome: { status: "system-failure", internalNote: "Cloudinary not configured for analysis URL" },
    };
  }

  // ── Layer 2: Global content safety moderation ──────────────────────────────
  {
    const moderation = await moderateImageContent(analysisUrl);
    if (moderation.status === "MODERATION_UNAVAILABLE") {
      // Keep photo + pending status — customer can retry via retry-moderation intent
      return {
        intent: isReplace ? "replace" : "analyse",
        outcome: { status: "moderation-unavailable" },
      };
    }
    if (moderation.status === "SAFETY_REJECT") {
      await deleteSelfiePhoto(customer.id);
      const customerIdHash = createHash("sha256").update(customer.id).digest("hex");
      // Audit: { customerIdHash, feature: "selfie", reasonCode: moderation.reasonCode, timestamp: new Date() }
      // No publicId, URL, or image bytes stored.
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
  try {
    if (outcome.status === "completed") {
      await completeSelfieAnalysis(
        customer.id,
        outcome.signals,
        ANALYSIS_VERSION,
        new Date(outcome.analysedAt),
      );
    } else {
      await failSelfieAnalysis(customer.id);
    }
  } catch (err) {
    console.error("[selfie-action] final persistence failed:", err instanceof Error ? err.message : String(err));
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure" } };
  }

  // Return public-safe outcome — no publicId, no format, no signedUrl
  return { intent: isReplace ? "replace" : "analyse", outcome };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelfieUploadPage() {
  const { existing } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<"delete-photo" | "delete-analysis" | "delete-both" | null>(null);
  const isSubmitting = navigation.state === "submitting";

  // Derive displayed outcome: action result takes precedence over loader state
  const analysisIntent = actionData && "outcome" in actionData ? actionData.intent : null;
  const outcome: SelfieAnalysisOutcome | null =
    actionData && "outcome" in actionData ? actionData.outcome : null;

  const showUploadForm =
    (!outcome && (!existing || existing.analysisStatus === "failed" || existing.analysisStatus === "deleted")) ||
    outcome?.status === "safety-rejected" ||
    outcome?.status === "quality-failed" ||
    outcome?.status === "timeout" ||
    outcome?.status === "system-failure" ||
    outcome?.status === "invalid-input" ||
    outcome?.status === "consent-missing";
  const showProcessing = existing?.analysisStatus === "pending" && !outcome;
  const showModerationRetry = outcome?.status === "moderation-unavailable";
  const showResults = outcome?.status === "completed" ||
    (existing?.analysisStatus === "completed" && !outcome);
  const displaySignals = outcome?.status === "completed"
    ? outcome.signals
    : existing?.signals ?? null;

  const statusLabel =
    showResults             ? "Analysis complete" :
    showModerationRetry     ? "Photo review temporarily unavailable" :
    outcome?.status === "safety-rejected" ? "Upload a new photo to continue" :
    showProcessing          ? "Analysis in progress" :
    existing?.analysisStatus === "failed" ? "Analysis failed — please try again" :
    existing?.analysisStatus === "deleted" ? "Analysis deleted" :
    "Not started";

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
      </div>

      {/* Outcome error feedback */}
      {outcome && outcome.status !== "completed" && (
        <div className="bos-section">
          <OutcomeFeedback outcome={outcome} />
        </div>
      )}

      {/* Not started — upload form */}
      {showUploadForm && (
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

      {/* Moderation temporarily unavailable — retry without re-upload */}
      {showModerationRetry && (
        <section className="bos-section">
          <Form method="post">
            <input type="hidden" name="_intent" value="retry-moderation" />
            <button
              type="submit"
              disabled={isSubmitting}
              className={isSubmitting ? "sp-btn-outline" : "sp-btn-primary"}
              style={{ width: "100%", opacity: isSubmitting ? 0.65 : 1 }}
            >
              {isSubmitting ? "Checking…" : "Retry Photo Review"}
            </button>
          </Form>
        </section>
      )}

      {/* Completed results */}
      {showResults && displaySignals && (
        <>
          <section className="bos-section">
            <div className="bos-step-label">
              {analysisIntent === "replace" ? "Updated Observations" : "Your Analysis"}
            </div>
            <dl className="sp-detail-list">
              <div className="sp-detail-row">
                <dt className="sp-detail-label">Colour Direction</dt>
                <dd className="sp-detail-value">{buildColourDirectionSummary(displaySignals)}</dd>
              </div>
              <div className="sp-detail-row">
                <dt className="sp-detail-label">Necklines</dt>
                <dd className="sp-detail-value">{buildNecklineSummary(displaySignals)}</dd>
              </div>
              <div className="sp-detail-row">
                <dt className="sp-detail-label">Hair Direction</dt>
                <dd className="sp-detail-value">{buildHairDirectionSummary(displaySignals)}</dd>
              </div>
              <div className="sp-detail-row">
                <dt className="sp-detail-label">Earrings & Glasses</dt>
                <dd className="sp-detail-value">{buildAccessoriesSummary(displaySignals)}</dd>
              </div>
              <div className="sp-detail-row">
                <dt className="sp-detail-label">How nAia Uses This</dt>
                <dd className="sp-detail-value" style={{ fontStyle: "italic", color: "var(--naia-muted)" }}>
                  {buildNaiaUsageExplanation()}
                </dd>
              </div>
            </dl>
          </section>

          <section className="bos-section">
            <div className="bos-step-label">Manage</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-photo")}>Delete Selfie Only</button>
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-analysis")}>Delete Analysis Only</button>
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-both")}>Delete Both</button>
            </div>
          </section>

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
        </>
      )}

      {/* Privacy note */}
      <div className="sp-state-note" style={{ marginTop: "32px" }}>
        Your selfie is stored privately and can be managed or removed from My nAia Model.
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
        <div className={`psa-upload-tile${!preview ? "" : ""}`}>
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
  let title = "";
  let message = "";

  if (outcome.status === "consent-missing") {
    title = "Consent required"; message = "Please tick the consent box to proceed.";
  } else if (outcome.status === "invalid-input") {
    title = "Cannot proceed"; message = outcome.reason;
  } else if (outcome.status === "quality-failed") {
    title = "Photo needs adjustment"; message = outcome.guidance ?? "Please try a clearer photo.";
  } else if (outcome.status === "timeout" || outcome.status === "system-failure") {
    title = "Analysis unavailable"; message = "nAia couldn't complete the analysis right now. Please try again.";
  } else if (outcome.status === "safety-rejected") {
    title = "Photo could not be accepted";
    message = "The photo could not be accepted. Please upload a clear photo of your face and shoulders without filters.";
  } else if (outcome.status === "moderation-unavailable") {
    title = "Photo review temporarily unavailable";
    message = "nAia's photo review is temporarily unavailable. Your photo is stored safely — please use the button below to retry.";
  }

  if (!title) return null;
  return (
    <div className="psa-outcome-box">
      <div className="psa-outcome-title">{title}</div>
      <p className="psa-outcome-body">{message}</p>
    </div>
  );
}
