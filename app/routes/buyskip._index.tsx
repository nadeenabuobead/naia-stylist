import * as React from "react";
import { Link, useNavigate, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "Buy or Skip | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCurrentNaiaCustomer(request);
  return {};
}

// ── Constants ────────────────────────────────────────────────────────────────

type Source = "upload" | "photograph";

const SOURCE_OPTIONS: { id: Source; label: string; hint: string }[] = [
  { id: "upload",    label: "Upload a Screenshot or Product Image", hint: "From a website, lookbook or saved image." },
  { id: "photograph", label: "Take a Photograph in a Store",        hint: "Capture the piece on the rack or on you." },
];

const EVIDENCE = [
  "Style Passport", "My Closet", "Lifestyle",
  "Fit & Coverage Preferences", "Saved Products",
  "Previous Purchases", "Previous Buy or Skip Decisions", "Styling Feedback",
];

const CATEGORIES = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory", "Jewelry"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver"];

const BOS_LOADING_MESSAGES = [
  "Reading your item…",
  "Reviewing what you like…",
  "Considering your concerns…",
  "Checking the occasion…",
  "Comparing with your Passport…",
  "Looking through your Digital Closet…",
  "Assessing colour, fit and size…",
  "Weighing versatility and wear frequency…",
  "Preparing your recommendation…",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadRow({
  label, required, imageUrl, uploading, error, onFile, capture, buttonLabel = "Choose File",
}: {
  label: string; required?: boolean;
  imageUrl?: string; uploading?: boolean; error?: string;
  onFile?: (f: File) => void;
  capture?: "environment" | "user";
  buttonLabel?: string;
}) {
  const inputId = `bos-file-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="bos-upload-row">
      <div className="bos-upload-row-inner">
        <div className="bos-upload-row-label">
          {label}{required && <span style={{ color: "var(--naia-accent)", marginLeft: "4px" }}>·</span>}
        </div>
        <div className="bos-upload-row-hint">JPG or PNG · high resolution preferred</div>
        {error && <div className="bos-upload-row-error">{error}</div>}
      </div>
      {imageUrl
        ? <img src={imageUrl} alt="Uploaded preview" className="bos-upload-row-preview" />
        : onFile
          ? (
            <label htmlFor={inputId} className="bos-upload-btn">
              <input id={inputId} type="file" accept="image/*"
                {...(capture ? { capture } : {})}
                onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
                style={{ display: "none" }} />
              {uploading ? "Uploading…" : buttonLabel}
            </label>
          )
          : <button type="button" className="bos-upload-btn" disabled>{buttonLabel}</button>
      }
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="bos-field-label">{label}</label>
      <input className="bos-input" type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BuyOrSkip() {
  const navigate = useNavigate();
  const [source, setSource] = React.useState<Source>("upload");
  const [imageUrl, setImageUrl] = React.useState(""); // local blob URL for preview only (never sent to server)
  const [imagePublicId, setImagePublicId] = React.useState(""); // Cloudinary public ID — sent to analyze API
  const blobUrlRef = React.useRef<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [msgIndex, setMsgIndex] = React.useState(0);
  const [category, setCategory] = React.useState("");
  const [color, setColor] = React.useState<string[]>([]);
  const [brand, setBrand] = React.useState("");
  const [uploadError, setUploadError] = React.useState("");
  const [analyzeError, setAnalyzeError] = React.useState("");
  const [forOccasion, setForOccasion] = React.useState("");
  const [whatLike, setWhatLike] = React.useState("");
  const [unsureAbout, setUnsureAbout] = React.useState("");
  const [colorNote, setColorNote] = React.useState("");
  const [size, setSize] = React.useState("");

  // Revoke the blob preview URL when the component unmounts to avoid memory leaks.
  React.useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const handleUpload = async (file: File) => {
    const mimeType = file.type.toLowerCase();
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const formatOk = mimeType
      ? ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mimeType)
      : ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext);
    if (!formatOk) {
      setUploadError("Unsupported format. Please upload a JPG, PNG, WEBP, or HEIC photo.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      // Fetch server-signed upload credential. uploadUrl is the private-delivery endpoint —
      // it must be used verbatim. The browser never constructs the Cloudinary upload URL itself.
      const sigRes = await fetch("/api/cloudinary-signature", { credentials: "same-origin" });
      if (sigRes.status === 401) { setUploadError("Your session has expired. Please sign in again."); return; }
      if (!sigRes.ok) { setUploadError("Upload service unavailable. Please try again."); return; }
      const sigData = await sigRes.json();
      const { signature, timestamp, apiKey, assetFolder, uploadPreset, allowedFormats, uploadUrl, maxFileSizeBytes, deliveryType } = sigData;

      if (file.size > maxFileSizeBytes) {
        setUploadError(`Photo is too large. Please choose an image under ${Math.round(maxFileSizeBytes / 1024 / 1024)} MB.`);
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", uploadPreset);
      fd.append("api_key", apiKey);
      fd.append("timestamp", String(timestamp));
      fd.append("signature", signature);
      fd.append("folder", assetFolder); // fixed folder mode — public_id is prefixed with folder path
      fd.append("allowed_formats", allowedFormats);
      fd.append("type", deliveryType); // signed — enforces private delivery; client cannot override
      // uploadUrl is the server-provided browser upload endpoint; used verbatim.
      const res = await fetch(uploadUrl, { method: "POST", body: fd });
      const uploadData = await res.json();
      if (!uploadData.public_id) {
        const msg = typeof uploadData?.error?.message === "string" ? uploadData.error.message : null;
        setUploadError(msg ? `Upload failed: ${msg}` : "Upload failed. Please try another photo.");
        return;
      }
      // Private assets are not publicly accessible via secure_url — use a local blob URL for preview.
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blobUrl = URL.createObjectURL(file);
      blobUrlRef.current = blobUrl;
      setImageUrl(blobUrl);
      // Store the Cloudinary public ID — this is what the server receives for verification.
      setImagePublicId(uploadData.public_id);
    } catch {
      setUploadError("Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  React.useEffect(() => {
    if (!analyzing) return;
    setMsgIndex(0);
    const t = setInterval(() => setMsgIndex(i => (i + 1) % BOS_LOADING_MESSAGES.length), 1400);
    return () => clearInterval(t);
  }, [analyzing]);

  const handleAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError("");
    // Track whether we initiated navigation — if so, keep overlay visible until unmount
    let navigated = false;
    try {
      // Send the Cloudinary public ID — not a URL. Server verifies ownership and delivery type
      // before analysis starts. The browser never sends a raw image URL to the analysis API.
      const response = await fetch("/api/wishlist?action=analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: imagePublicId, category, color, brand, forOccasion, whatLike, unsureAbout, colorNote, size }),
      });
      if (response.status === 401) {
        setAnalyzeError("Your session has expired. Please sign in again.");
        return;
      }
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setAnalyzeError((errData as any).error || "Recommendation failed. Please try again.");
        return;
      }
      const data = await response.json();
      if (data.success && data.analysisId) {
        navigated = true;
        navigate(`/buyskip/${data.analysisId}`);
        return; // overlay stays visible until component unmounts on navigation
      } else if (data.success) {
        setAnalyzeError("Recommendation generated but could not be saved. Please try again.");
      } else {
        setAnalyzeError((data as any).error || "Unable to generate recommendation. Please try again.");
      }
    } catch {
      setAnalyzeError("Recommendation failed. Please check your connection and try again.");
    } finally {
      // Only reset state on non-navigation paths; on success the component unmounts
      if (!navigated) setAnalyzing(false);
    }
  };

  const canAnalyze = imagePublicId && category && color.length > 0 && !analyzing;

  // Loading screen — same pattern as Style Me result.tsx: return before MyNaiaLayout.
  // sm-loading-wrap fills 100vh so no fixed/portal positioning needed.
  if (analyzing) {
    return (
      <div className="sm-loading-wrap" role="status" aria-live="polite" aria-label={BOS_LOADING_MESSAGES[msgIndex]}>
        <div className="sm-loading-inner">
          <h2 style={{ fontSize: "36px", lineHeight: 1.1, marginBottom: "16px", fontFamily: "var(--ff-editorial)", fontStyle: "italic", fontWeight: 400, color: "var(--naia-ink)" }}>
            <span style={{ color: "var(--lipstick)" }}>nAia</span>
            {" is assessing your item..."}
          </h2>
          <p style={{ fontFamily: "var(--ff-display)", fontSize: "18px", fontStyle: "normal", fontWeight: 200, letterSpacing: "0.05em", color: "var(--naia-muted)", marginBottom: "40px" }}>
            Reviewing your item against your Passport, Closet and style.
          </p>
          <div className="sm-loading-track">
            <div className="sm-loading-bar" />
          </div>
          <p className="sm-loading-msg">{BOS_LOADING_MESSAGES[msgIndex]}</p>
        </div>
      </div>
    );
  }

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Back to Overview</Link>

      {/* Section shell */}
      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Should I Buy This?</div>
        <h1 className="sp-shell-title">Should I Buy This?</h1>
        <p className="sp-shell-desc">
          Considering a piece from another brand? Share it with nAia and receive an honest read based
          on your style, wardrobe, lifestyle and whether you already own something similar.
        </p>
      </div>

      {/* Step 1 · Add the Piece */}
      <section className="bos-section">
        <div className="bos-step-label">Step 1 · Add the Piece</div>
        <div className="bos-source-grid">
          {SOURCE_OPTIONS.map(o => (
            <button key={o.id} type="button"
              className={`bos-source-card${source === o.id ? " bos-source-card--active" : ""}`}
              onClick={() => setSource(o.id)}>
              <div className="bos-source-card-label">{o.label}</div>
              <p className="bos-source-card-hint">{o.hint}</p>
            </button>
          ))}
        </div>
        <div className="bos-upload-rows">
          <UploadRow
            label={source === "upload" ? "Screenshot or Product Image" : "Photograph — Front View"}
            required
            imageUrl={imageUrl || undefined}
            uploading={uploading}
            error={uploadError || undefined}
            onFile={handleUpload}
            capture={source === "photograph" ? "environment" : undefined}
            buttonLabel={source === "photograph" ? "Take Photo" : "Choose File"}
          />
          <UploadRow label="A Second Angle (optional)" buttonLabel={source === "photograph" ? "Take Photo" : "Choose File"} />
          <UploadRow label="Fabric or Detail (optional)" buttonLabel={source === "photograph" ? "Take Photo" : "Choose File"} />
        </div>
      </section>

      {/* Step 2 · A Few Questions (shown once image is uploaded) */}
      {imageUrl && (
        <section className="bos-section">
          <div className="bos-step-label">Step 2 · A Few Questions</div>
          <div className="bos-fields-grid">
            <Field label="What are you considering it for?" value={forOccasion} onChange={setForOccasion} placeholder="e.g. Evening dinners in Beirut" />
            <Field label="What do you like about it?" value={whatLike} onChange={setWhatLike} placeholder="e.g. The neckline and the drape" />
            <Field label="What are you unsure about?" value={unsureAbout} onChange={setUnsureAbout} placeholder="e.g. Whether it duplicates something I own" />
            <Field label="Which colour are you considering?" value={colorNote} onChange={setColorNote} placeholder="e.g. Ivory" />
            <Field label="Which size are you considering?" value={size} onChange={setSize} placeholder="e.g. M" />
          </div>

          <div className="bos-field-row">
            <label className="bos-field-label">Category *</label>
            <div className="bos-pills">
              {CATEGORIES.map(c => (
                <button key={c} type="button"
                  className={`bos-pill${category === c ? " bos-pill--on" : ""}`}
                  onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          </div>

          <div className="bos-field-row">
            <label className="bos-field-label">Color * (choose all that apply)</label>
            <div className="bos-pills">
              {COLORS.map(c => (
                <button key={c} type="button"
                  className={`bos-pill${color.includes(c) ? " bos-pill--on" : ""}`}
                  onClick={() => setColor(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="bos-field-row">
            <label className="bos-field-label">Brand (optional)</label>
            <input className="bos-input" type="text" placeholder="e.g. Zara, H&M" value={brand} onChange={e => setBrand(e.target.value)} />
          </div>
        </section>
      )}

      {/* What nAia May Consider */}
      <section className="bos-section">
        <div className="bos-step-label">What nAia May Consider</div>
        <ul className="bos-evidence-tags">
          {EVIDENCE.map(e => <li key={e} className="bos-evidence-tag">{e}</li>)}
        </ul>
      </section>

      {/* CTA row */}
      <div className="bos-cta-row">
        <button type="button" className="sp-btn-primary"
          disabled={!canAnalyze}
          onClick={handleAnalyze}>
          {analyzing ? "Analysing…" : "Get My Recommendation"}
        </button>
        <Link to="/my-naia/buying-decisions" className="bos-link">View All Decisions</Link>
      </div>
      {analyzeError && (
        <p className="bos-error">
          {analyzeError}{" "}
          {analyzeError.includes("session") && (
            <a href="/auth/shopify/login?return_to=/buyskip" style={{ color: "var(--naia-accent)", textDecoration: "underline" }}>Sign in →</a>
          )}
        </p>
      )}
    </MyNaiaLayout>
  );
}
