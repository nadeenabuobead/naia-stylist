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
  label, required, imageUrl, uploading, error, onFile,
}: {
  label: string; required?: boolean;
  imageUrl?: string; uploading?: boolean; error?: string;
  onFile?: (f: File) => void;
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
            <label htmlFor={inputId}>
              <input id={inputId} type="file" accept="image/*"
                onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
                style={{ display: "none" }} />
              <span className="bos-upload-btn">
                {uploading ? "Uploading…" : "Choose File"}
              </span>
            </label>
          )
          : <button type="button" className="bos-upload-btn" disabled>Choose File</button>
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
  const [imageUrl, setImageUrl] = React.useState("");
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
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("Photo is too large. Please choose an image under 10 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const sigRes = await fetch("/api/cloudinary-signature", { credentials: "same-origin" });
      if (sigRes.status === 401) { setUploadError("Your session has expired. Please sign in again."); return; }
      if (!sigRes.ok) { setUploadError("Upload service unavailable. Please try again."); return; }
      const { signature, timestamp, apiKey, cloudName, assetFolder, uploadPreset, allowedFormats } = await sigRes.json();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", uploadPreset);
      fd.append("api_key", apiKey);
      fd.append("timestamp", String(timestamp));
      fd.append("signature", signature);
      fd.append("asset_folder", assetFolder);
      fd.append("allowed_formats", allowedFormats);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: fd });
      const uploadData = await res.json();
      if (!uploadData.secure_url) {
        const msg = typeof uploadData?.error?.message === "string" ? uploadData.error.message : null;
        setUploadError(msg ? `Upload failed: ${msg}` : "Upload failed. Please try another photo.");
        return;
      }
      setImageUrl(uploadData.secure_url);
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
    try {
      const response = await fetch("/api/wishlist?action=analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, category, color, brand, forOccasion, whatLike, unsureAbout, colorNote, size }),
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
        navigate(`/buyskip/${data.analysisId}`);
      } else if (data.success) {
        setAnalyzeError("Recommendation generated but could not be saved. Please try again.");
      } else {
        setAnalyzeError((data as any).error || "Unable to generate recommendation. Please try again.");
      }
    } catch {
      setAnalyzeError("Recommendation failed. Please check your connection and try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const canAnalyze = imageUrl && category && color.length > 0 && !analyzing;

  return (
    <MyNaiaLayout>
      {/* Floating analysis card — overlays form while analysing; reuses exact Style Me loading classes */}
      {analyzing && (
        <div className="bos-analyzing-overlay" role="status" aria-live="polite" aria-label={BOS_LOADING_MESSAGES[msgIndex]}>
          <div className="sm-loading-inner">
            <h2 style={{ fontFamily: "var(--naia-ff-display)", fontSize: "32px", fontWeight: 900, fontStyle: "italic", color: "var(--naia-ink)", marginBottom: "16px" }}>
              nAia is assessing your item...
            </h2>
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--naia-muted)", marginBottom: "40px" }}>
              Reviewing your item against your Passport, Closet and style.
            </p>
            <div className="sm-loading-track">
              <div className="sm-loading-bar" />
            </div>
            <p className="sm-loading-msg">{BOS_LOADING_MESSAGES[msgIndex]}</p>
          </div>
        </div>
      )}

      {/* Form content — stays in DOM but non-interactive while analysing */}
      <div
        aria-hidden={analyzing}
        style={{ pointerEvents: analyzing ? "none" : undefined }}
      >
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
          />
          <UploadRow label="A Second Angle (optional)" />
          <UploadRow label="Fabric or Detail (optional)" />
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
      </div>{/* end form content wrapper */}
    </MyNaiaLayout>
  );
}
