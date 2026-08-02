import * as React from "react";
import { Link, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

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

const CATEGORIES = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory", "Jewelry"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver"];

// ── Component ────────────────────────────────────────────────────────────────

export default function BuyOrSkip() {
  const [step, setStep] = React.useState<"upload" | "tag" | "result">("upload");

  // Upload
  const [imageUrl, setImageUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState("");

  // Tag form
  const [category, setCategory] = React.useState("");
  const [color, setColor] = React.useState<string[]>([]);
  const [brand, setBrand] = React.useState("");
  const [itemLink, setItemLink] = React.useState("");
  const [forOccasion, setForOccasion] = React.useState("");
  const [whatLike, setWhatLike] = React.useState("");
  const [unsureAbout, setUnsureAbout] = React.useState("");
  const [colorNote, setColorNote] = React.useState("");
  const [size, setSize] = React.useState("");

  // Result
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState("");
  const [result, setResult] = React.useState<{
    verdict: string; confidence: number; styleAlignment?: string;
    details?: { silhouette?: string; color?: string; fabric?: string; versatility?: string };
    closetPairings?: Array<{ name?: string; reason?: string } | string>;
    fillsGap?: string; naiaMatch?: string | { title: string; reason?: string; url?: string };
    occasions?: string[]; finalThought?: string;
  } | null>(null);

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
      setStep("tag");
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
        body: JSON.stringify({ imageUrl, category, color, brand, itemLink, forOccasion, whatLike, unsureAbout, colorNote, size }),
      });
      if (response.status === 401) {
        setAnalyzeError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await response.json();
      if (data.success) {
        const a = data.analysis;
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
        setStep("result");
      } else {
        setResult({ verdict: "UNABLE TO ASSESS", confidence: 0, finalThought: "Unable to analyse. Please try another photo." });
        setStep("result");
      }
    } catch {
      setResult({ verdict: "ERROR", confidence: 0, finalThought: "Analysis failed. Please try again." });
      setStep("result");
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setImageUrl(""); setUploading(false); setUploadError("");
    setCategory(""); setColor([]); setBrand(""); setItemLink("");
    setForOccasion(""); setWhatLike(""); setUnsureAbout(""); setColorNote(""); setSize("");
    setAnalyzing(false); setAnalyzeError(""); setResult(null);
  };

  const verdictClass = result?.verdict === "BUY"
    ? "bos-verdict-big bos-verdict-big--buy"
    : result?.verdict === "SKIP"
    ? "bos-verdict-big bos-verdict-big--skip"
    : "bos-verdict-big bos-verdict-big--other";

  const renderablePairings: Array<{ name: string; reason: string | null }> = [];
  if (result?.closetPairings && Array.isArray(result.closetPairings)) {
    for (const p of result.closetPairings) {
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      const name = typeof (p as { name?: string }).name === "string" && (p as { name?: string }).name!.trim()
        ? (p as { name: string }).name.trim() : null;
      if (!name) continue;
      const reason = typeof (p as { reason?: string }).reason === "string" && (p as { reason?: string }).reason!.trim()
        ? (p as { reason: string }).reason.trim() : null;
      renderablePairings.push({ name, reason });
    }
  }

  const canAnalyze = category && color.length > 0 && !analyzing;

  return (
    <div className="bos-page">
      {/* Topbar */}
      <div className="bos-topbar">
        <span className="bos-topbar-logo">nAia</span>
        <Link to="/my-naia" className="bos-topbar-link">← Overview</Link>
      </div>

      <div className="bos-content">
        <h1 className="bos-headline">Buy or Skip?</h1>
        <p className="bos-sub">
          Thinking of buying something? Upload it and nAia will tell you if it fits your
          wardrobe, style, and lifestyle.
        </p>

        {/* ── Step 1 — Upload ──────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="bos-upload-zone">
            <input
              type="file"
              accept="image/*"
              id="bos-file"
              onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
            <label htmlFor="bos-file" className={`bos-upload-cta${uploading ? " bos-upload-cta--loading" : ""}`}>
              {uploading ? "Uploading…" : "Choose Photo"}
            </label>
            <p className="bos-upload-hint">Upload a photo of the item you're thinking of buying</p>
            {uploadError && <p className="bos-upload-error">{uploadError}</p>}
          </div>
        )}

        {/* ── Step 2 — Tag ─────────────────────────────────────────────────── */}
        {step === "tag" && (
          <div className="bos-split">
            {/* Left — image preview */}
            <div className="bos-split-image">
              <img src={imageUrl} alt="Item to assess" />
            </div>

            {/* Right — form */}
            <div className="bos-split-panel">
              <div>
                <div className="bos-panel-heading">Tell us about this piece</div>
                <div className="bos-panel-sub">Help nAia understand what it is</div>
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">What are you considering it for?</label>
                <input className="bos-input" type="text" value={forOccasion} onChange={e => setForOccasion(e.target.value)} placeholder="e.g. Evening dinners in Beirut" />
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">What do you like about it?</label>
                <input className="bos-input" type="text" value={whatLike} onChange={e => setWhatLike(e.target.value)} placeholder="e.g. The neckline and the drape" />
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">What are you unsure about?</label>
                <input className="bos-input" type="text" value={unsureAbout} onChange={e => setUnsureAbout(e.target.value)} placeholder="e.g. Whether it duplicates something I own" />
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">Which colour are you considering?</label>
                <input className="bos-input" type="text" value={colorNote} onChange={e => setColorNote(e.target.value)} placeholder="e.g. Ivory" />
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">Which size?</label>
                <input className="bos-input" type="text" value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. M" />
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">Category *</label>
                <div className="bos-pills">
                  {CATEGORIES.map(c => (
                    <button key={c} type="button"
                      className={`bos-pill${category === c ? " bos-pill--on" : ""}`}
                      onClick={() => setCategory(c)}>{c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">Colour * (choose all that apply)</label>
                <div className="bos-pills">
                  {COLORS.map(c => (
                    <button key={c} type="button"
                      className={`bos-pill${color.includes(c) ? " bos-pill--on" : ""}`}
                      onClick={() => setColor(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}>{c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">Brand (optional)</label>
                <input className="bos-input" type="text" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Zara, H&M" />
              </div>

              <div className="bos-panel-section">
                <label className="bos-field-label">Product Link (optional)</label>
                <input className="bos-input" type="text" value={itemLink} onChange={e => setItemLink(e.target.value)} placeholder="e.g. https://zara.com/..." />
              </div>

              {analyzeError && <p className="bos-analyze-error">{analyzeError}</p>}

              <div className="bos-panel-nav">
                <button type="button" className="bos-btn-back" onClick={reset}>← Back</button>
                <button type="button" className="bos-btn-analyze"
                  disabled={!canAnalyze}
                  onClick={handleAnalyze}>
                  {analyzing ? "Analysing…" : "Analyse →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3 — Result ──────────────────────────────────────────────── */}
        {step === "result" && result && (
          <div className="bos-split">
            {/* Left — image + tag chips */}
            <div className="bos-split-image">
              <img src={imageUrl} alt="Assessed item" />
              <div className="bos-tag-chips">
                {category && <span className="bos-tag-chip-a">{category}</span>}
                {color.map(c => <span key={c} className="bos-tag-chip-a">{c}</span>)}
                {brand && <span className="bos-tag-chip-n">{brand}</span>}
              </div>
            </div>

            {/* Right — verdict panel */}
            <div className="bos-verdict-panel">
              <div className={verdictClass}>{result.verdict}</div>
              {result.confidence > 0 && (
                <div className="bos-confidence-label">{result.confidence}% confidence</div>
              )}

              {result.finalThought && (
                <div className="bos-analysis-block">
                  <div className="bos-analysis-block-body" style={{ fontStyle: "normal" }}>
                    {result.finalThought}
                  </div>
                </div>
              )}

              {result.styleAlignment && (
                <div className="bos-analysis-block">
                  <div className="bos-analysis-block-label">Style DNA Match</div>
                  <div className="bos-analysis-block-body">{result.styleAlignment}</div>
                </div>
              )}

              {result.details && (
                <div className="bos-analysis-block">
                  <div className="bos-analysis-block-label">Analysis</div>
                  <div className="bos-analysis-block-body">
                    {result.details.silhouette && <div><strong>Silhouette:</strong> {result.details.silhouette}</div>}
                    {result.details.color && <div><strong>Colour:</strong> {result.details.color}</div>}
                    {result.details.fabric && <div><strong>Fabric:</strong> {result.details.fabric}</div>}
                    {result.details.versatility && <div><strong>Versatility:</strong> {result.details.versatility}</div>}
                  </div>
                </div>
              )}

              {(renderablePairings.length > 0 || result.fillsGap) && (
                <div className="bos-analysis-block">
                  <div className="bos-analysis-block-label">Pairs With Your Closet</div>
                  <div className="bos-analysis-block-body">
                    {renderablePairings.length > 0 ? (
                      <ul className="bos-result-reasons">
                        {renderablePairings.map((p, i) => (
                          <li key={i} className="bos-result-reason">
                            <span className="bos-result-reason-dash" aria-hidden />
                            <span><strong>{p.name}</strong>{p.reason && <span> — {p.reason}</span>}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span>No closet items yet. <Link to="/closet">Add pieces to your wardrobe</Link> and nAia will tell you what this pairs with.</span>
                    )}
                    {result.fillsGap && <p style={{ color: "var(--naia-accent)", marginTop: "8px" }}>✓ {result.fillsGap}</p>}
                  </div>
                </div>
              )}

              {result.naiaMatch && (
                <div className="bos-analysis-block">
                  <div className="bos-analysis-block-label">Pair It With From nAia</div>
                  <div className="bos-naia-title">
                    {typeof result.naiaMatch === "object" ? result.naiaMatch.title : result.naiaMatch}
                  </div>
                  {typeof result.naiaMatch === "object" && result.naiaMatch.reason && (
                    <div className="bos-naia-reason">{result.naiaMatch.reason}</div>
                  )}
                  {typeof result.naiaMatch === "object" && result.naiaMatch.url && (
                    <a href={result.naiaMatch.url} target="_blank" rel="noreferrer" className="bos-naia-link">Shop This Piece →</a>
                  )}
                </div>
              )}

              {result.occasions && result.occasions.length > 0 && (
                <div className="bos-analysis-block">
                  <div className="bos-analysis-block-label">Perfect For</div>
                  <div className="bos-occasions">
                    {result.occasions.map((occ, i) => (
                      <span key={i} className="bos-occasion-tag">{occ}</span>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" className="bos-try-again" onClick={reset}>
                Try Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
