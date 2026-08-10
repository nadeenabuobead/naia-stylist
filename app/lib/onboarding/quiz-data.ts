// app/lib/onboarding/quiz-data.ts

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
}

// Real colour families — used in both favourite and avoid pickers (Screen 8)
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

// V2-B2: 12-screen onboarding sequence
export const quizQuestions: QuizQuestion[] = [

  // SCREEN 1 — STYLE ENERGIES (required)
  {
    id: "style-personalities",
    type: "multi",
    title: "Which style energies feel most like you?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    required: true,
    options: [
      { id: "old-money",         label: "Old Money"          },
      { id: "artsy",             label: "Artsy"              },
      { id: "edgy",              label: "Edgy"               },
      { id: "feminine",          label: "Feminine"           },
      { id: "corporate-chic",    label: "Corporate Chic"     },
      { id: "effortlessly-chic", label: "Effortlessly Chic"  },
      { id: "minimal",           label: "Minimal"            },
      { id: "trendy",            label: "Trendy"             },
      { id: "romantic",          label: "Romantic"           },
      { id: "casual-cool",       label: "Casual Cool"        },
    ],
  },

  // SCREEN 2 — DESIRED IMPRESSION (skippable)
  {
    id: "desired-impression",
    type: "multi",
    title: "How do you want your clothes to introduce you?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      { id: "refined",        label: "I'm refined"            },
      { id: "creative",       label: "I'm creative"           },
      { id: "powerful",       label: "I'm powerful"           },
      { id: "soft-confident", label: "I'm soft but confident" },
      { id: "effortless",     label: "I'm effortless"         },
      { id: "interesting",    label: "I'm interesting"        },
      { id: "feminine",       label: "I'm feminine"           },
      { id: "put-together",   label: "I'm put together"       },
    ],
  },

  // SCREEN 3 — LIFESTYLE (required, max 3)
  // IDs: busy-mom and always-on-the-go are the canonical stored values.
  {
    id: "lifestyle",
    type: "multi",
    title: "Which three settings does your wardrobe serve most often?",
    subtitle: "Pick your top 3",
    maxSelections: 3,
    required: true,
    options: [
      { id: "office",           label: "Office / Corporate Life" },
      { id: "busy-mom",         label: "Family & Caregiving"     },
      { id: "creative",         label: "Creative / Freelance"    },
      { id: "casual-days",      label: "Mostly Casual Days"      },
      { id: "events",           label: "Events & Dinners"        },
      { id: "always-on-the-go", label: "Busy, On-the-Go Days"    },
      { id: "travel",           label: "Travel & Social Plans"   },
      { id: "hybrid",           label: "Hybrid / Remote Work"    },
    ],
  },

  // SCREEN 4 — DESIRED FEELINGS (required)
  {
    id: "desired-feelings",
    type: "multi",
    title: "Most days, I want my clothes to make me feel…",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    required: true,
    options: [
      { id: "confident",    label: "Confident"    },
      { id: "comfortable",  label: "Comfortable"  },
      { id: "put-together", label: "Put Together" },
      { id: "elegant",      label: "Elegant"      },
      { id: "feminine",     label: "Feminine"     },
      { id: "powerful",     label: "Powerful"     },
      { id: "effortless",   label: "Effortless"   },
      { id: "attractive",   label: "Attractive"   },
    ],
  },

  // SCREEN 5 — BECOMING (skippable)
  {
    id: "becoming",
    type: "multi",
    title: "What version of yourself are you dressing for right now?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      { id: "more-confident",  label: "More confident"  },
      { id: "more-polished",   label: "More polished"   },
      { id: "more-feminine",   label: "More feminine"   },
      { id: "more-creative",   label: "More creative"   },
      { id: "more-powerful",   label: "More powerful"   },
      { id: "more-effortless", label: "More effortless" },
      { id: "more-visible",    label: "More visible"    },
      { id: "more-refined",    label: "More refined"    },
      { id: "new-chapter",     label: "A new chapter"   },
    ],
  },

  // SCREEN 6 — SILHOUETTE (skippable; prepopulates B1-migrated values)
  {
    id: "silhouette",
    type: "multi",
    title: "What silhouettes feel most like you?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      { id: "defined-waist", label: "Defined waist"        },
      { id: "straight",      label: "Straight silhouette"  },
      { id: "relaxed",       label: "Relaxed silhouette"   },
      { id: "fitted",        label: "Fitted silhouette"    },
      { id: "oversized",     label: "Oversized silhouette" },
      { id: "flowing",       label: "Flowing silhouette"   },
    ],
  },

  // SCREEN 7 — WARDROBE DISCONNECTION (skippable)
  {
    id: "wardrobe-disconnection",
    type: "multi",
    title: "When do you feel most disconnected from your wardrobe?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "rush",          label: "When I'm getting ready in a rush"                   },
      { id: "body-different",label: "When my body feels different"                       },
      { id: "event",         label: "When I have an event"                               },
      { id: "elevated",      label: "When I want to look elevated but still like myself" },
      { id: "dont-style",    label: "When I buy pieces but don't know how to style them" },
      { id: "mood-mismatch", label: "When my mood doesn't match my clothes"              },
      { id: "too-basic",     label: "When everything feels too basic"                    },
      { id: "new-phase",     label: "When I'm entering a new phase of life"              },
    ],
  },

  // SCREEN 8 — COLOURS: favourite (required) + avoid (optional, same screen)
  // secondaryQuestion renders the avoid-colors picker on the same step.
  {
    id: "favorite-colors",
    type: "color",
    title: "Which colours do you naturally reach for?",
    subtitle: "Choose up to 5",
    maxSelections: 5,
    required: true,
    colors: COLOUR_FAMILIES,
    secondaryQuestion: {
      id: "avoid-colors",
      title: "Any colours you avoid?",
      subtitle: "Optional",
      colors: COLOUR_FAMILIES,
      maxSelections: 5,
    },
  },

  // SCREEN 9 — STYLE SUPPORT (skippable)
  {
    id: "style-support",
    type: "multi",
    title: "What would make getting dressed easier for you?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "style-what-i-own",  label: "Knowing how to style what I already own"  },
      { id: "elevate-wardrobe",  label: "Finding pieces that elevate my wardrobe"  },
      { id: "body-mood",         label: "Dressing better for my body and mood"     },
      { id: "polished-easy",     label: "Looking polished without overthinking"    },
      { id: "statement-pieces",  label: "Styling statement pieces with confidence" },
      { id: "what-suits",        label: "Understanding what suits me"              },
      { id: "event-outfits",     label: "Building outfits for events"              },
      { id: "feel-myself",       label: "Feeling more like myself in clothes"      },
    ],
  },

  // SCREEN 10 — SHOPPING PRIORITIES (skippable; 6 approved options only)
  {
    id: "shopping-priorities",
    type: "multi",
    title: "What matters most when you buy something?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "versatility",     label: "Versatility"      },
      { id: "comfort",         label: "Comfort"          },
      { id: "price",           label: "Price"            },
      { id: "uniqueness",      label: "Uniqueness"       },
      { id: "occasion-impact", label: "Occasion impact"  },
      { id: "trend-relevance", label: "Trend relevance"  },
    ],
  },

  // SCREEN 11 — TREND APPETITE (skippable, single choice)
  {
    id: "trend-appetite",
    type: "single",
    title: "How trend-forward would you like nAia to be?",
    options: [
      { id: "mostly-timeless",   label: "Mostly timeless"                   },
      { id: "timeless-selected", label: "Timeless with selected trends"     },
      { id: "balanced",          label: "A balance of timeless and current" },
      { id: "trend-forward",     label: "Trend-forward"                     },
      { id: "experimental",      label: "Experimental"                      },
    ],
  },

  // SCREEN 12 — FINAL NOTES (optional)
  {
    id: "final-notes",
    type: "text",
    title: "Anything else nAia should know about your style right now?",
    subtitle: "Optional",
    placeholder: "e.g. I'm trying to dress more professionally. I just had a baby. I'm entering a new chapter and want to feel more feminine. I have a wedding in three months.",
    maxLength: 500,
  },
];

export type OnboardingAnswers = {
  "style-personalities"?: string[];
  "desired-impression"?: string[];
  lifestyle?: string[];
  "desired-feelings"?: string[];
  becoming?: string[];
  "fit-preferences"?: string[];     // legacy — no longer in onboarding; kept for B1 migration
  "silhouette"?: string[];
  "wardrobe-disconnection"?: string[];
  "favorite-colors"?: string[];
  "avoid-colors"?: string[];
  "style-support"?: string[];
  "shopping-priorities"?: string[];
  "trend-appetite"?: string;        // single-choice stored as string
  "final-notes"?: string;
  // Passport-only fields (section editing only, not in onboarding flow)
  "typical-day"?: string;
  "structure"?: string;
  "coverage-preferences"?: string[];
  "neutral-vs-colour"?: string;
  "colour-intensity"?: string;
  "print-appetite"?: string;
  // V2-C body-area pickers
  "body-focus-areas"?: string[];
  "body-avoid-areas"?: string[];
  // V2-D sizing, measurements, proportions & fit
  "sizing-system"?:      string;
  "top-size"?:           string;
  "bottom-size"?:        string;
  "dress-size"?:         string;
  "shoe-size"?:          string;
  "height"?:             string;
  "measurement-unit"?:   string;
  "bust-measurement"?:   string;
  "waist-measurement"?:  string;
  "hip-measurement"?:    string;
  "body-shape"?:         string;
  "fit-concerns"?:       string[];
  "preferred-coverage"?: string;
};

export function getQuestionByStep(step: number): QuizQuestion | undefined {
  return quizQuestions[step - 1];
}

export function getTotalSteps(): number {
  return quizQuestions.length;
}
