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
    imageUrl?: string;
  }>;
  colors?: Array<{ id: string; hex: string; name: string }>;
  maxSelections?: number;
  maxLength?: number;
  placeholder?: string;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
}

export const quizQuestions: QuizQuestion[] = [
  // Step 1: Welcome / Style Personality
  {
    id: "style-personality",
    type: "single",
    title: "How would you describe your style?",
    subtitle: "Pick the one that feels most like you",
    options: [
      { id: "classic", label: "Classic & Timeless", emoji: "🎩", description: "Clean lines, neutral colors, quality pieces" },
      { id: "bohemian", label: "Bohemian & Free", emoji: "🌻", description: "Flowy fabrics, earthy tones, artistic vibes" },
      { id: "minimalist", label: "Minimalist & Modern", emoji: "○", description: "Simple, clean, less is more" },
      { id: "romantic", label: "Romantic & Feminine", emoji: "🌸", description: "Soft colors, delicate details, florals" },
      { id: "edgy", label: "Edgy & Bold", emoji: "⚡", description: "Dark colors, leather, statement pieces" },
      { id: "trendy", label: "Trendy & Fashion-Forward", emoji: "✨", description: "Latest styles, love experimenting" },
    ],
  },

  // Step 2: Lifestyle
  {
    id: "lifestyle",
    type: "single",
    title: "What does a typical day look like for you?",
    subtitle: "This helps me suggest practical outfits",
    options: [
      { id: "office", label: "Office / Corporate", emoji: "💼", description: "Professional environment" },
      { id: "creative", label: "Creative / Casual workplace", emoji: "🎨", description: "Relaxed dress code" },
      { id: "wfh", label: "Work from home", emoji: "🏠", description: "Comfort meets video calls" },
      { id: "active", label: "Always on the go", emoji: "🏃‍♀️", description: "Need versatile, comfy pieces" },
      { id: "social", label: "Social butterfly", emoji: "🦋", description: "Lots of events and outings" },
      { id: "mom", label: "Busy mom life", emoji: "👩‍👧", description: "Practical but still stylish" },
    ],
  },

  // Step 3: Mood & Feelings
  {
    id: "mood-feelings",
    type: "multi",
    title: "How do you want to FEEL in your clothes?",
    subtitle: "Pick up to 3",
    maxSelections: 3,
    options: [
      { id: "confident", label: "Confident", emoji: "💪" },
      { id: "comfortable", label: "Comfortable", emoji: "☁️" },
      { id: "powerful", label: "Powerful", emoji: "👑" },
      { id: "feminine", label: "Feminine", emoji: "🌸" },
      { id: "creative", label: "Creative", emoji: "🎨" },
      { id: "elegant", label: "Elegant", emoji: "💎" },
      { id: "playful", label: "Playful", emoji: "🎀" },
      { id: "sophisticated", label: "Sophisticated", emoji: "✨" },
    ],
  },

  // Step 4: Style Struggles
  {
    id: "struggles",
    type: "multi",
    title: "What are your biggest style struggles?",
    subtitle: "Select all that apply — no judgment here!",
    maxSelections: 5,
    options: [
      { id: "nothing-to-wear", label: "\"Nothing to wear\" syndrome", emoji: "😩" },
      { id: "body-confidence", label: "Finding clothes that flatter my body", emoji: "🪞" },
      { id: "outfit-combining", label: "Putting outfits together", emoji: "🧩" },
      { id: "overdressed", label: "Feeling overdressed or underdressed", emoji: "😬" },
      { id: "trends", label: "Keeping up with trends", emoji: "📱" },
      { id: "budget", label: "Building a wardrobe on a budget", emoji: "💰" },
      { id: "comfort-style", label: "Balancing comfort and style", emoji: "⚖️" },
      { id: "colors", label: "Knowing which colors suit me", emoji: "🎨" },
    ],
  },

  // Step 5: Color Preferences
  {
    id: "colors",
    type: "color",
    title: "Which colors do you love wearing?",
    subtitle: "Pick your top 5 favorites",
    maxSelections: 5,
    colors: [
      { id: "black", hex: "#1a1a1a", name: "Black" },
      { id: "white", hex: "#ffffff", name: "White" },
      { id: "navy", hex: "#1e3a5f", name: "Navy" },
      { id: "beige", hex: "#d4c4a8", name: "Beige" },
      { id: "brown", hex: "#8b5a2b", name: "Brown" },
      { id: "gray", hex: "#808080", name: "Gray" },
      { id: "red", hex: "#c41e3a", name: "Red" },
      { id: "pink", hex: "#e8a0b2", name: "Pink" },
      { id: "blush", hex: "#f4c2c2", name: "Blush" },
      { id: "burgundy", hex: "#722f37", name: "Burgundy" },
      { id: "orange", hex: "#e86100", name: "Orange" },
      { id: "yellow", hex: "#f4c430", name: "Yellow" },
      { id: "green", hex: "#2e8b57", name: "Green" },
      { id: "olive", hex: "#6b8e23", name: "Olive" },
      { id: "teal", hex: "#008080", name: "Teal" },
      { id: "blue", hex: "#4169e1", name: "Blue" },
      { id: "purple", hex: "#7851a9", name: "Purple" },
      { id: "lavender", hex: "#b57edc", name: "Lavender" },
    ],
  },

  // Step 6: Colors to Avoid
  {
    id: "avoid-colors",
    type: "color",
    title: "Any colors you avoid?",
    subtitle: "Pick colors you rarely or never wear (optional)",
    maxSelections: 5,
    colors: [
      { id: "black", hex: "#1a1a1a", name: "Black" },
      { id: "white", hex: "#ffffff", name: "White" },
      { id: "navy", hex: "#1e3a5f", name: "Navy" },
      { id: "beige", hex: "#d4c4a8", name: "Beige" },
      { id: "brown", hex: "#8b5a2b", name: "Brown" },
      { id: "gray", hex: "#808080", name: "Gray" },
      { id: "red", hex: "#c41e3a", name: "Red" },
      { id: "pink", hex: "#e8a0b2", name: "Pink" },
      { id: "orange", hex: "#e86100", name: "Orange" },
      { id: "yellow", hex: "#f4c430", name: "Yellow" },
      { id: "green", hex: "#2e8b57", name: "Green" },
      { id: "purple", hex: "#7851a9", name: "Purple" },
      { id: "neon", hex: "#39ff14", name: "Neon" },
    ],
  },

  // Step 7: Body Type / Fit Preferences
  {
    id: "fit-preferences",
    type: "multi",
    title: "What fits make you feel best?",
    subtitle: "Select all that apply",
    maxSelections: 4,
    options: [
      { id: "fitted", label: "Fitted & tailored", emoji: "📐" },
      { id: "relaxed", label: "Relaxed & flowy", emoji: "🌊" },
      { id: "oversized", label: "Oversized & cozy", emoji: "🧸" },
      { id: "high-waisted", label: "High-waisted bottoms", emoji: "⬆️" },
      { id: "midi", label: "Midi lengths", emoji: "📏" },
      { id: "mini", label: "Mini lengths", emoji: "✂️" },
      { id: "maxi", label: "Maxi lengths", emoji: "👗" },
      { id: "structured", label: "Structured pieces", emoji: "🔲" },
    ],
  },

  // Step 8: Budget
  {
    id: "budget",
    type: "single",
    title: "What's your typical budget for a single piece?",
    subtitle: "This helps me make realistic suggestions",
    options: [
      { id: "budget", label: "Budget-friendly", emoji: "💚", description: "Under $50" },
      { id: "mid", label: "Mid-range", emoji: "💛", description: "$50 - $150" },
      { id: "investment", label: "Investment pieces", emoji: "🧡", description: "$150 - $300" },
      { id: "luxury", label: "Luxury", emoji: "💎", description: "$300+" },
      { id: "mix", label: "Mix of all", emoji: "🌈", description: "Depends on the piece" },
    ],
  },

  // Step 9: What help do you want?
  {
    id: "help-wanted",
    type: "multi",
    title: "What would help you most?",
    subtitle: "Select all that excite you",
    maxSelections: 5,
    options: [
      { id: "daily-outfits", label: "Daily outfit ideas", emoji: "👗" },
      { id: "closet-organize", label: "Organizing my closet", emoji: "🗄️" },
      { id: "shopping-guide", label: "Smart shopping guidance", emoji: "🛍️" },
      { id: "occasion-styling", label: "Styling for occasions", emoji: "🎉" },
      { id: "capsule", label: "Building a capsule wardrobe", emoji: "💊" },
      { id: "trends", label: "Understanding trends", emoji: "📈" },
      { id: "confidence", label: "Boosting my confidence", emoji: "💪" },
      { id: "color-advice", label: "Color & pattern advice", emoji: "🎨" },
    ],
  },

  // Step 10: Anything else?
  {
    id: "final-thoughts",
    type: "text",
    title: "Anything else I should know?",
    subtitle: "Share your style goals, frustrations, or anything that would help me style you better",
    placeholder: "e.g., I have a wedding coming up, I'm trying to dress more professionally, I just had a baby and nothing fits...",
    maxLength: 500,
  },
];

export type OnboardingAnswers = {
  "style-personality"?: string;
  lifestyle?: string;
  "mood-feelings"?: string[];
  struggles?: string[];
  colors?: string[];
  "avoid-colors"?: string[];
  "fit-preferences"?: string[];
  budget?: string;
  "help-wanted"?: string[];
  "final-thoughts"?: string;
};

export function getQuestionByStep(step: number): QuizQuestion | undefined {
  return quizQuestions[step - 1];
}

export function getTotalSteps(): number {
  return quizQuestions.length;
}
