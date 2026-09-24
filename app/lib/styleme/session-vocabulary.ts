// app/lib/styleme/session-vocabulary.ts
//
// SINGLE SOURCE OF TRUTH for the customer-facing StyleMe questionnaire vocabulary
// (Rev 3 screens 1–3: State, Intention, Fit / Comfort).
//
// WHY THIS FILE EXISTS
// -------------------
// The option lists used to be copy-pasted into four places — the three screen
// route files, result.tsx (the session summary) and styleme-result.server.ts
// (the model prompt). They drifted: state.tsx showed "I feel like I need a
// reset" while result.tsx showed "I want a reset" for the same stored ID.
// Everything now reads from here.
//
// ARCHITECTURAL CONTRACT
// ----------------------
// 1. IDs are the stable internal signal. They are persisted to the session
//    cookie and to StylingSession rows, and they are what every scoring path
//    keys off. IDs MUST NOT change for copy reasons.
// 2. Labels are display copy only. No ranking, gating, normalization or
//    eligibility logic may parse a label string. If you need behaviour, branch
//    on the ID.
// 3. STATE and INTENTION are DISTINCT dimensions. A State is how the customer
//    is arriving; an Intention is what they explicitly asked the outfit to do.
//    State carries zero ranking weight (see ANSWER_OPTIONS in signal-contract.ts)
//    and must never be translated into an intention ID, a garment field, an
//    emotion tag or a body-need signal.
// 4. The 12 intention IDs are the approved garment taxonomy, mirrored by
//    INTENTION_IDS in app/lib/admin/styleme-garment-profile.vocab.ts and by the
//    approved GarmentStyleMeProfile.intentionPotentials records. Adding or
//    renaming one is a taxonomy expansion, not a copy change.
//
// Labels are written in natural casing. The .sm-pill style applies
// `text-transform: uppercase`, so the screens render them in caps.

export interface StyleMeOption {
  /** Stable internal signal. Persisted and scored. Never change for copy. */
  id: string;
  /** Customer-facing display copy. Never used for logic. */
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — State: "How are you feeling today?"  (single select)
// ─────────────────────────────────────────────────────────────────────────────
// Ordered positive-first so the screen reads as "tell nAia where you are today"
// rather than "what is wrong today?". The four `feel-confident` / `feel-energised`
// / `feel-calm` / `feel-social` entries are STATES, not intentions:
//   - feel-confident  is NOT the `confidence` intention
//   - feel-energised  is NOT the `give-energy` intention
//   - feel-calm       is NOT the `feel-softer` intention
// They contextualise nAia's tone and may act as a tie-break only. They never
// override an explicitly selected intention, occasion, formality or body need.

export const STYLEME_STATE_OPTIONS: readonly StyleMeOption[] = [
  { id: "feel-good",                label: "I feel good" },
  { id: "feel-confident",           label: "I feel confident" },
  { id: "feel-energised",           label: "I feel energised" },
  { id: "feel-calm",                label: "I feel calm" },
  { id: "feel-social",              label: "I feel excited / social" },
  { id: "nothing-in-particular",    label: "I feel pretty neutral" },
  { id: "want-reset",               label: "I feel like I need a reset" },
  { id: "low-energy",               label: "Low-energy" },
  { id: "stressed-overloaded",      label: "Stressed / overloaded" },
  { id: "not-feeling-like-myself",  label: "I don't really feel like myself" },
  { id: "physically-uncomfortable", label: "Physically uncomfortable" },
  { id: "self-conscious",           label: "Self-conscious" },
  { id: "going-through-change",     label: "I'm going through something" },
  { id: "other",                    label: "Other" },
] as const;

/** State IDs added in the 2026-09 positive-rebalance. Zero ranking weight. */
export const STYLEME_POSITIVE_STATE_IDS: readonly string[] = [
  "feel-confident",
  "feel-energised",
  "feel-calm",
  "feel-social",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Intention: "What do you want your clothes to do today?"  (max 2)
// ─────────────────────────────────────────────────────────────────────────────
// EXACTLY the 12 approved intention IDs. Labels are display copy; the IDs below
// are what every approved GarmentStyleMeProfile.intentionPotentials record is
// keyed by. Changing a label requires NO garment retagging.

export const STYLEME_INTENTION_OPTIONS: readonly StyleMeOption[] = [
  { id: "feel-like-myself",   label: "Help me feel like myself" },
  { id: "confidence",         label: "Help me feel confident" },
  { id: "ground-me",          label: "Ground me" },
  { id: "give-structure",     label: "Give me structure" },
  { id: "make-it-easy",       label: "Make things feel easy" },
  { id: "feel-put-together",  label: "Help me feel put together" },
  { id: "feel-attractive",    label: "Make me feel attractive" },
  { id: "give-energy",        label: "Bring some energy" },
  { id: "feel-softer",        label: "Help me feel softer" },
  { id: "feel-sharper",       label: "Help me feel sharper" },
  { id: "feel-less-exposed",  label: "Help me feel less exposed" },
  { id: "express-myself",     label: "Let me express myself" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Fit / Comfort: "Any fit or comfort preferences today?"  (max 2)
// ─────────────────────────────────────────────────────────────────────────────
// Labels are phrased as styling preferences rather than symptoms. The IDs and
// their QA-tested semantics are unchanged:
//   nothing-tight-waist   → soft-and-forgiving-around-waist (normalized)
//   less-body-conscious   → relaxed (normalized)
//   loose-comfortable     → relaxed (normalized), first-class body need (RC-T5)
// `nothing-specific` is exclusive with every other option.

export const STYLEME_FIT_COMFORT_OPTIONS: readonly StyleMeOption[] = [
  { id: "nothing-tight-waist",   label: "More room around my waist" },
  { id: "less-body-conscious",   label: "A little more ease through the body" },
  { id: "more-coverage",         label: "More coverage" },
  { id: "softer-easier-fabrics", label: "Soft / easy fabrics" },
  { id: "loose-comfortable",     label: "Loose and comfortable" },
  { id: "still-want-shape",      label: "Keep some shape" },
  { id: "waist-definition",      label: "Waist definition" },
  { id: "structured-shape",      label: "More structure / definition" },
  { id: "nothing-specific",      label: "No specific preference" },
] as const;

/** The Fit / Comfort option that clears every other selection. */
export const STYLEME_FIT_COMFORT_EXCLUSIVE_ID = "nothing-specific";

// ─────────────────────────────────────────────────────────────────────────────
// Derived lookups — never hand-maintain a parallel Record.
// ─────────────────────────────────────────────────────────────────────────────

function toLabelMap(options: readonly StyleMeOption[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.id, o.label]));
}

export const STYLEME_STATE_LABELS       = toLabelMap(STYLEME_STATE_OPTIONS);
export const STYLEME_INTENTION_LABELS   = toLabelMap(STYLEME_INTENTION_OPTIONS);
export const STYLEME_FIT_COMFORT_LABELS = toLabelMap(STYLEME_FIT_COMFORT_OPTIONS);

export const STYLEME_STATE_IDS       = STYLEME_STATE_OPTIONS.map((o) => o.id);
export const STYLEME_INTENTION_IDS   = STYLEME_INTENTION_OPTIONS.map((o) => o.id);
export const STYLEME_FIT_COMFORT_IDS = STYLEME_FIT_COMFORT_OPTIONS.map((o) => o.id);
