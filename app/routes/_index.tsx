import * as React from "react";
import { useLoaderData, Link, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Try to authenticate from Shopify cookie
  const { customer: authCustomer } = await authenticateCustomer(request);
  
  // Get customer from DB (authenticated or guest)
  const customerId = authCustomer?.shopifyCustomerId || "guest";
  const customer = await prisma.customer.findFirst({
    where: { shopifyCustomerId: customerId },
    include: {
      onboardingProfile: true,
      stylingSessions: { 
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { suggestions: true }
      },
      closetItems: { take: 20, orderBy: { createdAt: "desc" } },
      postOutfitReviews: { include: { session: true } },
      savedLooks: true
    }
  });

  if (!customer) {
  return redirect("/quick-style");
}

if (customer.shopifyCustomerId !== "guest" && !customer.onboardingProfile?.completed) {
  return redirect("/onboarding/step/1");
}

if (customer.stylingSessions.length === 0) {
  return redirect("/quick-style");
}

  const avgRating = customer.postOutfitReviews.length > 0
    ? (customer.postOutfitReviews.reduce((sum, r) => sum + r.overallReaction, 0) / customer.postOutfitReviews.length).toFixed(1)
    : "0";

  const quotes = [
    "Some days call for softness. Others for structure.",
    "Dress for the version of yourself you're becoming.",
    "Confidence begins in silhouette.",
    "Today asks for ease, not effort.",
    "Elegance is often restraint.",
    "Power can be quiet.",
    "A look can shift the way you move through the world.",
    "What you wear is how you greet the world.",
    "Style is the shape of your inner life.",
    "Becoming is a matter of small choices.",
    "The right outfit doesn't just cover you — it carries you.",
    "Dressing well is a form of self-respect.",
    "Your wardrobe is a conversation you have with yourself every morning.",
    "Wear what makes you feel like the best version of today.",
    "Style is not about what you own. It's about what you choose.",
    "The most powerful thing you can wear is intention.",
    "Effortless is the result of thought, not the absence of it.",
    "A great outfit begins with knowing how you want to feel.",
    "Fashion fades. The feeling you dress for stays.",
    "You don't need more clothes. You need the right ones.",
    "Dress for the energy you want to walk into the room with.",
    "Every outfit is a decision about who you are today.",
    "The way you dress is the first thing you say before you speak.",
    "Softness is not weakness. It is its own kind of power.",
    "The most elegant women dress for themselves first.",
    "Your style is not a trend. It is a language.",
    "Wear something today that makes you stand a little taller.",
    "Getting dressed is an act of becoming.",
    "A wardrobe built with intention never runs out of options.",
    "Style is remembering who you are, even on hard days.",
    "The best looks are the ones that feel like you — only more so."
  ];
  const dailyQuote = quotes[(new Date().getDate() - 1) % quotes.length];

  const profile = customer.onboardingProfile;

  // Today's style energy — based on today's session mood if exists
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todaySession = customer.stylingSessions.find((s: any) => new Date(s.createdAt) >= startOfDay);
  const todayStyleEnergy = todaySession
    ? [todaySession.currentMood, todaySession.desiredFeeling].filter(Boolean).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" → ")
    : null;

  // Style DNA - Show what they actually chose in onboarding
  let styleDNA = [];
  if (profile && profile.stylePersonalities && profile.stylePersonalities.length > 0) {
    // Their actual style choices - format properly (handle hyphens)
    styleDNA = profile.stylePersonalities.slice(0, 5).map((trait) => ({
      trait: trait.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    }));
  } else {
    // Fallback if no onboarding
    styleDNA = [
      { trait: "Complete onboarding" }
    ];
  }

  // Styling Identity - summary of their choices
  let stylingIdentity = "Complete your style profile";
  if (profile?.stylePersonalities && profile.stylePersonalities.length >= 2) {
    const top = profile.stylePersonalities.slice(0, 2).map((s: string) => 
      s.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    );
    stylingIdentity = `${top[0]} ${top[1]}`;
  } else if (profile?.stylePersonalities && profile.stylePersonalities.length === 1) {
    stylingIdentity = profile.stylePersonalities[0].split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  } else if (profile?.desiredFeeling) {
    stylingIdentity = profile.desiredFeeling;
  }


  // Fetch outfit reviews to calculate Style Response Profile
  const reviews = await prisma.postOutfitReview.findMany({
    where: { 
      session: { 
        customerId: customer.id 
      }
    },
    include: {
      session: true
    },
    orderBy: { createdAt: 'desc' }
  });

  // Calculate style response metrics
  const totalReviews = reviews.length;
  const feltLikeMeCount = reviews.filter(r => r.feltLikeHer === true).length;
  const wouldWearCount = reviews.filter(r => r.wouldWearAgain === true).length;
  const createdFeelingCount = reviews.filter(r => r.desiredFeelingAchieved === true).length;
  const styleAlignmentPercent = totalReviews > 0 ? Math.round((feltLikeMeCount / totalReviews) * 100) : 0;
  const wouldWearPercent = totalReviews > 0 ? Math.round((wouldWearCount / totalReviews) * 100) : 0;
  const feelingShiftPercent = totalReviews > 0 ? Math.round((createdFeelingCount / totalReviews) * 100) : 0;

  // Average comfort score
  const comfortScores = reviews.filter(r => r.physicallyComfortable).map(r => Number(r.physicallyComfortable));
  const avgComfort = comfortScores.length > 0 ? Math.round(comfortScores.reduce((a,b) => a+b, 0) / comfortScores.length * 10) / 10 : 0;

  // What works patterns
  const allWorkedTags: string[] = [];
  reviews.forEach(r => {
    if (r.workedTags) {
      try { const tags = JSON.parse(r.workedTags as string); allWorkedTags.push(...tags); } catch {}
    }
  });
  const workedCounts: { [key: string]: number } = {};
  allWorkedTags.forEach(tag => { workedCounts[tag] = (workedCounts[tag] || 0) + 1; });
  const topWorked = Object.entries(workedCounts).sort((a,b) => b[1]-a[1]).slice(0,5).map(([tag]) => tag);

  // What doesn't work patterns
  const allDidntWorkTags: string[] = [];
  reviews.forEach(r => {
    if (r.didntWorkTags) {
      try { const tags = JSON.parse(r.didntWorkTags as string); allDidntWorkTags.push(...tags); } catch {}
    }
  });
  const didntWorkCounts: { [key: string]: number } = {};
  allDidntWorkTags.forEach(tag => { didntWorkCounts[tag] = (didntWorkCounts[tag] || 0) + 1; });
  const topDidntWork = Object.entries(didntWorkCounts).sort((a,b) => b[1]-a[1]).slice(0,4).map(([tag]) => tag);

  // Mood patterns — what worked tags per mood
  const moodWorkedTags: { [key: string]: { [key: string]: number } } = {};
  const moodFeelings: { [key: string]: string[] } = {};
  reviews.forEach(r => {
    const mood = r.session?.currentMood;
    if (!mood) return;
    if (!moodWorkedTags[mood]) moodWorkedTags[mood] = {};
    if (!moodFeelings[mood]) moodFeelings[mood] = [];
    if (r.workedTags) {
      try {
        const tags = JSON.parse(r.workedTags as string);
        tags.forEach((tag: string) => {
          moodWorkedTags[mood][tag] = (moodWorkedTags[mood][tag] || 0) + 1;
        });
      } catch {}
    }
    if (r.session?.desiredFeeling && r.desiredFeelingAchieved === true) {
      moodFeelings[mood].push(r.session.desiredFeeling);
    }
  });

  const moodInsights = Object.entries(moodWorkedTags).map(([mood, tagCounts]) => {
    const topTags = Object.entries(tagCounts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([t]) => t);
    const topFeeling = moodFeelings[mood]?.[0] || null;
    return { mood, topTags, topFeeling };
  }).filter(m => m.topTags.length > 0);

  // Occasions where looks felt most like them
  const occasionPerformance: { [key: string]: number } = {};
  reviews.forEach(r => {
    if (r.session?.occasion && r.feltLikeHer === true) {
      occasionPerformance[r.session.occasion] = (occasionPerformance[r.session.occasion] || 0) + 1;
    }
  });
  const topOccasions = Object.entries(occasionPerformance).sort((a,b) => b[1]-a[1]).slice(0,3).map(([o]) => o);

  // Feeling shift patterns — which desired feelings were actually achieved
  const feelingShifts: { [key: string]: number } = {};
  reviews.forEach(r => {
    if (r.session?.desiredFeeling && r.desiredFeelingAchieved === true) {
      feelingShifts[r.session.desiredFeeling] = (feelingShifts[r.session.desiredFeeling] || 0) + 1;
    }
  });
  const topFeelingShifts = Object.entries(feelingShifts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([f]) => f);

  // Style direction
  let styleDirection = "Still learning your style";
  if (totalReviews >= 3) {
    if (topWorked.length > 0 && topFeelingShifts.length > 0) {
      styleDirection = `${topFeelingShifts[0]} through ${topWorked[0].toLowerCase()}`;
    } else if (profile?.desiredFeeling) {
      const feeling = profile.desiredFeeling.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      styleDirection = feeling;
    }
  }

  // DEMO: inject dummy data if no reviews yet
  const isDemoMode = totalReviews === 0;

  const styleResponseProfile = isDemoMode ? {
    totalReviews: 12,
    styleAlignmentPercent: 83,
    wouldWearPercent: 75,
    feelingShiftPercent: 91,
    avgComfort: 4.2,
    styleDirection: "Confident through silhouette",
    moodInsights: [
      { mood: "tired", topTags: ["Silhouette", "Color palette", "Overall vibe"], topFeeling: "effortless" },
      { mood: "confident", topTags: ["Styling approach", "Silhouette"], topFeeling: "powerful" },
      { mood: "bloated", topTags: ["Overall vibe", "Color palette"], topFeeling: "comfortable" },
      { mood: "low-energy", topTags: ["Color palette", "Accessories"], topFeeling: "elevated" },
    ],
    topOccasions: ["Dinner", "Work", "Date night"],
    topWorked: ["Silhouette", "Color palette", "Overall vibe", "Styling approach"],
    topDidntWork: ["Too casual", "Wrong colors"],
    topFeelingShifts: ["Confident", "Powerful", "Effortless"],
    unlocked: true
  } : {
    totalReviews,
    styleAlignmentPercent,
    wouldWearPercent,
    feelingShiftPercent,
    avgComfort,
    styleDirection,
    moodInsights,
    topOccasions,
    topWorked,
    topDidntWork,
    topFeelingShifts,
    unlocked: true
  };

  return {
    customer,
    profile,
    isDemoMode,
    stats: {
      looksStyled: customer.stylingSessions.length,
      closetPieces: customer.closetItems.length,
      avgRating,
      styleAlignment: `${styleAlignmentPercent}%`
    },
    styleResponseProfile,
    insights: {
      dailyQuote,
      stylingIdentity,
      styleDNA,
      todayStyleEnergy
    }
  };
}


function BuySkipWidget() {
  const [step, setStep] = React.useState("upload"); // upload | tag | result
  const [imageUrl, setImageUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [result, setResult] = React.useState(null);

  // Item tags
  const [category, setCategory] = React.useState("");
  const [color, setColor] = React.useState([]);
  const [brand, setBrand] = React.useState("");
  const [itemLink, setItemLink] = React.useState("");

  const CATEGORIES = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory", "Jewelry"];
  const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver"];

  const handleUpload = async (file) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "kqfhwrpq");
    try {
      const res = await fetch("https://api.cloudinary.com/v1_1/diybves1z/image/upload", { method: "POST", body: formData });
      const data = await res.json();
      setImageUrl(data.secure_url);
      setStep("tag");
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleLinkSubmit = async () => {
    if (!itemLink) return;
    setUploading(true);
    try {
      // Ask our server to scrape the image from the link
      const res = await fetch("/api/wishlist?action=scrape-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: itemLink })
      });
      const data = await res.json();
      if (data.imageUrl) {
        setImageUrl(data.imageUrl);
        if (data.brand) setBrand(data.brand);
        setStep("tag");
      } else {
        // No image found — go to tag step anyway, AI will use link details
        setImageUrl("https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400");
        setStep("tag");
      }
    } catch (err) {
      console.error("Link scrape failed:", err);
      setStep("tag");
    } finally {
      setUploading(false);
    }
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
          itemType: a.itemType,
          styleAlignment: { yourDNA: a.styleDNAMatch || "Analysis complete", match: a.verdict === "BUY" ? "Strong match" : "Weak match", reasoning: a.styleDNAMatch },
          details: a.detailedAnalysis,
          closetIntegration: { pairsWell: a.closetPairings || [], fillsGap: a.fillsGap },
          naiaMatch: a.naiaMatch || null,
          occasions: a.occasions || [],
          finalThought: a.finalThought
        });
        setStep("result");
      } else {
        setResult({ verdict: "ERROR", confidence: 0, finalThought: "Unable to analyze this image. Please try another photo." });
        setStep("result");
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      setResult({ verdict: "ERROR", confidence: 0, finalThought: "Analysis failed. Please try again." });
      setStep("result");
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setImageUrl(""); setResult(null); setCategory(""); setColor([]); setBrand(""); setItemLink("");
    setStep("upload");
  };

  const pillStyle = (active) => ({
    padding: "10px 18px",
    border: active ? "none" : "1px solid rgba(59,5,16,.12)",
    fontFamily: "'Space Mono',monospace",
    fontSize: "9px",
    letterSpacing: "2px",
    textTransform: "uppercase",
    color: active ? "#f4f4f1" : "#221516",
    cursor: "pointer",
    background: active ? "#8b2035" : "transparent",
    transition: "all .2s",
  });

  const labelStyle = { fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px", display: "block" };
  const inputStyle = { width: "100%", padding: "14px", border: "1px solid rgba(59,5,16,.1)", fontSize: "16px", fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", background: "rgba(255,255,255,0.7)", color: "#221516", outline: "none", boxSizing: "border-box" };

  // STEP 1: Upload
  if (step === "upload") return (
    <div style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)", padding: "60px", textAlign: "center" }}>
      <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} style={{ display: "none" }} id="buyskipInput" />
      <label htmlFor="buyskipInput" style={{ display: "inline-block", padding: "16px 32px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>
        {uploading ? "UPLOADING..." : "CHOOSE PHOTO"}
      </label>
      <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a", marginTop: "16px" }}>
        Upload a photo of the item you're thinking of buying
      </p>
    </div>
  );

    // STEP 2: Tag
  if (step === "tag") return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px" }}>
      <div>
        <img src={imageUrl} alt="Item" style={{ width: "100%", border: "1px solid rgba(59,5,16,0.06)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "24px", fontWeight: 900, fontStyle: "italic", marginBottom: "8px" }}>Tell us about this piece</div>
          <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Help nAia understand what it is</p>
        </div>

        <div>
          <span style={labelStyle}>Category *</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {CATEGORIES.map(c => <button key={c} onClick={() => setCategory(c)} style={pillStyle(category === c)}>{c}</button>)}
          </div>
        </div>

        <div>
          <span style={labelStyle}>Color *</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {COLORS.map(c => <button key={c} onClick={() => setColor(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])} style={pillStyle(color.includes(c))}>{c}</button>)}
          </div>
        </div>

        <div>
          <span style={labelStyle}>Brand (optional)</span>
          <input style={inputStyle} type="text" placeholder="e.g. Zara, H&M, Mango" value={brand} onChange={e => setBrand(e.target.value)} />
        </div>

        <div>
          <span style={labelStyle}>Product Link (optional)</span>
          <input style={inputStyle} type="text" placeholder="e.g. https://zara.com/..." value={itemLink} onChange={e => setItemLink(e.target.value)} />
          <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "13px", fontStyle: "italic", color: "#7a6f6a", marginTop: "6px" }}>Helps nAia understand the exact item</p>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={!category || color.length === 0 || analyzing}
          style={{ padding: "16px 32px", background: (!category || color.length === 0) ? "#d4cfc9" : "#8b2035", color: "#f4f4f1", border: "none", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", cursor: (!category || !color) ? "not-allowed" : "pointer" }}
        >
          {analyzing ? "ANALYZING..." : "ANALYZE →"}
        </button>

        <button onClick={reset} style={{ background: "none", border: "none", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", cursor: "pointer" }}>
          ← START OVER
        </button>
      </div>
    </div>
  );

  // STEP 3: Result
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px" }}>
      <div>
        <img src={imageUrl} alt="Item" style={{ width: "100%", border: "1px solid rgba(59,5,16,0.06)", marginBottom: "16px" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {category && <span style={{ padding: "6px 12px", border: "1px solid rgba(59,5,16,.12)", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516" }}>{category}</span>}
          {color.map(c => <span key={c} style={{ padding: "6px 12px", border: "1px solid rgba(59,5,16,.12)", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516" }}>{c}</span>)}
          {brand && <span style={{ padding: "6px 12px", border: "1px solid rgba(59,5,16,.12)", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516" }}>{brand}</span>}
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.8)", padding: "40px", border: "1px solid rgba(59,5,16,0.06)" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "56px", fontWeight: 900, color: result.verdict === "BUY" ? "#8b2035" : "#7a6f6a", marginBottom: "8px" }}>
          {result.verdict}
        </div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "11px", color: "#7a6f6a", marginBottom: "32px", letterSpacing: "1px" }}>
          {result.confidence}% CONFIDENCE
        </div>

        {result.styleAlignment && (
          <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>STYLE DNA MATCH</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516", lineHeight: 1.7 }}>
              {result.styleAlignment.reasoning}
            </div>
          </div>
        )}

        {result.details && (
          <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>DETAILED ANALYSIS</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", color: "#221516", lineHeight: 1.8 }}>
              {result.details.silhouette && <div style={{ marginBottom: "8px" }}><strong>Silhouette:</strong> {result.details.silhouette}</div>}
              {result.details.color && <div style={{ marginBottom: "8px" }}><strong>Color:</strong> {result.details.color}</div>}
              {result.details.fabric && <div style={{ marginBottom: "8px" }}><strong>Fabric:</strong> {result.details.fabric}</div>}
              {result.details.versatility && <div><strong>Versatility:</strong> {result.details.versatility}</div>}
            </div>
          </div>
        )}

        <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>PAIRS WITH YOUR CLOSET</div>
          {result.closetIntegration?.pairsWell?.length > 0 ? (
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", color: "#221516", lineHeight: 1.8 }}>
                {result.closetIntegration.pairsWell.join(", ")}
              </div>
              {result.closetIntegration.fillsGap && <div style={{ color: "#8b2035", fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", marginTop: "8px" }}>✓ {result.closetIntegration.fillsGap}</div>}
            </div>
          ) : (
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a", lineHeight: 1.7 }}>
              No closet items saved yet.{" "}
              <a href="/apps/naia-stylist/closet" style={{ color: "#8b2035", textDecoration: "none" }}>Add pieces to your wardrobe</a>
              {" "}and nAia will tell you exactly what this pairs with.
            </div>
          )}
        </div>

        {result.naiaMatch && (
          <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>PAIR IT WITH FROM NAIA</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "18px", fontWeight: 700, color: "#221516", marginBottom: "8px" }}>
              {typeof result.naiaMatch === "object" ? result.naiaMatch.title : result.naiaMatch}
            </div>
            {typeof result.naiaMatch === "object" && result.naiaMatch.reason && (
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "12px", lineHeight: 1.6 }}>{result.naiaMatch.reason}</div>
            )}
            {typeof result.naiaMatch === "object" && result.naiaMatch.url && (
              <a href={result.naiaMatch.url} target="_blank" rel="noreferrer" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>SHOP THIS PIECE →</a>
            )}
          </div>
        )}

        {result.occasions?.length > 0 && (
          <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>PERFECT FOR</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {result.occasions.map((occ, i) => <span key={i} style={{ padding: "6px 12px", background: "rgba(139,32,53,0.1)", color: "#8b2035", fontSize: "12px", fontFamily: "'Space Mono',monospace" }}>{occ}</span>)}
            </div>
          </div>
        )}

        {result.finalThought && (
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#221516", lineHeight: 1.7 }}>{result.finalThought}</div>
          </div>
        )}

        <button onClick={reset} style={{ width: "100%", padding: "16px 24px", background: "transparent", border: "1px solid #8b2035", color: "#8b2035", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>
          TRY ANOTHER
        </button>
      </div>
    </div>
  );
}



export default function Index() {
  const { customer, stats, insights, profile, styleResponseProfile, isDemoMode } = useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "60px 40px" }}>

        {/* Welcome */}
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(40px,5vw,64px)", fontWeight: 900, lineHeight: 1, marginBottom: "8px" }}>
          Welcome back, <em style={{ fontStyle: "italic", color: "#8b2035" }}>{customer.firstName || "there"}</em>.
        </h1>

        {/* 1. Daily quote / today's style energy */}
        <div style={{ marginBottom: "48px", marginTop: "32px", padding: "24px 32px", borderLeft: "2px solid rgba(139,32,53,0.2)" }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "20px", fontStyle: "italic", color: "#221516", marginBottom: "8px" }}>
            "{insights.dailyQuote}"
          </div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035" }}>
            Today's style energy: {insights.todayStyleEnergy || insights.stylingIdentity}
          </div>
        </div>

        {/* 2. Style Me CTA — hero */}
        <div style={{ background: "#221516", color: "#f4f4f1", padding: "60px 48px", marginBottom: "48px", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: "40px" }}>
          <div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "16px" }}>YOUR PERSONAL STYLIST</div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(32px,4vw,48px)", fontWeight: 900, marginBottom: "16px", lineHeight: 1.1 }}>
              Style me <em style={{ fontStyle: "italic", color: "#8b2035" }}>today</em>
            </h2>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#e1dbd7", lineHeight: 1.6 }}>
              Get a look based on your mood, plans, comfort needs, and Style DNA.
            </p>
          </div>
          <Link to="/apps/naia-stylist/quick-style" style={{ display: "inline-block", padding: "20px 40px", border: "1px solid #f4f4f1", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" }}>
            START SESSION →
          </Link>
        </div>

        {/* 3. Styling snapshot */}
        <div style={{ marginBottom: "60px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "20px" }}>Your styling snapshot</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px" }}>
            {[
              { num: stats.looksStyled, label: "Looks created" },
              { num: stats.closetPieces, label: "Wardrobe pieces" },
              { num: stats.avgRating || "—", label: "Avg confidence" },
              { num: stats.styleAlignment, label: "Style alignment" },
            ].map(({ num, label }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.5)", padding: "24px", border: "1px solid rgba(59,5,16,0.06)" }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "40px", fontWeight: 900, color: "#221516" }}>{num}</div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Recent Looks */}
        <div style={{ marginBottom: "60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", fontWeight: 900 }}>Your recent looks</h2>
            <Link to="/apps/naia-stylist/quick-style" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>STYLE AGAIN →</Link>
          </div>
          {customer.stylingSessions.length === 0 ? (
            <div style={{ padding: "60px", textAlign: "center", background: "rgba(255,255,255,0.3)", border: "1px solid rgba(59,5,16,0.06)" }}>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "24px" }}>No looks yet — start your first session</p>
              <Link to="/apps/naia-stylist/quick-style" style={{ display: "inline-block", padding: "14px 32px", background: "#8b2035", color: "#f4f4f1", textDecoration: "none", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase" }}>STYLE ME</Link>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "24px" }}>
              {customer.stylingSessions.slice(0,6).map((session: any) => (
                <div key={session.id} style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(59,5,16,0.06)", padding: "24px" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "8px" }}>
                    {new Date(session.createdAt).toLocaleDateString()}
                  </div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "#221516" }}>
                    {session.suggestions[0]?.outfitName || "Untitled Look"}
                  </div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "16px" }}>
                    {session.currentMood} → {session.desiredFeeling}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <Link to={`/style-me/result?sessionId=${session.id}`} style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>VIEW LOOK →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5. What nAia is learning about you */}
        <div style={{ marginBottom: "60px" }}>
          <div style={{ marginBottom: "24px" }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", fontWeight: 900, marginBottom: "8px" }}>What nAia is learning about you</h2>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>
              {isDemoMode ? "This is a preview — rate your looks to build your real profile." : "Based on how you style, save, and rate looks."}
            </p>
          </div>

          {styleResponseProfile.unlocked ? (
            <div style={{ background: "rgba(255,255,255,0.6)", padding: "40px", border: "1px solid rgba(59,5,16,0.06)" }}>

              {/* Style direction */}
              <div style={{ background: "rgba(139,32,53,0.04)", padding: "24px", marginBottom: "40px", borderLeft: "3px solid #8b2035" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "8px" }}>YOUR STYLE DIRECTION</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "28px", fontWeight: 700, fontStyle: "italic", color: "#8b2035" }}>{styleResponseProfile.styleDirection}</div>
              </div>

              {/* What works */}
              {styleResponseProfile.topWorked.length > 0 && (
                <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516", marginBottom: "12px" }}>YOU RESPOND MOST TO</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {styleResponseProfile.topWorked.map((tag: string) => (
                      <span key={tag} style={{ padding: "8px 16px", background: "rgba(139,32,53,0.08)", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "#8b2035" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Feelings achieved */}
              {styleResponseProfile.topFeelingShifts.length > 0 && (
                <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516", marginBottom: "12px" }}>YOUR OUTFITS OFTEN AIM FOR</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#221516", lineHeight: 1.7 }}>
                    {styleResponseProfile.topFeelingShifts.join(" · ")}
                  </div>
                </div>
              )}

              {/* Mood insights */}
              {styleResponseProfile.moodInsights.length > 0 && (
                <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516", marginBottom: "20px" }}>WHEN YOU FEEL...</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {styleResponseProfile.moodInsights.slice(0,4).map(({ mood, topTags, topFeeling }: any) => (
                      <div key={mood} style={{ padding: "16px 20px", background: "rgba(255,255,255,0.5)", border: "1px solid rgba(59,5,16,0.06)" }}>
                        <span style={{ fontFamily: "'Playfair Display',serif", fontSize: "18px", fontWeight: 700, fontStyle: "italic", color: "#8b2035", textTransform: "capitalize" }}>{mood}</span>
                        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>
                          {" "}— you gravitate toward {topTags.slice(0,2).map((t: string) => t.toLowerCase()).join(" and ")}{topFeeling ? `, and tend to feel ${topFeeling}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Best occasions */}
              {styleResponseProfile.topOccasions.length > 0 && (
                <div style={{ marginBottom: "32px", paddingBottom: "32px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516", marginBottom: "12px" }}>YOU OFTEN STYLE FOR</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", lineHeight: 1.7, color: "#221516" }}>{styleResponseProfile.topOccasions.join(" · ")}</div>
                </div>
              )}

              {/* What doesn't work */}
              {styleResponseProfile.topDidntWork.length > 0 && (
                <div>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#221516", marginBottom: "12px" }}>WHAT DOESN'T WORK FOR YOU</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {styleResponseProfile.topDidntWork.map((tag: string) => (
                      <span key={tag} style={{ padding: "8px 16px", border: "1px solid rgba(59,5,16,0.12)", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "#7a6f6a" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: "rgba(139,32,53,0.04)", padding: "40px", border: "1px solid rgba(139,32,53,0.15)", textAlign: "center" }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", opacity: 0.2, marginBottom: "16px" }}>◇</div>
              <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "24px", fontWeight: 900, fontStyle: "italic", marginBottom: "12px" }}>nAia is still getting to know you</h3>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "32px" }}>
                Rate a few looks and nAia will start building a profile that's truly yours — your moods, your occasions, your feelings.
              </p>
              <Link to="/apps/naia-stylist/quick-style" style={{ display: "inline-block", padding: "16px 32px", background: "#8b2035", color: "#f4f4f1", textDecoration: "none", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase" }}>RATE A LOOK →</Link>
            </div>
          )}
        </div>

        {/* 6. Style DNA */}
        <div style={{ marginBottom: "60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
            <div>
              <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", fontWeight: 900, marginBottom: "4px" }}>Your Style DNA</h2>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>Based on your onboarding quiz</p>
            </div>
            <Link to="/apps/naia-stylist/onboarding/step/1" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>
              {!profile?.completed ? "COMPLETE PROFILE" : "EDIT"}
            </Link>
          </div>

          {profile?.completed ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: "16px" }}>
              {[
                { label: "Style personalities", value: profile.stylePersonalities?.map((s: string) => s.split('-').map((w: string) => w.charAt(0).toUpperCase()+w.slice(1)).join(' ')).join(', ') },
                { label: "Wants to feel", value: profile.desiredFeeling?.split('-').map((w: string) => w.charAt(0).toUpperCase()+w.slice(1)).join(' ') },
                { label: "Lifestyle", value: profile.dressesFor?.map((l: string) => l.split('-').map((w: string) => w.charAt(0).toUpperCase()+w.slice(1)).join(' ')).join(', ') },
                { label: "Favorite colors", value: profile.favoriteColors?.map((c: string) => c.split('-').map((w: string) => w.charAt(0).toUpperCase()+w.slice(1)).join(' ')).join(', ') },
              ].filter(i => i.value).map(({ label, value }) => (
                <div key={label} style={{ background: "rgba(255,255,255,0.5)", padding: "24px", border: "1px solid rgba(59,5,16,0.06)" }}>
                  <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "8px" }}>{label}</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#221516" }}>{value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: "rgba(139,32,53,0.05)", padding: "40px", textAlign: "center", border: "1px solid rgba(139,32,53,0.1)" }}>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "20px" }}>
                Complete your style quiz so nAia truly knows you
              </p>
              <Link to="/apps/naia-stylist/onboarding/step/1" style={{ display: "inline-block", padding: "14px 32px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", textDecoration: "none" }}>
                START QUIZ
              </Link>
            </div>
          )}
        </div>

        {/* 7. Style tools */}
        <div style={{ marginBottom: "60px" }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", fontWeight: 900, marginBottom: "8px" }}>Style tools</h2>
          <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "24px" }}>Everything you need in one place</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "20px" }}>
            <Link to="/apps/naia-stylist/closet" style={{ background: "rgba(255,255,255,0.5)", padding: "32px", border: "1px solid rgba(59,5,16,0.06)", textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>WARDROBE</div>
              <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "22px", fontWeight: 700, marginBottom: "8px", color: "#221516" }}>Digital Wardrobe</h3>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>Upload, save, and style your pieces with nAia.</p>
            </Link>
            <Link to="/apps/naia-stylist/quick-style" style={{ background: "#221516", color: "#f4f4f1", padding: "32px", textDecoration: "none", display: "block" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>STYLING SESSION</div>
              <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "22px", fontWeight: 900, marginBottom: "8px" }}>Style Me</h3>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", fontStyle: "italic", opacity: 0.8 }}>Get a personalized outfit based on your mood and occasion.</p>
            </Link>
            <Link to="/apps/naia-stylist/buyskip" style={{ background: "rgba(139,32,53,0.06)", padding: "32px", border: "1px solid rgba(139,32,53,0.12)", textDecoration: "none", display: "block" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>SHOPPING TOOL</div>
              <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "22px", fontWeight: 700, marginBottom: "8px", color: "#221516" }}>Buy or Skip?</h3>
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>Thinking of buying something? Upload it and nAia will tell you if it fits your wardrobe, style, and lifestyle.</p>
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
