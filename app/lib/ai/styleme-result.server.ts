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
  NormalizedClosetAnchor,
  NormalizedNadineAnchor,
  NormalizedStyleAnchor,
  StyleMeSessionInput,
} from "./styleme-recommendation.types.js";
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
import { getMappingById } from "./signal-contract.js";
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
  // Rev 3 — Psychology-First wording context (Group 5). Zero engine scoring.
  state?: string;
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
      ...(params.intentions !== undefined && { intentions: params.intentions }),
    },
    profile: params.profile,
    anchor: params.anchor ?? null,
    recentlyShownHandles: params.recentlyShownHandles ?? [],
  };
}

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
  hair: "Style your hair in a way that feels intentional and true to you today.",
  colourDirection: "Build your palette around neutrals, adding one thoughtful accent.",
};

export function buildFinishingLayer(handle: string | null): StyleMeFinishingLayer {
  if (!handle) return GENERIC_FINISHING;
  const product = getProductByHandle(handle);
  if (!product) return GENERIC_FINISHING;
  const prose = product.parsed.prose;
  return {
    shoes: prose.shoeDirection || GENERIC_FINISHING.shoes,
    bag: extractBagSentence(prose.accessoriesDirection) || GENERIC_FINISHING.bag,
    accessories: stripBagLanguage(prose.accessoriesDirection) || GENERIC_FINISHING.accessories,
    hair: prose.hairStylingNote || GENERIC_FINISHING.hair,
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

export function deterministicWording(
  outcome: StyleMeOutcome,
  moods: string[],
  desiredFeelings: string[],
  occasion: string,
  primaryTitle: string | null,
  styleMeExplanation: string | null,
  completionPieces: StyleMeCompletionPiece[] = [],
  anchor?: { label: string | null; slot: string | null; colors: string[] } | null,
): StyleMeWording {
  const moodStr = moods.slice(0, 2).map((m) => m.replace(/-/g, " ")).join(" & ");
  const occasionLabel = occasion.replace(/-/g, " ");

  let outfitName: string;
  if (outcome === "no-eligible-product") {
    outfitName = `${moodStr} direction`.replace(/^\w/, (c) => c.toUpperCase());
  } else if (primaryTitle) {
    outfitName = `${primaryTitle} for ${occasionLabel}`;
  } else {
    outfitName = `${moodStr} for ${occasionLabel}`.replace(/^\w/, (c) => c.toUpperCase());
  }

  const baseWhy =
    outcome === "no-eligible-product"
      ? "No single piece from the catalogue matched every constraint today. The finishing layer below gives you a clear direction to work with."
      : (styleMeExplanation ??
          (desiredFeelings.includes("softer")
            ? `This selection brings a fluid, grounded quality to your ${moodStr} mood for ${occasionLabel}.`
            : `This selection responds to your ${moodStr} mood and your desire to feel ${desiredFeelings[0] ?? "your best"}.` +
              ` The piece supports the way you want to move through ${occasionLabel}.`));

  const completionNote = (() => {
    if (completionPieces.length === 0) return "";
    const topPiece = completionPieces.find((p) => p.slot === "top");
    const bottomPiece = completionPieces.find((p) => p.slot === "bottom");
    const parts: string[] = [];
    if (topPiece) {
      const relation = primaryTitle
        ? `keeps the proportion intentional under ${primaryTitle}`
        : "keeps the silhouette balanced";
      parts.push(`A tonal base ${relation}.`);
    }
    if (bottomPiece) {
      const hasSkirt = /skirt/i.test(bottomPiece.description);
      const bottomWord = hasSkirt ? "skirt" : "trouser";
      parts.push(`A clean ${bottomWord} grounds the look and anchors the palette.`);
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
      return ` Your ${anchor.label}${colourStr} ground the look — they set the colour energy and define the occasion register for every piece above them.`;
    }
    if (anchor.slot === "bag") {
      return ` Your ${anchor.label}${colourStr} is the structural accent that holds the palette together.`;
    }
    return ` Your ${anchor.label}${colourStr} brings a defining accent that ties the whole look together.`;
  })();

  const whyThisWorks = `${baseWhy}${completionNote}${softerNote}${anchorNote}`;
  // Stylist's note (internal field: confidenceBoost — retained for schema/type compat).
  // Semantics changed per Constitution V1: one clothing/styling observation, never an emotional affirmation.
  const confidenceBoost = primaryTitle
    ? `The ${primaryTitle} is the lead piece here — keep everything around it intentional and quiet.`
    : `One strong direction is enough. Keep the rest of the look clean.`;

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

// ── StyleMe wording system prompt (Constitution V1 — locked) ─────────────────
// Exported so tests can assert on tone spec and prohibited-phrase coverage.

export const STYLEME_WORDING_SYSTEM_PROMPT =
  "You are nAia — observant, calm, tasteful, decisive, understated, specific. " +
  "Warm without sentimentality. Respond ONLY with valid JSON, no extra text.\n" +
  "Rules you must follow:\n" +
  "1. Base all wording strictly on the evidence provided in the user message. Do not invent product details, fit, fabric, colour, or compatibility not stated.\n" +
  "2. Do not select, rank, add, remove, or reorder products. Do not introduce any product name or handle not explicitly given to you.\n" +
  "3. For uncertain or inferred points, use conditional language (e.g. 'may work well with', 'tends to').\n" +
  "4. Never use these blocked phrases or concepts: 'stunning piece', 'elevate your wardrobe', 'unleash your inner', 'therapy', 'therapeutic', 'treats', 'cures', 'clinical', 'diagnose', 'mental health', 'emotional healing', " +
  "'Absolutely!', 'Obsessed.', 'Gorgeous!', \"You're going to look amazing\", 'This is so you!', 'Trust me.', 'Game-changer.', 'perfect for you', 'matches your vibe', 'super flattering'.\n" +
  "5. Do not describe clothing as treating, curing, or improving any mental or emotional condition.\n" +
  "6. No marketing filler, clichés, or inflated superlatives.\n" +
  "7. The confidenceBoost field must be one short styling observation or decision — about the garment, not how she will feel. Name what the garment is doing or state one concrete styling note. It must not predict how the customer will feel, affirm her emotionally, or produce a motivational conclusion. Example: 'The blazer is already giving the structure — keep the rest clean.'\n" +
  "8. State (how the customer is feeling today) is CONTEXT ONLY — it describes the customer's brief, not the reason clothing was chosen. Forbidden pattern: \"Because you're stressed, I chose something oversized.\" Required: justify the clothing choice through Intention, Physical Need, garment properties, or Profile evidence — never through State.";

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
): Promise<StyleMeWording | null> {
  const occasionLabel = occasion.replace(/-/g, " ");
  const moodStr = moods.join(", ");
  const feelingStr = desiredFeelings.join(", ");
  const becomingStr = becoming.map((id) => optionLabel("becoming", id)).join(", ");
  const styleSupportStr = styleSupport.map((id) => optionLabel("style-support", id)).join(", ");
  const safeFinalNotes = finalNotes
    ? finalNotes.replace(/"/g, "'").replace(/\n/g, " ").trim()
    : null;

  const context =
    outcome === "no-eligible-product"
      ? "No specific nAia piece was selected for this session."
      : primaryTitle
      ? `The selected piece is: ${primaryTitle}. Styling guidance: ${styleMeExplanation ?? "(none provided)"}`
      : "The customer is dressing from her own closet.";

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
        system: STYLEME_WORDING_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `Write wording for a styling result. The customer is feeling: ${moodStr}. ` +
              `Desired feeling: ${feelingStr}. Occasion: ${occasionLabel}. ${context}` +
              (completionContext ? completionContext : "") +
              (anchorContext ? anchorContext : "") +
              (aspirationContext ? ` ${aspirationContext}` : "") +
              `\n\nReturn a JSON object with exactly these fields:\n` +
              `- outfitName: creative name for this look (≤8 words)\n` +
              `- whyThisWorks: 2–3 sentences explaining why this works for this customer\n` +
              `- confidenceBoost: 1 short styling observation or decision — one specific note about the clothing, proportion, or styling choice (about the garment, not how she will feel). Example: 'The blazer is already giving the structure — keep the rest clean.'\n` +
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
    return { slot: "top", description: `${cap} ${qualifier}${garment} ${baseMaterial}.${proportionNote}${detailSuffix}` };
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
  return {
    slot: "bottom",
    description: `${cap} ${qualifier}${garment} ${baseMaterial}${hemlineSuffix}.${proportionNote}${detailSuffix}`,
  };
}

export function buildCompletionLayer(
  anchor: NormalizedStyleAnchor | null,
  primaryProduct: StyleMePrimaryProduct | null,
  session: StyleMeSessionInput,
  additionalItems: Array<{ slot: string }> = [],
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
    (p) => !p.isHardExcluded && p.totalScore > 0,
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
      displayLabel: "MOST YOU",
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
    displayLabel: "PUSH ME",
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
      displayLabel: "FRESH",
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
): Promise<StyleMeCustomerResult> {
  const recommendation = _runRec(engineInput);
  const { session } = engineInput;
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

  // Finishing layer from catalog prose
  const finishingLayer = buildFinishingLayer(primaryHandle);

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
  const resultDirections: ResultDirection[] = isRev3Session
    ? computeResultDirections(
        recommendation.evaluatedProducts,
        resolveSingleProduct,
        buildProfileHint(engineInput.profile),
      )
    : [];

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

  // Outfit completion — identifies clothing slots still uncovered after the anchor,
  // primary NADINE recommendation, and any additional Closet garments in the look.
  // selectedClosetGarments carries Closet items beyond the anchor that the engine
  // determined are part of the selected outfit. Computed before wording so the
  // explanation can reference the full outfit.
  const additionalClosetItems: Array<{ slot: string }> = recommendation.selectedClosetGarments ?? [];
  const completionLayer = buildCompletionLayer(anchor ?? null, primaryProduct, session, additionalClosetItems);

  // Anchor summary — passed to both Claude and deterministic fallback so the
  // anchor's colour, slot, and label are available for inclusion in Why This Works.
  const anchorSummary = (() => {
    if (!anchor) return null;
    if (anchor.type === "closet") {
      const ca = anchor as NormalizedClosetAnchor;
      return { label: ca.label, slot: ca.slot as string, colors: ca.colors };
    }
    if (anchor.type === "nadine") {
      const na = anchor as NormalizedNadineAnchor;
      return { label: na.title, slot: na.slot as string, colors: na.colors };
    }
    return null;
  })();

  // Claude wording call — falls back to deterministic if it fails
  const claudeWording = await callClaudeForWording(
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
  );

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
    finishingLayer,
    completionLayer,
    songReason,
    song,
    rawRecommendation: recommendation,
    resultDirections,
  };
}

// ── DB payload builder ────────────────────────────────────────────────────────

export function buildDbPayload(result: StyleMeCustomerResult): StyleMeDbPayload {
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
      stylingNotes: result.pairingNote ?? `Style your ${a.label} with intention.`,
      productUrl: null,
    });
  }

  // Finishing layer is always persisted regardless of outcome.
  // no-eligible-product and closet-led both need shoes, bag and accessories.
  items.push({
    itemType: "SHOES",
    productTitle: null,
    productImageUrl: null,
    shopifyProductId: null,
    closetItemId: null,
    stylingNotes: finishingLayer.shoes,
    productUrl: null,
  });
  items.push({
    itemType: "BAG",
    productTitle: null,
    productImageUrl: null,
    shopifyProductId: null,
    closetItemId: null,
    stylingNotes: finishingLayer.bag,
    productUrl: null,
  });
  items.push({
    itemType: "ACCESSORY",
    productTitle: null,
    productImageUrl: null,
    shopifyProductId: null,
    closetItemId: null,
    stylingNotes: finishingLayer.accessories,
    productUrl: null,
  });

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
