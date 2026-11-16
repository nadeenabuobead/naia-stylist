// app/lib/quick-style/insight.ts
//
// Pure, deterministic style-direction logic for the public /quick-style guest
// teaser. No AI provider call, no database, no session — same three answers
// always produce the same text. This is intentionally a separate, lightweight
// vocabulary from canonical StyleMe Rev 3 (app/lib/styleme/session-vocabulary.ts):
// a teaser is not a styling engine and must not be mistaken for one.

export interface QuickStyleOption {
  id: string;
  label: string;
}

export const moodOpts: QuickStyleOption[] = [
  { id: "confident", label: "I feel confident" },
  { id: "playful", label: "I feel playful" },
  { id: "romantic", label: "I feel romantic" },
  { id: "powerful", label: "I feel powerful" },
  { id: "feel-good", label: "I feel good, I just need styling" },
  { id: "need-reset", label: "I feel like I need a reset" },
  { id: "tired", label: "I feel tired" },
  { id: "low-energy", label: "I feel low-energy" },
  { id: "feeling-low", label: "I'm feeling low" },
  { id: "overwhelmed", label: "I feel overwhelmed" },
  { id: "self-conscious", label: "I feel self-conscious" },
  { id: "neutral", label: "I feel neutral — just need an outfit" },
];

export const occasionOpts: QuickStyleOption[] = [
  { id: "everyday", label: "Everyday / casual plans" },
  { id: "work", label: "Work / meetings" },
  { id: "dinner", label: "Dinner" },
  { id: "date-night", label: "Date night" },
  { id: "evening-out", label: "Evening out" },
  { id: "family", label: "Family gathering" },
  { id: "special-event", label: "Special event" },
  { id: "travel", label: "Travel day" },
  { id: "not-sure", label: "I'm not sure yet" },
];

export const feelingOpts: QuickStyleOption[] = [
  { id: "more-confident", label: "Make me feel more confident" },
  { id: "more-put-together", label: "Make me feel more put together" },
  { id: "softer", label: "Make me feel softer" },
  { id: "more-powerful", label: "Make me feel more powerful" },
  { id: "more-feminine", label: "Make me feel more feminine" },
  { id: "more-effortless", label: "Make me feel more effortless" },
  { id: "more-elevated", label: "Make me feel more elevated" },
  { id: "more-attractive", label: "Make me feel more attractive" },
  { id: "like-myself", label: "Make me feel like myself again" },
];

const MOOD_DIRECTION: Record<string, string> = {
  confident: "strong, clean lines that let your presence lead",
  playful: "a touch of unexpected color or texture",
  romantic: "soft fabrics and flowing shapes",
  powerful: "sharp tailoring and structured shoulders",
  "feel-good": "whatever feels effortless and easy to move in",
  "need-reset": "simple, grounding pieces with no fuss",
  tired: "soft, low-maintenance layers that still look pulled together",
  "low-energy": "one easy, forgiving silhouette you don't have to think about",
  "feeling-low": "something warm and familiar that feels like comfort",
  overwhelmed: "fewer pieces and fewer decisions — one simple silhouette",
  "self-conscious": "structure and coverage exactly where you want it",
  neutral: "a clean, classic base you can build on",
};

const OCCASION_CONTEXT: Record<string, string> = {
  everyday: "easy to move through your day in",
  work: "polished enough for a meeting but still comfortable",
  dinner: "elevated without trying too hard",
  "date-night": "a little more intentional, a little more you",
  "evening-out": "fun, with room to move",
  family: "relaxed but still put-together",
  "special-event": "a statement, but one that's still wearable",
  travel: "comfortable first, styled second",
  "not-sure": "versatile enough to work for whatever comes up",
};

const FEELING_LEVER: Record<string, string> = {
  "more-confident": "pick the one piece that makes you stand taller, and build the rest around it",
  "more-put-together": "add one structured piece — a blazer or a tailored trouser — to anchor everything else",
  softer: "swap one hard edge for something fluid, like a softer fabric or a rounder silhouette",
  "more-powerful": "go for a stronger shoulder or a bolder silhouette than you'd normally reach for",
  "more-feminine": "bring in one soft detail, like a draped neckline or a fluid skirt",
  "more-effortless": "choose the version that needs the least adjusting once it's on",
  "more-elevated": "upgrade one basic into a better fabric or a sharper cut",
  "more-attractive": "pick the silhouette that makes you want to stand up a little straighter",
  "like-myself": "go back to the piece you already know makes you feel like you",
};

export interface QuickStyleAnswers {
  mood: string;
  occasion: string;
  feeling: string;
}

// Deterministic by construction: every branch is a plain object lookup, no
// randomness, no clock, no external call. The same three ids always produce
// the exact same string.
export function buildStyleDirection(answers: QuickStyleAnswers): string {
  const moodPhrase = MOOD_DIRECTION[answers.mood];
  const occasionPhrase = OCCASION_CONTEXT[answers.occasion];
  const feelingPhrase = FEELING_LEVER[answers.feeling];

  if (!moodPhrase || !occasionPhrase || !feelingPhrase) {
    throw new Error("buildStyleDirection: unrecognized mood, occasion, or feeling id");
  }

  return `Today's direction: lean into ${moodPhrase}. Keep it ${occasionPhrase}. And to help you feel the way you want to feel, ${feelingPhrase}.`;
}
