import { useState, useEffect, useCallback } from "react";
import { useLoaderData, data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { OnboardingAnswers } from "~/lib/onboarding/quiz-data";
import { quizQuestions } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import { readPendingSave, clearPendingSave } from "~/lib/pending-save.server";
import { computeNaiaFirstRead } from "~/lib/ai/first-naia-read";
import type { NaiaFirstReadObservation } from "~/lib/ai/first-naia-read";

// Option label, colour-hex, and valid-ID lookups built from quiz data at module load time
const OPTION_LABELS: Record<string, Record<string, string>> = {};
const COLOR_HEX: Record<string, string> = {};
const VALID_IDS_BY_DRAFT_KEY: Record<string, Set<string>> = {};
for (const q of quizQuestions) {
  if (q.options) {
    OPTION_LABELS[q.id] = Object.fromEntries(q.options.map(o => [o.id, o.label]));
    VALID_IDS_BY_DRAFT_KEY[q.id] = new Set(q.options.map(o => o.id));
  }
  if (q.colors) {
    OPTION_LABELS[q.id] = Object.fromEntries(q.colors.map(c => [c.id, c.name]));
    for (const c of q.colors) COLOR_HEX[c.id] = c.hex;
    VALID_IDS_BY_DRAFT_KEY[q.id] = new Set(q.colors.map(c => c.id));
  }
}

function lbl(qId: string, oId: string): string {
  return OPTION_LABELS[qId]?.[oId] ?? oId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const IDENTITY: Record<string, { title: string; description: string }> = {
  // V3 archetypes (Rev 6)
  "classic-polished":    { title: "The Classic & Polished",    description: "You appreciate refined quality and understated elegance that lasts." },
  "feminine-romantic":   { title: "The Feminine Romantic",     description: "You're drawn to soft details, graceful silhouettes, and a romantic sensibility." },
  "minimal-relaxed":     { title: "The Minimal Relaxed",       description: "You believe in simplicity, ease, and intentional pieces that do the work quietly." },
  "bold-edgy":           { title: "The Bold & Edgy",           description: "You're not afraid to make a statement and push boundaries with your look." },
  "creative-expressive": { title: "The Creative Expressive",   description: "You express who you are through original, artistic choices that are distinctly yours." },
  // V2 legacy (backward compat for existing users)
  "old-money":           { title: "The Timeless Classic",      description: "You appreciate quality, heritage, and understated elegance." },
  "artsy":               { title: "The Creative Spirit",       description: "You express yourself through unique pieces and artistic flair." },
  "edgy":                { title: "The Bold Rebel",            description: "You're not afraid to make a statement and push boundaries." },
  "feminine":            { title: "The Soft Romantic",         description: "You're drawn to delicate details and graceful silhouettes." },
  "corporate-chic":      { title: "The Polished Professional", description: "You blend sophistication with modern elegance." },
  "effortlessly-chic":   { title: "The Natural Stylist",       description: "You make looking put-together seem completely effortless." },
  "minimal":             { title: "The Modern Minimalist",     description: "You believe in the power of simplicity and intentional pieces." },
  "trendy":              { title: "The Fashion Forward",       description: "You love staying ahead of the curve and experimenting with new styles." },
  "romantic":            { title: "The Dreamer",               description: "You're drawn to soft, feminine pieces that tell a story." },
  "casual-cool":         { title: "The Relaxed Stylist",       description: "You master the art of looking good without trying too hard." },
};

function buildNaiaNote(a: OnboardingAnswers): string {
  const p = (a["style-personalities"] ?? []).slice(0, 2).map(id => lbl("style-personalities", id));
  const av = (a["avoid-colors"] ?? []).map(id => lbl("avoid-colors", id).toLowerCase());
  // Rev 6: desiredFeelings may be absent for new users; fall back to successfulOutfitGives for note copy
  const sog = (a["successful-outfit-gives"] ?? []).slice(0, 2).map(id => lbl("successful-outfit-gives", id).toLowerCase());
  let note = "nAia will use your style passport to personalise every styling suggestion to your unique aesthetic.";
  if (p.length && sog.length) {
    note = `nAia knows your style runs ${p.join(" and ")} and great outfits give you ${sog.join(" and ")} — every suggestion will lead with that.`;
  } else if (p.length) {
    note = `nAia knows your style leans ${p.join(" and ")} — suggestions will stay true to that energy.`;
  } else if (sog.length) {
    note = `nAia knows great outfits give you ${sog.join(" and ")} — every suggestion will lead with that.`;
  }
  if (av.length) {
    note += ` Colours to deprioritise: ${av.join(", ")}.`;
  }
  return note;
}

// ---------------------------------------------------------------------------
// Versioned, customer-scoped, revision-bound session draft
// ---------------------------------------------------------------------------

// Maps draft key → API field name. Used for both sanitization and POST body.
const DRAFT_TO_API = [
  // Rev 6 onboarding fields
  ["current-goal",           "currentGoal",          "array"],
  ["style-personalities",    "stylePersonalities",   "array"],
  ["successful-outfit-gives","successfulOutfitGives","array"],
  ["lifestyle",              "lifestyle",            "array"],
  ["favorite-colors",        "favoriteColors",       "array"],
  ["avoid-colors",           "avoidColors",          "array"],
  ["silhouette",             "silhouette",           "array"],
  ["fit-concerns",           "fitConcerns",          "array"],
  ["fit-concerns-note",      "fitConcernsNote",      "text"],
  ["dressing-preferences",   "dressingPreferences",  "array"],
  // Legacy fields (not in Rev 6 flow; preserved if already in draft)
  ["desired-impression",     "desiredImpression",    "array"],
  ["desired-feelings",       "desiredFeelings",      "array"],
  ["becoming",               "becoming",             "array"],
  ["fit-preferences",        "fitPreferences",       "array"],
  ["wardrobe-disconnection", "styleStruggles",       "array"],
  ["style-support",          "styleSupport",         "array"],
  ["shopping-priorities",    "shoppingPriorities",   "array"],
  ["trend-appetite",         "trendAppetite",        "text"],
  ["final-notes",            "finalNotes",           "text"],
] as const;

interface NaiaOnboardingDraft {
  __v: 2;
  baseProfileUpdatedAt: string | null;
  answers: OnboardingAnswers;
}

function sanitizeDraft(raw: OnboardingAnswers): OnboardingAnswers {
  const out: OnboardingAnswers = {};
  for (const [draftKey, , kind] of DRAFT_TO_API) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (raw as any)[draftKey];
    if (kind === "array") {
      if (Array.isArray(v) && v.every((i: unknown) => typeof i === "string")) {
        const validIds = VALID_IDS_BY_DRAFT_KEY[draftKey];
        // Accept [] as intentional clear; reject entire field if any item is an unknown ID
        if (v.length === 0 || (validIds && v.every((i: unknown) => validIds.has(i as string)))) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (out as any)[draftKey] = v;
        }
      }
    } else if (typeof v === "string") {
      out["final-notes"] = v;
    }
  }
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
export function meta() {
  return [{ title: "Profile Complete | nAia" }];
}

// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const op = customer.onboardingProfile;
  const existingAnswers: OnboardingAnswers = {};
  if (op) {
    if (op.stylePersonalities.length)          existingAnswers["style-personalities"]    = op.stylePersonalities;
    if (op.desiredImpression.length)           existingAnswers["desired-impression"]     = op.desiredImpression;
    if (op.lifestyle.length)                   existingAnswers["lifestyle"]              = op.lifestyle;
    if (op.desiredFeelings.length)             existingAnswers["desired-feelings"]       = op.desiredFeelings;
    if (op.becoming.length)                    existingAnswers["becoming"]               = op.becoming;
    if (op.fitPreferences.length)              existingAnswers["fit-preferences"]        = op.fitPreferences;
    if ((op as any).silhouette?.length)        existingAnswers["silhouette"]             = (op as any).silhouette;
    if (op.styleStruggles.length)              existingAnswers["wardrobe-disconnection"] = op.styleStruggles;
    if (op.favoriteColors.length)              existingAnswers["favorite-colors"]        = op.favoriteColors;
    if (op.avoidColors.length)                 existingAnswers["avoid-colors"]           = op.avoidColors;
    if (op.styleSupport.length)                existingAnswers["style-support"]          = op.styleSupport;
    if ((op as any).shoppingPriorities?.length) existingAnswers["shopping-priorities"]  = (op as any).shoppingPriorities;
    if ((op as any).trendAppetite)             existingAnswers["trend-appetite"]         = (op as any).trendAppetite;
    if (op.finalNotes)                         existingAnswers["final-notes"]            = op.finalNotes;
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
  .cp-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .cp-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .cp-main{max-width:700px;margin:0 auto;padding:48px 40px 80px}
  .cp-eyebrow{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  .cp-headline{font-family:var(--ff-display);font-size:clamp(28px,4vw,42px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:8px;line-height:1.1}
  .cp-desc{font-family:var(--ff-body);font-size:20px;font-style:italic;color:var(--muted);margin-bottom:32px;line-height:1.5}
  .cp-section-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
  .cp-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .cp-pill{padding:10px 20px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);background:transparent}
  .cp-color-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .cp-color-chip{display:flex;align-items:center;gap:10px;padding:10px 18px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep)}
  .cp-color-dot{width:18px;height:18px;border:1px solid rgba(0,0,0,0.12);flex-shrink:0;border-radius:1px}
  .cp-divider{height:1px;background:rgba(59,5,16,.08);margin:8px 0 40px}
  .cp-naia-box{background:rgba(139,32,53,.04);border-left:3px solid var(--accent);padding:24px;margin-bottom:40px}
  .cp-naia-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
  .cp-naia-text{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--deep);line-height:1.6;margin:0}
  .cp-notes-block{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--muted);line-height:1.6;padding:20px;border-left:2px solid rgba(59,5,16,.08);margin-bottom:40px}
  .cp-action{display:flex;align-items:center;gap:20px;padding:24px;border:1px solid rgba(59,5,16,.1);text-decoration:none;margin-bottom:10px;transition:border-color .2s}
  .cp-action:hover{border-color:var(--deep)}
  .cp-action-title{font-family:var(--ff-display);font-size:20px;font-weight:700;color:var(--deep);margin-bottom:4px}
  .cp-action-sub{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted)}
  .cp-arrow{font-family:var(--ff-mono);font-size:12px;color:var(--accent);margin-left:auto;flex-shrink:0}
  .cp-status{padding:12px 40px;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;display:flex;align-items:center;gap:16px;border-bottom:1px solid rgba(59,5,16,.06)}
  .cp-status-saving{color:var(--muted);background:rgba(59,5,16,.02)}
  .cp-status-error{color:var(--accent);background:rgba(139,32,53,.06)}
  .cp-status-conflict{color:#7a4a00;background:rgba(180,120,0,.06)}
  .cp-status-btn{padding:6px 14px;border:1px solid currentColor;background:transparent;font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:inherit;cursor:pointer}
`;

type SaveStatus = "saving" | "saved" | "error" | "conflict";

export default function OnboardingComplete() {
  const { existingAnswers, draftScope, profileUpdatedAt, hasPendingLook } = useLoaderData<typeof loader>();

  const storageKey = `naia_onboarding_v2:${draftScope}`;

  const [displayAnswers, setDisplayAnswers] = useState<OnboardingAnswers | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saving");
  const [feedbackState, setFeedbackState] = useState<Record<string, "accurate" | "not-quite">>({});
  const [feedbackPending, setFeedbackPending] = useState<Set<string>>(new Set());
  const [feedbackError, setFeedbackError] = useState<Set<string>>(new Set());

  // POST only the sparse session patch (keys the user actually changed this session).
  // Absent keys fall back to the saved DB value via the API's pick* helpers.
  const attemptSave = useCallback(async (sessionEdits: OnboardingAnswers) => {
    setSaveStatus("saving");
    try {
      const patch: Record<string, unknown> = { baseProfileUpdatedAt: profileUpdatedAt, onboardingComplete: true };
      for (const [draftKey, apiKey] of DRAFT_TO_API) {
        if (Object.hasOwn(sessionEdits, draftKey)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          patch[apiKey] = (sessionEdits as any)[draftKey];
        }
      }
      const res = await fetch("/api/save-style-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 409) {
        // Profile changed elsewhere since the quiz started — preserve draft, show reload prompt
        setSaveStatus("conflict");
        return;
      }
      if (!res.ok) { setSaveStatus("error"); return; }
      writeSessionDraft(storageKey, profileUpdatedAt, {}); // clears the scoped draft
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [profileUpdatedAt, storageKey]);

  useEffect(() => {
    const rawDraft = readSessionDraft(storageKey, profileUpdatedAt);
    const sessionEdits = sanitizeDraft(rawDraft);
    // DB values are the display base; session edits override per-field
    const merged: OnboardingAnswers = { ...existingAnswers, ...sessionEdits };
    setDisplayAnswers(merged);
    if (Object.keys(sessionEdits).length > 0) {
      attemptSave(sessionEdits);
    } else {
      setSaveStatus("saved");
    }
  }, [attemptSave, existingAnswers]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(() => {
    const rawDraft = readSessionDraft(storageKey, profileUpdatedAt);
    const sessionEdits = sanitizeDraft(rawDraft);
    if (Object.keys(sessionEdits).length > 0) {
      attemptSave(sessionEdits);
    }
  }, [storageKey, profileUpdatedAt, attemptSave]);

  const handleConflictReload = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch { /* ignore: localStorage may be unavailable */ }
    window.location.reload();
  }, [storageKey]);

  const submitFeedback = useCallback(async (obs: NaiaFirstReadObservation, choice: "accurate" | "not-quite") => {
    const key = obs.observationKey;
    // Prevent duplicate in-flight requests for the same key
    if (feedbackPending.has(key)) return;
    setFeedbackPending(prev => new Set(prev).add(key));
    setFeedbackError(prev => { const s = new Set(prev); s.delete(key); return s; });
    try {
      const res = await fetch("/api/naia-observation-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observationKey: key, feedback: choice }),
      });
      if (res.ok) {
        setFeedbackState(prev => ({ ...prev, [key]: choice }));
      } else {
        // Server rejected — do not display as saved
        setFeedbackError(prev => new Set(prev).add(key));
      }
    } catch {
      // Network failure — revert optimistic state
      setFeedbackError(prev => new Set(prev).add(key));
    } finally {
      setFeedbackPending(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [feedbackPending]);

  if (!displayAnswers) return <div style={{ minHeight: "100vh", background: "#f4f4f1" }} />;

  const a = displayAnswers;

  // First Read — deterministic, runs after localStorage draft is merged into displayAnswers
  const firstReadResult = computeNaiaFirstRead({
    stylePersonalities:    a["style-personalities"]     as string[] | undefined,
    silhouette:            a["silhouette"]              as string[] | undefined,
    successfulOutfitGives: a["successful-outfit-gives"] as string[] | undefined,
    lifestyle:             a["lifestyle"]               as string[] | undefined,
    favoriteColors:        a["favorite-colors"]         as string[] | undefined,
    avoidColors:           a["avoid-colors"]            as string[] | undefined,
  });

  const personalities   = a["style-personalities"]    ?? [];
  const impression      = a["desired-impression"]     ?? [];
  const lifestyle       = a["lifestyle"]              ?? [];
  const feelings        = a["desired-feelings"]       ?? [];
  const becoming        = a["becoming"]               ?? [];
  const fitPrefs        = a["fit-preferences"]        ?? [];
  const struggles       = a["wardrobe-disconnection"] ?? [];
  const favColors       = a["favorite-colors"]        ?? [];
  const avoidColors     = a["avoid-colors"]           ?? [];
  const support         = a["style-support"]          ?? [];
  const notes           = a["final-notes"];

  const primaryPersonality = personalities[0];
  const identity = primaryPersonality
    ? (IDENTITY[primaryPersonality] ?? IDENTITY["effortlessly-chic"])
    : null;

  return (
    <div>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="cp-topbar">
        <div className="cp-topbar-logo">nAia</div>
      </div>

      {saveStatus === "saving" && (
        <div className="cp-status cp-status-saving">
          Saving your nAia Passport…
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

      {saveStatus === "conflict" && (
        <div className="cp-status cp-status-conflict">
          Your Passport was changed elsewhere — reload to see the latest version.
          <button type="button" className="cp-status-btn" onClick={handleConflictReload}>
            Reload
          </button>
        </div>
      )}

      <main className="cp-main">
        <div className="cp-eyebrow">Your nAia Passport</div>

        {/* 1 — Style identity */}
        {identity && (
          <>
            <h1 className="cp-headline">{identity.title}</h1>
            <p className="cp-desc">{identity.description}</p>
          </>
        )}
        {personalities.length > 0 && (
          <>
            <div className="cp-section-label">Style energies</div>
            <div className="cp-pills">
              {personalities.map(id => (
                <span key={id} className="cp-pill">{lbl("style-personalities", id)}</span>
              ))}
            </div>
          </>
        )}

        {/* 2 — Desired impression and feelings */}
        {(impression.length > 0 || feelings.length > 0) && (
          <>
            <div className="cp-divider" />
            {impression.length > 0 && (
              <>
                <div className="cp-section-label">The impression you make</div>
                <div className="cp-pills">
                  {impression.map(id => (
                    <span key={id} className="cp-pill">{lbl("desired-impression", id)}</span>
                  ))}
                </div>
              </>
            )}
            {feelings.length > 0 && (
              <>
                <div className="cp-section-label">How you want to feel</div>
                <div className="cp-pills">
                  {feelings.map(id => (
                    <span key={id} className="cp-pill">{lbl("desired-feelings", id)}</span>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* 3 — Colour direction and colours to avoid */}
        {(favColors.length > 0 || avoidColors.length > 0) && (
          <>
            <div className="cp-divider" />
            {favColors.length > 0 && (
              <>
                <div className="cp-section-label">Your colour palette</div>
                <div className="cp-color-row">
                  {favColors.map(id => (
                    <div key={id} className="cp-color-chip">
                      <span className="cp-color-dot" style={{ background: COLOR_HEX[id] ?? "#ccc" }} />
                      {lbl("favorite-colors", id)}
                    </div>
                  ))}
                </div>
              </>
            )}
            {avoidColors.length > 0 && (
              <>
                <div className="cp-section-label">Colours to avoid</div>
                <div className="cp-color-row" style={{ opacity: 0.7 }}>
                  {avoidColors.map(id => (
                    <div key={id} className="cp-color-chip">
                      <span className="cp-color-dot" style={{ background: COLOR_HEX[id] ?? "#ccc" }} />
                      {lbl("avoid-colors", id)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* 4 — Lifestyle and fit */}
        {(lifestyle.length > 0 || fitPrefs.length > 0) && (
          <>
            <div className="cp-divider" />
            {lifestyle.length > 0 && (
              <>
                <div className="cp-section-label">Your lifestyle</div>
                <div className="cp-pills">
                  {lifestyle.map(id => (
                    <span key={id} className="cp-pill">{lbl("lifestyle", id)}</span>
                  ))}
                </div>
              </>
            )}
            {fitPrefs.length > 0 && (
              <>
                <div className="cp-section-label">What makes you feel best</div>
                <div className="cp-pills">
                  {fitPrefs.map(id => (
                    <span key={id} className="cp-pill">{lbl("fit-preferences", id)}</span>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* 5 — Becoming, wardrobe struggles, and desired support */}
        {(becoming.length > 0 || struggles.length > 0 || support.length > 0) && (
          <>
            <div className="cp-divider" />
            {becoming.length > 0 && (
              <>
                <div className="cp-section-label">Who you&apos;re becoming</div>
                <div className="cp-pills">
                  {becoming.map(id => (
                    <span key={id} className="cp-pill">{lbl("becoming", id)}</span>
                  ))}
                </div>
              </>
            )}
            {struggles.length > 0 && (
              <>
                <div className="cp-section-label">When you feel most disconnected</div>
                <div className="cp-pills">
                  {struggles.map(id => (
                    <span key={id} className="cp-pill">{lbl("wardrobe-disconnection", id)}</span>
                  ))}
                </div>
              </>
            )}
            {support.length > 0 && (
              <>
                <div className="cp-section-label">What would make getting dressed easier</div>
                <div className="cp-pills">
                  {support.map(id => (
                    <span key={id} className="cp-pill">{lbl("style-support", id)}</span>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* 6 — Final notes */}
        {notes && (
          <>
            <div className="cp-divider" />
            <div className="cp-section-label">Your notes to nAia</div>
            <p className="cp-notes-block">&ldquo;{notes}&rdquo;</p>
          </>
        )}

        {/* First Read or fallback nAia note */}
        <div className="cp-divider" />
        {saveStatus === "saved" && firstReadResult.observations.length > 0 ? (
          <div className="cp-naia-box">
            <div className="cp-naia-label">nAia&rsquo;s first read on you</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {firstReadResult.observations.map(obs => {
                const key = obs.observationKey;
                const confirmed = feedbackState[key];
                const pending   = feedbackPending.has(key);
                const hasError  = feedbackError.has(key);
                return (
                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <p className="cp-naia-text" style={{ margin: 0 }}>{obs.claim}</p>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      {pending ? (
                        <span style={{ fontSize: "12px", color: "#999", fontStyle: "italic" }}>Saving…</span>
                      ) : hasError ? (
                        <>
                          <span style={{ fontSize: "12px", color: "#c0392b" }}>Couldn&rsquo;t save —&nbsp;</span>
                          <button
                            onClick={() => setFeedbackError(prev => { const s = new Set(prev); s.delete(key); return s; })}
                            style={{ fontSize: "12px", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                          >
                            try again
                          </button>
                        </>
                      ) : confirmed ? (
                        <>
                          <span style={{ fontSize: "12px", color: "var(--accent)", fontStyle: "italic" }}>
                            {confirmed === "accurate" ? "Noted — thanks." : "Noted — nAia will keep learning."}
                          </span>
                          <button
                            onClick={() => setFeedbackState(prev => { const s = { ...prev }; delete s[key]; return s; })}
                            style={{ fontSize: "11px", color: "#999", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                          >
                            change
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => submitFeedback(obs, "accurate")}
                            style={{ fontSize: "12px", padding: "4px 12px", border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", borderRadius: "4px", cursor: "pointer" }}
                          >
                            That&rsquo;s me
                          </button>
                          <button
                            onClick={() => submitFeedback(obs, "not-quite")}
                            style={{ fontSize: "12px", padding: "4px 12px", border: "1px solid #999", background: "transparent", color: "#999", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Not quite
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="cp-naia-box">
            <div className="cp-naia-label">How nAia will use this</div>
            <p className="cp-naia-text">{buildNaiaNote(a)}</p>
          </div>
        )}

        {/* CTAs */}
        <div className="cp-section-label">What would you like to do first?</div>

        <a href="/style-me" className="cp-action">
          <div>
            <div className="cp-action-title">Style Me</div>
            <div className="cp-action-sub">Get outfit ideas based on your mood</div>
          </div>
          <span className="cp-arrow">→</span>
        </a>

        <a href="/closet" className="cp-action">
          <div>
            <div className="cp-action-title">Digital Closet</div>
            <div className="cp-action-sub">Upload your pieces for personalised styling</div>
          </div>
          <span className="cp-arrow">→</span>
        </a>

        <a href="/my-naia" className="cp-action">
          <div>
            <div className="cp-action-title">
              {saveStatus === "saved" ? "View your updated Style DNA" : "Go to My nAia"}
            </div>
            <div className="cp-action-sub">
              {saveStatus === "saved" ? "Your nAia Passport has been saved" : "Explore all features"}
            </div>
          </div>
          <span className="cp-arrow">→</span>
        </a>

        {saveStatus === "saved" && hasPendingLook && (
          <a href="/style-me/result" className="cp-action">
            <div>
              <div className="cp-action-title">YOUR LOOK IS READY TO SAVE</div>
              <div className="cp-action-sub">Return to your Style Me result to save it to your Passport</div>
            </div>
            <span className="cp-arrow">→</span>
          </a>
        )}

        {saveStatus === "saved" && (
          <a href="/closet" className="cp-action" style={{ borderColor: "var(--accent)" }}>
            <div>
              <div className="cp-action-title">Now show nAia what you actually wear.</div>
              <div className="cp-action-sub">Add pieces to your closet so nAia can read your real style</div>
            </div>
            <span className="cp-arrow">→</span>
          </a>
        )}
      </main>
    </div>
  );
}
