import { useState, useEffect } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { redirect, type LoaderFunctionArgs } from "react-router";
import type { OnboardingAnswers } from "~/lib/onboarding/quiz-data";
import { getQuestionByStep, getTotalSteps, quizQuestions } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";

// Valid option IDs per draft key — derived from quiz data at module load time
const VALID_DRAFT_IDS: Record<string, Set<string>> = {};
for (const q of quizQuestions) {
  if (q.options) VALID_DRAFT_IDS[q.id] = new Set(q.options.map(o => o.id));
  if (q.colors)  VALID_DRAFT_IDS[q.id] = new Set(q.colors.map(c => c.id));
}

// ---------------------------------------------------------------------------
// Versioned, customer-scoped, revision-bound session draft
// ---------------------------------------------------------------------------

interface NaiaOnboardingDraft {
  __v: 2;
  baseProfileUpdatedAt: string | null;
  answers: OnboardingAnswers;
}

function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function sanitizeDraft(raw: OnboardingAnswers): OnboardingAnswers {
  const out: OnboardingAnswers = {};
  const arrayKeys = [
    "style-personalities", "desired-impression", "lifestyle",
    "desired-feelings", "becoming", "fit-preferences",
    "wardrobe-disconnection", "favorite-colors", "avoid-colors", "style-support",
  ] as const;
  for (const key of arrayKeys) {
    const v = raw[key];
    if (Array.isArray(v) && v.every((i): i is string => typeof i === "string")) {
      const validIds = VALID_DRAFT_IDS[key];
      // Accept [] as intentional clear; reject entire field if any item is an unknown ID
      if (v.length === 0 || (validIds && v.every(i => validIds.has(i)))) {
        out[key] = v;
      }
    }
  }
  const fn = raw["final-notes"];
  if (typeof fn === "string") out["final-notes"] = fn;
  return out;
}

function readSessionDraft(
  storageKey: string,
  profileUpdatedAt: string | null,
): OnboardingAnswers {
  try {
    localStorage.removeItem("naia_onboarding"); // always evict legacy key
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as NaiaOnboardingDraft).__v !== 2 ||
      (parsed as NaiaOnboardingDraft).answers === null ||
      typeof (parsed as NaiaOnboardingDraft).answers !== "object" ||
      Array.isArray((parsed as NaiaOnboardingDraft).answers) ||
      (parsed as NaiaOnboardingDraft).baseProfileUpdatedAt !== profileUpdatedAt
    ) {
      localStorage.removeItem(storageKey);
      return {};
    }
    return ((parsed as NaiaOnboardingDraft).answers ?? {}) as OnboardingAnswers;
  } catch {
    try { localStorage.removeItem(storageKey); } catch { /* ignore: removeItem is best-effort */ }
    return {};
  }
}

function writeSessionDraft(
  storageKey: string,
  profileUpdatedAt: string | null,
  answers: OnboardingAnswers,
): void {
  if (Object.keys(answers).length === 0) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(
    storageKey,
    JSON.stringify({ __v: 2, baseProfileUpdatedAt: profileUpdatedAt, answers }),
  );
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ params, request }: LoaderFunctionArgs) {
  const step = parseInt(params.step || "1", 10);
  const totalSteps = getTotalSteps();
  if (isNaN(step) || step < 1 || step > totalSteps) return redirect("/onboarding/step/1");
  const question = getQuestionByStep(step);
  if (!question) return redirect("/onboarding/step/1");

  const customer = await requireCurrentNaiaCustomer(request);
  const op = customer.onboardingProfile;
  const existingAnswers: OnboardingAnswers = {};
  if (op) {
    if (op.stylePersonalities.length)  existingAnswers["style-personalities"]    = op.stylePersonalities;
    if (op.desiredImpression.length)   existingAnswers["desired-impression"]     = op.desiredImpression;
    if (op.lifestyle)                  existingAnswers["lifestyle"]              = op.lifestyle.split(", ").filter(Boolean);
    if (op.desiredFeelings.length)     existingAnswers["desired-feelings"]       = op.desiredFeelings;
    if (op.becoming.length)            existingAnswers["becoming"]               = op.becoming;
    if (op.fitPreferences.length)      existingAnswers["fit-preferences"]        = op.fitPreferences;
    if (op.styleStruggles.length)      existingAnswers["wardrobe-disconnection"] = op.styleStruggles;
    if (op.favoriteColors.length)      existingAnswers["favorite-colors"]        = op.favoriteColors;
    if (op.avoidColors.length)         existingAnswers["avoid-colors"]           = op.avoidColors;
    if (op.styleSupport.length)        existingAnswers["style-support"]          = op.styleSupport;
    if (op.finalNotes)                 existingAnswers["final-notes"]            = op.finalNotes;
  }
  return {
    step,
    totalSteps,
    question,
    existingAnswers,
    draftScope:       customer.id,
    profileUpdatedAt: op?.updatedAt?.toISOString() ?? null,
  };
}

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .ob-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .ob-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .ob-topbar-close{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-decoration:none;background:none;border:none;cursor:pointer}
  .ob-progress{padding:24px 40px 0;max-width:700px;margin:0 auto}
  .ob-progress-dots{display:flex;gap:8px;justify-content:center;margin-bottom:8px}
  .ob-progress-dot{width:10px;height:10px;border-radius:50%;background:var(--warm);transition:all .4s}
  .ob-progress-dot.active{width:28px;border-radius:14px;background:var(--deep)}
  .ob-progress-dot.done{background:var(--accent)}
  .ob-progress-label{text-align:center;font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
  .ob-main{max-width:700px;margin:0 auto;padding:48px 40px 80px}
  .ob-step-label{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  .ob-headline{font-family:var(--ff-display);font-size:clamp(28px,4vw,42px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:8px;line-height:1.1}
  .ob-subtitle{font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:32px}
  .ob-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .ob-pill{padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent}
  .ob-pill:hover{border-color:var(--deep)}
  .ob-pill.selected{background:#8b2035;color:var(--cream)}
  .ob-pill:disabled{opacity:.35;cursor:not-allowed}
  .ob-color-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .ob-color-swatch{padding:12px 16px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent;display:flex;align-items:center;gap:10px}
  .ob-color-swatch:hover{border-color:var(--deep)}
  .ob-color-swatch.selected{background:var(--deep);color:var(--cream)}
  .ob-color-dot{width:20px;height:20px;border:1px solid rgba(0,0,0,0.15);flex-shrink:0}
  .ob-textarea{width:100%;min-height:150px;padding:20px;border:1px solid rgba(59,5,16,.12);font-size:18px;font-family:var(--ff-body);font-style:italic;background:transparent;resize:vertical;color:var(--deep);outline:none}
  .ob-textarea:focus{border-color:var(--deep)}
  .ob-charcount{font-family:var(--ff-mono);font-size:9px;color:var(--muted);text-align:right;margin-top:6px;margin-bottom:32px}
  .ob-buttons{display:flex;gap:12px;margin-top:16px}
  .ob-btn-continue{padding:14px 40px;border:none;background:#8b2035;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--cream);cursor:pointer}
  .ob-btn-continue:disabled{opacity:.3;cursor:not-allowed}
  .ob-btn-skip{padding:14px 32px;border:1px solid rgba(59,5,16,.1);background:transparent;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--deep);cursor:pointer}
`;

export default function OnboardingStep() {
  const { step, totalSteps, question, existingAnswers, draftScope, profileUpdatedAt } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const storageKey = `naia_onboarding_v2:${draftScope}`;

  const [singleValue, setSingleValue] = useState<string | null>(null);
  const [multiValue, setMultiValue] = useState<string[]>([]);
  const [textValue, setTextValue] = useState<string>("");

  // Read sparse session draft; merge with DB base for display.
  // Never writes to localStorage — that is done only in saveAndNavigate.
  useEffect(() => {
    try {
      const rawDraft = readSessionDraft(storageKey, profileUpdatedAt);
      const sessionEdits = sanitizeDraft(rawDraft);
      const merged: OnboardingAnswers = { ...existingAnswers, ...sessionEdits };
      const prev = merged[question.id as keyof OnboardingAnswers];
      if (Array.isArray(prev)) setMultiValue(prev as string[]);
      else if (typeof prev === "string") { setSingleValue(prev); setTextValue(prev); }
      else { setSingleValue(null); setMultiValue([]); setTextValue(""); }
    } catch {
      setSingleValue(null); setMultiValue([]); setTextValue("");
    }
  }, [question.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAndNavigate = (direction: "next" | "back" | "skip") => {
    try {
      const rawDraft = readSessionDraft(storageKey, profileUpdatedAt);
      const sessionEdits = sanitizeDraft(rawDraft);

      if (direction !== "skip") {
        const qid = question.id as keyof OnboardingAnswers;

        if (question.type === "multi" || question.type === "color") {
          // Compare as a set — order must not create a false edit
          const dbBase = Array.isArray(existingAnswers[qid])
            ? (existingAnswers[qid] as string[])
            : [];
          if (arraysEqualAsSet(multiValue, dbBase)) {
            delete sessionEdits[qid];
          } else {
            (sessionEdits as Record<string, unknown>)[qid] = multiValue;
          }
        } else if (question.type === "single") {
          const dbBase = (existingAnswers[qid] as string | undefined) ?? null;
          if ((singleValue ?? null) === dbBase) {
            delete sessionEdits[qid];
          } else {
            (sessionEdits as Record<string, unknown>)[qid] = singleValue;
          }
        } else if (question.type === "text") {
          const dbBase = (existingAnswers[qid] as string | undefined) ?? "";
          if (textValue === dbBase) {
            delete sessionEdits[qid];
          } else {
            (sessionEdits as Record<string, unknown>)[qid] = textValue;
          }
        }
      }

      writeSessionDraft(storageKey, profileUpdatedAt, sessionEdits);
    } catch { /* ignore: localStorage may be unavailable */ }

    if (direction === "back") navigate(`/onboarding/step/${step - 1}`);
    else if (step >= totalSteps) navigate("/onboarding/complete");
    else navigate(`/onboarding/step/${step + 1}`);
  };

  const canProceed = (): boolean => {
    if (question.type === "single") return !!singleValue;
    if (question.type === "multi" || question.type === "color") return multiValue.length > 0;
    return true;
  };

  const toggleMulti = (id: string) => {
    setMultiValue(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      if (!question.maxSelections || prev.length < question.maxSelections) return [...prev, id];
      return prev;
    });
  };

  const totalDots = Math.min(totalSteps, 10);

  return (
    <div>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="ob-topbar">
        <div className="ob-topbar-logo">nAia</div>
        <Link to="/" className="ob-topbar-close">Exit Session</Link>
      </div>

      <div className="ob-progress">
        <div className="ob-progress-dots">
          {Array.from({ length: totalDots }).map((_, i) => {
            const n = i + 1;
            return <div key={n} className={`ob-progress-dot${n < step ? " done" : ""}${n === step ? " active" : ""}`} />;
          })}
        </div>
        <div className="ob-progress-label">Step {step} of {totalSteps}</div>
      </div>

      <main className="ob-main">
        <div className="ob-step-label">Step {step} of {totalSteps}</div>
        <h2 className="ob-headline">{question.title}</h2>
        {question.subtitle && <p className="ob-subtitle">{question.subtitle}</p>}

        {question.type === "single" && question.options && (
          <div className="ob-pills">
            {question.options.map(opt => (
              <button key={opt.id} type="button" onClick={() => setSingleValue(opt.id)} className={`ob-pill${singleValue === opt.id ? " selected" : ""}`}>
                {opt.emoji && <span style={{ marginRight: "6px" }}>{opt.emoji}</span>}
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {question.type === "multi" && question.options && (
          <div className="ob-pills">
            {question.options.map(opt => {
              const isSelected = multiValue.includes(opt.id);
              const isDisabled = !isSelected && !!question.maxSelections && multiValue.length >= question.maxSelections;
              return (
                <button key={opt.id} type="button" onClick={() => toggleMulti(opt.id)} disabled={isDisabled} className={`ob-pill${isSelected ? " selected" : ""}`}>
                  {opt.emoji && <span style={{ marginRight: "6px" }}>{opt.emoji}</span>}
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {question.type === "color" && question.colors && (
          <div className="ob-color-grid">
            {question.colors.map(color => {
              const isSelected = multiValue.includes(color.id);
              const isDisabled = !isSelected && !!question.maxSelections && multiValue.length >= question.maxSelections;
              return (
                <button key={color.id} type="button" onClick={() => toggleMulti(color.id)} disabled={isDisabled} className={`ob-color-swatch${isSelected ? " selected" : ""}`}>
                  <span className="ob-color-dot" style={{ background: color.hex }} />
                  {color.name}
                </button>
              );
            })}
          </div>
        )}

        {question.type === "text" && (
          <>
            <textarea className="ob-textarea" value={textValue} onChange={e => setTextValue(e.target.value)} placeholder={question.placeholder} maxLength={question.maxLength} />
            {question.maxLength && <div className="ob-charcount">{textValue.length} / {question.maxLength}</div>}
          </>
        )}

        <div className="ob-buttons">
          {step > 1 && (
            <button type="button" onClick={() => saveAndNavigate("back")} className="ob-btn-skip">Back</button>
          )}
          <button type="button" onClick={() => saveAndNavigate("next")} disabled={!canProceed()} className="ob-btn-continue">
            {step === totalSteps ? "Complete" : "Continue"}
          </button>
          {question.type === "text" && (
            <button type="button" onClick={() => saveAndNavigate("skip")} className="ob-btn-skip">Skip</button>
          )}
        </div>
      </main>
    </div>
  );
}
