import { useLoaderData, useFetcher, Link } from "react-router";
import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState } from "react";
import prisma from "../db.server";

const CLOUDINARY_CLOUD = "diybves1z";
const CLOUDINARY_PRESET = "kqfhwrpq";

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await prisma.customer.findFirst({
    where: { shopifyCustomerId: "guest" },
    include: { onboardingProfile: true }
  });
  
  return data({ 
    customer,
    styleDNA: customer?.onboardingProfile?.stylePersonalities || [],
    favoriteColors: customer?.onboardingProfile?.favoriteColors || []
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const imageUrl = formData.get("imageUrl") as string;
  const itemDescription = formData.get("itemDescription") as string;
  
  const customer = await prisma.customer.findFirst({
    where: { shopifyCustomerId: "guest" },
    include: { onboardingProfile: true }
  });
  
  const profile = customer?.onboardingProfile;
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  const prompt = `You are nAia, a fashion AI stylist. Analyze this clothing item and determine if it fits the user's style DNA.

USER'S STYLE DNA:
- Style Personalities: ${profile?.stylePersonalities?.join(", ") || "Not specified"}
- Favorite Colors: ${profile?.favoriteColors?.join(", ") || "Not specified"}
- Lifestyle: ${profile?.lifestyle || "Not specified"}
- Desired Feeling: ${profile?.desiredFeeling || "Not specified"}

ITEM TO ANALYZE:
${itemDescription ? `Description: ${itemDescription}` : ""}
Image URL: ${imageUrl}

Provide a recommendation in this EXACT JSON format (no markdown, just raw JSON):
{
  "verdict": "BUY" or "SKIP",
  "confidence": number 1-100,
  "reasoning": "2-3 sentences explaining why this fits or doesn't fit their style DNA",
  "styleAlignment": {
    "matches": ["aspect 1", "aspect 2"],
    "conflicts": ["aspect 1", "aspect 2"]
  },
  "stylingTips": "If BUY: 1-2 sentences on how to style it. If SKIP: suggest what to look for instead."
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "url",
                url: imageUrl
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }]
      })
    });
    
    const result = await response.json();
    const analysisText = result.content?.[0]?.text || "{}";
    const analysis = JSON.parse(analysisText);
    
    return data({ success: true, analysis });
  } catch (error: any) {
    console.error("Analysis error:", error);
    return data({ error: error.message }, { status: 500 });
  }
}

export default function BuySkip() {
  const { styleDNA, favoriteColors } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  
  const [imageUrl, setImageUrl] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  
  const analysis = fetcher.data?.analysis;
  const isAnalyzing = fetcher.state === "submitting";

  const uploadToCloudinary = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_PRESET);
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setImageUrl(data.secure_url);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = () => {
    fetcher.submit(
      { imageUrl, itemDescription },
      { method: "post" }
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "60px 40px" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "60px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(48px,6vw,72px)", fontWeight: 900, lineHeight: 1, marginBottom: "16px" }}>
              Buy or Skip
            </h1>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "24px", fontStyle: "italic", color: "#7a6f6a" }}>
              Upload a piece. nAia tells you if it belongs.
            </p>
          </div>
          <Link to="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none", position: "absolute", right: "40px", top: "60px" }}>
            ← DASHBOARD
          </Link>
        </div>

        {styleDNA.length > 0 && (
          <div style={{ background: "rgba(139,32,53,0.05)", padding: "24px", marginBottom: "40px", border: "1px solid rgba(139,32,53,0.1)" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>YOUR STYLE DNA</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {styleDNA.map((trait: string, i: number) => (
                <span key={i} style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516", padding: "4px 12px", background: "rgba(255,255,255,0.6)", border: "1px solid rgba(59,5,16,0.1)" }}>
                  {trait.charAt(0).toUpperCase() + trait.slice(1)}
                </span>
              ))}
              {favoriteColors.map((color: string, i: number) => (
                <span key={`color-${i}`} style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516", padding: "4px 12px", background: "rgba(255,255,255,0.6)", border: "1px solid rgba(59,5,16,0.1)" }}>
                  {color}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: "rgba(255,255,255,0.8)", padding: "40px", marginBottom: "40px", border: "1px solid rgba(59,5,16,0.06)" }}>
          
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>UPLOAD PHOTO *</div>
            <label style={{ display: "block", border: imageUrl ? "none" : "2px dashed rgba(59,5,16,0.2)", padding: "60px", textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.5)" }}>
              {imageUrl ? (
                <img src={imageUrl} alt="Item to analyze" style={{ maxHeight: "400px", maxWidth: "100%", objectFit: "contain" }} />
              ) : uploading ? (
                <div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", marginBottom: "16px", opacity: 0.2 }}>◇</div>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a" }}>Uploading...</span>
                </div>
              ) : (
                <div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "64px", marginBottom: "16px", opacity: 0.2 }}>◇</div>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>Click to upload a photo</span>
                  <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", color: "#7a6f6a", marginTop: "12px" }}>Take a photo or screenshot of the piece you're considering</p>
                </div>
              )}
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])} style={{ display: "none" }} />
            </label>
            {imageUrl && (
              <button onClick={() => setImageUrl("")} style={{ marginTop: "16px", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", background: "none", border: "none", cursor: "pointer" }}>
                ← Upload Different Photo
              </button>
            )}
          </div>

          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>ITEM DETAILS (OPTIONAL)</div>
            <textarea 
              placeholder="e.g. Black silk blazer from Zara, oversized fit, $89"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              style={{ width: "100%", padding: "16px", border: "1px solid rgba(59,5,16,0.1)", fontSize: "16px", fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", boxSizing: "border-box", background: "rgba(255,255,255,0.7)", minHeight: "100px", resize: "vertical" }}
            />
          </div>

          <button 
            onClick={handleAnalyze}
            disabled={!imageUrl || uploading || isAnalyzing}
            style={{ width: "100%", padding: "20px", background: imageUrl && !uploading && !isAnalyzing ? "#8b2035" : "#d4cfc9", color: "#f4f4f1", border: "none", fontSize: "14px", letterSpacing: "2px", textTransform: "uppercase", cursor: imageUrl && !uploading && !isAnalyzing ? "pointer" : "default", fontFamily: "'Space Mono',monospace" }}
          >
            {isAnalyzing ? "Analyzing..." : "Analyze This Piece"}
          </button>
        </div>

        {analysis && (
          <div style={{ background: analysis.verdict === "BUY" ? "rgba(76,175,80,0.05)" : "rgba(244,67,54,0.05)", padding: "40px", border: `2px solid ${analysis.verdict === "BUY" ? "rgba(76,175,80,0.3)" : "rgba(244,67,54,0.3)"}` }}>
            
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "72px", fontWeight: 900, color: analysis.verdict === "BUY" ? "#4caf50" : "#f44336", marginBottom: "8px" }}>
                {analysis.verdict}
              </div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>
                {analysis.confidence}% CONFIDENCE
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>WHY</div>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", lineHeight: 1.6, fontStyle: "italic", color: "#221516" }}>
                {analysis.reasoning}
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "32px" }}>
              {analysis.styleAlignment?.matches?.length > 0 && (
                <div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#4caf50", marginBottom: "12px" }}>✓ MATCHES YOUR STYLE</div>
                  <ul style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516", paddingLeft: "20px" }}>
                    {analysis.styleAlignment.matches.map((match: string, i: number) => (
                      <li key={i}>{match}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.styleAlignment?.conflicts?.length > 0 && (
                <div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#f44336", marginBottom: "12px" }}>✗ CONFLICTS</div>
                  <ul style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516", paddingLeft: "20px" }}>
                    {analysis.styleAlignment.conflicts.map((conflict: string, i: number) => (
                      <li key={i}>{conflict}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>
                {analysis.verdict === "BUY" ? "HOW TO STYLE IT" : "WHAT TO LOOK FOR INSTEAD"}
              </div>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", lineHeight: 1.6, fontStyle: "italic", color: "#221516" }}>
                {analysis.stylingTips}
              </p>
            </div>

            <button 
              onClick={() => { setImageUrl(""); setItemDescription(""); }}
              style={{ marginTop: "32px", width: "100%", padding: "16px", background: "rgba(255,255,255,0.8)", color: "#221516", border: "1px solid rgba(59,5,16,0.1)", fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Space Mono',monospace" }}
            >
              Analyze Another Piece
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
