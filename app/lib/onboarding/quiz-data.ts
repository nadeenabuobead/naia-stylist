// app/lib/onboarding/quiz-data.ts

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
}

export const quizQuestions: QuizQuestion[] = [
  // STEP 1 — STYLE ENERGIES
  {
    id: "style-personalities",
    type: "multi",
    title: "Which style energies feel most like you?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "old-money", label: "Old Money" },
      { id: "artsy", label: "Artsy" },
      { id: "edgy", label: "Edgy" },
      { id: "feminine", label: "Feminine" },
      { id: "corporate-chic", label: "Corporate Chic" },
      { id: "effortlessly-chic", label: "Effortlessly Chic" },
      { id: "minimal", label: "Minimal" },
      { id: "trendy", label: "Trendy" },
      { id: "romantic", label: "Romantic" },
      { id: "casual-cool", label: "Casual Cool" },
    ],
  },

  // STEP 2 — DESIRED IMPRESSION (NEW!)
  {
    id: "desired-impression",
    type: "multi",
    title: "What do you want your clothes to say before you speak?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      { id: "refined", label: "I'm refined" },
      { id: "creative", label: "I'm creative" },
      { id: "powerful", label: "I'm powerful" },
      { id: "soft-confident", label: "I'm soft but confident" },
      { id: "effortless", label: "I'm effortless" },
      { id: "interesting", label: "I'm interesting" },
      { id: "feminine", label: "I'm feminine" },
      { id: "put-together", label: "I'm put together" },
    ],
  },

  // STEP 3 — LIFESTYLE (REWORDED)
  {
    id: "lifestyle",
    type: "multi",
    title: "What does your life usually ask you to dress for?",
    subtitle: "Choose all that apply",
    maxSelections: 10,
    options: [
      { id: "office", label: "Office / Corporate Life" },
      { id: "busy-mom", label: "Busy Mom" },
      { id: "creative", label: "Creative / Freelance" },
      { id: "casual-days", label: "Mostly Casual Days" },
      { id: "events", label: "Events & Dinners" },
      { id: "on-the-go", label: "Always On-The-Go" },
      { id: "travel", label: "Travel & Social Plans" },
      { id: "hybrid", label: "Hybrid / Remote Work" },
    ],
  },

  // STEP 4 — DESIRED FEELINGS (SLIGHTLY REWORDED)
  {
    id: "desired-feelings",
    type: "multi",
    title: "How do you want to feel in your outfits most often?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "confident", label: "Confident" },
      { id: "comfortable", label: "Comfortable" },
      { id: "put-together", label: "Put Together" },
      { id: "elegant", label: "Elegant" },
      { id: "feminine", label: "Feminine" },
      { id: "powerful", label: "Powerful" },
      { id: "effortless", label: "Effortless" },
      { id: "attractive", label: "Attractive" },
    ],
  },

  // STEP 5 — BECOMING QUESTION (NEW!)
  {
    id: "becoming",
    type: "multi",
    title: "What version of yourself are you dressing for right now?",
    subtitle: "Choose up to 2",
    maxSelections: 2,
    options: [
      { id: "more-confident", label: "More confident" },
      { id: "more-polished", label: "More polished" },
      { id: "more-feminine", label: "More feminine" },
      { id: "more-creative", label: "More creative" },
      { id: "more-powerful", label: "More powerful" },
      { id: "more-effortless", label: "More effortless" },
      { id: "more-visible", label: "More visible" },
      { id: "more-refined", label: "More refined" },
      { id: "new-chapter", label: "A new chapter" },
    ],
  },

  // STEP 6 — FIT PREFERENCES
  {
    id: "fit-preferences",
    type: "multi",
    title: "What usually makes you feel best in clothing?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "defined-waist", label: "Defined Waist" },
      { id: "relaxed-fits", label: "Relaxed Fits" },
      { id: "structured", label: "Structured Pieces" },
      { id: "oversized", label: "Oversized Layers" },
      { id: "flowy", label: "Flowy Pieces" },
      { id: "coverage", label: "More Coverage" },
      { id: "fitted", label: "Fitted Looks" },
      { id: "simple", label: "Simple Outfits" },
    ],
  },

  // STEP 7 — WARDROBE DISCONNECTION (REPLACES STRUGGLES)
  {
    id: "wardrobe-disconnection",
    type: "multi",
    title: "When do you feel most disconnected from your wardrobe?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "rush", label: "When I'm getting ready in a rush" },
      { id: "body-different", label: "When my body feels different" },
      { id: "event", label: "When I have an event" },
      { id: "elevated", label: "When I want to look elevated but still like myself" },
      { id: "dont-style", label: "When I buy pieces but don't know how to style them" },
      { id: "mood-mismatch", label: "When my mood doesn't match my clothes" },
      { id: "too-basic", label: "When everything feels too basic" },
      { id: "new-phase", label: "When I'm entering a new phase of life" },
    ],
  },

  // STEP 8 — COLORS (MERGED)
  {
    id: "favorite-colors",
    type: "color",
    title: "Which colors do you naturally reach for?",
    subtitle: "Choose up to 5",
    maxSelections: 5,
    colors: [
      { id: "black", hex: "#000000", name: "Black" },
      { id: "white-cream", hex: "#f5f5dc", name: "White / Cream" },
      { id: "beige-brown", hex: "#c19a6b", name: "Beige / Brown" },
      { id: "grey", hex: "#808080", name: "Grey" },
      { id: "navy", hex: "#1e3a5f", name: "Navy" },
      { id: "red-burgundy", hex: "#722f37", name: "Red / Burgundy" },
      { id: "green", hex: "#2e8b57", name: "Green" },
      { id: "pink", hex: "#e8a0b2", name: "Pink" },
      { id: "prints", hex: "#ffffff", name: "Prints" },
      { id: "colorful", hex: "#ff6b6b", name: "Colorful Pieces" },
    ],
  },

  // STEP 8b — AVOID COLORS (OPTIONAL, SAME STEP)
  {
    id: "avoid-colors",
    type: "color",
    title: "Any colors you avoid?",
    subtitle: "Optional",
    maxSelections: 5,
    colors: [
      { id: "black", hex: "#000000", name: "Black" },
      { id: "white-cream", hex: "#f5f5dc", name: "White / Cream" },
      { id: "beige-brown", hex: "#c19a6b", name: "Beige / Brown" },
      { id: "grey", hex: "#808080", name: "Grey" },
      { id: "navy", hex: "#1e3a5f", name: "Navy" },
      { id: "red-burgundy", hex: "#722f37", name: "Red / Burgundy" },
      { id: "green", hex: "#2e8b57", name: "Green" },
      { id: "pink", hex: "#e8a0b2", name: "Pink" },
      { id: "yellow", hex: "#f4c430", name: "Yellow" },
      { id: "orange", hex: "#e86100", name: "Orange" },
    ],
  },

  // STEP 9 — STYLE SUPPORT (REPLACES HELP WANTED)
  {
    id: "style-support",
    type: "multi",
    title: "What would make getting dressed easier for you?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "style-what-i-own", label: "Knowing how to style what I already own" },
      { id: "elevate-wardrobe", label: "Finding pieces that elevate my wardrobe" },
      { id: "body-mood", label: "Dressing better for my body and mood" },
      { id: "polished-easy", label: "Looking polished without overthinking" },
      { id: "statement-pieces", label: "Styling statement pieces with confidence" },
      { id: "what-suits", label: "Understanding what suits me" },
      { id: "event-outfits", label: "Building outfits for events" },
      { id: "feel-myself", label: "Feeling more like myself in clothes" },
    ],
  },

  // STEP 10 — FINAL NOTES (REWORDED)
  {
    id: "final-notes",
    type: "text",
    title: "Anything else you want nAia to understand about your style?",
    subtitle: "Optional",
    placeholder: "e.g., I'm trying to dress more professionally, I just had a baby, I want to feel more feminine again, I have a wedding coming up, I'm entering a new chapter...",
    maxLength: 500,
  },
];

export type OnboardingAnswers = {
  "style-personalities"?: string[];
  "desired-impression"?: string[];
  lifestyle?: string[];
  "desired-feelings"?: string[];
  becoming?: string[];
  "fit-preferences"?: string[];
  "wardrobe-disconnection"?: string[];
  "favorite-colors"?: string[];
  "avoid-colors"?: string[];
  "style-support"?: string[];
  "final-notes"?: string;
};

export function getQuestionByStep(step: number): QuizQuestion | undefined {
  return quizQuestions[step - 1];
}

export function getTotalSteps(): number {
  return quizQuestions.length;
}
