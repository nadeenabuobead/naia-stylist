import * as React from "react";
import { Link, type LinksFunction, type LoaderFunctionArgs } from "react-router";
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

function ResultBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bos-result-block">
      <div className="bos-result-block-label">{label}</div>
      <div className="bos-result-block-body">{children}</div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BuyOrSkip() {
  const [source, setSource] = React.useState<Source>("upload");
  const [imageUrl, setImageUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [category, setCategory] = React.useState("");
  const [color, setColor] = React.useState<string[]>([]);
  const [brand, setBrand] = React.useState("");
  const [uploadError, setUploadError] = React.useState("");
  const [analyzeError, setAnalyzeError] = React.useState("");
  const [closetItemCount, setClosetItemCount] = React.useState(0);
  const [eligibleClosetItemCount, setEligibleClosetItemCount] = React.useState(0);
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

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const response = await fetch("/api/wishlist?action=analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, category, color, brand }),
      });
      if (response.status === 401) {
        setAnalyzeError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await response.json();
      if (data.success) {
        const a = data.analysis;
        setClosetItemCount(typeof data.closetItemCount === "number" ? data.closetItemCount : 0);
        setEligibleClosetItemCount(typeof data.eligibleClosetItemCount === "number" ? data.eligibleClosetItemCount : 0);
        setResult({
          verdict:        a.verdict,
          confidence:     a.confidence,
          styleAlignment: a.styleDNAMatch,
          details:        a.detailedAnalysis,
          closetPairings: a.closetPairings || [],
          fillsGap:       a.fillsGap,
          naiaMatch:      a.naiaMatch,
          occasions:      a.occasions || [],
          finalThought:   a.finalThought,
        });
      } else {
        setResult({ verdict: "UNABLE TO ASSESS", confidence: 0, finalThought: "Unable to analyse. Please try another photo." });
      }
    } catch {
      setResult({ verdict: "ERROR", confidence: 0, finalThought: "Analysis failed. Please try again." });
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setImageUrl(""); setResult(null); setCategory(""); setColor([]);
    setBrand(""); setUploadError(""); setAnalyzeError("");
    setForOccasion(""); setWhatLike(""); setUnsureAbout(""); setColorNote(""); setSize("");
    setClosetItemCount(0); setEligibleClosetItemCount(0);
  };

  const renderablePairings: Array<{ name: string; reason: string | null }> = [];
  if (result?.closetPairings && Array.isArray(result.closetPairings)) {
    for (const p of result.closetPairings) {
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
      if (!name) continue;
      renderablePairings.push({ name, reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null });
    }
  }

  const canAnalyze = imageUrl && category && color.length > 0 && !analyzing;

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      {/* Section shell */}
      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Should I Buy This?</div>
        <h1 className="sp-shell-title" style={{ fontSize: "clamp(36px, 4.5vw, 52px)" }}>Should I Buy This?</h1>
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

      {/* Step 2 · A Few Questions */}
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

      {/* Result */}
      {result && (
        <section className="bos-section bos-result">
          <div className="bos-step-label">nAia's Recommendation</div>
          <div className="bos-verdict">{result.verdict}</div>
          {result.confidence > 0 && (
            <div className="bos-confidence">{result.confidence}% confidence</div>
          )}
          {result.finalThought && (
            <p className="bos-result-summary">{result.finalThought}</p>
          )}

          <div className="bos-result-blocks">
            {result.styleAlignment && (
              <ResultBlock label="Style DNA Match">
                <p>{result.styleAlignment}</p>
              </ResultBlock>
            )}
            {result.details && (
              <ResultBlock label="Why It Does Or Does Not Work">
                {result.details.silhouette && <div><strong>Silhouette:</strong> {result.details.silhouette}</div>}
                {result.details.color && <div><strong>Color:</strong> {result.details.color}</div>}
                {result.details.fabric && <div><strong>Fabric:</strong> {result.details.fabric}</div>}
                {result.details.versatility && <div><strong>Versatility:</strong> {result.details.versatility}</div>}
              </ResultBlock>
            )}
            <ResultBlock label="Pairs With Your Closet">
              {renderablePairings.length > 0 ? (
                <ul className="bos-result-reasons">
                  {renderablePairings.map((p, i) => (
                    <li key={i} className="bos-result-reason">
                      <span className="bos-result-reason-dash" aria-hidden />
                      <span><strong>{p.name}</strong>{p.reason && <span> — {p.reason}</span>}</span>
                    </li>
                  ))}
                </ul>
              ) : closetItemCount > 0 && eligibleClosetItemCount === 0 ? (
                <p>You have pieces in your Closet, but nAia could not find a clear pairing for this item yet.</p>
              ) : (
                <p>No closet items yet.{" "}<Link to="/closet">Add pieces to your wardrobe</Link> and nAia will tell you what this pairs with.</p>
              )}
              {result.fillsGap && <p style={{ color: "var(--naia-accent)", marginTop: "8px" }}>✓ {result.fillsGap}</p>}
            </ResultBlock>
            {result.naiaMatch && (
              <ResultBlock label="Pair It With From nAia">
                <div className="bos-naia-title">{typeof result.naiaMatch === "object" ? result.naiaMatch.title : result.naiaMatch}</div>
                {typeof result.naiaMatch === "object" && result.naiaMatch.reason && (
                  <div className="bos-naia-reason">{result.naiaMatch.reason}</div>
                )}
                {typeof result.naiaMatch === "object" && result.naiaMatch.url && (
                  <a href={result.naiaMatch.url} target="_blank" rel="noreferrer" className="bos-naia-link">Shop This Piece →</a>
                )}
              </ResultBlock>
            )}
            {result.occasions?.length > 0 && (
              <ResultBlock label="Perfect For">
                <div className="bos-occasions">
                  {result.occasions.map((occ: string, i: number) => (
                    <span key={i} className="bos-occasion-tag">{occ}</span>
                  ))}
                </div>
              </ResultBlock>
            )}
          </div>

          <div style={{ marginTop: "32px", display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <button type="button" className="sp-btn-outline" onClick={reset}>Assess Another Piece</button>
          </div>
        </section>
      )}
    </MyNaiaLayout>
  );
}
