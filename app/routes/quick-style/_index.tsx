// app/routes/quick-style/_index.tsx
//
// Public guest teaser. Approved product decision 2026-11-16: /quick-style is
// a free, no-sign-up taste of style direction — three questions, one
// deterministic insight, then a clear hand-off to nAia Membership for full
// AI styling. It is intentionally NOT a path into canonical StyleMe:
//
//   - no loader, no action, no Form submission — nothing here calls the
//     server, writes a session cookie, or redirects into /style-me/result
//   - no database access of any kind — a guest's three answers live only in
//     this component's React state and are discarded on navigation away
//   - no AI provider call (Anthropic, OpenAI, or otherwise) — the insight
//     comes from app/lib/quick-style/insight.ts, a pure lookup+template
//   - no file/image upload — the previous "upload from your closet" step
//     never worked (it only staged a preview in local state) and is removed
//
// This also means a guest can never hit the StyleMe NONE-tier 429 wall,
// because this route never calls into the entitlement-checked StyleMe path
// at all. See app/lib/plan/plan-limits.server.ts for why that wall exists
// for the real (paid) flow — it is correct there, just wrong for a teaser.
//
// NOT CANONICAL STYLEME. Canonical StyleMe is /style-me/state → intention →
// physical-need → occasion, using app/lib/styleme/session-vocabulary.ts.
// This route's mood / occasion / feeling options are a separate,
// self-contained vocabulary for the teaser only — do not import Rev 3
// signals here, and do not import this file's options into Rev 3.

import { useId, useState } from "react";
import { Link } from "react-router";
import {
  moodOpts,
  occasionOpts,
  feelingOpts,
  buildStyleDirection,
} from "~/lib/quick-style/insight";

// Title follows this app's existing "<Page Name> | nAia" convention (see
// e.g. closet._index.tsx, my-naia-model.tsx, auth.signed-out.tsx).
// Description and og:description reuse this page's own hero subcopy
// verbatim (below, in the component) rather than new marketing language —
// it is already the approved, accurate positioning: free, no sign-up, no
// AI call, not a full styled look. Keeping the two in sync by hand (no
// shared constant) is a deliberate, small duplication — this string is
// customer-facing copy a product/content reviewer should be able to read
// and edit directly in context, not refactor to find.
export function meta() {
  const title = "Quick Style | nAia";
  const description = "Three quick questions, one free style direction — no sign-up, no AI call, no cost.";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
  ];
}

type StepId = 1 | 2 | 3 | 4;

export default function QuickStyle() {
  const [step, setStep] = useState<StepId>(1);
  const [mood, setMood] = useState("");
  const [occasion, setOccasion] = useState("");
  const [feeling, setFeeling] = useState("");
  const progressLabelId = useId();

  const canProceed =
    (step === 1 && !!mood) ||
    (step === 2 && !!occasion) ||
    (step === 3 && !!feeling);

  const goNext = () => {
    if (!canProceed) return;
    setStep((s) => (s < 4 ? ((s + 1) as StepId) : s));
  };
  const goBack = () => setStep((s) => (s > 1 ? ((s - 1) as StepId) : s));

  const direction = step === 4 ? buildStyleDirection({ mood, occasion, feeling }) : "";

  const css = `:root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}*{margin:0;padding:0;box-sizing:border-box}body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}.topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}.topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}.topbar-close{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-decoration:none;padding:8px}.progress{padding:24px 40px 0;max-width:700px;margin:0 auto}.progress-dots{display:flex;gap:8px;justify-content:center;margin-bottom:8px}.progress-dot{width:10px;height:10px;border-radius:50%;background:var(--warm);transition:all .4s}.progress-dot.active{width:28px;border-radius:14px;background:var(--deep)}.progress-dot.done{background:var(--accent)}.progress-label{text-align:center;font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}.qs-hero{max-width:700px;margin:0 auto;padding:48px 40px 8px}.qs-hero-h{font-family:var(--ff-display);font-size:clamp(32px,5vw,48px);font-weight:900;color:var(--deep);margin-bottom:10px}.qs-hero-sub{font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);line-height:1.6}.step{max-width:700px;margin:0 auto;padding:40px 40px 80px;animation:fadeUp .4s ease}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}.step h2{font-family:var(--ff-display);font-size:clamp(24px,4vw,36px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:28px;line-height:1.15}.pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}.pill{min-height:44px;padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .2s;background:transparent}.pill:hover{border-color:var(--deep)}.pill:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.pill[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--cream)}.step-buttons{display:flex;gap:12px;margin-top:16px}.btn-back,.btn-next{min-height:44px}.btn-back{padding:14px 32px;border:1px solid rgba(59,5,16,.1);background:transparent;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--deep);cursor:pointer}.btn-back:focus-visible,.btn-next:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.btn-next{padding:14px 40px;border:none;background:var(--deep);font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--cream);cursor:pointer}.btn-next:disabled{opacity:.3;cursor:not-allowed}.result-card{margin:0 auto 32px;padding:32px;background:rgba(59,5,16,.03);border:1px solid rgba(59,5,16,.08)}.result-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:14px}.result-text{font-family:var(--ff-display);font-size:clamp(18px,2.6vw,24px);font-style:italic;color:var(--deep);line-height:1.5}.upsell{margin:0 auto 32px;padding:28px 32px;background:var(--deep);color:var(--cream)}.upsell p{font-family:var(--ff-body);font-size:16px;line-height:1.6;margin-bottom:16px}.upsell-link{display:inline-block;padding:12px 28px;border:1px solid var(--cream);color:var(--cream);text-decoration:none;font-family:var(--ff-mono);font-size:10px;letter-spacing:3px;text-transform:uppercase}.upsell-link:focus-visible{outline:2px solid var(--cream);outline-offset:2px}@media(max-width:640px){.topbar{padding:16px 20px}.progress{padding:20px 20px 0}.qs-hero{padding:32px 20px 8px}.step{padding:28px 20px 80px}.step-buttons{flex-direction:column}.btn-back{order:2}.btn-next{order:1}}`;

  return (
    <div>
      <style>{css}</style>
      <div className="topbar">
        <div className="topbar-logo">nAia</div>
        <Link to="/" className="topbar-close">Exit</Link>
      </div>

      <div className="qs-hero">
        <h1 className="qs-hero-h">Quick Style</h1>
        <p className="qs-hero-sub">
          Three quick questions, one free style direction — no sign-up, no AI call, no cost.
        </p>
      </div>

      <div className="progress">
        <div className="progress-dots" role="presentation">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`progress-dot ${n < step ? "done" : ""} ${n === step ? "active" : ""}`} />
          ))}
        </div>
        <div className="progress-label" id={progressLabelId}>
          {step < 4 ? `Question ${step} of 3` : "Your style direction"}
        </div>
      </div>

      {step === 1 && (
        <div className="step" aria-labelledby={progressLabelId}>
          <h2>How are you feeling?</h2>
          <div className="pills" role="group" aria-label="How are you feeling?">
            {moodOpts.map((m) => (
              <button
                key={m.id}
                type="button"
                className="pill"
                aria-pressed={mood === m.id}
                onClick={() => setMood(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="step-buttons">
            <button type="button" className="btn-next" onClick={goNext} disabled={!canProceed}>Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="step" aria-labelledby={progressLabelId}>
          <h2>What&apos;s the outfit for?</h2>
          <div className="pills" role="group" aria-label="What's the outfit for?">
            {occasionOpts.map((o) => (
              <button
                key={o.id}
                type="button"
                className="pill"
                aria-pressed={occasion === o.id}
                onClick={() => setOccasion(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="step-buttons">
            <button type="button" className="btn-back" onClick={goBack}>Back</button>
            <button type="button" className="btn-next" onClick={goNext} disabled={!canProceed}>Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="step" aria-labelledby={progressLabelId}>
          <h2>How do you want to feel in it?</h2>
          <div className="pills" role="group" aria-label="How do you want to feel in it?">
            {feelingOpts.map((f) => (
              <button
                key={f.id}
                type="button"
                className="pill"
                aria-pressed={feeling === f.id}
                onClick={() => setFeeling(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="step-buttons">
            <button type="button" className="btn-back" onClick={goBack}>Back</button>
            <button type="button" className="btn-next" onClick={goNext} disabled={!canProceed}>Get my style direction</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="step" aria-labelledby={progressLabelId}>
          <div className="result-card">
            <div className="result-label">Your style direction</div>
            <p className="result-text">{direction}</p>
          </div>

          <div className="upsell">
            <p>
              This is a free style direction, not a full styled look. Full AI styling — a
              complete outfit built from real, shoppable pieces and matched to your own
              Style Passport and Closet — is a <strong>nAia Membership</strong> feature.
            </p>
            <Link to="/my-naia/plan-usage" className="upsell-link">Explore nAia Membership →</Link>
          </div>

          <div className="step-buttons">
            <button type="button" className="btn-back" onClick={() => setStep(1)}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
