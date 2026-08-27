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

import { useState, useRef, useEffect } from "react";
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
  clearSelfiePhotoOwnership,
  type BeginSelfieResult,
  type SelfieDisplayRecord,
} from "~/lib/ai/selfie-persistence.server";
import {
  loadNaiaModel,
  saveSelfieAsModelFace,
  deleteNaiaModelPhoto,
  buildModelPreviewUrl,
  clearNaiaModelFaceReference,
} from "~/lib/ai/my-naia-model.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import {
  buildNaiaUsageExplanation,
} from "~/lib/ai/selfie-styling-signals";
import {
  SelfieVisualAnalysis,
  AnalysisSubsection,
  SignalRow,
  SwatchGroup,
  TieredChips,
} from "~/components/selfie/SelfieVisualAnalysis";
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
  } catch (err) {
    console.error("[selfie-loader] loadSelfieForDisplay threw:", err instanceof Error ? err.message : String(err));
    existing = null;
  }

  let hasFaceModel = false;
  let modelFacePreviewUrl: string | null = null;
  try {
    const model = await loadNaiaModel(customer.id);
    hasFaceModel = !!(model?.facePublicId);
    if (model?.facePublicId) {
      modelFacePreviewUrl = buildModelPreviewUrl(model.facePublicId, model.faceFormat ?? null);
    }
  } catch {
    hasFaceModel = false;
    modelFacePreviewUrl = null;
  }

  return data({ existing, hasFaceModel, modelFacePreviewUrl });
}

// ── Action ────────────────────────────────────────────────────────────────────

type ActionResult =
  | { intent: "analyse" | "replace" | "retry-moderation" | "reanalyse-selfie" | "analyse-model-selfie"; outcome: SelfieAnalysisOutcome }
  | { intent: "delete-analysis" | "delete-model-face" | "delete-model-face-and-analysis" | "delete-both" | "keep-both" | "keep-analysis" | "save-selfie-only"; ok: boolean; errorCode?: string };

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) throw redirect("/auth/shopify/login");

  const formData = await request.formData();
  const intent = String(formData.get("_intent") ?? "analyse");

  // ── Deletion intents ───────────────────────────────────────────────────────

  if (intent === "delete-analysis") {
    const result = await deleteAnalysisResult(customer.id);
    return { intent: "delete-analysis", ok: result.ok, errorCode: result.errorCode };
  }

  if (intent === "delete-model-face") {
    const result = await deleteNaiaModelPhoto(customer.id, "face");
    return { intent: "delete-model-face", ok: result.ok || result.staleReference };
  }

  if (intent === "delete-model-face-and-analysis") {
    const [modelResult, analysisResult] = await Promise.all([
      deleteNaiaModelPhoto(customer.id, "face"),
      deleteAnalysisResult(customer.id),
    ]);
    return {
      intent: "delete-model-face-and-analysis",
      ok: (modelResult.ok || modelResult.staleReference) && analysisResult.ok,
    };
  }

  // Restores the previously missing delete-both handler (used by "Cancel Analysis" during
  // pending state and by the "Delete Both" post-analysis choice).
  if (intent === "delete-both") {
    // Ownership guard: if SA and NaiaModel share the same Cloudinary asset, clear the
    // model reference before deleteBoth runs Cloudinary deletion — same pattern as keep-analysis.
    const tempSelfie = await getSelfieForModeration(customer.id);
    if (tempSelfie?.publicId) {
      const model = await loadNaiaModel(customer.id);
      if (model?.facePublicId === tempSelfie.publicId) {
        await clearNaiaModelFaceReference(customer.id);
      }
    }
    const result = await deleteBoth(customer.id);
    return { intent: "delete-both", ok: result.ok, errorCode: result.ok ? undefined : result.errorCode };
  }

  // ── Post-analysis storage choices ──────────────────────────────────────────
  // Shown after analysis completes while the temp selfie is held in SelfieAnalysis.
  // Each intent executes the user's storage decision and clears the temp photo.

  if (intent === "keep-both") {
    const creds = await getSelfieForModeration(customer.id);
    if (!creds) return { intent: "keep-both", ok: false, errorCode: "NO_PHOTO" };
    const saveResult = await saveSelfieAsModelFace(customer.id, creds.publicId, creds.format);
    if (saveResult.ok) {
      try { await clearSelfiePhotoOwnership(customer.id); } catch { /* best-effort */ }
    } else {
      try { await deleteSelfiePhoto(customer.id); } catch { /* best-effort cleanup */ }
    }
    return { intent: "keep-both", ok: saveResult.ok, errorCode: saveResult.ok ? undefined : saveResult.error };
  }

  if (intent === "keep-analysis") {
    // Ownership guard: if NaiaModel.facePublicId is the same Cloudinary asset as the
    // temp selfie, clear the model reference BEFORE the Cloudinary deletion so that
    // deleteSelfiePhoto performs the single delete and no dangling reference remains.
    const tempSelfie = await getSelfieForModeration(customer.id);
    if (tempSelfie?.publicId) {
      const model = await loadNaiaModel(customer.id);
      if (model?.facePublicId === tempSelfie.publicId) {
        await clearNaiaModelFaceReference(customer.id);
      }
    }
    const result = await deleteSelfiePhoto(customer.id);
    return { intent: "keep-analysis", ok: result.ok, errorCode: result.ok ? undefined : result.errorCode };
  }

  if (intent === "save-selfie-only") {
    const creds = await getSelfieForModeration(customer.id);
    if (!creds) return { intent: "save-selfie-only", ok: false, errorCode: "NO_PHOTO" };
    const saveResult = await saveSelfieAsModelFace(customer.id, creds.publicId, creds.format);
    if (saveResult.ok) {
      try { await clearSelfiePhotoOwnership(customer.id); } catch { /* best-effort */ }
    } else {
      try { await deleteSelfiePhoto(customer.id); } catch { /* best-effort cleanup */ }
    }
    try { await deleteAnalysisResult(customer.id); } catch { /* best-effort */ }
    return { intent: "save-selfie-only", ok: true };
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
    const runReanalyse = analyseSelfie;
    const reanalyseOutcome = await runReanalyse(
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

  // ── Analyse-model-selfie intent ───────────────────────────────────────────
  // Runs Selfie Style Analysis using the NaiaModel face photo.
  // No new upload — the server fetches the face photo from NaiaModel directly.
  // The photo reference is NOT stored in SelfieAnalysis; NaiaModel retains ownership.

  if (intent === "analyse-model-selfie") {
    if (formData.get("consent") !== "true") {
      return { intent: "analyse-model-selfie", outcome: { status: "consent-missing" } };
    }

    const model = await loadNaiaModel(customer.id);
    if (!model?.facePublicId || !model?.faceFormat) {
      return { intent: "analyse-model-selfie", outcome: { status: "invalid-input", reason: "No saved photo found in My nAia Model." } };
    }

    try {
      // Write the model's facePublicId into SA so photoExists becomes true after analysis.
      // This enables the same 4-choice flow for both fresh-upload and model-selfie analyses.
      // The ownership guard in keep-analysis and delete-both handles the shared-asset case.
      await beginSelfieAnalysis(customer.id, new Date(), model.facePublicId, model.faceFormat, { forceReplace: true });
    } catch (err) {
      console.error("[selfie-action] analyse-model-selfie begin failed:", err instanceof Error ? err.message : String(err));
      return { intent: "analyse-model-selfie", outcome: { status: "system-failure", internalNote: "begin failed" } };
    }

    const modelUrl = buildModelPreviewUrl(model.facePublicId, model.faceFormat ?? null);
    if (!modelUrl) {
      try { await failSelfieAnalysis(customer.id); } catch { /* best-effort */ }
      return { intent: "analyse-model-selfie", outcome: { status: "system-failure", internalNote: "model URL build failed" } };
    }

    const moderation = await moderateImageContent(modelUrl);
    if (moderation.status === "MODERATION_UNAVAILABLE") {
      return { intent: "analyse-model-selfie", outcome: { status: "moderation-unavailable" } };
    }
    if (moderation.status === "SAFETY_REJECT") {
      await deleteNaiaModelPhoto(customer.id, "face");
      try { await failSelfieAnalysis(customer.id); } catch { /* best-effort */ }
      return { intent: "analyse-model-selfie", outcome: { status: "safety-rejected" } };
    }

    const runModelAnalysis = analyseSelfie;
    const modelOutcome = await runModelAnalysis(
      { imageUrl: modelUrl },
      { consentAt: new Date().toISOString() },
    );

    try {
      if (modelOutcome.status === "completed") {
        await completeSelfieAnalysis(customer.id, modelOutcome.signals, ANALYSIS_VERSION, new Date(modelOutcome.analysedAt));
      } else {
        await failSelfieAnalysis(customer.id);
      }
    } catch (err) {
      console.error("[selfie-action] analyse-model-selfie persistence failed:", err instanceof Error ? err.message : String(err));
      return { intent: "analyse-model-selfie", outcome: { status: "system-failure", internalNote: "persistence failed" } };
    }

    return { intent: "analyse-model-selfie", outcome: modelOutcome };
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
  try {
    const begin2 = await beginSelfieAnalysis(
      customer.id,
      consentAt,
      upload.publicId,
      upload.format,
      { forceReplace: true },
    );
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
    return { intent: isReplace ? "replace" : "analyse", outcome: { status: "system-failure", internalNote: "final persistence failed" } };
  }

  // Photo stays in SelfieAnalysis — user chooses what to keep via the post-analysis section.
  // On failure, the photo is preserved so the user can reanalyse with the same photo.

  return { intent: isReplace ? "replace" : "analyse", outcome };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelfieUploadPage() {
  const { existing, hasFaceModel, modelFacePreviewUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<
    "delete-analysis" | "delete-model-face" | "delete-model-face-and-analysis" |
    "keep-both" | "keep-analysis" | "save-selfie-only" | "delete-both" | null
  >(null);
  const [successIntent, setSuccessIntent] = useState<
    "keep-both" | "keep-analysis" | "save-selfie-only" | "delete-both" | null
  >(null);
  const [showChooseDifferent, setShowChooseDifferent] = useState(false);
  const isSubmitting = navigation.state === "submitting";
  const resultsTopRef = useRef<HTMLDivElement>(null);

  // ── State derivation ───────────────────────────────────────────────────────

  const freshOutcome: SelfieAnalysisOutcome | null =
    actionData && "outcome" in actionData ? actionData.outcome : null;

  const dbStatus = existing?.analysisStatus ?? null;

  const photoJustRejected = freshOutcome?.status === "safety-rejected";
  const photoExists = !photoJustRejected && (existing?.hasPhoto ?? false);

  // Server-generated signed URL for the stored temp selfie (never returned to browser directly).
  const selfieDisplayUrl = photoExists ? existing?.selfiePreviewUrl ?? null : null;

  const analysisCompleted =
    freshOutcome?.status === "completed" ||
    (dbStatus === "completed" && !freshOutcome);

  const analysisPending = dbStatus === "pending" && !freshOutcome;

  const displaySignals: SelfieStyleSignals | null = (() => {
    if (freshOutcome !== null && freshOutcome.status === "completed") return freshOutcome.signals;
    return existing?.signals ?? null;
  })();

  // ── Section visibility ────────────────────────────────────────────────────

  const showProcessing = analysisPending;
  const showModerationRetry = freshOutcome?.status === "moderation-unavailable";
  const showCompletedSection = analysisCompleted && displaySignals !== null;
  const showChoiceSection = showCompletedSection && photoExists;
  const showManageSection = !photoExists && !analysisPending && !showModerationRetry && (
    (analysisCompleted && displaySignals !== null) || hasFaceModel
  );

  const showFailedSection =
    photoExists && !analysisPending && !analysisCompleted &&
    (freshOutcome?.status === "system-failure" ||
      freshOutcome?.status === "timeout" ||
      (dbStatus === "failed" && !freshOutcome));

  const showDeletedSection =
    photoExists && !analysisPending && !analysisCompleted &&
    dbStatus === "deleted" && !freshOutcome;

  const showQualityFailedSection = photoExists && freshOutcome?.status === "quality-failed";

  // True when the before-analysis UI should be shown (no photo in-flight, no completed analysis).
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

  // Before-analysis sub-states — mutually exclusive.
  const showSavedPhotoSection    = showPrimaryUploadForm && hasFaceModel && !showChooseDifferent;
  const showChooseDifferentSection = showPrimaryUploadForm && showChooseDifferent;
  const showFreshUploadSection   = showPrimaryUploadForm && !hasFaceModel && !showChooseDifferent;

  // "Your Selfie" display: temp selfie URL takes priority; fall back to model face URL
  // in the stable "analysis + selfie" state (after keep-both, temp selfie cleared).
  const displaySelfieUrl = selfieDisplayUrl ?? (hasFaceModel && analysisCompleted ? modelFacePreviewUrl : null);

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
    dbStatus === "failed" ? (photoExists ? "Selfie saved" : "Analysis unavailable") :
    dbStatus === "deleted" ? "Analysis removed" :
    photoExists ? "Selfie saved" :
    "Not started";

  const statusDescription: string | null = successIntent ? null :
    (freshOutcome?.status === "system-failure" || freshOutcome?.status === "timeout")
      ? "We couldn't complete your analysis this time." :
    (dbStatus === "failed" && !freshOutcome && !photoExists)
      ? "We couldn't complete your analysis this time." :
    (dbStatus === "deleted" && !freshOutcome)
      ? "Your analysis was removed. Your selfie is still saved — you can reanalyse it below." :
    null;

  const showOutcomeFeedback =
    freshOutcome !== null &&
    freshOutcome.status !== "completed" &&
    freshOutcome.status !== "system-failure" &&
    freshOutcome.status !== "timeout" &&
    freshOutcome.status !== "moderation-unavailable";

  // ── Effects ───────────────────────────────────────────────────────────────

  // After a fresh successful analysis: clear preview, collapse choose-different, scroll to results.
  // Uses [actionData] (object ref) not [freshOutcome?.status] so re-fires on replace → completed.
  // Double-RAF defers our scroll past React Router's ScrollRestoration which runs in the same batch.
  useEffect(() => {
    if (freshOutcome?.status === "completed") {
      setPreview(null);
      setShowChooseDifferent(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (actionData && "ok" in actionData && actionData.ok) {
      setPending(null);
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      actionData && "ok" in actionData && actionData.ok &&
      (actionData.intent === "keep-both" || actionData.intent === "keep-analysis" ||
       actionData.intent === "save-selfie-only" || actionData.intent === "delete-both")
    ) {
      setSuccessIntent(actionData.intent as "keep-both" | "keep-analysis" | "save-selfie-only" | "delete-both");
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isSubmitting) setSuccessIntent(null);
  }, [isSubmitting]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setPreview(null); return; }
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const guidanceList = (
    <ul className="psa-guidance-list">
      <li>· Front-facing, in natural daylight, without filters.</li>
      <li>· Wear a neutral top; if your hair is visible, pull it back if possible. Hijab or other head coverings are completely fine.</li>
      <li>· Only your head and shoulders need to be visible.</li>
      <li>· Keep the photo sharp and in focus, with no heavy colour filters or flash.</li>
      <li>· Only one person should be in the frame.</li>
    </ul>
  );

  return (
    <MyNaiaLayout>
      <Link to="/passport#visual-analysis" className="sp-back">← Style Passport</Link>

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
          Your selfie is used privately to create your analysis. Afterward, you choose what you'd like nAia to keep.
        </p>
      </div>

      {/* Current Status */}
      <div className="bos-section" ref={resultsTopRef} style={{ scrollMarginTop: "80px" }}>
        <div className="bos-step-label">Current Status</div>
        <div className="psa-status-val">{statusLabel}</div>
        {statusDescription && (
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginTop: "6px", lineHeight: 1.6 }}>
            {statusDescription}
          </p>
        )}
      </div>

      {/* Outcome error feedback */}
      {showOutcomeFeedback && freshOutcome && (
        <div className="bos-section">
          <OutcomeFeedback outcome={freshOutcome} />
        </div>
      )}

      {/* Post-choice success confirmation — captured into state so it survives loader revalidation */}
      {successIntent && (
        <div className="bos-section">
          <div className="psa-outcome-box" style={{ borderColor: "var(--naia-border)" }}>
            <div className="psa-outcome-title">
              {successIntent === "keep-both"        ? "Selfie and analysis saved" :
               successIntent === "keep-analysis"    ? "Analysis saved" :
               successIntent === "save-selfie-only" ? "Selfie saved to My nAia Model" :
               "Selfie and analysis deleted"}
            </div>
            <p className="psa-outcome-body">
              {successIntent === "keep-both"
                ? "Your Selfie Style Analysis has been kept, and your selfie is now saved to My nAia Model for future styling."
                : successIntent === "keep-analysis"
                ? "Your Selfie Style Analysis has been kept. Your selfie has been removed."
                : successIntent === "save-selfie-only"
                ? "Your selfie is now available for future styling. Your Selfie Style Analysis has been deleted."
                : "Your selfie and Selfie Style Analysis have been removed."}
            </p>
          </div>
        </div>
      )}

      {/* ── BEFORE ANALYSIS: Saved photo in My nAia Model ──────────────────── */}
      {showSavedPhotoSection && (
        <>
          <section className="bos-section">
            <div className="bos-step-label">Use Saved Photo</div>
            {modelFacePreviewUrl && (
              <div style={{ maxWidth: "360px", marginBottom: "16px" }}>
                <img
                  src={modelFacePreviewUrl}
                  alt="Your saved photo"
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
              </div>
            )}
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75, marginBottom: "20px" }}>
              This is the photo currently saved in My nAia Model.
            </p>
            <Form method="post">
              <input type="hidden" name="_intent" value="analyse-model-selfie" />
              <div style={{ marginBottom: "20px", padding: "16px 20px", background: "rgba(34,21,22,0.03)", border: "1px solid var(--naia-border)" }}>
                <label className="psa-consent-row">
                  <input type="checkbox" name="consent" value="true" id="model-selfie-consent" required className="psa-consent-check" />
                  <span>
                    I consent to nAia analysing this photo to offer me personal styling guidance.
                    I understand this is not a medical or diagnostic assessment. I can remove my
                    analysis at any time.
                  </span>
                </label>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className={isSubmitting ? "sp-btn-outline" : "sp-btn-primary"}
                style={{ width: "100%", maxWidth: "360px", opacity: isSubmitting ? 0.65 : 1 }}
              >
                {isSubmitting ? "Analysing…" : "Analyse This Selfie"}
              </button>
            </Form>
            <div style={{ marginTop: "12px", maxWidth: "360px" }}>
              <button
                type="button"
                className="sp-btn-outline"
                style={{ width: "100%" }}
                onClick={() => setShowChooseDifferent(true)}
              >
                Use a Different Photo
              </button>
            </div>
          </section>
          <section className="bos-section">
            <div className="bos-step-label">Selfie Guidance</div>
            {guidanceList}
          </section>
        </>
      )}

      {/* ── BEFORE ANALYSIS: Choose a different photo ──────────────────────── */}
      {showChooseDifferentSection && (
        <>
          <section className="bos-section">
            <div className="bos-step-label">Choose a Different Selfie</div>
            <UploadForm
              intent="analyse"
              isSubmitting={isSubmitting}
              preview={preview}
              onFileChange={handleFileChange}
              submitLabel="Analyse New Selfie"
            />
            <div style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="sp-btn-outline"
                onClick={() => { setShowChooseDifferent(false); setPreview(null); }}
              >
                ← Use My Saved Photo
              </button>
            </div>
          </section>
          <section className="bos-section">
            <div className="bos-step-label">Selfie Guidance</div>
            {guidanceList}
          </section>
        </>
      )}

      {/* ── BEFORE ANALYSIS: No saved selfie — fresh upload ────────────────── */}
      {showFreshUploadSection && (
        <>
          <section className="bos-section">
            <div className="bos-step-label">Selfie Guidance</div>
            {guidanceList}
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
            {!showChooseDifferent && (
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
            )}
            <button
              type="button"
              className="sp-btn-outline"
              style={{ width: "100%" }}
              onClick={() => {
                if (showChooseDifferent) { setShowChooseDifferent(false); setPreview(null); }
                else setShowChooseDifferent(true);
              }}
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

      {/* Analysis deleted — photo saved, analyse or choose different */}
      {showDeletedSection && (
        <section className="bos-section">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
            {!showChooseDifferent && (
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
            )}
            <button
              type="button"
              className="sp-btn-outline"
              style={{ width: "100%" }}
              onClick={() => {
                if (showChooseDifferent) { setShowChooseDifferent(false); setPreview(null); }
                else setShowChooseDifferent(true);
              }}
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

      {/* Quality failed — bad photo, choose a different one */}
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

      {/* ── AFTER ANALYSIS — same layout regardless of photo source ────────── */}
      {showCompletedSection && displaySignals && (
        <>
          {/* YOUR SELFIE — temp selfie URL, or model face URL in stable "analysis + selfie" state */}
          {displaySelfieUrl && (
            <section className="bos-section">
              <div className="bos-step-label">Your Selfie</div>
              <div style={{ maxWidth: "360px" }}>
                <img
                  src={displaySelfieUrl}
                  alt="Your selfie"
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
              </div>
            </section>
          )}

          {/* YOUR ANALYSIS */}
          <section className="bos-section">
            <div className="bos-step-label">Your Analysis</div>
            <SelfieVisualAnalysis signals={displaySignals} />
          </section>

          {/* HOW nAia USES THIS */}
          <section className="bos-section">
            <div className="bos-step-label">How nAia Uses This</div>
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75 }}>
              {buildNaiaUsageExplanation()}
            </p>
          </section>

          {/* WHAT WOULD YOU LIKE nAia TO KEEP? — four choice cards, same design for all photo sources */}
          {showChoiceSection && (
            <section className="bos-section">
              <div className="bos-step-label">What Would You Like nAia to Keep?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
                {(
                  [
                    { intent: "keep-both" as const, label: "Keep Both", bullets: ["Keep your Selfie Style Analysis", "Save your selfie in My nAia Model"] },
                    { intent: "keep-analysis" as const, label: "Keep Analysis Only", bullets: ["Keep your analysis", "Remove the selfie from My nAia Model"] },
                    { intent: "save-selfie-only" as const, label: "Save Selfie Only", bullets: ["Remove your analysis", "Save your selfie to My nAia Model for future styling"] },
                    { intent: "delete-both" as const, label: "Delete Both", bullets: ["Delete your analysis", "Delete your saved selfie"] },
                  ] as const
                ).map(({ intent: choiceIntent, label, bullets }) => (
                  <button
                    key={choiceIntent}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setPending(choiceIntent)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "16px 20px", border: "1px solid var(--naia-border)", background: "none", cursor: "pointer", opacity: isSubmitting ? 0.65 : 1 }}
                  >
                    <div style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
                    <ul style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", fontStyle: "italic", color: "var(--naia-muted)", listStyle: "none", padding: 0, margin: 0, lineHeight: 1.6 }}>
                      {bullets.map(b => <li key={b}>· {b}</li>)}
                    </ul>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* UPDATE YOUR ANALYSIS — only after the user has made their storage choice */}
          {!showChoiceSection && (
            <section className="bos-section">
              <div className="bos-step-label">Update Your Analysis</div>
              <UploadForm
                intent="replace"
                isSubmitting={isSubmitting}
                preview={preview}
                onFileChange={handleFileChange}
                submitLabel="Analyse New Selfie"
              />
            </section>
          )}
        </>
      )}

      {/* MANAGE — reflects what actually exists after the user has decided */}
      {showManageSection && (
        <section className="bos-section">
          <div className="bos-step-label">Manage</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            {analysisCompleted && displaySignals !== null && (
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-analysis")}>
                Delete Analysis
              </button>
            )}
            {hasFaceModel && (
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-model-face")}>
                Remove Saved Selfie
              </button>
            )}
            {analysisCompleted && displaySignals !== null && hasFaceModel && (
              <button type="button" className="sp-btn-outline" onClick={() => setPending("delete-model-face-and-analysis")}>
                Delete Both
              </button>
            )}
          </div>
        </section>
      )}

      {/* Confirmation modal */}
      {pending && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="psa-confirm-title">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Confirm</div>
            <h3 id="psa-confirm-title" className="dc-modal-title">
              {pending === "keep-both"                      ? "Keep Both" :
               pending === "keep-analysis"                  ? "Keep Analysis Only" :
               pending === "save-selfie-only"               ? "Save Selfie Only" :
               pending === "delete-both"                    ? "Delete Both" :
               pending === "delete-analysis"                ? "Delete Analysis" :
               pending === "delete-model-face"              ? "Remove Saved Selfie" :
               "Delete Both"}
            </h3>
            <p className="dc-modal-desc">
              {pending === "keep-both"
                ? "Your analysis and selfie will be saved. Your selfie will be used as your nAia Model photo for future styling."
                : pending === "keep-analysis"
                ? "Your analysis will be saved. Your selfie will be permanently removed."
                : pending === "save-selfie-only"
                ? "Your selfie will be saved to My nAia Model. Your analysis will be permanently deleted."
                : pending === "delete-both"
                ? "Your analysis and selfie will both be permanently deleted."
                : pending === "delete-analysis"
                ? "Your analysis will be removed. Any selfie saved to My nAia Model is untouched."
                : pending === "delete-model-face"
                ? "Your selfie will be removed from My nAia Model. Your analysis is untouched."
                : "Your selfie and analysis will both be removed. You can create them again at any time."}
            </p>
            <div className="dc-modal-actions">
              <button type="button" className="sp-btn-ghost" onClick={() => setPending(null)} disabled={isSubmitting}>Cancel</button>
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="_intent" value={pending ?? ""} />
                <button type="submit" className="sp-btn-outline" disabled={isSubmitting}>
                  {isSubmitting
                    ? (pending === "keep-both" || pending === "keep-analysis" || pending === "save-selfie-only" ? "Saving…" : "Removing…")
                    : "Confirm"}
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

      <div style={{ marginBottom: "16px", padding: "16px 20px", background: "rgba(34,21,22,0.03)", border: "1px solid var(--naia-border)" }}>
        <label className="psa-consent-row">
          <input type="checkbox" name="consent" value="true" id={`selfie-consent-${intent}`} required className="psa-consent-check" />
          <span>
            I consent to nAia analysing this photo to offer me personal styling guidance.
            I understand this is not a medical or diagnostic assessment. I can remove my analysis
            at any time.
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

// ── Analysis sub-components are imported from ~/components/selfie/SelfieVisualAnalysis ──
