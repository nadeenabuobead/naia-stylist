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
  placeholder?: boolean;
  optional?:   boolean; // never "missing"; excluded from Continue Passport queue
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
    helper: "This shapes the emotional register of your Style Me recommendations.",
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
    question: "Tell nAia how you like clothing to fit, cover and emphasise your body.",
    helper: "Save your silhouette, construction and coverage preferences — including which areas you enjoy highlighting or prefer covered.",
    subFields: [
      { draftKey: "silhouette",           apiKey: "silhouette",          subLabel: "My silhouettes",                                        kind: "array",  questionId: "silhouette"           },
      { draftKey: "structure",            apiKey: "structure",           subLabel: "Construction",                                          kind: "single", questionId: "structure"            },
      { draftKey: "coverage-preferences", apiKey: "coveragePreferences", subLabel: "Garment coverage preferences",                          kind: "array",  questionId: "coverage-preferences" },
      { draftKey: "body-focus-areas"   as DraftKey, apiKey: "bodyFocusAreas",   subLabel: "Areas you enjoy highlighting",                   kind: "array"  as FieldKind, questionId: "body-focus-areas"    },
      { draftKey: "body-avoid-areas"   as DraftKey, apiKey: "bodyAvoidAreas",   subLabel: "Areas you prefer more coverage or less emphasis", kind: "array"  as FieldKind, questionId: "body-avoid-areas"   },
      { draftKey: "preferred-coverage" as DraftKey, apiKey: "preferredCoverage",subLabel: "Overall coverage preference",                    kind: "single" as FieldKind, questionId: "preferred-coverage"  },
    ],
  },
  {
    id: "sizes",
    label: "Your Sizes & Fit",
    question: "Tell nAia about your sizes, measurements and fit details.",
    helper: "All fields in this section are optional. Update any time.",
    subFields: [
      // V2-D sizes
      { draftKey: "sizing-system"      as DraftKey, apiKey: "sizingSystem",     subLabel: "Which clothing sizing system do you use?",                          kind: "single" as FieldKind, questionId: "sizing-system"       },
      { draftKey: "top-size"           as DraftKey, apiKey: "topSize",          subLabel: "Top size",                                                            kind: "text"   as FieldKind, questionId: "top-size"           },
      { draftKey: "bottom-size"        as DraftKey, apiKey: "bottomSize",       subLabel: "Bottom size",                                                         kind: "text"   as FieldKind, questionId: "bottom-size"        },
      { draftKey: "dress-size"         as DraftKey, apiKey: "dressSize",        subLabel: "Dress size",                                                          kind: "text"   as FieldKind, questionId: "dress-size"         },
      { draftKey: "shoe-sizing-system" as DraftKey, apiKey: "shoeSizingSystem", subLabel: "Which shoe sizing system do you use?",                                kind: "single" as FieldKind, questionId: "shoe-sizing-system"  },
      { draftKey: "shoe-size"          as DraftKey, apiKey: "shoeSize",         subLabel: "Shoe size",                                                           kind: "text"   as FieldKind, questionId: "shoe-size"          },
      // V2-D measurements
      { draftKey: "height"             as DraftKey, apiKey: "height",           subLabel: "Your height",                                                         kind: "text"   as FieldKind, questionId: "height"             },
      { draftKey: "measurement-unit"   as DraftKey, apiKey: "measurementUnit",  subLabel: "Measurements in",                                                     kind: "single" as FieldKind, questionId: "measurement-unit"    },
      { draftKey: "bust-measurement"   as DraftKey, apiKey: "bustMeasurement",  subLabel: "Bust",                                                                kind: "text"   as FieldKind, questionId: "bust-measurement"   },
      { draftKey: "waist-measurement"  as DraftKey, apiKey: "waistMeasurement", subLabel: "Natural waist",                                                       kind: "text"   as FieldKind, questionId: "waist-measurement"  },
      { draftKey: "hip-measurement"    as DraftKey, apiKey: "hipMeasurement",   subLabel: "Hips (widest point)",                                                 kind: "text"   as FieldKind, questionId: "hip-measurement"    },
      // V2-D proportions & fit
      { draftKey: "body-shape"         as DraftKey, apiKey: "bodyShape",        subLabel: "How would you describe your proportions?",                            kind: "single" as FieldKind, questionId: "body-shape"          },
      { draftKey: "fit-concerns"       as DraftKey, apiKey: "fitConcerns",      subLabel: "Are there any fit considerations nAia should know about?",            kind: "array"  as FieldKind, questionId: "fit-concerns"        },
    ],
    optional: true,
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

// V2-C: body-area picker options
const FOCUS_OPTIONS = [
  { id: "waist",         label: "Waist"           },
  { id: "arms-shoulders", label: "Arms & shoulders" },
  { id: "legs",          label: "Legs"             },
  { id: "neckline",      label: "Neckline"         },
  { id: "back",          label: "Back"             },
  { id: "bust",          label: "Bust"             },
  { id: "hips-curves",   label: "Hips & curves"   },
];
const AVOID_OPTIONS = [
  { id: "upper-arms",  label: "Upper arms"   },
  { id: "midriff",     label: "Midriff"      },
  { id: "bust",        label: "Bust"         },
  { id: "hips-thighs", label: "Hips & thighs" },
  { id: "back",        label: "Back"         },
  { id: "legs",        label: "Legs"         },
  { id: "waist",       label: "Waist"        },
  { id: "neckline",    label: "Neckline"     },
];
// Selecting a focus area removes its paired avoid item (and vice versa)
const FOCUS_TO_AVOID: Record<string, string> = {
  "waist": "waist", "arms-shoulders": "upper-arms", "legs": "legs",
  "neckline": "neckline", "back": "back", "bust": "bust", "hips-curves": "hips-thighs",
};
const AVOID_TO_FOCUS: Record<string, string> = {
  "waist": "waist", "legs": "legs", "neckline": "neckline", "back": "back",
  "bust": "bust", "upper-arms": "arms-shoulders", "hips-thighs": "hips-curves",
};
const FOCUS_LABELS: Record<string, string> = Object.fromEntries(FOCUS_OPTIONS.map(o => [o.id, o.label]));
const AVOID_LABELS: Record<string, string> = Object.fromEntries(AVOID_OPTIONS.map(o => [o.id, o.label]));

// V2-D: sizing, body shape, fit options
const SIZING_SYSTEM_OPTIONS = [
  { id: "uk",            label: "UK"            },
  { id: "us",            label: "US"            },
  { id: "eu",            label: "EU"            },
  { id: "international", label: "International" },
  { id: "other",         label: "Other"         },
];
const SIZING_SYSTEM_LABELS: Record<string, string> = Object.fromEntries(SIZING_SYSTEM_OPTIONS.map(o => [o.id, o.label]));

// V2-F: shoe sizing system — no International option
const SHOE_SIZING_SYSTEM_OPTIONS = [
  { id: "uk",    label: "UK"    },
  { id: "us",    label: "US"    },
  { id: "eu",    label: "EU"    },
  { id: "other", label: "Other" },
];
const SHOE_SIZING_SYSTEM_LABELS: Record<string, string> = Object.fromEntries(SHOE_SIZING_SYSTEM_OPTIONS.map(o => [o.id, o.label]));

const CLOTHING_SIZES: Record<string, string[]> = {
  uk:            ["4","6","8","10","12","14","16","18","20","22","24"],
  us:            ["0","2","4","6","8","10","12","14","16","18"],
  eu:            ["32","34","36","38","40","42","44","46","48","50"],
  international: ["XS","S","M","L","XL","XXL","XXXL"],
};
const SHOE_SIZES: Record<string, string[]> = {
  uk: ["2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5"],
  us: ["4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5"],
  eu: ["34","35","36","37","38","39","40","41","42","43","44"],
};

const BODY_SHAPE_OPTIONS = [
  { id: "hourglass",         label: "Hourglass"          },
  { id: "pear",              label: "Pear"               },
  { id: "apple",             label: "Apple"              },
  { id: "rectangle",         label: "Rectangle"          },
  { id: "inverted-triangle", label: "Inverted triangle"  },
  { id: "not-sure",          label: "Not sure"           },
  { id: "prefer-not-to-say", label: "Prefer not to say" },
];

const FIT_CONCERN_OPTIONS = [
  { id: "petite",           label: "Petite proportions"                    },
  { id: "tall",             label: "Tall proportions"                      },
  { id: "short-torso",      label: "Short torso"                           },
  { id: "long-torso",       label: "Long torso"                            },
  { id: "broad-shoulders",  label: "Broad or rounded shoulders"            },
  { id: "narrow-shoulders", label: "Narrow shoulders"                      },
  { id: "fuller-bust",      label: "Fuller bust"                           },
  { id: "narrow-hips",      label: "Narrow hips relative to waist"         },
  { id: "arm-fit",          label: "Fitted sleeves and arm openings"       },
  { id: "thigh-fit",        label: "Narrower trouser legs around the thighs" },
];

const PREFERRED_COVERAGE_OPTIONS = [
  { id: "mostly-covered", label: "Mostly covered"                                    },
  { id: "balanced",       label: "A balance"                                         },
  { id: "varies",         label: "It varies by outfit and occasion"                  },
  { id: "more-open",      label: "Comfortable showing more skin when appropriate"    },
];

// Register body-area questions in lookup tables (after all *_OPTIONS consts are defined)
QUESTION_BY_ID["body-focus-areas"]   = { id: "body-focus-areas",   type: "multi",  title: "Which areas do you enjoy highlighting?",                             subtitle: "Optional. Choose up to 5.", maxSelections: 5, options: FOCUS_OPTIONS             };
QUESTION_BY_ID["body-avoid-areas"]   = { id: "body-avoid-areas",   type: "multi",  title: "Where do you usually prefer more coverage or less emphasis?",        subtitle: "Optional. Choose up to 5.", maxSelections: 5, options: AVOID_OPTIONS            };
QUESTION_BY_ID["preferred-coverage"] = { id: "preferred-coverage", type: "single", title: "How much coverage do you generally prefer?",                                                                             options: PREFERRED_COVERAGE_OPTIONS };
MAX_SELECTIONS["body-focus-areas"]   = 5;
MAX_SELECTIONS["body-avoid-areas"]   = 5;
OPTION_LABELS["body-focus-areas"]    = FOCUS_LABELS;
OPTION_LABELS["body-avoid-areas"]    = AVOID_LABELS;
OPTION_LABELS["preferred-coverage"]  = Object.fromEntries(PREFERRED_COVERAGE_OPTIONS.map(o => [o.id, o.label]));

const BODY_SHAPE_LABELS: Record<string, string> = Object.fromEntries(BODY_SHAPE_OPTIONS.map(o => [o.id, o.label]));
const FIT_CONCERN_LABELS: Record<string, string> = Object.fromEntries(FIT_CONCERN_OPTIONS.map(o => [o.id, o.label]));

// Short display labels for the overview (form subLabels are question-phrased)
const OVERVIEW_FIELD_LABELS: Record<string, string> = {
  "sizing-system":      "Clothing sizing system",
  "shoe-sizing-system": "Shoe sizing system",
  "height":             "Height",
  "measurement-unit":   "Measurement unit",
  "bust-measurement":   "Bust",
  "waist-measurement":  "Waist",
  "hip-measurement":    "Hips",
  "body-shape":         "Proportions",
  "fit-concerns":       "Fit considerations",
  "typical-day":        "A typical week",
  "body-focus-areas":   "Areas I enjoy highlighting",
  "body-avoid-areas":   "Areas I prefer with more coverage",
  "preferred-coverage": "Coverage preference",
};

function parseHeightForDisplay(height: string | undefined, unit: "cm" | "ft-in"): { cm?: string; ft?: string; in?: string } {
  if (!height || height.trim() === "") return {};
  if (unit === "cm") {
    const m = height.match(/^(\d+)cm$/);
    return m ? { cm: m[1] } : {};
  }
  const m = height.match(/^(\d+)ft (\d+)in$/);
  return m ? { ft: m[1], in: m[2] } : {};
}

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
  if (op.lifestyle.length)                   savedAnswers["lifestyle"]              = op.lifestyle;
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
  // V2-C
  if ((op as any).bodyFocusAreas?.length)    savedAnswers["body-focus-areas"]       = (op as any).bodyFocusAreas;
  if ((op as any).bodyAvoidAreas?.length)    savedAnswers["body-avoid-areas"]       = (op as any).bodyAvoidAreas;
  // V2-D sizes
  if ((op as any).sizingSystem)              savedAnswers["sizing-system"]          = (op as any).sizingSystem;
  if ((op as any).topSize)                   savedAnswers["top-size"]               = (op as any).topSize;
  if ((op as any).bottomSize)                savedAnswers["bottom-size"]            = (op as any).bottomSize;
  if ((op as any).dressSize)                 savedAnswers["dress-size"]             = (op as any).dressSize;
  if ((op as any).shoeSizingSystem)          savedAnswers["shoe-sizing-system"]     = (op as any).shoeSizingSystem;
  if ((op as any).shoeSize)                  savedAnswers["shoe-size"]              = (op as any).shoeSize;
  // V2-D measurements
  if ((op as any).height)                    savedAnswers["height"]                 = (op as any).height;
  if ((op as any).measurementUnit)           savedAnswers["measurement-unit"]       = (op as any).measurementUnit;
  if ((op as any).bustMeasurement)           savedAnswers["bust-measurement"]       = (op as any).bustMeasurement;
  if ((op as any).waistMeasurement)          savedAnswers["waist-measurement"]      = (op as any).waistMeasurement;
  if ((op as any).hipMeasurement)            savedAnswers["hip-measurement"]        = (op as any).hipMeasurement;
  // V2-D proportions & fit
  if ((op as any).bodyShape)                 savedAnswers["body-shape"]             = (op as any).bodyShape;
  if ((op as any).fitConcerns?.length)       savedAnswers["fit-concerns"]           = (op as any).fitConcerns;
  if ((op as any).preferredCoverage)         savedAnswers["preferred-coverage"]     = (op as any).preferredCoverage;

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
  const areaLine = (ids: string[], labels: Record<string, string>, prefix: string): string => {
    const humanLabels = ids.map(id => labels[id] ?? id.replace(/-/g, " "));
    const shown = humanLabels.slice(0, 2);
    const rest  = humanLabels.length - 2;
    return `${prefix}: ${shown.join(", ")}${rest > 0 ? ` +${rest} more` : ""}`;
  };

  // Section 4 — fit/coverage/highlight preferences
  if (def.id === "fit") {
    const a = answers as Record<string, unknown>;
    const silhouette = (a["silhouette"]         as string[] | undefined) ?? [];
    const structure  =  a["structure"]           as string | undefined;
    const focus      = (a["body-focus-areas"]    as string[] | undefined) ?? [];
    const avoid      = (a["body-avoid-areas"]    as string[] | undefined) ?? [];

    const isEmpty = silhouette.length === 0 && !structure && focus.length === 0 && avoid.length === 0;
    if (isEmpty) return <span className="sp-detail-missing">Not yet completed</span>;

    const parts: string[] = [];
    const fitParts: string[] = [];
    if (structure)           fitParts.push(lbl("structure", structure));
    if (silhouette.length > 0) fitParts.push(silhouette.slice(0, 2).map(id => lbl("silhouette", id)).join(", ") + (silhouette.length > 2 ? "…" : ""));
    if (fitParts.length > 0) parts.push(fitParts.join(" · "));
    if (focus.length > 0)    parts.push(areaLine(focus, FOCUS_LABELS, "Highlights"));
    if (avoid.length > 0)    parts.push(areaLine(avoid, AVOID_LABELS, "Coverage"));

    return <>{parts[0]}{parts.slice(1).map((p, i) => <span key={i}><br />{p}</span>)}</>;
  }

  // Section 5 — sizing (clothing + shoes independent)
  if (def.id === "sizes") {
    const a = answers as Record<string, unknown>;
    const sysId      = a["sizing-system"]      as string | undefined;
    const topSz      = a["top-size"]           as string | undefined;
    const bottomSz   = a["bottom-size"]        as string | undefined;
    const dressSz    = a["dress-size"]         as string | undefined;
    const shoeSysId  = a["shoe-sizing-system"] as string | undefined;
    const shoeSz     = a["shoe-size"]          as string | undefined;

    const isEmpty = !sysId && !topSz && !bottomSz && !dressSz && !shoeSysId && !shoeSz;
    if (isEmpty) return <span className="sp-detail-missing">Not yet completed</span>;

    const clothingParts: string[] = [];
    if (sysId)                           clothingParts.push(SIZING_SYSTEM_LABELS[sysId] ?? sysId.toUpperCase());
    if (topSz)                           clothingParts.push(`Top ${topSz}`);
    if (bottomSz && bottomSz !== topSz)  clothingParts.push(`Bottom ${bottomSz}`);
    if (dressSz)                         clothingParts.push(`Dress ${dressSz}`);

    const shoeParts: string[] = [];
    if (shoeSysId && shoeSz) shoeParts.push(`Shoes ${SHOE_SIZING_SYSTEM_LABELS[shoeSysId] ?? shoeSysId.toUpperCase()} ${shoeSz}`);
    else if (shoeSz)         shoeParts.push(`Shoes ${shoeSz}`);

    const allParts = [...clothingParts, ...shoeParts];
    if (allParts.length === 0) return <span className="sp-detail-missing">Not yet completed</span>;
    return <>{allParts.join(" · ")}</>;
  }
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

function getSectionDetail(def: SectionDef, answers: OnboardingAnswers): ReactNode {
  if (def.placeholder) return null;

  const a = answers as Record<string, unknown>;
  const mUnit = (a["measurement-unit"] as string | undefined) ?? null;
  const MEASUREMENT_KEYS = new Set<string>(["bust-measurement", "waist-measurement", "hip-measurement"]);

  if (def.id === "notes") {
    const text = a["final-notes"];
    if (!text || typeof text !== "string" || !text.trim()) return null;
    return <p className="sp-ov-notes-body">{text.trim()}</p>;
  }

  const fields: { key: string; label: string; value: string }[] = [];

  for (const sf of def.subFields) {
    const dKey = sf.draftKey as string;
    const v = a[dKey];
    const displayLabel: string = OVERVIEW_FIELD_LABELS[dKey] || sf.subLabel;

    if (sf.kind === "text") {
      if (!v || typeof v !== "string" || !v.trim()) continue;
      let text = v.trim();
      if (MEASUREMENT_KEYS.has(dKey) && mUnit) text += ` ${mUnit}`;
      fields.push({ key: dKey, label: displayLabel, value: text });

    } else if (sf.kind === "single") {
      if (!v || typeof v !== "string" || !v.trim()) continue;
      const raw = v.trim();
      let human: string;
      if (dKey === "sizing-system")       human = SIZING_SYSTEM_LABELS[raw] ?? raw;
      else if (dKey === "shoe-sizing-system") human = SHOE_SIZING_SYSTEM_LABELS[raw] ?? raw;
      else if (dKey === "body-shape")     human = BODY_SHAPE_LABELS[raw] ?? raw;
      else if (dKey === "measurement-unit") human = raw === "cm" ? "Centimetres" : raw === "in" ? "Inches" : raw;
      else human = lbl(sf.questionId, raw);
      fields.push({ key: dKey, label: displayLabel, value: human });

    } else {
      const raw = (Array.isArray(v) ? v : []) as string[];
      const ids = dKey === "favorite-colors"
        ? raw.filter(id => !LEGACY_COLOUR_IDS.has(id))
        : raw;
      if (ids.length === 0) continue;
      let labelled: string[];
      if (dKey === "body-focus-areas")       labelled = ids.map(id => FOCUS_LABELS[id] ?? id);
      else if (dKey === "body-avoid-areas")  labelled = ids.map(id => AVOID_LABELS[id] ?? id);
      else if (dKey === "fit-concerns")      labelled = ids.map(id => FIT_CONCERN_LABELS[id] ?? id);
      else labelled = ids.map(id => lbl(sf.questionId, id));
      fields.push({ key: dKey, label: displayLabel, value: labelled.join(" · ") });
    }
  }

  if (fields.length === 0) return null;

  return (
    <>
      {fields.map(({ key, label, value }) => (
        <div key={key} className="sp-ov-field">
          <span className="sp-ov-field-label">{label}</span>
          <span className="sp-ov-field-value">{value}</span>
        </div>
      ))}
    </>
  );
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
  const [sizeEditedField,       setSizeEditedField]       = useState<"bodyFocusAreas" | "bodyAvoidAreas" | null>(null);
  const [pendingSizingSystem,   setPendingSizingSystem]   = useState<string | null>(null);
  const [sizeSystemConfirmed,   setSizeSystemConfirmed]   = useState(false);
  const [pendingShoeSizingSystem, setPendingShoeSizingSystem] = useState<string | null>(null);
  const [shoeSystemConfirmed,   setShoeSystemConfirmed]   = useState(false);
  const [heightDisplayUnit,     setHeightDisplayUnit]     = useState<"cm" | "ft-in">("cm");
  const lastIntentRef = useRef<PendingNext>(null);

  // Missing sections excludes "sizes" (always placeholder) and "notes" (optional)
  // Notes is handled separately — it appears in the Continue queue if missing
  const missingSections = useMemo(() =>
    ALL_SECTIONS.filter(s => {
      if (s.placeholder || s.optional) return false; // optional sections never trigger as "missing"
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
    if (sectionId === "fit") {
      setSizeEditedField(null);
    }
    if (sectionId === "sizes") {
      setPendingSizingSystem(null);
      setSizeSystemConfirmed(false);
      setPendingShoeSizingSystem(null);
      setShoeSystemConfirmed(false);
      const savedH = (savedAnswers as Record<string, unknown>)["height"] as string | undefined;
      setHeightDisplayUnit(savedH?.includes("ft") ? "ft-in" : "cm");
    }
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

  const handleBodyAreaToggle = useCallback((
    draftKey: "body-focus-areas" | "body-avoid-areas",
    apiKey: "bodyFocusAreas" | "bodyAvoidAreas",
    optId: string,
  ) => {
    setFlowEdits(prev => {
      const p = prev as Record<string, unknown>;
      const current = (p[draftKey] as string[] | undefined) ?? [];
      if (current.includes(optId)) {
        return { ...p, [draftKey]: current.filter(id => id !== optId) } as OnboardingAnswers;
      }
      if (current.length >= 5) return prev;
      const next: Record<string, unknown> = { ...p, [draftKey]: [...current, optId] };
      const pairKey = draftKey === "body-focus-areas" ? "body-avoid-areas" : "body-focus-areas";
      const overlapMap = draftKey === "body-focus-areas" ? FOCUS_TO_AVOID : AVOID_TO_FOCUS;
      const mappedId = overlapMap[optId];
      if (mappedId) {
        const prevPair = (p[pairKey] as string[] | undefined) ?? [];
        next[pairKey] = prevPair.filter(id => id !== mappedId);
      }
      return next as OnboardingAnswers;
    });
    setSizeEditedField(apiKey);
  }, []);

  const handleSizingSystemChange = useCallback((newSystem: string) => {
    const currentSystem = (flowEdits as Record<string, unknown>)["sizing-system"] as string | undefined;
    // Deselect if same system clicked again — reset clothing sizes only
    if (currentSystem === newSystem) {
      setFlowEdits(prev => ({
        ...(prev as Record<string, unknown>),
        "sizing-system": "", "top-size": "", "bottom-size": "", "dress-size": "",
      } as OnboardingAnswers));
      return;
    }
    // Check clothing sizes only — shoe size is independent
    const hasSavedClothingSizes = !!(
      (savedAnswers as Record<string, unknown>)["top-size"] ||
      (savedAnswers as Record<string, unknown>)["bottom-size"] ||
      (savedAnswers as Record<string, unknown>)["dress-size"]
    );
    if (hasSavedClothingSizes) {
      setPendingSizingSystem(newSystem);
      return;
    }
    setFlowEdits(prev => ({
      ...(prev as Record<string, unknown>),
      "sizing-system": newSystem, "top-size": "", "bottom-size": "", "dress-size": "",
    } as OnboardingAnswers));
  }, [savedAnswers, flowEdits]);

  const confirmSizingSystemChange = useCallback(() => {
    if (!pendingSizingSystem) return;
    const sys = pendingSizingSystem;
    setPendingSizingSystem(null);
    setSizeSystemConfirmed(true);
    // Clear clothing sizes only — preserve shoe-sizing-system and shoe-size
    setFlowEdits(prev => ({
      ...(prev as Record<string, unknown>),
      "sizing-system": sys, "top-size": "", "bottom-size": "", "dress-size": "",
    } as OnboardingAnswers));
  }, [pendingSizingSystem]);

  const cancelSizingSystemChange = useCallback(() => { setPendingSizingSystem(null); }, []);

  // V2-F: shoe sizing system handlers (independent from clothing system)
  const handleShoeSizingSystemChange = useCallback((newSys: string) => {
    const currentSys = (flowEdits as Record<string, unknown>)["shoe-sizing-system"] as string | undefined;
    // Deselect if same system clicked again
    if (currentSys === newSys) {
      setFlowEdits(prev => ({
        ...(prev as Record<string, unknown>),
        "shoe-sizing-system": "", "shoe-size": "",
      } as OnboardingAnswers));
      return;
    }
    const hasSavedShoeSize = !!(savedAnswers as Record<string, unknown>)["shoe-size"];
    if (hasSavedShoeSize) {
      setPendingShoeSizingSystem(newSys);
      return;
    }
    setFlowEdits(prev => ({
      ...(prev as Record<string, unknown>),
      "shoe-sizing-system": newSys, "shoe-size": "",
    } as OnboardingAnswers));
  }, [savedAnswers, flowEdits]);

  const confirmShoeSizingSystemChange = useCallback(() => {
    if (!pendingShoeSizingSystem) return;
    const sys = pendingShoeSizingSystem;
    setPendingShoeSizingSystem(null);
    setShoeSystemConfirmed(true);
    setFlowEdits(prev => ({
      ...(prev as Record<string, unknown>),
      "shoe-sizing-system": sys, "shoe-size": "",
    } as OnboardingAnswers));
  }, [pendingShoeSizingSystem]);

  const cancelShoeSizingSystemChange = useCallback(() => { setPendingShoeSizingSystem(null); }, []);

  const handleHeightUnitSwitch = useCallback((unit: "cm" | "ft-in") => {
    if (unit === heightDisplayUnit) return;
    setHeightDisplayUnit(unit);
    setFlowEdits(prev => ({ ...(prev as Record<string, unknown>), "height": "" } as OnboardingAnswers));
  }, [heightDisplayUnit]);

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

    if (def.subFields.length === 0) {
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
      const requestBody: Record<string, unknown> = { ...patch, baseProfileUpdatedAt: profileUpdatedAt };
      if (sectionId === "fit") {
        requestBody.editedField = sizeEditedField ?? "bodyFocusAreas";
      }
      if (sectionId === "sizes") {
        if (sizeSystemConfirmed) requestBody.confirmSizeSystemChange = true;
        if (shoeSystemConfirmed) requestBody.confirmShoeSystemChange = true;
      }
      const res = await fetch("/api/save-style-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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

    // array (multi-select pills) — body area keys use mutual-exclusion handler
    return (
      <div className="sp-option-grid">
        {(q?.options ?? []).map(o => {
          const isSel = sel.includes(o.id);
          const handleClick =
            sf.draftKey === "body-focus-areas" ? () => handleBodyAreaToggle("body-focus-areas", "bodyFocusAreas", o.id) :
            sf.draftKey === "body-avoid-areas" ? () => handleBodyAreaToggle("body-avoid-areas", "bodyAvoidAreas", o.id) :
            () => handleToggle(sf.draftKey, o.id, max);
          return (
            <button
              key={o.id}
              type="button"
              className={`sp-option${isSel ? " sp-option--active" : ""}${!isSel && atCap ? " sp-option--disabled" : ""}`}
              onClick={handleClick}
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
            Your Style Passport keeps the preferences that shape your nAia experience in one
            place. Update it whenever your style, life or priorities evolve.
          </p>
        </div>

        <div className="sp-status-block">
          <div className="sp-status-label">Status</div>
          <p className="sp-status-text">
            {isComplete ? "Your Style Passport is up to date." : "A few details are still missing."}
          </p>
          <div className="sp-status-date" suppressHydrationWarning>Last updated · {formatDate(profileUpdatedAt)}</div>
        </div>

        {/* Full detail — all 7 sections + Notes */}
        <div className="sp-ov-sections">
          {SECTIONS.map(def => (
            <div key={def.id} className="sp-ov-section">
              <div className="sp-ov-section-header">{def.label}</div>
              {getSectionDetail(def, savedAnswers)}
            </div>
          ))}
          <div className="sp-ov-section sp-ov-section--notes">
            <div className="sp-ov-section-header">{NOTES_SECTION.label}</div>
            {getSectionDetail(NOTES_SECTION, savedAnswers)}
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

      {/* Section 5 — V2-D full sizes & fit (4 sub-groups) */}
      {currentId === "sizes" && (() => {
        const fe = flowEdits as Record<string, unknown>;
        const curSys   = (fe["sizing-system"]     as string | undefined) || null;
        const measUnit = (fe["measurement-unit"]  as string | undefined) || null;
        const fitConSel = (fe["fit-concerns"]     as string[] | undefined) ?? [];
        const heightStr = (fe["height"]           as string | undefined) ?? "";
        const parsedH  = parseHeightForDisplay(heightStr, heightDisplayUnit);
        const curShoeSys    = (fe["shoe-sizing-system"] as string | undefined) || null;
        const clothingSizes = curSys && curSys !== "other" ? CLOTHING_SIZES[curSys] : null;
        const shoeSizes     = curShoeSys && curShoeSys !== "other" ? SHOE_SIZES[curShoeSys] : null;

        return (
          <>
            {/* Confirmation dialog — clothing system change */}
            {pendingSizingSystem && (
              <div className="sp-confirm-overlay">
                <div className="sp-confirm-box">
                  <p>
                    Switching to <strong>{SIZING_SYSTEM_LABELS[pendingSizingSystem] ?? pendingSizingSystem}</strong> will
                    clear your saved clothing sizes. This cannot be undone.
                  </p>
                  <div className="sp-confirm-actions">
                    <button type="button" className="sp-btn-outline" onClick={cancelSizingSystemChange}>Cancel</button>
                    <button type="button" className="sp-btn-primary" onClick={confirmSizingSystemChange}>Confirm</button>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmation dialog — shoe system change */}
            {pendingShoeSizingSystem && (
              <div className="sp-confirm-overlay">
                <div className="sp-confirm-box">
                  <p>
                    Switching to <strong>{SHOE_SIZING_SYSTEM_LABELS[pendingShoeSizingSystem] ?? pendingShoeSizingSystem}</strong> shoe sizing will
                    clear your saved shoe size. This cannot be undone.
                  </p>
                  <div className="sp-confirm-actions">
                    <button type="button" className="sp-btn-outline" onClick={cancelShoeSizingSystemChange}>Cancel</button>
                    <button type="button" className="sp-btn-primary" onClick={confirmShoeSizingSystemChange}>Confirm</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Group 1: Clothing sizes ───────────────────────────── */}
            <div className="sp-section-group">
              <div className="sp-section-group-title">Your sizes</div>

              <div className="sp-sub-label">Which clothing sizing system do you use?</div>
              <div className="sp-cap-hint">Optional.</div>
              <div className="sp-option-grid">
                {SIZING_SYSTEM_OPTIONS.map(o => {
                  const isSel = curSys === o.id;
                  return (
                    <button key={o.id} type="button"
                      className={`sp-option${isSel ? " sp-option--active" : ""}`}
                      onClick={() => handleSizingSystemChange(o.id)}>
                      {o.label}
                    </button>
                  );
                })}
              </div>

              {curSys ? (
                <>
                  {(["top-size", "bottom-size", "dress-size"] as const).map(key => {
                    const lbl2 = key === "top-size" ? "Top size" : key === "bottom-size" ? "Bottom size" : "Dress size";
                    const val  = (fe[key] as string | undefined) ?? "";
                    return (
                      <div key={key} className="sp-field-row" style={{ marginTop: "20px" }}>
                        <div className="sp-sub-label">{lbl2}</div>
                        {clothingSizes ? (
                          <select className="sp-size-select" value={val}
                            onChange={e => setFlowEdits(prev => ({ ...(prev as Record<string,unknown>), [key]: e.target.value } as OnboardingAnswers))}>
                            <option value="">— Select —</option>
                            {clothingSizes.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <input className="sp-text-input" type="text" placeholder="e.g. 10" value={val}
                            onChange={e => handleTextChange(key as DraftKey, e.target.value)} />
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <p className="sp-cap-hint" style={{ marginTop: "16px" }}>
                  Select a clothing sizing system above to see size options.
                </p>
              )}

              {/* ── Shoe sizing (independent) ───────────────────────── */}
              <div style={{ marginTop: "28px" }}>
                <div className="sp-sub-label">Which shoe sizing system do you use?</div>
                <div className="sp-cap-hint">Optional.</div>
                <div className="sp-option-grid">
                  {SHOE_SIZING_SYSTEM_OPTIONS.map(o => {
                    const isSel = curShoeSys === o.id;
                    return (
                      <button key={o.id} type="button"
                        className={`sp-option${isSel ? " sp-option--active" : ""}`}
                        onClick={() => handleShoeSizingSystemChange(o.id)}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>

                {curShoeSys ? (
                  <div className="sp-field-row" style={{ marginTop: "20px" }}>
                    <div className="sp-sub-label">Shoe size</div>
                    {shoeSizes ? (
                      <select className="sp-size-select"
                        value={(fe["shoe-size"] as string | undefined) ?? ""}
                        onChange={e => setFlowEdits(prev => ({ ...(prev as Record<string,unknown>), "shoe-size": e.target.value } as OnboardingAnswers))}>
                        <option value="">— Select —</option>
                        {shoeSizes.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input className="sp-text-input" type="text" placeholder="e.g. EU 39" value={(fe["shoe-size"] as string | undefined) ?? ""}
                        onChange={e => handleTextChange("shoe-size" as DraftKey, e.target.value)} />
                    )}
                  </div>
                ) : (
                  <p className="sp-cap-hint" style={{ marginTop: "16px" }}>
                    Select a shoe sizing system above to enter your shoe size.
                  </p>
                )}
              </div>
            </div>

            {/* ── Group 2: Your measurements ───────────────────────── */}
            <div className="sp-section-group">
              <div className="sp-section-group-title">Your measurements</div>

              <div className="sp-sub-label">Your height</div>
              <div className="sp-cap-hint">Optional.</div>
              <div className="sp-option-grid" style={{ marginBottom: "12px", gap: "6px" }}>
                {(["cm", "ft-in"] as const).map(unit => (
                  <button key={unit} type="button"
                    className={`sp-option${heightDisplayUnit === unit ? " sp-option--active" : ""}`}
                    style={{ maxWidth: "90px" }}
                    onClick={() => handleHeightUnitSwitch(unit)}>
                    {unit === "cm" ? "cm" : "ft / in"}
                  </button>
                ))}
              </div>
              {heightDisplayUnit === "cm" ? (
                <div className="sp-field-row">
                  <input className="sp-text-input" type="number" min={100} max={250} step={1}
                    placeholder="e.g. 168" value={parsedH.cm ?? ""}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, "");
                      setFlowEdits(prev => ({ ...(prev as Record<string,unknown>), "height": v ? `${v}cm` : "" } as OnboardingAnswers));
                    }} />
                  <span className="sp-field-unit">cm</span>
                </div>
              ) : (
                <div className="sp-height-ft-in">
                  <input className="sp-text-input" type="number" min={3} max={8} step={1}
                    placeholder="ft" value={parsedH.ft ?? ""}
                    onChange={e => {
                      const ft = e.target.value.replace(/\D/g, "") || "0";
                      const inVal = parsedH.in ?? "0";
                      setFlowEdits(prev => ({ ...(prev as Record<string,unknown>), "height": ft !== "0" ? `${ft}ft ${inVal}in` : "" } as OnboardingAnswers));
                    }} />
                  <span className="sp-height-unit-label">ft</span>
                  <input className="sp-text-input" type="number" min={0} max={11} step={1}
                    placeholder="in" value={parsedH.in ?? ""}
                    onChange={e => {
                      const inches = e.target.value.replace(/\D/g, "") || "0";
                      const ftVal = parsedH.ft ?? "0";
                      setFlowEdits(prev => ({ ...(prev as Record<string,unknown>), "height": ftVal !== "0" ? `${ftVal}ft ${inches}in` : "" } as OnboardingAnswers));
                    }} />
                  <span className="sp-height-unit-label">in</span>
                </div>
              )}

              <div className="sp-sub-label" style={{ marginTop: "24px" }}>Measurements in</div>
              <div className="sp-cap-hint">Optional.</div>
              <div className="sp-option-grid" style={{ marginBottom: "16px", gap: "6px" }}>
                {[{ id: "cm", label: "cm" }, { id: "in", label: "in" }].map(o => (
                  <button key={o.id} type="button"
                    className={`sp-option${measUnit === o.id ? " sp-option--active" : ""}`}
                    style={{ maxWidth: "80px" }}
                    onClick={() => handleSingleSelect("measurement-unit" as DraftKey, o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>

              {(["bust-measurement", "waist-measurement", "hip-measurement"] as const).map(key => {
                const measLabel = key === "bust-measurement" ? "Bust" : key === "waist-measurement" ? "Natural waist" : "Hips (widest point)";
                const val = (fe[key] as string | undefined) ?? "";
                return (
                  <div key={key} className="sp-field-row" style={{ marginBottom: "16px" }}>
                    <div className="sp-sub-label">{measLabel}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input className="sp-text-input" type="number" min={1} max={300} step={0.5}
                        placeholder={measUnit === "in" ? "e.g. 36" : "e.g. 92"}
                        value={val}
                        onChange={e => handleTextChange(key as DraftKey, e.target.value)} />
                      {measUnit && <span className="sp-field-unit">{measUnit}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Group 3: Your proportions & fit ──────────────────── */}
            <div className="sp-section-group">
              <div className="sp-section-group-title">Your proportions &amp; fit</div>

              <div className="sp-sub-label">How would you describe your proportions?</div>
              <div className="sp-cap-hint">Self-reported only — optional.</div>
              <div className="sp-option-grid">
                {BODY_SHAPE_OPTIONS.map(o => {
                  const isSel = (fe["body-shape"] as string | undefined) === o.id;
                  return (
                    <button key={o.id} type="button"
                      className={`sp-option${isSel ? " sp-option--active" : ""}`}
                      onClick={() => handleSingleSelect("body-shape" as DraftKey, o.id)}>
                      {o.label}
                    </button>
                  );
                })}
              </div>

              <div className="sp-sub-label" style={{ marginTop: "28px" }}>Any fit considerations nAia should know about?</div>
              <div className="sp-cap-hint">Optional — select all that apply.</div>
              <div className="sp-option-grid">
                {FIT_CONCERN_OPTIONS.map(o => {
                  const isSel = fitConSel.includes(o.id);
                  return (
                    <button key={o.id} type="button"
                      className={`sp-option${isSel ? " sp-option--active" : ""}`}
                      onClick={() => setFlowEdits(prev => {
                        const p = prev as Record<string,unknown>;
                        const cur = (p["fit-concerns"] as string[] | undefined) ?? [];
                        return { ...p, "fit-concerns": cur.includes(o.id) ? cur.filter(id => id !== o.id) : [...cur, o.id] } as OnboardingAnswers;
                      })}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

          </>
        );
      })()}

      {/* All other sections — generic sub-field renderer */}
      {currentId !== "sizes" && currentDef.subFields.map(sf => {
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
