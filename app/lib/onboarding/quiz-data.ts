// app/lib/onboarding/quiz-data.ts
// Passport Rev 6 — 8-screen onboarding (target 3–5 min)

export interface SecondaryColorQuestion {
  id: string;
  title: string;
  subtitle?: string;
  colors: Array<{ id: string; hex: string; name: string }>;
  maxSelections: number;
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
  }>;
  colors?: Array<{ id: string; hex: string; name: string }>;
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

// Canonical colour families — shared by favourite and avoid pickers (Screen 5)
export const COLOUR_FAMILIES: Array<{ id: string; hex: string; name: string }> = [
  { id: "black",        hex: "#000000", name: "Black"          },
  { id: "white-cream",  hex: "#f5f5dc", name: "White / Cream"  },
  { id: "beige-brown",  hex: "#c19a6b", name: "Beige / Brown"  },
  { id: "grey",         hex: "#808080", name: "Grey"           },
  { id: "navy",         hex: "#1e3a5f", name: "Navy"           },
  { id: "red-burgundy", hex: "#722f37", name: "Red / Burgundy" },
  { id: "green",        hex: "#2e8b57", name: "Green"          },
  { id: "pink",         hex: "#e8a0b2", name: "Pink"           },
  { id: "yellow",       hex: "#f4c430", name: "Yellow"         },
  { id: "orange",       hex: "#e86100", name: "Orange"         },
];

// Rev 6 — 8-screen first-onboarding sequence
export const quizQuestions: QuizQuestion[] = [

  // SCREEN 1 — CURRENT GOAL (mutable context; never scored)
  {
    id: "current-goal",
    type: "multi",
    title: "What would you most like nAia to help you with right now?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    exclusiveIds: ["not-sure-yet"],
    options: [
      { id: "understand-my-style",    label: "Understand my personal style"          },
      { id: "feel-more-like-myself",  label: "Feel more like myself in what I wear"  },
      { id: "use-what-i-own",         label: "Get more from what I already own"      },
      { id: "easier-getting-dressed", label: "Make getting dressed easier"            },
      { id: "stop-regret-purchases",  label: "Stop buying things I never wear"       },
      { id: "more-cohesive-wardrobe", label: "Build a more cohesive wardrobe"        },
      { id: "dress-for-my-life",      label: "Dress better for my actual life"       },
      { id: "refresh-my-style",       label: "Refresh my style"                      },
      { id: "specific-event-trip-change", label: "Dress for a specific event or change" },
      { id: "not-sure-yet",           label: "Not sure yet"                          },
    ],
  },

  // SCREEN 2 — STYLE (V3 archetypes only)
  {
    id: "style-personalities",
    type: "multi",
    title: "Which styles currently feel most like you?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      { id: "classic-polished",     label: "Classic & Polished"     },
      { id: "feminine-romantic",    label: "Feminine & Romantic"    },
      { id: "minimal-relaxed",      label: "Minimal & Relaxed"      },
      { id: "bold-edgy",            label: "Bold & Edgy"            },
      { id: "creative-expressive",  label: "Creative & Expressive"  },
    ],
  },

  // SCREEN 3 — SUCCESSFUL OUTFIT GIVES (standing; future Style Memory input)
  {
    id: "successful-outfit-gives",
    type: "multi",
    title: "What makes an outfit feel right for you?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    exclusiveIds: ["not-sure"],
    options: [
      { id: "feel-like-myself",   label: "I feel completely like myself"   },
      { id: "confidence",         label: "Confidence"                       },
      { id: "feel-put-together",  label: "I feel put-together"             },
      { id: "comfort-ease",       label: "Comfort and ease of movement"    },
      { id: "sense-of-expression",label: "A sense of creative expression"  },
      { id: "feel-attractive",    label: "I feel attractive"               },
      { id: "sense-of-power",     label: "A sense of power"               },
      { id: "effortlessness",     label: "Effortlessness"                  },
      { id: "not-sure",           label: "I'm not sure yet"                },
    ],
  },

  // SCREEN 4 — LIFESTYLE (V3 IDs)
  {
    id: "lifestyle",
    type: "multi",
    title: "What do you dress for most often?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "work-office",              label: "Work / Office"                },
      { id: "everyday-casual",          label: "Everyday Casual"             },
      { id: "dinners-going-out",        label: "Dinners & Going Out"         },
      { id: "events-special-occasions", label: "Events & Special Occasions"  },
      { id: "family-parenting",         label: "Family & Parenting"          },
      { id: "travel",                   label: "Travel"                      },
      { id: "active-busy-days",         label: "Active & Busy Days"          },
    ],
  },

  // SCREEN 5 — COLOURS (favourite required, avoid optional — same screen)
  {
    id: "favorite-colors",
    type: "color",
    title: "Which colours do you love wearing?",
    subtitle: "Choose up to 5",
    maxSelections: 5,
    colors: COLOUR_FAMILIES,
    secondaryQuestion: {
      id: "avoid-colors",
      title: "Any colours you usually avoid?",
      subtitle: "Optional",
      colors: COLOUR_FAMILIES,
      maxSelections: 5,
    },
  },

  // SCREEN 6 — SILHOUETTE (V3 IDs; not-sure exclusive)
  {
    id: "silhouette",
    type: "multi",
    title: "Which silhouettes do you usually feel best in?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    exclusiveIds: ["not-sure"],
    options: [
      { id: "fitted",             label: "Fitted"               },
      { id: "waist-defined",      label: "Waist-defined"        },
      { id: "straight-simple",    label: "Straight-cut"         },
      { id: "relaxed",            label: "Relaxed"              },
      { id: "oversized",          label: "Oversized"            },
      { id: "boxy",               label: "Boxy"                 },
      { id: "tapered",            label: "Tapered"              },
      { id: "loose-flowing",      label: "Loose / Wide"         },
      { id: "structured-tailored",label: "Structured / Tailored"},
      { id: "not-sure",           label: "Not sure yet"         },
    ],
  },

  // SCREEN 7 — FIT CONCERNS (max 5 normal; no-fit-problems exclusive; other reveals note)
  {
    id: "fit-concerns",
    type: "multi",
    title: "Are there any fit issues nAia should keep in mind?",
    subtitle: "Choose up to 5",
    maxSelections: 5,
    exclusiveIds: ["no-fit-problems"],
    noteField: {
      triggerId: "other",
      id: "fit-concerns-note",
      placeholder: "Anything you'd like us to know?",
      maxLength: 500,
    },
    options: [
      { id: "tops-pull-bust",        label: "Tops, shirts or jackets can feel tight across my chest / back" },
      { id: "waistbands-gape",       label: "Waistbands often gape"                                          },
      { id: "tight-hips-thighs",     label: "Trousers can feel tight through my seat, hips or thighs"       },
      { id: "uncomfortable-rise",    label: "Trouser rises can feel uncomfortable"              },
      { id: "shoulder-sleeve-fit",   label: "Shoulder or sleeve fit can be difficult"           },
      { id: "often-too-short",       label: "Clothes are often too short"                      },
      { id: "often-too-long",        label: "Clothes are often too long"                       },
      { id: "less-cling-midsection", label: "I prefer less cling around my midsection"         },
      { id: "shoe-width-comfort",    label: "Shoe width / comfort can be difficult"             },
      { id: "size-changes",          label: "My size changes"                                   },
      { id: "no-fit-problems",       label: "I don't usually have fit problems"                 },
      { id: "other",                 label: "Something else"                                    },
    ],
  },

  // SCREEN 8 — DRESSING REQUIREMENTS (feeds Group 2 hard-exclusion engine)
  {
    id: "dressing-preferences",
    type: "multi",
    title: "Are there any dressing requirements nAia should always respect?",
    subtitle: "Optional. Select anything nAia should always keep in mind when styling you.",
    exclusiveIds: ["no-dressing-requirements"],
    options: [
      { id: "dresses-modestly",             label: "I dress modestly"                      },
      { id: "usually-wears-abayas",         label: "I usually wear abayas"                },
      { id: "kanduras-thobes",              label: "I usually wear kanduras / thobes"      },
      { id: "wears-hijab",                  label: "I wear hijab"                          },
      { id: "arms-covered",                 label: "I keep my arms covered"                },
      { id: "avoid-sleeveless",             label: "I avoid sleeveless styles"             },
      { id: "chest-neckline-covered",       label: "I keep my chest / neckline covered"    },
      { id: "prefer-higher-necklines",      label: "I prefer higher necklines"             },
      { id: "legs-covered",                 label: "I keep my legs covered"                },
      { id: "prefer-full-length-trousers",  label: "I prefer full-length trousers"         },
      { id: "avoid-shorts",                 label: "I avoid shorts"                        },
      { id: "longer-tops",                  label: "I prefer longer tops / shirts"         },
      { id: "no-cropped-tops",              label: "I avoid cropped tops"                  },
      { id: "looser-fitting",               label: "I prefer looser-fitting clothes"       },
      { id: "no-dressing-requirements",     label: "No specific dressing requirements"     },
    ],
  },
];

export type OnboardingAnswers = {
  // Rev 6 onboarding fields
  "current-goal"?: string[];
  "style-personalities"?: string[];
  "successful-outfit-gives"?: string[];
  lifestyle?: string[];
  "favorite-colors"?: string[];
  "avoid-colors"?: string[];
  silhouette?: string[];
  "fit-concerns"?: string[];
  "fit-concerns-note"?: string;
  "dressing-preferences"?: string[];
  // Legacy onboarding fields (no longer in first onboarding; kept for backward compat)
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
  { label: "WHAT MATTERS TO YOU",      steps: [1, 2, 3] },
  { label: "YOUR STYLE IN REAL LIFE",  steps: [4, 5, 6] },
  { label: "WHAT NAIA SHOULD RESPECT", steps: [7, 8]    },
];

export function getGroupLabel(step: number): string {
  const group = JOURNEY_GROUPS.find(g => (g.steps as readonly number[]).includes(step));
  return group?.label ?? "";
}

// Notes to nAia — canonical helper text (outside the 8-step flow; always optional).
// "Always considered by nAia" must NOT appear here — downstream use is not guaranteed every time.
export const NOTES_HELPER_TEXT =
  "Tell nAia anything that would help it understand how you actually like to dress — " +
  "preferences, frustrations, changes in your life, or things you want considered.";
