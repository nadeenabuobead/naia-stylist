import { useState, useEffect } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { data, redirect, type LoaderFunctionArgs } from "react-router";
import type { OnboardingAnswers } from "~/lib/onboarding/quiz-data";
import { getQuestionByStep, getTotalSteps, quizQuestions } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import { readPendingSave, clearPendingSave } from "~/lib/pending-save.server";

// Valid option IDs per draft key — built from onboarding quiz data at module load time
const VALID_DRAFT_IDS: Record<string, Set<string>> = {};
for (const q of quizQuestions) {
  if (q.options) VALID_DRAFT_IDS[q.id] = new Set(q.options.map(o => o.id));
  if (q.colors)  VALID_DRAFT_IDS[q.id] = new Set(q.colors.map(c => c.id));
  // Also register the secondary question (avoid-colors on step 8)
  if (q.secondaryQuestion) {
    VALID_DRAFT_IDS[q.secondaryQuestion.id] = new Set(
      q.secondaryQuestion.colors.map(c => c.id),
    );
  }
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

  const arrayKeys: Array<keyof OnboardingAnswers> = [
    // Rev 6 onboarding
    "current-goal", "style-personalities", "successful-outfit-gives",
    "lifestyle", "favorite-colors", "avoid-colors",
    "silhouette", "fit-concerns", "dressing-preferences",
    // Legacy (still accepted if in draft)
    "desired-impression", "desired-feelings", "becoming", "fit-preferences",
    "wardrobe-disconnection", "style-support", "shopping-priorities",
    "coverage-preferences",
  ];

  for (const key of arrayKeys) {
    const v = (raw as Record<string, unknown>)[key as string];
    if (Array.isArray(v) && v.every((i): i is string => typeof i === "string")) {
      const validIds = VALID_DRAFT_IDS[key as string];
      if (v.length === 0 || !validIds || v.every(i => validIds.has(i))) {
        (out as Record<string, unknown>)[key as string] = v;
      }
    }
  }

  // String fields
  const fn = raw["final-notes"];
  if (typeof fn === "string") out["final-notes"] = fn;
  const ta = raw["trend-appetite"];
  if (typeof ta === "string") out["trend-appetite"] = ta;
  const td = raw["typical-day"];
  if (typeof td === "string") out["typical-day"] = td;
  const fcn = raw["fit-concerns-note"];
  if (typeof fcn === "string") out["fit-concerns-note"] = fcn;

  return out;
}

function readSessionDraft(
  storageKey: string,
  profileUpdatedAt: string | null,
): OnboardingAnswers {
  try {
    localStorage.removeItem("naia_onboarding");
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
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
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

export function meta() {
  return [{ title: "Style Profile | nAia" }];
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
    // Rev 6 fields
    if ((op as any).currentGoal?.length)           existingAnswers["current-goal"]           = (op as any).currentGoal;
    if (op.stylePersonalities.length)              existingAnswers["style-personalities"]    = op.stylePersonalities;
    if ((op as any).successfulOutfitGives?.length) existingAnswers["successful-outfit-gives"]= (op as any).successfulOutfitGives;
    if (op.lifestyle.length)                       existingAnswers["lifestyle"]              = op.lifestyle;
    if (op.favoriteColors.length)                  existingAnswers["favorite-colors"]        = op.favoriteColors;
    if (op.avoidColors.length)                     existingAnswers["avoid-colors"]           = op.avoidColors;
    if ((op as any).silhouette?.length)            existingAnswers["silhouette"]             = (op as any).silhouette;
    if (op.fitConcerns?.length)                    existingAnswers["fit-concerns"]           = op.fitConcerns;
    if ((op as any).fitConcernsNote)               existingAnswers["fit-concerns-note"]      = (op as any).fitConcernsNote;
    if ((op as any).dressingPreferences?.length)   existingAnswers["dressing-preferences"]   = (op as any).dressingPreferences;
    // Legacy fields (not shown in Rev 6 flow but preserved if in draft)
    if (op.desiredImpression.length)   existingAnswers["desired-impression"]     = op.desiredImpression;
    if (op.desiredFeelings.length)     existingAnswers["desired-feelings"]       = op.desiredFeelings;
    if (op.becoming.length)            existingAnswers["becoming"]               = op.becoming;
    if (op.fitPreferences.length)      existingAnswers["fit-preferences"]        = op.fitPreferences;
    if (op.styleStruggles.length)      existingAnswers["wardrobe-disconnection"] = op.styleStruggles;
    if (op.styleSupport.length)        existingAnswers["style-support"]          = op.styleSupport;
    if ((op as any).shoppingPriorities?.length) existingAnswers["shopping-priorities"] = (op as any).shoppingPriorities;
    if ((op as any).trendAppetite)     existingAnswers["trend-appetite"]         = (op as any).trendAppetite;
    if (op.finalNotes)                 existingAnswers["final-notes"]            = op.finalNotes;
  }
  const pendingSave = await readPendingSave(request);

  let hasPendingLook = false;
  let pendingClearHeader: string | undefined;

  if (pendingSave.status === "invalid_or_expired") {
    pendingClearHeader = await clearPendingSave(request);
  } else if (pendingSave.status === "valid") {
    const pendingSuggestion = await prisma.outfitSuggestion.findUnique({
      where: { id: pendingSave.sid },
      include: { session: { include: { customer: true } } },
    });
    const isOwned = pendingSuggestion?.session?.customerId === customer.id;
    const isGuestClaimable =
      pendingSuggestion?.session?.customer?.shopifyCustomerId === "guest";
    if (!pendingSuggestion || (!isOwned && !isGuestClaimable)) {
      pendingClearHeader = await clearPendingSave(request);
    } else {
      hasPendingLook = true;
    }
  }

  const payload = {
    step,
    totalSteps,
    question,
    existingAnswers,
    draftScope:       customer.id,
    profileUpdatedAt: op?.updatedAt?.toISOString() ?? null,
    hasPendingLook,
  };
  return pendingClearHeader
    ? data(payload, { headers: { "Set-Cookie": pendingClearHeader } })
    : payload;
}

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .ob-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .ob-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .ob-topbar-close{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-decoration:none;background:none;border:none;cursor:pointer}
  .ob-progress{padding:24px 40px 0;max-width:700px;margin:0 auto}
  .ob-progress-dots{display:flex;gap:6px;justify-content:center;margin-bottom:8px}
  .ob-progress-dot{width:8px;height:8px;border-radius:50%;background:var(--warm);transition:all .4s}
  .ob-progress-dot.active{width:24px;border-radius:12px;background:var(--deep)}
  .ob-progress-dot.done{background:var(--accent)}
  .ob-progress-label{text-align:center;font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
  .ob-main{max-width:700px;margin:0 auto;padding:48px 40px 80px}
  .ob-step-label{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  .ob-headline{font-family:var(--ff-display);font-size:clamp(26px,4vw,40px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:8px;line-height:1.1}
  .ob-subtitle{font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:32px}
  .ob-section-divider{margin:32px 0 24px;border:none;border-top:1px solid rgba(59,5,16,.08)}
  .ob-section-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
  .ob-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .ob-pill{padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent}
  .ob-pill:hover{border-color:var(--deep)}
  .ob-pill.selected{background:#8b2035;color:var(--cream);border-color:#8b2035}
  .ob-pill:disabled{opacity:.35;cursor:not-allowed}
  .ob-color-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .ob-color-swatch{padding:12px 16px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent;display:flex;align-items:center;gap:10px}
  .ob-color-swatch:hover{border-color:var(--deep)}
  .ob-color-swatch.selected{background:var(--deep);color:var(--cream);border-color:var(--deep)}
  .ob-color-swatch:disabled{opacity:.35;cursor:not-allowed}
  .ob-color-dot{width:20px;height:20px;border:1px solid rgba(0,0,0,0.15);flex-shrink:0}
  .ob-textarea{width:100%;min-height:150px;padding:20px;border:1px solid rgba(59,5,16,.12);font-size:18px;font-family:var(--ff-body);font-style:italic;background:transparent;resize:vertical;color:var(--deep);outline:none}
  .ob-textarea:focus{border-color:var(--deep)}
  .ob-charcount{font-family:var(--ff-mono);font-size:9px;color:var(--muted);text-align:right;margin-top:6px;margin-bottom:32px}
  .ob-buttons{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;align-items:center}
  .ob-btn-continue{padding:14px 40px;border:none;background:#8b2035;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--cream);cursor:pointer}
  .ob-btn-continue:disabled{opacity:.3;cursor:not-allowed}
  .ob-btn-skip{padding:14px 32px;border:1px solid rgba(59,5,16,.1);background:transparent;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--deep);cursor:pointer}
  .ob-required-note{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;color:var(--muted);margin-top:8px}
  @media(max-width:600px){.ob-topbar{padding:16px 20px}.ob-progress{padding:20px 20px 0}.ob-main{padding:36px 20px 60px}}
`;

export default function OnboardingStep() {
  const { step, totalSteps, question, existingAnswers, draftScope, profileUpdatedAt, hasPendingLook } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const storageKey = `naia_onboarding_v2:${draftScope}`;

  const [singleValue,          setSingleValue]          = useState<string | null>(null);
  const [multiValue,           setMultiValue]           = useState<string[]>([]);
  const [secondaryMultiValue,  setSecondaryMultiValue]  = useState<string[]>([]);
  const [textValue,            setTextValue]            = useState<string>("");
  const [noteFieldValue,       setNoteFieldValue]       = useState<string>("");

  // Populate state from DB base + session draft
  useEffect(() => {
    try {
      const rawDraft = readSessionDraft(storageKey, profileUpdatedAt);
      const sessionEdits = sanitizeDraft(rawDraft);
      const merged: OnboardingAnswers = { ...existingAnswers, ...sessionEdits };
      const prev = (merged as Record<string, unknown>)[question.id];
      if (Array.isArray(prev))         setMultiValue(prev as string[]);
      else if (typeof prev === "string") { setSingleValue(prev); setTextValue(prev); }
      else                               { setSingleValue(null); setMultiValue([]); setTextValue(""); }

      // Secondary question (avoid-colors on step 5)
      if (question.secondaryQuestion) {
        const sec = (merged as Record<string, unknown>)[question.secondaryQuestion.id];
        setSecondaryMultiValue(Array.isArray(sec) ? (sec as string[]) : []);
      } else {
        setSecondaryMultiValue([]);
      }

      // Note field (fit-concerns-note on step 7)
      if (question.noteField) {
        const nf = (merged as Record<string, unknown>)[question.noteField.id];
        setNoteFieldValue(typeof nf === "string" ? nf : "");
      } else {
        setNoteFieldValue("");
      }
    } catch {
      setSingleValue(null); setMultiValue([]); setSecondaryMultiValue([]); setTextValue(""); setNoteFieldValue("");
    }
  }, [question.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAndNavigate = (direction: "next" | "back" | "skip") => {
    try {
      const rawDraft = readSessionDraft(storageKey, profileUpdatedAt);
      const sessionEdits = sanitizeDraft(rawDraft);

      if (direction !== "skip") {
        const qid = question.id as keyof OnboardingAnswers;

        if (question.type === "multi" || question.type === "color") {
          const dbBase = Array.isArray((existingAnswers as Record<string, unknown>)[qid])
            ? (existingAnswers as Record<string, unknown>)[qid] as string[]
            : [];
          if (arraysEqualAsSet(multiValue, dbBase)) {
            delete (sessionEdits as Record<string, unknown>)[qid];
          } else {
            (sessionEdits as Record<string, unknown>)[qid] = multiValue;
          }

          // Also save secondary question (avoid-colors on step 5)
          if (question.secondaryQuestion) {
            const secId = question.secondaryQuestion.id as keyof OnboardingAnswers;
            const secBase = Array.isArray((existingAnswers as Record<string, unknown>)[secId])
              ? (existingAnswers as Record<string, unknown>)[secId] as string[]
              : [];
            if (arraysEqualAsSet(secondaryMultiValue, secBase)) {
              delete (sessionEdits as Record<string, unknown>)[secId];
            } else {
              (sessionEdits as Record<string, unknown>)[secId] = secondaryMultiValue;
            }
          }

          // Also save note field (fit-concerns-note on step 7)
          if (question.noteField) {
            const nfId = question.noteField.id as keyof OnboardingAnswers;
            const nfBase = ((existingAnswers as Record<string, unknown>)[nfId] as string | undefined) ?? "";
            if (noteFieldValue === nfBase) {
              delete (sessionEdits as Record<string, unknown>)[nfId];
            } else {
              (sessionEdits as Record<string, unknown>)[nfId] = noteFieldValue;
            }
          }
        } else if (question.type === "single") {
          const dbBase = ((existingAnswers as Record<string, unknown>)[qid] as string | undefined) ?? null;
          if ((singleValue ?? null) === dbBase) {
            delete (sessionEdits as Record<string, unknown>)[qid];
          } else {
            (sessionEdits as Record<string, unknown>)[qid] = singleValue;
          }
        } else if (question.type === "text") {
          const dbBase = ((existingAnswers as Record<string, unknown>)[qid] as string | undefined) ?? "";
          if (textValue === dbBase) {
            delete (sessionEdits as Record<string, unknown>)[qid];
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
    if (!question.required) return true; // skippable screens always allow Continue
    if (question.type === "single") return !!singleValue;
    if (question.type === "multi" || question.type === "color") return multiValue.length > 0;
    return true;
  };

  const togglePrimary = (id: string) => {
    setMultiValue(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      if (!question.maxSelections || prev.length < question.maxSelections) {
        // Mutual exclusion: remove from avoid-colors if present
        setSecondaryMultiValue(sec => sec.filter(s => s !== id));
        return [...prev, id];
      }
      return prev;
    });
  };

  const toggleSecondary = (id: string) => {
    if (!question.secondaryQuestion) return;
    const max = question.secondaryQuestion.maxSelections;
    setSecondaryMultiValue(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      if (prev.length < max) {
        // Mutual exclusion: remove from favorite-colors if present
        setMultiValue(fav => fav.filter(f => f !== id));
        return [...prev, id];
      }
      return prev;
    });
  };

  const toggleMulti = (id: string) => {
    setMultiValue(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      const exclusives = question.exclusiveIds ?? [];
      if (exclusives.includes(id)) {
        // Exclusive selected: replace everything with just this id
        return [id];
      }
      // Non-exclusive selected: remove any exclusive IDs currently selected
      const withoutExclusives = prev.filter(v => !exclusives.includes(v));
      if (!question.maxSelections || withoutExclusives.length < question.maxSelections) {
        return [...withoutExclusives, id];
      }
      return prev;
    });
  };

  const totalDots = Math.min(totalSteps, 12);
  const isSkippable = !question.required;

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
            return (
              <div
                key={n}
                className={`ob-progress-dot${n < step ? " done" : ""}${n === step ? " active" : ""}`}
              />
            );
          })}
        </div>
        <div className="ob-progress-label">Step {step} of {totalSteps}</div>
      </div>

      {hasPendingLook && step === 1 && (
        <div style={{ background: "rgba(139,32,53,0.04)", borderBottom: "1px solid rgba(139,32,53,0.1)", padding: "20px 40px" }}>
          <p style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>
            YOUR nAia PASSPORT
          </p>
          <p style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "20px", fontStyle: "italic", color: "#221516", marginBottom: "6px" }}>
            Create your nAia Passport
          </p>
          <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", color: "#7a6f6a" }}>
            Your Style Me look will be waiting for you once your Passport is complete.
          </p>
        </div>
      )}

      <main className="ob-main">
        <div className="ob-step-label">Step {step} of {totalSteps}</div>
        <h2 className="ob-headline">{question.title}</h2>
        {question.subtitle && <p className="ob-subtitle">{question.subtitle}</p>}

        {/* MULTI */}
        {question.type === "multi" && question.options && (
          <>
            <div className="ob-pills">
              {question.options.map(opt => {
                const exclusives = question.exclusiveIds ?? [];
                const isSelected = multiValue.includes(opt.id);
                const hasExclusiveActive = exclusives.some(eid => multiValue.includes(eid));
                const isExclusive = exclusives.includes(opt.id);
                // Disable non-exclusive when max reached AND no exclusive is active
                const isDisabled =
                  !isSelected &&
                  !isExclusive &&
                  !!question.maxSelections &&
                  !hasExclusiveActive &&
                  multiValue.filter(v => !exclusives.includes(v)).length >= question.maxSelections;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleMulti(opt.id)}
                    disabled={isDisabled}
                    className={`ob-pill${isSelected ? " selected" : ""}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Note field (e.g. fit-concerns-note revealed when "other" is selected) */}
            {question.noteField && multiValue.includes(question.noteField.triggerId) && (
              <div style={{ marginTop: "16px" }}>
                <div className="ob-section-label">{question.noteField.placeholder}</div>
                <textarea
                  className="ob-textarea"
                  value={noteFieldValue}
                  onChange={e => setNoteFieldValue(e.target.value)}
                  placeholder={question.noteField.placeholder}
                  maxLength={question.noteField.maxLength}
                  style={{ minHeight: "100px" }}
                />
                {question.noteField.maxLength && (
                  <div className="ob-charcount">{noteFieldValue.length} / {question.noteField.maxLength}</div>
                )}
              </div>
            )}
          </>
        )}

        {/* SINGLE */}
        {question.type === "single" && question.options && (
          <div className="ob-pills">
            {question.options.map(opt => {
              const isSelected = singleValue === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSingleValue(prev => prev === opt.id ? null : opt.id)}
                  className={`ob-pill${isSelected ? " selected" : ""}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {/* COLOR (primary + optional secondary on same screen) */}
        {question.type === "color" && question.colors && (
          <>
            <div className="ob-color-grid">
              {question.colors.map(color => {
                const isSelected = multiValue.includes(color.id);
                const isDisabled = !isSelected && !!question.maxSelections && multiValue.length >= question.maxSelections;
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => togglePrimary(color.id)}
                    disabled={isDisabled}
                    className={`ob-color-swatch${isSelected ? " selected" : ""}`}
                  >
                    <span className="ob-color-dot" style={{ background: color.hex }} />
                    {color.name}
                  </button>
                );
              })}
            </div>

            {/* Secondary: avoid-colors — same screen */}
            {question.secondaryQuestion && (
              <>
                <hr className="ob-section-divider" />
                <div className="ob-section-label">{question.secondaryQuestion.title}</div>
                {question.secondaryQuestion.subtitle && (
                  <p className="ob-subtitle" style={{ marginBottom: "16px" }}>{question.secondaryQuestion.subtitle}</p>
                )}
                <div className="ob-color-grid">
                  {question.secondaryQuestion.colors.map(color => {
                    const isSelected = secondaryMultiValue.includes(color.id);
                    const isDisabled = !isSelected && secondaryMultiValue.length >= question.secondaryQuestion!.maxSelections;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => toggleSecondary(color.id)}
                        disabled={isDisabled}
                        className={`ob-color-swatch${isSelected ? " selected" : ""}`}
                      >
                        <span className="ob-color-dot" style={{ background: color.hex }} />
                        {color.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* TEXT */}
        {question.type === "text" && (
          <>
            <textarea
              className="ob-textarea"
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              placeholder={question.placeholder}
              maxLength={question.maxLength}
            />
            {question.maxLength && (
              <div className="ob-charcount">{textValue.length} / {question.maxLength}</div>
            )}
          </>
        )}

        <div className="ob-buttons">
          {step > 1 && (
            <button type="button" onClick={() => saveAndNavigate("back")} className="ob-btn-skip">
              Back
            </button>
          )}

          <button
            type="button"
            onClick={() => saveAndNavigate("next")}
            disabled={!canProceed()}
            className="ob-btn-continue"
          >
            {step === totalSteps ? "Complete" : "Continue"}
          </button>

          {isSkippable && (
            <button type="button" onClick={() => saveAndNavigate("skip")} className="ob-btn-skip">
              Skip
            </button>
          )}
        </div>

        {question.required && (
          <p className="ob-required-note">Required</p>
        )}
      </main>
    </div>
  );
}
