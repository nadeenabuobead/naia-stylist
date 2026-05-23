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
  // STEP 1 — YOUR STYLE
  {
    id: "style-personalities",
    type: "multi",
    title: "Which styles feel most like you?",
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

  // STEP 2 — YOUR LIFESTYLE
  {
    id: "lifestyle",
    type: "multi",
    title: "What does your day-to-day usually look like?",
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

  // STEP 3 — HOW DO YOU WANT TO FEEL?
  {
    id: "desired-feelings",
    type: "multi",
    title: "How do you want your outfits to make you feel?",
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

  // STEP 4 — WHAT DO YOU FEEL BEST IN?
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

  // STEP 5 — COLORS
  {
    id: "favorite-colors",
    type: "color",
    title: "Which colors do you wear the most?",
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

  // STEP 5b — COLORS TO AVOID (optional)
  {
    id: "avoid-colors",
    type: "color",
    title: "Any colors you usually avoid?",
    subtitle: "Optional — select colors you rarely wear",
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

  // STEP 6 — STYLE STRUGGLES
  {
    id: "struggles",
    type: "multi",
    title: "What do you struggle with most?",
    subtitle: "Choose up to 3",
    maxSelections: 3,
    options: [
      { id: "nothing-to-wear", label: "I have clothes but nothing to wear" },
      { id: "repeat-outfits", label: "I repeat the same outfits" },
      { id: "more-elevated", label: "I want to look more elevated" },
      { id: "statement-pieces", label: "I don't know how to style statement pieces" },
      { id: "body-dressing", label: "I struggle dressing for my body sometimes" },
      { id: "disconnected", label: "My wardrobe feels disconnected" },
      { id: "effortless", label: "I want more effortless outfits" },
      { id: "confidence", label: "I want to feel more confident" },
    ],
  },

  // STEP 7 — WHAT DO YOU WANT HELP WITH?
  {
    id: "help-wanted",
    type: "multi",
    title: "What would you like nAia to help you with?",
    subtitle: "Choose all that apply",
    maxSelections: 8,
    options: [
      { id: "styling-wardrobe", label: "Styling my wardrobe" },
      { id: "styling-naia", label: "Styling nAia pieces" },
      { id: "outfit-recs", label: "Outfit recommendations" },
      { id: "discover-style", label: "Discovering my style" },
      { id: "buy-skip", label: "Buy or Skip recommendations" },
      { id: "trend-reports", label: "Personalized trend reports" },
      { id: "better-outfits", label: "Building better outfits" },
      { id: "confidence", label: "Feeling more confident in what I wear" },
    ],
  },

  // FINAL STEP — ANYTHING ELSE
  {
    id: "final-notes",
    type: "text",
    title: "Anything else you want nAia to know about your style?",
    subtitle: "Optional",
    placeholder: "e.g., I have a wedding coming up, I'm trying to dress more professionally, I just had a baby...",
    maxLength: 500,
  },
];

export type OnboardingAnswers = {
  "style-personalities"?: string[];
  lifestyle?: string[];
  "desired-feelings"?: string[];
  "fit-preferences"?: string[];
  "favorite-colors"?: string[];
  "avoid-colors"?: string[];
  struggles?: string[];
  "help-wanted"?: string[];
  "final-notes"?: string;
};

export function getQuestionByStep(step: number): QuizQuestion | undefined {
  return quizQuestions[step - 1];
}

export function getTotalSteps(): number {
  return quizQuestions.length;
}
