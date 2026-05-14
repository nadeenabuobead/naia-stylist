import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";

export default function QuickStyle() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [preselectedProduct, setPreselectedProduct] = useState(null);

  useEffect(() => {
    const productFromState = location.state?.product;
    const urlParams = new URLSearchParams(location.search);
    const productFromUrl = urlParams.get("product");
    
    if (productFromState) {
      setPreselectedProduct(productFromState);
    } else if (productFromUrl) {
      try {
        setPreselectedProduct(JSON.parse(decodeURIComponent(productFromUrl)));
      } catch (err) {
        console.error("Failed to parse product from URL:", err);
      }
    }
  }, [location]);
  
  const [step, setStep] = useState(1);
  const [session, setSession] = useState({
    currentMood: "",
    desiredMood: "",
    occasion: "",
    bodyComfortToday: [],
    stylingSource: "nAia only",
    uploadedItem: null
  });
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [guestSession, setGuestSession] = useState(null);

  useEffect(() => {
    async function loadCustomer() {
      try {
        const res = await fetch("/api/customer-profile");
        if (res.ok) {
          const data = await res.json();
          setCustomer(data.customer);
        } else {
          setGuestSession(`guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
        }
      } catch (err) {
        setGuestSession(`guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
      }
    }
    loadCustomer();
  }, []);

  const steps = [
    { id: 1, question: "How are you feeling today?", field: "currentMood" },
    { id: 2, question: "How do you want to feel?", field: "desiredMood" },
    { id: 3, question: "What's the occasion?", field: "occasion" },
    { id: 4, question: "Any body comfort needs today?", field: "bodyComfortToday" },
    { id: 5, question: "What do you want to style from?", field: "stylingSource" }
  ];

  const options = {
    currentMood: ["Overwhelmed", "Tired", "Uninspired", "Neutral", "Confident", "Excited", "Powerful"],
    desiredMood: ["Confident", "Comfortable", "Polished", "Powerful", "Effortless", "Bold", "Relaxed"],
    occasion: ["Work", "Meeting", "Date", "Event", "Casual", "Travel", "Special Occasion"],
    bodyComfortToday: [
      "Feeling bloated", "Want more coverage", "Want waist definition", 
      "Want something relaxed", "Want something structured", 
      "Want to feel taller", "Want to feel balanced", "Feeling great"
    ],
    stylingSource: ["nAia only", "My closet only", "nAia + My closet"]
  };

  const handleSelect = (value) => {
    const currentField = steps[step - 1].field;
    if (currentField === "bodyComfortToday") {
      const updated = session[currentField].includes(value)
        ? session[currentField].filter(v => v !== value)
        : [...session[currentField], value];
      setSession({ ...session, [currentField]: updated });
    } else {
      setSession({ ...session, [currentField]: value });
    }
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
      const res = await fetch("/api/quick-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...session,
          preselectedProduct,
          customerId: customer?.id,
          guestSessionId: guestSession,
          isGuest: !customer
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        navigate("/quick-style/result", { 
          state: { 
            result: data.result,
            session,
            isGuest: !customer,
            guestSessionId: guestSession
          } 
        });
      } else {
        alert("Styling failed. Please try again.");
      }
    } catch (err) {
      console.error("Styling error:", err);
      alert("Something went wrong.");
    }
    setLoading(false);
  };

  const currentStep = steps[step - 1];
  const currentField = currentStep.field;
  const currentValue = session[currentField];

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,400;1,400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={s.grain} />
      
      <div style={s.container}>
        <div style={s.header}>
          <div style={s.logo}>nAia</div>
          <div style={s.headerTitle}>Style Me</div>
        </div>

        <div style={s.progress}>
          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${(step / steps.length) * 100}%` }} />
          </div>
          <div style={s.progressText}>Step {step} of {steps.length}</div>
        </div>

        {preselectedProduct && (
          <div style={s.productBanner}>
            Styling: {preselectedProduct.title}
          </div>
        )}

        <div style={s.questionSection}>
          <div style={s.question}>{currentStep.question}</div>
        </div>

        <div style={s.optionsGrid}>
          {options[currentField]?.map(option => (
            <div
              key={option}
              style={s.chip(
                currentField === "bodyComfortToday" 
                  ? currentValue.includes(option)
                  : currentValue === option
              )}
              onClick={() => handleSelect(option)}
            >
              {option}
            </div>
          ))}
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
            {loading ? "Styling..." : step === steps.length ? "Get My Look" : "Next"}
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
  headerTitle: { fontSize: "14px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8b2035", fontFamily: '"Space Mono", monospace' },
  progress: { marginBottom: "56px" },
  progressBar: { width: "100%", height: "2px", background: "#e1dbd7", marginBottom: "12px" },
  progressFill: { height: "100%", background: "#3b0510", transition: "width 0.3s cubic-bezier(0.16, 1, 0.3, 1)" },
  progressText: { fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#c8a96e", fontFamily: '"Space Mono", monospace', textAlign: "center" },
  productBanner: { padding: "16px", background: "#3b0510", color: "#f4f4f1", textAlign: "center", marginBottom: "32px", fontSize: "14px", letterSpacing: "0.1em", fontStyle: "italic" },
  questionSection: { marginBottom: "40px" },
  question: { fontSize: "36px", lineHeight: 1.2, fontWeight: 400, fontStyle: "italic", fontFamily: '"Playfair Display", serif', letterSpacing: "-0.5px", textAlign: "center" },
  optionsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px", marginBottom: "48px" },
  chip: (active) => ({ padding: "14px 20px", background: active ? "#221516" : "transparent", color: active ? "#f4f4f1" : "#221516", border: `1px solid ${active ? "#221516" : "rgba(34,21,22,0.12)"}`, fontSize: "15px", letterSpacing: "0.03em", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)", fontStyle: "italic", textAlign: "center" }),
  nav: { display: "flex", gap: "16px", justifyContent: "center" },
  backBtn: { padding: "16px 40px", background: "transparent", color: "#221516", border: "1px solid rgba(34,21,22,0.2)", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Space Mono", monospace' },
  nextBtn: { padding: "16px 40px", background: "#3b0510", color: "#f4f4f1", border: "none", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Space Mono", monospace' }
};