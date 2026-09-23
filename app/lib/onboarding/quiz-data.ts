// app/lib/onboarding/quiz-data.ts
// Passport Rev 7 — 11-screen onboarding (avoid-colours rides on the colour screen).
//
// Stable internal IDs live in app/lib/passport/rev7-vocabulary.ts. This file is the
// display layer: it pairs those IDs with copy and per-question UI hints.
//
// BACKWARD COMPATIBILITY
//   Options are never deleted. Questions retired from the live flow move to
//   LEGACY_QUESTIONS so that a stored answer from an older Passport still resolves
//   to real display copy instead of a title-cased slug.

import {
  STYLE_EXPRESSION_MAX,
  STYLE_DIRECTION_MAX,
  DRESSING_HABIT_MAX,
  FAVOURITE_COLOURS_MAX,
  NO_COLOUR_PREFERENCE_ID,
  NO_AVOID_COLOURS_ID,
  DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID,
  DRESSING_REQUIREMENTS_NOTE_MAX,
} from "../passport/rev7-vocabulary";

export interface ColourOption {
  id: string;
  hex: string;
  name: string;
  /** Sentinel entries ("no strong preference", "none") are not real swatches. */
  sentinel?: boolean;
}

export interface SecondaryColorQuestion {
  id: string;
  title: string;
  subtitle?: string;
  colors: ColourOption[];
  maxSelections?: number;
  exclusiveIds?: string[];
}

export interface QuizQuestion {
  id: string;
  type: "single" | "multi" | "image" | "text" | "color" | "scale";
  title: string;
  subtitle?: string;
  options?: Array<{
    id: string;
    label: string;
    emoji?: string;
    description?: string;
    /** Stored and validated, but never offered in the production UI. */
    reserved?: boolean;
  }>;
  colors?: ColourOption[];
  maxSelections?: number;
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  secondaryQuestion?: SecondaryColorQuestion;
  // IDs that behave as exclusive toggles:
  // selecting an exclusive ID clears all others; selecting any non-exclusive ID clears exclusives.
  exclusiveIds?: string[];
  // Optional secondary note field revealed when a designated trigger ID is selected.
  noteField?: { triggerId: string; id: string; placeholder: string; maxLength: number };
}

// Canonical colour families — shared by favourite and avoid pickers (Screen 7).
// Rev 7 adds blue, purple and metallics.
export const COLOUR_FAMILIES: ColourOption[] = [
  { id: "black",        hex: "#000000", name: "Black"          },
  { id: "white-cream",  hex: "#f5f5dc", name: "White / Cream"  },
  { id: "beige-brown",  hex: "#c19a6b", name: "Beige / Brown"  },
  { id: "grey",         hex: "#808080", name: "Grey"           },
  { id: "navy",         hex: "#1e3a5f", name: "Navy"           },
  { id: "blue",         hex: "#4a7fb5", name: "Blue"           },
  { id: "green",        hex: "#2e8b57", name: "Green"          },
  { id: "red-burgundy", hex: "#722f37", name: "Red / Burgundy" },
  { id: "pink",         hex: "#e8a0b2", name: "Pink"           },
  { id: "purple",       hex: "#6b4c8a", name: "Purple"         },
  { id: "yellow",       hex: "#f4c430", name: "Yellow"         },
  { id: "orange",       hex: "#e86100", name: "Orange"         },
  { id: "metallics",    hex: "#b8a888", name: "Metallics"      },
];

/** Favourite-colour picker entries, including the "no strong preference" sentinel. */
export const FAVOURITE_COLOUR_OPTIONS: ColourOption[] = [
  ...COLOUR_FAMILIES,
  { id: NO_COLOUR_PREFERENCE_ID, hex: "#ffffff", name: "I don't have strong colour preferences", sentinel: true },
];

/** Avoid-colour picker entries, including the "none" sentinel. */
export const AVOID_COLOUR_OPTIONS: ColourOption[] = [
  ...COLOUR_FAMILIES,
  { id: NO_AVOID_COLOURS_ID, hex: "#ffffff", name: "None", sentinel: true },
];

// Rev 7 — 11-screen first-onboarding sequence
export const quizQuestions: QuizQuestion[] = [

  // SCREEN 1 — CURRENT FOCUS (mutable context; never scored)
  {
    id: "current-goal",
    type: "multi",
    title: "What would you like nAia to help you with right now?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    exclusiveIds: ["not-sure-yet"],
    options: [
      { id: "understand-my-style",        label: "Understand my personal style"           },
      { id: "feel-more-like-myself",      label: "Feel more like myself in what I wear"   },
      { id: "use-what-i-own",             label: "Get more from what I already own"       },
      { id: "easier-getting-dressed",     label: "Make getting dressed easier"            },
      { id: "stop-regret-purchases",      label: "Stop buying things I never wear"        },
      { id: "more-cohesive-wardrobe",     label: "Build a more cohesive wardrobe"         },
      { id: "dress-for-my-life",          label: "Dress better for my actual life"        },
      { id: "refresh-my-style",           label: "Refresh my style"                       },
      { id: "specific-event-trip-change", label: "Dress for a specific event or life change" },
      { id: "not-sure-yet",               label: "Not sure yet"                           },
    ],
  },

  // SCREEN 2 — OUTFIT PRIORITIES (standing; Style Memory input)
  {
    id: "successful-outfit-gives",
    type: "multi",
    title: "What makes an outfit feel right for you?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    exclusiveIds: ["not-sure"],
    options: [
      { id: "feel-like-myself",    label: "I feel like myself"   },
      { id: "confidence",          label: "I feel confident"     },
      { id: "feel-put-together",   label: "I feel put-together"  },
      { id: "comfort-ease",        label: "I feel comfortable"   },
      { id: "feel-attractive",     label: "I feel attractive"    },
      { id: "sense-of-expression", label: "I feel expressive"    },
      { id: "sense-of-power",      label: "I feel powerful"      },
      { id: "effortlessness",      label: "I feel effortless"    },
      { id: "feel-distinctive",    label: "I feel distinctive"   },
      { id: "not-sure",            label: "I'm not sure yet"     },
    ],
  },

  // SCREEN 3 — STYLE EXPRESSION (what clothes should communicate)
  {
    id: "style-expression",
    type: "multi",
    title: "What would you like your style to communicate about you?",
    subtitle: `Choose up to ${STYLE_EXPRESSION_MAX}`,
    maxSelections: STYLE_EXPRESSION_MAX,
    exclusiveIds: ["not-sure"],
    options: [
      { id: "quiet-confidence", label: "Quiet confidence" },
      { id: "polished",         label: "Polished"         },
      { id: "effortless",       label: "Effortless"       },
      { id: "bold",             label: "Bold"             },
      { id: "creative",         label: "Creative"         },
      { id: "sophisticated",    label: "Sophisticated"    },
      { id: "relaxed",          label: "Relaxed"          },
      { id: "powerful",         label: "Powerful"         },
      { id: "playful",          label: "Playful"          },
      { id: "individual",       label: "Individual"       },
      { id: "understated",      label: "Understated"      },
      { id: "unexpected",       label: "Unexpected"       },
      { id: "not-sure",         label: "I'm not sure yet" },
    ],
  },

  // SCREEN 4 — STYLE EXPLORATION (how far nAia should push)
  {
    id: "exploration-level",
    type: "single",
    title: "How much would you like nAia to push your style?",
    subtitle: "Choose 1",
    options: [
      { id: "stay-familiar",         label: "Keep me close to what I already wear"      },
      { id: "familiar-small-twists", label: "Keep it familiar, with small twists"       },
      { id: "balanced",              label: "Give me a balance of familiar and new"     },
      { id: "push-beyond",           label: "Push me beyond my usual choices"           },
      { id: "depends-on-occasion",   label: "It depends on the occasion"                },
      { id: "not-sure",              label: "I'm not sure yet"                          },
    ],
  },

  // SCREEN 5 — STYLE DIRECTION (canonical Rev 7 style field)
  // Replaces the legacy "Which styles currently feel most like you?" question.
  // Legacy stylePersonalities answers are preserved and never overwritten.
  {
    id: "style-directions",
    type: "multi",
    title: "Which looks are you naturally drawn to?",
    subtitle: `Choose up to ${STYLE_DIRECTION_MAX}`,
    maxSelections: STYLE_DIRECTION_MAX,
    exclusiveIds: ["not-sure"],
    options: [
      { id: "polished-refined",    label: "Polished & Refined"     },
      { id: "clean-minimal",       label: "Clean & Minimal"        },
      { id: "relaxed-easy",        label: "Relaxed & Easy"         },
      { id: "bold-statement",      label: "Bold & Statement"       },
      { id: "creative-individual", label: "Creative & Individual"  },
      { id: "soft-romantic",       label: "Soft & Romantic"        },
      { id: "street-contemporary", label: "Street & Contemporary"  },
      { id: "sporty-functional",   label: "Sporty & Functional"    },
      { id: "not-sure",            label: "I'm not sure yet"       },
    ],
  },

  // SCREEN 6 — LIFESTYLE
  // Rev 7: no selection cap. A customer's life can legitimately span many contexts
  // and nAia should know all of them. Server-side validation checks IDs, not count.
  {
    id: "lifestyle",
    type: "multi",
    title: "Which of these are part of your lifestyle?",
    subtitle: "Choose all that are relevant to your life.",
    options: [
      { id: "work-office",              label: "Work / Office"              },
      { id: "everyday-casual",          label: "Everyday / Casual"          },
      { id: "dinners-going-out",        label: "Dinners & Going Out"        },
      { id: "events-special-occasions", label: "Events & Special Occasions" },
      { id: "family-parenting",         label: "Family / Caregiving"        },
      { id: "study-university",         label: "Study / University"         },
      { id: "travel",                   label: "Travel"                     },
      { id: "fitness-gym",              label: "Fitness / Gym / Pilates"    },
      { id: "active-busy-days",         label: "Busy / Errand Days"         },
      { id: "creative-flexible-work",   label: "Creative / Flexible Work"   },
      { id: "mostly-at-home",           label: "Mostly at Home"             },
      { id: "other-lifestyle",          label: "Other"                      },
    ],
  },

  // SCREEN 7 — COLOURS (favourite required, avoid optional — same screen)
  {
    id: "favorite-colors",
    type: "color",
    title: "Which colours do you love wearing?",
    subtitle: `Choose up to ${FAVOURITE_COLOURS_MAX}`,
    maxSelections: FAVOURITE_COLOURS_MAX,
    exclusiveIds: [NO_COLOUR_PREFERENCE_ID],
    colors: FAVOURITE_COLOUR_OPTIONS,
    secondaryQuestion: {
      id: "avoid-colors",
      title: "Are there any colours you usually avoid?",
      subtitle: "Optional. Select any that apply.",
      colors: AVOID_COLOUR_OPTIONS,
      exclusiveIds: [NO_AVOID_COLOURS_ID],
    },
  },

  // SCREEN 8 — SHAPE & FIT PREFERENCES
  {
    id: "silhouette",
    type: "multi",
    title: "Which shapes or fits do you usually feel best in?",
    subtitle: "Choose up to 4",
    maxSelections: 4,
    exclusiveIds: ["not-sure"],
    options: [
      { id: "fitted",              label: "Fitted"                      },
      { id: "straight-simple",     label: "Straight"                    },
      { id: "relaxed",             label: "Relaxed"                     },
      { id: "oversized",           label: "Oversized"                   },
      { id: "structured-tailored", label: "Structured / Tailored"       },
      { id: "waist-defined",       label: "Waist-defined"               },
      { id: "boxy",                label: "Boxy"                        },
      { id: "tapered",             label: "Tapered"                     },
      { id: "loose-flowing",       label: "Wide / Fluid"                },
      { id: "longline",            label: "Longline"                    },
      { id: "cropped-fit",         label: "Cropped"                     },
      { id: "mixing-fits",         label: "I like mixing different fits" },
      { id: "not-sure",            label: "I'm not sure yet"            },
    ],
  },

  // SCREEN 9 — FIT & COMFORT CONCERNS (no-fit-problems exclusive; other reveals note)
  {
    id: "fit-concerns",
    type: "multi",
    title: "Are there any fit or comfort issues nAia should keep in mind?",
    subtitle: "Select any that apply.",
    exclusiveIds: ["no-fit-problems"],
    noteField: {
      triggerId: "other",
      id: "fit-concerns-note",
      placeholder: "Anything you'd like us to know?",
      maxLength: 500,
    },
    options: [
      { id: "tops-pull-bust",              label: "Tops or jackets can feel tight through my chest or back" },
      { id: "tight-hips-thighs",           label: "Bottoms can feel tight through my hips, seat or thighs"  },
      { id: "waistbands-gape",             label: "Waistbands often gap"                                     },
      { id: "uncomfortable-rise",          label: "Trouser rises can feel uncomfortable"                     },
      { id: "shoulder-sleeve-fit",         label: "Shoulder or sleeve fit can be difficult"                  },
      { id: "often-too-short",             label: "Clothes are often too short"                              },
      { id: "often-too-long",              label: "Clothes are often too long"                               },
      { id: "less-cling-midsection",       label: "I prefer less cling around my midsection"                 },
      { id: "shoe-width-comfort",          label: "Shoe width or comfort can be difficult"                   },
      { id: "fabric-texture-sensitivity",  label: "Some fabrics or textures feel uncomfortable against my skin" },
      { id: "size-changes",                label: "My size changes"                                          },
      { id: "no-fit-problems",             label: "I don't usually have fit problems"                        },
      { id: "other",                       label: "Something else"                                           },
    ],
  },

  // SCREEN 10 — DRESSING REQUIREMENTS (feeds the Group 2 hard-exclusion engine)
  // avoid-sheer / avoid-open-back are reserved: accepted and stored, never offered,
  // because no opacity or back-coverage metadata exists to enforce them.
  // See RESERVED_DRESSING_PREFERENCE_IDS in app/lib/passport/rev7-vocabulary.ts.
  {
    id: "dressing-preferences",
    type: "multi",
    title: "Are there any dressing preferences or requirements nAia should always respect?",
    subtitle: "Optional. Select any that apply.",
    exclusiveIds: ["no-dressing-requirements"],
    noteField: {
      triggerId: DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID,
      id: "dressing-requirements-note",
      placeholder: "Tell nAia what it should always respect.",
      maxLength: DRESSING_REQUIREMENTS_NOTE_MAX,
    },
    options: [
      { id: "dresses-modestly",            label: "I dress modestly"                      },
      { id: "arms-covered",                label: "I keep my arms covered"                },
      { id: "chest-neckline-covered",      label: "I keep my chest / neckline covered"    },
      { id: "legs-covered",                label: "I keep my legs covered"                },
      { id: "avoid-sleeveless",            label: "I avoid sleeveless styles"             },
      { id: "no-cropped-tops",             label: "I avoid cropped tops"                  },
      { id: "avoid-shorts",                label: "I avoid shorts"                        },
      { id: "avoid-sheer",                 label: "I avoid sheer / see-through styles",   reserved: true },
      { id: "avoid-open-back",             label: "I avoid low or open backs",            reserved: true },
      { id: "prefer-higher-necklines",     label: "I prefer higher necklines"             },
      { id: "longer-tops",                 label: "I prefer longer tops / shirts"         },
      { id: "prefer-full-length-trousers", label: "I prefer full-length trousers"         },
      { id: "looser-fitting",              label: "I prefer looser-fitting clothes"       },
      { id: "wears-hijab",                 label: "I wear hijab"                          },
      { id: "usually-wears-abayas",        label: "I wear abayas"                         },
      { id: "kanduras-thobes",             label: "I wear kanduras / thobes"              },
      { id: DRESSING_REQUIREMENTS_NOTE_TRIGGER_ID, label: "I have other cultural or religious dressing requirements" },
      { id: "no-dressing-requirements",    label: "I have no specific dressing requirements" },
    ],
  },

  // SCREEN 11 — DRESSING HABITS (behavioural context; never scored)
  {
    id: "dressing-habits",
    type: "multi",
    title: "Which sounds most like you when you're getting dressed?",
    subtitle: `Choose up to ${DRESSING_HABIT_MAX}`,
    maxSelections: DRESSING_HABIT_MAX,
    exclusiveIds: ["none-of-these"],
    options: [
      { id: "repeat-same-outfits",      label: "I know what I like, but repeat the same outfits"                     },
      { id: "struggle-to-combine",      label: "I have plenty of clothes but struggle to put outfits together"       },
      { id: "nothing-to-wear",          label: "I often feel like I have nothing to wear"                            },
      { id: "overthink",                label: "I overthink what to wear"                                            },
      { id: "know-what-i-want",         label: "I usually know exactly what I want to wear"                          },
      { id: "play-it-safe",             label: "I tend to play it safe"                                              },
      { id: "enjoy-experimenting",      label: "I enjoy experimenting"                                               },
      { id: "mood-led",                 label: "What I want to wear changes with my mood"                            },
      { id: "comfort-first",            label: "I prioritise comfort and build the outfit around it"                 },
      { id: "want-it-easier",           label: "I want getting dressed to feel easier"                               },
      { id: "buy-but-cant-style",       label: "I buy pieces I like but struggle to style them"                      },
      { id: "save-inspo-cant-recreate", label: "I save outfit inspiration but struggle to recreate it with my own clothes" },
      { id: "none-of-these",            label: "None of these really describe me"                                    },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY QUESTIONS — retired from the live flow, kept for label resolution.
// Stored answers from older Passports must never degrade to a title-cased slug.
// ─────────────────────────────────────────────────────────────────────────────

export const LEGACY_QUESTIONS: QuizQuestion[] = [
  {
    // Retired at Rev 7 — superseded by "style-directions".
    id: "style-personalities",
    type: "multi",
    title: "Which styles currently feel most like you?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      // V3 archetypes (Rev 6 vocabulary)
      { id: "classic-polished",    label: "Classic & Polished"    },
      { id: "feminine-romantic",   label: "Feminine & Romantic"   },
      { id: "minimal-relaxed",     label: "Minimal & Relaxed"     },
      { id: "bold-edgy",           label: "Bold & Edgy"           },
      { id: "creative-expressive", label: "Creative & Expressive" },
      // V2 vocabulary (pre-Rev 6 stored values)
      { id: "old-money",          label: "Old Money"          },
      { id: "corporate-chic",     label: "Corporate Chic"     },
      { id: "effortlessly-chic",  label: "Effortlessly Chic"  },
      { id: "minimal",            label: "Minimal"            },
      { id: "casual-cool",        label: "Casual Cool"        },
      { id: "feminine",           label: "Feminine"           },
      { id: "romantic",           label: "Romantic"           },
      { id: "edgy",               label: "Edgy"               },
      { id: "trendy",             label: "Trendy"             },
      { id: "artsy",              label: "Artsy"              },
    ],
  },
  {
    // Legacy lifestyle vocabulary (V2) — stored on pre-Rev 6 profiles.
    id: "lifestyle-legacy",
    type: "multi",
    title: "What do you dress for most often?",
    options: [
      { id: "office",            label: "Office"            },
      { id: "busy-mom",          label: "Busy Mum"          },
      { id: "creative",          label: "Creative Work"     },
      { id: "casual-days",       label: "Casual Days"       },
      { id: "events",            label: "Events"            },
      { id: "always-on-the-go",  label: "Always On the Go"  },
      { id: "on-the-go",         label: "On the Go"         },
      { id: "hybrid",            label: "Hybrid"            },
    ],
  },
  {
    // Legacy silhouette vocabulary (V2) — stored on pre-Rev 6 profiles.
    id: "silhouette-legacy",
    type: "multi",
    title: "Which silhouettes do you usually feel best in?",
    options: [
      { id: "defined-waist", label: "Defined Waist" },
      { id: "straight",      label: "Straight"      },
      { id: "flowing",       label: "Flowing"       },
    ],
  },
  {
    // Legacy fit-concern vocabulary (V2-D) — stored on pre-Rev 6 profiles.
    id: "fit-concerns-legacy",
    type: "multi",
    title: "Are there any fit issues nAia should keep in mind?",
    options: [
      { id: "petite",             label: "Petite"              },
      { id: "tall",               label: "Tall"                },
      { id: "short-torso",        label: "Short torso"         },
      { id: "long-torso",         label: "Long torso"          },
      { id: "broad-shoulders",    label: "Broad shoulders"     },
      { id: "narrow-shoulders",   label: "Narrow shoulders"    },
      { id: "fuller-bust",        label: "Fuller bust"         },
      { id: "narrow-hips",        label: "Narrow hips"         },
      { id: "arm-fit",            label: "Arm fit"             },
      { id: "thigh-fit",          label: "Thigh fit"           },
    ],
  },
];

/**
 * Every question the app can resolve labels from: live Rev 7 flow + retired ones.
 * Legacy entries are registered first so a live question always wins on ID collision.
 */
export const ALL_QUESTIONS: QuizQuestion[] = [...LEGACY_QUESTIONS, ...quizQuestions];

/**
 * Flat id → label map covering every option the app has ever offered, across all
 * questions. Used for label resolution where the question context is unknown.
 */
export const ALL_OPTION_LABELS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const q of ALL_QUESTIONS) {
    for (const o of q.options ?? []) if (!(o.id in map)) map[o.id] = o.label;
    for (const c of q.colors ?? []) if (!(c.id in map)) map[c.id] = c.name;
  }
  return map;
})();

export type OnboardingAnswers = {
  // Rev 7 onboarding fields
  "current-goal"?: string[];
  "successful-outfit-gives"?: string[];
  "style-expression"?: string[];
  "exploration-level"?: string;
  "style-directions"?: string[];
  lifestyle?: string[];
  "favorite-colors"?: string[];
  "avoid-colors"?: string[];
  silhouette?: string[];
  "fit-concerns"?: string[];
  "fit-concerns-note"?: string;
  "dressing-preferences"?: string[];
  "dressing-requirements-note"?: string;
  "dressing-habits"?: string[];
  // Legacy onboarding fields (no longer in first onboarding; kept for backward compat)
  "style-personalities"?: string[];  // retired at Rev 7 — superseded by style-directions
  "desired-impression"?: string[];
  "desired-feelings"?: string[];
  becoming?: string[];
  "fit-preferences"?: string[];     // legacy — migrated to silhouette via deriveFitMigration
  "wardrobe-disconnection"?: string[];
  "style-support"?: string[];
  "shopping-priorities"?: string[];
  "trend-appetite"?: string;        // single-choice stored as string
  "final-notes"?: string;
  // About You — contextual account/profile information (passport edit only, not onboarding)
  "age-range"?: string;
  "gender"?: string;
  "gender-self-description"?: string;
  // Passport-only fields (section editing only, not in onboarding flow)
  "typical-day"?: string;
  "structure"?: string;
  "coverage-preferences"?: string[];
  "neutral-vs-colour"?: string;
  "colour-intensity"?: string;
  "print-appetite"?: string;
  "body-focus-areas"?: string[];
  "body-avoid-areas"?: string[];
  // V2-D sizing, measurements, proportions & fit
  "sizing-system"?:      string;
  "top-size"?:           string;
  "bottom-size"?:        string;
  "dress-size"?:         string;
  "shoe-sizing-system"?: string;
  "shoe-size"?:          string;
  "height"?:             string;
  "measurement-unit"?:   string;
  "bust-measurement"?:   string;
  "waist-measurement"?:  string;
  "hip-measurement"?:    string;
  "body-shape"?:         string;
  "preferred-coverage"?: string;
};

export function getQuestionByStep(step: number): QuizQuestion | undefined {
  return quizQuestions[step - 1];
}

export function getTotalSteps(): number {
  return quizQuestions.length;
}

// Journey group labels — contiguous grouping that respects the existing question order.
// Group boundaries must remain aligned with the actual question order above.
export const JOURNEY_GROUPS: ReadonlyArray<{ label: string; steps: readonly number[] }> = [
  { label: "WHAT MATTERS TO YOU",      steps: [1, 2, 3, 4]  },
  { label: "YOUR STYLE IN REAL LIFE",  steps: [5, 6, 7, 8]  },
  { label: "WHAT NAIA SHOULD RESPECT", steps: [9, 10, 11]   },
];

export function getGroupLabel(step: number): string {
  const group = JOURNEY_GROUPS.find(g => (g.steps as readonly number[]).includes(step));
  return group?.label ?? "";
}

// Notes to nAia — canonical helper text (outside the numbered flow; always optional).
// "Always considered by nAia" must NOT appear here — downstream use is not guaranteed every time.
export const NOTES_HELPER_TEXT =
  "Tell nAia anything that would help it understand how you actually like to dress — " +
  "preferences, frustrations, changes in your life, or things you want considered.";
