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
//   "analyse"         — validate + upload + analyse + persist
//   "replace"         — same as analyse but bypasses pending guard and deletes old photo via overwrite
//   "delete-photo"    — delete Cloudinary asset, clear photoPublicId, keep signals
//   "delete-analysis" — clear signals only, keep photo for re-analysis
//   "delete-both"     — delete photo and clear all signals
//
// Migration required before live DB writes:
//   prisma/migrations/20260717100000_add_selfie_analysis/migration.sql

import { useState, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation, Form } from "react-router";
import { data } from "react-router";
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
  type SelfieDisplayRecord,
} from "~/lib/ai/selfie-persistence.server";
import {
  buildColourDirectionSummary,
  buildNecklineSummary,
  buildHairDirectionSummary,
  buildAccessoriesSummary,
  buildNaiaUsageExplanation,
} from "~/lib/ai/selfie-styling-signals";

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
  | { intent: "analyse" | "replace"; outcome: SelfieAnalysisOutcome }
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
  const begin = await beginSelfieAnalysis(
    customer.id,
    consentAt,
    null,    // photoPublicId set after upload
    null,    // photoFormat set after upload
    { forceReplace: isReplace },
  );
  if (begin.blocked) {
    return {
      intent: "analyse",
      outcome: { status: "invalid-input", reason: "An analysis is already in progress. Please wait." },
    };
  }

  // Upload to Cloudinary (private asset, overwrite=true so replace is atomic)
  const upload = await uploadSelfieToCloudinary(bytes, validation.canonicalMime, customer.id);
  if (!upload.ok) {
    await failSelfieAnalysis(customer.id);
    return {
      intent: "analyse",
      outcome: { status: "system-failure", internalNote: `Upload failed: ${upload.errorCode}` },
    };
  }

  // Update DB record with the confirmed public ID and format
  // (begins analysis guard is now active; photo is stored)
  await beginSelfieAnalysis(
    customer.id,
    consentAt,
    upload.publicId,
    upload.format,
    { forceReplace: true }, // already pending — force update to add publicId
  );

  // Build short-lived signed URL for analyzeImage — NEVER returned to browser
  const analysisUrl = buildSelfieAnalysisUrl(upload.publicId, upload.format);
  if (!analysisUrl) {
    await failSelfieAnalysis(customer.id);
    return {
      intent: "analyse",
      outcome: { status: "system-failure", internalNote: "Cloudinary not configured for analysis URL" },
    };
  }

  // Run analysis — provider call stays entirely server-side
  const outcome = await analyseSelfie(
    { imageUrl: analysisUrl },
    { consentAt: consentAt.toISOString() },
  );

  // Persist result — only validated signals stored; raw response discarded
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

  // Return public-safe outcome — no publicId, no format, no signedUrl
  return { intent: isReplace ? "replace" : "analyse", outcome };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelfieUploadPage() {
  const { existing } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [preview, setPreview] = useState<string | null>(null);
  const isSubmitting = navigation.state === "submitting";

  // Derive displayed outcome: action result takes precedence over loader state
  const analysisIntent = actionData && "outcome" in actionData ? actionData.intent : null;
  const outcome: SelfieAnalysisOutcome | null =
    actionData && "outcome" in actionData ? actionData.outcome : null;

  const showUploadForm = !outcome && (!existing || existing.analysisStatus === "failed");
  const showResults = outcome?.status === "completed" ||
    (existing?.analysisStatus === "completed" && !outcome);
  const displaySignals = outcome?.status === "completed"
    ? outcome.signals
    : existing?.signals ?? null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setPreview(null); return; }
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", fontFamily: "'Cormorant Garamond', Garamond, serif" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "48px 24px 80px" }}>

        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "10px" }}>
            Personal Style
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "clamp(24px,4vw,36px)", fontWeight: 900, color: "#221516", letterSpacing: "-0.5px", marginBottom: "12px" }}>
            Your Styling Photo
          </h1>
          <p style={{ fontSize: "16px", fontStyle: "italic", color: "#7a6f6a", lineHeight: 1.6 }}>
            Share a clear photo of your face and nAia will offer gentle styling observations —
            colour directions, necklines, and hair guidance that may suit you.
          </p>
        </div>

        {/* Analysis in progress */}
        {existing?.analysisStatus === "pending" && !outcome && (
          <div style={{ padding: "20px 24px", background: "rgba(59,5,16,0.03)", border: "1px solid rgba(59,5,16,0.08)", marginBottom: "24px" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>
              Analysis in progress — please wait
            </div>
          </div>
        )}

        {/* Inline outcome feedback (errors, quality-fail) */}
        {outcome && outcome.status !== "completed" && (
          <OutcomeFeedback outcome={outcome} />
        )}

        {/* Completed results */}
        {showResults && displaySignals && (
          <div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>
              {analysisIntent === "replace" ? "Updated observations" : "Your styling observations"}
            </div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "22px", fontStyle: "italic", color: "#221516", marginBottom: "32px" }}>
              Here&apos;s what nAia noticed.
            </div>

            <SignalSection label="Your Colour Direction">
              <p>{buildColourDirectionSummary(displaySignals)}</p>
            </SignalSection>
            <SignalSection label="Necklines That May Suit You">
              <p>{buildNecklineSummary(displaySignals)}</p>
            </SignalSection>
            <SignalSection label="Hair Direction">
              <p>{buildHairDirectionSummary(displaySignals)}</p>
            </SignalSection>
            <SignalSection label="Earrings and Glasses">
              <p>{buildAccessoriesSummary(displaySignals)}</p>
            </SignalSection>
            <SignalSection label="How nAia Will Use This" subtle>
              <p style={{ fontSize: "13px", fontStyle: "italic", lineHeight: 1.7 }}>
                {buildNaiaUsageExplanation()}
              </p>
            </SignalSection>

            {/* Management controls */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "32px" }}>
              <Form method="post">
                <input type="hidden" name="_intent" value="delete-both" />
                <button type="submit" style={dangerButtonStyle}>
                  Delete photo and analysis
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_intent" value="delete-analysis" />
                <button type="submit" style={quietButtonStyle}>
                  Remove analysis only
                </button>
              </Form>
            </div>

            {/* Replace photo section */}
            <div style={{ marginTop: "40px", paddingTop: "32px", borderTop: "1px solid rgba(59,5,16,0.07)" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "16px" }}>
                Update photo
              </div>
              <UploadForm
                intent="replace"
                isSubmitting={isSubmitting}
                preview={preview}
                onFileChange={handleFileChange}
                submitLabel="Replace and re-analyse"
              />
            </div>
          </div>
        )}

        {/* Initial upload form */}
        {showUploadForm && (
          <>
            <PhotoRequirements />
            <UploadForm
              intent="analyse"
              isSubmitting={isSubmitting}
              preview={preview}
              onFileChange={handleFileChange}
              submitLabel="Analyse my photo"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhotoRequirements() {
  return (
    <div style={{ background: "rgba(59,5,16,0.03)", border: "1px solid rgba(59,5,16,0.08)", padding: "20px 24px", marginBottom: "32px" }}>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>
        For the best results
      </div>
      <ul style={{ margin: 0, paddingLeft: "18px", color: "#4a3f3a", fontSize: "14px", lineHeight: 2 }}>
        <li>Face clearly visible and facing the camera</li>
        <li>Even, natural lighting — no heavy flash</li>
        <li>Sharp and in focus</li>
        <li>No heavy colour filters or strong shadows on face</li>
        <li>Only one person in the frame</li>
      </ul>
    </div>
  );
}

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
        <div style={{ marginBottom: "20px" }}>
          <img src={preview} alt="Preview" style={{ width: "100%", maxHeight: "320px", objectFit: "cover", display: "block" }} />
        </div>
      )}

      <div style={{ marginBottom: "20px" }}>
        <input
          ref={fileRef}
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp,image/heic"
          required
          onChange={onFileChange}
          style={{ display: "block", width: "100%", marginBottom: "8px" }}
        />
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "7px", letterSpacing: "1px", color: "#7a6f6a" }}>
          JPG, PNG, WEBP, HEIC — max 5 MB
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "28px", padding: "16px", background: "rgba(59,5,16,0.03)", border: "1px solid rgba(59,5,16,0.08)" }}>
        <input type="checkbox" name="consent" value="true" id={`selfie-consent-${intent}`} required style={{ marginTop: "3px", accentColor: "#8b2035", flexShrink: 0 }} />
        <label htmlFor={`selfie-consent-${intent}`} style={{ fontSize: "13px", color: "#4a3f3a", lineHeight: 1.6, cursor: "pointer" }}>
          I consent to nAia analysing this photo to offer me personal styling guidance.
          I understand this is not a medical or diagnostic assessment. I can delete this
          photo and remove my analysis at any time.
        </label>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        style={{ width: "100%", padding: "14px", background: isSubmitting ? "rgba(59,5,16,0.2)" : "#221516", color: "#f4f4f1", fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", border: "none", cursor: isSubmitting ? "not-allowed" : "pointer" }}
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
  }

  if (!title) return null;
  return (
    <div style={{ padding: "20px 24px", background: "rgba(139,32,53,0.04)", border: "1px solid rgba(139,32,53,0.15)", marginBottom: "28px" }}>
      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "17px", fontStyle: "italic", color: "#8b2035", marginBottom: "8px" }}>{title}</div>
      <p style={{ color: "#4a3f3a", fontSize: "14px", lineHeight: 1.7, margin: 0 }}>{message}</p>
    </div>
  );
}

function SignalSection({ label, children, subtle }: { label: string; children: React.ReactNode; subtle?: boolean }) {
  return (
    <div style={{ marginBottom: "28px", paddingBottom: "28px", borderBottom: "1px solid rgba(59,5,16,0.07)" }}>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: subtle ? "#7a6f6a" : "#8b2035", marginBottom: "8px" }}>{label}</div>
      <div style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

const dangerButtonStyle: React.CSSProperties = {
  padding: "10px 18px", background: "none", border: "1px solid rgba(139,32,53,0.4)",
  color: "#8b2035", fontFamily: "'Space Mono', monospace", fontSize: "7px",
  letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer",
};

const quietButtonStyle: React.CSSProperties = {
  padding: "10px 18px", background: "none", border: "1px solid rgba(59,5,16,0.2)",
  color: "#7a6f6a", fontFamily: "'Space Mono', monospace", fontSize: "7px",
  letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer",
};
