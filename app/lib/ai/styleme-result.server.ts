// app/lib/ai/styleme-result.server.ts
// Phase 3D — wires runRecommendation() into the StyleMe result experience.
//
// Product selection and ranking: runRecommendation() only — never Claude.
// Wording (outfitName, whyThisWorks, confidenceBoost, perfumeNote): Claude only.
// Song: deterministic from curated catalog via selectSong().
// Finishing layer: catalog prose fields (shoeDirection, accessoriesDirection, etc.).

import { runRecommendation, buildSessionFingerprint } from "./styleme-recommendation.js";
import type {
  StyleMeEngineInput,
  StyleMeProfileSignals,
  StyleMeRecommendationResult,
  AnchorInput,
  NormalizedClosetAnchor,
  NormalizedNadineAnchor,
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
} from "./styleme-result.types.js";

// ── Profile signal builder ────────────────────────────────────────────────────

export function buildProfileSignals(
  profile: {
    stylePersonalities?: string[] | null;
    favoriteColors?: string[] | null;
    avoidColors?: string[] | null;
    styleSupport?: string[] | null;
    desiredImpression?: string[] | null;
  } | null | undefined,
): StyleMeProfileSignals | undefined {
  if (!profile) return undefined;
  const signals: StyleMeProfileSignals = {};
  if (profile.stylePersonalities?.length) signals.stylePersonalities = profile.stylePersonalities;
  if (profile.favoriteColors?.length) signals.favoriteColors = profile.favoriteColors;
  if (profile.avoidColors?.length) signals.avoidColors = profile.avoidColors;
  if (profile.styleSupport?.length) signals.styleSupport = profile.styleSupport;
  if (profile.desiredImpression?.length) signals.desiredImpression = profile.desiredImpression;
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
    accessories: prose.accessoriesDirection || GENERIC_FINISHING.accessories,
    hair: prose.hairStylingNote || GENERIC_FINISHING.hair,
    colourDirection: prose.colorDirection || GENERIC_FINISHING.colourDirection,
  };
}

function extractBagSentence(accessoriesDir: string): string {
  const match = accessoriesDir.match(/(?:^|[.!?]\s+)([^.!?]*\bbag\b[^.!?]*[.!?])/i);
  if (match) return match[1].trim();
  return accessoriesDir;
}

// ── Deterministic wording fallback ────────────────────────────────────────────

export function deterministicWording(
  outcome: StyleMeOutcome,
  moods: string[],
  desiredFeelings: string[],
  occasion: string,
  primaryTitle: string | null,
  styleMeExplanation: string | null,
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

  const whyThisWorks =
    outcome === "no-eligible-product"
      ? "No single piece from the catalogue matched every constraint today. The finishing layer below gives you a clear direction to work with."
      : (styleMeExplanation ??
          `This selection responds to your ${moodStr} mood and your desire to feel ${desiredFeelings[0] ?? "your best"}.` +
          ` The piece supports the way you want to move through ${occasionLabel}.`);

  const confidenceBoost = `You dressed intentionally for ${occasionLabel} — and that intention shows.`;

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
  if (rawAnchor?.type === "nadine") {
    anchorMeta = { type: "nadine", handle: (rawAnchor as NormalizedNadineAnchor).handle };
  } else if (rawAnchor?.type === "closet") {
    anchorMeta = { type: "closet", id: (rawAnchor as NormalizedClosetAnchor).id };
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
    })),
    anchor: anchorMeta,
    anchorSummary: result.closetAnchorLabel,
    pairingNote: result.pairingNote,
    colourDirection: result.finishingLayer.colourDirection,
    songReason: result.songReason,
    evidenceCodes: [],
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
): Promise<StyleMeWording | null> {
  const occasionLabel = occasion.replace(/-/g, " ");
  const moodStr = moods.join(", ");
  const feelingStr = desiredFeelings.join(", ");

  const context =
    outcome === "no-eligible-product"
      ? "No specific nAia piece was selected for this session."
      : primaryTitle
      ? `The selected piece is: ${primaryTitle}. Styling guidance: ${styleMeExplanation ?? "(none provided)"}`
      : "The customer is dressing from her own closet.";

  try {
    const result = await Promise.race<ClaudeWordingResponse | null>([
      callClaudeJSON<ClaudeWordingResponse>({
        system:
          "You are nAia, a warm and confident AI personal stylist. Respond ONLY with valid JSON, no extra text.\n" +
          "Rules you must follow:\n" +
          "1. Base all wording strictly on the evidence provided in the user message. Do not invent product details, fit, fabric, colour, or compatibility not stated.\n" +
          "2. Do not select, rank, add, remove, or reorder products. Do not introduce any product name or handle not explicitly given to you.\n" +
          "3. For uncertain or inferred points, use conditional language (e.g. 'may work well with', 'tends to').\n" +
          "4. Never use these blocked phrases or concepts: 'stunning piece', 'elevate your wardrobe', 'unleash your inner', 'therapy', 'therapeutic', 'treats', 'cures', 'clinical', 'diagnose', 'mental health', 'emotional healing'.\n" +
          "5. Do not describe clothing as treating, curing, or improving any mental or emotional condition.\n" +
          "6. No marketing filler, clichés, or inflated superlatives.",
        messages: [
          {
            role: "user",
            content:
              `Write wording for a styling result. The customer is feeling: ${moodStr}. ` +
              `Desired feeling: ${feelingStr}. Occasion: ${occasionLabel}. ${context}\n\n` +
              `Return a JSON object with exactly these fields:\n` +
              `- outfitName: creative name for this look (≤8 words)\n` +
              `- whyThisWorks: 2–3 sentences explaining why this works for this customer\n` +
              `- confidenceBoost: 1 short affirming sentence about how she will feel\n` +
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

  // Closet anchor label (used for both closet-led and nadine anchors)
  let closetAnchorLabel: string | null = null;
  if (anchor?.type === "closet") {
    closetAnchorLabel = (anchor as NormalizedClosetAnchor).label;
  } else if (anchor?.type === "nadine") {
    closetAnchorLabel = (anchor as NormalizedNadineAnchor).title ?? null;
  }

  // Pairing note from the primary product's anchor compatibility
  const pairingNote = primary?.anchorCompatibility.pairingNote ?? null;

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
      const altImageUrl = _tryOnEnabled && altMedia?.eligibility === "ready" ? altMedia.resolvedUrl : null;
      return [
        {
          handle: alt.handle,
          title: altCatalog.parsed.identity.verifiedTitle,
          slot: altCatalog.parsed.identity.itemType.toLowerCase(),
          shopifyProductId: _tryOnEnabled && altMedia?.eligibility === "ready" ? (altMedia.shopifyProductGid ?? null) : null,
          productImageUrl: altImageUrl,
          liveUrl: altCatalog.parsed.identity.liveUrl,
          stylingNotes:
            altCatalog.parsed.prose.styleMeExplanation ??
            `Style the ${altCatalog.parsed.identity.verifiedTitle} with intention.`,
        } satisfies StyleMePrimaryProduct,
      ];
    });

  // Song reason — deterministic from matched mood/occasion tags; never from Claude
  const songReason = buildSongReason(song.moods, song.occasions, session.moods, session.occasion);

  // Claude wording call — falls back to deterministic if it fails
  const claudeWording = await callClaudeForWording(
    session.moods,
    session.desiredFeelings,
    session.occasion,
    effectiveOutcome,
    primaryTitle,
    styleMeExplanation,
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
    );

  // Primary product (nAia piece — nadine-recommendation only).
  // Never set for my-closet (effectiveOutcome is closet-led).
  // productImageUrl is populated only when the verified media map has a "ready" entry;
  // all other states (needs-manual-review, unsupported-layering, etc.) keep it null,
  // which keeps the try-on CTA hidden in result.tsx.
  let primaryProduct: StyleMePrimaryProduct | null = null;
  if (effectiveOutcome === "nadine-recommendation" && primaryHandle && catalogProduct) {
    const primaryMedia = _resolveMedia(primaryHandle);
    const primaryImageUrl = primaryMedia?.eligibility === "ready" ? primaryMedia.resolvedUrl : null;
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

  return {
    outcome: effectiveOutcome,
    outfitName: wording.outfitName,
    whyThisWorks: wording.whyThisWorks,
    confidenceBoost: wording.confidenceBoost,
    perfumeNote: wording.perfumeNote,
    primaryProduct,
    alternatives,
    closetAnchorLabel,
    pairingNote,
    finishingLayer,
    songReason,
    song,
    rawRecommendation: recommendation,
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
  }

  if (outcome === "closet-led" && result.rawRecommendation.anchor?.type === "closet") {
    const a = result.rawRecommendation.anchor as NormalizedClosetAnchor;
    items.push({
      itemType: slotToItemType(a.slot),
      productTitle: a.label,
      productImageUrl: null,
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
