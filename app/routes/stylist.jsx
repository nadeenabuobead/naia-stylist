import { useEffect, useMemo, useState, useCallback } from "react";

const VIBES = [
  "Tired", "Anxious", "Calm", "Overwhelmed", "Confident",
  "Excited", "Low", "Happy", "Irritated", "Flat / unmotivated"
];

const FEELINGS = [
  "Calm", "Confident", "Effortless", "Elegant", "Powerful",
  "Soft", "Bold", "Polished", "Magnetic", "Comfortable"
];

const STYLE_DNA = [
  "Classic", "Minimal", "Feminine", "Edgy", "Relaxed",
  "Polished", "Romantic", "Artistic", "Streetwear", "Statement", "Modern", "Refined"
];

const BODY_PREFS = [
  "Highlight waist", "Elongate legs", "Balance shoulders",
  "Skim the body", "Define shape", "Add structure",
  "Minimize cling", "Create ease", "Maximize volume", "No preference"
];

const TRYON_WORKER_URL = "https://virtual-tryon-api.naia-tryon.workers.dev";

function getStorefrontPiece() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  let image = params.get("product_image") || "";
  let title = params.get("product_title") || "";
  let id = params.get("product_id") || "";
  let type = params.get("product_type") || "";
  let stylingNotes = params.get("styling_notes") || "";
  let moodMatch = params.get("mood_match") || "";
  let stylingRole = params.get("styling_role") || "";
  let statementLevel = params.get("statement_level") || "";
  let occasion = params.get("occasion") || "";
  let sihouette = params.get("sihouette") || "";
  try { image = decodeURIComponent(image); } catch {}
  try { title = decodeURIComponent(title); } catch {}
  try { stylingNotes = decodeURIComponent(stylingNotes); } catch {}
  try { moodMatch = decodeURIComponent(moodMatch); } catch {}
  try { stylingRole = decodeURIComponent(stylingRole); } catch {}
  try { statementLevel = decodeURIComponent(statementLevel); } catch {}
  try { occasion = decodeURIComponent(occasion); } catch {}
  try { sihouette = decodeURIComponent(sihouette); } catch {}
  if (image.startsWith("//")) image = "https:" + image;
  if (image && !image.startsWith("http")) image = "https://" + image;
  if (!image || !image.startsWith("http")) return null;
  return { id, name: title || "Selected nAia Piece", image, altText: title, category: type, stylingNotes, moodMatch, stylingRole, statementLevel, occasion, sihouette };
}

function parseStylingResult(text) {
  if (!text) return null;
  const sections = {
    feelingNow: "", feelingNext: "",
    outfitDirection: [], whyThisWorks: [],
    shift: "", naiaRecommendations: [],
    accessories: "", perfume: "", song: "", hair: "", makeup: "",
  };
  const accessMatch = text.match(/Accessories:\s*([^\n]+)/i);
  const perfumeMatch = text.match(/Perfume:\s*([^\n]+)/i);
  const songMatch = text.match(/Song:\s*([^\n]+)/i);
  const hairMatch = text.match(/Hair:\s*([^\n]+)/i);
  const makeupMatch = text.match(/Makeup:\s*([^\n]+)/i);
  if (accessMatch) sections.accessories = accessMatch[1].trim();
  if (perfumeMatch) sections.perfume = perfumeMatch[1].trim();
  if (hairMatch) sections.hair = hairMatch[1].trim();
  if (makeupMatch) sections.makeup = makeupMatch[1].trim();
  if (songMatch) sections.song = songMatch[1].trim();
  let cleaned = text
    .replace(/Accessories:.*$/im, "")
    .replace(/Perfume:.*$/im, "")
    .replace(/Song:.*$/im, "")
    .replace(/Hair:.*$/im, "")
    .replace(/Makeup:.*$/im, "");
  const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
  let currentSection = "";
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("you're feeling:") || lower.startsWith("you\u2019re feeling:")) {
      sections.feelingNow = line.split(":").slice(1).join(":").trim();
      currentSection = ""; continue;
    }
    if (lower.startsWith("you want to feel:")) {
      sections.feelingNext = line.split(":").slice(1).join(":").trim();
      currentSection = ""; continue;
    }
    if (lower === "your outfit direction") { currentSection = "outfitDirection"; continue; }
    if (lower === "why this works") { currentSection = "whyThisWorks"; continue; }
    if (lower === "shift" || lower.startsWith("shift:")) {
      currentSection = "shift";
      const a = line.split(":").slice(1).join(":").trim();
      if (a) sections.shift = a; continue;
    }
    if (lower.includes("naia recommendation")) { currentSection = "naiaRecommendations"; continue; }
    if (line.match(/^[-•*]/) || line.match(/^\d+[\.\)]/)) {
      const c = line.replace(/^[-•*\d]+[\.\)]*\s*/, "").replace(/\*\*/g, "").trim();
      if (currentSection === "outfitDirection") sections.outfitDirection.push(c);
      else if (currentSection === "whyThisWorks") sections.whyThisWorks.push(c);
      else if (currentSection === "naiaRecommendations") sections.naiaRecommendations.push(c);
      continue;
    }
    if (currentSection === "shift") {
      sections.shift = sections.shift ? `${sections.shift} ${line}` : line;
      continue;
    }
  }
  sections.shift = sections.shift.split(/nAia|Accessories|Perfume|Song/i)[0].trim();
  return sections;
}

// ─── Auth helpers ───
function getTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("naia_token") || null;
}

function getSavedToken() {
  if (typeof window === "undefined") return null;
  
  // Check localStorage first
  const stored = localStorage.getItem("naia_customer_token");
  if (stored) return stored;
  
  // Fall back to naia_customer_data cookie
  const match = document.cookie.match(/naia_customer_data=([^;]+)/);
  if (match) return match[1];
  
  return null;
}

function saveToken(token) {
  if (typeof window !== "undefined" && token) {
    localStorage.setItem("naia_customer_token", token);
  }
}

function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("naia_customer_token");
  }
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Loader ───
export async function loader() {
  return null;
}

// ─── Confidence Rating Component ───
function ConfidenceRating({ historyId, customerToken, mood, feeling, event, styleWords, onRated }) {
  const [showRating, setShowRating] = useState(false);
  const [overallReaction, setOverallReaction] = useState(0);
  const [feltLikeMe, setFeltLikeMe] = useState("");
  const [desiredFeelingAchieved, setDesiredFeelingAchieved] = useState("");
  const [wouldWearAgain, setWouldWearAgain] = useState("");
  const [physicalComfort, setPhysicalComfort] = useState("");
  const [workedTags, setWorkedTags] = useState([]);
  const [didntWorkTags, setDidntWorkTags] = useState([]);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const WORKED_OPTIONS = [
    "Felt like me", "Helped me feel more confident", "Right for the occasion",
    "Flattering silhouette", "Comfortable", "I liked the proportions",
    "I liked the colors", "Felt polished", "Felt attractive", "Easy to imagine wearing"
  ];

  const DIDNT_WORK_OPTIONS = [
  "Everything worked",
  "Didn't feel like me", "Missed the feeling I wanted", "Wrong for the occasion",
  "Too exposed", "Too plain", "Too much", "Too structured", "Too loose",
  "Too clingy", "Uncomfortable", "Hard to style in real life"
];

  const toggleWorkedTag = (tag) => {
    setWorkedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const toggleDidntWorkTag = (tag) => {
    setDidntWorkTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const canSubmit = overallReaction > 0 && feltLikeMe && desiredFeelingAchieved && wouldWearAgain && physicalComfort;

  const submitRating = async () => {
    if (!canSubmit) return;

    try {
      const res = await fetch("/api/outfit-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(customerToken ? { "Authorization": `Bearer ${customerToken}` } : {}) },
        body: JSON.stringify({
          historyId,
          overallReaction,
          feltLikeMe,
          desiredFeelingAchieved,
          wouldWearAgain,
          physicalComfort,
          workedTags: JSON.stringify(workedTags),
          didntWorkTags: JSON.stringify(didntWorkTags),
          additionalNotes,
          mood, feeling, event,
          styleWords: Array.isArray(styleWords) ? JSON.stringify(styleWords) : styleWords,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        if (onRated) onRated();
      }
    } catch (err) {
      console.error("Rating save error:", err);
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: "24px", background: "#eee9e2", borderRadius: "2px", textAlign: "center" }}>
        <p style={{ fontSize: "15px", margin: 0 }}>✓ Feedback saved</p>
      </div>
    );
  }

  if (!showRating) {
    return (
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <button
          onClick={() => setShowRating(true)}
          style={{
            padding: "14px 32px",
            background: "white",
            color: "#1a1816",
            border: "1px solid #1a1816",
            borderRadius: "2px",
            cursor: "pointer",
            fontSize: "13px",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            fontFamily: '"Cormorant Garamond", Georgia, serif',
          }}
        >
          Rate this look
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px", background: "#f5f2ee", borderRadius: "2px" }}>
      <p style={{ fontSize: "18px", fontWeight: 500, marginBottom: "24px" }}>How did this look land for you?</p>

      {/* Overall reaction */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>Overall reaction</p>
        <div style={{ display: "flex", gap: "12px" }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setOverallReaction(n)}
              style={{
                flex: 1,
                padding: "12px",
                background: overallReaction === n ? "#1a1816" : "white",
                color: overallReaction === n ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: 500,
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "12px", color: "#8a7f75" }}>
          <span>Not for me</span>
          <span>Very me</span>
        </div>
      </div>

      {/* Felt like me */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>Did this feel like you?</p>
        <div style={{ display: "flex", gap: "10px" }}>
          {["Yes", "Somewhat", "No"].map(opt => (
            <button
              key={opt}
              onClick={() => setFeltLikeMe(opt)}
              style={{
                flex: 1,
                padding: "10px",
                background: feltLikeMe === opt ? "#1a1816" : "white",
                color: feltLikeMe === opt ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Desired feeling achieved */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>Did it create the feeling you wanted?</p>
        <div style={{ display: "flex", gap: "10px" }}>
          {["Yes", "Partly", "No"].map(opt => (
            <button
              key={opt}
              onClick={() => setDesiredFeelingAchieved(opt)}
              style={{
                flex: 1,
                padding: "10px",
                background: desiredFeelingAchieved === opt ? "#1a1816" : "white",
                color: desiredFeelingAchieved === opt ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Would wear again */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>Would you actually wear this?</p>
        <div style={{ display: "flex", gap: "10px" }}>
          {["Definitely", "Maybe", "Probably not"].map(opt => (
            <button
              key={opt}
              onClick={() => setWouldWearAgain(opt)}
              style={{
                flex: 1,
                padding: "10px",
                background: wouldWearAgain === opt ? "#1a1816" : "white",
                color: wouldWearAgain === opt ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Physical comfort */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>How did it feel on your body?</p>
        <div style={{ display: "flex", gap: "10px" }}>
          {["Comfortable", "Mostly comfortable", "Not comfortable"].map(opt => (
            <button
              key={opt}
              onClick={() => setPhysicalComfort(opt)}
              style={{
                flex: 1,
                padding: "10px",
                background: physicalComfort === opt ? "#1a1816" : "white",
                color: physicalComfort === opt ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* What worked */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>What worked?</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {WORKED_OPTIONS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleWorkedTag(tag)}
              style={{
                padding: "8px 14px",
                background: workedTags.includes(tag) ? "#1a1816" : "white",
                color: workedTags.includes(tag) ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* What didn't work */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>What didn't work?</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {DIDNT_WORK_OPTIONS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleDidntWorkTag(tag)}
              style={{
                padding: "8px 14px",
                background: didntWorkTags.includes(tag) ? "#1a1816" : "white",
                color: didntWorkTags.includes(tag) ? "white" : "#1a1816",
                border: "1px solid #d4cfc9",
                borderRadius: "2px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Additional notes */}
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "14px", marginBottom: "12px", color: "#4a4540" }}>Anything else?</p>
        <textarea
          value={additionalNotes}
          onChange={(e) => setAdditionalNotes(e.target.value)}
          placeholder="What stood out, what felt off, or what you'd change"
          style={{
            width: "100%",
            padding: "12px",
            border: "1px solid #d4cfc9",
            borderRadius: "2px",
            fontSize: "14px",
            fontFamily: "inherit",
            minHeight: "80px",
            resize: "vertical",
          }}
        />
      </div>

      <button
        onClick={submitRating}
        disabled={!canSubmit}
        style={{
          width: "100%",
          padding: "14px",
          background: canSubmit ? "#1a1816" : "#d4cfc9",
          color: "white",
          border: "none",
          borderRadius: "2px",
          cursor: canSubmit ? "pointer" : "not-allowed",
          fontSize: "13px",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          fontFamily: '"Cormorant Garamond", Georgia, serif',
        }}
      >
        Save feedback
      </button>
    </div>
  );
}


// ─── Style Response Profile Component ───
function StyleResponseProfile({ customerToken }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customerToken) return;
    fetch("/api/confidence-dashboard", { headers: authHeaders(customerToken) })
      .then(r => r.json())
      .then(d => { if (d.dashboard) setProfile(d.dashboard); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [customerToken]);

  if (loading) return <p style={{ fontSize: "14px", color: "#8a7f75", fontStyle: "italic" }}>Loading your style profile...</p>;
  if (!profile || profile.totalRatings === 0) {
    return <p style={{ fontSize: "15px", color: "#8a7f75", fontStyle: "italic" }}>No ratings yet. Rate your styled looks to build your style response profile.</p>;
  }

  const s = {
    section: { marginBottom: "32px" },
    label: { fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "12px" },
    card: { padding: "16px", background: "#eee9e2", borderRadius: "2px", textAlign: "center" },
    cardNum: { fontSize: "26px", fontStyle: "italic", margin: "0 0 4px" },
    cardLabel: { fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#8a7f75", margin: 0 },
  };

  // Calculate scores
  const hasEnoughData = profile.totalRatings >= 5;
  const styleAlignment = hasEnoughData ? `${Math.round(profile.feltLikeMePercent || 0)}%` : "emerging";
  const wearability = hasEnoughData ? `${Math.round(profile.wouldWearAgainPercent || 0)}%` : "building";

  // Get unique positive reviews
  const positiveReviews = profile.recentRatings?.filter(r => 
    r.wouldWearAgain === "Definitely" || r.feltLikeMe === "Yes"
  ) || [];
  
  const uniquePositive = [];
  const seen = new Set();
  for (const r of positiveReviews) {
    const key = `${r.mood}-${r.feeling}-${r.event}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePositive.push(r);
    }
  }

  // Generate interpretation
  const getInterpretation = () => {
    if (profile.totalRatings < 3) return "Just getting started — keep rating looks to see patterns emerge.";
    if (positiveReviews.length > profile.totalRatings * 0.6) {
      return "You respond best to looks that feel polished, intentional, and emotionally clear.";
    }
    return "You're building a clearer sense of what works for you.";
  };

  return (
    <div>
      {/* Interpretation */}
      <p style={{ fontSize: "15px", fontStyle: "italic", color: "#4a4540", marginBottom: "28px", lineHeight: 1.6 }}>
        {getInterpretation()}
      </p>

      {/* Top cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "32px" }}>
        <div style={s.card}>
          <p style={s.cardNum}>{profile.totalRatings}</p>
          <p style={s.cardLabel}>Looks rated</p>
        </div>
        <div style={s.card}>
          <p style={s.cardNum}>{styleAlignment}</p>
          <p style={s.cardLabel}>Style alignment</p>
        </div>
        <div style={s.card}>
          <p style={s.cardNum}>{wearability}</p>
          <p style={s.cardLabel}>Would wear again</p>
        </div>
      </div>

      {/* What consistently works */}
      {uniquePositive.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>What consistently works</div>
          <div style={{ background: "#f5f2ee", padding: "16px", borderRadius: "2px", borderLeft: "2px solid #7da563" }}>
            {uniquePositive.slice(0, 3).map((r, i) => {
              let text = "";
              if (r.mood && r.feeling && r.event) {
                text = `When you're feeling ${r.mood}, ${r.event} looks that help you feel ${r.feeling} tend to work well`;
              } else if (r.mood && r.feeling) {
                text = `${r.mood} → ${r.feeling} looks seem to land well`;
              } else if (r.event) {
                text = `${r.event.charAt(0).toUpperCase() + r.event.slice(1)} looks tend to work for you`;
              } else {
                text = "These looks felt right";
              }
              return (
                <p key={i} style={{ fontSize: "14px", lineHeight: 1.6, margin: i > 0 ? "12px 0 0" : "0", color: "#1a1816" }}>
                  • {text}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* Best emotional shifts */}
      {profile.bestMoods?.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>Best emotional shifts</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {profile.bestMoods.slice(0, 5).map(m => {
              // m.name might be just "lonely" or "lonely → seen"
              const shift = m.name.includes('→') ? m.name : m.name;
              return (
                <div key={m.name} style={{ 
                  padding: "10px 16px", 
                  background: "#1a1816", 
                  color: "#f5f2ee", 
                  borderRadius: "2px", 
                  fontSize: "14px", 
                  fontStyle: "italic" 
                }}>
                  {shift}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Where your style lands best */}
      {profile.bestEvents?.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>Where your style lands best</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {profile.bestEvents.map((e, idx) => (
              <div key={e.name} style={{ 
                padding: "10px 16px", 
                background: idx === 0 ? "#1a1816" : "#eee9e2",
                color: idx === 0 ? "#f5f2ee" : "#1a1816",
                borderRadius: "2px", 
                fontSize: "14px",
                fontWeight: idx === 0 ? 500 : 400
              }}>
                {e.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What stood out to you */}
      {profile.recentRatings?.some(r => r.notes) && (
        <div style={s.section}>
          <div style={s.label}>What stood out to you</div>
          {profile.recentRatings
            .filter(r => r.notes && r.notes.trim())
            .slice(0, 3)
            .map((r, i) => (
              <div key={i} style={{ padding: "12px 16px", borderLeft: "1px solid #d4cfc9", marginBottom: "10px" }}>
                <p style={{ fontSize: "14px", fontStyle: "italic", color: "#4a4540", margin: 0 }}>
                  "{r.notes}"
                </p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
// ─── Main Component ───
export default function Stylist() {
  // ─── Auth state ───
  const [customerToken, setCustomerToken] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ─── Flow state ───
  const [step, setStep] = useState(0);
  const [mood, setMood] = useState("");
  const [feeling, setFeeling] = useState("");
  const [event, setEvent] = useState("");
  const [styleWords, setStyleWords] = useState([]);
  const [vibe, setVibe] = useState("");
  const [styleDNA, setStyleDNA] = useState([]);
  const [bodyPref, setBodyPref] = useState("");
  const [mode, setMode] = useState("");
  const [closet, setCloset] = useState([]);
  const [selectedClosetIds, setSelectedClosetIds] = useState([]);
  const [selectedNaiaPiece, setSelectedNaiaPiece] = useState(null);
  const [naiaProducts, setNaiaProducts] = useState([]);
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("top");
  const [itemImage, setItemImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [stylingResult, setStylingResult] = useState("");
  const [currentNaiaPiece, setCurrentNaiaPiece] = useState(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState(0);

  // ─── Feature state ───
  const [wishlist, setWishlist] = useState([]);
  const [outfitHistory, setOutfitHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showWishlist, setShowWishlist] = useState(false);
  const [tryOnState, setTryOnState] = useState({});
  const [tryOnPhoto, setTryOnPhoto] = useState(null);
  const [showAccount, setShowAccount] = useState(false);
  const [closetSynced, setClosetSynced] = useState(false);
  const [showConfidence, setShowConfidence] = useState(false);
  const [lastHistoryId, setLastHistoryId] = useState(null);
  const [previousPieces, setPreviousPieces] = useState([]);

  const LOADING_PHRASES = [
    "Reading your mood...", "Exploring your closet...",
    "Matching textures and tones...", "Finding the perfect pairing...",
    "Considering your silhouette...", "Curating your look...",
    "Balancing structure and flow...", "Adding the finishing touches...",
    "Almost there...",
  ];

  // ─── Init: check auth ───
  useEffect(() => {
    async function init() {
      let token = getTokenFromUrl() || getSavedToken();
      if (getTokenFromUrl() && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("naia_token");
        window.history.replaceState({}, "", url.toString());
      }
      if (token) {
        saveToken(token);
        setCustomerToken(token);
        try {
          const res = await fetch("/api/customer-profile", { headers: authHeaders(token) });
          const data = await res.json();
          if (data.authenticated && data.customer) {
            setCustomer(data.customer);
          } else { clearToken(); token = null; }
        } catch { clearToken(); token = null; }
      }
      setAuthLoading(false);
      setStep(1);
    }
    init();
  }, []);

  // ─── Load closet ───
  useEffect(() => {
    if (authLoading) return;
    async function loadCloset() {
      if (customerToken) {
        try {
          const res = await fetch("/api/closet", { headers: authHeaders(customerToken) });
          const data = await res.json();
          if (data.authenticated && data.items) {
            setCloset(data.items);
            setClosetSynced(true);
            const localRaw = localStorage.getItem("naia-closet-v2");
            if (localRaw) {
              try {
                const localItems = JSON.parse(localRaw);
                if (localItems.length > 0 && data.items.length === 0) {
                  const syncRes = await fetch("/api/closet", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders(customerToken) },
                    body: JSON.stringify({ action: "sync", items: localItems }),
                  });
                  const syncData = await syncRes.json();
                  if (syncData.items) setCloset(syncData.items);
                }
                localStorage.removeItem("naia-closet-v2");
              } catch {}
            }
            return;
          }
        } catch {}
      }
      const saved = localStorage.getItem("naia-closet-v2");
      if (saved) { try { setCloset(JSON.parse(saved)); } catch {} }
    }
    loadCloset();
  }, [authLoading, customerToken]);

  useEffect(() => { if (!customerToken) return; fetch("/api/wishlist", { headers: authHeaders(customerToken) }).then(r => r.json()).then(d => { if (d.items) setWishlist(d.items); }).catch(() => {}); }, [customerToken]);
  useEffect(() => { if (!customerToken) return; fetch("/api/outfit-history", { headers: authHeaders(customerToken) }).then(r => r.json()).then(d => { if (d.history) setOutfitHistory(d.history); }).catch(() => {}); }, [customerToken]);
  useEffect(() => { if (!customerToken && !authLoading) { localStorage.setItem("naia-closet-v2", JSON.stringify(closet)); } }, [closet, customerToken, authLoading]);

  useEffect(() => {
    if (!loading) { setLoadingPhrase(0); return; }
    const interval = setInterval(() => { setLoadingPhrase(prev => (prev + 1) % LOADING_PHRASES.length); }, 2800);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => { const piece = getStorefrontPiece(); if (piece) setCurrentNaiaPiece(piece); }, []);
  useEffect(() => { fetch("/api/naia-products").then(r => r.json()).then(d => setNaiaProducts(d.products || [])).catch(() => {}); }, []);

  const selectedClosetItems = useMemo(() => closet.filter(i => selectedClosetIds.includes(i.id)), [closet, selectedClosetIds]);
  const parsedResult = useMemo(() => parseStylingResult(stylingResult), [stylingResult]);
  const wishlistIds = useMemo(() => new Set(wishlist.map(w => String(w.naiaProductId))), [wishlist]);

  // ─── Closet operations ───
  const addItem = useCallback(async () => {
    if (!itemName.trim()) return;
    if (customerToken) {
      try {
        const res = await fetch("/api/closet", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(customerToken) }, body: JSON.stringify({ action: "add", name: itemName, category: itemCategory, image: itemImage }) });
        const data = await res.json();
        if (data.item) setCloset(prev => [data.item, ...prev]);
      } catch {}
    } else {
      setCloset(prev => [...prev, { id: String(Date.now()), name: itemName, category: itemCategory, image: itemImage }]);
    }
    setItemName(""); setItemCategory("top"); setItemImage(""); setShowAddItem(false);
  }, [itemName, itemCategory, itemImage, customerToken]);

  const removeClosetItem = useCallback(async (itemId) => {
    setCloset(prev => prev.filter(i => i.id !== itemId));
    setSelectedClosetIds(prev => prev.filter(i => i !== itemId));
    if (customerToken) { try { await fetch("/api/closet", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(customerToken) }, body: JSON.stringify({ action: "delete", itemId }) }); } catch {} }
  }, [customerToken]);

  // ─── Wishlist ───
  const toggleWishlist = useCallback(async (product) => {
    if (!customerToken) return;
    const pid = String(product.id);
    if (wishlistIds.has(pid)) {
      setWishlist(prev => prev.filter(w => String(w.naiaProductId) !== pid));
      try { await fetch("/api/wishlist", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(customerToken) }, body: JSON.stringify({ action: "remove", naiaProductId: pid }) }); } catch {}
    } else {
      const newItem = { naiaProductId: pid, title: product.title, handle: product.handle, image: product.image, createdAt: new Date().toISOString() };
      setWishlist(prev => [newItem, ...prev]);
      try { await fetch("/api/wishlist", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(customerToken) }, body: JSON.stringify({ action: "add", ...newItem }) }); } catch {}
    }
  }, [customerToken, wishlistIds]);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => { const canvas = document.createElement("canvas"); const MAX = 300; let w = img.width, h = img.height; if (w > h) { h = (h / w) * MAX; w = MAX; } else { w = (w / h) * MAX; h = MAX; } canvas.width = w; canvas.height = h; canvas.getContext("2d").drawImage(img, 0, 0, w, h); setItemImage(canvas.toDataURL("image/jpeg", 0.6)); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleTryOnPhotoUpload = (e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { setTryOnPhoto(ev.target.result); }; reader.readAsDataURL(file); };
  const toggleClosetItem = (id) => { setSelectedClosetIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };
  const toggleStyleWord = (word) => { setStyleWords(prev => prev.includes(word) ? prev.filter(w => w !== word) : prev.length < 3 ? [...prev, word] : prev); };

  // ─── Call AI ───
  const callAI = async () => {
    setLoading(true); setStylingResult(""); setStep(8); setLastHistoryId(null);
    const naiaPiece = selectedNaiaPiece || currentNaiaPiece;
    const itemsToStyle = mode === "closet_only" ? closet : selectedClosetItems;
    const outfitParts = [...itemsToStyle.map(i => i.name), naiaPiece ? (naiaPiece.name || naiaPiece.title) : null].filter(Boolean);
    const outfit = outfitParts.join(" + ");
    try {
      const res = await fetch("/api/style", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, outfit, mood, feeling, event, styleWords, vibe, styleDNA, bodyPref, styleIntelligence: customer?.styleIntelligence, closetItem: itemsToStyle[0] || null, closetItems: itemsToStyle, naiaPiece: naiaPiece ? { name: naiaPiece.name || naiaPiece.title, category: naiaPiece.category || naiaPiece.type || "", stylingNotes: naiaPiece.stylingNotes || "", moodMatch: naiaPiece.moodMatch || "", stylingRole: naiaPiece.stylingRole || "", statementLevel: naiaPiece.statementLevel || "", occasion: naiaPiece.occasion || "", sihouette: naiaPiece.sihouette || "" } : null, closet: closet.map(i => ({ name: i.name, category: i.category })) }),
      });
      const data = await res.json();
      const result = data.result || data.error || "Something went wrong.";
      setStylingResult(result);
      if (customerToken && result && !result.startsWith("Something went wrong")) {
        try {
          const hRes = await fetch("/api/outfit-history", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(customerToken) },
            body: JSON.stringify({ mood, feeling, event, styleWords, bodyPref, mode, closetItemIds: selectedClosetIds, result }),
          });
          const hData = await hRes.json();
          if (hData.entry?.id) setLastHistoryId(hData.entry.id);
          const hListRes = await fetch("/api/outfit-history", { headers: authHeaders(customerToken) });
          const hListData = await hListRes.json();
          if (hListData.history) setOutfitHistory(hListData.history);
        } catch {}
      }
    } catch { setStylingResult("Something went wrong. Please try again."); }
    setLoading(false);
  };

  // ─── Quick re-style ───
  const quickRestyle = async () => {
    if (!customer) return;
    setMood(customer.lastMood || ""); setFeeling(customer.lastFeeling || ""); setEvent(customer.lastEvent || "");
    setStyleWords(customer.lastStyleWords || []); setBodyPref(customer.lastBodyPref || ""); setMode(customer.lastMode || "closet_only");
    setLoading(true); setStylingResult(""); setStep(8); setLastHistoryId(null);
    try {
      const res = await fetch("/api/style", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: customer.lastMode || "closet_only", outfit: closet.map(i => i.name).join(" + "), mood: customer.lastMood || "", feeling: customer.lastFeeling || "", event: customer.lastEvent || "", styleWords: customer.lastStyleWords || [], bodyPref: customer.lastBodyPref || "", closetItems: closet, closet: closet.map(i => ({ name: i.name, category: i.category })) }),
      });
      const data = await res.json();
      const result = data.result || data.error || "Something went wrong.";
      setStylingResult(result);
      const pieceMatches = result.match(/Sculptural Hybrid Coat|Art Blouse|Art Panel Tailored Blazer|Textured Art Maxi Skirt|Wrap Cropped Top|Printed Wrap Kimono Jacket|Art Collar Shirt|Leather Midi Dress|Asymmetrical Waist Pants|Printed Straight Pants/g);
if (pieceMatches) setPreviousPieces(pieceMatches);
      if (customerToken && result) {
        try {
          const hRes = await fetch("/api/outfit-history", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(customerToken) },
            body: JSON.stringify({ mood: customer.lastMood, feeling: customer.lastFeeling, event: customer.lastEvent, styleWords: customer.lastStyleWords, bodyPref: customer.lastBodyPref, mode: customer.lastMode, result }),
          });
          const hData = await hRes.json();
          if (hData.entry?.id) setLastHistoryId(hData.entry.id);
        } catch {}
      }
    } catch { setStylingResult("Something went wrong. Please try again."); }
    setLoading(false);
  };

  // ─── Virtual try-on ───
  const startTryOn = async (productTitle, productImage) => {
    if (!tryOnPhoto) return;
    setTryOnState(prev => ({ ...prev, [productTitle]: { loading: true, result: null, error: null } }));
    try {
      let garmentUrl = productImage;
      if (garmentUrl && garmentUrl.startsWith("//")) garmentUrl = "https:" + garmentUrl;
      const res = await fetch(TRYON_WORKER_URL + "/try-on", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_image: tryOnPhoto, garment_image: garmentUrl, category: "auto" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.id) throw new Error("No prediction ID returned");
      const poll = async (id, attempts) => {
        if (attempts > 60) { setTryOnState(prev => ({ ...prev, [productTitle]: { loading: false, result: null, error: "Timed out" } })); return; }
        const statusRes = await fetch(TRYON_WORKER_URL + "/status/" + id);
        const statusData = await statusRes.json();
        if (statusData.status === "completed" && statusData.output && statusData.output.length > 0) {
          setTryOnState(prev => ({ ...prev, [productTitle]: { loading: false, result: statusData.output[0], error: null } }));
        } else if (statusData.status === "failed") {
          const errMsg = statusData.error?.message || "Generation failed";
          setTryOnState(prev => ({ ...prev, [productTitle]: { loading: false, result: null, error: errMsg } }));
        } else { setTimeout(() => poll(id, attempts + 1), 2000); }
      };
      poll(data.id, 0);
    } catch (err) { setTryOnState(prev => ({ ...prev, [productTitle]: { loading: false, result: null, error: err.message || "Network error" } })); }
  };

  const resetAll = () => {
    setStep(1); setStylingResult(""); setSelectedClosetIds([]); setSelectedNaiaPiece(null);
    setMood(""); setFeeling(""); setEvent(""); setStyleWords([]); setBodyPref(""); setMode("");
    setShowHistory(false); setShowWishlist(false); setShowAccount(false); setShowConfidence(false);
    setTryOnState({}); setTryOnPhoto(null); setLastHistoryId(null);
  };

  const logout = () => {
    clearToken(); setCustomerToken(null); setCustomer(null); setWishlist([]); setOutfitHistory([]); setClosetSynced(false);
    const saved = localStorage.getItem("naia-closet-v2");
    if (saved) { try { setCloset(JSON.parse(saved)); } catch { setCloset([]); } } else { setCloset([]); }
  };

  // ─── Styles ───
  const s = {
    page: { minHeight: "100vh", background: "#f5f2ee", color: "#1a1816", fontFamily: '"Cormorant Garamond", Georgia, serif' },
    container: { maxWidth: "680px", margin: "0 auto", padding: "40px 24px 80px" },
    stepIndicator: { display: "flex", gap: "6px", marginBottom: "40px", justifyContent: "center" },
    dot: (active, done) => ({ width: active ? "24px" : "8px", height: "8px", borderRadius: "4px", background: (done || active) ? "#1a1816" : "#d4cfc9", transition: "all 0.3s" }),
    title: { fontSize: "13px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "12px" },
    bigQ: { fontSize: "32px", lineHeight: 1.2, fontWeight: 400, margin: "0 0 32px", fontStyle: "italic" },
    input: { width: "100%", padding: "16px 0", background: "transparent", border: "none", borderBottom: "1px solid #c8c2bb", fontSize: "18px", color: "#1a1816", outline: "none", fontFamily: '"Cormorant Garamond", Georgia, serif', boxSizing: "border-box" },
    btn: { padding: "14px 32px", background: "#1a1816", color: "#f5f2ee", border: "none", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif' },
    outlineBtn: { padding: "14px 32px", background: "transparent", color: "#1a1816", border: "1px solid #1a1816", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif' },
    chip: (active) => ({ padding: "10px 18px", background: active ? "#1a1816" : "transparent", color: active ? "#f5f2ee" : "#1a1816", border: "1px solid #1a1816", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.1em", cursor: "pointer", transition: "all 0.2s", fontFamily: '"Cormorant Garamond", Georgia, serif' }),
    modeCard: (active) => ({ padding: "24px", border: `1px solid ${active ? "#1a1816" : "#d4cfc9"}`, background: active ? "#1a1816" : "transparent", color: active ? "#f5f2ee" : "#1a1816", cursor: "pointer", marginBottom: "12px", transition: "all 0.2s", borderRadius: "2px" }),
    productGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginTop: "16px" },
    closetGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", marginTop: "16px" },
    resultLabel: { fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "8px" },
    resultValue: { fontSize: "22px", fontStyle: "italic", lineHeight: 1.4 },
    divider: { borderTop: "1px solid #d4cfc9", margin: "24px 0" },
    vibeCard: { padding: "16px 20px", background: "#eee9e2", borderRadius: "2px" },
    topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", paddingBottom: "16px", borderBottom: "1px solid #e8e4df" },
    avatar: { width: "36px", height: "36px", borderRadius: "50%", background: "#1a1816", color: "#f5f2ee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 500, cursor: "pointer" },
    iconBtn: { background: "none", border: "none", cursor: "pointer", padding: "8px", color: "#1a1816", position: "relative" },
    badge: { position: "absolute", top: "2px", right: "2px", width: "8px", height: "8px", borderRadius: "50%", background: "#c5553a" },
    heartBtn: (active) => ({ background: "none", border: "none", cursor: "pointer", padding: "4px", color: active ? "#c5553a" : "#8a7f75", fontSize: "18px", transition: "color 0.2s" }),
    panel: { background: "#fff", borderRadius: "2px", border: "1px solid #d4cfc9", padding: "24px", marginBottom: "24px" },
    tryOnBtn: { padding: "8px 16px", background: "transparent", color: "#1a1816", border: "1px solid #1a1816", borderRadius: "2px", fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif', marginTop: "8px" },
    quickBtn: { padding: "16px 32px", background: "transparent", border: "2px solid #1a1816", borderRadius: "2px", fontSize: "15px", letterSpacing: "0.1em", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif', fontStyle: "italic", transition: "all 0.2s" },
  };

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap" rel="stylesheet" />
      <div style={s.container}>

        {/* ─── Top Bar ─── */}
        <div style={s.topBar}>
          <div style={{ fontSize: "22px", fontStyle: "italic", fontWeight: 300 }}>nAia</div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {customer && (
              <>
                <button style={s.iconBtn} onClick={() => { setShowConfidence(false); setShowHistory(false); setShowWishlist(false); setShowAccount(false); setStep(1); }} title="Style me">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </button>
                {/* Confidence dashboard button */}
                <button style={s.iconBtn} onClick={() => { setShowConfidence(!showConfidence); setShowHistory(false); setShowWishlist(false); setShowAccount(false); }} title="Confidence profile">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                </button>
                <button style={s.iconBtn} onClick={() => { setShowHistory(!showHistory); setShowWishlist(false); setShowAccount(false); setShowConfidence(false); }} title="Past looks">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {outfitHistory.length > 0 && <div style={s.badge} />}
                </button>
                <button style={s.iconBtn} onClick={() => { setShowWishlist(!showWishlist); setShowHistory(false); setShowAccount(false); setShowConfidence(false); }} title="Wishlist">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={wishlist.length > 0 ? "#c5553a" : "none"} stroke={wishlist.length > 0 ? "#c5553a" : "currentColor"} strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </button>
                <div style={s.avatar} onClick={() => { setShowAccount(!showAccount); setShowHistory(false); setShowWishlist(false); setShowConfidence(false); }}>
                  {(customer.firstName || customer.email || "?")[0].toUpperCase()}
                </div>
              </>
            )}
            {!customer && !authLoading && (
              <div style={{ fontSize: "12px", color: "#8a7f75" }}>
                <a href="https://naia-9417.myshopify.com/account/login" target="_blank" rel="noreferrer" style={{ color: "#1a1816", textDecoration: "underline", textUnderlineOffset: "3px" }}>Sign in</a>{" "}to save your closet
              </div>
            )}
          </div>
        </div>

        {/* ─── Account Panel ─── */}
        {showAccount && customer && (
          <div style={s.panel}>
            <div style={s.title}>Your Account</div>
            <p style={{ fontSize: "18px", margin: "0 0 8px" }}>{customer.firstName} {customer.lastName}</p>
            <p style={{ fontSize: "14px", color: "#8a7f75", margin: "0 0 16px" }}>{customer.email}</p>
            <p style={{ fontSize: "13px", color: "#8a7f75", margin: "0 0 16px" }}>
              {closet.length} closet piece{closet.length !== 1 ? "s" : ""} · {wishlist.length} wishlisted · {outfitHistory.length} past look{outfitHistory.length !== 1 ? "s" : ""}
            </p>
            <button style={{ ...s.outlineBtn, fontSize: "11px", padding: "10px 20px" }} onClick={logout}>Sign out</button>
          </div>
        )}

        {/* ─── Confidence Dashboard Panel ─── */}
        {showConfidence && customer && (
          <div style={s.panel}>
            <div style={s.title}>Your Style Response Profile</div>
            <StyleResponseProfile customerToken={customerToken} />
          </div>
        )}

        {/* ─── Wishlist Panel ─── */}
        {showWishlist && customer && (
          <div style={s.panel}>
            <div style={s.title}>Your Wishlist</div>
            {wishlist.length === 0 ? (
              <p style={{ fontSize: "15px", color: "#8a7f75", fontStyle: "italic" }}>No wishlisted pieces yet. Tap the heart on any nAia piece to save it.</p>
            ) : (
              <div style={s.productGrid}>
                {wishlist.map(w => (
                  <div key={w.naiaProductId} style={{ border: "1px solid #d4cfc9", borderRadius: "2px", overflow: "hidden", position: "relative" }}>
                    <a href={`https://naia-9417.myshopify.com/products/${w.handle}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                      {w.image && <img src={w.image} alt={w.title} style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} />}
                      <div style={{ padding: "8px", fontSize: "12px" }}>{w.title}</div>
                    </a>
                    <button style={{ ...s.heartBtn(true), position: "absolute", top: "6px", right: "6px" }} onClick={() => toggleWishlist({ id: w.naiaProductId, title: w.title, handle: w.handle, image: w.image })}>♥</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── History Panel ─── */}
        {showHistory && customer && (
          <div style={s.panel}>
            <div style={s.title}>Past Looks</div>
            {outfitHistory.length === 0 ? (
              <p style={{ fontSize: "15px", color: "#8a7f75", fontStyle: "italic" }}>No past styling sessions yet.</p>
            ) : (
              <div>
                {outfitHistory.slice(0, 10).map((h, idx) => {
                  const parsed = parseStylingResult(typeof h.result === "string" ? h.result : (h.result?.whyThisWorks || ""));
                  return (
                    <div key={h.id || idx} style={{ padding: "16px 0", borderBottom: idx < 9 ? "1px solid #e8e4df" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: "15px", fontStyle: "italic", marginBottom: "4px" }}>{h.mood || "—"} → {h.feeling || "—"}</div>
                          <div style={{ fontSize: "12px", color: "#8a7f75" }}>{h.event || ""} · {new Date(h.createdAt).toLocaleDateString()}</div>
                        </div>
                        {h.result && <button style={{ ...s.outlineBtn, fontSize: "10px", padding: "6px 12px" }} onClick={() => { setStylingResult(h.result); setMood(h.mood || ""); setFeeling(h.feeling || ""); setEvent(h.event || ""); setShowHistory(false); setStep(8); }}>View</button>}
                      </div>
                      {parsed?.shift && <p style={{ fontSize: "13px", fontStyle: "italic", color: "#4a4540", margin: "8px 0 0" }}>{parsed.shift}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Step dots ─── */}
        {step >= 1 && step <= 7 && !showHistory && !showWishlist && !showAccount && !showConfidence && (
          <div style={s.stepIndicator}>{Array.from({ length: 7 }).map((_, i) => (<div key={i} style={s.dot(step === i + 1, step > i + 1)} />))}</div>
        )}

       {/* ─── Step 1 ─── */}
{step === 1 && !showHistory && !showWishlist && !showAccount && !showConfidence && (
  <div>
    {customer && customer.lastMood && closet.length > 0 && (
      <div style={{ marginBottom: "40px", padding: "28px", background: "#eee9e2", borderRadius: "2px", textAlign: "center" }}>
        <p style={{ fontSize: "14px", color: "#8a7f75", margin: "0 0 8px", letterSpacing: "0.15em", textTransform: "uppercase" }}>Welcome back, {customer.firstName || "love"}</p>
        <p style={{ fontSize: "22px", fontStyle: "italic", margin: "0 0 20px" }}>Last time you were feeling {customer.lastMood} and wanted to feel {customer.lastFeeling}</p>
        <button style={s.quickBtn} onClick={quickRestyle}>✦ Style me again</button>
        <p style={{ fontSize: "12px", color: "#8a7f75", margin: "12px 0 0" }}>or start fresh below</p>
      </div>
    )}
    <div style={s.title}>Step 1 of 7</div>
    <p style={s.bigQ}>How are you feeling right now?</p>
    <input style={s.input} placeholder="e.g. tired, overwhelmed..." value={mood} onChange={e => setMood(e.target.value)} autoFocus />
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
      {VIBES.map(m => (
        <button key={m} style={s.chip(mood === m.toLowerCase())} onClick={() => setMood(m.toLowerCase())}>{m}</button>
      ))}
    </div>
    <div style={{ marginTop: "32px" }}><button style={s.btn} onClick={() => mood.trim() && setStep(2)}>Continue</button></div>
  </div>
)}

{/* ─── Step 2 ─── */}
{step === 2 && (
  <div>
    <div style={s.title}>Step 2 of 7</div>
    <p style={s.bigQ}>How do you want to feel?</p>
    <input style={s.input} placeholder="e.g. powerful, calm, confident..." value={feeling} onChange={e => setFeeling(e.target.value)} autoFocus />
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
      {FEELINGS.map(f => (
        <button key={f} style={s.chip(feeling === f.toLowerCase())} onClick={() => setFeeling(f.toLowerCase())}>{f}</button>
      ))}
    </div>
    <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
      <button style={s.outlineBtn} onClick={() => setStep(1)}>Back</button>
      <button style={s.btn} onClick={() => feeling.trim() && setStep(3)}>Continue</button>
    </div>
  </div>
)}

{/* ─── Step 3 ─── */}
{step === 3 && (
  <div>
    <div style={s.title}>Step 3 of 7</div>
    <p style={s.bigQ}>What are you dressing for?</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
      {["Casual", "Dinner", "Date", "Work", "Brunch", "Party", "Night out", "Wedding guest", "Travel", "Weekend", "Errands", "Event"].map(e => (
        <button key={e} style={s.chip(event === e.toLowerCase())} onClick={() => setEvent(e.toLowerCase())}>{e}</button>
      ))}
    </div>
    <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
      <button style={s.outlineBtn} onClick={() => setStep(2)}>Back</button>
      <button style={s.btn} onClick={() => event && setStep(4)}>Continue</button>
    </div>
  </div>
)}

{/* ─── Step 4 ─── */}
{step === 4 && (
  <div>
    <div style={s.title}>Step 4 of 7</div>
    <p style={s.bigQ}>Pick 1-3 that describe your style DNA</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
      {STYLE_DNA.map(d => (
        <button key={d} style={s.chip(styleDNA.includes(d))} onClick={() => {
          if (styleDNA.includes(d)) {
            setStyleDNA(styleDNA.filter(x => x !== d));
          } else if (styleDNA.length < 3) {
            setStyleDNA([...styleDNA, d]);
          }
        }}>{d}</button>
      ))}
    </div>
    <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
      <button style={s.outlineBtn} onClick={() => setStep(3)}>Back</button>
      <button style={s.btn} onClick={() => styleDNA.length > 0 && setStep(5)}>Continue</button>
    </div>
  </div>
)}

{/* ─── Step 5 ─── */}
{step === 5 && (
  <div>
    <div style={s.title}>Step 5 of 7</div>
    <p style={s.bigQ}>Any fit or body preferences?</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
      {BODY_PREFS.map(b => (
        <button key={b} style={s.chip(bodyPref === b)} onClick={() => setBodyPref(b)}>{b}</button>
      ))}
    </div>
    <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
      <button style={s.outlineBtn} onClick={() => setStep(4)}>Back</button>
      <button style={s.btn} onClick={() => setStep(6)}>Continue</button>
    </div>
  </div>
)}

{/* ─── Step 6 ─── */}
{step === 6 && (
  <div>
    <div style={s.title}>Step 6 of 7</div>
    <p style={s.bigQ}>What would you like to do?</p>
    <div onClick={() => setMode("recommend_naia")} style={s.modeCard(mode === "recommend_naia")}>
      <div style={{ fontSize: "17px", fontWeight: 500, marginBottom: "4px" }}>Find nAia pieces for what I own</div>
      <div style={{ fontSize: "14px", opacity: 0.7 }}>Upload pieces from your closet and we'll recommend the perfect nAia match</div>
    </div>
    <div onClick={() => setMode("closet_only")} style={s.modeCard(mode === "closet_only")}>
      <div style={{ fontSize: "17px", fontWeight: 500, marginBottom: "4px" }}>Style my closet pieces together</div>
      <div style={{ fontSize: "14px", opacity: 0.7 }}>We'll pick the best combination from your closet based on your mood</div>
    </div>
    <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
      <button style={s.outlineBtn} onClick={() => setStep(5)}>Back</button>
      <button style={s.btn} onClick={() => mode && setStep(7)}>Continue</button>
    </div>
  </div>
)}

{/* ─── Step 7 ─── */}
{step === 7 && (
  <div>
    <div style={s.title}>Step 7 of 7</div>
    <p style={s.bigQ}>{mode === "closet_only" ? "Add your pieces and we'll choose the best combination" : "Pick pieces from your closet"}</p>
    <div style={{ marginBottom: "32px" }}>
      <div style={{ ...s.resultLabel, marginBottom: "12px" }}>Your Closet{customer && closetSynced && <span style={{ color: "#7da563", marginLeft: "8px" }}>✓ Synced</span>}</div>
      {closet.length === 0 && <p style={{ color: "#8a7f75", fontSize: "15px", marginBottom: "16px" }}>Your closet is empty. Add a piece below.</p>}
      <div style={s.closetGrid}>
        {closet.map(piece => (
          <div key={piece.id} onClick={() => mode !== "closet_only" && toggleClosetItem(piece.id)} style={{ border: `2px solid ${selectedClosetIds.includes(piece.id) ? "#1a1816" : "#d4cfc9"}`, borderRadius: "2px", overflow: "hidden", cursor: mode !== "closet_only" ? "pointer" : "default" }}>
            {piece.image ? <img src={piece.image} alt={piece.name} style={{ width: "100%", height: "160px", objectFit: "cover", display: "block" }} /> : <div style={{ width: "100%", height: "160px", background: "#e8e4df", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: "#8a7f75" }}>{piece.category}</div>}
            <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ fontSize: "14px", fontWeight: 500 }}>{piece.name}</div><div style={{ fontSize: "12px", color: "#8a7f75" }}>{piece.category}</div></div>
              <button onClick={(e) => { e.stopPropagation(); removeClosetItem(piece.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#8a7f75", padding: "4px" }}>×</button>
            </div>
          </div>
        ))}
      </div>
      {!showAddItem ? (
        <button style={{ ...s.outlineBtn, marginTop: "16px", fontSize: "12px", padding: "10px 20px" }} onClick={() => setShowAddItem(true)}>+ Add piece</button>
      ) : (
        <div style={{ marginTop: "16px", padding: "20px", border: "1px solid #d4cfc9", borderRadius: "2px" }}>
          <input style={{ ...s.input, marginBottom: "12px" }} placeholder="Piece name (e.g. black blazer)" value={itemName} onChange={e => setItemName(e.target.value)} />
          <select style={{ ...s.input, marginBottom: "12px" }} value={itemCategory} onChange={e => setItemCategory(e.target.value)}><option value="top">Top</option><option value="bottom">Bottom</option><option value="outerwear">Outerwear</option><option value="dress">Dress</option><option value="shoes">Shoes</option><option value="accessory">Accessory</option></select>
          <input id="closet-file-input" type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
          {itemImage ? (
            <div style={{ marginBottom: "12px", position: "relative", display: "inline-block" }}><img src={itemImage} alt="Preview" style={{ width: "100px", height: "100px", objectFit: "cover", borderRadius: "4px", display: "block" }} /><button onClick={() => setItemImage("")} style={{ position: "absolute", top: "-6px", right: "-6px", width: "20px", height: "20px", borderRadius: "50%", background: "#1a1816", color: "#fff", border: "none", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button></div>
          ) : (
            <button type="button" onClick={() => document.getElementById("closet-file-input").click()} style={{ ...s.outlineBtn, fontSize: "12px", padding: "10px 20px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M3 17l5-5 3 2.5 4-5 6 7.5"/></svg>Add photo (optional)</button>
          )}
          <div style={{ display: "flex", gap: "10px" }}><button style={s.btn} onClick={addItem}>Add</button><button style={s.outlineBtn} onClick={() => { setShowAddItem(false); setItemImage(""); }}>Cancel</button></div>
        </div>
      )}
    </div>
    <div style={{ display: "flex", gap: "12px" }}><button style={s.outlineBtn} onClick={() => setStep(6)}>Back</button><button style={s.btn} onClick={callAI}>Style this look</button></div>
  </div>
)}

        {/* ─── Step 8: Results ─── */}
        {step === 8 && (
          <div>
            <div style={s.title}>Your Styling</div>
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginBottom: "24px" }}>{[0, 1, 2].map(i => (<div key={i} style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#1a1816", animation: `naiaPulse 1.4s ease-in-out ${i * 0.2}s infinite` }} />))}</div>
                <p key={loadingPhrase} style={{ fontSize: "20px", fontStyle: "italic", color: "#8a7f75", animation: "naiaFadeIn 0.5s ease" }}>{LOADING_PHRASES[loadingPhrase]}</p>
                <style>{`@keyframes naiaPulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1.2)}}@keyframes naiaFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
              </div>
            ) : parsedResult && (parsedResult.feelingNow || parsedResult.outfitDirection.length > 0) ? (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px", marginBottom: "24px" }}>
                  <div><div style={s.resultLabel}>You're feeling</div><div style={s.resultValue}>{parsedResult.feelingNow}</div></div>
                  <div><div style={s.resultLabel}>You want to feel</div><div style={s.resultValue}>{parsedResult.feelingNext}</div></div>
                  <div><div style={s.resultLabel}>Dressing for</div><div style={s.resultValue}>{event}</div></div>
                </div>
                <div style={s.divider} />
                <div style={{ marginBottom: "24px" }}><div style={s.resultLabel}>Your outfit direction</div>{parsedResult.outfitDirection.map((item, i) => (<p key={i} style={{ fontSize: "17px", lineHeight: 1.7, margin: "0 0 8px", paddingLeft: "16px", borderLeft: "2px solid #d4cfc9" }}>{item}</p>))}</div>
                <div style={s.divider} />
                <div style={{ marginBottom: "24px" }}><div style={s.resultLabel}>Why this works</div>{parsedResult.whyThisWorks.map((item, i) => (<p key={i} style={{ fontSize: "15px", lineHeight: 1.7, margin: "0 0 6px", color: "#4a4540" }}>{item}</p>))}</div>

                {parsedResult.naiaRecommendations?.length > 0 && (<><div style={s.divider} /><div style={{ marginBottom: "24px" }}><div style={s.resultLabel}>nAia Recommendations</div>{parsedResult.naiaRecommendations.map((item, i) => (<p key={i} style={{ fontSize: "15px", lineHeight: 1.7, margin: "0 0 10px", paddingLeft: "16px", borderLeft: "2px solid #1a1816" }}>{item}</p>))}</div></>)}

                {(parsedResult.accessories || parsedResult.perfume || parsedResult.song) && (<><div style={s.divider} /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "24px" }}>{parsedResult.accessories && <div style={s.vibeCard}><div style={s.resultLabel}>Accessories</div><p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>{parsedResult.accessories}</p></div>}{parsedResult.perfume && <div style={s.vibeCard}><div style={s.resultLabel}>Perfume</div><p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>{parsedResult.perfume}</p></div>}{parsedResult.song && <div style={s.vibeCard}><div style={s.resultLabel}>Song</div><p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>{parsedResult.song}</p></div>}</div></>)}
                {parsedResult.hair && <div style={s.vibeCard}><div style={s.resultLabel}>Hair</div><p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>{parsedResult.hair}</p></div>}
                {parsedResult.makeup && <div style={s.vibeCard}><div style={s.resultLabel}>Makeup</div><p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>{parsedResult.makeup}</p></div>}.    
                {parsedResult.shift && (<><div style={s.divider} /><div style={{ marginBottom: "24px" }}><div style={s.resultLabel}>The shift</div><p style={{ fontSize: "19px", fontStyle: "italic", lineHeight: 1.6, margin: 0 }}>{parsedResult.shift}</p></div></>)}

                {/* ─── Shop recommended pieces ─── */}
                {(mode === "recommend_naia" || mode === "closet_naia") && naiaProducts.length > 0 && parsedResult.naiaRecommendations?.length > 0 && (
                  <>
                    <div style={s.divider} />
                    <div style={s.resultLabel}>Shop recommended pieces</div>
                    <div style={{ margin: "12px 0 16px", padding: "16px", background: "#eee9e2", borderRadius: "2px" }}>
                      <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "8px" }}>Virtual Try-On</div>
                      {tryOnPhoto ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <img src={tryOnPhoto} alt="Your photo" style={{ width: "60px", height: "60px", objectFit: "cover", borderRadius: "2px" }} />
                          <div><div style={{ fontSize: "13px", marginBottom: "4px" }}>Photo ready</div><button style={{ fontSize: "12px", color: "#8a7f75", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }} onClick={() => setTryOnPhoto(null)}>Change photo</button></div>
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontSize: "13px", color: "#4a4540", margin: "0 0 8px" }}>Upload a photo of yourself to try on recommended pieces</p>
                          <input id="tryon-photo-input" type="file" accept="image/*" onChange={handleTryOnPhotoUpload} style={{ display: "none" }} />
                          <button style={{ ...s.outlineBtn, fontSize: "11px", padding: "8px 16px" }} onClick={() => document.getElementById("tryon-photo-input").click()}>Upload photo</button>
                        </div>
                      )}
                    </div>
                    <div style={s.productGrid}>
                      {naiaProducts.filter(p => parsedResult.naiaRecommendations.some(r => r.toLowerCase().includes(p.title.toLowerCase()))).map(p => {
                        const tryOn = tryOnState[p.title];
                        return (
                          <div key={p.id} style={{ border: "1px solid #d4cfc9", borderRadius: "2px", overflow: "hidden", position: "relative" }}>
                            <a href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}><img src={p.image} alt={p.title} style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} /><div style={{ padding: "8px", fontSize: "12px" }}>{p.title}</div></a>
                            {customer && (<button style={{ ...s.heartBtn(wishlistIds.has(String(p.id))), position: "absolute", top: "6px", right: "6px", background: "rgba(255,255,255,0.8)", borderRadius: "50%", width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlist(p); }}>{wishlistIds.has(String(p.id)) ? "♥" : "♡"}</button>)}
                            {tryOnPhoto && (<div style={{ padding: "0 8px 8px" }}>{tryOn?.loading ? (<div style={{ fontSize: "11px", color: "#8a7f75", textAlign: "center", padding: "8px" }}>Trying on...</div>) : tryOn?.result ? (<img src={tryOn.result} alt="Try-on result" style={{ width: "100%", borderRadius: "2px", marginTop: "4px" }} />) : (<button style={s.tryOnBtn} onClick={() => startTryOn(p.title, p.image)}>Try this on</button>)}{tryOn?.error && (<div style={{ fontSize: "11px", color: "#c5553a", marginTop: "4px" }}>{tryOn.error}</div>)}</div>)}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* ─── Confidence Rating ─── */}
                {customer && lastHistoryId && (
                  <>
                    <div style={s.divider} />
                    <ConfidenceRating
                      historyId={lastHistoryId}
                      customerToken={customerToken}
                      mood={mood} feeling={feeling} event={event} styleWords={styleWords}
                    />
                  </>
                )}

                <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
                  <button style={s.outlineBtn} onClick={resetAll}>Start over</button>
                  <button style={s.btn} onClick={callAI}>✦ New look, same vibe</button>
                  {customer && (<button style={{ ...s.outlineBtn, opacity: 0.6 }} disabled>✓ Saved to history</button>)}
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: "18px", fontStyle: "italic", whiteSpace: "pre-line", lineHeight: 1.8 }}>{stylingResult}</p>
                <button style={{ ...s.outlineBtn, marginTop: "24px" }} onClick={() => setStep(7)}>Try again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

