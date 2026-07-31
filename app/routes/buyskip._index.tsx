import * as React from "react";
import { Link, type LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";

export function meta() {
  return [{ title: "Buy or Skip | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCurrentNaiaCustomer(request);
  return {};
}

const css = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--c-bg);color:var(--c-ink);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .bs-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid var(--c-border)}
  .bs-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--c-ink)}
  .bs-topbar-link{font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--c-burg);text-decoration:none}
  .bs-wrap{max-width:900px;margin:0 auto;padding:60px 40px}
  .bs-headline{font-family:var(--ff-display);font-size:clamp(36px,5vw,56px);font-weight:900;font-style:italic;color:var(--c-ink);margin-bottom:8px}
  .bs-sub{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--c-muted);margin-bottom:48px;line-height:1.6}
  .bs-pill{padding:10px 18px;border:1px solid var(--c-border);font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--c-ink);cursor:pointer;background:transparent;transition:all .2s}
  .bs-pill:hover{border-color:var(--c-ink)}
  .bs-pill.on{background:var(--c-burg);color:#FAF6F1;border-color:var(--c-burg)}
  .bs-pill:disabled{opacity:.35;cursor:not-allowed}
  .bs-label{font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--c-muted);margin-bottom:12px;display:block}
  .bs-input{width:100%;padding:14px;border:1px solid var(--c-border);font-family:var(--ff-ui);font-size:16px;font-style:normal;background:var(--c-surface);color:var(--c-ink);outline:none}
  .bs-input:focus{border-color:var(--c-ink)}
  .bs-btn{padding:16px 40px;border:none;background:var(--c-burg);color:#FAF6F1;font-family:var(--ff-ui);font-size:10px;letter-spacing:4px;text-transform:uppercase;cursor:pointer}
  .bs-btn:disabled{background:var(--c-muted-bg);color:var(--c-muted);opacity:.65;cursor:not-allowed}
  .bs-btn-outline{padding:14px 32px;border:1px solid var(--c-border);background:transparent;font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--c-ink);cursor:pointer}
  .bs-two-col{display:grid;grid-template-columns:1fr 1fr;gap:48px}
  @media(max-width:640px){
    .bs-topbar{padding:16px 20px}
    .bs-wrap{padding:40px 20px}
    .bs-two-col{grid-template-columns:1fr;gap:32px}
  }
`;

export default function BuyOrSkip() {
  const [step, setStep] = React.useState("upload");
  const [imageUrl, setImageUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [category, setCategory] = React.useState("");
  const [color, setColor] = React.useState<string[]>([]);
  const [brand, setBrand] = React.useState("");
  const [itemLink, setItemLink] = React.useState("");
  const [uploadError, setUploadError] = React.useState("");
  const [analyzeError, setAnalyzeError] = React.useState("");
  const [closetItemCount, setClosetItemCount] = React.useState(0);
  const [eligibleClosetItemCount, setEligibleClosetItemCount] = React.useState(0);
  const CATEGORIES = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory", "Jewelry"];
  const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver"];

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
      const sigRes = await fetch("/api/cloudinary-signature", {
        credentials: "same-origin",
      });
      if (sigRes.status === 401) {
        setUploadError("Your session has expired. Please sign in again to continue.");
        return;
      }
      if (!sigRes.ok) {
        setUploadError("Upload service unavailable. Please try again.");
        return;
      }
      const { signature, timestamp, apiKey, cloudName, assetFolder, uploadPreset, allowedFormats } = await sigRes.json();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", uploadPreset);
      formData.append("api_key", apiKey);
      formData.append("timestamp", String(timestamp));
      formData.append("signature", signature);
      formData.append("asset_folder", assetFolder);
      formData.append("allowed_formats", allowedFormats);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: formData });
      const uploadData = await res.json();
      if (!uploadData.secure_url) {
        const cloudMsg = typeof uploadData?.error?.message === "string" ? uploadData.error.message : null;
        setUploadError(cloudMsg ? `Upload failed: ${cloudMsg}` : "Upload failed. Please try another photo.");
        return;
      }
      setImageUrl(uploadData.secure_url);
      setStep("tag");
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadError("Upload failed. Please try again.");
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
        body: JSON.stringify({ imageUrl, category, color, brand, itemLink })
      });
      if (response.status === 401) {
        setAnalyzeError("Your session has expired. Please sign in again to continue.");
        return;
      }
      const data = await response.json();
      if (data.success) {
        const a = data.analysis;
        setClosetItemCount(typeof data.closetItemCount === "number" ? data.closetItemCount : 0);
        setEligibleClosetItemCount(typeof data.eligibleClosetItemCount === "number" ? data.eligibleClosetItemCount : 0);
        setResult({
          verdict: a.verdict,
          confidence: a.confidence,
          styleAlignment: a.styleDNAMatch,
          details: a.detailedAnalysis,
          closetPairings: a.closetPairings || [],
          fillsGap: a.fillsGap,
          naiaMatch: a.naiaMatch,
          occasions: a.occasions || [],
          finalThought: a.finalThought
        });
        setStep("result");
      } else {
        setResult({ verdict: "ERROR", confidence: 0, finalThought: "Unable to analyze. Please try another photo." });
        setStep("result");
      }
    } catch (err) {
      setResult({ verdict: "ERROR", confidence: 0, finalThought: "Analysis failed. Please try again." });
      setStep("result");
    } finally { setAnalyzing(false); }
  };

  const reset = () => {
    setImageUrl(""); setResult(null); setCategory(""); setColor([]); setBrand(""); setItemLink("");
    setUploadError(""); setAnalyzeError(""); setClosetItemCount(0); setEligibleClosetItemCount(0);
    setStep("upload");
  };

  const labelStyle: React.CSSProperties = { fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "12px", display: "block" };
  const pillStyle = (active: boolean): React.CSSProperties => ({ padding: "10px 18px", border: active ? "none" : "1px solid var(--c-border)", fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: active ? "#FAF6F1" : "var(--c-ink)", cursor: "pointer", background: active ? "var(--c-burg)" : "transparent", transition: "all .2s" });

  const renderablePairings: Array<{ name: string; reason: string | null }> = [];
  if (result?.closetPairings && Array.isArray(result.closetPairings)) {
    for (const p of result.closetPairings) {
      if (p === null || typeof p !== "object" || Array.isArray(p)) continue;
      const name = typeof p.name === "string" && p.name.trim() !== "" ? p.name.trim() : null;
      if (!name) continue;
      const reason = typeof p.reason === "string" && p.reason.trim() !== "" ? p.reason.trim() : null;
      renderablePairings.push({ name, reason });
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)" }}>
      <style>{css}</style>

      <div className="bs-topbar">
        <div className="bs-topbar-logo">nAia</div>
        <Link to="/my-naia" className="bs-topbar-link">← Overview</Link>
      </div>

      <div className="bs-wrap">
        <h1 className="bs-headline">Buy or Skip?</h1>
        <p className="bs-sub">Thinking of buying something? Upload it and nAia will tell you if it fits your wardrobe, style, and lifestyle.</p>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div style={{ background: "var(--c-panel)", border: "1px solid var(--c-border)", padding: "60px 48px", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "20px" }}>UPLOAD A PHOTO</div>
            <p style={{ fontFamily: "var(--ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--c-muted)", lineHeight: 1.6, marginBottom: "32px" }}>
              Take a photo in store, upload a screenshot, or save a product image from any website.
            </p>
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} style={{ display: "none" }} id="bsInput" />
            <label htmlFor="bsInput" style={{ display: "inline-block", padding: "16px 40px", background: "var(--c-burg)", color: "#FAF6F1", fontFamily: "var(--ff-ui)", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>
              {uploading ? "UPLOADING..." : "CHOOSE PHOTO"}
            </label>
            {uploadError && <p style={{ fontFamily: "var(--ff-ui)", fontSize: "11px", letterSpacing: "1px", color: "var(--c-burg)", marginTop: "12px" }}>{uploadError}</p>}
          </div>
        )}

        {/* Step 2: Tag */}
        {step === "tag" && (
          <div className="bs-two-col">
            <div>
              <img src={imageUrl} alt="Item" style={{ width: "100%", border: "1px solid var(--c-border)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <div>
                <h2 style={{ fontFamily: "var(--ff-display)", fontSize: "24px", fontWeight: 900, fontStyle: "italic", marginBottom: "8px" }}>Tell us about this piece</h2>
                <p style={{ fontFamily: "var(--ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--c-muted)" }}>Help nAia understand what it is</p>
              </div>

              <div>
                <span style={labelStyle}>Category *</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {CATEGORIES.map(c => <button key={c} onClick={() => setCategory(c)} style={pillStyle(category === c)}>{c}</button>)}
                </div>
              </div>

              <div>
                <span style={labelStyle}>Color * (choose all that apply)</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {COLORS.map(c => <button key={c} onClick={() => setColor(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])} style={pillStyle(color.includes(c))}>{c}</button>)}
                </div>
              </div>

              <div>
                <span style={labelStyle}>Brand (optional)</span>
                <input className="bs-input" type="text" placeholder="e.g. Zara, H&M" value={brand} onChange={e => setBrand(e.target.value)} />
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={reset} className="bs-btn-outline">← Back</button>
                <button onClick={handleAnalyze} disabled={!category || color.length === 0 || analyzing} className="bs-btn" style={{ flex: 1, background: (!category || color.length === 0) ? "var(--c-muted-bg)" : "var(--c-burg)" }}>
                  {analyzing ? "ANALYZING..." : "ANALYZE →"}
                </button>
              </div>
              {analyzeError && (
                <p style={{ fontFamily: "var(--ff-ui)", fontSize: "11px", letterSpacing: "1px", color: "var(--c-burg)", marginTop: "4px" }}>
                  {analyzeError}{" "}
                  <a href="/auth/shopify/login?return_to=/buyskip" style={{ color: "var(--c-burg)", textDecoration: "underline" }}>Sign in →</a>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === "result" && result && (
          <div className="bs-two-col">
            <div>
              <img src={imageUrl} alt="Item" style={{ width: "100%", border: "1px solid var(--c-border)", marginBottom: "16px" }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {category && <span style={pillStyle(true)}>{category}</span>}
                {color.map(c => <span key={c} style={pillStyle(true)}>{c}</span>)}
                {brand && <span style={pillStyle(false)}>{brand}</span>}
              </div>
            </div>

            <div style={{ background: "var(--c-panel)", padding: "40px", border: "1px solid var(--c-border)" }}>
              <div style={{ fontFamily: "var(--ff-display)", fontSize: "64px", fontWeight: 900, color: result.verdict === "BUY" ? "var(--c-burg)" : "var(--c-muted)", marginBottom: "4px" }}>{result.verdict}</div>
              <div style={{ fontFamily: "var(--ff-ui)", fontSize: "10px", color: "var(--c-muted)", marginBottom: "32px", letterSpacing: "1px" }}>{result.confidence}% CONFIDENCE</div>

              {result.styleAlignment && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid var(--c-border)" }}>
                  <div style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "10px" }}>STYLE DNA MATCH</div>
                  <div style={{ fontFamily: "var(--ff-body)", fontSize: "16px", fontStyle: "italic", color: "var(--c-ink)", lineHeight: 1.7 }}>{result.styleAlignment}</div>
                </div>
              )}

              {result.details && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid var(--c-border)" }}>
                  <div style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "10px" }}>ANALYSIS</div>
                  <div style={{ fontFamily: "var(--ff-body)", fontSize: "15px", color: "var(--c-ink)", lineHeight: 1.8 }}>
                    {result.details.silhouette && <div style={{ marginBottom: "6px" }}><strong>Silhouette:</strong> {result.details.silhouette}</div>}
                    {result.details.color && <div style={{ marginBottom: "6px" }}><strong>Color:</strong> {result.details.color}</div>}
                    {result.details.fabric && <div style={{ marginBottom: "6px" }}><strong>Fabric:</strong> {result.details.fabric}</div>}
                    {result.details.versatility && <div><strong>Versatility:</strong> {result.details.versatility}</div>}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid var(--c-border)" }}>
                <div style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "10px" }}>PAIRS WITH YOUR CLOSET</div>
                {renderablePairings.length > 0 ? (
                  <div>
                    {renderablePairings.map((p, i) => (
                      <div key={i} style={{ fontFamily: "var(--ff-body)", fontSize: "15px", color: "var(--c-ink)", lineHeight: 1.8, marginBottom: "6px" }}>
                        <strong>{p.name}</strong>
                        {p.reason !== null && <span style={{ color: "var(--c-muted)" }}> — {p.reason}</span>}
                      </div>
                    ))}
                  </div>
                ) : closetItemCount > 0 && eligibleClosetItemCount === 0 ? (
                  <div style={{ fontFamily: "var(--ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--c-muted)" }}>
                    You already have pieces in your Closet, but nAia could not find a clear pairing for this item yet.
                  </div>
                ) : (
                  <div style={{ fontFamily: "var(--ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--c-muted)" }}>
                    No closet items yet.{" "}
                    <a href="/closet" style={{ color: "var(--c-burg)", textDecoration: "none" }}>Add pieces to your wardrobe</a>
                    {" "}and nAia will tell you what this pairs with.
                  </div>
                )}
                {result.fillsGap && <div style={{ color: "var(--c-burg)", fontFamily: "var(--ff-body)", fontSize: "14px", fontStyle: "italic", marginTop: "8px" }}>✓ {result.fillsGap}</div>}
              </div>

              {result.naiaMatch && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid var(--c-border)" }}>
                  <div style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "10px" }}>PAIR IT WITH FROM NAIA</div>
                  <div style={{ fontFamily: "var(--ff-display)", fontSize: "18px", fontWeight: 700, color: "var(--c-ink)", marginBottom: "6px" }}>
                    {typeof result.naiaMatch === "object" ? result.naiaMatch.title : result.naiaMatch}
                  </div>
                  {typeof result.naiaMatch === "object" && result.naiaMatch.reason && (
                    <div style={{ fontFamily: "var(--ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--c-muted)", marginBottom: "10px" }}>{result.naiaMatch.reason}</div>
                  )}
                  {typeof result.naiaMatch === "object" && result.naiaMatch.url && (
                    <a href={result.naiaMatch.url} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-burg)", textDecoration: "none" }}>SHOP THIS PIECE →</a>
                  )}
                </div>
              )}

              {result.occasions?.length > 0 && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid var(--c-border)" }}>
                  <div style={{ fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--c-muted)", marginBottom: "10px" }}>PERFECT FOR</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {result.occasions.map((occ: string, i: number) => <span key={i} style={{ padding: "6px 12px", background: "var(--c-tint)", color: "var(--c-burg)", fontSize: "11px", fontFamily: "var(--ff-ui)" }}>{occ}</span>)}
                  </div>
                </div>
              )}

              {result.finalThought && (
                <div style={{ marginBottom: "32px" }}>
                  <div style={{ fontFamily: "var(--ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--c-ink)", lineHeight: 1.7 }}>{result.finalThought}</div>
                </div>
              )}

              <button onClick={reset} style={{ width: "100%", padding: "14px", background: "transparent", border: "1px solid var(--c-burg)", color: "var(--c-burg)", fontFamily: "var(--ff-ui)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>
                TRY ANOTHER
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
