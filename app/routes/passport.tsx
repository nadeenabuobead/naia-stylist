import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { redirect, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];
import type { OnboardingAnswers, QuizQuestion } from "~/lib/onboarding/quiz-data";
import { quizQuestions } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

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
  draftKey:   DraftKey;
  apiKey:     string;
  subLabel:   string;
  kind:       FieldKind;
  questionId: string;
}

interface SectionDef {
  id:        SectionId;
  label:     string;
  question:  string;
  helper:    string;
  subFields: SubField[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "identity",
    label: "Your style identity",
    question: "Which style energies feel closest to you right now?",
    helper: "Select what resonates. nAia blends these into the aesthetic of every recommendation.",
    subFields: [
      { draftKey: "style-personalities", apiKey: "stylePersonalities", subLabel: "Style energies",          kind: "array", questionId: "style-personalities" },
      { draftKey: "desired-impression",  apiKey: "desiredImpression",  subLabel: "The impression you make", kind: "array", questionId: "desired-impression"  },
    ],
  },
  {
    id: "feelings",
    label: "How you want to feel",
    question: "How do you want to feel in what you wear?",
    helper: "This shapes the emotional register of your StyleMe recommendations.",
    subFields: [
      { draftKey: "desired-feelings", apiKey: "desiredFeelings", subLabel: "How you want to feel", kind: "array", questionId: "desired-feelings" },
      { draftKey: "becoming",         apiKey: "becoming",        subLabel: "Who you're becoming",  kind: "array", questionId: "becoming"         },
    ],
  },
  {
    id: "life",
    label: "Your life and fit",
    question: "Where does your wardrobe need to show up most often?",
    helper: "Choose the settings and silhouettes that work best for your week.",
    subFields: [
      { draftKey: "lifestyle",       apiKey: "lifestyle",      subLabel: "Your lifestyle",           kind: "array", questionId: "lifestyle"       },
      { draftKey: "fit-preferences", apiKey: "fitPreferences", subLabel: "What makes you feel best", kind: "array", questionId: "fit-preferences" },
    ],
  },
  {
    id: "wardrobe",
    label: "Your wardrobe context",
    question: "What does your wardrobe need most right now?",
    helper: "Knowing where you feel disconnected helps nAia focus on the right solutions.",
    subFields: [
      { draftKey: "wardrobe-disconnection", apiKey: "styleStruggles", subLabel: "When you feel most disconnected",        kind: "array", questionId: "wardrobe-disconnection" },
      { draftKey: "style-support",          apiKey: "styleSupport",   subLabel: "What would make getting dressed easier", kind: "array", questionId: "style-support"          },
    ],
  },
  {
    id: "colours",
    label: "Your colour direction",
    question: "Which palette should nAia lean into for you?",
    helper: "Pick the tones you want to see returning across your looks.",
    subFields: [
      { draftKey: "favorite-colors", apiKey: "favoriteColors", subLabel: "Your colour palette", kind: "color", questionId: "favorite-colors" },
      { draftKey: "avoid-colors",    apiKey: "avoidColors",    subLabel: "Colours to avoid",    kind: "color", questionId: "avoid-colors"    },
    ],
  },
  {
    id: "notes",
    label: "Notes to nAia",
    question: "Anything nAia should always keep in mind?",
    helper: "Share context that wouldn't come through in selections — life changes, occasions, or specific things to avoid.",
    subFields: [
      { draftKey: "final-notes", apiKey: "finalNotes", subLabel: "Your notes to nAia", kind: "text", questionId: "final-notes" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Diff helper
// ─────────────────────────────────────────────────────────────────────────────

function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function computeSectionPatch(
  section: SectionDef,
  edits:   OnboardingAnswers,
  saved:   OnboardingAnswers,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let hasChange = false;

  for (const { draftKey, apiKey, kind } of section.subFields) {
    const editedRaw = (edits as Record<string, unknown>)[draftKey];
    const savedRaw  = (saved  as Record<string, unknown>)[draftKey];

    if (kind === "text") {
      const edited  = (typeof editedRaw === "string" && editedRaw.trim() !== "") ? editedRaw  : null;
      const current = (typeof savedRaw  === "string" && savedRaw.trim()  !== "") ? savedRaw   : null;
      if (edited !== current) { patch[apiKey] = edited; hasChange = true; }
    } else {
      const edited  = (Array.isArray(editedRaw) ? editedRaw : []) as string[];
      const current = (Array.isArray(savedRaw)  ? savedRaw  : []) as string[];
      if (!arraysEqualAsSet(edited, current)) { patch[apiKey] = edited; hasChange = true; }
    }
  }

  return hasChange ? patch : null;
}

// ─────────────────────────────────────────────────────────────────────────────

export function meta() {
  return [{ title: "Style Passport | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const op = customer.onboardingProfile;

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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function getSectionSummary(def: SectionDef, answers: OnboardingAnswers): React.ReactNode {
  for (const sf of def.subFields) {
    const v = (answers as Record<string, unknown>)[sf.draftKey];
    if (sf.kind === "text") {
      if (v && typeof v === "string" && v.trim()) return "Notes added";
    } else {
      const ids = (Array.isArray(v) ? v : []) as string[];
      if (ids.length > 0) {
        const labels = ids.map(id => lbl(sf.questionId, id));
        return labels.slice(0, 3).join(" · ") + (labels.length > 3 ? "…" : "");
      }
    }
  }
  return <span className="sp-detail-missing">Not yet completed</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Mode =
  | { kind: "overview" }
  | { kind: "flow"; queue: SectionId[]; index: number; done?: boolean }
  | { kind: "picker" };

type SaveStatus = "idle" | "saving" | "error" | "conflict";
type PendingNext = "next" | "exit" | null;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PassportPage() {
  const { savedAnswers, profileUpdatedAt } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const [mode,                 setMode]                 = useState<Mode>({ kind: "overview" });
  const [flowEdits,            setFlowEdits]            = useState<OnboardingAnswers>({});
  const [saveStatus,           setSaveStatus]           = useState<SaveStatus>("idle");
  const [awaitingRevalidation, setAwaitingRevalidation] = useState(false);
  const [pendingNext,          setPendingNext]          = useState<PendingNext>(null);

  const missingSections = useMemo(() =>
    SECTIONS.filter(s => {
      const primary = s.subFields[0];
      const v = (savedAnswers as Record<string, unknown>)[primary.draftKey];
      return primary.kind === "text"
        ? !v || (typeof v === "string" && !v.trim())
        : !Array.isArray(v) || (v as string[]).length === 0;
    }),
    [savedAnswers]
  );
  const isComplete = missingSections.length === 0;

  // Settle after revalidation
  useEffect(() => {
    if (!awaitingRevalidation || revalidator.state !== "idle") return;
    setAwaitingRevalidation(false);
    setSaveStatus("idle");

    if (pendingNext === "exit") {
      setPendingNext(null);
      setMode({ kind: "overview" });
    } else if (pendingNext === "next" && mode.kind === "flow") {
      setPendingNext(null);
      if (mode.index + 1 >= mode.queue.length) {
        setMode({ ...mode, done: true });
      } else {
        const nextId = mode.queue[mode.index + 1];
        initEdits(nextId);
        setMode({ ...mode, index: mode.index + 1 });
      }
    }
  }, [awaitingRevalidation, revalidator.state, pendingNext, mode]); // eslint-disable-line

  function initEdits(sectionId: SectionId) {
    const def = SECTIONS.find(s => s.id === sectionId)!;
    const edits: OnboardingAnswers = {};
    for (const { draftKey, kind } of def.subFields) {
      const v = (savedAnswers as Record<string, unknown>)[draftKey];
      (edits as Record<string, unknown>)[draftKey] =
        kind === "text"
          ? (typeof v === "string" ? v : "")
          : (Array.isArray(v) ? [...v] : []);
    }
    setFlowEdits(edits);
  }

  function startContinue() {
    if (!missingSections.length) return;
    initEdits(missingSections[0].id);
    setMode({ kind: "flow", queue: missingSections.map(s => s.id), index: 0 });
  }

  function startUpdate() { setMode({ kind: "picker" }); }

  function editSection(id: SectionId) {
    initEdits(id);
    setMode({ kind: "flow", queue: [id], index: 0 });
  }

  const handleToggle = useCallback((draftKey: DraftKey, optId: string, maxSel: number) => {
    setFlowEdits(prev => {
      const current = ((prev as Record<string, unknown>)[draftKey] as string[] | undefined) ?? [];
      if (current.includes(optId)) return { ...prev, [draftKey]: current.filter(id => id !== optId) };
      if (current.length < maxSel) return { ...prev, [draftKey]: [...current, optId] };
      return prev;
    });
  }, []);

  const handleTextChange = useCallback((draftKey: DraftKey, value: string) => {
    setFlowEdits(prev => ({ ...prev, [draftKey]: value }));
  }, []);

  async function saveSection(sectionId: SectionId, intent: PendingNext) {
    const def = SECTIONS.find(s => s.id === sectionId)!;
    const patch = computeSectionPatch(def, flowEdits, savedAnswers);

    if (patch === null) {
      // Nothing changed — navigate immediately without an API call
      if (intent === "exit") {
        setMode({ kind: "overview" });
      } else if (mode.kind === "flow") {
        if (mode.index + 1 >= mode.queue.length) {
          setMode({ ...mode, done: true });
        } else {
          const nextId = mode.queue[mode.index + 1];
          initEdits(nextId);
          setMode({ ...mode, index: mode.index + 1 });
        }
      }
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
      if (!res.ok)            { setSaveStatus("error");    return; }

      setPendingNext(intent);
      setAwaitingRevalidation(true);
      revalidator.revalidate();
    } catch {
      setSaveStatus("error");
    }
  }

  const isBusy = saveStatus === "saving" || awaitingRevalidation;

  // ── Sub-field editor (used in flow mode) ────────────────────────────────────

  function renderSubField(sf: SubField) {
    const q     = QUESTION_BY_ID[sf.questionId];
    const sel   = ((flowEdits as Record<string, unknown>)[sf.draftKey] as string[] | undefined) ?? [];
    const max   = MAX_SELECTIONS[sf.questionId] ?? 99;
    const atCap = sel.length >= max;

    if (sf.kind === "text") {
      const val = ((flowEdits as Record<string, unknown>)[sf.draftKey] as string) ?? "";
      return (
        <>
          <textarea
            className="sp-textarea"
            value={val}
            maxLength={500}
            placeholder="e.g. I'm dressing more professionally, I just had a baby, I need versatile pieces…"
            onChange={e => handleTextChange(sf.draftKey, e.target.value)}
          />
          <div className="sp-charcount">{val.length} / 500</div>
        </>
      );
    }

    if (sf.kind === "color") {
      return (
        <div className="sp-option-grid">
          {(q.colors ?? []).map(c => {
            const isSel = sel.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`sp-color-option${isSel ? " sp-color-option--active" : ""}${!isSel && atCap ? " sp-color-option--disabled" : ""}`}
                onClick={() => handleToggle(sf.draftKey, c.id, max)}
              >
                <span
                  className="sp-color-dot"
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

    return (
      <div className="sp-option-grid">
        {(q.options ?? []).map(o => {
          const isSel = sel.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`sp-option${isSel ? " sp-option--active" : ""}${!isSel && atCap ? " sp-option--disabled" : ""}`}
              onClick={() => handleToggle(sf.draftKey, o.id, max)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  // ── OVERVIEW ─────────────────────────────────────────────────────────────────

  if (mode.kind === "overview") {
    return (
      <MyNaiaLayout currentPath="/passport">
        <Link to="/my-naia" className="sp-back">← Overview</Link>

        <div className="sp-shell">
          <div className="sp-shell-eyebrow">Style Passport</div>
          <h1 className="sp-shell-title">Your Style Passport</h1>
          <p className="sp-shell-desc">
            Your Style Passport guides every StyleMe recommendation. Update it whenever your
            preferences evolve — changes flow through the rest of nAia immediately.
          </p>
        </div>

        <div className="sp-status-block">
          <div className="sp-status-label">Status</div>
          <p className="sp-status-text">
            {isComplete ? "Your Style Passport is up to date." : "A few details are still missing."}
          </p>
          <div className="sp-status-date">Last updated · {formatDate(profileUpdatedAt)}</div>
        </div>

        <div className="sp-detail-list">
          {SECTIONS.map(def => (
            <div key={def.id} className="sp-detail-row">
              <span className="sp-detail-label">{def.label}</span>
              <span className="sp-detail-value">{getSectionSummary(def, savedAnswers)}</span>
            </div>
          ))}
        </div>

        <div className="sp-actions">
          {!isComplete && (
            <button type="button" className="sp-btn-primary" onClick={startContinue}>
              Continue Passport
            </button>
          )}
          <button type="button" className="sp-btn-outline" onClick={startUpdate}>
            Update Answers
          </button>
        </div>

        {!isComplete && missingSections[0] && (
          <div className="sp-state-note">
            You'll resume at <strong>{missingSections[0].label}</strong>. All previous answers are preserved.
          </div>
        )}
      </MyNaiaLayout>
    );
  }

  // ── PICKER ───────────────────────────────────────────────────────────────────

  if (mode.kind === "picker") {
    return (
      <MyNaiaLayout currentPath="/passport">
        <button type="button" className="sp-back" onClick={() => setMode({ kind: "overview" })}>
          ← Back to Passport
        </button>

        <div className="sp-shell">
          <div className="sp-shell-eyebrow">Update Answers</div>
          <h2 className="sp-shell-title">Which section would you like to edit?</h2>
          <p className="sp-shell-desc">
            Choose any section below. All other answers stay exactly as they are.
          </p>
        </div>

        <div className="sp-picker-list">
          {SECTIONS.map(def => (
            <button
              key={def.id}
              type="button"
              className="sp-picker-btn"
              onClick={() => editSection(def.id)}
            >
              <span className="sp-picker-label">{def.label}</span>
              <span className="sp-picker-value">{getSectionSummary(def, savedAnswers)}</span>
            </button>
          ))}
        </div>
      </MyNaiaLayout>
    );
  }

  // ── COMPLETION ───────────────────────────────────────────────────────────────

  if (mode.kind === "flow" && mode.done) {
    return (
      <MyNaiaLayout currentPath="/passport">
        <button type="button" className="sp-back" onClick={() => setMode({ kind: "overview" })}>
          ← Style Passport
        </button>

        <div className="sp-shell">
          <div className="sp-shell-eyebrow">Style Passport</div>
          <h1 className="sp-shell-title">Your Style Passport is up to date</h1>
          <p className="sp-shell-desc">
            nAia has your latest preferences. You can revisit any answer at any time.
          </p>
        </div>

        <div className="sp-actions">
          <button type="button" className="sp-btn-primary" onClick={() => setMode({ kind: "overview" })}>
            Return to Passport
          </button>
        </div>
      </MyNaiaLayout>
    );
  }

  // ── FLOW STEP ────────────────────────────────────────────────────────────────

  if (mode.kind !== "flow") return null;

  const currentDef  = SECTIONS.find(s => s.id === mode.queue[mode.index])!;
  const stepNum     = mode.index + 1;
  const stepTotal   = mode.queue.length;
  const isLastStep  = mode.index + 1 >= mode.queue.length;
  const currentId   = mode.queue[mode.index];

  return (
    <MyNaiaLayout currentPath="/passport">
      <button
        type="button"
        className="sp-back"
        disabled={isBusy}
        onClick={() => saveSection(currentId, "exit")}
      >
        ← Save and exit
      </button>

      <div className="sp-flow-header">
        <div className="sp-flow-meta">
          Step {stepNum} of {stepTotal} · {currentDef.label}
        </div>
        <h2 className="sp-flow-question">{currentDef.question}</h2>
        <p className="sp-flow-helper">{currentDef.helper}</p>
      </div>

      {currentDef.subFields.map(sf => (
        <div key={String(sf.draftKey)}>
          {currentDef.subFields.length > 1 && (
            <div className="sp-sub-label">{sf.subLabel}</div>
          )}
          {sf.kind !== "text" && MAX_SELECTIONS[sf.questionId] && (
            <div className="sp-cap-hint">Choose up to {MAX_SELECTIONS[sf.questionId]}</div>
          )}
          {renderSubField(sf)}
        </div>
      ))}

      <div className="sp-flow-actions">
        <button
          type="button"
          className="sp-btn-outline"
          disabled={isBusy}
          onClick={() => {
            if (mode.index === 0) {
              setMode({ kind: "overview" });
            } else {
              const prevId = mode.queue[mode.index - 1];
              initEdits(prevId);
              setMode({ ...mode, index: mode.index - 1 });
            }
          }}
        >
          Back
        </button>

        <button
          type="button"
          className="sp-btn-primary"
          disabled={isBusy}
          onClick={() => saveSection(currentId, "next")}
        >
          {isBusy ? "Saving…" : isLastStep ? "Finish" : "Continue"}
        </button>

        {!isBusy && (
          <button
            type="button"
            className="sp-btn-ghost"
            onClick={() => saveSection(currentId, "exit")}
          >
            Save and exit
          </button>
        )}

        {saveStatus === "error" && (
          <span className="sp-save-error">
            Could not save —{" "}
            <button
              type="button"
              className="sp-save-inline-btn"
              onClick={() => saveSection(currentId, pendingNext)}
            >
              Retry
            </button>
          </span>
        )}

        {saveStatus === "conflict" && (
          <span className="sp-save-conflict">
            Updated elsewhere —{" "}
            <button
              type="button"
              className="sp-save-inline-btn"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </span>
        )}
      </div>
    </MyNaiaLayout>
  );
}
