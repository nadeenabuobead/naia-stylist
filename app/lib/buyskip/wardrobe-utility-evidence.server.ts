// app/lib/buyskip/wardrobe-utility-evidence.server.ts
// B4 — replaces the wardrobe-need.server.ts stub with a thin adapter into
// Wardrobe Intelligence's own already-computed, already-threshold-gated
// findings. This module invents nothing: it does not recompute "enough"
// clustering, does not invent a gap rule, and does not introduce a new
// utility score. It only asks whether a candidate matches evidence WI has
// already published for the customer's current Closet.
//
// ── Redundancy / gap ─────────────────────────────────────────────────────
// Both key off WardrobeNeeds.enough / .couldUseMore (wardrobe-needs.ts
// buildFindings()) — real DepthFinding records already gated by WI's own
// thresholds (ENOUGH_CLUSTER, THIN_LOOKS, etc., all private to that module
// and never reproduced here).
//
// WI's own "enough" cluster identity is register + slot + colour-band
// (clustersOf(), private). Matching a candidate against it on register+slot
// ALONE would be coarser than the primitive being reused and risks a false
// positive. Colour-band ("neutral" vs "colour") is therefore derived for the
// candidate using deriveColourProfile() from garment-intelligence-v1.server —
// the SAME function wardrobe-intelligence.server.ts calls to populate every
// real Closet item's colourProfile.wardrobeNeutral. It is a pure classifier
// (primaryColor + material → band), not a GI pipeline call: no persistence,
// no AI call, no ResolvedGarment write. When the candidate has no resolvable
// colour at all, band cannot be derived — redundancy is reported
// `unavailable`, never silently matched on the remaining two dimensions.
// Visual weight is derived the same way, via deriveVisualWeight(), purely so
// supportedPair()'s own colour/weight reasoning (below) sees real candidate
// data instead of a permissively-null default.
//
// `couldUseMore` holds three finding kinds (could-use-more, effective-depth,
// repetition) — not all three represent an unmet need. "repetition" is WI's
// own diagnostic for "plenty of usable pieces, but they collapse into too
// few looks" and its own copy says buying more would be "exactly wrong" —
// collapsing a repetition match into fills-gap would overclaim. Only
// could-use-more and effective-depth (both genuine thinness, gated by the
// same THIN_LOOKS/needed check) ever produce `fills-gap`; a repetition match
// is surfaced as background provenance only, status stays `no-clear-gap`.
//
// ── Utility ──────────────────────────────────────────────────────────────
// Raw evidence only — how many owned pieces the candidate would genuinely
// pair with, via the existing supportedPair() primitive. No "additive /
// neutral / limited" classification: no canonical WI utility score exists to
// reuse, and inventing one here would be a new product decision.
//
// ── Synthetic candidate ──────────────────────────────────────────────────
// Built as an explicit literal, never by spreading a real Closet item —
// every field consumed by garmentRegister()/supportedPair() (traced against
// their actual bodies: scorePair, functionCompatible, weightBalanced,
// colourCompatible, formalityDistance) is either real candidate data or an
// explicit, honest neutral (occasions: [], garmentRelationships: [],
// category: "" — Buy/Skip's own category vocabulary never includes the
// ACTIVEWEAR/LOUNGEWEAR values FUNCTIONAL_CATEGORIES checks, so "" reads
// correctly as non-functional, not as a guess). Nothing is inherited from an
// unrelated owned garment, so the result cannot vary with which Closet items
// happen to exist — proven by wardrobe-utility-evidence.test.ts.
//
// Verdict authority: NONE. This evidence is never passed to
// applyHardConstraintVeto or any override path — same evidence-only posture
// as B3's outcome history.

import type { WardrobeGarment, ResolvedColourProfile, ResolvedVisualWeight } from "~/lib/ai/wardrobe-intelligence";
import type { WardrobeIntelligenceBundle } from "~/lib/ai/wardrobe-intelligence.server";
import type { DepthFinding, FindingKind } from "~/lib/ai/wardrobe-needs";
import { garmentRegister, supportedPair } from "~/lib/ai/wardrobe-needs";
import { deriveColourProfile, deriveVisualWeight } from "~/lib/admin/garment-intelligence-v1.server";

export type RedundancyStatus = "unavailable" | "no-match" | "already-enough";
export type GapStatus = "unavailable" | "no-clear-gap" | "fills-gap";

export interface RedundancyEvidence {
  status: RedundancyStatus;
  reason: string | null;
  findingId: string | null;
  title: string | null;
  body: string | null;
  garmentIds: string[];
}

export interface GapEvidence {
  status: GapStatus;
  reason: string | null;
  findingId: string | null;
  title: string | null;
  body: string | null;
  garmentIds: string[];
  kind: FindingKind | null;
  /** Set only when the sole register match was a "repetition" finding —
   * real WI signal, kept as background context, deliberately not promoted
   * to fills-gap. See module header. */
  backgroundFinding: { id: string; title: string; body: string; kind: FindingKind } | null;
}

export interface UtilityEvidence {
  status: "unavailable" | "evidence-only";
  complementCount: number;
  complementItemIds: string[];
}

export interface WardrobeUtilityEvidence {
  redundancy: RedundancyEvidence;
  gap: GapEvidence;
  utility: UtilityEvidence;
}

export interface CandidateWardrobeFacts {
  slot: string;
  primaryColor: string | null;
  silhouette: string | null;
  fitProfile: string | null;
  formality: string | null;
  material: string | null;
  pattern: string | null;
}

const UNAVAILABLE: WardrobeUtilityEvidence = {
  redundancy: { status: "unavailable", reason: "Wardrobe Intelligence is not available for this assessment.", findingId: null, title: null, body: null, garmentIds: [] },
  gap: { status: "unavailable", reason: "Wardrobe Intelligence is not available for this assessment.", findingId: null, title: null, body: null, garmentIds: [], kind: null, backgroundFinding: null },
  utility: { status: "unavailable", complementCount: 0, complementItemIds: [] },
};

const GENUINE_GAP_KINDS: ReadonlySet<FindingKind> = new Set(["could-use-more", "effective-depth"]);

/**
 * A synthetic, never-persisted WardrobeGarment representing the Buy/Skip
 * candidate. Built as an explicit literal — see module header for the full
 * field-by-field justification. colourProfile/visualWeight are derived via
 * the same canonical functions WI uses for every real garment, applied to
 * the candidate's own known facts; they are left null when the source
 * fields needed to derive them are themselves absent (deriveColourProfile /
 * deriveVisualWeight already encode that "insufficient data" case — see
 * resolveCandidateColourProfile below for the one case this module guards
 * itself, where deriveColourProfile's own null-colour default is not
 * reliable enough to reuse as "neutral: false").
 */
function candidateAsWardrobeGarment(
  facts: CandidateWardrobeFacts,
  colourProfile: ResolvedColourProfile | null,
  visualWeight: ResolvedVisualWeight | null,
): WardrobeGarment {
  return {
    id: "__buyskip-candidate__",
    name: null,
    category: "",
    subcategory: null,
    imageUrl: null,
    slot: facts.slot,
    primaryColor: facts.primaryColor,
    colors: facts.primaryColor ? [facts.primaryColor] : [],
    pattern: facts.pattern,
    material: facts.material,
    silhouette: facts.silhouette,
    fitProfile: facts.fitProfile,
    formality: facts.formality,
    stylePersonality: null,
    occasions: [],
    seasons: [],
    analysisStatus: "ready",
    visualWeight,
    colourProfile,
    garmentRelationships: [],
    intentions: null,
    intentionsSource: null,
    intelligenceSource: "none",
    outfitAppearances: 0,
    savedLookAppearances: 0,
    observedWear: null,
  };
}

/**
 * deriveColourProfile({primaryColor: null, ...}) returns wardrobeNeutral:
 * false as its own "nothing to classify" default — not a reliable "this
 * candidate is non-neutral" claim. That default is only trustworthy when a
 * real colour string went in, so this function refuses to call
 * deriveColourProfile at all when there is no colour to give it, rather
 * than inherit a false-by-default answer as if it were a real reading.
 */
function resolveCandidateColourProfile(facts: CandidateWardrobeFacts): ResolvedColourProfile | null {
  if (!facts.primaryColor) return null;
  const result = deriveColourProfile({
    primaryColor: facts.primaryColor,
    colors: [facts.primaryColor],
    material: facts.material ?? undefined,
  });
  return {
    hueFamily: result.hueFamily,
    wardrobeNeutral: result.wardrobeNeutral,
    lightDark: result.lightDark,
    energyTier: result.energyTier,
  };
}

function resolveCandidateVisualWeight(facts: CandidateWardrobeFacts): ResolvedVisualWeight | null {
  return deriveVisualWeight({
    pattern: facts.pattern,
    silhouette: facts.silhouette,
    material: facts.material,
    fitProfile: facts.fitProfile ?? undefined,
  }).value;
}

/**
 * Does this "enough" finding genuinely cover the candidate's own slot AND
 * colour-band? Checked against the REAL owned garments it names (garmentIds
 * resolved via the wi.garments bundle), not against the finding's own
 * private cluster key, which is never exposed. Register is already a
 * precondition on the caller side (the finding list is pre-filtered by
 * register before this is called).
 */
function enoughFindingMatchesCandidate(
  finding: DepthFinding,
  candidateSlot: string,
  candidateWardrobeNeutral: boolean,
  garmentsById: Map<string, WardrobeGarment>,
): boolean {
  return finding.garmentIds.some((id) => {
    const g = garmentsById.get(id);
    if (!g || g.slot !== candidateSlot || !g.colourProfile) return false;
    return g.colourProfile.wardrobeNeutral === candidateWardrobeNeutral;
  });
}

/** Only needs/garments are ever read — narrowed deliberately so the type
 * itself documents that this module never touches WI's intelligence or
 * recommendations output. */
export type WardrobeUtilitySource = Pick<WardrobeIntelligenceBundle, "needs" | "garments">;

export function computeWardrobeUtilityEvidence(input: {
  wi: WardrobeUtilitySource | null;
  candidate: CandidateWardrobeFacts;
}): WardrobeUtilityEvidence {
  const { wi, candidate } = input;
  if (!wi) return UNAVAILABLE;

  const candidateColourProfile = resolveCandidateColourProfile(candidate);
  const candidateVisualWeight = resolveCandidateVisualWeight(candidate);
  const candidateGarment = candidateAsWardrobeGarment(candidate, candidateColourProfile, candidateVisualWeight);
  const register = garmentRegister(candidateGarment);
  const garmentsById = new Map(wi.garments.map((g) => [g.id, g] as const));

  let redundancy: RedundancyEvidence;
  if (register === null) {
    redundancy = { status: "unavailable", reason: "This candidate's register (everyday / work / occasion) could not be determined.", findingId: null, title: null, body: null, garmentIds: [] };
  } else if (candidateColourProfile === null) {
    redundancy = { status: "unavailable", reason: "This candidate's colour could not be determined, and colour band is one of the dimensions Wardrobe Intelligence's own redundancy signal requires.", findingId: null, title: null, body: null, garmentIds: [] };
  } else {
    const match = wi.needs.enough.find(
      (f) => f.register === register && enoughFindingMatchesCandidate(f, candidate.slot, candidateColourProfile.wardrobeNeutral, garmentsById),
    );
    redundancy = match
      ? { status: "already-enough", reason: null, findingId: match.id, title: match.title, body: match.body, garmentIds: match.garmentIds }
      : { status: "no-match", reason: null, findingId: null, title: null, body: null, garmentIds: [] };
  }

  let gap: GapEvidence;
  if (register === null) {
    gap = { status: "unavailable", reason: "This candidate's register (everyday / work / occasion) could not be determined.", findingId: null, title: null, body: null, garmentIds: [], kind: null, backgroundFinding: null };
  } else {
    const match = wi.needs.couldUseMore.find((f) => f.register === register);
    if (match && GENUINE_GAP_KINDS.has(match.kind)) {
      gap = { status: "fills-gap", reason: null, findingId: match.id, title: match.title, body: match.body, garmentIds: match.garmentIds, kind: match.kind, backgroundFinding: null };
    } else if (match) {
      // kind === "repetition" (the only remaining FindingKind buildFindings()
      // pushes into couldUseMore) — real WI signal, not a fillable gap.
      gap = {
        status: "no-clear-gap", reason: null, findingId: null, title: null, body: null, garmentIds: [], kind: null,
        backgroundFinding: { id: match.id, title: match.title, body: match.body, kind: match.kind },
      };
    } else {
      gap = { status: "no-clear-gap", reason: null, findingId: null, title: null, body: null, garmentIds: [], kind: null, backgroundFinding: null };
    }
  }

  const complementItemIds = wi.garments
    .filter((g) => supportedPair(candidateGarment, g))
    .map((g) => g.id);

  return {
    redundancy,
    gap,
    utility: {
      status: "evidence-only",
      complementCount: complementItemIds.length,
      complementItemIds,
    },
  };
}
