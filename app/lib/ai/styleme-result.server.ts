// app/lib/ai/styleme-result.server.ts
// Phase 3D — wires runRecommendation() into the StyleMe result experience.
//
// Product selection and ranking: runRecommendation() only — never Claude.
// Wording (outfitName, whyThisWorks, confidenceBoost, perfumeNote): Claude only.
// Song: deterministic from curated catalog via selectSong().
// Finishing layer: catalog prose fields (shoeDirection, accessoriesDirection, etc.).

import { quizQuestions } from "../onboarding/quiz-data.js";
import { runRecommendation, buildSessionFingerprint } from "./styleme-recommendation.js";
import type {
  StyleMeEngineInput,
  StyleMeProfileSignals,
  StyleMeRecommendationResult,
  AnchorInput,
  ClosetAnchorInput,
  NormalizedClosetAnchor,
  NormalizedNadineAnchor,
  NormalizedStyleAnchor,
  StyleMeSessionInput,
  StyleMeMode,
  OutfitSlot,
} from "./styleme-recommendation.types.js";
import {
  loadAllClosetItemsForEngine,
  ANCHOR_CAPABLE_CATEGORIES,
  scoreClosetItemForSession,
  type ClosetScoringProfile,
} from "./styleme-anchor.server.js";
import { getProductByHandle } from "./naia-catalog.js";
import { resolveVerifiedMedia, VIRTUAL_TRY_ON_ENABLED } from "./naia-product-media.js";
import type { VerifiedMediaEntry } from "./naia-product-media.js";
import { callClaudeJSON } from "./claude.server.js";
import { selectSong } from "./get-ready-song-catalog.js";
import type {
  StyleMeCustomerResult,
  StyleMeDbPayload,
  StyleMeDbItem,
  StyleMeWording,
  StyleMeFinishingLayer,
  StyleMePrimaryProduct,
  StyleMeMetadata,
  OutfitDbItemType,
  StyleMeOutcome,
  StyleMeCompletionPiece,
  ResultDirection,
} from "./styleme-result.types.js";
import { getMappingById, PRODUCT_TEMPLATE_FIELDS } from "./signal-contract.js";
import type { ProductEvaluation } from "./styleme-recommendation.types.js";

// ── Passport option label resolver ───────────────────────────────────────────

function optionLabel(questionId: string, optionId: string): string {
  const q = quizQuestions.find((q) => q.id === questionId);
  const opt = q?.options?.find((o) => o.id === optionId);
  return opt?.label ?? optionId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Profile signal builder ────────────────────────────────────────────────────

export function buildProfileSignals(
  profile: {
    stylePersonalities?: string[] | null;
    favoriteColors?: string[] | null;
    avoidColors?: string[] | null;
    styleSupport?: string[] | null;
    desiredImpression?: string[] | null;
    desiredFeelings?: string[] | null;
    becoming?: string[] | null;
    finalNotes?: string | null;
    lifestyle?: string[] | null;
    dressesFor?: string[] | null;
    bodyFocusAreas?: string[] | null;
    bodyAvoidAreas?: string[] | null;
    fitPreferences?: string[] | null;
    silhouette?: string[] | null;
    preferredCoverage?: string | null;
    coveragePreferences?: string[] | null;
    dressingPreferences?: string[] | null;  // Rev 6: feeds Group 2 hard-exclusion engine
    structure?: string | null;
    currentGoal?: string[] | null;
    successfulOutfitGives?: string[] | null;
    fitConcerns?: string[] | null;
    fitConcernsNote?: string | null;
  } | null | undefined,
): StyleMeProfileSignals | undefined {
  if (!profile) return undefined;
  const signals: StyleMeProfileSignals = {};
  if (profile.stylePersonalities?.length) signals.stylePersonalities = profile.stylePersonalities;
  if (profile.favoriteColors?.length) signals.favoriteColors = profile.favoriteColors;
  if (profile.avoidColors?.length) signals.avoidColors = profile.avoidColors;
  if (profile.styleSupport?.length) signals.styleSupport = profile.styleSupport;
  if (profile.desiredImpression?.length) signals.desiredImpression = profile.desiredImpression;
  if (profile.desiredFeelings?.length) signals.desiredFeelings = profile.desiredFeelings;
  if (profile.becoming?.length) signals.becoming = profile.becoming;
  if (profile.finalNotes?.trim()) signals.finalNotes = profile.finalNotes.trim();
  if (profile.lifestyle?.length) signals.lifestyle = profile.lifestyle;
  if (profile.dressesFor?.length) signals.dressesFor = profile.dressesFor;
  if (profile.bodyFocusAreas?.length) signals.bodyFocusAreas = profile.bodyFocusAreas;
  if (profile.bodyAvoidAreas?.length) signals.bodyAvoidAreas = profile.bodyAvoidAreas;
  if (profile.fitPreferences?.length) signals.fitPreferences = profile.fitPreferences;
  if (profile.silhouette?.length) signals.silhouette = profile.silhouette;
  if (profile.preferredCoverage) signals.preferredCoverage = profile.preferredCoverage;
  if (profile.coveragePreferences?.length) signals.coveragePreferences = profile.coveragePreferences;
  // dressingPreferences: always populate (even empty) so Group 2 hard-exclusion engine
  // receives the correct signal rather than falling back to its own undefined default.
  signals.dressingPreferences = profile.dressingPreferences ?? [];
  if (profile.structure) signals.structure = profile.structure;
  if (profile.currentGoal?.length) signals.currentGoal = profile.currentGoal;
  if (profile.successfulOutfitGives?.length) signals.successfulOutfitGives = profile.successfulOutfitGives;
  // fitConcerns: exclude "no-fit-problems" sentinel — its presence means no concerns
  const activeFitConcerns = (profile.fitConcerns ?? []).filter((id) => id !== "no-fit-problems");
  if (activeFitConcerns.length) signals.fitConcerns = activeFitConcerns;
  if (profile.fitConcernsNote?.trim()) signals.fitConcernsNote = profile.fitConcernsNote.trim();
  return Object.keys(signals).length > 0 ? signals : undefined;
}

// ── Engine input builder ──────────────────────────────────────────────────────

export function buildEngineInput(params: {
  moods: string[];
  desiredFeelings: string[];
  bodyNeeds: string[];
  coverageConditional: string | null;
  occasion: string;
  formalityConditional: string | null;
  todayColours: { preferred: string[]; avoid: string[] };
  practicalIds: string[];
  source: "naia-piece" | "my-closet" | "both";
  profile?: StyleMeProfileSignals;
  anchor?: AnchorInput | null;
  recentlyShownHandles?: string[];
  recentlyShownClosetIds?: string[];
  mode?: StyleMeMode;
  // Rev 3 — Psychology-First wording context (Group 5). Zero engine scoring.
  state?: string;
  stateOtherText?: string; // free text when state === "other"; context only
  intentions?: string[];
}): StyleMeEngineInput {
  return {
    session: {
      moods: params.moods,
      desiredFeelings: params.desiredFeelings,
      bodyNeeds: params.bodyNeeds,
      coverageConditional: params.coverageConditional,
      occasion: params.occasion,
      formalityConditional: params.formalityConditional,
      todayColours: params.todayColours,
      practicalIds: params.practicalIds,
      source: params.source,
      ...(params.state !== undefined && { state: params.state }),
      ...(params.stateOtherText !== undefined && { stateOtherText: params.stateOtherText }),
      ...(params.intentions !== undefined && { intentions: params.intentions }),
    },
    profile: params.profile,
    anchor: params.anchor ?? null,
    recentlyShownHandles: params.recentlyShownHandles ?? [],
    recentlyShownClosetIds: params.recentlyShownClosetIds,
    mode: params.mode,
  };
}

// ── Closet category → outfit slot mapping ─────────────────────────────────────

const CLOSET_CATEGORY_TO_SLOT: Record<string, OutfitSlot> = {
  TOPS: "top",
  BOTTOMS: "bottom",
  DRESSES: "dress",
  SETS: "set",
  OUTERWEAR: "outerwear",
  SHOES: "shoe",
  BAGS: "bag",
  ACCESSORIES: "accessory",
  JEWELRY: "jewelry",
  ACTIVEWEAR: "top",
  LOUNGEWEAR: "top",
};

// Maximum total pieces in a styled outfit (anchor + primary NADINE product + additional closet garments).
// Optional slots are selected by relevance score until this cap is reached.
export const MAX_OUTFIT_PIECES = 5;

// ── StyleSource enum → session source string ──────────────────────────────────

export function styleSourceToSessionSource(
  styleFrom: "CLOSET" | "NAIA" | "BOTH",
): "naia-piece" | "my-closet" | "both" {
  if (styleFrom === "CLOSET") return "my-closet";
  if (styleFrom === "NAIA") return "naia-piece";
  return "both";
}

// ── Slot → DB item type ───────────────────────────────────────────────────────

function slotToItemType(slot: string): OutfitDbItemType {
  const map: Record<string, OutfitDbItemType> = {
    top: "TOP",
    bottom: "BOTTOM",
    dress: "DRESS",
    set: "DRESS",
    outerwear: "OUTERWEAR",
    shoe: "SHOES",
    bag: "BAG",
    accessory: "ACCESSORY",
    jewelry: "JEWELRY",
    unknown: "TOP",
  };
  return map[slot] ?? "TOP";
}

// ── Finishing layer ───────────────────────────────────────────────────────────

const GENERIC_FINISHING: StyleMeFinishingLayer = {
  shoes: "Choose footwear that feels comfortable and complements your outfit's tone.",
  bag: "A structured bag in a neutral or tonal shade will ground the look.",
  accessories: "Keep accessories minimal — one or two considered pieces work best.",
  hair: "Loose and natural, or a simple half-up — whatever feels most considered today.",
  colourDirection: "Build your palette around neutrals, adding one thoughtful accent.",
};

type HairLayerContext = {
  occasion: string;
  formalityConditional: string | null;
  formalityScore?: number;
  hairDirectionTokens?: string[];
};

// Derives a specific, actionable hair direction from outfit context.
// Never invents hair length, texture, curl pattern, or density.
// Gender-neutral unless gender presentation is explicitly known.
function deriveHairDirection(ctx: HairLayerContext): string {
  const { occasion, formalityConditional, formalityScore = 0.5, hairDirectionTokens = [] } = ctx;

  // Formality tier
  const isDressy =
    formalityConditional === "formality-polished" ||
    formalityConditional === "formality-occasion" ||
    (formalityConditional == null && formalityScore >= 0.7);
  const isSmart =
    !isDressy &&
    (formalityConditional === "formality-smart" ||
      (formalityConditional == null && formalityScore >= 0.45));

  // Structural neckline/collar constraint — matches both kebab shortcodes and catalog prose forms
  const tokenStr = hairDirectionTokens.join(" ").toLowerCase();
  const needsUp =
    /hair-up-recommended|neckline-should-remain-visible|collar-should-remain-visible|lapel-should-remain-visible|hair away from the neckline|hair-swept-back|tuck-behind-ears|ponytail\/bun|ponytail or bun|sleek ponytail|hair tucked behind/.test(tokenStr);
  const needsSweptBack =
    !needsUp && /tucked-back|swept-back/.test(tokenStr);
  const balanceShoulder =
    !needsUp && !needsSweptBack && /balance-volume-around-shoulders/.test(tokenStr);

  // Structural constraints take priority — give a specific direction within the right formality register
  if (needsUp) {
    if (isDressy) return "A polished low bun or sleek chignon — keeps the neckline clean and the look refined.";
    if (isSmart) return "A sleek ponytail or low bun — keep hair away from the neckline.";
    return "Hair swept up or back — a loose bun or ponytail keeps the collar visible.";
  }

  if (needsSweptBack) {
    if (isDressy) return "Hair swept back elegantly — tucked behind the ears or secured at the nape.";
    if (isSmart) return "Hair tucked behind the ears or lightly swept back.";
    return "Tuck hair behind the ears or keep it loosely swept back.";
  }

  if (balanceShoulder) {
    if (isDressy) return "Keep hair close to the head — a low bun or smooth finish balances the shoulder line.";
    if (isSmart) return "A low bun or ponytail balances the silhouette around the shoulders.";
    return "Hair up or close to the head works well with this silhouette.";
  }

  // No structural constraint — use occasion × formality
  const occ = occasion || "not-sure";

  if (occ === "work") {
    if (isDressy) return "Polished low bun or a sleek, straight blow-out.";
    if (isSmart) return "Neat ponytail, low bun, or worn loose and polished.";
    return "Loose and natural, or a neat ponytail to keep it professional.";
  }

  if (occ === "date-night") {
    if (isDressy) return "Soft blow-out or a low bun with a few face-framing pieces left loose.";
    if (isSmart) return "Loose waves or a relaxed half-up — natural but considered.";
    return "Loose with a centre part, or half-up with easy texture.";
  }

  if (occ === "special-event") {
    if (isDressy) return "An elegant updo or polished blow-out — keep the finish refined.";
    if (isSmart) return "Soft updo or smooth waves — a little more polish than everyday.";
    return "Loose waves or a simple low bun — relaxed but put-together.";
  }

  if (occ === "dinner") {
    if (isDressy) return "Soft blow-out or an elegant low bun — keep the finish intentional.";
    if (isSmart) return "Loose waves or half-up — polished without being overly formal.";
    return "Loose and natural, or half-up with soft waves.";
  }

  if (occ === "girls-night") {
    if (isDressy) return "Loose, voluminous waves or a chic low bun.";
    if (isSmart) return "Textured loose waves or a half-up — relaxed but intentional.";
    return "Loose and lived-in — soft waves or air-dried texture.";
  }

  if (occ === "family") {
    if (isDressy) return "Neat low bun or smooth and pulled back.";
    if (isSmart) return "Half-up or loose — clean and easy.";
    return "Loose and natural, or a quick half-up.";
  }

  if (occ === "travel") {
    if (isDressy) return "A neat, low bun — practical and intentional.";
    if (isSmart) return "Easy low bun or loose ponytail — functional and considered.";
    return "Quick bun or loose and natural — whatever travels well.";
  }

  if (occ === "everyday") {
    if (isDressy) return "Neat and pulled-back — a low bun or sleek ponytail.";
    if (isSmart) return "Centre-part straight or wavy, or a simple half-up.";
    return "Wear it natural — loose, half-up, or a quick bun.";
  }

  // Fallback: not-sure or unrecognised occasion
  if (isDressy) return "Keep the finish polished — a low bun, sleek ponytail, or smooth blow-out.";
  if (isSmart) return "Loose waves or a simple half-up — clean and considered.";
  return "Loose and natural, or a simple half-up — whatever feels most considered today.";
}

export function buildFinishingLayer(
  handle: string | null,
  ctx: HairLayerContext = { occasion: "not-sure", formalityConditional: null },
): StyleMeFinishingLayer {
  if (!handle) {
    return {
      ...GENERIC_FINISHING,
      hair: deriveHairDirection(ctx),
    };
  }
  const product = getProductByHandle(handle);
  if (!product) {
    return {
      ...GENERIC_FINISHING,
      hair: deriveHairDirection(ctx),
    };
  }
  const prose = product.parsed.prose;
  const formalityScore = product.parsed.scalars.formalityScore;
  const hairDirectionTokens = prose.hairStylingDirection ?? [];
  return {
    shoes: prose.shoeDirection || GENERIC_FINISHING.shoes,
    bag: extractBagSentence(prose.accessoriesDirection) || GENERIC_FINISHING.bag,
    accessories: stripBagLanguage(prose.accessoriesDirection) || GENERIC_FINISHING.accessories,
    hair: deriveHairDirection({ ...ctx, formalityScore, hairDirectionTokens }),
    colourDirection: prose.colorDirection || GENERIC_FINISHING.colourDirection,
  };
}

function extractBagSentence(accessoriesDir: string): string {
  const match = accessoriesDir.match(/(?:^|[.!?]\s+)([^.!?]*\bbag\b[^.!?]*[.!?])/i);
  if (match) return match[1].trim();
  // No distinct bag sentence found — return empty so the caller falls back
  // to GENERIC_FINISHING.bag rather than duplicating accessories copy into the bag slot.
  return "";
}

function stripBagLanguage(accessoriesDir: string): string {
  if (!accessoriesDir) return accessoriesDir;
  // Patterns seen in catalog: "compact structured bag", "medium structured bag",
  // "compact or medium structured bag", "structured bag", "structured handbag".
  // All appear as trailing list items (after a comma or "and") or standalone fragments.
  // Step 1: remove "and a <variant> structured bag/handbag" clauses before sentence end.
  let result = accessoriesDir.replace(
    /\s+and\s+(?:a\s+)?(?:compact\s+)?(?:or\s+medium\s+)?(?:medium\s+)?structured\s+(?:bag|handbag)\b[^.!?]*/gi,
    "",
  );
  // Step 2: remove comma-list items like ", compact structured bag" / ", a compact or medium structured bag".
  result = result.replace(
    /,\s*(?:a\s+)?(?:compact\s+)?(?:or\s+medium\s+)?(?:medium\s+)?structured\s+(?:bag|handbag)\b[^,.!?]*/gi,
    "",
  );
  // Step 3: catch any remaining standalone "structured handbag" after a comma.
  result = result.replace(/,\s*structured\s+handbag\b[^,.!?]*/gi, "");
  // Normalise: remove trailing comma before period, collapse whitespace.
  result = result.replace(/,\s*([.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return result || accessoriesDir;
}

// ── Deterministic wording fallback ────────────────────────────────────────────

// Builds an editorial outfit title from structured garment metadata (colors, material).
// Never parses words from label strings — uses only normalized closet AI tokens.
function buildFallbackOutfitTitle(
  pieces: Array<{ slot: string; label: string | null; colors: string[]; material?: string | null }>,
  occasion: string,
  context?: { intentions?: string[]; desiredFeelings?: string[] },
): string {
  const intentions = context?.intentions ?? [];
  const feelings = context?.desiredFeelings ?? [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const wantsSofter   = feelings.includes("softer");
  const wantsSharper  = feelings.includes("more-confident") || feelings.includes("sharper");
  const wantsFeminine = feelings.includes("more-feminine");
  const wantsEasy     = intentions.includes("make-it-easy") || intentions.includes("feel-like-myself");
  const wantsTogether = intentions.includes("put-together");
  const wantsGrounded = intentions.includes("ground-me");
  const isWork    = occasion === "work";
  const isEvening = occasion === "dinner" || occasion === "date-night";
  const isNight   = occasion === "girls-night" || occasion === "special-event";

  // Collect material tokens from structured closet metadata only (not inferred from name)
  const materials = [...new Set(
    pieces.map((p) => p.material).filter((m): m is string => !!m).map((m) => cap(m))
  )];
  const [mat] = materials;

  // Material-present paths — natural English, no "QUALIFIER MATERIAL and COLOR" formula
  if (mat) {
    if (wantsSofter || wantsFeminine) return `Softened ${mat}`;   // "Softened Denim"
    if (wantsSharper)  return `${mat}, Sharpened`;                // "Denim, Sharpened"
    if (wantsEasy && isWork) return `Polished ${mat}`;            // "Polished Denim"
    if (wantsEasy)     return `Easy ${mat}`;                      // "Easy Denim"
    if (wantsTogether) return `${mat}, Kept Sharp`;               // "Denim, Kept Sharp"
    if (wantsGrounded) return `Simple ${mat}`;                    // "Simple Denim"
    if (isWork)        return `${mat}, Quietly Sharp`;            // "Denim, Quietly Sharp"
    if (isEvening || isNight) return `${mat} for the Evening`;    // "Denim for the Evening"
    return `Clean ${mat}`;                                        // "Clean Denim"
  }

  // No material — editorial tone phrases only (never "COLOR and COLOR, QUALIFIER")
  if (wantsSofter || wantsFeminine) return "Soft Lines";
  if (wantsSharper)  return "Clean Lines, Sharpened";
  if (wantsEasy && isWork) return "Quietly Put Together";
  if (wantsEasy)     return "Polished Ease";
  if (wantsTogether) return "Quietly Put Together";
  if (wantsGrounded) return "Grounded and Simple";
  if (isWork)        return "Quietly Put Together";
  if (isEvening)     return "Quietly Considered";
  if (isNight)       return "Simply Dressed Up";

  // Last resort — occasion phrase (no color formula)
  const occasionFallbacks: Record<string, string> = {
    "everyday":      "Simply Put Together",
    "work":          "Quietly Put Together",
    "dinner":        "Quietly Considered",
    "date-night":    "A Considered Evening",
    "girls-night":   "Simply Dressed Up",
    "special-event": "Dressed for the Occasion",
    "travel":        "Easy and Ready",
    "family":        "Relaxed and Ready",
    "not-sure":      "Clean and Simple",
  };
  return occasionFallbacks[occasion] ?? "Simply Put Together";
}

export function deterministicWording(
  outcome: StyleMeOutcome,
  moods: string[],
  desiredFeelings: string[],
  occasion: string,
  primaryTitle: string | null,
  styleMeExplanation: string | null,
  completionPieces: StyleMeCompletionPiece[] = [],
  anchor?: { label: string | null; slot: string | null; colors: string[]; material?: string | null; styleTags?: string[] } | null,
  selectedGarments?: Array<{ slot: string; label: string | null; colors: string[]; material?: string | null }>,
  context?: { intentions?: string[]; state?: string | null; profileHint?: string | null },
): StyleMeWording {
  const occasionLabel = occasion.replace(/-/g, " ");

  let outfitName: string;
  if (outcome === "no-eligible-product") {
    outfitName = `A direction for ${occasionLabel}`.replace(/^\w/, (c) => c.toUpperCase());
  } else if (primaryTitle) {
    outfitName = `${primaryTitle} for ${occasionLabel}`;
  } else if (selectedGarments?.length) {
    outfitName = buildFallbackOutfitTitle(selectedGarments, occasion, {
      intentions: context?.intentions,
      desiredFeelings,
    });
  } else {
    outfitName = `Your ${occasionLabel} look`.replace(/^\w/, (c) => c.toUpperCase());
  }

  const anchorRef = anchor?.label ? ` Built around your ${anchor.label}.` : "";
  const baseWhy =
    outcome === "no-eligible-product"
      ? "No single piece from the catalogue matched every constraint today. The finishing layer below gives you a clear direction to work with."
      : (styleMeExplanation ??
          (desiredFeelings.includes("softer")
            ? `A considered selection for your ${occasionLabel}, with softer fabrication and line in mind.${anchorRef}`
            : `A considered selection for your ${occasionLabel}.${anchorRef}`));

  const completionNote = (() => {
    if (completionPieces.length === 0) return "";
    const topPiece = completionPieces.find((p) => p.slot === "top");
    const bottomPiece = completionPieces.find((p) => p.slot === "bottom");
    const parts: string[] = [];
    if (topPiece) {
      const relation = primaryTitle
        ? `keeps the base balanced under ${primaryTitle}`
        : "keeps the base balanced";
      parts.push(`A tonal base ${relation}.`);
    }
    if (bottomPiece) {
      const hasSkirt = /skirt/i.test(bottomPiece.description);
      const bottomWord = hasSkirt ? "skirt" : "trouser";
      parts.push(`A clean ${bottomWord} gives the look its shape at the base.`);
    }
    return " " + parts.join(" ");
  })();

  // Softer note — explains the styling relationship when 'softer' is a desired feeling.
  // Must reference fabric/line/construction, not just restate the desire.
  const softerNote = (() => {
    if (!desiredFeelings.includes("softer")) return "";
    if (completionPieces.length > 0) {
      return primaryTitle
        ? ` The fluid, draped fabrication in the completion softens the overall line alongside ${primaryTitle}.`
        : " The fluid, draped fabrication in the completion carries softness through the full look without losing shape.";
    }
    return " Fluid fabrication and a relaxed construction carry softness through the full look.";
  })();

  // Anchor note — explains the anchor's colour, energy, and relationship to the look.
  // Essential when a manual piece (shoes, bag, etc.) grounds the outfit's tone.
  const anchorNote = (() => {
    if (!anchor?.label) return "";
    const colourStr =
      anchor.colors.length > 0 ? ` in ${anchor.colors[0].replace(/-/g, " ")}` : "";
    if (anchor.slot === "shoe" || anchor.slot === "shoes") {
      return ` Your ${anchor.label}${colourStr} set the tone at the base — every piece above them works around their colour and style.`;
    }
    if (anchor.slot === "bag") {
      return ` Your ${anchor.label}${colourStr} quietly ties the palette together and gives the look a finished feel.`;
    }
    return ` Your ${anchor.label}${colourStr} is the piece that pulls the whole look together.`;
  })();

  // When selected garments are available (nAia closet mode, model failed), build
  // piece-specific explanation from actual outfit metadata. No invented comfort/body claims.
  let whyThisWorks: string;
  let confidenceBoost: string;

  if (selectedGarments?.length && outcome !== "no-eligible-product" && !styleMeExplanation) {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const topPiece    = selectedGarments.find((p) => p.slot === "top");
    const bottomPiece = selectedGarments.find((p) => p.slot === "bottom");
    const dressPiece  = selectedGarments.find((p) => p.slot === "dress" || p.slot === "set");
    const shoe        = selectedGarments.find((p) => p.slot === "shoe");
    const bag         = selectedGarments.find((p) => p.slot === "bag");

    const topColor    = topPiece?.colors[0]    ?? null;
    const bottomColor = bottomPiece?.colors[0] ?? null;
    const shoeColor   = shoe?.colors[0]        ?? null;
    const bagColor    = bag?.colors[0]         ?? null;
    const bottomMat   = bottomPiece?.material  ?? null;

    const shoeIsLight     = shoeColor === "white" || shoeColor === "cream" || shoeColor === "ivory" || shoeColor === "beige";
    const paletteIsDark   = topColor === "black" || topColor === "navy" || bottomColor === "black" || bottomColor === "navy" || topColor === "charcoal";
    const topBottomContrast = topColor && bottomColor && topColor.toLowerCase() !== bottomColor.toLowerCase();
    const bagMatchesTop   = bagColor && topColor && bagColor.toLowerCase() === topColor.toLowerCase();

    const sentences: string[] = [];

    // Base sentence: explain the core clothing relationship
    if (topPiece && bottomPiece) {
      if (bottomMat && topColor && topBottomContrast) {
        sentences.push(
          `The ${bottomMat} makes the combination feel easier for ${occasionLabel} — it relaxes the ${topColor} top without making the overall look feel too casual.`,
        );
      } else if (topColor && topBottomContrast) {
        sentences.push(
          `The ${cap(topColor)} and ${cap(bottomColor!)} are a clean pairing — the contrast between them gives the outfit its shape.`,
        );
      } else if (topPiece.label && bottomPiece.label) {
        sentences.push(
          `The ${topPiece.label} and ${bottomPiece.label} share a clean palette, which keeps the combination easy and unfussy.`,
        );
      }
    } else if (dressPiece?.label) {
      sentences.push(
        `The ${dressPiece.label} forms a single, complete base — nothing to balance, which is part of the ease.`,
      );
    } else if (selectedGarments[0]?.label) {
      sentences.push(`The ${selectedGarments[0].label} defines the direction for the look.`);
    }

    // Shoe sentence: what the shoes do to the palette
    if (shoe?.label) {
      if (shoeIsLight && paletteIsDark) {
        sentences.push(
          `The ${shoe.label} stop the combination from feeling too heavy — they lighten things up and keep the outfit from feeling overdressed.`,
        );
      } else if (shoeColor && topColor && shoeColor.toLowerCase() === topColor.toLowerCase()) {
        sentences.push(
          `The ${shoe.label} carry the colour through to the base, which closes the look neatly.`,
        );
      } else if (shoeColor && bottomColor && shoeColor.toLowerCase() === bottomColor.toLowerCase()) {
        sentences.push(`The ${shoe.label} continue the colour down to the base, keeping the look cohesive.`);
      } else {
        sentences.push(`The ${shoe.label} finish the look at the base without competing with what's above.`);
      }
    }

    // Bag sentence: what the bag does
    if (bag?.label) {
      if (bagMatchesTop && topColor) {
        sentences.push(
          `The ${bag.label} quietly repeats the colour of the top, so you get a finished look without adding another colour into the mix.`,
        );
      } else if (bagColor && !bagMatchesTop) {
        sentences.push(
          `The ${bag.label} brings in a ${bagColor} note at the end — a small detail that doesn't compete with the rest.`,
        );
      }
    }

    // Intention/feeling note — only when supported by evidence
    if (desiredFeelings.includes("softer")) {
      sentences.push("The overall combination keeps the construction soft.");
    }

    // Optional closing: profile identity note when feel-like-myself + profileHint is available
    if (
      context?.intentions?.includes("feel-like-myself") &&
      context.profileHint &&
      sentences.length > 0
    ) {
      const hintClean =
        context.profileHint === "your established Profile preferences"
          ? null
          : context.profileHint
              .replace(/ direction\b.*/, "")
              .replace(/ silhouettes$/, "")
              .trim();
      if (hintClean) {
        sentences.push(`This stays close to the ${hintClean} looks you naturally gravitate towards.`);
      } else {
        sentences.push(`This stays close to what you already know works for you.`);
      }
    }

    whyThisWorks = sentences.join(" ").trim() ||
      `A clean, simple ${occasionLabel} selection.`;

    // Confidence boost: one specific stylist observation about the key styling decision
    if (shoeIsLight && paletteIsDark && shoe?.label) {
      confidenceBoost = `Don't add much more here — the ${shoe.label} are already giving the darker outfit enough contrast.`;
    } else if (topBottomContrast && bottomMat && topColor) {
      confidenceBoost = `The contrast between the ${topColor} top and the ${bottomMat} is already doing the work — keep the rest simple.`;
    } else if (topBottomContrast && topColor && bottomColor) {
      confidenceBoost = `The ${cap(topColor)} and ${cap(bottomColor!)} contrast is already doing the work — keep the rest of the look simple.`;
    } else if (bagMatchesTop && bag?.label && topColor) {
      confidenceBoost = `The ${bag.label} closes back into the ${topColor} — keep it there, it's doing the right thing.`;
    } else if (bottomMat && topColor) {
      confidenceBoost = `The ${bottomMat} and ${topColor} are the two decisions here — everything else follows from them.`;
    } else {
      confidenceBoost = `The palette is already making the decisions — keep the rest of the look simple.`;
    }
  } else {
    whyThisWorks = `${baseWhy}${completionNote}${softerNote}${anchorNote}`;
    // Stylist's note (internal field: confidenceBoost — retained for schema/type compat).
    // Semantics changed per Constitution V1: one clothing/styling observation, never an emotional affirmation.
    confidenceBoost = primaryTitle
      ? `The ${primaryTitle} is the centrepiece here — keep everything around it simple.`
      : `The palette is already doing the work — keep the rest of the look simple.`;
  }

  return { outfitName, whyThisWorks, confidenceBoost, perfumeNote: null };
}

// ── Song reason ───────────────────────────────────────────────────────────────

export function buildSongReason(
  songMoods: string[],
  songOccasions: string[],
  sessionMoods: string[],
  occasion: string,
): string {
  const matchedMoods = songMoods.filter((m) => sessionMoods.includes(m));
  const occasionMatches = songOccasions.includes(occasion);
  const moodLabel = matchedMoods
    .slice(0, 2)
    .map((m) => m.replace(/-/g, " "))
    .join(" and ");
  const occasionLabel = occasion.replace(/-/g, " ");

  if (matchedMoods.length > 0 && occasionMatches) {
    return `Matched to your ${moodLabel} energy for ${occasionLabel}.`;
  } else if (matchedMoods.length > 0) {
    return `Matched to your ${moodLabel} energy today.`;
  } else {
    return `Curated to set the tone for your ${occasionLabel}.`;
  }
}

// ── Metadata envelope builder ─────────────────────────────────────────────────

function buildMetadataJson(result: StyleMeCustomerResult): string {
  const rawAnchor = result.rawRecommendation.anchor;
  let anchorMeta: StyleMeMetadata["anchor"] = null;
  let anchorSlot: string | null = null;
  if (rawAnchor?.type === "nadine") {
    anchorMeta = { type: "nadine", handle: (rawAnchor as NormalizedNadineAnchor).handle };
    anchorSlot = (rawAnchor as NormalizedNadineAnchor).slot ?? null;
  } else if (rawAnchor?.type === "closet") {
    anchorMeta = { type: "closet", id: (rawAnchor as NormalizedClosetAnchor).id };
    anchorSlot = (rawAnchor as NormalizedClosetAnchor).slot ?? null;
  }

  const metadata: StyleMeMetadata = {
    schemaVersion: 1,
    outcome: result.outcome,
    primaryHandle: result.primaryProduct?.handle ?? null,
    alternatives: result.alternatives.map((a) => ({
      handle: a.handle,
      title: a.title,
      slot: a.slot,
      stylingNotes: a.stylingNotes,
      productImageUrl: a.productImageUrl ?? null,
      liveUrl: a.liveUrl ?? null,
    })),
    anchor: anchorMeta,
    anchorSummary: result.closetAnchorLabel,
    anchorImageUrl: result.closetAnchorImageUrl,
    anchorSlot,
    pairingNote: result.pairingNote,
    colourDirection: result.finishingLayer.colourDirection,
    songReason: result.songReason,
    evidenceCodes: [],
    completionLayer: result.completionLayer.length > 0 ? result.completionLayer : undefined,
    ...(result.sameCombination !== undefined && { sameCombination: result.sameCombination }),
    // Rev 3 — persist direction identity so reopened sessions recover MOST YOU / FRESH / PUSH ME.
    // Stored as lightweight tuples (handle+label+note+url) — no full product object in metadata.
    ...(result.resultDirections.length > 0 && {
      resultDirections: result.resultDirections.map((d) => ({
        label: d.label,
        displayLabel: d.displayLabel,
        directionalNote: d.directionalNote,
        handle: d.product?.handle ?? null,
        title: d.product?.title ?? null,
        productUrl: d.product?.productUrl ?? null,
        productImageUrl: d.product?.productImageUrl ?? null,
        outfitPieces: d.outfitPieces ?? [],
      })),
    }),
  };

  return JSON.stringify(metadata);
}

// ── Blocked-term guard ────────────────────────────────────────────────────────

const BLOCKED_TERMS = [
  "stunning piece",
  "elevate your wardrobe",
  "unleash your inner",
  "therapy",
  "therapeutic",
  "treats your",
  "cures",
  "clinical",
  "diagnoses",
  "diagnose",
  "mental health",
  "emotional healing",
];

export function containsBlockedTerms(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => lower.includes(term));
}

// ── Grammar helper ────────────────────────────────────────────────────────────
// Garment names known to be grammatically plural — checked against individual
// words in the label so multi-word names work correctly.
// ("Black Trousers" → "trousers" → plural; "Silk Skirt" → no match → singular)
const KNOWN_PLURAL_GARMENT_WORDS = new Set([
  "trousers", "pants", "jeans", "shorts", "leggings", "chinos", "culottes",
  "joggers", "loafers", "sneakers", "trainers", "boots", "heels", "flats",
  "slides", "mules", "clogs", "pumps", "oxfords", "brogues",
  "earrings", "sunglasses", "cufflinks",
]);

export function garmentNameIsPlural(name: string): boolean {
  const words = name.toLowerCase().split(/\s+/);
  return words.some((w) => KNOWN_PLURAL_GARMENT_WORDS.has(w));
}

// ── nAia outfit candidate types ──────────────────────────────────────────────

export type OutfitCandidate = {
  id: "A" | "B" | "C" | "D";
  pieces: Array<{ closetId: string; slot: string; label: string | null; colors: string[] }>;
};

// Produces a canonical signature for a set of closet IDs so outfit combinations
// can be compared independent of selection order.
export function computeOutfitSignature(closetIds: string[]): string {
  return [...closetIds].sort().join("|");
}

// Builds up to four validated outfit candidates for nAia closet mode.
// Candidate A — full primary selection (may include discretionary outerwear when eligible).
// Candidate B — session-register-aligned multi-slot alternative (best in-target items per slot).
// Candidate C — no-outerwear variant of A (only when anchor is not outerwear and A has outerwear).
// Candidate D — no-outerwear variant of B; only when B differs from A in core slots and has
//               outerwear inherited from A — ensures the pool can surface B's register-aligned
//               core outfit WITHOUT the discretionary layer.
// Claude selects the candidate that best serves the session brief; the server re-validates.
// Constraints: never removes a manual outerwear anchor; validates via the same scoring gate.
export function buildNaiaOutfitCandidates(
  anchor: NormalizedClosetAnchor,
  session: StyleMeSessionInput,
  allItems: ClosetAnchorInput[],
  profile: StyleMeProfileSignals | undefined,
  recentlyShownIds: Set<string> | undefined,
): [OutfitCandidate, OutfitCandidate | null, OutfitCandidate | null, OutfitCandidate | null] {
  const profile_ = profile as ClosetScoringProfile | undefined;
  const signals = { occasion: session.occasion, moods: session.moods, desiredFeelings: session.desiredFeelings };

  const fullSelection = selectAdditionalClosetGarments(
    anchor,
    null,
    session,
    allItems,
    profile_,
    recentlyShownIds,
  );

  const anchorPiece: OutfitCandidate["pieces"][0] = {
    closetId: anchor.id,
    slot: anchor.slot as string,
    label: anchor.label,
    colors: anchor.colors,
  };

  const toPiece = (g: { slot: OutfitSlot; id: string; label: string | null; colors: string[] }): OutfitCandidate["pieces"][0] =>
    ({ closetId: g.id, slot: g.slot as string, label: g.label, colors: g.colors });

  // Candidate A is always the primary full selection (may include outerwear when eligible).
  const candidateA: OutfitCandidate = {
    id: "A",
    pieces: [anchorPiece, ...fullSelection.map(toPiece)],
  };

  // ── Candidate B: session-formality-aligned complete alternative ─────────────
  // Rather than swapping one slot at a time (which can't produce a materially
  // different outfit), B is rebuilt slot-by-slot: for each open slot the best
  // formality-target-aligned item is selected independently. This allows B to
  // vary both bottom AND shoes (or any other combination) when the session brief
  // supports it, producing a genuinely distinct complete outfit.
  //
  // Sort rule (per slot): items within the session target formality range first,
  // then by raw session score — making B the best register-appropriate alternative.
  //
  // If every chosen alt is the same as A's item in that slot (no meaningful
  // alternative exists), B falls back to swapping the single highest-variance slot.
  const B_SLOTS = new Set(["top", "bottom", "dress", "set", "shoe"]);
  const bTargetRange = getTargetFormalityRange(session.occasion, session.formalityConditional ?? null);
  let candidateB: OutfitCandidate | null = null;

  // Map slot → item chosen by A (to detect differences)
  const aItemBySlot = new Map(
    candidateA.pieces
      .filter((p) => B_SLOTS.has(p.slot))
      .map((p) => [p.slot, p.closetId]),
  );

  // For each open slot, find the best formality-target-aligned alternative.
  const bPiecesMap = new Map<string, OutfitCandidate["pieces"][0]>();
  let bDiffersFromA = false;

  for (const slot of B_SLOTS) {
    // Anchor occupies its own slot — keep it unchanged in B.
    if (slot === (anchor.slot as string)) {
      const anchorPieceInA = candidateA.pieces.find((p) => p.slot === slot);
      if (anchorPieceInA) bPiecesMap.set(slot, anchorPieceInA);
      continue;
    }
    // Not every outfit needs every slot; skip slots not in A.
    const aItemId = aItemBySlot.get(slot);
    if (!aItemId) continue;

    // Score all candidate items for this slot.
    const scoredAlts: Array<{ item: ClosetAnchorInput; score: number; formalityRank: number | null }> = [];
    for (const item of allItems) {
      if (item.id === anchor.id) continue;
      if (CLOSET_CATEGORY_TO_SLOT[item.category as string] !== slot) continue;
      const score = scoreClosetItemForSession(
        { occasions: item.occasions, styleTags: item.styleTags, category: item.category, colors: item.colors, primaryColor: item.primaryColor },
        signals,
        profile_,
        item.garmentRelationships,
      );
      if (score <= 0) continue;
      const formalityRank = item.formality ? (FORMALITY_RANK[item.formality] ?? null) : null;
      scoredAlts.push({ item, score, formalityRank });
    }
    if (scoredAlts.length === 0) continue;

    // Sort: within-target formality first, then by session score.
    scoredAlts.sort((a, b) => {
      const aInTarget = a.formalityRank !== null &&
        a.formalityRank >= bTargetRange.min && a.formalityRank <= bTargetRange.max;
      const bInTarget = b.formalityRank !== null &&
        b.formalityRank >= bTargetRange.min && b.formalityRank <= bTargetRange.max;
      if (aInTarget && !bInTarget) return -1;
      if (bInTarget && !aInTarget) return 1;
      return b.score - a.score;
    });

    const best = scoredAlts[0].item;
    bPiecesMap.set(slot, { closetId: best.id, slot, label: best.name, colors: best.colors });
    if (best.id !== aItemId) bDiffersFromA = true;
  }

  if (bDiffersFromA) {
    // Reconstruct B from the per-slot winners, keeping non-open-slot pieces (e.g. outerwear) from A.
    // nonBSlotPieces: only pieces whose slot is NOT in B_SLOTS (outerwear, bag, jewelry, etc.).
    // The anchor is in bPiecesMap when anchor.slot is in B_SLOTS, so excluding B_SLOTS here
    // prevents the anchor from appearing twice (once via bSlotPieces and once here).
    const nonBSlotPieces = candidateA.pieces.filter(
      (p) => !B_SLOTS.has(p.slot),
    );
    const bSlotPieces = Array.from(bPiecesMap.values()).filter(
      (p) => p.closetId !== anchor.id || p.slot === (anchor.slot as string),
    );
    candidateB = { id: "B", pieces: [...bSlotPieces, ...nonBSlotPieces] };
  } else {
    // No slot had a different best-fit item — fall back to the first slot with any alternative.
    for (const selected of fullSelection.filter((g) => B_SLOTS.has(g.slot))) {
      const fallbackAlts = allItems
        .filter((item) =>
          item.id !== anchor.id &&
          item.id !== selected.id &&
          CLOSET_CATEGORY_TO_SLOT[item.category as string] === selected.slot &&
          scoreClosetItemForSession(
            { occasions: item.occasions, styleTags: item.styleTags, category: item.category, colors: item.colors, primaryColor: item.primaryColor },
            signals, profile_, item.garmentRelationships,
          ) > 0,
        );
      if (fallbackAlts.length === 0) continue;
      const fallback = fallbackAlts[0];
      const altPiece: OutfitCandidate["pieces"][0] = {
        closetId: fallback.id, slot: selected.slot as string, label: fallback.name, colors: fallback.colors,
      };
      candidateB = { id: "B", pieces: candidateA.pieces.map((p) => (p.closetId === selected.id ? altPiece : p)) };
      break;
    }
  }

  // ── Candidate C: no-outerwear variant of A ────────────────────────────────
  // Not generated when the anchor IS outerwear (cannot remove the anchor) or when the
  // session has a hard coverage requirement — the outerwear in A may be the only layer
  // satisfying that requirement and must not be removed.
  let candidateC: OutfitCandidate | null = null;
  const coverageRequiresLayer = session.coverageConditional === "coverage-non-negotiable";
  if (anchor.slot !== "outerwear" && !coverageRequiresLayer) {
    const outerwearInSelection = fullSelection.find((g) => g.slot === "outerwear");
    if (outerwearInSelection) {
      candidateC = { id: "C", pieces: candidateA.pieces.filter((p) => p.closetId !== outerwearInSelection.id) };
    }
  }

  // ── Candidate D: no-outerwear variant of B ────────────────────────────────
  // Generated when B inherits discretionary outerwear from A and B's core slots differ
  // from A's core slots. This ensures the pool can offer the session-register-aligned
  // base outfit WITHOUT the optional layer — e.g. jeans+sneakers when B = jeans+sneakers+blazer
  // and C only covers trousers+loafers (A's core). D = B-without-outerwear is only meaningful
  // when it's distinct from C (otherwise the same outfit is already in the pool).
  let candidateD: OutfitCandidate | null = null;
  if (candidateB !== null && anchor.slot !== "outerwear" && !coverageRequiresLayer) {
    const outerwearInB = candidateB.pieces.find((p) => p.slot === "outerwear" && p.closetId !== anchor.id);
    if (outerwearInB) {
      const dPieces = candidateB.pieces.filter((p) => p.closetId !== outerwearInB.closetId);
      const dSig = computeOutfitSignature(dPieces.map((p) => p.closetId));
      const cSig = candidateC ? computeOutfitSignature(candidateC.pieces.map((p) => p.closetId)) : null;
      if (dSig !== cSig) {
        candidateD = { id: "D", pieces: dPieces };
      }
    }
  }

  return [candidateA, candidateB, candidateC, candidateD];
}

// ── StyleMe wording system prompt (Constitution V1 — locked) ─────────────────
// Exported so tests can assert on tone spec and prohibited-phrase coverage.

export const STYLEME_WORDING_SYSTEM_PROMPT =
  "You are nAia — an excellent personal stylist who is also emotionally intelligent and psychologically perceptive. " +
  "You understand clothes, understand style, and understand what a person needs from getting dressed today. " +
  "observant, calm, tasteful, decisive, understated, specific. Warm without sentimentality. Respond ONLY with valid JSON, no extra text.\n" +
  "Rules you must follow:\n" +
  "1. Base all wording strictly on the evidence provided in the user message. Do not invent product details, fit, fabric, colour, or compatibility not stated.\n" +
  "2. Do not select, rank, add, remove, or reorder products. Do not introduce any product name or handle not explicitly given to you.\n" +
  "3. For uncertain or inferred points, use conditional language (e.g. 'may work well with', 'tends to').\n" +
  "4. Never use these blocked phrases or concepts: 'stunning piece', 'elevate your wardrobe', 'unleash your inner', 'therapy', 'therapeutic', 'treats', 'cures', 'clinical', 'diagnose', 'mental health', 'emotional healing', " +
  "'Absolutely!', 'Obsessed.', 'Gorgeous!', \"You're going to look amazing\", 'This is so you!', 'Trust me.', 'Game-changer.', 'perfect for you', 'matches your vibe', 'super flattering'.\n" +
  "5. Do not describe clothing as treating, curing, or improving any mental or emotional condition.\n" +
  "6. No marketing filler, clichés, or inflated superlatives.\n" +
  "7. confidenceBoost must be a styling observation about the garment, not how the customer will feel. It may acknowledge what the customer asked for but must not promise what the clothes will make them feel. Name one styling decision or relationship in the outfit: a contrast, a proportion, what NOT to add. One sentence, perceptive, specific, slightly warm. " +
  "Do not say: 'Confidence is your best accessory', 'Own the look', 'Keep the rest clean', 'One strong direction is enough.' " +
  "Instead: name a specific styling observation or outfit relationship. Example: 'The blazer is already giving the structure — keep the rest clean and you won't need to do much else.'\n" +
  "8. State (how the customer is feeling today) is CONTEXT ONLY — it describes the customer's brief, not the reason clothing was chosen. Forbidden pattern: \"Because you're stressed, I chose something oversized.\" Required: justify the clothing choice through Intention, Physical Need, garment properties, or Profile evidence — never through State.\n" +
  "9. Show real styling judgment. Write as if you are standing beside the customer, looking at the finished outfit together. Be concrete about what each piece does to the others — how the denim relaxes the top, how the shoes change the energy, how the bag closes the palette. Avoid invented vocabulary a client would need to decode — not 'visual weight', 'register', 'contrast beat', 'restrained edit', 'lower palette'. Natural language, one clear point per sentence.\n" +
  "10. outfitName must feel like a stylist named the look — evoking its palette, material character, styling tension, or identity. Good examples: 'Neutral Ground, Sharpened', 'Quiet Authority in Wool and Denim', 'Oxford, Denim, and a Sharpened Edge', 'Easy Black in Denim'. " +
  "Never: 'Your everyday look', '[intention] for [occasion]', a descriptive list of product names, 'A direction for...', 'Your [occasion] look'.\n" +
  "11. whyThisWorks must connect three things: (1) what the customer wanted TODAY, (2) what this person consistently looks like at their best (PASSPORT identity), and (3) how the specific pieces in this outfit satisfy both. " +
  "Do not list metadata. Do not produce a technical outfit summary. Write 2–4 natural sentences. Never invent fit or comfort claims not stated in the brief.\n" +
  "12. The intention subtly shapes voice — not clothing rules. nAia may acknowledge what the customer asked for today (e.g. 'You wanted something everyday that still feels like you') but must not predict what the clothes will make them feel. 'Feel like myself' → acknowledge familiar identity without sentiment; 'more confident' → clarity and composure; 'softer' → fabric and line; 'sharper' → clean, deliberate lines; 'less exposed' → coverage handled with care, no body-shaming language.\n" +
  "13. Per-piece notes (when present): for each piece, explain what it does to the outfit — its colour role, proportional contribution, how it changes the other pieces. " +
  "Avoid slot templates: 'upper note', 'lower anchor', 'sets the tone', 'holds it together', 'grounds the look', 'completes the look', 'grounds the finish'. Each note should describe a specific relationship.";

// ── Claude wording call (with 8-second timeout + graceful fallback) ───────────

interface ClaudeWordingResponse {
  outfitName: string;
  whyThisWorks: string;
  confidenceBoost: string;
  perfumeNote: string;
}

async function callClaudeForWording(
  moods: string[],
  desiredFeelings: string[],
  occasion: string,
  outcome: StyleMeOutcome,
  primaryTitle: string | null,
  styleMeExplanation: string | null,
  completionPieces: StyleMeCompletionPiece[],
  becoming: string[],
  styleSupport: string[],
  finalNotes: string | null | undefined,
  anchor?: { label: string | null; slot: string | null; colors: string[] } | null,
  stateOtherText?: string | null,
  mode?: StyleMeMode,
  naiaClosetGarments?: Array<{ slot: string; label: string | null }>,
): Promise<StyleMeWording | null> {
  const occasionLabel = occasion.replace(/-/g, " ");
  const moodStr = moods.join(", ");
  const feelingStr = desiredFeelings.join(", ");
  const becomingStr = becoming.map((id) => optionLabel("becoming", id)).join(", ");
  const styleSupportStr = styleSupport.map((id) => optionLabel("style-support", id)).join(", ");
  const safeFinalNotes = finalNotes
    ? finalNotes.replace(/"/g, "'").replace(/\n/g, " ").trim()
    : null;

  const naiaContext =
    mode === "naia" && naiaClosetGarments?.length
      ? `The look is built from the customer's own Closet: ${naiaClosetGarments
          .map((g) => `${g.label ?? g.slot} (${g.slot})`)
          .join(", ")}.`
      : null;

  const context =
    naiaContext ??
    (outcome === "no-eligible-product"
      ? "No specific nAia piece was selected for this session."
      : primaryTitle
      ? `The selected piece is: ${primaryTitle}. Styling guidance: ${styleMeExplanation ?? "(none provided)"}`
      : "The customer is dressing from their own closet.");

  const systemPrompt =
    mode === "naia"
      ? STYLEME_WORDING_SYSTEM_PROMPT +
        "\n9. This look is built entirely from the customer's own Closet — no brand products. Do not reference product brand names, shopping links, or purchasing. Treat the Closet pieces as the primary styling elements."
      : STYLEME_WORDING_SYSTEM_PROMPT;

  const completionContext =
    completionPieces.length > 0
      ? " Generic completion pieces complete the base of the look: " +
        completionPieces.map((p) => `${p.slot} — ${p.description}`).join("; ") +
        " Incorporate these naturally into whyThisWorks — reference their proportion or colour role, not just that they complete the look."
      : "";

  const anchorContext = (() => {
    if (!anchor?.label) return "";
    const colourStr = anchor.colors.length > 0 ? ` (${anchor.colors[0].replace(/-/g, " ")})` : "";
    return ` Anchor piece: ${anchor.label}${colourStr}, slot: ${anchor.slot ?? "unknown"}. In whyThisWorks, explicitly explain the anchor's role in the look — its colour contribution, proportion relationship to the primary piece, and the energy it brings to the occasion.`;
  })();

  const aspirationContext =
    [
      becomingStr ? `Style aspiration: ${becomingStr}.` : "",
      styleSupportStr ? `Style support goal: ${styleSupportStr}.` : "",
      safeFinalNotes ? `Customer's personal note: "${safeFinalNotes}".` : "",
    ]
      .filter(Boolean)
      .join(" ");

  try {
    const result = await Promise.race<ClaudeWordingResponse | null>([
      callClaudeJSON<ClaudeWordingResponse>({
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content:
              `Write wording for a styling result. The customer is feeling: ${moodStr}. ` +
              (stateOtherText ? `The customer described their current state as: "${stateOtherText}". ` : "") +
              `Desired feeling: ${feelingStr}. Occasion: ${occasionLabel}. ${context}` +
              (completionContext ? completionContext : "") +
              (anchorContext ? anchorContext : "") +
              (aspirationContext ? ` ${aspirationContext}` : "") +
              `\n\nReturn a JSON object with exactly these fields:\n` +
              `- outfitName: name this look as a stylist would — evoke its palette, material character, or styling tension (≤8 words). Examples: 'Easy Black in Denim', 'Neutral Ground, Sharpened', 'Quiet in Navy and Bone'. Never: 'Your everyday look', '[intention] for [occasion]'.\n` +
              `- whyThisWorks: 2–3 sentences connecting what the customer wanted today, who they consistently are, and how this specific piece delivers both. Explain the styling relationship — proportion, colour role, register. Never invent fit or comfort claims not stated in the brief.\n` +
              `- confidenceBoost: what a trusted stylist says at the end — one perceptive, specific note about a styling decision or outfit relationship. Not a slogan. Not emotional affirmation. Name something real: a contrast, proportion decision, what NOT to add. Example: 'The blazer is already giving the structure — keep the rest clean and you won't need to do much else.'\n` +
              `- perfumeNote: 1 sentence of scent direction (type of notes, not a brand name)`,
          },
        ],
        maxTokens: 400,
        temperature: 1,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);

    if (!result || typeof result !== "object") return null;
    if (!result.outfitName || !result.whyThisWorks || !result.confidenceBoost) return null;

    const outfitName = String(result.outfitName).slice(0, 80);
    const whyThisWorks = String(result.whyThisWorks);
    const confidenceBoost = String(result.confidenceBoost);

    // Reject output containing blocked terms — deterministic fallback handles it
    if (containsBlockedTerms(`${outfitName} ${whyThisWorks} ${confidenceBoost}`)) return null;

    return {
      outfitName,
      whyThisWorks,
      confidenceBoost,
      perfumeNote: result.perfumeNote ? String(result.perfumeNote) : null,
    };
  } catch {
    return null;
  }
}

// ── nAia candidate occasion evidence ─────────────────────────────────────────
// Per-piece and per-candidate occasion fit computed from Closet item metadata.
// Used for (a) factual model context in the selection prompt, (b) occasion-aware
// fallback selection, and (c) staging diagnostics.
// Limitation: formality signals (formalityConditional) are not currently stored
// in item occasions arrays and therefore do not contribute to occasionScore.

type PieceOccasionStatus =
  | "match"        // item.occasions includes session.occasion
  | "not-listed"   // item.occasions is non-empty but does not include session.occasion
  | "no-metadata"; // item.occasions is empty — treated as neutral, NOT as a mismatch

// Structural role of a piece: affects how it is weighted in the fallback comparison.
// base  = core clothing that defines the outfit (top, bottom, dress, set)
// shoe  = footwear
// optional = discretionary layers and accessories (outerwear, bag, accessory, jewelry)
export type PieceRole = "base" | "shoe" | "optional";

const BASE_CLOTHING_SLOTS = new Set(["top", "bottom", "dress", "set"]);
const SHOE_SLOTS = new Set(["shoe"]);

function getPieceRole(slot: string): PieceRole {
  if (BASE_CLOTHING_SLOTS.has(slot)) return "base";
  if (SHOE_SLOTS.has(slot)) return "shoe";
  return "optional";
}

// ── Whole-outfit formality evaluation ────────────────────────────────────────
// Ordinal scale: casual(1) … evening(6). Used to judge outfit register against
// the session's occasion and any explicit formality signal. Gender-neutral.
export const FORMALITY_RANK: Record<string, number> = {
  "casual":           1,
  "smart-casual":     2,
  "business-casual":  3,
  "business-formal":  4,
  "occasion":         5,
  "evening":          6,
};

// Per-occasion expected base+shoe formality range (inclusive ordinal bounds).
// "everyday" covers ranks 1–2 (casual → smart-casual); "work" covers 2–4; etc.
const OCCASION_FORMALITY_TARGET: Record<string, { min: number; max: number }> = {
  "everyday":  { min: 1, max: 2 },
  "work":      { min: 2, max: 4 },
  "dinner":    { min: 2, max: 5 },
  "date":      { min: 2, max: 3 },
  "event":     { min: 3, max: 6 },
  "night-out": { min: 2, max: 6 },
  "family":    { min: 1, max: 2 },
  "travel":    { min: 1, max: 2 },
  "active":    { min: 1, max: 1 },
};

// Maps each StyleMe session occasion ID (canonical engine IDs post-mapping) to the
// Canonical session→closet vocabulary bridge. Imported and re-exported here so
// callers that import from styleme-result.server.ts continue to work unchanged.
export { SESSION_OCCASION_TO_CLOSET_TOKENS } from "./styleme-occasion-tokens.js";
import { matchesSessionOccasion } from "./styleme-occasion-tokens.js";

// formalityConditional narrows the target range (intersection, not expansion).
const FORMALITY_CONDITIONAL_ADJUSTMENTS: Record<string, { min: number; max: number }> = {
  "formality-relaxed": { min: 1, max: 2 },
  "formality-smart":   { min: 2, max: 3 },
  "formality-polished":{ min: 3, max: 4 },
  "formality-occasion":{ min: 4, max: 6 },
};

export function getTargetFormalityRange(
  occasion: string,
  formalityConditional: string | null,
): { min: number; max: number } {
  const base = OCCASION_FORMALITY_TARGET[occasion] ?? { min: 1, max: 4 };
  if (!formalityConditional) return base;
  const adj = FORMALITY_CONDITIONAL_ADJUSTMENTS[formalityConditional];
  if (!adj) return base;
  return { min: Math.max(base.min, adj.min), max: Math.min(base.max, adj.max) };
}

// Per-slot formality contribution weight (0 = excluded from register judgment).
// Outerwear is meaningful but slightly discounted — it can be removed and is often
// transitional. Bag/accessory/jewelry carry no outfit-register signal.
const PIECE_FORMALITY_WEIGHT: Record<string, number> = {
  top: 1.0, bottom: 1.0, dress: 1.0, set: 1.0,
  shoe: 1.0,
  outerwear: 0.7,
  bag: 0, accessory: 0, jewelry: 0, unknown: 0,
};

// Whole-outfit suitability evaluation: formality register + occasion coverage.
// This is the single shared ranker used for candidate pre-sorting, model evidence,
// deterministic fallback, and diagnostics. No garment-name exceptions.
export interface OutfitSuitabilityScore {
  // Formality register — includes outerwear (at reduced weight)
  pieceFormalities: Array<{ slot: string; formality: string | null; weight: number }>;
  // Weighted-average formality rank across all contributing pieces (null = no data).
  // Used as the diagnostic display value and formalityFit determination.
  outfitFormalityRank: number | null;
  targetFormalityRange: { min: number; max: number };
  formalityFit: "within-target" | "overdressed" | "underdressed" | "unknown";
  // Weighted-average distance from nearest target edge (0 = within; + = steps above; − = steps below)
  formalityOvershoot: number;
  // Occasion coverage (mirrors existing per-candidate evidence)
  occasionCoverageRatio: number;
  explicitNonMatchCount: number;
  baseAndShoeOccasionMatchCount: number;
  optionalPieceCount: number;
  // Composite ranking score (higher = better fit for session brief)
  compositeScore: number;
  reasons: string[];
}

export function evaluateCompleteOutfit(
  candidate: OutfitCandidate,
  allItems: ClosetAnchorInput[],
  session: Pick<StyleMeSessionInput, "occasion" | "formalityConditional" | "moods" | "desiredFeelings">,
): OutfitSuitabilityScore {
  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const targetFormalityRange = getTargetFormalityRange(
    session.occasion,
    session.formalityConditional ?? null,
  );

  // Build per-piece formality data for all contributing slots.
  const pieceFormalities = candidate.pieces.map((p) => {
    const item = itemMap.get(p.closetId);
    const weight = PIECE_FORMALITY_WEIGHT[p.slot] ?? 0;
    return { slot: p.slot, formality: item?.formality ?? null, weight };
  });

  // Outerwear and zero-weight pieces (bag, accessory, jewelry) count as "optional burden"
  // for compositeScore tie-breaking. Outerwear is removable and should not tip a close
  // comparison over a cleaner base outfit, even when it contributes to formality register.
  const optionalPieceCount = pieceFormalities.filter((p) => p.slot === "outerwear" || p.weight === 0).length;

  // Per-piece weighted formality penalty — normalized so piece count alone does not
  // inflate the penalty. Each piece with known formality contributes independently:
  //   overdressed → stronger penalty  (−3 per step above targetMax)
  //   underdressed → lighter penalty  (−1.5 per step below targetMin)
  //   within target → 0 contribution
  // Adding more within-target pieces never increases the penalty.
  let totalKnownWeight = 0;
  let weightedRankSum = 0;
  let weightedPenaltySum = 0;

  for (const pf of pieceFormalities) {
    if (pf.weight === 0 || pf.formality === null) continue;
    const rank = FORMALITY_RANK[pf.formality] ?? null;
    if (rank === null) continue;
    totalKnownWeight += pf.weight;
    weightedRankSum += rank * pf.weight;
    const deviation =
      rank > targetFormalityRange.max ? rank - targetFormalityRange.max
      : rank < targetFormalityRange.min ? rank - targetFormalityRange.min
      : 0;
    const contribution =
      deviation > 0 ? deviation * pf.weight * -3    // overdressed
      : deviation < 0 ? deviation * pf.weight * 1.5 // underdressed (negative deviation × positive multiplier = negative)
      : 0;
    weightedPenaltySum += contribution;
  }

  // Weighted average rank for diagnostic display and formalityFit determination.
  const outfitFormalityRank = totalKnownWeight > 0 ? weightedRankSum / totalKnownWeight : null;
  // Normalized penalty (per unit of contributing formality weight).
  const normalizedFormalityPenalty = totalKnownWeight > 0 ? weightedPenaltySum / totalKnownWeight : 0;

  let formalityFit: OutfitSuitabilityScore["formalityFit"] = "unknown";
  let formalityOvershoot = 0;
  if (outfitFormalityRank !== null) {
    if (outfitFormalityRank >= targetFormalityRange.min && outfitFormalityRank <= targetFormalityRange.max) {
      formalityFit = "within-target";
    } else if (outfitFormalityRank > targetFormalityRange.max) {
      formalityFit = "overdressed";
      formalityOvershoot = outfitFormalityRank - targetFormalityRange.max;
    } else {
      formalityFit = "underdressed";
      formalityOvershoot = -(targetFormalityRange.min - outfitFormalityRank);
    }
  }

  // Occasion coverage — replicates buildCandidateOccasionEvidence logic for the
  // composite score; both systems share a definition of "match"/"not-listed".
  const pieces = candidate.pieces.map((p) => {
    const item = itemMap.get(p.closetId);
    const itemOccasions: string[] = item?.occasions ?? [];
    const occasionStatus =
      itemOccasions.length === 0
        ? "no-metadata"
        : matchesSessionOccasion(itemOccasions, session.occasion)
          ? "match"
          : "not-listed";
    const pieceRole = getPieceRole(p.slot);
    return { occasionStatus, pieceRole };
  });

  const knownOccasionPieces = pieces.filter((p) => p.occasionStatus !== "no-metadata").length;
  const matchingOccasionPieces = pieces.filter((p) => p.occasionStatus === "match").length;
  const explicitNonMatchCount = pieces.filter((p) => p.occasionStatus === "not-listed").length;
  const occasionCoverageRatio = knownOccasionPieces === 0 ? 1.0 : matchingOccasionPieces / knownOccasionPieces;
  const baseAndShoeOccasionMatchCount = pieces.filter(
    (p) => p.occasionStatus === "match" && (p.pieceRole === "base" || p.pieceRole === "shoe"),
  ).length;

  // compositeScore: occasion coverage (0–10) + normalized formality penalty (≤0) + coverage penalties.
  // occasionCoverageRatio is already 0–1; ×10 gives 0–10.
  const compositeScore =
    occasionCoverageRatio * 10 +
    normalizedFormalityPenalty +
    explicitNonMatchCount * -2 +
    optionalPieceCount * -0.5;

  const reasons: string[] = [];
  if (formalityFit === "overdressed") {
    reasons.push(
      `Outfit register (weighted rank ${outfitFormalityRank?.toFixed(2)}) exceeds target ` +
      `${targetFormalityRange.min}–${targetFormalityRange.max} for ${session.occasion} ` +
      `by ${formalityOvershoot.toFixed(2)} steps.`,
    );
  } else if (formalityFit === "within-target") {
    reasons.push(`Outfit register within target range for ${session.occasion}.`);
  } else if (formalityFit === "underdressed") {
    reasons.push(
      `Outfit register (weighted rank ${outfitFormalityRank?.toFixed(2)}) below target ` +
      `${targetFormalityRange.min}–${targetFormalityRange.max} for ${session.occasion}.`,
    );
  } else {
    reasons.push("Insufficient formality metadata — using occasion coverage only.");
  }
  if (explicitNonMatchCount > 0) {
    reasons.push(
      `${explicitNonMatchCount} piece${explicitNonMatchCount !== 1 ? "s" : ""} not listed for ${session.occasion}.`,
    );
  }
  if (normalizedFormalityPenalty < 0 && formalityFit === "within-target") {
    reasons.push(
      `Formality note: individual piece(s) outside target register contribute penalty (${normalizedFormalityPenalty.toFixed(2)}).`,
    );
  }

  return {
    pieceFormalities, outfitFormalityRank, targetFormalityRange,
    formalityFit, formalityOvershoot,
    occasionCoverageRatio, explicitNonMatchCount, baseAndShoeOccasionMatchCount,
    optionalPieceCount, compositeScore, reasons,
  };
}

interface CandidatePieceEvidence {
  closetId: string;
  slot: string;
  label: string | null;
  itemOccasions: string[];
  occasionStatus: PieceOccasionStatus;
  pieceRole: PieceRole;
}

export interface CandidateOccasionEvidence {
  candidateId: string;
  pieces: CandidatePieceEvidence[];
  // ── Normalized comparison fields (Fix A revised formula) ──────────────────
  /** Pieces with a non-empty occasions array (known metadata). */
  knownOccasionPieces: number;
  /** Pieces where occasionStatus === "match". */
  matchingOccasionPieces: number;
  /** Pieces where occasionStatus === "not-listed" (explicit non-match). "no-metadata" is neutral. */
  explicitNonMatchCount: number;
  /** matchingOccasionPieces / knownOccasionPieces; 1.0 when no pieces have known metadata. */
  occasionCoverageRatio: number;
  /** Base clothing and shoe pieces where occasionStatus === "match". */
  baseAndShoeMatchCount: number;
  /** Count of outerwear, bag, accessory, and jewelry pieces. */
  optionalPieceCount: number;
  // ── Backward-compat aliases (kept for reference, not used in ranking) ─────
  /** @deprecated Use matchingOccasionPieces * 10 for display; not used in ranking. */
  occasionScore: number;
  /** @deprecated Alias for explicitNonMatchCount. */
  nonMatchingPieceCount: number;
}

export function buildCandidateOccasionEvidence(
  candidates: OutfitCandidate[],
  allItems: ClosetAnchorInput[],
  occasion: string,
): Map<string, CandidateOccasionEvidence> {
  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const result = new Map<string, CandidateOccasionEvidence>();

  for (const candidate of candidates) {
    const pieces: CandidatePieceEvidence[] = candidate.pieces.map((p) => {
      const item = itemMap.get(p.closetId);
      const itemOccasions: string[] = item?.occasions ?? [];
      const occasionStatus: PieceOccasionStatus =
        itemOccasions.length === 0
          ? "no-metadata"
          : matchesSessionOccasion(itemOccasions, occasion)
            ? "match"
            : "not-listed";
      const pieceRole = getPieceRole(p.slot as string);
      return { closetId: p.closetId, slot: p.slot as string, label: p.label, itemOccasions, occasionStatus, pieceRole };
    });

    const knownOccasionPieces = pieces.filter((pe) => pe.itemOccasions.length > 0).length;
    const matchingOccasionPieces = pieces.filter((pe) => pe.occasionStatus === "match").length;
    const explicitNonMatchCount = pieces.filter((pe) => pe.occasionStatus === "not-listed").length;
    const occasionCoverageRatio = knownOccasionPieces === 0 ? 1.0 : matchingOccasionPieces / knownOccasionPieces;
    const baseAndShoeMatchCount = pieces.filter(
      (pe) => pe.occasionStatus === "match" && (pe.pieceRole === "base" || pe.pieceRole === "shoe"),
    ).length;
    const optionalPieceCount = pieces.filter((pe) => pe.pieceRole === "optional").length;

    result.set(candidate.id, {
      candidateId: candidate.id,
      pieces,
      knownOccasionPieces,
      matchingOccasionPieces,
      explicitNonMatchCount,
      occasionCoverageRatio,
      baseAndShoeMatchCount,
      optionalPieceCount,
      occasionScore: matchingOccasionPieces * 10,      // backward compat
      nonMatchingPieceCount: explicitNonMatchCount,     // backward compat
    });
  }
  return result;
}

// Staging-only: logs normalized selection evidence without altering the selection path.
// No-op on production.
function logNaiaSelectionDiag(data: {
  sessionOccasion: string;
  formalityConditional: string | null;
  candidateCount: number;
  evidenceSummary: Array<{
    id: string;
    knownOccasionPieces: number;
    matchingOccasionPieces: number;
    explicitNonMatches: number;
    occasionCoverageRatio: number;
    baseAndShoeMatchCount: number;
    optionalPieceCount: number;
    // Whole-outfit suitability fields (null when formality data insufficient)
    formalityFit: string;
    outfitFormalityRank: number | null;
    targetFormalityRange: { min: number; max: number };
    compositeScore: number;
    deterministicFallbackRank: string;
    pieces: Array<{ slot: string; pieceRole: string; label: string | null; occasionStatus: string; formality: string | null }>;
  }>;
  modelCallAttempted: boolean;
  modelReturnedId?: string | null;
  modelValidationPassed?: boolean;
  modelDurationMs?: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  finalCandidateId: string;
}): void {
  if (process.env.NAIA_STYLEME_DIAGNOSTICS !== "true") return;
  console.log("[nAia-selection-diag]", JSON.stringify(data));
}

// ── nAia candidate selection Claude call ─────────────────────────────────────
// Single Claude call that selects the best outfit candidate AND generates all
// outfit wording plus per-piece notes. No second AI round trip.
// Returns null on failure; caller falls back to rankedCandidates[0] (compositeScore order).

interface NaiaSelectionResponse {
  selectedCandidate: string;
  outfitName: string;
  whyThisWorks: string;
  confidenceBoost: string;
  perfumeNote: string | null;
  perPieceNotes: Array<{ id: string; note: string }>;
}

// ── Label lookup tables for StyleMe session answers (not in quizQuestions) ───
// These mirror the options defined in the session route files. Kept here as a
// single source of truth for model payload formatting.

export const NAIA_STATE_LABELS: Record<string, string> = {
  "feel-good":                "I feel good",
  "stressed-overloaded":      "Stressed / overloaded",
  "low-energy":               "Low-energy",
  "not-feeling-like-myself":  "I don't really feel like myself",
  "physically-uncomfortable": "Physically uncomfortable",
  "self-conscious":           "Self-conscious",
  "going-through-change":     "I'm going through something",
  "want-reset":               "I feel like I need a reset",
  "nothing-in-particular":    "I feel pretty neutral",
  "other":                    "Other (see note below)",
};

export const NAIA_INTENTION_LABELS: Record<string, string> = {
  "feel-like-myself":  "Help me feel like myself",
  "give-confidence":   "Give me confidence",
  "ground-me":         "Ground me",
  "make-it-easy":      "Make things feel easy",
  "feel-put-together": "Help me feel put together",
  "feel-attractive":   "Make me feel attractive",
  "give-energy":       "Give me energy",
  "feel-softer":       "Help me feel softer",
  "feel-sharper":      "Help me feel sharper",
  "feel-less-exposed": "Help me feel less exposed",
  "express-myself":    "Let me express myself",
};

export const NAIA_BODY_NEED_LABELS: Record<string, string> = {
  "waist-definition":                "Define my waist",
  "soft-and-forgiving-around-waist": "Feel easy around my waist",
  "more-coverage":                   "Give me more coverage",
  "nothing-clingy":                  "Nothing clingy",
  "relaxed":                         "Relaxed fit",
  "structured":                      "Give me some structure",
  "elongates":                       "Create a longer line",
  "balances":                        "Balance my proportions",
  "comfortable-elevated":            "Comfortable but polished",
};

export const NAIA_CURRENT_GOAL_LABELS: Record<string, string> = {
  "understand-my-style":        "Understand my personal style",
  "feel-more-like-myself":      "Feel more like myself in what I wear",
  "use-what-i-own":             "Get more from what I already own",
  "easier-getting-dressed":     "Make getting dressed easier",
  "stop-regret-purchases":      "Stop buying things I never wear",
  "more-cohesive-wardrobe":     "Build a more cohesive wardrobe",
  "dress-for-my-life":          "Dress better for my actual life",
  "refresh-my-style":           "Refresh my style",
  "specific-event-trip-change": "Dress for a specific event or change",
  "not-sure-yet":               "Not sure yet",
};

export const NAIA_SUCCESSFUL_OUTFIT_LABELS: Record<string, string> = {
  "feel-like-myself":    "I feel completely like myself",
  "confidence":          "Confidence",
  "feel-put-together":   "I feel put-together",
  "comfort-ease":        "Comfort and ease of movement",
  "sense-of-expression": "A sense of creative expression",
  "feel-attractive":     "I feel attractive",
  "sense-of-power":      "A sense of power",
  "effortlessness":      "Effortlessness",
  "not-sure":            "I'm not sure yet",
};

export const NAIA_FIT_CONCERN_LABELS: Record<string, string> = {
  "tops-pull-bust":        "Tops, shirts or jackets can feel tight across chest / back",
  "waistbands-gape":       "Waistbands often gape",
  "tight-hips-thighs":     "Trousers can feel tight through seat, hips or thighs",
  "uncomfortable-rise":    "Trouser rises can feel uncomfortable",
  "shoulder-sleeve-fit":   "Shoulder or sleeve fit can be difficult",
  "often-too-short":       "Clothes are often too short",
  "often-too-long":        "Clothes are often too long",
  "less-cling-midsection": "Prefer less cling around midsection",
  "shoe-width-comfort":    "Shoe width / comfort can be difficult",
  "size-changes":          "Size changes",
};

export const NAIA_STRUCTURE_LABELS: Record<string, string> = {
  "soft-fluid":         "Soft and fluid",
  "lightly-structured": "Lightly structured",
  "sharp-tailored":     "Sharp and tailored",
  "balanced-structure": "A balance of soft and structured",
};

export async function callClaudeForNaiaSelection(
  candidates: OutfitCandidate[],
  session: StyleMeSessionInput,
  profile?: StyleMeProfileSignals | null,
  occasionEvidence?: Map<string, CandidateOccasionEvidence>,
  allItems?: ClosetAnchorInput[],
  outfitScores?: Map<string, OutfitSuitabilityScore>,
): Promise<{
  candidate: OutfitCandidate;
  wording: StyleMeWording;
  perPieceNotes: Map<string, string>;
} | null> {
  const occasionLabel = session.occasion.replace(/-/g, " ");
  const moodStr = session.moods.join(", ");
  const feelingStr = session.desiredFeelings.join(", ");

  // ── TODAY'S BRIEF ─────────────────────────────────────────────────────────
  // State: resolve label; include free-text note only when state === "other"
  const stateLabel = session.state
    ? (NAIA_STATE_LABELS[session.state] ?? session.state.replace(/-/g, " "))
    : null;
  const stateNoteLine = session.state === "other" && session.stateOtherText
    ? ` (Customer's own words: "${session.stateOtherText}")`
    : "";

  // Intentions: resolve to human-readable labels
  const intentionsStr = (session.intentions ?? [])
    .map((id) => NAIA_INTENTION_LABELS[id] ?? id.replace(/-/g, " "))
    .join("; ");

  // Fit / Comfort: active body needs → labels; or explicit "none selected"
  const activeBodyNeeds = (session.bodyNeeds ?? []).filter((id) => id !== "nothing-specific");
  const fitComfortLine = activeBodyNeeds.length > 0
    ? activeBodyNeeds
        .map((id) => NAIA_BODY_NEED_LABELS[id] ?? id.replace(/-/g, " "))
        .join("; ")
    : "None selected — do not invent waist, coverage, softness, structure, or fit-specific claims.";

  // Formality modifier (if present)
  const formalityModifier = session.formalityConditional
    ? ` (${session.formalityConditional.replace(/^formality-/, "").replace(/-/g, " ")})`
    : "";

  const todayBlock = [
    `TODAY'S BRIEF`,
    `Occasion: ${occasionLabel}${formalityModifier}.`,
    stateLabel ? `State: ${stateLabel}.${stateNoteLine}` : null,
    `Intention: ${intentionsStr || "not specified"}.`,
    `Fit / Comfort: ${fitComfortLine}`,
    `Mood: ${moodStr || "not specified"}. Desired feeling: ${feelingStr || "not specified"}.`,
  ].filter(Boolean).join("\n");

  // ── STYLE PASSPORT ────────────────────────────────────────────────────────
  const personalitiesStr = (profile?.stylePersonalities ?? [])
    .map((id) => optionLabel("style-personalities", id)).join(", ");
  const silhouetteStr = (profile?.silhouette ?? []).slice(0, 3)
    .map((id) => optionLabel("silhouette", id)).join(", ");
  const structureStr = profile?.structure
    ? (NAIA_STRUCTURE_LABELS[profile.structure] ?? profile.structure.replace(/-/g, " "))
    : null;
  const favColorStr = (profile?.favoriteColors ?? [])
    .map((c) => c.replace(/-/g, " ")).join(", ");
  const avoidColorStr = (profile?.avoidColors ?? [])
    .map((c) => c.replace(/-/g, " ")).join(", ");
  const bodyFocusStr = (profile?.bodyFocusAreas ?? [])
    .map((id) => id.replace(/-/g, " ")).join(", ");
  const bodyAvoidStr = (profile?.bodyAvoidAreas ?? [])
    .map((id) => id.replace(/-/g, " ")).join(", ");
  const becomingStr = (profile?.becoming ?? [])
    .map((id) => optionLabel("becoming", id)).join(", ");
  const styleSupportStr = (profile?.styleSupport ?? [])
    .map((id) => optionLabel("style-support", id)).join(", ");
  const desiredImpressionStr = (profile?.desiredImpression ?? [])
    .map((id) => optionLabel("desired-impression", id)).join(", ");
  const lifestyleStr = (profile?.lifestyle ?? [])
    .map((id) => optionLabel("lifestyle", id)).join(", ");
  const currentGoalStr = (profile?.currentGoal ?? [])
    .filter((id) => id !== "not-sure-yet")
    .map((id) => NAIA_CURRENT_GOAL_LABELS[id] ?? id.replace(/-/g, " "))
    .join("; ");
  const successfulOutfitStr = (profile?.successfulOutfitGives ?? [])
    .filter((id) => id !== "not-sure")
    .map((id) => NAIA_SUCCESSFUL_OUTFIT_LABELS[id] ?? id.replace(/-/g, " "))
    .join("; ");
  const fitPreferencesStr = (profile?.fitPreferences ?? [])
    .map((id) => optionLabel("fit-concerns", id)).join(", ");
  const activeFitConcerns = (profile?.fitConcerns ?? []).filter((id) => id !== "no-fit-problems");
  const fitConcernsStr = activeFitConcerns
    .map((id) => NAIA_FIT_CONCERN_LABELS[id] ?? id.replace(/-/g, " "))
    .join("; ");
  const safeFitConcernsNote = profile?.fitConcernsNote
    ? profile.fitConcernsNote.replace(/"/g, "'").replace(/\n/g, " ").trim()
    : null;
  const coverageStr = [
    profile?.preferredCoverage ? optionLabel("preferred-coverage", profile.preferredCoverage) : null,
    (profile?.coveragePreferences ?? []).map((id) => optionLabel("preferred-coverage", id)).join(", "),
  ].filter(Boolean).join("; ");
  const dressingStr = (profile?.dressingPreferences ?? [])
    .map((id) => optionLabel("dressing-preferences", id)).join(", ");
  const safeFinalNotes = profile?.finalNotes
    ? profile.finalNotes.replace(/"/g, "'").replace(/\n/g, " ").trim()
    : null;

  const passportBlock = [
    `STYLE PASSPORT`,
    `Style identity: ${personalitiesStr || "not specified"}.`,
    silhouetteStr ? `Silhouette preference: ${silhouetteStr}.` : null,
    structureStr ? `Structure preference: ${structureStr}.` : null,
    favColorStr ? `Colours loved: ${favColorStr}.` : null,
    avoidColorStr ? `Colours usually avoided: ${avoidColorStr} — prefer alternatives where available, but not a hard exclusion.` : null,
    bodyFocusStr ? `Areas the customer prefers to highlight: ${bodyFocusStr}.` : null,
    bodyAvoidStr ? `Areas the customer prefers not to emphasise: ${bodyAvoidStr}.` : null,
    becomingStr ? `Becoming / aspiration: ${becomingStr}.` : null,
    styleSupportStr ? `Style support goal: ${styleSupportStr}.` : null,
    desiredImpressionStr ? `Desired impression: ${desiredImpressionStr}.` : null,
    currentGoalStr ? `Current style focus (context only): ${currentGoalStr}.` : null,
    successfulOutfitStr ? `What makes an outfit successful for this customer: ${successfulOutfitStr}.` : null,
    lifestyleStr ? `Lifestyle context: ${lifestyleStr}.` : null,
    fitPreferencesStr ? `Persistent fit preference: ${fitPreferencesStr}.` : null,
    fitConcernsStr ? `Persistent fit considerations (active even when today's Fit/Comfort is "None selected"): ${fitConcernsStr}.${safeFitConcernsNote ? ` Customer note: "${safeFitConcernsNote}".` : ""}` : null,
    coverageStr ? `Persistent coverage preference: ${coverageStr} — this is a hard boundary, stronger than today's fit/comfort selection.` : null,
    dressingStr ? `Dressing constraint: ${dressingStr} — hard exclusion; never violate.` : null,
    safeFinalNotes ? `Customer's own note: "${safeFinalNotes}".` : null,
  ].filter(Boolean).join("\n");

  const candidateDescs = candidates
    .map((c) => {
      const evidence = occasionEvidence?.get(c.id);
      const suit = outfitScores?.get(c.id);
      const lines = c.pieces.map((p) => {
        const pe = evidence?.pieces.find((e) => e.closetId === p.closetId);
        const roleTag = pe ? `, ${pe.pieceRole}` : "";
        const base = `  - ${p.label ?? p.slot} (${p.slot}${roleTag})${p.colors[0] ? `, ${p.colors[0]}` : ""} [id:${p.closetId}]`;
        if (!pe) return base;
        const occNote =
          pe.occasionStatus === "match"
            ? ` | today's ${session.occasion}: listed`
            : pe.occasionStatus === "not-listed"
              ? ` | today's ${session.occasion}: not listed (on record: ${pe.itemOccasions.join(", ")})`
              : ` | today's ${session.occasion}: no occasion metadata`;
        return base + occNote;
      });
      if (evidence) {
        lines.push(
          `  Occasion evidence for ${session.occasion}: ${evidence.matchingOccasionPieces} of ${evidence.knownOccasionPieces} pieces with known metadata listed` +
          ` (coverage ${Math.round(evidence.occasionCoverageRatio * 100)}%; ${evidence.explicitNonMatchCount} explicit non-match${evidence.explicitNonMatchCount !== 1 ? "es" : ""}).`,
        );
      }
      // Outfit-level register judgment from evaluateCompleteOutfit
      if (suit && suit.outfitFormalityRank !== null) {
        const targetLabel = `${Object.entries(FORMALITY_RANK).find(([, r]) => r === suit.targetFormalityRange.min)?.[0] ?? suit.targetFormalityRange.min}–${Object.entries(FORMALITY_RANK).find(([, r]) => r === suit.targetFormalityRange.max)?.[0] ?? suit.targetFormalityRange.max}`;
        const fitNote =
          suit.formalityFit === "within-target" ? "WITHIN TARGET" :
          suit.formalityFit === "overdressed" ? `OVERDRESSED by ${suit.formalityOvershoot.toFixed(2)} steps` :
          `UNDERDRESSED by ${Math.abs(suit.formalityOvershoot).toFixed(2)} steps`;
        lines.push(
          `  Outfit register: weighted formality rank = ${suit.outfitFormalityRank.toFixed(2)}; target for ${session.occasion} = ${targetLabel}. ${fitNote}.`,
        );
      } else if (suit) {
        lines.push(`  Outfit register: insufficient formality metadata — occasion coverage used only.`);
      }
      return `Candidate ${c.id}:\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const selectionHint = (() => {
    if (candidates.length === 1) {
      return `Only Candidate ${candidates[0].id} is available — select ${candidates[0].id}.`;
    }
    // Compare every non-first candidate against the first to describe what differs.
    const ref = candidates[0];
    const refIds = new Set(ref.pieces.map((p) => p.closetId));
    const notes: string[] = [];
    for (const other of candidates.slice(1)) {
      const otherIds = new Set(other.pieces.map((p) => p.closetId));
      const onlyInRef = ref.pieces.find((p) => !otherIds.has(p.closetId));
      const onlyInOther = other.pieces.find((p) => !refIds.has(p.closetId));
      if (onlyInRef && onlyInOther && onlyInRef.slot === onlyInOther.slot) {
        notes.push(
          `Candidate ${ref.id} uses the ${onlyInRef.label ?? onlyInRef.slot}; ` +
          `Candidate ${other.id} replaces it with the ${onlyInOther.label ?? onlyInOther.slot} (${onlyInOther.slot}).`,
        );
      } else if (onlyInRef && !onlyInOther) {
        if (onlyInRef.slot === "outerwear") {
          notes.push(
            `Candidate ${ref.id} includes ${onlyInRef.label ?? onlyInRef.slot}; Candidate ${other.id} presents the same base without it. ` +
            `Compare the complete outfits against today's occasion, explicit formality, intention and Passport identity. ` +
            `Choose the version in which the layer meaningfully improves the outfit for today's brief without pushing the overall look into a more formal or structured register than requested. ` +
            `If the layer adds useful structure while remaining appropriate for the occasion, keep it. ` +
            `If it adds unnecessary formality or does not meaningfully improve the look, choose the edited version.`,
          );
        } else {
          notes.push(
            `Candidate ${ref.id} includes ${onlyInRef.label ?? onlyInRef.slot}; ` +
            `Candidate ${other.id} is the edited look without it.`,
          );
        }
      }
    }
    return (notes.length > 0 ? notes.join(" ") + " " : "") +
      "Choose the candidate that best suits the customer's brief and occasion.";
  })();

  const systemPrompt =
    STYLEME_WORDING_SYSTEM_PROMPT +
    "\n9. This look is built entirely from the customer's own Closet — no brand products. Do not reference product brand names, shopping links, or purchasing. Treat the Closet pieces as the primary styling elements." +
    "\n10. When writing perPieceNotes, use the correct grammatical number for each garment name. Known plural garments include: trousers, jeans, shorts, leggings, chinos, joggers, loafers, sneakers, trainers, boots, heels, flats, slides, earrings, sunglasses, cufflinks. When the number is uncertain, use a participial phrase ('Adding a contrast note…', 'Grounding the look…') to avoid subject-verb mismatch. Do not use generic phrases like 'completes the look', 'forms the upper half', or 'brings the outfit into appropriate territory'." +
    "\n11. You will receive two structured sections: TODAY'S BRIEF and STYLE PASSPORT. Use both together. Priority order: (1) hard constraints — dressing boundaries, persistent coverage preferences, firm colour avoidances; (2) today's occasion and any explicit formality signal; (3) today's stated intention; (4) today's state (context only — do not convert state into garment rules); (5) Passport identity, silhouette, and aspirations. The Passport should differentiate between equally occasion-appropriate candidates — it must not override today's occasion or make an inappropriate outfit acceptable. An everyday brief with a Classic & Polished Passport should produce an everyday outfit that feels classic and polished — not workwear." +
    "\n12. GROUNDING RULE: Every claim in whyThisWorks, confidenceBoost, and perPieceNotes must be traceable to today's answers, the Passport, or actual garment metadata. If Fit / Comfort says 'None selected', do not mention waistbands, coverage needs, ease, softness, body-hugging, structure, or any physical comfort claim. If a Passport preference influenced the choice, you may name it explicitly: e.g. 'Jeans and sneakers keep this everyday, while the tailored blazer honours your Classic & Polished Passport.'";

  const userMessage =
    `Select the best complete outfit for this customer and write all wording for it.\n\n` +
    `${todayBlock}\n\n` +
    `${passportBlock}\n\n` +
    `${candidateDescs}\n\n` +
    `${selectionHint}\n\n` +
    `Choose the candidate that is: (1) appropriate for today's occasion and formality; (2) compliant with all hard constraints; (3) the strongest expression of this customer's Passport identity within today's context.\n\n` +
    `Return a JSON object with exactly these fields:\n` +
    `- selectedCandidate: ${candidates.map((c) => `"${c.id}"`).join(" or ")}\n` +
    `- outfitName: name this look as a stylist would — evoke its palette, material character, styling tension, or identity (≤8 words). Examples: 'Easy Black in Denim', 'Neutral Ground, Sharpened', 'Quiet in Navy and Bone'. Never: 'Your everyday look', '[intention] for [occasion]', a list of garment names.\n` +
    `- whyThisWorks: 2–4 sentences connecting TODAY (what the customer wanted) + PASSPORT (who they consistently are) + THE OUTFIT (how these specific pieces deliver both). Start with what they wanted today, explain how the pieces satisfy both their brief and their identity. Never invent fit or comfort claims not stated in TODAY'S BRIEF.\n` +
    `- confidenceBoost: what a trusted stylist says at the end — one perceptive, specific note about a styling decision or outfit relationship. Not a slogan. Not emotional affirmation. Name something real: a contrast, a proportion decision, what NOT to add. Example: "Don't add much more here — the contrast between the black top and blue denim is already giving the outfit its shape."\n` +
    `- perfumeNote: 1 sentence of scent direction (type of notes, not a brand name)\n` +
    `- perPieceNotes: array of { "id": "<closetId>", "note": "<1–2 sentences>" } for every piece in the selected candidate. For each piece: explain what it does to the rest of the outfit — its colour role, how it affects proportion, why it's right for this person today. Do not use slot templates ('upper note', 'lower anchor', 'sets the tone', 'grounds the look', 'holds it together'). Each note should describe a specific relationship. Use the garment name from the candidate list.`;

  const t0 = Date.now();
  const diagLog = (stage: string, extra?: Record<string, unknown>) => {
    if (process.env.NAIA_STYLEME_DIAGNOSTICS === "true") {
      console.log("[nAia-model-failure]", JSON.stringify({ stage, durationMs: Date.now() - t0, ...extra }));
    }
  };

  try {
    const result = await Promise.race<NaiaSelectionResponse | null>([
      callClaudeJSON<NaiaSelectionResponse>({
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        maxTokens: 900,
        temperature: 1,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);

    if (!result || typeof result !== "object") {
      diagLog(result === null ? "timeout-or-null" : "non-object-response");
      return null;
    }
    if (!result.outfitName || !result.whyThisWorks || !result.confidenceBoost) {
      diagLog("missing-required-fields", {
        hasName: !!result.outfitName,
        hasWhy: !!result.whyThisWorks,
        hasBoost: !!result.confidenceBoost,
        hasCandidate: !!result.selectedCandidate,
      });
      return null;
    }
    if (result.selectedCandidate !== "A" && result.selectedCandidate !== "B" && result.selectedCandidate !== "C" && result.selectedCandidate !== "D") {
      diagLog("invalid-candidate-id", { returnedId: String(result.selectedCandidate).slice(0, 10) });
      return null;
    }

    // Server validation: selected candidate must exist in the offered list
    const selectedCandidate = candidates.find((c) => c.id === result.selectedCandidate);
    if (!selectedCandidate) {
      diagLog("candidate-not-offered", { returnedId: result.selectedCandidate });
      return null;
    }

    const outfitName = String(result.outfitName).slice(0, 80);
    const whyThisWorks = String(result.whyThisWorks);
    const confidenceBoost = String(result.confidenceBoost);

    if (containsBlockedTerms(`${outfitName} ${whyThisWorks} ${confidenceBoost}`)) {
      diagLog("blocked-terms");
      return null;
    }

    // Accept per-piece notes only for IDs in the selected candidate — discard anything else.
    const validIds = new Set(selectedCandidate.pieces.map((p) => p.closetId));
    const perPieceNotes = new Map<string, string>();
    if (Array.isArray(result.perPieceNotes)) {
      for (const entry of result.perPieceNotes) {
        if (
          entry &&
          typeof entry.id === "string" &&
          typeof entry.note === "string" &&
          validIds.has(entry.id)
        ) {
          perPieceNotes.set(entry.id, String(entry.note));
        }
      }
    }

    return {
      candidate: selectedCandidate,
      wording: {
        outfitName,
        whyThisWorks,
        confidenceBoost,
        perfumeNote: result.perfumeNote ? String(result.perfumeNote) : null,
      },
      perPieceNotes,
    };
  } catch (err: unknown) {
    if (process.env.NAIA_STYLEME_DIAGNOSTICS === "true") {
      console.log("[nAia-model-error]", JSON.stringify(categorizeModelError(err)));
    }
    return null;
  }
}

// Safe error categorizer — extracts only non-sensitive diagnostic fields.
// Never logs prompts, customer data, raw provider responses, or API keys.
function categorizeModelError(err: unknown): {
  category: string;
  name: string;
  message: string;
  httpStatus?: number;
  errorCode?: string;
} {
  if (!(err instanceof Error)) {
    return { category: "unknown", name: "UnknownError", message: "Non-Error thrown" };
  }
  const name = err.name ?? "Error";
  // Truncate message to avoid leaking prompt fragments in edge cases
  const message = String(err.message ?? "").slice(0, 200);
  // Detect common provider/network error shapes
  const anyErr = err as Record<string, unknown>;
  const httpStatus = typeof anyErr["status"] === "number" ? anyErr["status"]
    : typeof anyErr["statusCode"] === "number" ? anyErr["statusCode"]
    : undefined;
  const errorCode = typeof anyErr["error_code"] === "string" ? anyErr["error_code"]
    : typeof anyErr["code"] === "string" ? anyErr["code"]
    : undefined;

  let category: string;
  if (message.includes("JSON") || message.includes("parse")) {
    category = "json-parse";
  } else if (message.includes("timeout") || message.includes("timed out") || name === "TimeoutError") {
    category = "timeout";
  } else if (httpStatus !== undefined) {
    category = httpStatus >= 500 ? "provider-server-error" : httpStatus === 429 ? "rate-limit" : "provider-client-error";
  } else if (name === "AbortError") {
    category = "timeout";
  } else if (message.includes("fetch") || message.includes("network") || message.includes("ECONNRESET")) {
    category = "network";
  } else {
    category = "unknown";
  }

  return { category, name, message, ...(httpStatus !== undefined ? { httpStatus } : {}), ...(errorCode ? { errorCode } : {}) };
}

// ── Outfit completion layer ───────────────────────────────────────────────────
// Detects which essential clothing slots are still uncovered after the anchor
// and the primary NADINE recommendation, then produces generic wardrobe styling
// guidance for each missing slot.  No new Claude call — deterministic only.

// Slots that count as actual clothing coverage.  Shoe/bag/accessory/jewelry
// anchors do NOT count and must never fill a clothing slot.
const CLOTHING_COVERAGE_SLOTS = new Set<string>(["top", "bottom", "dress", "set", "outerwear"]);

// Explicit slot coverage for each NADINE SET product, derived from its actual
// catalog components. A SET is NOT automatically top+bottom — it depends on what
// the physical pieces are. Extend this map when new SET products are catalogued.
// Closet items with slot="set" (no NADINE handle to look up) return empty coverage —
// components are unknown, so completion is not suppressed for any slot.
export const NADINE_SET_SLOT_COVERAGE: Map<string, Set<string>> = new Map([
  // dress-set (Becoming Defined): wrapped crop top + structured corset + asymmetric skirt
  // Components: wrapped-top (top coverage), corset (top coverage), skirt (bottom coverage)
  // → full set covers both top and bottom
  ["dress-set", new Set(["top", "bottom"])],
]);

export function resolveSetSlots(
  handle: string | null,
  coverage: ReadonlyMap<string, ReadonlySet<string>> = NADINE_SET_SLOT_COVERAGE,
): Set<string> {
  if (handle && coverage.has(handle)) {
    return new Set(coverage.get(handle)!);
  }
  // Unknown SET or Closet SET with no component metadata: return empty.
  // Do NOT fabricate coverage — prefer generating completion guidance for
  // potentially uncovered slots over suppressing a required garment by guessing.
  return new Set();
}

export function getFilledClothingSlots(
  anchor: NormalizedStyleAnchor | null,
  primaryProduct: StyleMePrimaryProduct | null,
  additionalItems: Array<{ slot: string }> = [],
): Set<string> {
  const filled = new Set<string>();

  const anchorSlot =
    anchor?.type === "nadine"
      ? (anchor as NormalizedNadineAnchor).slot
      : anchor?.type === "closet"
      ? (anchor as NormalizedClosetAnchor).slot
      : null;
  const anchorNadineHandle = anchor?.type === "nadine" ? (anchor as NormalizedNadineAnchor).handle : null;

  if (anchorSlot && CLOTHING_COVERAGE_SLOTS.has(anchorSlot)) {
    if (anchorSlot === "set") {
      for (const s of resolveSetSlots(anchorNadineHandle)) filled.add(s);
    } else {
      filled.add(anchorSlot);
    }
  }

  if (primaryProduct) {
    const pSlot = primaryProduct.slot;
    if (CLOTHING_COVERAGE_SLOTS.has(pSlot)) {
      if (pSlot === "set") {
        for (const s of resolveSetSlots(primaryProduct.handle)) filled.add(s);
      } else {
        filled.add(pSlot);
      }
    }
  }

  for (const item of additionalItems) {
    if (CLOTHING_COVERAGE_SLOTS.has(item.slot)) {
      if (item.slot === "set") {
        for (const s of resolveSetSlots(null)) filled.add(s);
      } else {
        filled.add(item.slot);
      }
    }
  }

  return filled;
}

export function getMissingEssentialSlots(filledSlots: Set<string>): Array<"top" | "bottom"> {
  // dress fills top + bottom; explicit top + bottom is also complete
  if (filledSlots.has("dress") || (filledSlots.has("top") && filledSlots.has("bottom"))) {
    return [];
  }
  const missing: Array<"top" | "bottom"> = [];
  if (!filledSlots.has("top")) missing.push("top");
  if (!filledSlots.has("bottom")) missing.push("bottom");
  return missing;
}

// ── Signal-responsive completion modifiers ────────────────────────────────────

function desiredFeelingGarmentMod(
  feelings: string[],
  slot: "top" | "bottom",
): { qualifier: string; fabricNote: string } {
  if (feelings.some((f) => ["more-confident", "more-powerful"].includes(f))) {
    return {
      qualifier: "structured",
      fabricNote: slot === "top" ? "in a crisp woven or ponte" : "in a tailored crepe or ponte",
    };
  }
  if (feelings.some((f) => ["more-relaxed", "more-comfortable"].includes(f))) {
    return { qualifier: "relaxed", fabricNote: "in a soft, easy-wearing fabric" };
  }
  if (feelings.some((f) => f === "more-attractive")) {
    return {
      qualifier: slot === "top" ? "sleek" : "",
      // Neckline guidance is handled by resolveTopDetailNote (composed once with mood signals)
      fabricNote: slot === "top"
        ? "in a satin-touch or fluid fabric"
        : "in a satin-touch or fluid fabric for a figure-aware, polished line",
    };
  }
  if (feelings.some((f) => f === "more-feminine")) {
    return {
      qualifier: "soft",
      fabricNote: slot === "top" ? "in a fluid or satin-touch fabric" : "in a fluid or crepe fabric",
    };
  }
  if (feelings.some((f) => f === "more-elevated")) {
    return { qualifier: "polished", fabricNote: "in a refined fabric" };
  }
  if (feelings.some((f) => f === "more-expressive")) {
    return { qualifier: "tonal", fabricNote: "in an interesting texture or weave" };
  }
  if (feelings.some((f) => f === "softer")) {
    return { qualifier: "", fabricNote: "in a draped or fluid fabric" };
  }
  return { qualifier: "", fabricNote: "" };
}

function bodyNeedSilhouetteNote(bodyNeeds: string[], slot: "top" | "bottom"): string {
  if (slot === "bottom") {
    if (bodyNeeds.some((n) => ["define-waist", "emphasise-waist"].includes(n))) {
      return "High-waisted for a defined waist.";
    }
    if (bodyNeeds.some((n) => ["elongate-legs", "create-height", "create-length"].includes(n))) {
      return "High-rise wide-leg for maximum leg length.";
    }
    if (bodyNeeds.some((n) => ["balance-shoulders", "add-volume-lower", "widen-hips"].includes(n))) {
      return "Wide-leg or A-line to balance a broader shoulder.";
    }
    if (bodyNeeds.some((n) => ["minimise-hips", "streamline-hips", "slim-hips"].includes(n))) {
      return "Straight-leg in a dark shade for a clean hip line.";
    }
  } else {
    if (bodyNeeds.some((n) => ["define-waist", "emphasise-waist"].includes(n))) {
      return "Tuck or crop to make the waist the focal point.";
    }
    if (bodyNeeds.some((n) => ["balance-shoulders", "minimise-shoulders", "soften-shoulders"].includes(n))) {
      return "A V-neck or open collar creates a softening diagonal.";
    }
    if (bodyNeeds.some((n) => ["add-length", "elongate-torso", "lengthen-torso"].includes(n))) {
      return "A longer hem visually extends the torso.";
    }
  }
  return "";
}

function comfortFabricNote(coverageConditional: string | null): string {
  if (!coverageConditional) return "";
  const lower = coverageConditional.toLowerCase();
  if (lower.includes("cool") || lower.includes("breathable") || lower.includes("summer")) {
    return "in a breathable fabric";
  }
  if (lower.includes("warm") || lower.includes("layer") || lower.includes("cold")) {
    return "in a cosy or layerable fabric";
  }
  return "";
}

const TOP_VOCAB: Record<string, string> = {
  "everyday":    "fitted scoop-neck or crew-neck top",
  "work":        "structured fitted top or fine-gauge knit",
  "date-night":  "fitted top",
  "girls-night": "draped or wrapped top",
  "night-out":   "draped or wrapped top",
  "event":       "polished fitted top in a refined fabric",
  "travel":      "relaxed fitted top in a breathable fabric",
  "not-sure":    "fitted jersey or woven top",
};

const TOP_MATERIAL: Record<string, string> = {
  "everyday":    "smooth cotton or jersey",
  "work":        "woven cotton or fine-gauge knit",
  "date-night":  "satin, silk-like fabric, or ribbed jersey",
  "girls-night": "satin, charmeuse, or fluid jersey",
  "night-out":   "satin, charmeuse, or fluid jersey",
  "event":       "crepe, silk, or fluid woven",
  "travel":      "breathable cotton-linen or jersey",
  "not-sure":    "smooth cotton or jersey",
};

const BOTTOM_VOCAB: Record<string, string> = {
  "everyday":    "straight-leg trousers or clean-cut denim",
  "work":        "high-waisted tailored straight-leg trousers",
  "date-night":  "wide-leg trousers or a fluid midi skirt",
  "girls-night": "wide-leg trousers or a fluid midi skirt",
  "night-out":   "wide-leg trousers or a fluid midi skirt",
  "event":       "wide-leg trousers or a full midi skirt",
  "travel":      "relaxed straight-leg trousers",
  "not-sure":    "straight-leg trousers",
};

const BOTTOM_MATERIAL: Record<string, string> = {
  "everyday":    "clean denim or a linen blend",
  "work":        "crepe, wool blend, or ponte",
  "date-night":  "satin, silk-like fabric, or tailored crepe",
  "girls-night": "satin, silk-like fabric, or tailored crepe",
  "night-out":   "satin, silk-like fabric, or tailored crepe",
  "event":       "fluid crepe or structured suiting",
  "travel":      "lightweight linen blend or travel ponte",
  "not-sure":    "versatile ponte or cotton blend",
};

function resolveCompletionColour(
  slot: "top" | "bottom",
  preferredColors: string[],
  anchorColors: string[],
): string {
  if (preferredColors.length > 0) return preferredColors[0].replace(/-/g, " ");
  const lower = anchorColors.map((c) => c.toLowerCase());
  if (slot === "top") {
    if (lower.some((c) => ["red", "burgundy", "wine", "crimson", "rust", "terracotta"].includes(c))) return "ivory";
    if (lower.some((c) => ["black", "charcoal", "navy", "midnight"].includes(c))) return "ivory";
    if (lower.some((c) => ["beige", "camel", "tan", "cream"].includes(c))) return "white";
    return "ivory";
  }
  if (lower.some((c) => ["ivory", "white", "cream", "ecru"].includes(c))) return "black";
  if (lower.some((c) => ["red", "burgundy", "wine"].includes(c))) return "black";
  if (lower.some((c) => ["beige", "camel", "tan"].includes(c))) return "black";
  return "black";
}

// Compose feeling + mood signals into ONE top detail/neckline instruction.
// This is called instead of stacking separate feeling, mood, and occasion fragments.
// Precedence (when not coverage-suppressed): feeling+mood compose together → occasion fallback.
function resolveTopDetailNote(
  desiredFeelings: string[],
  moods: string[],
  occ: string,
  isCoveragePreference: boolean,
): string {
  const attractive = desiredFeelings.some((f) => f === "more-attractive");
  const adventurous = moods.includes("adventurous");
  const softer = desiredFeelings.some((f) => f === "softer");

  if (isCoveragePreference) {
    if (adventurous || attractive) {
      return "Look for an interesting drape, asymmetric seam, or textural contrast for visual edge.";
    }
    return "";
  }

  if (attractive && adventurous) {
    return "Opt for an open or asymmetric neckline — a wrap, off-shoulder, or draped variation for daring impact.";
  }
  if (attractive) {
    return "Opt for an open or wrapped neckline for impact.";
  }
  if (adventurous) {
    return "A wrap, off-shoulder, or asymmetric neckline adds edge.";
  }
  if (softer) {
    return "Avoid sharp plackets or rigid structure — a rounded collar or relaxed construction carries the feel.";
  }
  // Occasion-based fallback when no feeling/mood override applies
  if (occ === "girls-night" || occ === "night-out") {
    return "A considered or daring neckline suits the occasion.";
  }
  if (occ === "date-night") {
    return "A considered neckline adds intention.";
  }
  return "";
}

// Compose mood signals into ONE bottom detail instruction.
function resolveBottomDetailNote(moods: string[], isCoveragePreference: boolean): string {
  if (moods.includes("adventurous")) {
    return isCoveragePreference
      ? "A wide silhouette with an asymmetric hem or unexpected texture adds edge."
      : "A wrap hem or side split adds an unexpected element.";
  }
  return "";
}

// Returns true when the customer has signaled a preference for more coverage.
// When true, exposure-suggesting vocabulary (open neckline, off-shoulder, mini, split)
// must be suppressed. Coverage + body needs outrank desired feeling + mood + occasion vocab.
function hasHigherCoveragePreference(
  coverageConditional: string | null,
  bodyNeeds: string[],
): boolean {
  if (coverageConditional) {
    if (/higher|more|covered|modest|conservative|fuller/i.test(coverageConditional)) return true;
  }
  return bodyNeeds.some((n) =>
    ["cover-arms", "cover-stomach", "cover-legs", "cover-chest", "more-coverage", "minimise-exposure"].includes(n),
  );
}

function buildCompletionPiece(
  slot: "top" | "bottom",
  primarySlot: string | null,
  primaryTitle: string | null,
  occasion: string,
  anchorColors: string[],
  preferredColors: string[],
  desiredFeelings: string[],
  bodyNeeds: string[],
  moods: string[],
  coverageConditional: string | null,
  mode?: StyleMeMode,
): StyleMeCompletionPiece {
  const occ = TOP_VOCAB[occasion] ? occasion : "not-sure";
  const colour = resolveCompletionColour(slot, preferredColors, anchorColors);
  const cap = colour.charAt(0).toUpperCase() + colour.slice(1);

  // Precedence: coverage + body needs > desired feeling + mood > occasion vocabulary.
  // When the customer signals higher coverage, exposure-suggesting vocab is suppressed
  // and replaced with coverage-safe alternatives that still deliver the evening/attractive character
  // through colour, fabrication, drape, asymmetry, and structure.
  const isCoveragePreference = hasHigherCoveragePreference(coverageConditional, bodyNeeds);

  const feelingMod = desiredFeelingGarmentMod(desiredFeelings, slot);
  const silhouetteNote = bodyNeedSilhouetteNote(bodyNeeds, slot);
  const comfortNote = comfortFabricNote(coverageConditional);

  // Strip neckline exposure guidance from feeling fabricNote when coverage is preferred
  const effectiveFabricNote = isCoveragePreference
    ? feelingMod.fabricNote.replace(/ — opt for an? [^.]*?(neckline|impact)[^.]*/i, "").trim()
    : feelingMod.fabricNote;

  // Resolve material phrase: feeling override → comfort override → occasion default
  const baseMaterial = ((): string => {
    if (effectiveFabricNote) return effectiveFabricNote;
    if (comfortNote) return comfortNote;
    return `in ${slot === "top" ? TOP_MATERIAL[occ] : BOTTOM_MATERIAL[occ]}`;
  })();

  const qualifier = feelingMod.qualifier ? `${feelingMod.qualifier} ` : "";

  // Coverage-aware occasion vocab overrides and signal composition.
  const isEveningOccasion = occ === "girls-night" || occ === "night-out";

  if (slot === "top") {
    // Coverage guard: replace evening occasion shape with a coverage-safe variant
    const garment =
      isCoveragePreference && isEveningOccasion
        ? "draped or wrapped top with a refined or moderate neckline"
        : TOP_VOCAB[occ];
    // Single composed detail note: feeling + mood → one instruction (not stacked fragments)
    const detailNote = resolveTopDetailNote(desiredFeelings, moods, occ, isCoveragePreference);
    let proportionNote: string;
    if (primarySlot === "outerwear" && primaryTitle) {
      proportionNote = silhouetteNote
        ? ` ${silhouetteNote} Keep it under ${primaryTitle}.`
        : ` Keep it close to the body so the volume of ${primaryTitle} stays intentional.`;
    } else if (primarySlot === "bottom" && primaryTitle) {
      proportionNote = silhouetteNote
        ? ` ${silhouetteNote} Tuck or half-tuck with ${primaryTitle}.`
        : ` Tuck or half-tuck to define proportion with ${primaryTitle}.`;
    } else if (silhouetteNote) {
      proportionNote = ` ${silhouetteNote}`;
    } else {
      proportionNote = " Keep the fit clean and close to the body.";
    }
    const detailSuffix = detailNote ? ` ${detailNote}` : "";
    const topDesc = `${cap} ${qualifier}${garment} ${baseMaterial}.${proportionNote}${detailSuffix}`;
    return { slot: "top", description: topDesc };
  }

  // Bottom: resolve garment, hemline suffix, and detail note separately
  const garment =
    isCoveragePreference && isEveningOccasion
      ? "wide-leg trousers or a fluid midi skirt"
      : BOTTOM_VOCAB[occ];
  // "full-length line" only applies to trousers — not to skirts (midi/mini/fluid)
  const hemlineSuffix = /skirt/i.test(garment) ? "" : " with a clean full-length line";
  const detailNote = resolveBottomDetailNote(moods, isCoveragePreference);
  let proportionNote: string;
  if (primarySlot === "outerwear" && primaryTitle) {
    proportionNote = silhouetteNote
      ? ` ${silhouetteNote} A clean silhouette grounds the outfit under ${primaryTitle}.`
      : ` A clean-cut silhouette grounds the outfit under ${primaryTitle}.`;
  } else if (primarySlot === "top" && primaryTitle) {
    proportionNote = silhouetteNote
      ? ` ${silhouetteNote} Let ${primaryTitle} lead.`
      : ` Let ${primaryTitle} lead — keep the bottom simple and proportional.`;
  } else if (silhouetteNote) {
    proportionNote = ` ${silhouetteNote}`;
  } else {
    proportionNote = " Keep the silhouette clean and intentional.";
  }
  const detailSuffix = detailNote ? ` ${detailNote}` : "";
  const bottomDesc = `${cap} ${qualifier}${garment} ${baseMaterial}${hemlineSuffix}.${proportionNote}${detailSuffix}`;
  return { slot: "bottom", description: bottomDesc };
}

export function buildCompletionLayer(
  anchor: NormalizedStyleAnchor | null,
  primaryProduct: StyleMePrimaryProduct | null,
  session: StyleMeSessionInput,
  additionalItems: Array<{ slot: string }> = [],
  mode?: StyleMeMode,
): StyleMeCompletionPiece[] {
  const filledSlots = getFilledClothingSlots(anchor, primaryProduct, additionalItems);
  const missingSlots = getMissingEssentialSlots(filledSlots);
  if (missingSlots.length === 0) return [];

  const anchorColors: string[] =
    anchor?.type === "closet"
      ? (anchor as NormalizedClosetAnchor).colors
      : anchor?.type === "nadine"
      ? (anchor as NormalizedNadineAnchor).colors
      : [];

  return missingSlots.map((slot) =>
    buildCompletionPiece(
      slot,
      primaryProduct?.slot ?? null,
      primaryProduct?.title ?? null,
      session.occasion,
      anchorColors,
      session.todayColours.preferred,
      session.desiredFeelings,
      session.bodyNeeds,
      session.moods,
      session.coverageConditional,
      mode,
    ),
  );
}

// ── Display image resolution ──────────────────────────────────────────────────
// Returns the CDN URL to show in StyleMe for a given media entry.
// displayResolvedUrl wins unconditionally (present on display-only entries even when
// eligibility !== "ready"). Falls back to resolvedUrl only for ready entries.
// This is decoupled from VTO/FASHN — shopifyProductId is gated separately.

function resolveDisplayImage(media: VerifiedMediaEntry | undefined): string | null {
  if (media == null) return null;
  if (media.displayResolvedUrl != null) return media.displayResolvedUrl;
  if (media.eligibility === "ready") return media.resolvedUrl;
  return null;
}

// ── Rev 3 profile hint + slot labels (Group 5 voice) ─────────────────────────
// buildProfileHint produces a short clothing-grounded phrase from the customer's
// dominant Profile signals. Used in directional notes so MOST YOU / FRESH / PUSH ME
// reference profile evidence rather than asserting identity.

const DIRECTION_SLOT_LABELS: Readonly<Record<string, string>> = {
  top:       "top",
  bottom:    "trouser or skirt",
  dress:     "dress",
  set:       "set",
  outerwear: "jacket or coat",
  shoe:      "shoes",
  bag:       "bag",
  accessory: "accessory",
  jewelry:   "jewellery",
  unknown:   "piece",
};

function directionSlotLabel(slot: string): string {
  return DIRECTION_SLOT_LABELS[slot] ?? slot;
}

export function buildProfileHint(profile?: StyleMeProfileSignals): string {
  if (!profile) return "your established Profile preferences";

  const SIL_LABELS: Readonly<Record<string, string>> = {
    "fitted":              "fitted",
    "waist-defined":       "waist-defining",
    "straight-simple":     "clean, straight-cut",
    "relaxed":             "relaxed",
    "oversized":           "oversized",
    "loose-flowing":       "loose and flowing",
    "structured-tailored": "structured and tailored",
  };
  const PERS_LABELS: Readonly<Record<string, string>> = {
    "classic-polished":    "classic, polished",
    "feminine-romantic":   "soft and romantic",
    "minimal-relaxed":     "clean and minimal",
    "bold-edgy":           "bold and distinctive",
    "creative-expressive": "creatively expressive",
    "old-money":           "timeless and classic",
    "minimal":             "clean and minimal",
    "artsy":               "creative and artistic",
    "edgy":                "bold and edgy",
    "feminine":            "soft and feminine",
    "corporate-chic":      "polished and professional",
    "effortlessly-chic":   "effortlessly stylish",
    "casual-cool":         "relaxed and cool",
    "romantic":            "dreamy and romantic",
  };

  const silPhrases = (profile.silhouette ?? []).slice(0, 2)
    .map((id) => SIL_LABELS[id]).filter(Boolean);
  const persPhrases = (profile.stylePersonalities ?? []).slice(0, 1)
    .map((id) => PERS_LABELS[id]).filter(Boolean);

  if (silPhrases.length > 0 && persPhrases.length > 0) {
    return `${persPhrases[0]} direction with ${silPhrases.join(" and ")} shapes`;
  }
  if (silPhrases.length > 0) return `${silPhrases.join(" and ")} silhouettes`;
  if (persPhrases.length > 0) return `${persPhrases[0]} direction`;
  return "your established Profile preferences";
}

// ── Rev 3 result directions (Group 5) ─────────────────────────────────────────
// Partitions evaluatedProducts into MOST YOU / FRESH / PUSH ME.
// Profile alignment score = points from signals whose question is a Profile question
// ── Multi-Closet garment scan ─────────────────────────────────────────────────
// Finds the best Closet item for each outfit slot not already covered by the
// anchor or primary NADINE product. Runs in both nAia and NADINE modes.
// At most one item per slot. The anchor is always excluded by ID.
// Items with zero session signal score are never surfaced.

export function selectAdditionalClosetGarments(
  anchor: NormalizedStyleAnchor | null,
  primaryProduct: StyleMePrimaryProduct | null,
  session: StyleMeSessionInput,
  closetItems: ClosetAnchorInput[],
  profile?: ClosetScoringProfile | null,
  recentlyShownIds?: Set<string>,
): Array<{ slot: OutfitSlot; id: string; label: string | null; imageUrl: string | null; colors: string[] }> {
  const anchorId = anchor?.type === "closet" ? (anchor as NormalizedClosetAnchor).id : null;

  // Slots already covered by the anchor (all slot types) and by the primary (clothing only).
  const filledClothingSlots = getFilledClothingSlots(anchor, primaryProduct, []);
  const coveredSlots = new Set<string>(filledClothingSlots);
  if (anchor?.type === "closet") coveredSlots.add((anchor as NormalizedClosetAnchor).slot);
  if (anchor?.type === "nadine") coveredSlots.add((anchor as NormalizedNadineAnchor).slot);
  // A dress or set in coveredSlots (from anchor or primary) covers both top and bottom —
  // block all conflicting garments so no invalid base combination can be produced.
  // Note: for Closet SET anchors, resolveSetSlots returns empty (no component metadata),
  // so "set" only appears via the explicit anchor.slot add above — this condition still fires.
  if (coveredSlots.has("dress") || coveredSlots.has("set")) {
    coveredSlots.add("top");
    coveredSlots.add("bottom");
    coveredSlots.add("dress");
    coveredSlots.add("set");
  }
  // If separates are fully committed (top AND bottom both covered), dress/set candidates
  // would be redundant base garments — block them too.
  if (coveredSlots.has("top") && coveredSlots.has("bottom")) {
    coveredSlots.add("dress");
    coveredSlots.add("set");
  }

  const signals = {
    occasion: session.occasion,
    moods: session.moods,
    desiredFeelings: session.desiredFeelings,
  };

  // Collect all candidates per slot, scored and sorted best-first.
  const candidatesBySlot = new Map<OutfitSlot, Array<{ item: ClosetAnchorInput; score: number }>>();

  for (const item of closetItems) {
    if (item.id === anchorId) continue;

    const slot = CLOSET_CATEGORY_TO_SLOT[item.category as string];
    if (!slot) continue;
    if (coveredSlots.has(slot)) continue;

    const score = scoreClosetItemForSession(
      { occasions: item.occasions, styleTags: item.styleTags, category: item.category, colors: item.colors, primaryColor: item.primaryColor },
      signals,
      profile,
      item.garmentRelationships,
    );
    if (score <= 0) continue;

    const list = candidatesBySlot.get(slot) ?? [];
    list.push({ item, score });
    candidatesBySlot.set(slot, list);
  }

  for (const list of candidatesBySlot.values()) list.sort((a, b) => b.score - a.score);

  // ── Base-architecture exclusivity ──────────────────────────────────────────
  // Enforce selection-order-independence: if candidates include both a separates
  // slot (top or bottom) AND a one-piece slot (dress or set), only the architecture
  // consistent with the committed base (anchor + primary) survives.
  // This prevents outfits like BOTTOM-anchor + TOP-candidate + DRESS-candidate.
  const hasSeparatesInCandidates = candidatesBySlot.has("top") || candidatesBySlot.has("bottom");
  const hasOnepieceInCandidates = candidatesBySlot.has("dress") || candidatesBySlot.has("set");

  if (hasSeparatesInCandidates && hasOnepieceInCandidates) {
    const committedSeparates = coveredSlots.has("top") || coveredSlots.has("bottom");
    const committedOnepiece = coveredSlots.has("dress") || coveredSlots.has("set");

    if (committedSeparates && !committedOnepiece) {
      // Separates base already established — one-piece candidates are incompatible.
      candidatesBySlot.delete("dress");
      candidatesBySlot.delete("set");
    } else if (committedOnepiece) {
      // One-piece base established (belt-and-suspenders; coveredSlots expansion should
      // have already filtered these from candidates).
      candidatesBySlot.delete("top");
      candidatesBySlot.delete("bottom");
    } else {
      // No committed clothing base — resolve by highest candidate score.
      const bestSeparates = Math.max(
        0,
        ...(candidatesBySlot.get("top") ?? []).map((c) => c.score),
        ...(candidatesBySlot.get("bottom") ?? []).map((c) => c.score),
      );
      const bestOnepiece = Math.max(
        0,
        ...(candidatesBySlot.get("dress") ?? []).map((c) => c.score),
        ...(candidatesBySlot.get("set") ?? []).map((c) => c.score),
      );
      if (bestOnepiece > bestSeparates) {
        candidatesBySlot.delete("top");
        candidatesBySlot.delete("bottom");
      } else {
        candidatesBySlot.delete("dress");
        candidatesBySlot.delete("set");
      }
    }
  }

  // ── Outfit size cap + prioritised optional selection ───────────────────────
  // Total outfit pieces = anchor + primary NADINE product + additional closet garments.
  // Stay within MAX_OUTFIT_PIECES. Base garments (top/bottom/dress/set) are always
  // included first; optional finishing pieces are ranked by score and selected greedily.
  // At most one combined finishing piece from accessory + jewelry.
  const BASE_SLOTS_SET = new Set<string>(["top", "bottom", "dress", "set"]);
  const committedCount = (anchor ? 1 : 0) + (primaryProduct ? 1 : 0);
  const maxAdditional = Math.max(0, MAX_OUTFIT_PIECES - committedCount);

  const result: Array<{ slot: OutfitSlot; id: string; label: string | null; imageUrl: string | null; colors: string[] }> = [];

  // Phase 1: base garments — unconditionally included (they complete the outfit architecture).
  for (const slot of ["top", "bottom", "dress", "set"] as OutfitSlot[]) {
    const candidates = candidatesBySlot.get(slot);
    if (!candidates) continue;
    const fresh = recentlyShownIds ? candidates.find((c) => !recentlyShownIds.has(c.item.id)) : null;
    const chosen = fresh ?? candidates[0];
    result.push({ slot, id: chosen.item.id, label: chosen.item.name, imageUrl: chosen.item.imageUrl, colors: chosen.item.colors ?? [] });
  }

  // Phase 2: optional finishing pieces — shoes first (never crowded by accessories/bags),
  // then remaining by score with a secondary slot tiebreaker. At most one accessory+jewelry.
  const optionalWinners: Array<{ slot: OutfitSlot; item: ClosetAnchorInput; score: number }> = [];
  for (const [slot, candidates] of candidatesBySlot.entries()) {
    if (BASE_SLOTS_SET.has(slot)) continue;
    const fresh = recentlyShownIds ? candidates.find((c) => !recentlyShownIds.has(c.item.id)) : null;
    const chosen = fresh ?? candidates[0];
    optionalWinners.push({ slot, item: chosen.item, score: chosen.score });
  }

  // Shoes take absolute priority over bags/accessories regardless of score.
  const OPTIONAL_SLOT_ORDER: Record<string, number> = { outerwear: 1, bag: 2, accessory: 3, jewelry: 3 };
  const optShoes = optionalWinners.filter((o) => o.slot === "shoe");
  const optRest = optionalWinners
    .filter((o) => o.slot !== "shoe")
    .sort((a, b) => b.score - a.score || (OPTIONAL_SLOT_ORDER[a.slot] ?? 9) - (OPTIONAL_SLOT_ORDER[b.slot] ?? 9));
  const orderedOptionals = [...optShoes, ...optRest];

  let finishingSlotUsed = false;
  for (const opt of orderedOptionals) {
    if (result.length >= maxAdditional) break;
    if (opt.slot === "accessory" || opt.slot === "jewelry") {
      if (finishingSlotUsed) continue; // at most one combined finishing piece
      finishingSlotUsed = true;
    }
    result.push({ slot: opt.slot, id: opt.item.id, label: opt.item.name, imageUrl: opt.item.imageUrl, colors: opt.item.colors ?? [] });
  }

  return result;
}

// ── nAia-mode directions ──────────────────────────────────────────────────────
// Builds MOST YOU / FRESH / PUSH ME from the customer's Closet items only.
// The anchor item is excluded from direction candidates — it is already featured.
// No product links, no "Shop This Direction" (productUrl is always null).

// Slot priority for choosing the "lead" piece in a direction — most outfit-defining first.
const DIRECTION_SLOT_PRIORITY: OutfitSlot[] = [
  "bottom", "dress", "top", "outerwear", "shoe", "bag", "accessory", "jewelry",
];

export function computeNaiaResultDirections(
  closetItems: ClosetAnchorInput[],
  anchorId: string | null,
  session: Pick<StyleMeSessionInput, "occasion" | "moods" | "desiredFeelings">,
  profile?: ClosetScoringProfile | null,
  recentlyShownIds?: Set<string>,
): ResultDirection[] {
  const signals = {
    occasion: session.occasion,
    moods: session.moods,
    desiredFeelings: session.desiredFeelings,
  };

  type ScoredItem = { item: ClosetAnchorInput; score: number };

  // Score all non-anchor items and group by slot (best first within each slot).
  const bySlot = new Map<OutfitSlot, ScoredItem[]>();
  for (const item of closetItems) {
    if (item.id === anchorId) continue;
    const slot = CLOSET_CATEGORY_TO_SLOT[item.category as string] as OutfitSlot | undefined;
    if (!slot) continue;
    const score = scoreClosetItemForSession(
      { occasions: item.occasions, styleTags: item.styleTags, category: item.category, colors: item.colors, primaryColor: item.primaryColor },
      signals,
      profile,
      item.garmentRelationships,
    );
    if (score <= 0) continue;
    const list = bySlot.get(slot) ?? [];
    list.push({ item, score });
    bySlot.set(slot, list);
  }
  for (const list of bySlot.values()) list.sort((a, b) => b.score - a.score);

  if (bySlot.size === 0) return [];

  // ── Base-architecture exclusivity ──────────────────────────────────────────
  // The anchor's clothing slot determines which additional clothing candidates survive.
  // Without this, a bottom-anchor direction can accidentally include a dress candidate.
  const anchorItem = anchorId ? closetItems.find((i) => i.id === anchorId) : null;
  const anchorSlotForArch = anchorItem
    ? (CLOSET_CATEGORY_TO_SLOT[anchorItem.category as string] as OutfitSlot | undefined) ?? null
    : null;

  const hasSepInMap = bySlot.has("top") || bySlot.has("bottom");
  const hasOneInMap = bySlot.has("dress") || bySlot.has("set");
  if (hasSepInMap && hasOneInMap) {
    const committedSep = anchorSlotForArch === "top" || anchorSlotForArch === "bottom";
    const committedOne = anchorSlotForArch === "dress" || anchorSlotForArch === "set";
    if (committedSep) {
      bySlot.delete("dress");
      bySlot.delete("set");
    } else if (committedOne) {
      bySlot.delete("top");
      bySlot.delete("bottom");
    } else {
      // No committed clothing anchor — resolve by highest-scoring candidate.
      const bestSep = Math.max(0, ...(bySlot.get("top") ?? []).map((c) => c.score), ...(bySlot.get("bottom") ?? []).map((c) => c.score));
      const bestOne = Math.max(0, ...(bySlot.get("dress") ?? []).map((c) => c.score), ...(bySlot.get("set") ?? []).map((c) => c.score));
      if (bestOne > bestSep) {
        bySlot.delete("top");
        bySlot.delete("bottom");
      } else {
        bySlot.delete("dress");
        bySlot.delete("set");
      }
    }
  }

  // ── Piece cap and slot priority ────────────────────────────────────────────
  // Direction outfitPieces = additional pieces only (anchor shown separately).
  // Cap = MAX_OUTFIT_PIECES - 1 (the anchor occupies the +1 slot).
  const MAX_DIR_PIECES = MAX_OUTFIT_PIECES - 1;
  const DIR_BASE_SLOTS = new Set<string>(["top", "bottom", "dress", "set"]);

  // Build an outfit for a direction by picking one item per slot, then capping.
  // rankFn(slotItems, slot) → index into the sorted list (clamped to valid range).
  const buildOutfit = (
    rankFn: (items: ScoredItem[], slot: OutfitSlot) => number,
  ): Array<{ slot: OutfitSlot; item: ClosetAnchorInput; score: number }> => {
    const pieces: Array<{ slot: OutfitSlot; item: ClosetAnchorInput; score: number }> = [];

    // Phase 1: base clothing — unconditionally included.
    for (const slot of ["top", "bottom", "dress", "set"] as OutfitSlot[]) {
      const items = bySlot.get(slot);
      if (!items) continue;
      const idx = Math.min(Math.max(0, rankFn(items, slot)), items.length - 1);
      pieces.push({ slot, item: items[idx].item, score: items[idx].score });
    }

    // Phase 2: optional — shoes before bags/accessories; at most one accessory+jewelry.
    const optionals: Array<{ slot: OutfitSlot; item: ClosetAnchorInput; score: number }> = [];
    for (const [slot, items] of bySlot.entries()) {
      if (DIR_BASE_SLOTS.has(slot)) continue;
      const idx = Math.min(Math.max(0, rankFn(items, slot as OutfitSlot)), items.length - 1);
      optionals.push({ slot: slot as OutfitSlot, item: items[idx].item, score: items[idx].score });
    }
    const dirShoes = optionals.filter((o) => o.slot === "shoe");
    const dirRest = optionals.filter((o) => o.slot !== "shoe").sort((a, b) => b.score - a.score);

    let dirFinishingUsed = false;
    for (const opt of [...dirShoes, ...dirRest]) {
      if (pieces.length >= MAX_DIR_PIECES) break;
      if (opt.slot === "accessory" || opt.slot === "jewelry") {
        if (dirFinishingUsed) continue;
        dirFinishingUsed = true;
      }
      pieces.push(opt);
    }

    return pieces;
  };

  // The slot with the most options — best candidate for variation between directions.
  const variationSlot = DIRECTION_SLOT_PRIORITY.find(
    (sl) => (bySlot.get(sl)?.length ?? 0) >= 2,
  ) ?? null;

  // MOST YOU: best per slot that wasn't shown last time; fall back to best if all shown.
  const mostYouItems = buildOutfit((items) => {
    if (recentlyShownIds) {
      const fresh = items.findIndex((it) => !recentlyShownIds.has(it.item.id));
      if (fresh !== -1) return fresh;
    }
    return 0;
  });

  // FRESH: swap the variationSlot to its 2nd-best, keep others at 1st.
  const freshItems = buildOutfit((items, slot) => (slot === variationSlot ? 1 : 0));

  // PUSH ME: use the lowest-scoring item per slot (still positive).
  const pushMeItems = buildOutfit((items) => items.length - 1);

  // Convert an outfit array to the direction shape.
  const toOutfitPieces = (
    outfit: Array<{ slot: OutfitSlot; item: ClosetAnchorInput }>,
  ) => outfit.map(({ slot, item }) => ({
    slot,
    id: item.id,
    label: item.name,
    imageUrl: item.imageUrl,
  }));

  // Lead piece for a direction: highest-priority slot in the outfit.
  const leadItem = (
    outfit: Array<{ slot: OutfitSlot; item: ClosetAnchorInput }>,
  ): { slot: OutfitSlot; item: ClosetAnchorInput } | undefined => {
    for (const sl of DIRECTION_SLOT_PRIORITY) {
      const found = outfit.find((o) => o.slot === sl);
      if (found) return found;
    }
    return outfit[0];
  };

  const makeProduct = (
    outfit: Array<{ slot: OutfitSlot; item: ClosetAnchorInput }>,
  ): StyleMePrimaryProduct | null => {
    const lead = leadItem(outfit);
    if (!lead) return null;
    return {
      handle: lead.item.id,
      title: lead.item.name ?? lead.slot,
      slot: lead.slot,
      shopifyProductId: null,
      productImageUrl: lead.item.imageUrl,
      liveUrl: null,
      productUrl: null,
      stylingNotes: `Your ${lead.item.name ?? lead.slot} leads this look.`,
    };
  };

  const directions: ResultDirection[] = [];

  directions.push({
    label: "most-you",
    displayLabel: "MOST LIKE ME",
    product: makeProduct(mostYouItems),
    directionalNote: "The combination from your Closet that aligns most closely with today's signals.",
    outfitPieces: toOutfitPieces(mostYouItems),
  });

  // Only add FRESH if it produces a meaningfully different outfit from MOST YOU.
  const freshDiffers = freshItems.some(
    (f, i) => f.item.id !== mostYouItems[i]?.item.id,
  );
  if (freshDiffers) {
    const freshLead = leadItem(freshItems);
    const freshNote = freshLead && variationSlot && freshLead.slot === variationSlot
      ? `A different angle — swaps the ${variationSlot} for a new combination.`
      : "Familiar energy, styled from a different selection in your Closet.";
    directions.push({
      label: "fresh",
      displayLabel: "FRESH TWIST",
      product: makeProduct(freshItems),
      directionalNote: freshNote,
      outfitPieces: toOutfitPieces(freshItems),
    });
  }

  // Only add PUSH ME if it differs from both MOST YOU and FRESH.
  const pushMeDiffers = pushMeItems.some(
    (p, i) => p.item.id !== mostYouItems[i]?.item.id,
  );
  if (pushMeDiffers) {
    directions.push({
      label: "push-me",
      displayLabel: "TRY SOMETHING NEW",
      product: makeProduct(pushMeItems),
      directionalNote: "The further reach — pieces from your Closet at the outer edge of today's signals.",
      outfitPieces: toOutfitPieces(pushMeItems),
    });
  }

  return directions;
}

// (i.e. questionId does NOT start with "sq-").
// Session score = totalScore minus profile score.
// MOST YOU: highest totalScore overall.
// PUSH ME: lowest profile alignment (but has at least some session signal engagement).
// FRESH: highest totalScore among remaining (between MOST YOU and PUSH ME in profile fit).

function isSessionSignal(signal: string): boolean {
  const mapping = getMappingById(signal);
  if (!mapping) return true; // unknown → treat as session-only
  return mapping.questionId.startsWith("sq-");
}

function computeProductProfileScore(product: ProductEvaluation): number {
  return product.positiveEvidence.reduce((sum, ev) => {
    if (isSessionSignal(ev.sessionSignal)) return sum;
    return sum + ev.points;
  }, 0);
}

export function computeResultDirections(
  evaluatedProducts: ProductEvaluation[],
  resolvePrimaryProduct: (handle: string) => StyleMePrimaryProduct | null,
  profileHint: string = "your established Profile preferences",
): ResultDirection[] {
  const eligible = evaluatedProducts.filter(
    (p) =>
      !p.isHardExcluded &&
      p.totalScore > 0 &&
      // Products penalised for formality mismatch are outside the occasion envelope.
      // They must not appear in any direction, including TRY SOMETHING NEW — that
      // direction is for profile deviation, not occasion bypassing.
      !p.negativeEvidence.some(
        (e) => e.field === PRODUCT_TEMPLATE_FIELDS.FORMALITY_SCORE && e.effect === "DEPRIORITISE",
      ),
  );
  if (eligible.length === 0) return [];

  const withScores = eligible.map((p) => {
    const profileScore = computeProductProfileScore(p);
    return {
      product: p,
      profileScore,
      sessionScore: p.totalScore - profileScore,
    };
  });

  const byTotal = [...withScores].sort(
    (a, b) =>
      b.product.totalScore - a.product.totalScore ||
      b.product.deterministicRank - a.product.deterministicRank,
  );

  const mostYouEntry = byTotal[0];
  const mostYouProduct = resolvePrimaryProduct(mostYouEntry.product.handle);
  const mostYouSlot = directionSlotLabel(mostYouEntry.product.slot);

  const directions: ResultDirection[] = [
    {
      label: "most-you",
      displayLabel: "MOST LIKE ME",
      product: mostYouProduct,
      directionalNote: `Strongest alignment with ${profileHint} — the direction that tracks closest to your Profile.`,
    },
  ];

  if (byTotal.length === 1) return directions;

  const remaining = byTotal.slice(1);

  // PUSH ME: product with lowest profile alignment and some session engagement.
  // Must be genuinely less profile-aligned than MOST YOU — otherwise there is no safe
  // stretch and no directions beyond MOST YOU are assigned.
  const pushMeCandidate =
    remaining
      .filter((s) => s.sessionScore > 0)
      .sort(
        (a, b) =>
          a.profileScore - b.profileScore ||
          b.product.totalScore - a.product.totalScore,
      )[0] ?? remaining[remaining.length - 1];

  if (pushMeCandidate.profileScore >= mostYouEntry.profileScore) {
    // No meaningful profile spread — MOST YOU is the only direction.
    return directions;
  }

  const pushMeProduct = resolvePrimaryProduct(pushMeCandidate.product.handle);
  const pushMeSlot = directionSlotLabel(pushMeCandidate.product.slot);
  const pushMeNote = pushMeCandidate.product.slot !== mostYouEntry.product.slot
    ? `The bolder reach — a ${pushMeSlot}-led direction at the outer edge of your Profile alignment.`
    : `The bolder alignment — this ${pushMeSlot} sits furthest from your established ${profileHint}.`;
  directions.push({
    label: "push-me",
    displayLabel: "TRY SOMETHING NEW",
    product: pushMeProduct,
    directionalNote: pushMeNote,
  });

  if (remaining.length === 1) return directions;

  // FRESH: highest totalScore among remaining that is:
  //   (a) not MOST YOU and not PUSH ME
  //   (b) genuinely less profile-aligned than MOST YOU (measurable deviation)
  //   (c) more profile-aligned than PUSH ME (so it sits between them)
  // If no such product exists, FRESH is omitted — meaningful diversity is insufficient.
  const freshEntry = remaining.find(
    (s) =>
      s.product.handle !== pushMeCandidate.product.handle &&
      s.profileScore < mostYouEntry.profileScore &&
      s.profileScore > pushMeCandidate.profileScore,
  ) ??
  // Fallback: accept any remaining that is not PUSH ME and has lower profileScore than MOST YOU,
  // even if it isn't strictly above PUSH ME's score (handles ties at PUSH ME's profileScore).
  remaining.find(
    (s) =>
      s.product.handle !== pushMeCandidate.product.handle &&
      s.profileScore < mostYouEntry.profileScore,
  );

  if (freshEntry) {
    const freshProduct = resolvePrimaryProduct(freshEntry.product.handle);
    const freshSlot = directionSlotLabel(freshEntry.product.slot);
    const freshNote = freshEntry.product.slot !== mostYouEntry.product.slot
      ? `Keeps the ${profileHint}, but shifts the outfit around a ${freshSlot} rather than a ${mostYouSlot}.`
      : `Still within ${profileHint}, but a different proportion balance through the ${freshSlot}.`;
    directions.splice(1, 0, {
      label: "fresh",
      displayLabel: "FRESH TWIST",
      product: freshProduct,
      directionalNote: freshNote,
    });
  }

  return directions;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function computeStyleMeResult(
  engineInput: StyleMeEngineInput,
  _runRec: (input: StyleMeEngineInput) => StyleMeRecommendationResult = runRecommendation,
  _resolveMedia: (handle: string) => VerifiedMediaEntry | undefined = resolveVerifiedMedia,
  _tryOnEnabled: boolean = VIRTUAL_TRY_ON_ENABLED,
  _loadClosetItems?: () => Promise<ClosetAnchorInput[]>,
  // Gap 5 DI seam: allows tests to mock the nAia selection call and count invocations.
  _callNaiaSelection: typeof callClaudeForNaiaSelection = callClaudeForNaiaSelection,
): Promise<StyleMeCustomerResult> {
  const recommendation = _runRec(engineInput);
  const { session } = engineInput;
  const mode: StyleMeMode = engineInput.mode ?? "nadine";

  // Memoised Closet loader — avoids duplicate DB queries when called multiple times.
  let closetItemsCache: ClosetAnchorInput[] | null = null;
  const getClosetItems = _loadClosetItems
    ? async (): Promise<ClosetAnchorInput[]> => {
        if (!closetItemsCache) closetItemsCache = await _loadClosetItems!();
        return closetItemsCache;
      }
    : null;
  const { primary, anchor } = recommendation;

  // Source semantics enforcement:
  // my-closet always presents the customer's own piece as the primary item.
  // The engine may internally score NADINE products; we suppress them here so the
  // outcome is always closet-led and no NADINE product or alternative surfaces.
  const effectiveOutcome: StyleMeOutcome =
    session.source === "my-closet" ? "closet-led" : recommendation.outcome;

  // Session fingerprint (same algorithm used by the engine) for deterministic song pick
  const fingerprint = buildSessionFingerprint(
    session,
    engineInput.profile,
    anchor,
    engineInput.recentlyShownHandles ?? [],
  );

  // Song — deterministic, never from Claude
  const song = selectSong(session.moods, session.occasion, fingerprint);

  // Catalog product lookup for prose and wording context
  const primaryHandle = primary?.handle ?? null;
  const catalogProduct = primaryHandle ? getProductByHandle(primaryHandle) : null;
  const styleMeExplanation = catalogProduct?.parsed.prose.styleMeExplanation ?? null;
  const primaryTitle = catalogProduct?.parsed.identity.verifiedTitle ?? primary?.title ?? null;

  // Finishing layer from catalog prose — pass session context for contextual hair direction
  const finishingLayer = buildFinishingLayer(primaryHandle, {
    occasion: session.occasion,
    formalityConditional: session.formalityConditional ?? null,
  });

  // Closet anchor label and image (used for both closet-led and nadine anchors)
  let closetAnchorLabel: string | null = null;
  let closetAnchorImageUrl: string | null = null;
  if (anchor?.type === "closet") {
    closetAnchorLabel = (anchor as NormalizedClosetAnchor).label;
    closetAnchorImageUrl = (anchor as NormalizedClosetAnchor).imageUrl;
  } else if (anchor?.type === "nadine") {
    closetAnchorLabel = (anchor as NormalizedNadineAnchor).title ?? null;
  }

  // Pairing note from the primary product's anchor compatibility
  const pairingNote = primary?.anchorCompatibility.pairingNote ?? null;

  // Rev 3 result directions — only produced when session carries state/intentions (Group 5 flow).
  // resolveSingleProduct converts a ProductEvaluation handle into a StyleMePrimaryProduct.
  const resolveSingleProduct = (handle: string): StyleMePrimaryProduct | null => {
    const cp = getProductByHandle(handle);
    if (!cp) return null;
    const media = _resolveMedia(handle);
    const imgUrl = resolveDisplayImage(media);
    return {
      handle,
      title: cp.parsed.identity.verifiedTitle,
      slot: cp.parsed.identity.itemType.toLowerCase(),
      shopifyProductId:
        _tryOnEnabled && media?.eligibility === "ready"
          ? (media.shopifyProductGid ?? null)
          : null,
      productImageUrl: imgUrl,
      liveUrl: cp.parsed.identity.liveUrl,
      productUrl:
        media?.shopifyHandle
          ? `https://naiabynadine.com/products/${media.shopifyHandle}`
          : null,
      stylingNotes:
        cp.parsed.prose.styleMeExplanation ??
        `Style the ${cp.parsed.identity.verifiedTitle} with intention.`,
    };
  };
  const isRev3Session = !!(session.state ?? session.intentions?.length);
  let resultDirections: ResultDirection[] = [];
  if (isRev3Session) {
    if (mode === "naia" && getClosetItems) {
      const allItems = await getClosetItems();
      const anchorId =
        anchor?.type === "closet" ? (anchor as NormalizedClosetAnchor).id : null;
      const recentClosetSet = engineInput.recentlyShownClosetIds?.length
        ? new Set(engineInput.recentlyShownClosetIds)
        : undefined;
      resultDirections = computeNaiaResultDirections(allItems, anchorId, session, engineInput.profile, recentClosetSet);
    } else {
      resultDirections = computeResultDirections(
        recommendation.evaluatedProducts,
        resolveSingleProduct,
        buildProfileHint(engineInput.profile),
      );
    }
  }

  // Alternatives — up to 2, from engine output only; order preserved.
  // Suppressed for my-closet (customer piece is the primary; no NADINE complement surfaces).
  const alternatives: StyleMePrimaryProduct[] = session.source === "my-closet"
    ? []
    : recommendation.alternatives
    .slice(0, 2)
    .flatMap((alt) => {
      const altCatalog = getProductByHandle(alt.handle);
      if (!altCatalog) return [];
      const altMedia = _resolveMedia(alt.handle);
      const altImageUrl = resolveDisplayImage(altMedia);
      return [
        {
          handle: alt.handle,
          title: altCatalog.parsed.identity.verifiedTitle,
          slot: altCatalog.parsed.identity.itemType.toLowerCase(),
          shopifyProductId: _tryOnEnabled && altMedia?.eligibility === "ready" ? (altMedia.shopifyProductGid ?? null) : null,
          productImageUrl: altImageUrl,
          liveUrl: altCatalog.parsed.identity.liveUrl,
          productUrl: altMedia?.shopifyHandle ? `https://naiabynadine.com/products/${altMedia.shopifyHandle}` : null,
          stylingNotes:
            altCatalog.parsed.prose.styleMeExplanation ??
            `Style the ${altCatalog.parsed.identity.verifiedTitle} with intention.`,
        } satisfies StyleMePrimaryProduct,
      ];
    });

  // Song reason — deterministic from matched mood/occasion tags; never from Claude
  const songReason = buildSongReason(song.moods, song.occasions, session.moods, session.occasion);

  // Primary product (nAia piece — nadine-recommendation only).
  // Assembled before the Claude call so completion context can inform wording.
  // Never set for my-closet (effectiveOutcome is closet-led).
  let primaryProduct: StyleMePrimaryProduct | null = null;
  if (effectiveOutcome === "nadine-recommendation" && primaryHandle && catalogProduct) {
    const primaryMedia = _resolveMedia(primaryHandle);
    const primaryImageUrl = resolveDisplayImage(primaryMedia);
    primaryProduct = {
      handle: primaryHandle,
      title: catalogProduct.parsed.identity.verifiedTitle,
      slot: catalogProduct.parsed.identity.itemType.toLowerCase(),
      shopifyProductId: _tryOnEnabled && primaryMedia?.eligibility === "ready" ? (primaryMedia.shopifyProductGid ?? null) : null,
      productImageUrl: primaryImageUrl,
      liveUrl: catalogProduct.parsed.identity.liveUrl,
      productUrl: primaryMedia?.shopifyHandle ? `https://naiabynadine.com/products/${primaryMedia.shopifyHandle}` : null,
      stylingNotes: styleMeExplanation ?? `Style the ${catalogProduct.parsed.identity.verifiedTitle} with intention.`,
    };
  }

  // ── Garment selection + wording ────────────────────────────────────────────
  // nAia closet mode: use bounded candidate selection — Claude sees 1–2 validated
  // outfit candidates and picks the one that best serves the session brief, while
  // also generating outfit wording and per-piece notes in a single call.
  // All other modes use the existing selectAdditionalClosetGarments + callClaudeForWording path.

  const isNaiaClosetMode = mode === "naia" && anchor?.type === "closet" && !!getClosetItems;

  let naiaWordingOverride: StyleMeWording | null = null;
  let closetAnchorNote: string | null = null;
  let sameCombination: boolean | undefined;

  if (isNaiaClosetMode) {
    const allItems = await getClosetItems!();
    const recentClosetSet = engineInput.recentlyShownClosetIds?.length
      ? new Set(engineInput.recentlyShownClosetIds)
      : undefined;

    const [candidateA, candidateB, candidateC, candidateD] = buildNaiaOutfitCandidates(
      anchor as NormalizedClosetAnchor,
      session,
      allItems,
      engineInput.profile,
      recentClosetSet,
    );

    const anchorId = (anchor as NormalizedClosetAnchor).id;

    const setPieces = (candidate: OutfitCandidate, noteMap: Map<string, string> | undefined) => {
      recommendation.selectedClosetGarments = candidate.pieces
        .filter((p) => p.closetId !== anchorId)
        .map((p) => {
          const closetItem = allItems.find((i) => i.id === p.closetId);
          return {
            slot: p.slot as OutfitSlot,
            id: p.closetId,
            label: p.label,
            imageUrl: closetItem?.imageUrl ?? null,
            colors: p.colors,
            material: closetItem?.material ?? null,
            stylingNotes: noteMap?.get(p.closetId),
          };
        });
    };

    // Pre-selection: remove any candidate whose complete combination matches the previous
    // persisted outfit. This happens before the Claude call so wording is never generated
    // for a combination that will be rejected.
    const prevIds = engineInput.prevOutfitClosetIds;
    const allCandidates = [candidateA, candidateB, candidateC, candidateD].filter((c): c is OutfitCandidate => c !== null);
    const prevSig = prevIds?.length ? computeOutfitSignature(prevIds) : null;
    const filteredCandidates = prevSig
      ? allCandidates.filter((c) => computeOutfitSignature(c.pieces.map((p) => p.closetId)) !== prevSig)
      : allCandidates;

    if (filteredCandidates.length === 0) {
      // No new combination available — keep previous outfit visible; no model call.
      sameCombination = true;
    } else {
      // Build per-piece occasion evidence (for factual model context and backward-compat diagnostics).
      const occasionEvidence = buildCandidateOccasionEvidence(
        filteredCandidates,
        allItems,
        session.occasion,
      );

      // Evaluate each candidate's whole-outfit suitability — formality register + occasion coverage.
      // This is the single shared ranker: pre-sorts candidates for the model, drives the
      // deterministic fallback, and populates diagnostics.
      const outfitScores = new Map(
        filteredCandidates.map((c) => [c.id, evaluateCompleteOutfit(c, allItems, session)]),
      );

      // Pre-sort candidates best-fit-first before giving them to the model.
      // The model receives a list already ranked by whole-outfit suitability so it
      // can make a fine-grained judgment among pre-validated good candidates.
      // Tiebreak order when compositeScores are equal:
      //   1. within-target formality beats overdressed/underdressed
      //   2. smaller formality deviation (closer to target edge)
      //   3. array order (stable — last resort only when candidates are genuinely equivalent)
      const formalityPriority = (s: OutfitSuitabilityScore | undefined) =>
        s?.formalityFit === "within-target" ? 1 : 0;
      const rankedCandidates = [...filteredCandidates].sort((a, b) => {
        const sa = outfitScores.get(a.id);
        const sb = outfitScores.get(b.id);
        const scoreDiff = (sb?.compositeScore ?? 0) - (sa?.compositeScore ?? 0);
        if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
        const fDiff = formalityPriority(sb) - formalityPriority(sa);
        if (fDiff !== 0) return fDiff;
        return (sa?.formalityOvershoot ?? 0) - (sb?.formalityOvershoot ?? 0);
      });

      // Single selection-and-wording call only. No second AI round trip on failure.
      const naiaCallStart = Date.now();
      const naiaResult = await _callNaiaSelection(
        rankedCandidates,
        session,
        engineInput.profile,
        occasionEvidence,
        allItems,
        outfitScores,
      );
      const naiaModelDurationMs = Date.now() - naiaCallStart;

      // Determine final candidate: model selection or outfit-score fallback.
      let finalCandidate: OutfitCandidate;
      let fallbackUsed: boolean;
      let fallbackReason: string | undefined;

      if (naiaResult) {
        finalCandidate = naiaResult.candidate;
        fallbackUsed = false;
        naiaWordingOverride = naiaResult.wording;
        closetAnchorNote = naiaResult.perPieceNotes.get(anchorId) ?? null;
        setPieces(finalCandidate, naiaResult.perPieceNotes);
      } else {
        // Model call failed, timed out, or returned an invalid response.
        // Fallback: highest compositeScore candidate (already ranked first in rankedCandidates).
        fallbackUsed = true;
        fallbackReason = "model-call-failed-or-invalid";
        finalCandidate = rankedCandidates[0];
        setPieces(finalCandidate, undefined);
      }

      logNaiaSelectionDiag({
        sessionOccasion: session.occasion,
        formalityConditional: session.formalityConditional ?? null,
        candidateCount: filteredCandidates.length,
        evidenceSummary: filteredCandidates.map((c) => {
          const e = occasionEvidence.get(c.id)!;
          const s = outfitScores.get(c.id)!;
          const itemMap = new Map(allItems.map((i) => [i.id, i]));
          return {
            id: c.id,
            knownOccasionPieces: e.knownOccasionPieces,
            matchingOccasionPieces: e.matchingOccasionPieces,
            explicitNonMatches: e.explicitNonMatchCount,
            occasionCoverageRatio: Math.round(e.occasionCoverageRatio * 100) / 100,
            baseAndShoeMatchCount: e.baseAndShoeMatchCount,
            optionalPieceCount: e.optionalPieceCount,
            formalityFit: s.formalityFit,
            outfitFormalityRank: s.outfitFormalityRank,
            targetFormalityRange: s.targetFormalityRange,
            compositeScore: Math.round(s.compositeScore * 100) / 100,
            deterministicFallbackRank: c.id === finalCandidate.id ? "selected" : "not-selected",
            pieces: e.pieces.map((p) => ({
              slot: p.slot, pieceRole: p.pieceRole, label: p.label, occasionStatus: p.occasionStatus,
              formality: itemMap.get(p.closetId)?.formality ?? null,
            })),
          };
        }),
        modelCallAttempted: true,
        modelReturnedId: naiaResult?.candidate.id ?? null,
        modelValidationPassed: naiaResult ? true : undefined,
        modelDurationMs: naiaModelDurationMs,
        fallbackUsed,
        fallbackReason,
        finalCandidateId: finalCandidate.id,
      });
    }
  } else if (getClosetItems) {
    // NADINE mode (or nAia mode without a closet anchor): standard garment scan.
    const allItems = await getClosetItems();
    const recentClosetSetForGarments = engineInput.recentlyShownClosetIds?.length
      ? new Set(engineInput.recentlyShownClosetIds)
      : undefined;
    recommendation.selectedClosetGarments = selectAdditionalClosetGarments(
      anchor ?? null,
      primaryProduct,
      session,
      allItems,
      engineInput.profile,
      recentClosetSetForGarments,
    );
  }

  // Outfit completion — identifies clothing slots still uncovered after the anchor,
  // primary NADINE recommendation, and any additional Closet garments in the look.
  // Computed before wording so the explanation can reference the full outfit.
  const additionalClosetItems = recommendation.selectedClosetGarments ?? [];
  const completionLayer = buildCompletionLayer(anchor ?? null, primaryProduct, session, additionalClosetItems, mode);

  // Anchor summary — passed to both Claude and deterministic fallback so the
  // anchor's colour, slot, and label are available for inclusion in Why This Works.
  const anchorSummary = (() => {
    if (!anchor) return null;
    if (anchor.type === "closet") {
      const ca = anchor as NormalizedClosetAnchor;
      return { label: ca.label, slot: ca.slot as string, colors: ca.colors, material: ca.material, styleTags: ca.styleTags };
    }
    if (anchor.type === "nadine") {
      const na = anchor as NormalizedNadineAnchor;
      return { label: na.title, slot: na.slot as string, colors: na.colors, material: null as string | null, styleTags: [] as string[] };
    }
    return null;
  })();

  // nAia garment labels — only passed to the standard Claude call (not used in nAia closet mode,
  // which already ran callClaudeForNaiaSelection and has naiaWordingOverride).
  const naiaClosetGarmentLabels: Array<{ slot: string; label: string | null }> =
    !naiaWordingOverride && mode === "naia"
      ? [
          ...(anchor?.type === "closet"
            ? [{ slot: (anchor as NormalizedClosetAnchor).slot as string, label: (anchor as NormalizedClosetAnchor).label }]
            : []),
          ...additionalClosetItems.map((cg) => ({ slot: cg.slot, label: cg.label })),
        ]
      : [];

  // Gap 2: nAia closet mode uses naiaWordingOverride only — null means deterministic fallback.
  // No second AI call is ever made in nAia closet mode, regardless of callClaudeForNaiaSelection outcome.
  const claudeWording = isNaiaClosetMode
    ? naiaWordingOverride
    : await callClaudeForWording(
        session.moods,
        session.desiredFeelings,
        session.occasion,
        effectiveOutcome,
        primaryTitle,
        styleMeExplanation,
        completionLayer,
        engineInput.profile?.becoming ?? [],
        engineInput.profile?.styleSupport ?? [],
        engineInput.profile?.finalNotes ?? null,
        anchorSummary,
        session.state === "other" ? (session.stateOtherText ?? null) : null,
        mode,
        naiaClosetGarmentLabels.length ? naiaClosetGarmentLabels : undefined,
      );

  // Build selected-garment metadata list for editorial deterministic fallback:
  // anchor + all additional closet items, each with structured color/material data.
  const selectedGarmentsForFallback: Array<{ slot: string; label: string | null; colors: string[]; material?: string | null }> =
    isNaiaClosetMode && anchorSummary
      ? [
          { slot: anchorSummary.slot, label: anchorSummary.label, colors: anchorSummary.colors, material: anchorSummary.material },
          ...additionalClosetItems.map((cg) => ({ slot: cg.slot, label: cg.label, colors: cg.colors ?? [], material: cg.material ?? null })),
        ]
      : [];

  const wording =
    claudeWording ??
    deterministicWording(
      effectiveOutcome,
      session.moods,
      session.desiredFeelings,
      session.occasion,
      primaryTitle,
      styleMeExplanation,
      completionLayer,
      anchorSummary,
      selectedGarmentsForFallback.length ? selectedGarmentsForFallback : undefined,
      {
        intentions: session.intentions,
        state: session.state ?? null,
        profileHint: buildProfileHint(engineInput.profile),
      },
    );

  return {
    outcome: effectiveOutcome,
    outfitName: wording.outfitName,
    whyThisWorks: wording.whyThisWorks,
    confidenceBoost: wording.confidenceBoost,
    perfumeNote: wording.perfumeNote,
    primaryProduct,
    alternatives,
    closetAnchorLabel,
    closetAnchorImageUrl,
    pairingNote,
    closetAnchorNote,
    sameCombination,
    finishingLayer,
    completionLayer,
    songReason,
    song,
    rawRecommendation: recommendation,
    resultDirections,
  };
}

// ── Per-piece stylingNotes helper ─────────────────────────────────────────────
// Produces a slot-aware, garment-specific note explaining why THIS piece belongs
// in THIS look.  Never generic "Style your X to complete the look."

function buildClosetGarmentNote(
  slot: string,
  label: string | null,
  anchorSlot: string | null,
  primarySlot: string | null,
  primaryTitle: string | null,
  colors: string[],
  anchorLabel: string | null,
  anchorColors: string[],
  occasion: string,
): string {
  const name = label ?? slot;
  const primaryColor = colors[0] ?? null;
  const anchorColor = anchorColors[0] ?? null;
  // True when this piece's primary colour matches the anchor's — enables colour-continuity copy.
  const colorMatchesAnchor = !!(
    primaryColor && anchorColor &&
    primaryColor.toLowerCase() === anchorColor.toLowerCase()
  );
  // If the name already contains the colour word, use "Your [name]" (avoids "The black Black Loafers").
  const nameContainsColor = !!(primaryColor && name.toLowerCase().includes(primaryColor.toLowerCase()));
  const colorRef = (colorMatchesAnchor && !nameContainsColor) ? `The ${primaryColor} ` : "Your ";
  const occasion2 = (occasion === "dinner" || occasion === "date") ? "evening"
    : occasion === "work" ? "work"
    : "everyday";

  // Shoes
  if (slot === "shoe") {
    if (colorMatchesAnchor && anchorLabel) {
      return `Your ${name} carry the ${anchorLabel}'s colour through to the base, so the look closes neatly.`;
    }
    if (anchorLabel) {
      const shoeIsLight = primaryColor === "white" || primaryColor === "cream" || primaryColor === "ivory" || primaryColor === "beige";
      const anchorIsDark = anchorColor === "black" || anchorColor === "navy" || anchorColor === "charcoal";
      if (shoeIsLight && anchorIsDark) {
        return `Your ${name} lighten the combination and stop the ${anchorLabel} from feeling too serious.`;
      }
      return `Your ${name} finish the look at the base alongside the ${anchorLabel}.`;
    }
    return `Your ${name} finish the look from the bottom up.`;
  }

  if (slot === "bag") {
    if (colorMatchesAnchor && anchorLabel) {
      return `${colorRef}${name} echoes the ${anchorLabel}'s colour, keeping the palette cohesive.`;
    }
    if (!colorMatchesAnchor && primaryColor && anchorLabel) {
      return `Your ${name} introduces a ${primaryColor} note alongside the ${anchorLabel} base.`;
    }
    if (anchorLabel) return `Your ${name} keeps the palette anchored — a clean carried accent alongside the ${anchorLabel}.`;
    return `Your ${name} gives the look a clean structural finish.`;
  }

  if (slot === "accessory" || slot === "jewelry") {
    const isLikelyPlural = garmentNameIsPlural(name);
    const finishVerb = isLikelyPlural ? "add" : "adds";
    const colorContrast = primaryColor && anchorColor && !colorMatchesAnchor;
    if (colorContrast && anchorLabel) {
      return `Your ${name} ${finishVerb} a ${primaryColor} accent against the ${anchorLabel}'s palette.`;
    }
    if (colorMatchesAnchor && anchorLabel) {
      return `${colorRef}${name} ${finishVerb} a tonal note above the ${anchorLabel}.`;
    }
    if (anchorLabel) return `Your ${name} ${finishVerb} the finishing detail above the ${anchorLabel} base.`;
    return `Your ${name} ${finishVerb} a finishing detail.`;
  }

  if (slot === "outerwear") {
    if (anchorLabel) return `Your ${name} layers over the ${anchorLabel} and finishes the look.`;
    return `Your ${name} layers over the outfit and gives it its final shape.`;
  }

  if (slot === "top") {
    if (colorMatchesAnchor && anchorLabel && (anchorSlot === "bottom" || anchorSlot === "dress")) {
      return `${colorRef}${name} repeats the ${anchorLabel}'s colour, keeping the palette consistent through the full look.`;
    }
    if (anchorSlot === "bottom" && anchorLabel) {
      if (primaryColor && anchorColor && primaryColor.toLowerCase() !== anchorColor.toLowerCase()) {
        return `Your ${name} gives the combination its definition — the contrast with the ${anchorLabel} is what keeps the look from feeling too casual.`;
      }
      return `Your ${name} works above the ${anchorLabel} and gives the upper half of the look its tone.`;
    }
    if (primarySlot === "bottom" && primaryTitle) {
      return `Your ${name} sits above the ${primaryTitle}, contributing the upper half of the look's colour story.`;
    }
    return `Your ${name} sets the palette and proportion for the rest of the look.`;
  }

  if (slot === "bottom") {
    if (colorMatchesAnchor && anchorLabel && anchorSlot === "top") {
      return `${colorRef}${name} matches the ${anchorLabel}'s colour, keeping the base consistent.`;
    }
    if (anchorSlot === "top" && anchorLabel) {
      if (primaryColor && anchorColor && primaryColor.toLowerCase() !== anchorColor.toLowerCase()) {
        return `Your ${name} relax the combination — the contrast with the ${anchorLabel} is what keeps the outfit from feeling too dressed-up.`;
      }
      return `Your ${name} sits below the ${anchorLabel} and keeps the base of the look steady.`;
    }
    if (primarySlot === "top" && primaryTitle) {
      return `Your ${name} works below the ${primaryTitle} and completes the base of the look.`;
    }
    return `Your ${name} forms the base of the look.`;
  }

  if (slot === "dress" || slot === "set") {
    return `Your ${name} forms the clothing base for this look.`;
  }

  return `Your ${name} completes the look.`;
}

// ── DB payload builder ────────────────────────────────────────────────────────

export function buildDbPayload(result: StyleMeCustomerResult, occasion?: string): StyleMeDbPayload {
  const { outcome, primaryProduct, finishingLayer, song } = result;
  const items: StyleMeDbItem[] = [];

  if (outcome === "nadine-recommendation" && primaryProduct) {
    items.push({
      itemType: slotToItemType(primaryProduct.slot),
      productTitle: primaryProduct.title,
      productImageUrl: primaryProduct.productImageUrl,
      shopifyProductId: primaryProduct.shopifyProductId,
      closetItemId: null,
      stylingNotes: primaryProduct.stylingNotes,
      productUrl: primaryProduct.productUrl,
    });
    // Mixed look (BOTH source): also persist the selected Closet anchor as a
    // garment component so it appears in the outfit alongside the NADINE piece.
    if (result.rawRecommendation.anchor?.type === "closet") {
      const a = result.rawRecommendation.anchor as NormalizedClosetAnchor;
      items.push({
        itemType: slotToItemType(a.slot),
        productTitle: a.label,
        productImageUrl: a.imageUrl ?? null,
        shopifyProductId: null,
        closetItemId: a.id,
        stylingNotes: result.pairingNote ?? `Pair with your ${a.label}.`,
        productUrl: null,
      });
    }
  }

  if (outcome === "closet-led" && result.rawRecommendation.anchor?.type === "closet") {
    const a = result.rawRecommendation.anchor as NormalizedClosetAnchor;
    items.push({
      itemType: slotToItemType(a.slot),
      productTitle: a.label,
      productImageUrl: a.imageUrl ?? null,
      shopifyProductId: null,
      closetItemId: a.id,
      // Prefer Claude-generated anchor note (from nAia candidate selection), then pairing note,
      // then slot-based deterministic fallback.
      stylingNotes: result.closetAnchorNote ?? result.pairingNote ?? (() => {
        const slotNote: Partial<Record<string, string>> = {
          dress:     `Your ${a.label} carries the full silhouette — build accessories around it.`,
          set:       `Your ${a.label} defines the base — style accessories around it.`,
          top:       `Your ${a.label} sets the tone — build the rest of the outfit from here.`,
          bottom:    `Your ${a.label} grounds the look — balance it with your chosen top.`,
          outerwear: `Your ${a.label} leads the outfit — everything layers beneath it.`,
        };
        return slotNote[a.slot] ?? `Your ${a.label} anchors the look.`;
      })(),
      productUrl: null,
    });
  }

  // Additional Closet garments from the multi-item scan.
  // Each gets the "Already Yours" badge in the UI (closetItemId is set).
  // Guard against accidentally re-adding the anchor.
  const anchorClosetId =
    result.rawRecommendation.anchor?.type === "closet"
      ? (result.rawRecommendation.anchor as NormalizedClosetAnchor).id
      : null;
  const closetCoveredSlots = new Set<string>();
  if (anchorClosetId) {
    const anchorSlot = (result.rawRecommendation.anchor as NormalizedClosetAnchor).slot;
    if (anchorSlot) closetCoveredSlots.add(anchorSlot as string);
  }
  const anchorSlotForNotes =
    result.rawRecommendation.anchor?.type === "closet"
      ? ((result.rawRecommendation.anchor as NormalizedClosetAnchor).slot as string)
      : result.rawRecommendation.anchor?.type === "nadine"
      ? ((result.rawRecommendation.anchor as NormalizedNadineAnchor).slot as string)
      : null;
  const anchorLabelForNotes =
    result.rawRecommendation.anchor?.type === "closet"
      ? ((result.rawRecommendation.anchor as NormalizedClosetAnchor).label ?? null)
      : result.rawRecommendation.anchor?.type === "nadine"
      ? ((result.rawRecommendation.anchor as NormalizedNadineAnchor).title ?? null)
      : null;
  const anchorColorsForNotes =
    result.rawRecommendation.anchor?.type === "closet"
      ? ((result.rawRecommendation.anchor as NormalizedClosetAnchor).colors ?? [])
      : result.rawRecommendation.anchor?.type === "nadine"
      ? ((result.rawRecommendation.anchor as NormalizedNadineAnchor).colors ?? [])
      : [];
  for (const cg of result.rawRecommendation.selectedClosetGarments ?? []) {
    if (cg.id === anchorClosetId) continue;
    closetCoveredSlots.add(cg.slot);
    items.push({
      itemType: slotToItemType(cg.slot),
      productTitle: cg.label,
      productImageUrl: cg.imageUrl,
      shopifyProductId: null,
      closetItemId: cg.id,
      // Prefer Claude-generated per-piece note (set in nAia candidate selection path).
      stylingNotes: cg.stylingNotes ?? buildClosetGarmentNote(
        cg.slot,
        cg.label,
        anchorSlotForNotes,
        result.primaryProduct?.slot ?? null,
        result.primaryProduct?.title ?? null,
        cg.colors ?? [],
        anchorLabelForNotes,
        anchorColorsForNotes,
        occasion ?? "everyday",
      ),
      productUrl: null,
    });
  }

  // Finishing layer — persisted for any slot not already covered by a Closet item.
  if (!closetCoveredSlots.has("shoe")) {
    items.push({
      itemType: "SHOES",
      productTitle: null,
      productImageUrl: null,
      shopifyProductId: null,
      closetItemId: null,
      stylingNotes: finishingLayer.shoes,
      productUrl: null,
    });
  }
  if (!closetCoveredSlots.has("bag")) {
    items.push({
      itemType: "BAG",
      productTitle: null,
      productImageUrl: null,
      shopifyProductId: null,
      closetItemId: null,
      stylingNotes: finishingLayer.bag,
      productUrl: null,
    });
  }
  if (!closetCoveredSlots.has("accessory") && !closetCoveredSlots.has("jewelry")) {
    items.push({
      itemType: "ACCESSORY",
      productTitle: null,
      productImageUrl: null,
      shopifyProductId: null,
      closetItemId: null,
      stylingNotes: finishingLayer.accessories,
      productUrl: null,
    });
  }

  return {
    outfitName: result.outfitName,
    whyThisWorks: result.whyThisWorks,
    confidenceBoost: result.confidenceBoost,
    perfumeRec: result.perfumeNote,
    hairstyleRec: finishingLayer.hair || null,
    makeupVibeRec: null,
    songRec: `"${song.title}" by ${song.artist}`,
    songArtist: song.artist,
    items,
    moodDescriptionJson: buildMetadataJson(result),
  };
}
