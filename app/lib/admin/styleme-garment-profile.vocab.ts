// app/lib/admin/styleme-garment-profile.vocab.ts
//
// Vocabulary constants and associated types for the StyleMe Garment Profile.
// No Prisma, no server-only dependencies — safe to import in route components.

export const EXACT_SLOT_VALUES = [
  "top","bottom","dress","set","outerwear","shoe","bag","accessory","jewelry",
] as const;
export type ExactSlot = (typeof EXACT_SLOT_VALUES)[number];

export const OUTFIT_FUNCTION_VALUES = [
  "base","supporting","statement","anchor","layering","finishing",
] as const;
export type OutfitFunction = (typeof OUTFIT_FUNCTION_VALUES)[number];

export const STYLE_FAMILY_VALUES = [
  "classic","minimal","sporty","architectural","romantic","edgy","feminine","expressive",
] as const;
export type StyleFamily = (typeof STYLE_FAMILY_VALUES)[number];

export const DRESS_REGISTER_VALUES = [
  "athletic","casual","elevated-casual","smart-casual","polished","dressy","evening",
] as const;
export type DressRegister = (typeof DRESS_REGISTER_VALUES)[number];

export const CONSTRUCTION_VALUES = [
  "soft","neutral","structured","tailored","sculptural","N/A",
] as const;
export type Construction = (typeof CONSTRUCTION_VALUES)[number];

export const FABRIC_BEHAVIOUR_VALUES = [
  "soft","fluid","crisp","rigid","stretch","sculptural","N/A",
] as const;
export type FabricBehaviour = (typeof FABRIC_BEHAVIOUR_VALUES)[number];

export const SILHOUETTE_CHARACTER_VALUES = [
  "fitted","straight","column","tapered","wide-leg","flare/bootcut",
  "A-line","relaxed","oversized","voluminous","asymmetric","draped","N/A",
] as const;
export type SilhouetteCharacter = (typeof SILHOUETTE_CHARACTER_VALUES)[number];

export const VISUAL_WEIGHT_VALUES = ["light","medium","heavy"] as const;
export type VisualWeight = (typeof VISUAL_WEIGHT_VALUES)[number];

export const STYLING_EFFORT_VALUES = [
  "easy","neutral","deliberate","high-maintenance",
] as const;
export type StylingEffort = (typeof STYLING_EFFORT_VALUES)[number];

export const LAYERING_BEHAVIOUR_VALUES = [
  "standalone","base-under-layer","outer-layer","either","N/A",
] as const;
export type LayeringBehaviour = (typeof LAYERING_BEHAVIOUR_VALUES)[number];

export const WAIST_COMFORT_VALUES = [
  "elastic","drawstring","stretch","fixed","restrictive","unknown","N/A",
] as const;
export type WaistComfort = (typeof WAIST_COMFORT_VALUES)[number];

export const STATEMENT_LEVEL_VALUES = ["quiet","moderate","statement"] as const;
export type StatementLevel = (typeof STATEMENT_LEVEL_VALUES)[number];

export const OCCASION_IDS = [
  "everyday","work","dinner","date","event","night-out","family","travel","active",
] as const;
export type OccasionId = (typeof OCCASION_IDS)[number];

export const OCCASION_FIT_RATINGS = ["Strong","Acceptable","No"] as const;
export type OccasionFitRating = (typeof OCCASION_FIT_RATINGS)[number];

export const INTENTION_IDS = [
  "feel-like-myself","confidence","ground-me","give-structure","make-it-easy",
  "feel-put-together","feel-attractive","give-energy","feel-softer",
  "feel-sharper","feel-less-exposed","express-myself",
] as const;
export type IntentionId = (typeof INTENTION_IDS)[number];

export const INTENTION_RATINGS = ["Strong","Supporting","None"] as const;
export type IntentionRating = (typeof INTENTION_RATINGS)[number];

export const PROFILE_STATUS_VALUES = ["unreviewed","in-review","approved"] as const;
export type ProfileStatus = (typeof PROFILE_STATUS_VALUES)[number];
