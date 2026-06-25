import { useState, useEffect, useCallback } from "react";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { OnboardingAnswers } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const op = customer.onboardingProfile;
  const existingAnswers: OnboardingAnswers = {};
  if (op) {
    if (op.stylePersonalities.length) existingAnswers["style-personalities"] = op.stylePersonalities;
    if (op.favoriteColors.length)     existingAnswers["favorite-colors"]     = op.favoriteColors;
    if (op.avoidColors.length)        existingAnswers["avoid-colors"]        = op.avoidColors;
    if (op.lifestyle)                 existingAnswers["lifestyle"]           = op.lifestyle.split(", ").filter(Boolean);
    if (op.fitPreferences.length)     existingAnswers["fit-preferences"]     = op.fitPreferences;
  }
  return { existingAnswers };
}

function generateStyleSummary(answers: OnboardingAnswers) {
  const personalities = answers["style-personalities"] || [];
  const primaryStyle = personalities[0] || "effortlessly-chic";

  const summaries: Record<string, { title: string; description: string }> = {
    "old-money": { title: "The Timeless Classic", description: "You appreciate quality, heritage, and understated elegance." },
    "artsy": { title: "The Creative Spirit", description: "You express yourself through unique pieces and artistic flair." },
    "edgy": { title: "The Bold Rebel", description: "You're not afraid to make a statement and push boundaries." },
    "feminine": { title: "The Soft Romantic", description: "You're drawn to delicate details and graceful silhouettes." },
    "corporate-chic": { title: "The Polished Professional", description: "You blend sophistication with modern elegance." },
    "effortlessly-chic": { title: "The Natural Stylist", description: "You make looking put-together seem completely effortless." },
    "minimal": { title: "The Modern Minimalist", description: "You believe in the power of simplicity and intentional pieces." },
    "trendy": { title: "The Fashion Forward", description: "You love staying ahead of the curve and experimenting with new styles." },
    "romantic": { title: "The Dreamer", description: "You're drawn to soft, feminine pieces that tell a story." },
    "casual-cool": { title: "The Relaxed Stylist", description: "You master the art of looking good without trying too hard." },
  };

  const summary = summaries[primaryStyle] || summaries["effortlessly-chic"];
  const traits: string[] = answers["desired-feelings"]?.map(f => f.charAt(0).toUpperCase() + f.slice(1)) || [];
  return { ...summary, traits };
}

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .cp-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .cp-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .cp-main{max-width:700px;margin:0 auto;padding:48px 40px 80px}
  .cp-eyebrow{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  .cp-headline{font-family:var(--ff-display);font-size:clamp(28px,4vw,42px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:8px;line-height:1.1}
  .cp-desc{font-family:var(--ff-body);font-size:20px;font-style:italic;color:var(--muted);margin-bottom:40px;line-height:1.5}
  .cp-section-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
  .cp-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:40px}
  .cp-pill{padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);background:transparent}
  .cp-divider{height:1px;background:rgba(59,5,16,.08);margin:40px 0}
  .cp-action{display:flex;align-items:center;gap:20px;padding:24px;border:1px solid rgba(59,5,16,.1);text-decoration:none;margin-bottom:10px;transition:border-color .2s}
  .cp-action:hover{border-color:var(--deep)}
  .cp-action-title{font-family:var(--ff-display);font-size:20px;font-weight:700;color:var(--deep);margin-bottom:4px}
  .cp-action-sub{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted)}
  .cp-arrow{font-family:var(--ff-mono);font-size:12px;color:var(--accent);margin-left:auto;flex-shrink:0}
  .cp-status{padding:12px 40px;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;display:flex;align-items:center;gap:16px;border-bottom:1px solid rgba(59,5,16,.06)}
  .cp-status-saving{color:var(--muted);background:rgba(59,5,16,.02)}
  .cp-status-error{color:var(--accent);background:rgba(139,32,53,.06)}
  .cp-status-btn{padding:6px 14px;border:1px solid currentColor;background:transparent;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:inherit;cursor:pointer}
`;

type SaveStatus = "saving" | "saved" | "error";

export default function OnboardingComplete() {
  const { existingAnswers } = useLoaderData<typeof loader>();
  const [styleSummary, setStyleSummary] = useState<{ title: string; description: string; traits: string[] } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saving");

  const attemptSave = useCallback(async (quizAnswers: OnboardingAnswers) => {
    setSaveStatus("saving");
    // DB values are the base; quiz answers (from localStorage) override per-field.
    // Guards against a cleared localStorage overwriting existing profile fields.
    const body = { ...existingAnswers, ...quizAnswers };
    try {
      const res = await fetch("/api/save-style-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stylePersonalities: body["style-personalities"] ?? [],
          favoriteColors:     body["favorite-colors"]     ?? [],
          avoidColors:        body["avoid-colors"]        ?? [],
          lifestyle:          body["lifestyle"]           ?? [],
          fitPreferences:     body["fit-preferences"]     ?? [],
        }),
      });
      if (!res.ok) {
        setSaveStatus("error");
        return;
      }
      localStorage.removeItem("naia_onboarding");
      window.location.href = "/";
    } catch {
      setSaveStatus("error");
    }
  }, [existingAnswers]);

  useEffect(() => {
    const stored = localStorage.getItem("naia_onboarding");
    const answers: OnboardingAnswers = (() => {
      try { return stored ? JSON.parse(stored) : {}; } catch { return {}; }
    })();

    // Always compute and show the style summary immediately, regardless of save outcome.
    setStyleSummary(generateStyleSummary(answers));

    // Always attempt save; the merge in attemptSave ensures DB fields are preserved
    // even when localStorage is empty or partial.
    attemptSave(answers);
  }, [attemptSave]);

  const handleRetry = useCallback(() => {
    const stored = localStorage.getItem("naia_onboarding");
    try {
      const answers: OnboardingAnswers = stored ? JSON.parse(stored) : {};
      attemptSave(answers);
    } catch {}
  }, [attemptSave]);

  if (!styleSummary) return <div style={{ minHeight: "100vh", background: "#f4f4f1" }} />;

  return (
    <div>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="cp-topbar">
        <div className="cp-topbar-logo">nAia</div>
      </div>

      {saveStatus === "saving" && (
        <div className="cp-status cp-status-saving">
          Saving your style profile…
        </div>
      )}

      {saveStatus === "error" && (
        <div className="cp-status cp-status-error">
          Could not save your profile —{" "}
          <button type="button" className="cp-status-btn" onClick={handleRetry}>
            Try again
          </button>
          <span style={{ color: "var(--muted)", fontSize: "9px" }}>
            (your answers are preserved)
          </span>
        </div>
      )}

      <main className="cp-main">
        <div className="cp-eyebrow">Your Style Profile</div>
        <h1 className="cp-headline">{styleSummary.title}</h1>
        <p className="cp-desc">{styleSummary.description}</p>

        {styleSummary.traits.length > 0 && (
          <>
            <div className="cp-section-label">You want to feel</div>
            <div className="cp-pills">
              {styleSummary.traits.map(trait => (
                <span key={trait} className="cp-pill">{trait}</span>
              ))}
            </div>
          </>
        )}

        <div className="cp-divider" />

        <div className="cp-section-label">What would you like to do first?</div>

        <a href="/quick-style" className="cp-action">
          <div>
            <div className="cp-action-title">Style Me</div>
            <div className="cp-action-sub">Get outfit ideas based on your mood</div>
          </div>
          <span className="cp-arrow">→</span>
        </a>

        <a href="/closet" className="cp-action">
          <div>
            <div className="cp-action-title">Digital Wardrobe</div>
            <div className="cp-action-sub">Upload your pieces for personalized styling</div>
          </div>
          <span className="cp-arrow">→</span>
        </a>

        <a href="/" className="cp-action">
          <div>
            <div className="cp-action-title">View Dashboard</div>
            <div className="cp-action-sub">Explore all features</div>
          </div>
          <span className="cp-arrow">→</span>
        </a>
      </main>
    </div>
  );
}
