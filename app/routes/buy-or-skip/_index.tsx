import * as React from "react";
import { Link } from "react-router";

export async function loader() {
  return {};
}

const CLOUDINARY_CLOUD = "diybves1z";
const CLOUDINARY_PRESET = "kqfhwrpq";

const css = `
  :root{--cream:#f4f4f1;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .bs-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .bs-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .bs-topbar-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .bs-wrap{max-width:900px;margin:0 auto;padding:60px 40px}
  .bs-headline{font-family:var(--ff-display);font-size:clamp(36px,5vw,56px);font-weight:900;font-style:italic;color:var(--deep);margin-bottom:8px}
  .bs-sub{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--muted);margin-bottom:48px;line-height:1.6}
  .bs-pill{padding:10px 18px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;background:transparent;transition:all .2s}
  .bs-pill:hover{border-color:var(--deep)}
  .bs-pill.on{background:var(--accent);color:var(--cream);border-color:var(--accent)}
  .bs-pill:disabled{opacity:.35;cursor:not-allowed}
  .bs-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:12px;display:block}
  .bs-input{width:100%;padding:14px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-body);font-size:16px;font-style:italic;background:rgba(255,255,255,0.7);color:var(--deep);outline:none}
  .bs-input:focus{border-color:var(--deep)}
  .bs-btn{padding:16px 40px;border:none;background:var(--accent);color:var(--cream);font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;cursor:pointer}
  .bs-btn:disabled{background:#d4cfc9;cursor:not-allowed}
  .bs-btn-outline{padding:14px 32px;border:1px solid rgba(59,5,16,.12);background:transparent;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer}
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

  const CATEGORIES = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory", "Jewelry"];
  const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver"];

  const handleUpload = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_PRESET);
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: "POST", body: formData });
      const data = await res.json();
      setImageUrl(data.secure_url);
      setStep("tag");
    } catch (err) { console.error("Upload failed:", err); }
    finally { setUploading(false); }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const response = await fetch("/api/wishlist?action=analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, category, color, brand, itemLink })
      });
      const data = await response.json();
      if (data.success) {
        const a = data.analysis;
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
    setImageUrl(""); setResult(null); setCategory(""); setColor([]); setBrand(""); setItemLink(""); setStep("upload");
  };

  const labelStyle: React.CSSProperties = { fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px", display: "block" };
  const pillStyle = (active: boolean): React.CSSProperties => ({ padding: "10px 18px", border: active ? "none" : "1px solid rgba(59,5,16,.12)", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: active ? "#f4f4f1" : "#221516", cursor: "pointer", background: active ? "#8b2035" : "transparent", transition: "all .2s" });

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="bs-topbar">
        <div className="bs-topbar-logo">nAia</div>
        <Link to="/" className="bs-topbar-link">← Dashboard</Link>
      </div>

      <div className="bs-wrap">
        <h1 className="bs-headline">Buy or Skip?</h1>
        <p className="bs-sub">Thinking of buying something? Upload it and nAia will tell you if it fits your wardrobe, style, and lifestyle.</p>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)", padding: "60px", textAlign: "center" }}>
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} style={{ display: "none" }} id="bsInput" />
            <label htmlFor="bsInput" style={{ display: "inline-block", padding: "16px 40px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", marginBottom: "16px" }}>
              {uploading ? "UPLOADING..." : "CHOOSE PHOTO"}
            </label>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Upload a photo of the item you're thinking of buying</p>
          </div>
        )}

        {/* Step 2: Tag */}
        {step === "tag" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px" }}>
            <div>
              <img src={imageUrl} alt="Item" style={{ width: "100%", border: "1px solid rgba(59,5,16,0.06)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <div>
                <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "24px", fontWeight: 900, fontStyle: "italic", marginBottom: "8px" }}>Tell us about this piece</h2>
                <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>Help nAia understand what it is</p>
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

              <div>
                <span style={labelStyle}>Product Link (optional)</span>
                <input className="bs-input" type="text" placeholder="e.g. https://zara.com/..." value={itemLink} onChange={e => setItemLink(e.target.value)} />
                <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "13px", fontStyle: "italic", color: "#7a6f6a", marginTop: "6px" }}>Helps nAia understand the exact item</p>
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={reset} className="bs-btn-outline">← Back</button>
                <button onClick={handleAnalyze} disabled={!category || color.length === 0 || analyzing} className="bs-btn" style={{ flex: 1, background: (!category || color.length === 0) ? "#d4cfc9" : "#8b2035" }}>
                  {analyzing ? "ANALYZING..." : "ANALYZE →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === "result" && result && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px" }}>
            <div>
              <img src={imageUrl} alt="Item" style={{ width: "100%", border: "1px solid rgba(59,5,16,0.06)", marginBottom: "16px" }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {category && <span style={pillStyle(true)}>{category}</span>}
                {color.map(c => <span key={c} style={pillStyle(true)}>{c}</span>)}
                {brand && <span style={pillStyle(false)}>{brand}</span>}
              </div>
            </div>

            <div style={{ background: "rgba(255,255,255,0.8)", padding: "40px", border: "1px solid rgba(59,5,16,0.06)" }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "64px", fontWeight: 900, color: result.verdict === "BUY" ? "#8b2035" : "#7a6f6a", marginBottom: "4px" }}>{result.verdict}</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#7a6f6a", marginBottom: "32px", letterSpacing: "1px" }}>{result.confidence}% CONFIDENCE</div>

              {result.styleAlignment && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "10px" }}>STYLE DNA MATCH</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516", lineHeight: 1.7 }}>{result.styleAlignment}</div>
                </div>
              )}

              {result.details && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "10px" }}>ANALYSIS</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", color: "#221516", lineHeight: 1.8 }}>
                    {result.details.silhouette && <div style={{ marginBottom: "6px" }}><strong>Silhouette:</strong> {result.details.silhouette}</div>}
                    {result.details.color && <div style={{ marginBottom: "6px" }}><strong>Color:</strong> {result.details.color}</div>}
                    {result.details.fabric && <div style={{ marginBottom: "6px" }}><strong>Fabric:</strong> {result.details.fabric}</div>}
                    {result.details.versatility && <div><strong>Versatility:</strong> {result.details.versatility}</div>}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "10px" }}>PAIRS WITH YOUR CLOSET</div>
                {result.closetPairings?.length > 0 ? (
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", color: "#221516", lineHeight: 1.8 }}>{result.closetPairings.join(", ")}</div>
                ) : (
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>
                    No closet items yet.{" "}
                    <a href="/closet" style={{ color: "#8b2035", textDecoration: "none" }}>Add pieces to your wardrobe</a>
                    {" "}and nAia will tell you what this pairs with.
                  </div>
                )}
                {result.fillsGap && <div style={{ color: "#8b2035", fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", fontStyle: "italic", marginTop: "8px" }}>✓ {result.fillsGap}</div>}
              </div>

              {result.naiaMatch && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "10px" }}>PAIR IT WITH FROM NAIA</div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "18px", fontWeight: 700, color: "#221516", marginBottom: "6px" }}>
                    {typeof result.naiaMatch === "object" ? result.naiaMatch.title : result.naiaMatch}
                  </div>
                  {typeof result.naiaMatch === "object" && result.naiaMatch.reason && (
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "10px" }}>{result.naiaMatch.reason}</div>
                  )}
                  {typeof result.naiaMatch === "object" && result.naiaMatch.url && (
                    <a href={result.naiaMatch.url} target="_blank" rel="noreferrer" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>SHOP THIS PIECE →</a>
                  )}
                </div>
              )}

              {result.occasions?.length > 0 && (
                <div style={{ marginBottom: "24px", paddingBottom: "24px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "10px" }}>PERFECT FOR</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {result.occasions.map((occ: string, i: number) => <span key={i} style={{ padding: "6px 12px", background: "rgba(139,32,53,0.08)", color: "#8b2035", fontSize: "11px", fontFamily: "'Space Mono',monospace" }}>{occ}</span>)}
                  </div>
                </div>
              )}

              {result.finalThought && (
                <div style={{ marginBottom: "32px" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#221516", lineHeight: 1.7 }}>{result.finalThought}</div>
                </div>
              )}

              <button onClick={reset} style={{ width: "100%", padding: "14px", background: "transparent", border: "1px solid #8b2035", color: "#8b2035", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>
                TRY ANOTHER
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
