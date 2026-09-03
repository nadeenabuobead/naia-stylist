import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { Link, useLoaderData, useRevalidator, useNavigate, redirect } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import prisma from "~/db.server";
import type { SelfieStyleSignals } from "~/lib/ai/selfie-analysis";
import { SelfieVisualAnalysis } from "~/components/selfie/SelfieVisualAnalysis";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];
import type { OnboardingAnswers, QuizQuestion } from "~/lib/onboarding/quiz-data";
import { quizQuestions, COLOUR_FAMILIES, NOTES_HELPER_TEXT } from "~/lib/onboarding/quiz-data";
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
  "fit-concerns-note": {
    id: "fit-concerns-note",
    type: "text",
    title: "Anything else about fit you'd like us to know?",
    placeholder: "e.g. I have very narrow shoulders and wide hips, or sleeves are always too short.",
    maxLength: 500,
  },
  "age-range": {
    id: "age-range",
    type: "single",
    title: "How old are you?",
    options: [
      { id: "18-24",            label: "18–24"            },
      { id: "25-34",            label: "25–34"            },
      { id: "35-44",            label: "35–44"            },
      { id: "45-54",            label: "45–54"            },
      { id: "55-64",            label: "55–64"            },
      { id: "65-plus",          label: "65+"              },
      { id: "prefer-not-to-say",label: "Prefer not to say"},
    ],
  },
  "gender": {
    id: "gender",
    type: "single",
    title: "How do you describe your gender?",
    options: [
      { id: "woman",            label: "Woman"            },
      { id: "man",              label: "Man"              },
      { id: "another-gender",   label: "Another gender"   },
      { id: "prefer-not-to-say",label: "Prefer not to say"},
    ],
  },
  "gender-self-description": {
    id: "gender-self-description",
    type: "text",
    title: "If you selected 'Another gender', you can describe your gender here (optional).",
    placeholder: "Optional — describe your gender in your own words.",
    maxLength: 200,
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
// Section definitions
// ─────────────────────────────────────────────────────────────────────────────

type SectionId =
  | "goals" | "outfit-gives" | "identity" | "direction" | "life" | "fit"
  | "fit-concerns" | "sizes" | "colours" | "wardrobe"
  | "dressing" | "notes" | "about-you";

type FieldKind = "array" | "color" | "single" | "text";
type DraftKey = keyof OnboardingAnswers;

interface SubField {
  draftKey:       DraftKey;
  apiKey:         string;
  subLabel:       string;
  kind:           FieldKind;
  questionId:     string;
  pairKey?:       DraftKey; // for mutual-exclusion between colour pickers
  hiddenForRev6?: boolean;  // hidden from editor + detail for profileVersion=6 customers
}

interface SectionDef {
  id:          SectionId;
  label:       string;
  question:    string;
  helper:      string;
  subFields:   SubField[];
  placeholder?: boolean;
  optional?:   boolean;    // never "missing"; excluded from Continue Passport queue
  rev6Hidden?:  boolean;   // hidden from picker + editor for profileVersion=6 customers
  rev6Only?:    boolean;   // only shown to profileVersion=6 customers
}

const SECTIONS: SectionDef[] = [
  // 1. CURRENT FOCUS — core, currentGoal only for Rev 6
  {
    id: "goals",
    label: "Current Focus",
    question: "What would you like nAia to help you with right now?",
    helper: "Choose up to 2. You can change this anytime.",
    optional: true,
    subFields: [
      { draftKey: "current-goal" as DraftKey, apiKey: "currentGoal", subLabel: "What I want nAia to help with", kind: "array" as FieldKind, questionId: "current-goal" },
      // Legacy: successfulOutfitGives bundled here. Rev 6: moved to outfit-gives section.
      { draftKey: "successful-outfit-gives" as DraftKey, apiKey: "successfulOutfitGives", subLabel: "What great outfits give me", kind: "array" as FieldKind, questionId: "successful-outfit-gives", hiddenForRev6: true },
    ],
  },
  // 2. WHAT MAKES AN OUTFIT WORK — Rev 6 only; successfulOutfitGives as own section
  {
    id: "outfit-gives",
    label: "What Makes an Outfit Work",
    question: "What makes an outfit feel right for you?",
    helper: "Choose up to 3.",
    optional: true,
    rev6Only: true,
    subFields: [
      { draftKey: "successful-outfit-gives" as DraftKey, apiKey: "successfulOutfitGives", subLabel: "What great outfits give me", kind: "array" as FieldKind, questionId: "successful-outfit-gives" },
    ],
  },
  // 3. STYLE — desiredImpression hidden for Rev 6 (blank editor, superseded)
  {
    id: "identity",
    label: "Style",
    question: "Which styles currently feel most like you?",
    helper: "Choose up to 2.",
    subFields: [
      { draftKey: "style-personalities" as DraftKey, apiKey: "stylePersonalities", subLabel: "My style", kind: "array" as FieldKind, questionId: "style-personalities" },
      { draftKey: "desired-impression" as DraftKey, apiKey: "desiredImpression", subLabel: "The impression I make", kind: "array" as FieldKind, questionId: "desired-impression", hiddenForRev6: true },
    ],
  },
  // 4. LIFESTYLE — typicalDay hidden for Rev 6 (no AI consumer)
  {
    id: "life",
    label: "Lifestyle",
    question: "What do you dress for most often?",
    helper: "Choose up to 3.",
    subFields: [
      { draftKey: "lifestyle" as DraftKey, apiKey: "lifestyle", subLabel: "My lifestyle", kind: "array" as FieldKind, questionId: "lifestyle" },
      { draftKey: "typical-day" as DraftKey, apiKey: "typicalDay", subLabel: "A typical week", kind: "text" as FieldKind, questionId: "typical-day", hiddenForRev6: true },
    ],
  },
  // 5. COLOUR PALETTE — advanced colour fields hidden for Rev 6 (no AI consumer)
  {
    id: "colours",
    label: "Colour Palette",
    question: "Which colours do you love wearing?",
    helper: "Choose up to 5 favourite colours.",
    subFields: [
      { draftKey: "favorite-colors" as DraftKey, apiKey: "favoriteColors", subLabel: "My colour palette", kind: "color" as FieldKind, questionId: "favorite-colors", pairKey: "avoid-colors" as DraftKey },
      { draftKey: "avoid-colors" as DraftKey, apiKey: "avoidColors", subLabel: "Colours to avoid", kind: "color" as FieldKind, questionId: "avoid-colors", pairKey: "favorite-colors" as DraftKey },
      { draftKey: "neutral-vs-colour" as DraftKey, apiKey: "neutralVsColour", subLabel: "Neutrals vs colour", kind: "single" as FieldKind, questionId: "neutral-vs-colour", hiddenForRev6: true },
      { draftKey: "colour-intensity" as DraftKey, apiKey: "colourIntensity", subLabel: "Colour intensity", kind: "single" as FieldKind, questionId: "colour-intensity", hiddenForRev6: true },
      { draftKey: "print-appetite" as DraftKey, apiKey: "printAppetite", subLabel: "Prints & patterns", kind: "single" as FieldKind, questionId: "print-appetite", hiddenForRev6: true },
    ],
  },
  // 6. SILHOUETTE — canonical Rev 6 copy
  {
    id: "fit",
    label: "Silhouette",
    question: "Which silhouettes do you usually feel best in?",
    helper: "Choose up to 3.",
    subFields: [
      { draftKey: "silhouette" as DraftKey, apiKey: "silhouette", subLabel: "My silhouettes", kind: "array" as FieldKind, questionId: "silhouette" },
    ],
  },
  // 7. FIT CONCERNS — Rev 6 only; dedicated section with canonical Rev 6 IDs
  {
    id: "fit-concerns",
    label: "Fit Concerns",
    question: "Are there any fit issues nAia should keep in mind?",
    helper: "Select any that apply.",
    optional: true,
    rev6Only: true,
    subFields: [
      { draftKey: "fit-concerns" as DraftKey, apiKey: "fitConcerns", subLabel: "Fit concerns", kind: "array" as FieldKind, questionId: "fit-concerns" },
      { draftKey: "fit-concerns-note" as DraftKey, apiKey: "fitConcernsNote", subLabel: "Additional fit notes", kind: "text" as FieldKind, questionId: "fit-concerns-note" },
    ],
  },
  // 8. DRESSING REQUIREMENTS — updated helper copy
  {
    id: "dressing",
    label: "Dressing Requirements",
    question: "Are there any dressing requirements nAia should always respect?",
    helper: "Optional. Select anything nAia should always keep in mind when styling you.",
    optional: true,
    subFields: [
      { draftKey: "dressing-preferences" as DraftKey, apiKey: "dressingPreferences", subLabel: "My dressing requirements", kind: "array" as FieldKind, questionId: "dressing-preferences" },
    ],
  },
  // 9. SIZES & MEASUREMENTS — renamed; bodyShape + old fitConcerns hidden for Rev 6
  {
    id: "sizes",
    label: "Sizes & Measurements",
    question: "Tell nAia about your sizes and measurements.",
    helper: "All fields are optional. Update any time.",
    optional: true,
    subFields: [
      { draftKey: "sizing-system" as DraftKey, apiKey: "sizingSystem", subLabel: "Which clothing sizing system do you use?", kind: "single" as FieldKind, questionId: "sizing-system" },
      { draftKey: "top-size" as DraftKey, apiKey: "topSize", subLabel: "Top size", kind: "text" as FieldKind, questionId: "top-size" },
      { draftKey: "bottom-size" as DraftKey, apiKey: "bottomSize", subLabel: "Bottom size", kind: "text" as FieldKind, questionId: "bottom-size" },
      { draftKey: "dress-size" as DraftKey, apiKey: "dressSize", subLabel: "Dress size", kind: "text" as FieldKind, questionId: "dress-size" },
      { draftKey: "shoe-sizing-system" as DraftKey, apiKey: "shoeSizingSystem", subLabel: "Which shoe sizing system do you use?", kind: "single" as FieldKind, questionId: "shoe-sizing-system" },
      { draftKey: "shoe-size" as DraftKey, apiKey: "shoeSize", subLabel: "Shoe size", kind: "text" as FieldKind, questionId: "shoe-size" },
      { draftKey: "height" as DraftKey, apiKey: "height", subLabel: "Your height", kind: "text" as FieldKind, questionId: "height" },
      { draftKey: "measurement-unit" as DraftKey, apiKey: "measurementUnit", subLabel: "Measurements in", kind: "single" as FieldKind, questionId: "measurement-unit" },
      { draftKey: "bust-measurement" as DraftKey, apiKey: "bustMeasurement", subLabel: "Bust", kind: "text" as FieldKind, questionId: "bust-measurement" },
      { draftKey: "waist-measurement" as DraftKey, apiKey: "waistMeasurement", subLabel: "Natural waist", kind: "text" as FieldKind, questionId: "waist-measurement" },
      { draftKey: "hip-measurement" as DraftKey, apiKey: "hipMeasurement", subLabel: "Hips (widest point)", kind: "text" as FieldKind, questionId: "hip-measurement" },
      // Legacy only: bodyShape + old fitConcerns hidden for Rev 6 (bespoke UI also gated)
      { draftKey: "body-shape" as DraftKey, apiKey: "bodyShape", subLabel: "How would you describe your proportions?", kind: "single" as FieldKind, questionId: "body-shape", hiddenForRev6: true },
      { draftKey: "fit-concerns" as DraftKey, apiKey: "fitConcerns", subLabel: "Fit considerations", kind: "array" as FieldKind, questionId: "fit-concerns", hiddenForRev6: true },
      { draftKey: "fit-concerns-note" as DraftKey, apiKey: "fitConcernsNote", subLabel: "Additional fit notes", kind: "text" as FieldKind, questionId: "fit-concerns-note", hiddenForRev6: true },
    ],
  },
  // ABOUT YOU — optional contextual info (not used to infer style or recommendations)
  {
    id: "about-you",
    label: "About You",
    question: "A few optional details to help nAia understand your context.",
    helper: "Optional. This information is not used to infer style or restrict recommendations.",
    optional: true,
    subFields: [
      { draftKey: "age-range" as DraftKey, apiKey: "ageRange", subLabel: "Age range", kind: "single" as FieldKind, questionId: "age-range" },
      { draftKey: "gender" as DraftKey, apiKey: "gender", subLabel: "Gender", kind: "single" as FieldKind, questionId: "gender" },
      { draftKey: "gender-self-description" as DraftKey, apiKey: "genderSelfDescription", subLabel: "Gender (in your own words)", kind: "text" as FieldKind, questionId: "gender-self-description" },
    ],
  },
  // HIDDEN FOR REV 6: Style Direction (blank editors, superseded emotional profile)
  {
    id: "direction",
    label: "Your Style Direction",
    question: "How do you want to feel in what you wear?",
    helper: "Guides the overall tone and direction of your Style Me recommendations.",
    rev6Hidden: true,
    subFields: [
      { draftKey: "desired-feelings" as DraftKey, apiKey: "desiredFeelings", subLabel: "How I want to feel", kind: "array" as FieldKind, questionId: "desired-feelings" },
      { draftKey: "becoming" as DraftKey, apiKey: "becoming", subLabel: "Who I'm becoming", kind: "array" as FieldKind, questionId: "becoming" },
    ],
  },
  // HIDDEN FOR REV 6: Wardrobe / Shopping / Trend (all blank editors)
  {
    id: "wardrobe",
    label: "Your Wardrobe, Shopping & Trend Preferences",
    question: "What does your wardrobe need most right now?",
    helper: "Knowing where you feel disconnected and what drives your purchases helps nAia focus on the right solutions.",
    rev6Hidden: true,
    subFields: [
      { draftKey: "wardrobe-disconnection" as DraftKey, apiKey: "styleStruggles", subLabel: "When I feel most disconnected", kind: "array" as FieldKind, questionId: "wardrobe-disconnection" },
      { draftKey: "style-support" as DraftKey, apiKey: "styleSupport", subLabel: "What would make getting dressed easier", kind: "array" as FieldKind, questionId: "style-support" },
      { draftKey: "shopping-priorities" as DraftKey, apiKey: "shoppingPriorities", subLabel: "Shopping priorities", kind: "array" as FieldKind, questionId: "shopping-priorities" },
      { draftKey: "trend-appetite" as DraftKey, apiKey: "trendAppetite", subLabel: "Trend appetite", kind: "single" as FieldKind, questionId: "trend-appetite" },
    ],
  },
];

// Notes to nAia — outside the 7 named sections; always optional enrichment, never blocks completion
const NOTES_SECTION: SectionDef = {
  id: "notes",
  label: "Notes to nAia",
  question: "Anything else nAia should know about your style right now?",
  helper: NOTES_HELPER_TEXT,
  optional: true,
  subFields: [
    { draftKey: "final-notes", apiKey: "finalNotes", subLabel: "Your notes to nAia", kind: "text", questionId: "final-notes" },
  ],
};

// All sections (for flow logic) — notes appended
const ALL_SECTIONS = [...SECTIONS, NOTES_SECTION];

function getSectionDef(id: SectionId): SectionDef {
  return ALL_SECTIONS.find(s => s.id === id) ?? SECTIONS[0];
}

// Returns sections visible in the picker/overview for this customer type.
function getVisibleSections(isRev6: boolean): SectionDef[] {
  return SECTIONS.filter(s => {
    if (isRev6 && s.rev6Hidden) return false;
    if (!isRev6 && s.rev6Only)  return false;
    return true;
  });
}

// Returns a def with hiddenForRev6 sub-fields filtered out for Rev 6 customers.
function getEffectiveDef(def: SectionDef, isRev6: boolean): SectionDef {
  if (!isRev6) return def;
  return { ...def, subFields: def.subFields.filter(sf => !sf.hiddenForRev6) };
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

// Rev 6 canonical option IDs for fields whose IDs changed between legacy and Rev 6.
// Used during legacy refresh prefill to preserve only currently-valid IDs.
const REV6_VALID_IDS: Partial<Record<string, Set<string>>> = (() => {
  const m: Partial<Record<string, Set<string>>> = {};
  for (const q of quizQuestions) {
    if (q.options) m[q.id] = new Set(q.options.map((o: { id: string }) => o.id));
    if (q.colors)  m[q.id] = new Set(q.colors.map((c: { id: string }) => c.id));
    if (q.secondaryQuestion?.colors) m[q.secondaryQuestion.id] = new Set(q.secondaryQuestion.colors.map((c: { id: string }) => c.id));
  }
  return m;
})();

// ── Legacy refresh flow ───────────────────────────────────────────────────────
// 7 screens shown to customers with profileVersion=null (completed before Rev 6).
// Each entry is a subset of the full SECTIONS sub-field list.
// "noAutoFill" fields are never prefilled; "rev6OnlyFill" fields keep only valid Rev 6 IDs.

type RefreshField = {
  draftKey: DraftKey;
  apiKey: string;
  subLabel: string;
  kind: FieldKind;
  questionId: string;
  noAutoFill?: true;      // never prefill (old IDs are semantically incompatible)
  rev6OnlyFill?: true;    // prefill only values that are valid current Rev 6 IDs
};

type RefreshScreen = {
  screenId: string;
  label: string;
  question: string;
  helper?: string;
  optional?: true;
  fields: RefreshField[];
};

const REFRESH_SCREENS: RefreshScreen[] = [
  {
    screenId: "r-goal",
    label: "Your Current Focus",
    question: "What would you most like nAia to help you with right now?",
    helper: "Choose up to 2. This is mutable context — update it any time.",
    fields: [
      { draftKey: "current-goal" as DraftKey, apiKey: "currentGoal", subLabel: "What I want nAia to help with", kind: "array" as FieldKind, questionId: "current-goal" },
    ],
  },
  {
    screenId: "r-identity",
    label: "Your Style Identity",
    question: "Which styles currently feel most like you?",
    helper: "Select up to 2. nAia blends these into the aesthetic of every recommendation.",
    fields: [
      { draftKey: "style-personalities" as DraftKey, apiKey: "stylePersonalities", subLabel: "My style", kind: "array" as FieldKind, questionId: "style-personalities", rev6OnlyFill: true },
    ],
  },
  {
    screenId: "r-outfit-gives",
    label: "What Great Outfits Give You",
    question: "What makes an outfit feel right for you?",
    helper: "Choose up to 3.",
    fields: [
      { draftKey: "successful-outfit-gives" as DraftKey, apiKey: "successfulOutfitGives", subLabel: "What great outfits give me", kind: "array" as FieldKind, questionId: "successful-outfit-gives" },
    ],
  },
  {
    screenId: "r-lifestyle",
    label: "Your Life & Dress Codes",
    question: "What do you dress for most often?",
    fields: [
      { draftKey: "lifestyle" as DraftKey, apiKey: "lifestyle", subLabel: "My lifestyle", kind: "array" as FieldKind, questionId: "lifestyle", rev6OnlyFill: true },
    ],
  },
  {
    screenId: "r-silhouette",
    label: "Your Fit & Silhouette",
    question: "What silhouettes feel most like you?",
    helper: "Pick up to 3.",
    fields: [
      { draftKey: "silhouette" as DraftKey, apiKey: "silhouette", subLabel: "My silhouettes", kind: "array" as FieldKind, questionId: "silhouette", rev6OnlyFill: true },
    ],
  },
  {
    screenId: "r-fit-concerns",
    label: "Fit Considerations",
    question: "Are there any fit issues nAia should keep in mind?",
    helper: "Select any that apply.",
    fields: [
      { draftKey: "fit-concerns" as DraftKey, apiKey: "fitConcerns", subLabel: "Fit considerations", kind: "array" as FieldKind, questionId: "fit-concerns" },
      { draftKey: "fit-concerns-note" as DraftKey, apiKey: "fitConcernsNote", subLabel: "Additional fit notes", kind: "text" as FieldKind, questionId: "fit-concerns-note" },
    ],
  },
  {
    screenId: "r-dressing",
    label: "Your Dressing Requirements",
    question: "Are there any dressing requirements nAia should always respect?",
    helper: "Optional. Select anything nAia should always keep in mind when styling you.",
    optional: true,
    fields: [
      { draftKey: "dressing-preferences" as DraftKey, apiKey: "dressingPreferences", subLabel: "My dressing requirements", kind: "array" as FieldKind, questionId: "dressing-preferences", rev6OnlyFill: true },
    ],
  },
];

// Inserted into the active refresh sequence only when the legacy customer has no
// favoriteColors saved. avoidColors is not re-asked in the refresh flow.
const COLOURS_REFRESH_SCREEN: RefreshScreen = {
  screenId: "r-colors",
  label: "Your Colour Palette",
  question: "Which colours do you love to wear?",
  fields: [
    { draftKey: "favorite-colors" as DraftKey, apiKey: "favoriteColors", subLabel: "My colour palette", kind: "color" as FieldKind, questionId: "favorite-colors" },
  ],
};

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

  // Legacy detection: completed before Rev 6 was introduced.
  // profileVersion IS NULL → customer has never confirmed Rev 6 answers.
  const isLegacyCustomer = (op as any).profileVersion === null || (op as any).profileVersion === undefined;

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
  if ((op as any).fitConcernsNote)           savedAnswers["fit-concerns-note"]      = (op as any).fitConcernsNote;
  if ((op as any).preferredCoverage)         savedAnswers["preferred-coverage"]     = (op as any).preferredCoverage;
  // Rev 6 fields
  if ((op as any).currentGoal?.length)           savedAnswers["current-goal"]           = (op as any).currentGoal;
  if ((op as any).successfulOutfitGives?.length) savedAnswers["successful-outfit-gives"]= (op as any).successfulOutfitGives;
  if ((op as any).dressingPreferences?.length)   savedAnswers["dressing-preferences"]   = (op as any).dressingPreferences;
  // About You
  if ((op as any).ageRange)              savedAnswers["age-range"]              = (op as any).ageRange;
  if ((op as any).gender)                savedAnswers["gender"]                 = (op as any).gender;
  if ((op as any).genderSelfDescription) savedAnswers["gender-self-description"]= (op as any).genderSelfDescription;

  const sa = await prisma.selfieAnalysis.findUnique({
    where: { customerId: customer.id },
    select: { analysisStatus: true, analysisResult: true, analysedAt: true },
  });

  type SelfieChapter =
    | { status: "completed"; signals: SelfieStyleSignals; analysedAt: string }
    | { status: "pending" | "failed" | "deleted" };

  const selfieChapter: SelfieChapter | null = !sa ? null
    : sa.analysisStatus === "completed" && sa.analysisResult !== null
      ? { status: "completed", signals: sa.analysisResult as SelfieStyleSignals, analysedAt: sa.analysedAt?.toISOString() ?? "" }
    : sa.analysisStatus === "pending" ? { status: "pending" }
    : sa.analysisStatus === "failed"  ? { status: "failed" }
    : sa.analysisStatus === "deleted" ? { status: "deleted" }
    : null;

  return {
    savedAnswers,
    profileUpdatedAt: op.updatedAt.toISOString(),
    selfieChapter,
    isLegacyCustomer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function getSectionSummary(def: SectionDef, answers: OnboardingAnswers): ReactNode {
  // Notes: special empty-state copy (optional enrichment, never "Not yet completed")
  if (def.id === "notes") {
    const v = (answers as Record<string, unknown>)["final-notes"] as string | undefined;
    if (v?.trim()) return "Notes added";
    return <span className="sp-detail-optional">Optional — add a note</span>;
  }

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
    if (isEmpty) return <span className="sp-detail-optional">Optional</span>;

    const clothingParts: string[] = [];
    if (sysId)                           clothingParts.push(SIZING_SYSTEM_LABELS[sysId] ?? sysId.toUpperCase());
    if (topSz)                           clothingParts.push(`Top ${topSz}`);
    if (bottomSz && bottomSz !== topSz)  clothingParts.push(`Bottom ${bottomSz}`);
    if (dressSz)                         clothingParts.push(`Dress ${dressSz}`);

    const shoeParts: string[] = [];
    if (shoeSysId && shoeSz) shoeParts.push(`Shoes ${SHOE_SIZING_SYSTEM_LABELS[shoeSysId] ?? shoeSysId.toUpperCase()} ${shoeSz}`);
    else if (shoeSz)         shoeParts.push(`Shoes ${shoeSz}`);

    const allParts = [...clothingParts, ...shoeParts];
    if (allParts.length === 0) return <span className="sp-detail-optional">Optional</span>;
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
  | { kind: "picker" }
  | { kind: "refresh"; stepIndex: number; done?: boolean };

type SaveStatus = "idle" | "saving" | "error" | "conflict";
type PendingNext = "next" | "exit" | null;

// ─────────────────────────────────────────────────────────────────────────────
// Visual Analysis chapter — rendered inside the passport overview
// ─────────────────────────────────────────────────────────────────────────────

type SelfieChapterProp =
  | { status: "completed"; signals: SelfieStyleSignals; analysedAt: string }
  | { status: "pending" | "failed" | "deleted" }
  | null;

function VisualAnalysisChapter({ selfieChapter }: { selfieChapter: SelfieChapterProp }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      id="visual-analysis"
      className="sp-ov-section sp-ov-section--visual-analysis"
      style={{ scrollMarginTop: "80px" }}
    >
      <div className="sp-ov-section-header">Visual Analysis</div>

      {/* State 1 & 5: no record, or previously deleted */}
      {(!selfieChapter || selfieChapter.status === "deleted") && (
        <div style={{ paddingTop: "8px" }}>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75, marginBottom: "16px" }}>
            Refine your Passport with a selfie. nAia uses visual cues to add personalised
            guidance around colour, contrast, necklines, jewellery and metals, glasses, hair
            and makeup — as an optional layer on top of your questionnaire preferences.
          </p>
          <Link
            to="/passport/selfie"
            className="sp-btn-outline"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Add Visual Analysis
          </Link>
        </div>
      )}

      {/* State 2: processing */}
      {selfieChapter?.status === "pending" && (
        <div style={{ paddingTop: "8px" }}>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75, marginBottom: "16px" }}>
            Your visual analysis is being prepared.
          </p>
          <Link
            to="/passport/selfie"
            className="sp-btn-outline"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Check Progress
          </Link>
        </div>
      )}

      {/* State 4: failed */}
      {selfieChapter?.status === "failed" && (
        <div style={{ paddingTop: "8px" }}>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75, marginBottom: "16px" }}>
            We could not complete your visual analysis last time.
          </p>
          <Link
            to="/passport/selfie"
            className="sp-btn-outline"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Retry Analysis
          </Link>
        </div>
      )}

      {/* State 3: completed — expandable inline */}
      {selfieChapter?.status === "completed" && (
        <div style={{ paddingTop: "8px" }}>
          {selfieChapter.signals.overallNote && (
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.75, marginBottom: "12px" }}>
              {selfieChapter.signals.overallNote}
            </p>
          )}
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65, marginBottom: "16px" }}>
            Visual Analysis is optional — your questionnaire answers always take precedence.
          </p>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: expanded ? "20px" : "0" }}>
            <button
              type="button"
              className="sp-btn-outline"
              onClick={() => setExpanded(e => !e)}
              style={{ fontSize: "12px" }}
            >
              {expanded ? "Hide Visual Analysis ↑" : "View Visual Analysis ↓"}
            </button>
            <Link
              to="/passport/selfie"
              style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", letterSpacing: "0.4px", color: "var(--naia-muted)", textDecoration: "none" }}
            >
              Update →
            </Link>
          </div>

          {expanded && (
            <div style={{ paddingTop: "4px" }}>
              <SelfieVisualAnalysis signals={selfieChapter.signals} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PassportPage() {
  const { savedAnswers, profileUpdatedAt, selfieChapter, isLegacyCustomer } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  // Rev 6 customers have profileVersion=6; legacy customers have profileVersion=null.
  const isRev6 = !isLegacyCustomer;
  const visibleSections      = useMemo(() => getVisibleSections(isRev6), [isRev6]);
  const visibleAllSections   = useMemo(() => [...visibleSections, NOTES_SECTION], [visibleSections]);

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
  // Stores the exact flowEdits snapshot that was successfully persisted for each refresh
  // stepIndex. Used by Back navigation so it never depends on revalidation timing.
  const committedEditsRef = useRef<Record<number, OnboardingAnswers>>({});
  // True when editSection() pushed a { passport: "edit" } history entry that has not
  // yet been consumed. In-page exits must call history.back() (not setMode) so the
  // entry is consumed and no phantom Back step is left behind.
  const editPushedRef = useRef(false);

  // Missing sections uses visible sections for this customer type.
  // Optional sections never trigger as "missing". Primary sub-field uses effective (Rev 6-filtered) def.
  const missingSections = useMemo(() =>
    visibleAllSections.filter(s => {
      if (s.placeholder || s.optional) return false;
      const effectiveDef = getEffectiveDef(s, isRev6);
      const primary = effectiveDef.subFields[0];
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
    [savedAnswers, visibleAllSections, isRev6],
  );

  const isComplete = missingSections.length === 0;

  // Colours screen inserted before r-dressing only when the legacy customer has no
  // favoriteColors saved (empty array ⇒ key absent from savedAnswers).
  const activeRefreshScreens = useMemo(() => {
    const favColors = (savedAnswers["favorite-colors"] ?? []) as string[];
    if (favColors.length > 0) return REFRESH_SCREENS;
    return [
      ...REFRESH_SCREENS.slice(0, REFRESH_SCREENS.length - 1),
      COLOURS_REFRESH_SCREEN,
      REFRESH_SCREENS[REFRESH_SCREENS.length - 1],
    ];
  }, [savedAnswers]);

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const state = e.state as { passport?: string } | null;
      if (!state?.passport) {
        editPushedRef.current = false;
        setMode({ kind: "overview" });
      }
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
      exitToOverview();
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

  function exitToOverview() {
    if (editPushedRef.current) {
      // Consume the { passport: "edit" } entry we pushed so no phantom Back step
      // is left behind. The popstate handler will call setMode({ kind: "overview" }).
      editPushedRef.current = false;
      window.history.back();
    } else {
      setMode({ kind: "overview" });
    }
  }

  function editSection(id: SectionId) {
    // Push a history entry when launched from the overview so the browser's native
    // Back button also resolves to the overview (via the existing popstate handler).
    // When launched from the picker, the picker already pushed its own entry —
    // pushing again would layer an extra entry and confuse popstate routing.
    if (mode.kind === "overview") {
      window.history.pushState({ passport: "edit" }, "");
      editPushedRef.current = true;
    }
    initEdits(id);
    setMode({ kind: "flow", queue: [id], index: 0 });
  }

  // ── Legacy Rev 6 refresh ─────────────────────────────────────────────────────

  function initRefreshEdits(screen: RefreshScreen): OnboardingAnswers {
    const edits: OnboardingAnswers = {};
    for (const rf of screen.fields) {
      const saved = (savedAnswers as Record<string, unknown>)[rf.draftKey];
      if (rf.noAutoFill) {
        // Never prefill: old IDs are semantically incompatible with Rev 6 options
        (edits as Record<string, unknown>)[rf.draftKey] = rf.kind === "text" ? "" : [];
      } else if (rf.rev6OnlyFill) {
        // Prefill only values that are valid current Rev 6 IDs
        const arr = (Array.isArray(saved) ? saved : []) as string[];
        const valid = REV6_VALID_IDS[rf.questionId];
        (edits as Record<string, unknown>)[rf.draftKey] = valid ? arr.filter(id => valid.has(id)) : arr;
      } else {
        // Preserve as-is (fields new in Rev 6 — all stored IDs are compatible)
        if (rf.kind === "text") {
          (edits as Record<string, unknown>)[rf.draftKey] = typeof saved === "string" ? saved : "";
        } else {
          (edits as Record<string, unknown>)[rf.draftKey] = Array.isArray(saved) ? [...saved] : [];
        }
      }
    }
    return edits;
  }

  function startRefresh() {
    window.history.pushState({ passport: "refresh" }, "");
    setFlowEdits(initRefreshEdits(activeRefreshScreens[0]));
    setMode({ kind: "refresh", stepIndex: 0 });
  }

  async function saveRefreshStep(stepIndex: number, direction: "next" | "exit") {
    const screen = activeRefreshScreens[stepIndex];
    const isLast = stepIndex + 1 >= activeRefreshScreens.length;

    // Build patch for this screen's fields only
    const patch: Record<string, unknown> = { baseProfileUpdatedAt: profileUpdatedAt };
    for (const rf of screen.fields) {
      const v = (flowEdits as Record<string, unknown>)[rf.draftKey];
      patch[rf.apiKey] = v;
    }
    if (isLast && direction === "next") {
      patch.onboardingComplete = true; // triggers profileVersion=6 in the API
    }

    setSaveStatus("saving");
    try {
      const res = await fetch("/api/save-style-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 409) { setSaveStatus("conflict"); return; }
      if (!res.ok)            { setSaveStatus("error");    return; }

      setSaveStatus("idle");
      committedEditsRef.current[stepIndex] = { ...flowEdits } as OnboardingAnswers;
      revalidator.revalidate();

      if (direction === "exit") {
        setMode({ kind: "overview" });
      } else if (isLast) {
        setMode({ kind: "refresh", stepIndex, done: true });
      } else {
        const nextScreen = activeRefreshScreens[stepIndex + 1];
        setFlowEdits(initRefreshEdits(nextScreen));
        setMode({ kind: "refresh", stepIndex: stepIndex + 1 });
      }
    } catch {
      setSaveStatus("error");
    }
  }

  const handleToggle = useCallback((draftKey: DraftKey, optId: string, maxSel: number, pairKey?: DraftKey, exclusiveIds?: string[]) => {
    setFlowEdits(prev => {
      const current = ((prev as Record<string, unknown>)[draftKey] as string[] | undefined) ?? [];
      if (current.includes(optId)) {
        return { ...prev, [draftKey]: current.filter(id => id !== optId) };
      }
      const excl = exclusiveIds ?? [];
      if (excl.includes(optId)) {
        // Exclusive selected: replace entire selection with only this ID
        return { ...prev, [draftKey]: [optId] };
      }
      // Non-exclusive: remove any currently-selected exclusive IDs first
      const withoutExclusives = current.filter(id => !excl.includes(id));
      if (withoutExclusives.length < maxSel) {
        const next = { ...prev, [draftKey]: [...withoutExclusives, optId] };
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
        exitToOverview();
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

    let patch = computeSectionPatch(def, flowEdits, savedAnswers);
    if (sectionId === "about-you") {
      const genderDraft = (flowEdits as Record<string, unknown>)["gender"] as string | undefined;
      if (genderDraft !== "another-gender") {
        const savedDesc = (savedAnswers as Record<string, unknown>)["gender-self-description"] as string | undefined;
        if (savedDesc?.trim()) {
          patch = { ...(patch ?? {}), genderSelfDescription: null };
        }
      }
    }

    if (patch === null) {
      if (intent === "exit") {
        exitToOverview();
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
      if (isLegacyCustomer) {
        requestBody.onboardingComplete = true;
      }
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
            () => handleToggle(sf.draftKey, o.id, max, undefined, q?.exclusiveIds);
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
    const a = savedAnswers as Record<string, unknown>;
    const hasNote = !!((a["final-notes"] as string | undefined)?.trim());
    const getArr = (key: string) => (Array.isArray(a[key]) ? a[key] as string[] : []);

    // ── Rev 6 — premium editorial dossier ──────────────────────────────────
    if (isRev6) {
      const favColors   = getArr("favorite-colors").filter(id => !LEGACY_COLOUR_IDS.has(id));
      const avoidColors = getArr("avoid-colors");
      const fitConcerns = getArr("fit-concerns");
      const fitNote     = (a["fit-concerns-note"] as string | undefined)?.trim() ?? "";
      const dressingPrefs = getArr("dressing-preferences");
      const noteText    = (a["final-notes"] as string | undefined)?.trim() ?? "";
      const sizesDetail = getSectionDetail(getEffectiveDef(getSectionDef("sizes"), true), savedAnswers);

      return (
        <MyNaiaLayout>
          <Link to="/my-naia" className="sp-back">← Overview</Link>

          <div className="sp-shell">
            <h1 className="sp-shell-title">STYLE <span className="sp-shell-accent">passport.</span></h1>
            <p className="sp-shell-desc">
              Your Style Passport keeps the preferences that shape your nAia experience in one
              place. Update it whenever your style, life or priorities evolve.
            </p>
          </div>

          <div className="sp-status-block">
            <div className="sp-status-label">Status</div>
            <p className="sp-status-text">
              {isComplete
                ? "Your Style Passport is up to date."
                : "A few details are still missing."}
            </p>
            <div className="sp-status-date" suppressHydrationWarning>Last updated · {formatDate(profileUpdatedAt)}</div>
          </div>

          <div className="sp-ov-dossier">

            {/* Row 1: Current Focus | What Makes an Outfit Work */}
            <div className="sp-ov-grid">
              <div className="sp-ov-grid-cell">
                <div className="sp-ov-section-header-row">
                  <span className="sp-ov-section-header">Current Focus</span>
                  <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("goals")}>EDIT</button>
                </div>
                {getArr("current-goal").length > 0 ? (
                  <div className="sp-ov-focus-statements">
                    {getArr("current-goal").map(id => (
                      <div key={id} className="sp-ov-focus-statement">
                        {lbl("current-goal", id).toUpperCase()}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="sp-ov-dossier-empty">Optional — not yet set</span>
                )}
              </div>

              <div className="sp-ov-grid-cell">
                <div className="sp-ov-section-header-row">
                  <span className="sp-ov-section-header">What Makes an Outfit Work</span>
                  <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("outfit-gives")}>EDIT</button>
                </div>
                {getArr("successful-outfit-gives").length > 0 ? (
                  <div className="sp-ov-tags">
                    {getArr("successful-outfit-gives").map(id => (
                      <span key={id} className="sp-ov-tag">{lbl("successful-outfit-gives", id).toUpperCase()}</span>
                    ))}
                  </div>
                ) : (
                  <span className="sp-ov-dossier-empty">Optional — not yet set</span>
                )}
              </div>
            </div>

            {/* Row 2: Style | Lifestyle */}
            <div className="sp-ov-grid">
              <div className="sp-ov-grid-cell">
                <div className="sp-ov-section-header-row">
                  <span className="sp-ov-section-header">Style</span>
                  <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("identity")}>EDIT</button>
                </div>
                {getArr("style-personalities").length > 0 ? (
                  <div className="sp-ov-tags">
                    {getArr("style-personalities").map(id => (
                      <span key={id} className="sp-ov-tag">{lbl("style-personalities", id).toUpperCase()}</span>
                    ))}
                  </div>
                ) : (
                  <span className="sp-ov-dossier-empty sp-detail-missing">Not yet completed</span>
                )}
              </div>

              <div className="sp-ov-grid-cell">
                <div className="sp-ov-section-header-row">
                  <span className="sp-ov-section-header">Lifestyle</span>
                  <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("life")}>EDIT</button>
                </div>
                {getArr("lifestyle").length > 0 ? (
                  <div className="sp-ov-tags">
                    {getArr("lifestyle").map(id => (
                      <span key={id} className="sp-ov-tag">{lbl("lifestyle", id).toUpperCase()}</span>
                    ))}
                  </div>
                ) : (
                  <span className="sp-ov-dossier-empty sp-detail-missing">Not yet completed</span>
                )}
              </div>
            </div>

            {/* Row 3: Colour Palette (full width) */}
            <div className="sp-ov-wide">
              <div className="sp-ov-section-header-row">
                <span className="sp-ov-section-header">Colour Palette</span>
                <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("colours")}>EDIT</button>
              </div>
              {(favColors.length > 0 || avoidColors.length > 0) ? (
                <div className="sp-ov-colour-section">
                  {favColors.length > 0 && (
                    <div className="sp-ov-colour-group">
                      <div className="sp-ov-colour-group-label">You Love Wearing</div>
                      <div className="sp-ov-colour-grid">
                        {favColors.map(id => (
                          <div key={id} className="sp-ov-colour-row">
                            <span className="sp-ov-swatch" style={{ background: COLOR_HEX[id] ?? "#888" }} />
                            <span className="sp-ov-colour-name">{lbl("favorite-colors", id)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {avoidColors.length > 0 && (
                    <div className="sp-ov-colour-group sp-ov-colour-group--avoid">
                      <div className="sp-ov-colour-group-label">You Usually Avoid</div>
                      <div className="sp-ov-colour-grid">
                        {avoidColors.map(id => (
                          <div key={id} className="sp-ov-colour-row">
                            <span className="sp-ov-swatch" style={{ background: COLOR_HEX[id] ?? "#888" }} />
                            <span className="sp-ov-colour-name">{lbl("avoid-colors", id)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <span className="sp-ov-dossier-empty sp-detail-missing">Not yet completed</span>
              )}
            </div>

            {/* Row 4: Silhouette | Fit Concerns */}
            <div className="sp-ov-grid">
              <div className="sp-ov-grid-cell">
                <div className="sp-ov-section-header-row">
                  <span className="sp-ov-section-header">Silhouette</span>
                  <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("fit")}>EDIT</button>
                </div>
                {getArr("silhouette").length > 0 ? (
                  <div className="sp-ov-tags">
                    {getArr("silhouette").map(id => (
                      <span key={id} className="sp-ov-tag">{lbl("silhouette", id).toUpperCase()}</span>
                    ))}
                  </div>
                ) : (
                  <span className="sp-ov-dossier-empty sp-detail-missing">Not yet completed</span>
                )}
              </div>

              <div className="sp-ov-grid-cell">
                <div className="sp-ov-section-header-row">
                  <span className="sp-ov-section-header">Fit Concerns</span>
                  <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("fit-concerns")}>EDIT</button>
                </div>
                {(fitConcerns.length > 0 || fitNote) ? (
                  <div className="sp-ov-fit-list">
                    {fitConcerns.map(id => (
                      <div key={id} className="sp-ov-fit-item">{lbl("fit-concerns", id)}</div>
                    ))}
                    {fitNote && <div className="sp-ov-fit-item">{fitNote}</div>}
                  </div>
                ) : (
                  <span className="sp-ov-dossier-empty">Optional — none added</span>
                )}
              </div>
            </div>

            {/* Row 5: Dressing Requirements (full width) */}
            <div className="sp-ov-wide">
              <div className="sp-ov-section-header-row">
                <span className="sp-ov-section-header">Dressing Requirements</span>
                <button type="button" className="sp-ov-edit-btn" onClick={() => editSection("dressing")}>EDIT</button>
              </div>
              {dressingPrefs.length > 0 ? (
                <div className="sp-ov-tags">
                  {dressingPrefs.map(id => (
                    <span key={id} className="sp-ov-tag sp-ov-tag--boundary">
                      {lbl("dressing-preferences", id).toUpperCase()}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="sp-ov-dossier-empty">Optional — none added</span>
              )}
            </div>

            {/* Row 6: Notes to nAia (full width) */}
            <div className="sp-ov-wide">
              <div className="sp-ov-section-header">Notes to nAia</div>
              {noteText ? (
                <p className="sp-ov-notes-quoted">"{noteText}"</p>
              ) : (
                <span className="sp-ov-dossier-empty" style={{ display: "block", marginBottom: "12px" }}>Optional — add a note</span>
              )}
              <button
                type="button"
                className="sp-btn-outline"
                onClick={() => editSection("notes")}
                style={{ marginTop: noteText ? "12px" : "0" }}
              >
                {hasNote ? "EDIT NOTE" : "ADD A NOTE"}
              </button>
            </div>

            {/* Optional enrichment: Sizes & Visual Analysis */}
            <div className="sp-ov-enrich-area">
              <div className="sp-ov-enrich-eyebrow">Make Your Passport More Precise</div>
              <div className="sp-ov-enrich-cards">

                <div className="sp-ov-enrich-card">
                  <div className="sp-ov-enrich-card-title">Sizes &amp; Measurements</div>
                  <p className="sp-ov-enrich-card-desc">
                    For more precise fit and shopping guidance.
                  </p>
                  {sizesDetail}
                  <button
                    type="button"
                    className="sp-btn-outline"
                    onClick={() => editSection("sizes")}
                    style={{ marginTop: sizesDetail ? "12px" : "0" }}
                  >
                    {sizesDetail ? "UPDATE SIZES" : "ADD SIZES & MEASUREMENTS"}
                  </button>
                </div>

                <div className="sp-ov-enrich-card">
                  <div className="sp-ov-enrich-card-title">About You</div>
                  <p className="sp-ov-enrich-card-desc">
                    Optional context — not used to infer your style or restrict recommendations.
                  </p>
                  {(() => {
                    const ageLabel = (savedAnswers["age-range"] as string | undefined)
                      ? lbl("age-range", savedAnswers["age-range"] as string)
                      : null;
                    const genderLabel = (savedAnswers["gender"] as string | undefined)
                      ? lbl("gender", savedAnswers["gender"] as string)
                      : null;
                    const genderNote = (savedAnswers["gender-self-description"] as string | undefined)?.trim() ?? null;
                    const parts = [ageLabel, genderLabel].filter(Boolean);
                    return parts.length > 0 ? (
                      <div className="sp-ov-enrich-detail">
                        {parts.join(" · ")}
                        {genderNote && <span className="sp-ov-enrich-detail-note"> — {genderNote}</span>}
                      </div>
                    ) : null;
                  })()}
                  <button
                    type="button"
                    className="sp-btn-outline"
                    onClick={() => editSection("about-you")}
                    style={{ marginTop: savedAnswers["age-range"] || savedAnswers["gender"] ? "12px" : "0" }}
                  >
                    {savedAnswers["age-range"] || savedAnswers["gender"] ? "UPDATE" : "ADD ABOUT YOU"}
                  </button>
                </div>

                <div className="sp-ov-enrich-card">
                  <VisualAnalysisChapter selfieChapter={selfieChapter ?? null} />
                </div>

              </div>
            </div>
          </div>

          <div className="sp-actions">
            {!isLegacyCustomer && !isComplete && (
              <button type="button" className="sp-btn-primary" onClick={startContinue}>
                Continue Passport
              </button>
            )}
            <button type="button" className="sp-btn-outline" onClick={startUpdate}>
              Update Answers
            </button>
          </div>

          {!isLegacyCustomer && !isComplete && missingSections[0] && (
            <div className="sp-state-note">
              You'll resume at <strong>{missingSections[0].label}</strong>. All previous answers are preserved.
            </div>
          )}
        </MyNaiaLayout>
      );
    }

    // ── Legacy (non-Rev6) — existing flat layout unchanged ─────────────────
    return (
      <MyNaiaLayout>
        <Link to="/my-naia" className="sp-back">← Overview</Link>

        <div className="sp-shell">
          <h1 className="sp-shell-title">Your Style Passport</h1>
          <p className="sp-shell-desc">
            Your Style Passport keeps the preferences that shape your nAia experience in one
            place. Update it whenever your style, life or priorities evolve.
          </p>
        </div>

        <div className="sp-refresh-banner">
          <div className="sp-refresh-banner-title">Your Style Passport has evolved</div>
          <p className="sp-refresh-banner-desc">
            A few quick answers will bring it up to date with the current version of nAia.
            Your existing preferences are preserved.
          </p>
          <button type="button" className="sp-btn-primary" onClick={startRefresh}>
            Refresh your Style Passport
          </button>
        </div>

        <div className="sp-status-block">
          <div className="sp-status-label">Status</div>
          <p className="sp-status-text">
            Refresh recommended — your passport predates the current version.
          </p>
          <div className="sp-status-date" suppressHydrationWarning>Last updated · {formatDate(profileUpdatedAt)}</div>
        </div>

        {/* Full detail — visible sections for this customer type + Notes */}
        <div className="sp-ov-sections">
          {visibleSections.map(def => {
            const detail = getSectionDetail(getEffectiveDef(def, false), savedAnswers);
            return (
              <div key={def.id} className="sp-ov-section">
                <div className="sp-ov-section-header">{def.label}</div>
                {detail}
              </div>
            );
          })}
          <div className="sp-ov-section sp-ov-section--notes">
            <div className="sp-ov-section-header">{NOTES_SECTION.label}</div>
            {getSectionDetail(NOTES_SECTION, savedAnswers)}
          </div>
          <VisualAnalysisChapter selfieChapter={selfieChapter ?? null} />
        </div>

        <div className="sp-actions">
          <button type="button" className="sp-btn-outline" onClick={startUpdate}>
            Update Answers
          </button>
        </div>
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
          <h2 className="sp-shell-title">EDIT <span className="sp-shell-accent">passport.</span></h2>
          <p className="sp-shell-desc">
            Choose any section below. All other answers stay exactly as they are.
          </p>
        </div>

        <div className="sp-picker-list">
          {visibleSections.map(def => (
            <button
              key={def.id}
              type="button"
              className="sp-picker-btn"
              onClick={() => editSection(def.id)}
            >
              <span className="sp-picker-label">{def.label}</span>
              <span className="sp-picker-value">{getSectionSummary(getEffectiveDef(def, isRev6), savedAnswers)}</span>
            </button>
          ))}
          {/* Notes — in picker but outside named sections */}
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

  // ── REFRESH DONE ─────────────────────────────────────────────────────────────

  if (mode.kind === "refresh" && mode.done) {
    return (
      <MyNaiaLayout>
        <button type="button" className="sp-back" onClick={() => setMode({ kind: "overview" })}>
          ← Style Passport
        </button>

        <div className="sp-shell">
          <h1 className="sp-shell-title">STYLE <span className="sp-shell-accent">passport.</span></h1>
          <p className="sp-shell-desc">
            nAia now has your current preferences. Every suggestion from here will reflect the
            updated version of your Passport.
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

  // ── REFRESH STEP ─────────────────────────────────────────────────────────────

  if (mode.kind === "refresh") {
    const screen    = activeRefreshScreens[mode.stepIndex];
    const stepNum   = mode.stepIndex + 1;
    const stepTotal = activeRefreshScreens.length;
    const isLast    = mode.stepIndex + 1 >= activeRefreshScreens.length;

    // Required-field guard: Next is disabled until the primary field has at least one
    // selection. Only non-optional screens are blocked (dressingPreferences stays skippable).
    const primaryField = screen.fields[0];
    const primaryVal   = (flowEdits as Record<string, unknown>)[primaryField.draftKey];
    const primaryArr   = Array.isArray(primaryVal) ? (primaryVal as string[]) : [];
    const isBlocked    = !screen.optional && primaryArr.length === 0;

    return (
      <MyNaiaLayout>
        <button
          type="button"
          className="sp-back"
          disabled={isBusy}
          onClick={() => saveRefreshStep(mode.stepIndex, "exit")}
        >
          ← Continue Later
        </button>

        <div className="sp-flow-header">
          <div className="sp-flow-meta">
            Step {stepNum} of {stepTotal} · {screen.label}
          </div>
          <h2 className="sp-flow-question">{screen.question}</h2>
          {screen.helper && <p className="sp-flow-helper">{screen.helper}</p>}
        </div>

        {screen.fields.map(rf => (
          <div key={rf.draftKey} className="sp-sub-section">
            {screen.fields.length > 1 && (
              <div className="sp-sub-label">{rf.subLabel}</div>
            )}
            {renderSubField(rf as SubField)}
          </div>
        ))}

        {saveStatus === "error" && (
          <div className="sp-save-error">Something went wrong — please try again.</div>
        )}
        {saveStatus === "conflict" && (
          <div className="sp-save-error">Your profile was updated elsewhere. Please reload.</div>
        )}

        <div className="sp-flow-actions">
          {mode.stepIndex > 0 && (
            <button
              type="button"
              className="sp-btn-outline"
              disabled={isBusy}
              onClick={() => {
                const prevIndex = mode.stepIndex - 1;
                const prevScreen = activeRefreshScreens[prevIndex];
                const edits = committedEditsRef.current[prevIndex] ?? initRefreshEdits(prevScreen);
                setFlowEdits(edits);
                setMode({ kind: "refresh", stepIndex: prevIndex });
              }}
            >
              ← Back
            </button>
          )}
          <button
            type="button"
            className="sp-btn-primary"
            disabled={isBusy || isBlocked}
            onClick={() => saveRefreshStep(mode.stepIndex, "next")}
          >
            {isBusy ? "Saving…" : isLast ? "Complete Refresh" : "Next"}
          </button>
          {screen.optional && !isLast && (
            <button
              type="button"
              className="sp-btn-outline"
              disabled={isBusy}
              onClick={() => {
                const nextScreen = activeRefreshScreens[mode.stepIndex + 1];
                setFlowEdits(initRefreshEdits(nextScreen));
                setMode({ kind: "refresh", stepIndex: mode.stepIndex + 1 });
              }}
            >
              Skip for now
            </button>
          )}
        </div>
      </MyNaiaLayout>
    );
  }

  // ── COMPLETION ───────────────────────────────────────────────────────────────

  if (mode.kind === "flow" && mode.done) {
    return (
      <MyNaiaLayout>
        <button type="button" className="sp-back" onClick={exitToOverview}>
          ← Style Passport
        </button>

        <div className="sp-shell">
          <h1 className="sp-shell-title">STYLE <span className="sp-shell-accent">passport.</span></h1>
          <p className="sp-shell-desc">
            nAia has your latest preferences. You can revisit any answer at any time.
          </p>
        </div>

        <div className="sp-actions">
          <button type="button" className="sp-btn-primary" onClick={exitToOverview}>
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
        ← Continue Later
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

            {/* ── Group 3: Proportions & fit — legacy customers only ── */}
            {isLegacyCustomer && (
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
            )}

          </>
        );
      })()}

      {/* All other sections — generic sub-field renderer (uses effective def for Rev 6 filtering) */}
      {currentId !== "sizes" && (() => {
        const effectiveSubFields = getEffectiveDef(currentDef, isRev6).subFields;
        return effectiveSubFields.map(sf => {
          if (sf.draftKey === "gender-self-description" &&
              ((flowEdits as Record<string, unknown>)["gender"] as string | undefined) !== "another-gender") {
            return null;
          }
          const capHint = (sf.kind === "array" || sf.kind === "color") && MAX_SELECTIONS[sf.questionId]
            ? (QUESTION_BY_ID[sf.questionId]?.subtitle ?? `Choose up to ${MAX_SELECTIONS[sf.questionId]}`)
            : null;
          return (
            <div key={String(sf.draftKey)}>
              {effectiveSubFields.length > 1 && (
                <div className="sp-sub-label">{sf.subLabel}</div>
              )}
              {capHint && <div className="sp-cap-hint">{capHint}</div>}
              {renderSubField(sf)}
            </div>
          );
        });
      })()}

      <div className="sp-flow-actions">
        <button
          type="button"
          className="sp-btn-outline"
          disabled={isBusy}
          onClick={() => {
            if (mode.index === 0) {
              if (mode.queue.length === 1) {
                // Single-section edit: return to overview and consume any pushed
                // edit history entry so no phantom Back step is left behind.
                exitToOverview();
              } else {
                navigate(-1);
              }
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
            Continue Later
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
