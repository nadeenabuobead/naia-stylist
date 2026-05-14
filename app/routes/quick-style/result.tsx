import { useLocation, useNavigate } from "react-router";
import { useState } from "react";

export default function QuickStyleResult() {
  const location = useLocation();
  const navigate = useNavigate();
  const { result, session, isGuest, guestSessionId } = location.state || {};
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!result) {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <p>No styling result found. Please start a new session.</p>
          <button onClick={() => navigate("/quick-style")} style={s.nextBtn}>
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  const handleSaveLook = async () => {
    if (isGuest) {
      setShowAuthModal(true);
    } else {
      setSaving(true);
      try {
        await fetch("/api/save-look", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result, session })
        });
        alert("Look saved!");
      } catch (err) {
        console.error("Save error:", err);
        alert("Failed to save look");
      }
      setSaving(false);
    }
  };

  const handleCreateAccount = () => {
    localStorage.setItem("pending-style-session", JSON.stringify({ result, session, guestSessionId }));
    window.location.href = "/account/register";
  };

  const handleLogin = () => {
    localStorage.setItem("pending-style-session", JSON.stringify({ result, session, guestSessionId }));
    window.location.href = "/account/login";
  };

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,400;1,400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={s.grain} />
      
      <div style={s.container}>
        <div style={s.header}>
          <div style={s.logo}>nAia</div>
          <div style={s.headerTitle}>Your Look</div>
        </div>

        <div style={s.resultBox}>
          <div style={s.resultText}>{result}</div>
        </div>

        <div style={s.actions}>
          {isGuest ? (
            <>
              <button style={s.primaryBtn} onClick={handleSaveLook}>
                Save Your Look & Build Your Style Profile
              </button>
              <p style={s.hint}>Create an account to save this look and get personalized recommendations</p>
            </>
          ) : (
            <>
              <button style={s.primaryBtn} onClick={handleSaveLook} disabled={saving}>
                {saving ? "Saving..." : "Save This Look"}
              </button>
              <button style={s.secondaryBtn} onClick={() => navigate("/quick-style")}>
                Style Another Look
              </button>
            </>
          )}
        </div>

        {showAuthModal && (
          <div style={s.modal}>
            <div style={s.modalContent}>
              <div style={s.modalHeader}>
                <div style={s.modalTitle}>Save Your Look</div>
                <button style={s.closeBtn} onClick={() => setShowAuthModal(false)}>×</button>
              </div>
              
              <div style={s.modalBody}>
                <p style={s.modalText}>
                  Create your nAia account to save this look and unlock:
                </p>
                <ul style={s.benefits}>
                  <li>Personalized styling recommendations</li>
                  <li>Your digital wardrobe</li>
                  <li>Saved looks library</li>
                  <li>Your unique Style Profile</li>
                </ul>
              </div>

              <div style={s.modalActions}>
                <button style={s.primaryBtn} onClick={handleCreateAccount}>
                  Create Account
                </button>
                <button style={s.secondaryBtn} onClick={handleLogin}>
                  I Have an Account
                </button>
              </div>
            </div>
          </div>
        )}
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
  resultBox: { background: "white", padding: "48px 32px", marginBottom: "40px", borderRadius: "2px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
  resultText: { fontSize: "16px", lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: '"Cormorant Garamond", serif' },
  actions: { display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" },
  primaryBtn: { padding: "16px 40px", background: "#3b0510", color: "#f4f4f1", border: "none", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Space Mono", monospace', width: "100%", maxWidth: "400px" },
  secondaryBtn: { padding: "16px 40px", background: "transparent", color: "#221516", border: "1px solid rgba(34,21,22,0.2)", fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Space Mono", monospace', width: "100%", maxWidth: "400px" },
  hint: { fontSize: "13px", color: "#8b7f75", textAlign: "center", fontStyle: "italic", marginTop: "8px" },
  modal: { position: "fixed", inset: 0, background: "rgba(34,21,22,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 },
  modalContent: { background: "#f4f4f1", maxWidth: "500px", width: "90%", padding: "40px", borderRadius: "2px" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" },
  modalTitle: { fontSize: "24px", fontStyle: "italic", fontFamily: '"Playfair Display", serif' },
  closeBtn: { background: "none", border: "none", fontSize: "32px", cursor: "pointer", color: "#221516", lineHeight: 1 },
  modalBody: { marginBottom: "32px" },
  modalText: { fontSize: "15px", lineHeight: 1.6, marginBottom: "16px" },
  benefits: { listStyle: "none", padding: 0, fontSize: "14px", lineHeight: 1.8 },
  modalActions: { display: "flex", flexDirection: "column", gap: "12px" }
};