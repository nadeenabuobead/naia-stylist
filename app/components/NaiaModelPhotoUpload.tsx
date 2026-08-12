// app/components/NaiaModelPhotoUpload.tsx
// My nAia Model photo-upload UI.
//
// Privacy contract:
//   - Photos are uploaded to Cloudinary as private-delivery-type assets.
//   - The signed upload credential (including type=private) is provided server-side.
//   - secure_url from the Cloudinary response is NOT used for preview (private assets
//     are not publicly accessible — the URL returns 403 without a server signature).
//   - A temporary object URL (URL.createObjectURL) is used for instant local preview.
//   - After the save-photo action completes, the server returns a signed previewUrl
//     which replaces the object URL. The object URL is then revoked.
//   - Signed preview URLs are never persisted or logged.

import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import type { NaiaModelReadiness } from "~/lib/ai/virtual-try-on.types";
import { PROVIDER_DISCLAIMER } from "~/lib/ai/virtual-try-on.types";

const FONT_DISPLAY = "'Playfair Display',Georgia,serif";
const FONT_BODY = "'Cormorant Garamond',Garamond,serif";
const FONT_MONO = "'Space Mono','Courier New',monospace";
const COLOR_INK = "#221516";
const COLOR_MUTED = "#7a6f6a";
const COLOR_ACCENT = "#8b2035";

interface Props {
  customerId: string;
  faceDeliveryUrl: string | null;
  bodyDeliveryUrl: string | null;
  photoAnalysisConsentGiven: boolean;
  saveModelConsentGiven: boolean;
  readiness: NaiaModelReadiness;
}

type UploadSlot = "face" | "body";

interface SlotState {
  // objectUrl: temporary blob URL for instant preview — revoked after server URL arrives.
  // signedUrl: server-returned signed URL from save-photo action.
  // One of these is displayed; objectUrl takes precedence while the action is pending.
  objectUrl: string | null;
  signedUrl: string | null;
  uploading: boolean;
  error: string | null;
}

const FULL_BODY_GUIDANCE = [
  "Full body visible from head to toe",
  "Front-facing or lightly angled",
  "Arms not covering the outfit area",
  "Fitted or simple clothing",
  "Clear, even lighting",
  "Uncluttered, plain background",
];

export default function NaiaModelPhotoUpload({
  customerId,
  faceDeliveryUrl,
  bodyDeliveryUrl,
  photoAnalysisConsentGiven,
  saveModelConsentGiven,
  readiness,
}: Props) {
  const [faceSlot, setFaceSlot] = useState<SlotState>({ objectUrl: null, signedUrl: null, uploading: false, error: null });
  const [bodySlot, setBodySlot] = useState<SlotState>({ objectUrl: null, signedUrl: null, uploading: false, error: null });
  // pendingSlot tracks which slot we submitted save-photo for, so we can route the response.
  const [pendingSlot, setPendingSlot] = useState<UploadSlot | null>(null);

  const [photoAnalysis, setPhotoAnalysis] = useState(photoAnalysisConsentGiven);
  const [saveModel, setSaveModel] = useState(saveModelConsentGiven);

  const faceInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLInputElement>(null);

  const photoFetcher = useFetcher();
  const consentFetcher = useFetcher();
  const withdrawFetcher = useFetcher();
  const withdrawPhotoAnalysisFetcher = useFetcher();

  // When the save-photo action completes, replace the object URL with the server's signed URL.
  useEffect(() => {
    if (photoFetcher.state !== "idle" || !pendingSlot) return;
    const d = photoFetcher.data as any;
    if (!d) return;
    const slot = pendingSlot;
    setPendingSlot(null);
    const setter = slot === "face" ? setFaceSlot : setBodySlot;
    if (d.ok && d.previewUrl) {
      setter((prev) => {
        if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return { ...prev, objectUrl: null, signedUrl: d.previewUrl };
      });
    } else if (!d.ok) {
      // Persist failed. Revoke the object URL — there is no saved asset to preview.
      setter((prev) => {
        if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return { objectUrl: null, signedUrl: null, uploading: false, error: d.error ?? "Could not save photo." };
      });
    }
  }, [photoFetcher.state, photoFetcher.data, pendingSlot]);

  // Compute the effective display URL for each slot:
  //   objectUrl (in-flight blob preview) > signedUrl (from action) > server delivery URL (from loader).
  const faceUrl = faceSlot.objectUrl ?? faceSlot.signedUrl ?? faceDeliveryUrl;
  const bodyUrl = bodySlot.objectUrl ?? bodySlot.signedUrl ?? bodyDeliveryUrl;

  const { hasFacePhoto, hasFullBodyPhoto, isReadyForTryOn } = readiness;

  async function handleUpload(slot: UploadSlot, file: File) {
    const setter = slot === "face" ? setFaceSlot : setBodySlot;
    setter({ objectUrl: null, signedUrl: null, uploading: true, error: null });

    // Fetch signed upload credential from the server.
    // uploadUrl is the server-authorised Cloudinary endpoint — must be used verbatim.
    let sigData: {
      signature: string;
      timestamp: number;
      apiKey: string;
      cloudName: string;
      assetFolder: string;
      uploadPreset: string;
      allowedFormats: string;
      deliveryType: string;
      uploadUrl: string;       // server-provided; client must not substitute another URL
      maxFileSizeBytes: number;
    };
    try {
      const sigRes = await fetch("/api/cloudinary-signature");
      if (!sigRes.ok) {
        setter({ objectUrl: null, signedUrl: null, uploading: false, error: "Upload service unavailable. Please try again." });
        return;
      }
      sigData = await sigRes.json();
    } catch {
      setter({ objectUrl: null, signedUrl: null, uploading: false, error: "Upload service unavailable. Please try again." });
      return;
    }

    if (file.size > sigData.maxFileSizeBytes) {
      setter({
        objectUrl: null,
        signedUrl: null,
        uploading: false,
        error: `Photo must be under ${Math.round(sigData.maxFileSizeBytes / 1024 / 1024)}MB.`,
      });
      return;
    }

    // Upload to Cloudinary using the server-provided endpoint (verbatim).
    // `folder` (fixed folder mode) prefixes public_id with naia-wardrobe/{customerId}/...
    // which is required for server-side ownership validation.
    // `type=private` is signed into the form — Cloudinary enforces private delivery.
    // Server-side Admin API verification enforces delivery type and asset validity before persistence.
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sigData.apiKey);
    form.append("timestamp", String(sigData.timestamp));
    form.append("signature", sigData.signature);
    form.append("upload_preset", sigData.uploadPreset);
    form.append("folder", sigData.assetFolder);        // fixed folder mode — ownership check requires prefix
    form.append("allowed_formats", sigData.allowedFormats);
    form.append("type", sigData.deliveryType);         // signed — enforces private delivery; client cannot override

    let uploadPublicId: string;
    let uploadVersion: number;
    let uploadFormat: string;
    try {
      // Use sigData.uploadUrl verbatim — do not substitute or construct a different endpoint.
      const uploadRes = await fetch(sigData.uploadUrl, { method: "POST", body: form });
      if (!uploadRes.ok) {
        setter({ objectUrl: null, signedUrl: null, uploading: false, error: "Upload failed. Please try a different photo." });
        return;
      }
      // secure_url is NOT used — private assets are not publicly accessible via that URL.
      // Server-side verification (save-photo action) is the authoritative delivery-type check.
      const uploadData = await uploadRes.json() as { public_id: string; version: number; format: string };

      uploadPublicId = uploadData.public_id;
      uploadVersion = uploadData.version;
      uploadFormat = uploadData.format;
    } catch {
      setter({ objectUrl: null, signedUrl: null, uploading: false, error: "Upload failed. Please try a different photo." });
      return;
    }

    // Use a temporary object URL for immediate local preview.
    // This is revoked when the server's signed URL arrives via the action response.
    const objectUrl = URL.createObjectURL(file);
    setter({ objectUrl, signedUrl: null, uploading: false, error: null });

    // Persist the public_id server-side (ownership-validated, signed preview URL returned).
    const persistForm = new FormData();
    persistForm.append("intent", "save-photo");
    persistForm.append("slot", slot);
    persistForm.append("publicId", uploadPublicId);
    persistForm.append("version", String(uploadVersion));
    persistForm.append("format", uploadFormat);
    // deliveryType not sent — action enforces "private" server-side
    setPendingSlot(slot);
    photoFetcher.submit(persistForm, { method: "post" });
  }

  function handleFileChange(slot: UploadSlot, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleUpload(slot, file);
    e.target.value = "";
  }

  function handleDelete(slot: UploadSlot) {
    const setter = slot === "face" ? setFaceSlot : setBodySlot;
    setter((prev) => {
      if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return { objectUrl: null, signedUrl: null, uploading: false, error: null };
    });
    const fd = new FormData();
    fd.append("intent", "delete-photo");
    fd.append("slot", slot);
    photoFetcher.submit(fd, { method: "post" });
  }

  function handleSaveConsent() {
    const fd = new FormData();
    fd.append("intent", "save-consent");
    fd.append("photoAnalysis", String(photoAnalysis));
    fd.append("saveModel", String(saveModel));
    consentFetcher.submit(fd, { method: "post" });
  }

  function handleWithdrawSaveModel() {
    const fd = new FormData();
    fd.append("intent", "withdraw-consent");
    withdrawFetcher.submit(fd, { method: "post" });
  }

  function handleWithdrawPhotoAnalysis() {
    const fd = new FormData();
    fd.append("intent", "withdraw-photo-analysis-consent");
    withdrawPhotoAnalysisFetcher.submit(fd, { method: "post" });
  }

  const saveConsentSubmitting = consentFetcher.state !== "idle";
  const withdrawSubmitting = withdrawFetcher.state !== "idle";
  const withdrawPhotoAnalysisSubmitting = withdrawPhotoAnalysisFetcher.state !== "idle";

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      {/* Face photo section */}
      <PhotoSection
        label="Face / Upper-Body Photo"
        sublabel="Saved for visual styling — colour, neckline and jewellery intelligence."
        guidance={[]}
        statusLabel="Saved for visual styling"
        currentUrl={faceUrl}
        uploading={faceSlot.uploading}
        error={faceSlot.error}
        onUploadClick={() => faceInputRef.current?.click()}
        onDelete={() => handleDelete("face")}
        inputRef={faceInputRef}
        onFileChange={(e) => handleFileChange("face", e)}
        accept="image/jpeg,image/png,image/webp,image/heic"
      />

      {/* Full-body photo section */}
      <PhotoSection
        label="Full-Body Photo"
        sublabel="Used as your reusable virtual try-on model image."
        guidance={FULL_BODY_GUIDANCE}
        statusLabel="Ready for virtual try-on"
        currentUrl={bodyUrl}
        uploading={bodySlot.uploading}
        error={bodySlot.error}
        onUploadClick={() => bodyInputRef.current?.click()}
        onDelete={() => handleDelete("body")}
        inputRef={bodyInputRef}
        onFileChange={(e) => handleFileChange("body", e)}
        accept="image/jpeg,image/png,image/webp,image/heic"
      />

      {/* Persist action errors (non-photo-specific) */}
      {photoFetcher.data && !(photoFetcher.data as any).ok && !pendingSlot && (
        <p style={{ fontFamily: FONT_BODY, fontSize: "14px", color: COLOR_ACCENT, marginBottom: "12px" }}>
          {(photoFetcher.data as any).error ?? "Something went wrong. Please try again."}
        </p>
      )}

      {/* Consent section */}
      <div style={{ marginTop: "40px", paddingTop: "28px", borderTop: "1px solid rgba(59,5,16,0.06)" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: COLOR_ACCENT, marginBottom: "20px" }}>
          Your Permissions
        </div>

        <ConsentRow
          id="photoAnalysisConsent"
          checked={photoAnalysis}
          onChange={setPhotoAnalysis}
          label="Use my photo for nAia visual and style profile analysis."
        />
        <ConsentRow
          id="saveModelConsent"
          checked={saveModel}
          onChange={setSaveModel}
          label="Save my selected photos as My nAia Model in my profile."
        />

        <p style={{ fontSize: "13px", color: COLOR_MUTED, marginTop: "16px", marginBottom: "20px", lineHeight: 1.7, fontStyle: "italic" }}>
          {PROVIDER_DISCLAIMER}
        </p>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleSaveConsent}
            disabled={saveConsentSubmitting}
            style={primaryBtn}
          >
            {saveConsentSubmitting ? "Saving…" : "Save permissions"}
          </button>

          {photoAnalysisConsentGiven && (
            <button
              type="button"
              onClick={handleWithdrawPhotoAnalysis}
              disabled={withdrawPhotoAnalysisSubmitting}
              style={{ ...secondaryBtn, color: COLOR_MUTED }}
            >
              {withdrawPhotoAnalysisSubmitting ? "Withdrawing…" : "Withdraw photo analysis consent"}
            </button>
          )}

          {saveModelConsentGiven && (
            <button
              type="button"
              onClick={handleWithdrawSaveModel}
              disabled={withdrawSubmitting}
              style={{ ...secondaryBtn, color: COLOR_ACCENT }}
            >
              {withdrawSubmitting ? "Removing…" : "Delete My nAia Model"}
            </button>
          )}
        </div>

        {consentFetcher.data && (consentFetcher.data as any).ok && (
          <p style={{ fontFamily: FONT_MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#4a7c59", marginTop: "12px" }}>
            Permissions saved.
          </p>
        )}
        {withdrawPhotoAnalysisFetcher.data && (withdrawPhotoAnalysisFetcher.data as any).ok && (
          <p style={{ fontFamily: FONT_MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#4a7c59", marginTop: "12px" }}>
            Photo analysis consent withdrawn.
          </p>
        )}
      </div>

      {/* Readiness summary — derived from server state */}
      <div style={{ marginTop: "32px", padding: "20px", background: "rgba(59,5,16,0.02)", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: COLOR_MUTED, marginBottom: "4px" }}>
          Try-On Readiness
        </div>
        <ReadinessRow label="Face photo" ready={hasFacePhoto || !!faceSlot.objectUrl || !!faceSlot.signedUrl} />
        <ReadinessRow label="Full-body photo" ready={hasFullBodyPhoto || !!bodySlot.objectUrl || !!bodySlot.signedUrl} />
        <ReadinessRow label="Save model consent" ready={saveModelConsentGiven} />
        <ReadinessRow label="Ready for try-on" ready={isReadyForTryOn} highlight />
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface PhotoSectionProps {
  label: string;
  sublabel: string;
  guidance: string[];
  statusLabel: string;
  currentUrl: string | null;
  uploading: boolean;
  error: string | null;
  onUploadClick: () => void;
  onDelete: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  accept: string;
}

function PhotoSection({
  label, sublabel, guidance, statusLabel, currentUrl, uploading, error,
  onUploadClick, onDelete, inputRef, onFileChange, accept,
}: PhotoSectionProps) {
  return (
    <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: COLOR_ACCENT, marginBottom: "8px" }}>
        {label}
      </div>
      <p style={{ fontFamily: FONT_BODY, fontSize: "15px", color: COLOR_MUTED, marginBottom: "16px", fontStyle: "italic" }}>
        {sublabel}
      </p>

      {guidance.length > 0 && (
        <ul style={{ marginBottom: "16px", paddingLeft: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
          {guidance.map((g) => (
            <li key={g} style={{ fontFamily: FONT_BODY, fontSize: "14px", color: COLOR_MUTED, display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ color: COLOR_ACCENT, flexShrink: 0 }}>—</span> {g}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={onFileChange}
        aria-label={`Upload ${label}`}
      />

      {currentUrl ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "240px" }}>
          <img
            src={currentUrl}
            alt={`${label} preview`}
            style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }}
          />
          <div style={{ fontFamily: FONT_MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: COLOR_MUTED }}>
            {statusLabel}
          </div>
          {error && (
            <p style={{ fontFamily: FONT_BODY, fontSize: "14px", color: COLOR_ACCENT, margin: "0" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={onUploadClick} style={secondaryBtn}>
              Replace
            </button>
            <button type="button" onClick={onDelete} style={{ ...secondaryBtn, color: COLOR_ACCENT }}>
              Remove
            </button>
          </div>
        </div>
      ) : uploading ? (
        <button
          type="button"
          disabled
          style={{
            padding: "24px 32px",
            border: "1px dashed rgba(59,5,16,0.2)",
            background: "transparent",
            cursor: "wait",
            fontFamily: FONT_MONO,
            fontSize: "9px",
            letterSpacing: "3px",
            textTransform: "uppercase",
            color: COLOR_MUTED,
          }}
        >
          Uploading…
        </button>
      ) : error ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ fontFamily: FONT_BODY, fontSize: "14px", color: COLOR_ACCENT, margin: "0" }}>
            {error}
          </p>
          <button
            type="button"
            onClick={onUploadClick}
            style={{
              alignSelf: "flex-start",
              padding: "12px 24px",
              border: "1px solid rgba(139,32,53,0.4)",
              background: "transparent",
              cursor: "pointer",
              fontFamily: FONT_MONO,
              fontSize: "9px",
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: COLOR_ACCENT,
            }}
          >
            Choose another photo
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onUploadClick}
          style={{
            padding: "24px 32px",
            border: "1px dashed rgba(59,5,16,0.2)",
            background: "transparent",
            cursor: "pointer",
            fontFamily: FONT_MONO,
            fontSize: "9px",
            letterSpacing: "3px",
            textTransform: "uppercase",
            color: COLOR_INK,
          }}
        >
          Upload photo
        </button>
      )}
    </div>
  );
}

interface ConsentRowProps {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

function ConsentRow({ id, checked, onChange, label }: ConsentRowProps) {
  return (
    <label
      htmlFor={id}
      style={{ display: "flex", gap: "12px", alignItems: "flex-start", cursor: "pointer", marginBottom: "14px" }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: "2px", flexShrink: 0, accentColor: COLOR_ACCENT }}
      />
      <span style={{ fontFamily: FONT_BODY, fontSize: "15px", color: COLOR_INK, lineHeight: 1.6 }}>
        {label}
      </span>
    </label>
  );
}

interface ReadinessRowProps {
  label: string;
  ready: boolean;
  highlight?: boolean;
}

function ReadinessRow({ label, ready, highlight }: ReadinessRowProps) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <span style={{ fontFamily: FONT_BODY, fontSize: "15px", color: highlight ? COLOR_INK : COLOR_MUTED }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "8px",
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: ready ? (highlight ? COLOR_ACCENT : "#4a7c59") : COLOR_MUTED,
        }}
      >
        {ready ? (highlight ? "Ready" : "Set") : "Not yet"}
      </span>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "12px 24px",
  background: "#221516",
  border: "none",
  fontFamily: FONT_MONO,
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
  color: "#f4f4f1",
};

const secondaryBtn: React.CSSProperties = {
  padding: "10px 20px",
  background: "transparent",
  border: "1px solid rgba(59,5,16,0.12)",
  fontFamily: FONT_MONO,
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
  color: COLOR_INK,
};
