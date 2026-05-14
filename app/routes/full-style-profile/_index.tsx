import { useState, useEffect } from "react";
import { useNavigate } from "react-router";

export default function FullStyleProfile() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [profile, setProfile] = useState({
    styleDNA: [],
    preferredSilhouettes: [],
    preferredColors: [],
    fitPreferences: [],
    stylingBoldness: 5,
    generalComfortPreferences: [],
    aestheticPreferences: [],
    avoidList: [],
    styleGoals: []
  });

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/customer-profile");
        if (res.ok) {
          const data = await res.json();
          setCustomer(data.customer);
          
          const profileRes = await fetch("/api/full-style-profile");
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            if (profileData.profile) {
              setProfile(profileData.profile);
            }
          }
        } else {
          alert("Please log in to create your Style Profile");
          window.location.href = "/account/login";
        }
      } catch (err) {
        console.error("Auth check error:", err);
        alert("Please log in to create your Style Profile");
        window.location.href = "/account/login";
      }
      setAuthLoading(false);
    }
    checkAuth();
  }, []);

  const steps = [
    { id: 1, title: "Style DNA", question: "Which style personalities resonate with you?" },
    { id: 2, title: "Silhouettes", question: "What silhouettes do you gravitate toward?" },
    { id: 3, title: "Colors", question: "What colors do you love wearing?" },
    { id: 4, title: "Fit Preferences", question: "What fits make you feel confident?" },
    { id: 5, title: "Styling Boldness", question: "How bold do you like your style?" },
    { id: 6, title: "Comfort Preferences", question: "What makes you feel comfortable generally?" },
    { id: 7, title: "Aesthetic", question: "What aesthetic speaks to you?" },
    { id: 8, title: "Avoid List", question: "Anything you prefer to avoid?" },
    { id: 9, title: "Style Goals", question: "What are your style goals?" }
  ];

  const options = {
    styleDNA: [
      "Classic", "Minimal", "Feminine", "Edgy", "Relaxed", 
      "Polished", "Romantic", "Artistic", "Streetwear", 
      "Statement", "Modern", "Refined"
    ],
    preferredSilhouettes: [
      "Tailored blazers", "Flowing maxi skirts", "Wide-leg pants", 
      "Fitted knits", "Oversized coats", "Midi dresses", 
      "Structured bags", "Statement sleeves", "High-waisted bottoms",
      "Asymmetric cuts", "Layered looks", "Monochrome"
    ],
    preferredColors: [
      "Black", "White", "Cream", "Beige", "Brown", "Burgundy",
      "Navy", "Grey", "Olive", "Rust", "Camel", "Emerald", "Prints"
    ],
    fitPreferences: [
      "Highlight waist", "Elongate legs", "Balance shoulders", 
      "Skim the body", "Define shape", "Add structure", 
      "Minimize cling", "Create ease", "Maximize volume"
    ],
    generalComfortPreferences: [
      "Natural fabrics only", "Nothing tight", "Coverage over arms",
      "High necklines", "Breathable materials", "Stretch fabrics",
      "Loose silhouettes", "Structured pieces", "Soft textures"
    ],
    aestheticPreferences: [
      "Timeless elegance", "Editorial drama", "Effortless chic",
      "Power dressing", "Soft femininity", "Art-led",
      "Minimalist", "Maximalist", "Vintage inspired", "Future forward"
    ],
    avoidList: [
      "Ruffles", "Crop tops", "Skinny jeans", "Bright prints",
      "Loud colors", "Sheer fabrics", "Super high heels",
      "Overly trendy pieces", "Fast fashion", "Synthetic materials"
    ],
    styleGoals: [
      "Build a capsule wardrobe", "Invest in quality pieces",
      "Develop signature style", "Dress more confidently",
      "Simplify my closet", "Explore new aesthetics",
      "Dress for my body", "Feel more put together",
      "Express my personality", "Elevate everyday style"
    ]
  };

  const handleSelect = (value) => {
    const currentField = getCurrentField();
    
    if (currentField === "stylingBoldness") {
      setProfile({ ...profile, [currentField]: value });
    } else {
      const updated = profile[currentField].includes(value)
        ? profile[currentField].filter(v => v !== value)
        : [...profile[currentField], value];
      setProfile({ ...profile, [currentField]: updated });
    }
  };

  const getCurrentField = () => {
    const fieldMap = {
      1: "styleDNA",
      2: "preferredSilhouettes",
      3: "preferredColors",
      4: "fitPreferences",
      5: "stylingBoldness",
      6: "generalComfortPreferences",
      7: "aestheticPreferences",
      8: "avoidList",
      9: "styleGoals"
    };
    return fieldMap[step];
  };

  const handleNext = () => {
    if (step < steps.length) {
      setStep(step + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/full-style-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile)
      });
      
      if (res.ok) {
        alert("Style Profile saved!");
        navigate("/closet");
      } else {
        alert("Failed to save profile. Please try again.");
      }
    } catch (err) {
      console.error("Profile save error:", err);
      alert("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  if (authLoading) {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <p style={{ textAlign: "center", fontSize: "16px" }}>Loading...</p>
        </div>
      </div>
    );
  }

  const currentStep = steps[step - 1];
  const currentField = getCurrentField();
  const currentValue = profile[currentField];

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,400;1,400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={s.grain} />
      
      <div style={s.container}>
        <div style={s.header}>
          <div style={s.logo}>nAia</div>
          <div style={s.headerTitle}>Build Your Style Profile</div>
          <div style={s.subheader}>Your permanent style identity — answer once, use forever</div>
        </div>

        <div style={s.progress}>
          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${(step / steps.length) * 100}%` }} />
          </div>
          <div style={s.progressText}>Step {step} of {steps.length}</div>
        </div>

        <div style={s.questionSection}>
          <div style={s.stepTitle}>{currentStep.title}</div>
          <div style={s.question}>{currentStep.question}</div>
        </div>

        <div style={s.optionsGrid}>
          {currentField === "stylingBoldness" ? (
            <div style={s.scale}>
              <div style={s.scaleLabel}>Subtle</div>
              {[1,2,3,4,5,6,7,8,9,10].map(val => (
                <div
                  key={val}
                  style={s.scaleOption(currentValue === val)}
                  onClick={() => handleSelect(val)}
                >
                  {val}
                </div>
              ))}
              <div style={s.scaleLabel}>Bold</div>
            </div>
          ) : (
            options[currentField]?.map(option => (
              <div
                key={option}
                style={s.chip(Array.isArray(currentValue) && currentValue.includes(option))}
                onClick={() => handleSelect(option)}
              >
                {option}
              </div>
            ))
          )}
        </div>

        <div style={s.nav}>
          {step > 1 && (
            <button style={s.backBtn} onClick={handleBack}>Back</button>
          )}
          <button 
            style={s.nextBtn} 
            onClick={handleNext}
            disabled={loading}
          >
            {loading ? "Saving..." : step === steps.length ? "Complete Profile" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: "100vh", background: "#f4f4f1", color: "#221516", fontFamily: '"Cormorant Garamond", serif' },
  grain: { content: '', position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, opacity: 0.03, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", backgroundSize: '200px' },
  container: { maxWidth: "680px", margin: "0 auto", padding: "56px 32px 100px" },
  header: { marginBottom: "48px", textAlign: "center" },
  logo: { fontSize: "22px", fontStyle: "italic", fontWeight: 400, fontFamily: '"Playfair Display", serif', letterSpacing: "3px", marginBottom: "16px" },
  headerTitle: { fontSize: "14px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8b2035", fontFamily: '"Space Mono", monospace', marginBottom: "8px" },
  subheader: { fontSize: "12px", color: "#8b7f75", fontStyle: "italic" },
  progress: { marginBottom: "56px" },
  progressBar: { width: "100%", height: "2px", background: "#e1dbd7", marginBottom: "12px" },
  progressFill: { height: "100%", background: "#3b0510", transition: "width 0.3s cubic-bezier(0.16, 1, 0.3, 1)" },
  progressText: { fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#c8a96e", fontFamily: '"Space Mono", monospace', textAlign: "center" },
  questionSection: { marginBottom: "40px" },
  stepTitle: { fontSize: "11px", letterSpacing: "0.3em", textTransform: "uppercase", color: "#c8a96e", marginBottom: "16px", fontFamily: '"Space Mono", monospace', textAlign: "center" },
  question: { fontSize: "36px", lineHeight: 1.2, fontWeight: 400, fontStyle: "italic", fontFamily: '"Playfair Display", serif', letterSpacing: "-0.5px", textAlign: "center" },
  optionsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px", marginBottom: "48px" },
  chip: (active) => ({ padding: "14px 20px", background: active ? "#221516" : "transparent", color: active ? "#f4f4f1" : "#221516", border: `1px solid ${active ? "#221516" : "rgba(34,21,22,0.12)"}`, fontSize: "15px", letterSpacing: "0.03em", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)", fontStyle: "italic", textAlign: "center" }),
  scale: { display: "flex", gap: "8px", justifyContent: "center", alignItems: "center", flexWrap: "wrap" },
  scaleLabel: { fontSize: "12px", color: "#8b7f75", fontFamily: '"Space Mono", monospace', textTransform: "uppercase", letterSpacing: "0.2em" },
  scaleOption: (active) => ({ width: "48px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", background: active ? "#3b0510" : "transparent", color: active ? "#f4f4f1" : "#221516", border: `1px solid ${active ? "#3b0510" : "rgba(59,5,16,0.2)"}`, fontSize: "16px", fontWeight: 400, cursor: "pointer", transition: "all 0.3s", fontFamily: '"Space Mono", monospace' }),
  nav: { display: "flex", gap: "16px", justifyContent: "center" },
  backBtn: { padding: "16px 40px", background: "transparent", color: "#221516", border: "1px solid rgba(34,21,22,0.2)", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Space Mono", monospace' },
  nextBtn: { padding: "16px 40px", background: "#3b0510", color: "#f4f4f1", border: "none", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Space Mono", monospace' }
};