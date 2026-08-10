import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { Link, useLoaderData, useRevalidator, useNavigate, redirect } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];
import type { OnboardingAnswers, QuizQuestion } from "~/lib/onboarding/quiz-data";
import { quizQuestions, COLOUR_FAMILIES } from "~/lib/onboarding/quiz-data";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

// ─────────────────────────────────────────────────────────────────────────────
// Data tables derived from quiz data + passport-only definitions
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
  // Register secondary question
  if (q.secondaryQuestion) {
    const sq = q.secondaryQuestion;
    OPTION_LABELS[sq.id] = Object.fromEntries(sq.colors.map(c => [c.id, c.name]));
    for (const c of sq.colors) COLOR_HEX[c.id] = c.hex;
    MAX_SELECTIONS[sq.id] = sq.maxSelections;
    QUESTION_BY_ID[sq.id] = {
      id: sq.id, type: "color", title: sq.title, subtitle: sq.subtitle,
      colors: sq.colors, maxSelections: sq.maxSelections,
    };
  }
}

// Passport-only question definitions (not in onboarding flow)
const PASSPORT_ONLY_QUESTIONS: Record<string, QuizQuestion> = {
  "typical-day": {
    id: "typical-day",
    type: "text",
    title: "What does a typical week of getting dressed look like for you?",
    placeholder: "Optional. Mention workdays, casual days, events, travel, caregiving, dress codes or anything else that changes what you need.",
    maxLength: 500,
  },
  "structure": {
    id: "structure",
    type: "single",
    title: "How do you like your pieces constructed?",
    options: [
      { id: "soft-fluid",         label: "Soft and fluid"                    },
      { id: "lightly-structured", label: "Lightly structured"                },
      { id: "sharp-tailored",     label: "Sharp and tailored"                },
      { id: "balanced-structure", label: "A balance of soft and structured"  },
    ],
  },
  "coverage-preferences": {
    id: "coverage-preferences",
    type: "multi",
    title: "Which coverage and length details do you tend to prefer?",
    subtitle: "Optional, up to 4",
    maxSelections: 4,
    options: [
      { id: "open-necklines",    label: "Open necklines"      },
      { id: "sleeves-preferred", label: "Sleeves preferred"   },
      { id: "longer-hemlines",   label: "Longer hemlines"     },
      { id: "cropped",           label: "Cropped lengths"     },
      { id: "no-preference",     label: "No strong preference"},
    ],
  },
  "neutral-vs-colour": {
    id: "neutral-vs-colour",
    type: "single",
    title: "Do you lean towards neutrals or colour?",
    options: [
      { id: "mostly-neutrals",    label: "Mostly neutrals"                  },
      { id: "neutrals-with-pops", label: "Neutrals with occasional colour"  },
      { id: "equal-mix",          label: "An equal mix"                     },
      { id: "mostly-colourful",   label: "I love colour"                    },
    ],
  },
  "colour-intensity": {
    id: "colour-intensity",
    type: "single",
    title: "When you wear colour, you prefer it…",
    options: [
      { id: "muted-tonal",   label: "Muted and tonal"     },
      { id: "clear-bright",  label: "Clear and bright"    },
      { id: "no-preference", label: "No strong preference" },
    ],
  },
  "print-appetite": {
    id: "print-appetite",
    type: "single",
    title: "How often do you wear prints or patterns?",
    options: [
      { id: "rarely",          label: "Rarely — I prefer solids"             },
      { id: "occasionally",    label: "Occasionally — one print at a time"   },
      { id: "often",           label: "Often — prints are part of my style"  },
      { id: "pattern-mixing",  label: "Pattern mixing is my thing"           },
    ],
  },
};

// Add passport-only questions to lookup tables
for (const [id, q] of Object.entries(PASSPORT_ONLY_QUESTIONS)) {
  QUESTION_BY_ID[id] = q;
  if (q.options) OPTION_LABELS[id] = Object.fromEntries(q.options.map(o => [o.id, o.label]));
  if (q.maxSelections !== undefined) MAX_SELECTIONS[id] = q.maxSelections;
}

// COLOUR_FAMILIES are the same for both favourite and avoid
for (const c of COLOUR_FAMILIES) COLOR_HEX[c.id] = c.hex;

function lbl(qId: string, oId: string): string {
  return OPTION_LABELS[qId]?.[oId] ?? oId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Section definitions — 7 named sections + Notes (outside sections)
// ─────────────────────────────────────────────────────────────────────────────

type SectionId =
  | "identity" | "direction" | "life" | "fit" | "sizes" | "colours" | "wardrobe"
  | "notes";

type FieldKind = "array" | "color" | "single" | "text";
type DraftKey = keyof OnboardingAnswers;

interface SubField {
  draftKey:   DraftKey;
  apiKey:     string;
  subLabel:   string;
  kind:       FieldKind;
  questionId: string;
  pairKey?:   DraftKey; // for mutual-exclusion between colour pickers
}

interface SectionDef {
  id:          SectionId;
  label:       string;
  question:    string;
  helper:      string;
  subFields:   SubField[];
  placeholder?: boolean; // Section 5 — V2-C/V2-D not yet implemented
}

// Exact section labels (names) as specified
const SECTIONS: SectionDef[] = [
  {
    id: "identity",
    label: "Your Style Identity",
    question: "Which style energies feel most like you?",
    helper: "Select what resonates. nAia blends these into the aesthetic of every recommendation.",
    subFields: [
      { draftKey: "style-personalities", apiKey: "stylePersonalities", subLabel: "Style energies",       kind: "array", questionId: "style-personalities" },
      { draftKey: "desired-impression",  apiKey: "desiredImpression",  subLabel: "The impression I make", kind: "array", questionId: "desired-impression"  },
    ],
  },
  {
    id: "direction",
    label: "Your Style Direction",
    question: "How do you want to feel in what you wear?",
    helper: "This shapes the emotional register of your StyleMe recommendations.",
    subFields: [
      { draftKey: "desired-feelings", apiKey: "desiredFeelings", subLabel: "How I want to feel", kind: "array", questionId: "desired-feelings" },
      { draftKey: "becoming",         apiKey: "becoming",        subLabel: "Who I'm becoming",   kind: "array", questionId: "becoming"         },
    ],
  },
  {
    id: "life",
    label: "Your Life & Dress Codes",
    question: "Where does your wardrobe need to show up most often?",
    helper: "Choose the settings that define your week, and describe how your days unfold.",
    subFields: [
      { draftKey: "lifestyle",    apiKey: "lifestyle",   subLabel: "My lifestyle",       kind: "array", questionId: "lifestyle"    },
      { draftKey: "typical-day", apiKey: "typicalDay",  subLabel: "A typical week",     kind: "text",  questionId: "typical-day"  },
    ],
  },
  {
    id: "fit",
    label: "Your Fit, Coverage & Comfort",
    question: "What silhouettes and construction details feel most like you?",
    helper: "nAia uses these to filter recommendations to shapes that work for you.",
    subFields: [
      { draftKey: "silhouette",           apiKey: "silhouette",          subLabel: "My silhouettes",        kind: "array",  questionId: "silhouette"           },
      { draftKey: "structure",            apiKey: "structure",           subLabel: "Construction",          kind: "single", questionId: "structure"            },
      { draftKey: "coverage-preferences", apiKey: "coveragePreferences", subLabel: "Coverage preferences",  kind: "array",  questionId: "coverage-preferences" },
    ],
  },
  {
    id: "sizes",
    label: "Your Sizes & Fit",
    question: "Your detailed fit profile",
    helper: "",
    subFields: [],
    placeholder: true,
  },
  {
    id: "colours",
    label: "Your Colour & Visual Language",
    question: "Which palette should nAia lean into for you?",
    helper: "Pick the tones you want to see returning across your looks.",
    subFields: [
      { draftKey: "favorite-colors",   apiKey: "favoriteColors",  subLabel: "My colour palette",    kind: "color",  questionId: "favorite-colors",   pairKey: "avoid-colors"      },
      { draftKey: "avoid-colors",      apiKey: "avoidColors",     subLabel: "Colours to avoid",     kind: "color",  questionId: "avoid-colors",      pairKey: "favorite-colors"   },
      { draftKey: "neutral-vs-colour", apiKey: "neutralVsColour", subLabel: "Neutrals vs colour",   kind: "single", questionId: "neutral-vs-colour"  },
      { draftKey: "colour-intensity",  apiKey: "colourIntensity", subLabel: "Colour intensity",     kind: "single", questionId: "colour-intensity"   },
      { draftKey: "print-appetite",    apiKey: "printAppetite",   subLabel: "Prints & patterns",    kind: "single", questionId: "print-appetite"     },
    ],
  },
  {
    id: "wardrobe",
    label: "Your Wardrobe, Shopping & Trend Preferences",
    question: "What does your wardrobe need most right now?",
    helper: "Knowing where you feel disconnected and what drives your purchases helps nAia focus on the right solutions.",
    subFields: [
      { draftKey: "wardrobe-disconnection", apiKey: "styleStruggles",     subLabel: "When I feel most disconnected",        kind: "array",  questionId: "wardrobe-disconnection" },
      { draftKey: "style-support",          apiKey: "styleSupport",       subLabel: "What would make getting dressed easier", kind: "array", questionId: "style-support"          },
      { draftKey: "shopping-priorities",    apiKey: "shoppingPriorities", subLabel: "Shopping priorities",                  kind: "array",  questionId: "shopping-priorities"    },
      { draftKey: "trend-appetite",         apiKey: "trendAppetite",      subLabel: "Trend appetite",                       kind: "single", questionId: "trend-appetite"         },
    ],
  },
];

// Notes to nAia — outside the 7 named sections
const NOTES_SECTION: SectionDef = {
  id: "notes",
  label: "Notes to nAia",
  question: "Anything else nAia should know about your style right now?",
  helper: "Share context that wouldn't come through in selections — life changes, occasions, or specific things to avoid.",
  subFields: [
    { draftKey: "final-notes", apiKey: "finalNotes", subLabel: "Your notes to nAia", kind: "text", questionId: "final-notes" },
  ],
};

// All sections (for flow logic) — notes appended
const ALL_SECTIONS = [...SECTIONS, NOTES_SECTION];

function getSectionDef(id: SectionId): SectionDef {
  return ALL_SECTIONS.find(s => s.id === id) ?? SECTIONS[0];
}

// Legacy colour IDs that are stripped from favoriteColors on explicit Passport save
const LEGACY_COLOUR_IDS = new Set(["prints", "colorful"]);

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
    } else if (kind === "single") {
      const edited  = (typeof editedRaw === "string" && editedRaw !== "") ? editedRaw  : null;
      const current = (typeof savedRaw  === "string" && savedRaw  !== "") ? savedRaw   : null;
      if (edited !== current) { patch[apiKey] = edited; hasChange = true; }
    } else {
      // array / color
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
  if (op.stylePersonalities.length)          savedAnswers["style-personalities"]    = op.stylePersonalities;
  if (op.desiredImpression.length)           savedAnswers["desired-impression"]     = op.desiredImpression;
  if (op.lifestyle)                          savedAnswers["lifestyle"]              = op.lifestyle.split(", ").filter(Boolean);
  if (op.desiredFeelings.length)             savedAnswers["desired-feelings"]       = op.desiredFeelings;
  if (op.becoming.length)                    savedAnswers["becoming"]               = op.becoming;
  if ((op as any).silhouette?.length)        savedAnswers["silhouette"]             = (op as any).silhouette;
  if (op.styleStruggles.length)              savedAnswers["wardrobe-disconnection"] = op.styleStruggles;
  if (op.favoriteColors.length)              savedAnswers["favorite-colors"]        = op.favoriteColors;
  if (op.avoidColors.length)                 savedAnswers["avoid-colors"]           = op.avoidColors;
  if (op.styleSupport.length)                savedAnswers["style-support"]          = op.styleSupport;
  if (op.finalNotes)                         savedAnswers["final-notes"]            = op.finalNotes;
  // B1 fields
  if ((op as any).typicalDay)                savedAnswers["typical-day"]            = (op as any).typicalDay;
  if ((op as any).structure)                 savedAnswers["structure"]              = (op as any).structure;
  if ((op as any).coveragePreferences?.length) savedAnswers["coverage-preferences"] = (op as any).coveragePreferences;
  if ((op as any).neutralVsColour)           savedAnswers["neutral-vs-colour"]      = (op as any).neutralVsColour;
  if ((op as any).colourIntensity)           savedAnswers["colour-intensity"]       = (op as any).colourIntensity;
  if ((op as any).printAppetite)             savedAnswers["print-appetite"]         = (op as any).printAppetite;
  if ((op as any).shoppingPriorities?.length) savedAnswers["shopping-priorities"]   = (op as any).shoppingPriorities;
  if ((op as any).trendAppetite)             savedAnswers["trend-appetite"]         = (op as any).trendAppetite;

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

function getSectionSummary(def: SectionDef, answers: OnboardingAnswers): ReactNode {
  if (def.placeholder) {
    return <span className="sp-detail-coming">Coming soon</span>;
  }
  for (const sf of def.subFields) {
    const v = (answers as Record<string, unknown>)[sf.draftKey];
    if (sf.kind === "text") {
      if (v && typeof v === "string" && v.trim()) return "Notes added";
    } else if (sf.kind === "single") {
      if (v && typeof v === "string" && v.trim()) return lbl(sf.questionId, v);
    } else {
      // Filter out legacy colour IDs from summary display
      const raw = (Array.isArray(v) ? v : []) as string[];
      const ids = sf.draftKey === "favorite-colors"
        ? raw.filter(id => !LEGACY_COLOUR_IDS.has(id))
        : raw;
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
  const navigate = useNavigate();

  const [mode,                 setMode]                 = useState<Mode>({ kind: "overview" });
  const [flowEdits,            setFlowEdits]            = useState<OnboardingAnswers>({});
  const [saveStatus,           setSaveStatus]           = useState<SaveStatus>("idle");
  const [awaitingRevalidation, setAwaitingRevalidation] = useState(false);
  const [pendingNext,          setPendingNext]          = useState<PendingNext>(null);
  const lastIntentRef = useRef<PendingNext>(null);

  // Missing sections excludes "sizes" (always placeholder) and "notes" (optional)
  // Notes is handled separately — it appears in the Continue queue if missing
  const missingSections = useMemo(() =>
    ALL_SECTIONS.filter(s => {
      if (s.placeholder) return false; // sizes never triggers as "missing"
      const primary = s.subFields[0];
      if (!primary) return false;
      const v = (savedAnswers as Record<string, unknown>)[primary.draftKey];
      if (primary.kind === "text" || primary.kind === "single") {
        return !v || (typeof v === "string" && !v.trim());
      }
      // array / color: also strip legacy IDs for the favourite-colors check
      const raw = (Array.isArray(v) ? v : []) as string[];
      const effective = primary.draftKey === "favorite-colors"
        ? raw.filter(id => !LEGACY_COLOUR_IDS.has(id))
        : raw;
      return effective.length === 0;
    }),
    [savedAnswers],
  );

  const isComplete = missingSections.length === 0;

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const state = e.state as { passport?: string } | null;
      if (!state?.passport) setMode({ kind: "overview" });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []); // eslint-disable-line

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
    const def = getSectionDef(sectionId);
    const edits: OnboardingAnswers = {};
    for (const { draftKey, kind } of def.subFields) {
      const v = (savedAnswers as Record<string, unknown>)[draftKey];
      if (kind === "text" || kind === "single") {
        (edits as Record<string, unknown>)[draftKey] = typeof v === "string" ? v : "";
      } else {
        // Strip legacy colour IDs from the initial draft so they're invisible in the UI
        const arr = (Array.isArray(v) ? [...v] : []) as string[];
        (edits as Record<string, unknown>)[draftKey] =
          draftKey === "favorite-colors" ? arr.filter(id => !LEGACY_COLOUR_IDS.has(id)) : arr;
      }
    }
    setFlowEdits(edits);
  }

  function startContinue() {
    if (!missingSections.length) return;
    window.history.pushState({ passport: "flow" }, "");
    initEdits(missingSections[0].id);
    setMode({ kind: "flow", queue: missingSections.map(s => s.id), index: 0 });
  }

  function startUpdate() {
    window.history.pushState({ passport: "picker" }, "");
    setMode({ kind: "picker" });
  }

  function editSection(id: SectionId) {
    initEdits(id);
    setMode({ kind: "flow", queue: [id], index: 0 });
  }

  const handleToggle = useCallback((draftKey: DraftKey, optId: string, maxSel: number, pairKey?: DraftKey) => {
    setFlowEdits(prev => {
      const current = ((prev as Record<string, unknown>)[draftKey] as string[] | undefined) ?? [];
      if (current.includes(optId)) {
        return { ...prev, [draftKey]: current.filter(id => id !== optId) };
      }
      if (current.length < maxSel) {
        const next = { ...prev, [draftKey]: [...current, optId] };
        // Mutual exclusion: remove from paired colour picker
        if (pairKey) {
          const pair = ((prev as Record<string, unknown>)[pairKey] as string[] | undefined) ?? [];
          (next as Record<string, unknown>)[pairKey] = pair.filter(id => id !== optId);
        }
        return next;
      }
      return prev;
    });
  }, []);

  const handleSingleSelect = useCallback((draftKey: DraftKey, optId: string) => {
    setFlowEdits(prev => {
      const current = (prev as Record<string, unknown>)[draftKey];
      return { ...prev, [draftKey]: current === optId ? "" : optId };
    });
  }, []);

  const handleTextChange = useCallback((draftKey: DraftKey, value: string) => {
    setFlowEdits(prev => ({ ...prev, [draftKey]: value }));
  }, []);

  async function saveSection(sectionId: SectionId, intent: PendingNext) {
    const def = getSectionDef(sectionId);

    // Placeholder sections (sizes) have no subFields — navigate without saving
    if (def.placeholder || def.subFields.length === 0) {
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

    const patch = computeSectionPatch(def, flowEdits, savedAnswers);

    if (patch === null) {
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

    lastIntentRef.current = intent;
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

  // ── Sub-field editor ────────────────────────────────────────────────────────

  function renderSubField(sf: SubField) {
    const q     = QUESTION_BY_ID[sf.questionId];
    const sel   = ((flowEdits as Record<string, unknown>)[sf.draftKey] as string[] | undefined) ?? [];
    const selStr = ((flowEdits as Record<string, unknown>)[sf.draftKey] as string | undefined) ?? "";
    const max   = MAX_SELECTIONS[sf.questionId] ?? 99;
    const atCap = sel.length >= max;

    if (sf.kind === "text") {
      const val = selStr || "";
      const maxLen = q?.maxLength ?? 500;
      return (
        <>
          <textarea
            className="sp-textarea"
            value={val}
            maxLength={maxLen}
            placeholder={q?.placeholder ?? ""}
            onChange={e => handleTextChange(sf.draftKey, e.target.value)}
          />
          <div className="sp-charcount">{val.length} / {maxLen}</div>
        </>
      );
    }

    if (sf.kind === "single") {
      return (
        <div className="sp-option-grid">
          {(q?.options ?? []).map(o => {
            const isSel = selStr === o.id;
            return (
              <button
                key={o.id}
                type="button"
                className={`sp-option${isSel ? " sp-option--active" : ""}`}
                onClick={() => handleSingleSelect(sf.draftKey, o.id)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    if (sf.kind === "color") {
      const colors = q?.colors ?? COLOUR_FAMILIES;
      return (
        <div className="sp-option-grid">
          {colors.map(c => {
            const isSel = sel.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`sp-color-option${isSel ? " sp-color-option--active" : ""}${!isSel && atCap ? " sp-color-option--disabled" : ""}`}
                onClick={() => handleToggle(sf.draftKey, c.id, max, sf.pairKey)}
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

    // array (multi-select pills)
    return (
      <div className="sp-option-grid">
        {(q?.options ?? []).map(o => {
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
      <MyNaiaLayout>
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
          <div className="sp-status-date" suppressHydrationWarning>Last updated · {formatDate(profileUpdatedAt)}</div>
        </div>

        {/* 7 named sections */}
        <div className="sp-detail-list">
          {SECTIONS.map(def => (
            <div key={def.id} className="sp-detail-row">
              <span className="sp-detail-label">{def.label}</span>
              <span className="sp-detail-value">{getSectionSummary(def, savedAnswers)}</span>
            </div>
          ))}
        </div>

        {/* Notes — outside the 7 sections */}
        <div className="sp-detail-list sp-detail-list--notes">
          <div className="sp-detail-row">
            <span className="sp-detail-label">{NOTES_SECTION.label}</span>
            <span className="sp-detail-value">{getSectionSummary(NOTES_SECTION, savedAnswers)}</span>
          </div>
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
      <MyNaiaLayout>
        <button type="button" className="sp-back" onClick={() => navigate(-1)}>
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
          {/* Notes — in picker but outside the 7-section count */}
          <button
            type="button"
            className="sp-picker-btn"
            onClick={() => editSection("notes")}
          >
            <span className="sp-picker-label">{NOTES_SECTION.label}</span>
            <span className="sp-picker-value">{getSectionSummary(NOTES_SECTION, savedAnswers)}</span>
          </button>
        </div>
      </MyNaiaLayout>
    );
  }

  // ── COMPLETION ───────────────────────────────────────────────────────────────

  if (mode.kind === "flow" && mode.done) {
    return (
      <MyNaiaLayout>
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

  const currentDef  = getSectionDef(mode.queue[mode.index]);
  const stepNum     = mode.index + 1;
  const stepTotal   = mode.queue.length;
  const isLastStep  = mode.index + 1 >= mode.queue.length;
  const currentId   = mode.queue[mode.index];

  // Check for legacy colour hints in the Colours section
  const savedFavColors = (savedAnswers["favorite-colors"] ?? []) as string[];
  const hasLegacyPrints    = currentId === "colours" && savedFavColors.includes("prints");
  const hasLegacyColorful  = currentId === "colours" && savedFavColors.includes("colorful");

  return (
    <MyNaiaLayout>
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
        {currentDef.helper && <p className="sp-flow-helper">{currentDef.helper}</p>}
      </div>

      {/* Section 5 placeholder shell */}
      {currentDef.placeholder && (
        <div className="sp-placeholder-shell">
          <p className="sp-placeholder-text">
            Your detailed fit profile — including sizing, body preferences, and fit concerns — will be
            set up in the next update. Nothing is missing from your Passport right now.
          </p>
        </div>
      )}

      {/* Legacy colour hints — read-only banners, never preselect anything */}
      {hasLegacyPrints && (
        <div className="sp-legacy-hint">
          You previously told us you like prints. Confirm your print preference below.
        </div>
      )}
      {hasLegacyColorful && (
        <div className="sp-legacy-hint">
          You previously told us you like colourful pieces. Confirm how you like to use colour below.
        </div>
      )}

      {currentDef.subFields.map(sf => {
        const capHint = (sf.kind === "array" || sf.kind === "color") && MAX_SELECTIONS[sf.questionId]
          ? (QUESTION_BY_ID[sf.questionId]?.subtitle ?? `Choose up to ${MAX_SELECTIONS[sf.questionId]}`)
          : null;
        return (
          <div key={String(sf.draftKey)}>
            {currentDef.subFields.length > 1 && (
              <div className="sp-sub-label">{sf.subLabel}</div>
            )}
            {capHint && <div className="sp-cap-hint">{capHint}</div>}
            {renderSubField(sf)}
          </div>
        );
      })}

      <div className="sp-flow-actions">
        <button
          type="button"
          className="sp-btn-outline"
          disabled={isBusy}
          onClick={() => {
            if (mode.index === 0) {
              navigate(-1);
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
              onClick={() => saveSection(currentId, lastIntentRef.current)}
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
