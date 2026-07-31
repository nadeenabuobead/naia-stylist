import { useState, useEffect, useCallback } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { redirect, type LoaderFunctionArgs } from "react-router";
import type { OnboardingAnswers, QuizQuestion } from "~/lib/onboarding/quiz-data";
import { quizQuestions } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";

// ─────────────────────────────────────────────────────────────────────────────
// Data tables derived from quiz data at module load time
// ─────────────────────────────────────────────────────────────────────────────

const OPTION_LABELS: Record<string, Record<string, string>> = {};
const COLOR_HEX: Record<string, string> = {};
const MAX_SELECTIONS: Record<string, number> = {};
const QUESTION_BY_ID: Record<string, QuizQuestion> = {};

for (const q of quizQuestions) {
  QUESTION_BY_ID[q.id] = q;
  if (q.options) OPTION_LABELS[q.id] = Object.fromEntries(q.options.map(o => [o.id, o.label]));
  if (q.colors) {
    OPTION_LABELS[q.id] = Object.fromEntries(q.colors.map(c => [c.id, c.name]));
    for (const c of q.colors) COLOR_HEX[c.id] = c.hex;
  }
  if (q.maxSelections !== undefined) MAX_SELECTIONS[q.id] = q.maxSelections;
}

function lbl(qId: string, oId: string): string {
  return OPTION_LABELS[qId]?.[oId] ?? oId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Section definitions
// ─────────────────────────────────────────────────────────────────────────────

type SectionId = "identity" | "feelings" | "life" | "wardrobe" | "colours" | "notes";
type FieldKind = "array" | "color" | "text";
type DraftKey = keyof OnboardingAnswers;

interface SubField {
  draftKey: DraftKey;
  apiKey:   string;
  subLabel: string;
  kind:     FieldKind;
  questionId: string;
}

interface SectionDef {
  id:        SectionId;
  label:     string;
  subFields: SubField[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "identity",
    label: "Your style identity",
    subFields: [
      { draftKey: "style-personalities", apiKey: "stylePersonalities", subLabel: "Style energies",          kind: "array", questionId: "style-personalities" },
      { draftKey: "desired-impression",  apiKey: "desiredImpression",  subLabel: "The impression you make", kind: "array", questionId: "desired-impression"  },
    ],
  },
  {
    id: "feelings",
    label: "How you want to feel",
    subFields: [
      { draftKey: "desired-feelings", apiKey: "desiredFeelings", subLabel: "How you want to feel",  kind: "array", questionId: "desired-feelings" },
      { draftKey: "becoming",         apiKey: "becoming",        subLabel: "Who you're becoming",      kind: "array", questionId: "becoming"         },
    ],
  },
  {
    id: "life",
    label: "Your life and fit",
    subFields: [
      { draftKey: "lifestyle",       apiKey: "lifestyle",      subLabel: "Your lifestyle",           kind: "array", questionId: "lifestyle"       },
      { draftKey: "fit-preferences", apiKey: "fitPreferences", subLabel: "What makes you feel best", kind: "array", questionId: "fit-preferences" },
    ],
  },
  {
    id: "wardrobe",
    label: "Your wardrobe context",
    subFields: [
      { draftKey: "wardrobe-disconnection", apiKey: "styleStruggles", subLabel: "When you feel most disconnected",        kind: "array", questionId: "wardrobe-disconnection" },
      { draftKey: "style-support",          apiKey: "styleSupport",   subLabel: "What would make getting dressed easier", kind: "array", questionId: "style-support"          },
    ],
  },
  {
    id: "colours",
    label: "Your colour direction",
    subFields: [
      { draftKey: "favorite-colors", apiKey: "favoriteColors", subLabel: "Your colour palette", kind: "color", questionId: "favorite-colors" },
      { draftKey: "avoid-colors",    apiKey: "avoidColors",    subLabel: "Colours to avoid",     kind: "color", questionId: "avoid-colors"    },
    ],
  },
  {
    id: "notes",
    label: "Notes to nAia",
    subFields: [
      { draftKey: "final-notes", apiKey: "finalNotes", subLabel: "Your notes to nAia", kind: "text", questionId: "final-notes" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Diff helpers
// ─────────────────────────────────────────────────────────────────────────────

function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// Returns the API patch (only genuinely changed fields) or null if nothing changed.
function computeSectionPatch(
  section:  SectionDef,
  edits:    OnboardingAnswers,
  saved:    OnboardingAnswers,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let hasChange = false;

  for (const { draftKey, apiKey, kind } of section.subFields) {
    const editedRaw = (edits as Record<string, unknown>)[draftKey];
    const savedRaw  = (saved  as Record<string, unknown>)[draftKey];

    if (kind === "text") {
      const edited  = (typeof editedRaw === "string" && editedRaw.trim() !== "") ? editedRaw  : null;
      const current = (typeof savedRaw  === "string" && savedRaw.trim()  !== "") ? savedRaw   : null;
      if (edited !== current) {
        patch[apiKey] = edited; // null = intentional clear
        hasChange = true;
      }
    } else {
      const edited  = (Array.isArray(editedRaw) ? editedRaw : []) as string[];
      const current = (Array.isArray(savedRaw)  ? savedRaw  : []) as string[];
      if (!arraysEqualAsSet(edited, current)) {
        patch[apiKey] = edited; // [] = intentional clear
        hasChange = true;
      }
    }
  }

  return hasChange ? patch : null;
}

// ─────────────────────────────────────────────────────────────────────────────
export function meta() {
  return [{ title: "Style Passport | nAia" }];
}

// Loader
// ─────────────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const op = customer.onboardingProfile;

  // Passport edit is only available for completed profiles.
  // New and incomplete customers go through the quiz first.
  if (!op || !op.completed) {
    throw redirect("/onboarding/step/1");
  }

  const savedAnswers: OnboardingAnswers = {};
  if (op.stylePersonalities.length)  savedAnswers["style-personalities"]    = op.stylePersonalities;
  if (op.desiredImpression.length)   savedAnswers["desired-impression"]     = op.desiredImpression;
  if (op.lifestyle)                  savedAnswers["lifestyle"]              = op.lifestyle.split(", ").filter(Boolean);
  if (op.desiredFeelings.length)     savedAnswers["desired-feelings"]       = op.desiredFeelings;
  if (op.becoming.length)            savedAnswers["becoming"]               = op.becoming;
  if (op.fitPreferences.length)      savedAnswers["fit-preferences"]        = op.fitPreferences;
  if (op.styleStruggles.length)      savedAnswers["wardrobe-disconnection"] = op.styleStruggles;
  if (op.favoriteColors.length)      savedAnswers["favorite-colors"]        = op.favoriteColors;
  if (op.avoidColors.length)         savedAnswers["avoid-colors"]           = op.avoidColors;
  if (op.styleSupport.length)        savedAnswers["style-support"]          = op.styleSupport;
  if (op.finalNotes)                 savedAnswers["final-notes"]            = op.finalNotes;

  return {
    savedAnswers,
    profileUpdatedAt: op.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .pp-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .pp-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .pp-topbar-back{font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .pp-main{max-width:700px;margin:0 auto;padding:48px 40px 80px}
  .pp-eyebrow{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  .pp-headline{font-family:var(--ff-display);font-size:clamp(24px,3.5vw,36px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:8px}
  .pp-desc{font-family:var(--ff-body);font-size:17px;font-style:italic;color:var(--muted);margin-bottom:40px;line-height:1.5}
  .pp-section{border:1px solid rgba(59,5,16,.08);margin-bottom:10px}
  .pp-section-header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px}
  .pp-section-title{font-family:var(--ff-mono);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--deep)}
  .pp-edit-btn{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);background:none;border:none;cursor:pointer;padding:4px 0}
  .pp-edit-btn:disabled{opacity:.4;cursor:not-allowed}
  .pp-section-body{padding:0 24px 24px}
  .pp-sub-label{font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-top:18px;margin-bottom:10px}
  .pp-pills{display:flex;flex-wrap:wrap;gap:8px}
  .pp-pill{padding:8px 16px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep)}
  .pp-color-row{display:flex;flex-wrap:wrap;gap:8px}
  .pp-color-chip{display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep)}
  .pp-color-dot{width:16px;height:16px;border:1px solid rgba(0,0,0,.12);border-radius:1px;flex-shrink:0}
  .pp-empty{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted)}
  .pp-edit-area{background:rgba(59,5,16,.015);border-top:1px solid rgba(59,5,16,.06);padding:20px 24px 24px}
  .pp-cap-hint{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;color:var(--muted);margin-bottom:10px}
  .pp-option-grid{display:flex;flex-wrap:wrap;gap:8px}
  .pp-option{padding:8px 16px;border:1px solid rgba(59,5,16,.15);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;background:transparent;color:var(--deep);transition:all .15s}
  .pp-option:hover{border-color:var(--deep)}
  .pp-option--selected{background:var(--deep);color:var(--cream);border-color:var(--deep)}
  .pp-option--disabled{opacity:.3;cursor:not-allowed;pointer-events:none}
  .pp-color-option{display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid rgba(59,5,16,.15);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;background:transparent;color:var(--deep);transition:all .15s}
  .pp-color-option:hover{border-color:var(--deep)}
  .pp-color-option--selected{background:var(--deep);color:var(--cream);border-color:var(--deep)}
  .pp-color-option--disabled{opacity:.3;cursor:not-allowed;pointer-events:none}
  .pp-textarea{width:100%;min-height:100px;padding:14px;font-family:var(--ff-body);font-size:17px;font-style:italic;color:var(--deep);background:transparent;border:1px solid rgba(59,5,16,.15);resize:vertical;outline:none;margin-bottom:6px}
  .pp-textarea:focus{border-color:var(--deep)}
  .pp-charcount{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;color:var(--muted);margin-bottom:16px}
  .pp-actions{display:flex;align-items:center;gap:16px;margin-top:20px;flex-wrap:wrap}
  .pp-save-btn{padding:10px 24px;background:var(--deep);color:var(--cream);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;border:none;cursor:pointer}
  .pp-save-btn:disabled{opacity:.5;cursor:not-allowed}
  .pp-cancel-btn{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);background:none;border:none;cursor:pointer;padding:0}
  .pp-inline-btn{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;background:none;border:none;cursor:pointer;padding:0}
  .pp-status-error{color:var(--accent)}
  .pp-status-conflict{color:#7a4a00}
  .pp-discard-bar{background:rgba(139,32,53,.04);border-top:1px solid rgba(139,32,53,.12);padding:14px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .pp-discard-text{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);flex:1;min-width:160px}
  .pp-discard-keep{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);background:none;border:1px solid rgba(59,5,16,.2);padding:6px 14px;cursor:pointer}
  .pp-discard-go{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);background:none;border:none;cursor:pointer;padding:0}
  .pp-notes-read{font-family:var(--ff-body);font-size:17px;font-style:italic;color:var(--muted);line-height:1.6}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "error" | "conflict";

export default function PassportPage() {
  const { savedAnswers, profileUpdatedAt } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const [activeSection,       setActiveSection]       = useState<SectionId | null>(null);
  const [sectionEdits,        setSectionEdits]        = useState<OnboardingAnswers>({});
  const [saveStatus,          setSaveStatus]          = useState<SaveStatus>("idle");
  const [awaitingRevalidation, setAwaitingRevalidation] = useState(false);
  const [pendingSection,      setPendingSection]      = useState<SectionId | null>(null);

  // Close the section once revalidation settles after a successful save.
  useEffect(() => {
    if (awaitingRevalidation && revalidator.state === "idle") {
      setAwaitingRevalidation(false);
      setActiveSection(null);
      setSectionEdits({});
      setSaveStatus("idle");
    }
  }, [awaitingRevalidation, revalidator.state]);

  const openSection = useCallback((id: SectionId) => {
    const def = SECTIONS.find(s => s.id === id)!;
    const initialEdits: OnboardingAnswers = {};
    for (const { draftKey, kind } of def.subFields) {
      const v = (savedAnswers as Record<string, unknown>)[draftKey];
      if (kind === "text") {
        (initialEdits as Record<string, unknown>)[draftKey] = typeof v === "string" ? v : "";
      } else {
        (initialEdits as Record<string, unknown>)[draftKey] = Array.isArray(v) ? [...v] : [];
      }
    }
    setActiveSection(id);
    setSectionEdits(initialEdits);
    setSaveStatus("idle");
    setPendingSection(null);
  }, [savedAnswers]);

  const handleEditClick = useCallback((id: SectionId) => {
    if (activeSection === id) return;

    if (activeSection !== null) {
      const activeDef = SECTIONS.find(s => s.id === activeSection)!;
      if (computeSectionPatch(activeDef, sectionEdits, savedAnswers) !== null) {
        // Unsaved changes in the open section — ask for confirmation before leaving
        setPendingSection(id);
        return;
      }
    }

    openSection(id);
  }, [activeSection, sectionEdits, savedAnswers, openSection]);

  const handleCancel = useCallback(() => {
    setActiveSection(null);
    setSectionEdits({});
    setSaveStatus("idle");
    setPendingSection(null);
  }, []);

  const handleToggle = useCallback((draftKey: DraftKey, optId: string, maxSel: number) => {
    setSectionEdits(prev => {
      const current = ((prev as Record<string, unknown>)[draftKey] as string[] | undefined) ?? [];
      if (current.includes(optId)) {
        return { ...prev, [draftKey]: current.filter(id => id !== optId) };
      }
      if (current.length < maxSel) {
        return { ...prev, [draftKey]: [...current, optId] };
      }
      return prev; // at cap, ignore
    });
  }, []);

  const handleTextChange = useCallback((draftKey: DraftKey, value: string) => {
    setSectionEdits(prev => ({ ...prev, [draftKey]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeSection) return;
    const def = SECTIONS.find(s => s.id === activeSection)!;
    const patch = computeSectionPatch(def, sectionEdits, savedAnswers);

    if (patch === null) {
      // Nothing genuinely changed — close silently, no API call
      setActiveSection(null);
      setSectionEdits({});
      setSaveStatus("idle");
      return;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch("/api/save-style-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, baseProfileUpdatedAt: profileUpdatedAt }),
      });

      if (res.status === 409) { setSaveStatus("conflict"); return; }
      if (!res.ok)             { setSaveStatus("error");    return; }

      // Keep "saving" indicator visible until the loader re-runs with fresh data
      setAwaitingRevalidation(true);
      revalidator.revalidate();
    } catch {
      setSaveStatus("error");
    }
  }, [activeSection, sectionEdits, savedAnswers, profileUpdatedAt, revalidator]);

  // ── render helpers ──────────────────────────────────────────────────────────

  function renderReadField(sf: SubField) {
    const v = (savedAnswers as Record<string, unknown>)[sf.draftKey];

    if (sf.kind === "text") {
      if (!v || typeof v !== "string") return <span className="pp-empty">—</span>;
      return <p className="pp-notes-read">&ldquo;{v}&rdquo;</p>;
    }

    const ids = (Array.isArray(v) ? v : []) as string[];
    if (ids.length === 0) return <span className="pp-empty">—</span>;

    if (sf.kind === "color") {
      return (
        <div className="pp-color-row">
          {ids.map(id => (
            <div key={id} className="pp-color-chip">
              <span className="pp-color-dot" style={{ background: COLOR_HEX[id] ?? "#ccc" }} />
              {lbl(sf.questionId, id)}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="pp-pills">
        {ids.map(id => <span key={id} className="pp-pill">{lbl(sf.questionId, id)}</span>)}
      </div>
    );
  }

  function renderEditField(sf: SubField) {
    const q = QUESTION_BY_ID[sf.questionId];
    const selected = ((sectionEdits as Record<string, unknown>)[sf.draftKey] as string[] | undefined) ?? [];
    const max = MAX_SELECTIONS[sf.questionId] ?? 99;
    const atCap = selected.length >= max;

    if (sf.kind === "text") {
      const val = ((sectionEdits as Record<string, unknown>)[sf.draftKey] as string) ?? "";
      return (
        <>
          <textarea
            className="pp-textarea"
            value={val}
            maxLength={500}
            placeholder="e.g. I'm trying to dress more professionally, I just had a baby..."
            onChange={e => handleTextChange(sf.draftKey, e.target.value)}
          />
          <div className="pp-charcount">{val.length} / 500</div>
        </>
      );
    }

    if (sf.kind === "color") {
      const colors = q.colors ?? [];
      return (
        <div className="pp-option-grid">
          {colors.map(c => {
            const isSel = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`pp-color-option${isSel ? " pp-color-option--selected" : ""}${!isSel && atCap ? " pp-color-option--disabled" : ""}`}
                onClick={() => handleToggle(sf.draftKey, c.id, max)}
              >
                <span
                  className="pp-color-dot"
                  style={{
                    background: c.hex,
                    border: isSel ? "1px solid rgba(244,244,241,.4)" : "1px solid rgba(0,0,0,.12)",
                  }}
                />
                {c.name}
              </button>
            );
          })}
        </div>
      );
    }

    // "array" — standard multi-select options
    const options = q.options ?? [];
    return (
      <div className="pp-option-grid">
        {options.map(o => {
          const isSel = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`pp-option${isSel ? " pp-option--selected" : ""}${!isSel && atCap ? " pp-option--disabled" : ""}`}
              onClick={() => handleToggle(sf.draftKey, o.id, max)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  function renderSection(def: SectionDef) {
    const isActive = activeSection === def.id;
    const isBusy   = saveStatus === "saving" || awaitingRevalidation;

    return (
      <div key={def.id} className="pp-section">
        <div className="pp-section-header">
          <span className="pp-section-title">{def.label}</span>
          {isActive ? (
            <button type="button" className="pp-edit-btn" onClick={handleCancel} disabled={isBusy}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="pp-edit-btn"
              onClick={() => handleEditClick(def.id)}
              disabled={isBusy}
            >
              Edit →
            </button>
          )}
        </div>

        {/* Discard confirmation — rendered inside the active section */}
        {isActive && pendingSection && (
          <div className="pp-discard-bar">
            <span className="pp-discard-text">Discard unsaved changes?</span>
            <button
              type="button"
              className="pp-discard-keep"
              onClick={() => setPendingSection(null)}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="pp-discard-go"
              onClick={() => openSection(pendingSection)}
            >
              Discard changes
            </button>
          </div>
        )}

        {/* Read view */}
        {!isActive && (
          <div className="pp-section-body">
            {def.subFields.map(sf => (
              <div key={String(sf.draftKey)}>
                <div className="pp-sub-label">{sf.subLabel}</div>
                {renderReadField(sf)}
              </div>
            ))}
          </div>
        )}

        {/* Edit view */}
        {isActive && (
          <div className="pp-edit-area">
            {def.subFields.map(sf => (
              <div key={String(sf.draftKey)}>
                <div className="pp-sub-label">{sf.subLabel}</div>
                {sf.kind !== "text" && (
                  <div className="pp-cap-hint">Choose up to {MAX_SELECTIONS[sf.questionId] ?? "—"}</div>
                )}
                {renderEditField(sf)}
              </div>
            ))}

            <div className="pp-actions">
              <button
                type="button"
                className="pp-save-btn"
                disabled={isBusy}
                onClick={handleSave}
              >
                {isBusy ? "Saving…" : "Save section"}
              </button>
              {!isBusy && saveStatus === "idle" && (
                <button type="button" className="pp-cancel-btn" onClick={handleCancel}>
                  Cancel
                </button>
              )}
              {saveStatus === "error" && (
                <span className="pp-status-error" style={{ fontFamily: "var(--ff-mono)", fontSize: "9px", letterSpacing: "1px" }}>
                  Could not save —{" "}
                  <button
                    type="button"
                    className="pp-inline-btn pp-status-error"
                    onClick={handleSave}
                  >
                    Retry
                  </button>
                </span>
              )}
              {saveStatus === "conflict" && (
                <span className="pp-status-conflict" style={{ fontFamily: "var(--ff-mono)", fontSize: "9px", letterSpacing: "1px" }}>
                  Updated elsewhere —{" "}
                  <button
                    type="button"
                    className="pp-inline-btn pp-status-conflict"
                    onClick={() => window.location.reload()}
                  >
                    Reload
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <style>{css}</style>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap"
        rel="stylesheet"
      />

      <div className="pp-topbar">
        <div className="pp-topbar-logo">nAia</div>
        <Link to="/" className="pp-topbar-back">← Dashboard</Link>
      </div>

      <main className="pp-main">
        <div className="pp-eyebrow">Your nAia Passport</div>
        <h1 className="pp-headline">Your style, your way.</h1>
        <p className="pp-desc">Update one section at a time. Save when you&apos;re ready.</p>

        {SECTIONS.map(def => renderSection(def))}
      </main>
    </div>
  );
}
