// app/lib/ai/customer-intelligence-contract.ts
// Shared Customer Intelligence — Phase 1: contract types only.
// Pure module: no DB, no LLM, no side effects, no imports.
//
// This is vocabulary, not behavior. It names the shape a future
// resolveCustomerIntelligence() would return, so later work (the resolver,
// per-source adapters, new consumers) can be built against one agreed
// contract instead of each feature inventing its own. Nothing in the repo
// imports this file yet, and nothing should until a specific resolver/
// adapter phase is explicitly approved — see the architecture recon this
// contract was written against for the full reasoning and the phased plan.
//
// Scope, locked by that recon:
//   - Five signal classes, kept deliberately distinct. A request is not
//     preference. Owning many of something is not wanting more. A
//     generated-but-never-reviewed look is not evidence of anything.
//   - No single numerical score. Different signal classes carry support in
//     shapes that are not mutually comparable — see FindingSupport.
//   - Provenance is typed per source, not forced into one "every source is
//     an event" shape — see ProvenanceRef. Passport and Closet state are
//     not events.
//   - Temporal metadata is honest about which sources have a real date
//     range and which don't — see FindingTemporal's explicit "none".

// ── Signal classes ───────────────────────────────────────────────────────────
//
// What kind of claim this is, never collapsed into a generic "preference":
//   explicit-truth      — Passport. Direct, customer-stated, outranks inference.
//   explicit-outcome     — what she reported happened (StyleMe outcome,
//                          Buy-or-Skip post-purchase outcome).
//   explicit-demand      — what she keeps asking for (StyleMe demand). A
//                          request, never a confirmed result.
//   observed-state        — structural facts about the Closet as it stands.
//                          Orthogonal to the three above, not a weaker
//                          version of them — see the precedence rule below.
//   derived-inference     — reconciled tendencies (StyleTendency-class
//                          output). The lowest tier precisely because it is
//                          inferred from the other four, never the reverse.

export const SIGNAL_CLASSES = [
  "explicit-truth",
  "explicit-outcome",
  "explicit-demand",
  "observed-state",
  "derived-inference",
] as const;

export type SignalClass = (typeof SIGNAL_CLASSES)[number];

// ── Precedence ────────────────────────────────────────────────────────────────
//
// Architecture rule (documentation only — no resolution logic lives here):
//
//   Precedence applies ONLY when two findings compete on the same semantic
//   question. Among the four classes that can genuinely compete:
//
//     explicit-truth > explicit-outcome > explicit-demand > derived-inference
//
//   Outranking does not mean discarding — a lower-tier finding that
//   contradicts a higher one is still reported, not deleted (e.g. "Passport
//   says fitted silhouettes; she repeatedly asks for relaxed looks" surfaces
//   both as a stated identity preference and a recent behavioural drift).
//
//   observed-state is deliberately absent from this order. It answers a
//   different question ("what currently exists", not "what does she want")
//   and is never ranked against a preference/demand finding. Example:
//   Passport says she likes black; the Closet contains little black. Both
//   remain true — there is no competition to resolve, so there is nothing
//   for precedence to do here. A future resolver must never apply
//   PRECEDENCE_ORDER to an observed-state finding.
export const PRECEDENCE_ORDER = [
  "explicit-truth",
  "explicit-outcome",
  "explicit-demand",
  "derived-inference",
] as const satisfies readonly Exclude<SignalClass, "observed-state">[];

// ── Provenance ────────────────────────────────────────────────────────────────
//
// Typed per source rather than one "every source is an event" shape —
// Passport is a profile snapshot, not an event; observed Closet state is
// naturally multi-garment, matching how WI's own ev() evidence already
// carries garmentIds[] rather than a single id.

export type ProvenanceRef =
  | { kind: "passport"; field?: string }
  /** Reserved for an adapter that genuinely holds a StyleMeOutcome row id.
   * No current adapter does — see the two aggregate-reference variants
   * below, which is what wardrobe-feedback-evidence.ts's public output
   * (FormulaEvidence / GarmentPositiveEvidence) actually retains. Do not
   * populate this one with a formulaKey or closetItemId; that would be a
   * manufactured id, not a real row reference. */
  | { kind: "styleme-outcome"; id: string }
  /** Honest reference to a formula-level aggregate — the frozen module's
   * own formulaKey, never an individual outcome submission id (it doesn't
   * retain those). */
  | { kind: "styleme-outcome-formula"; formulaKey: string }
  /** Honest reference to a garment-level aggregate — the frozen module's
   * own closetItemId, same reasoning. */
  | { kind: "styleme-outcome-garment"; closetItemId: string }
  /** Demand provenance has no such gap — DemandEvent.sessionId is a real,
   * surviving session id from the frozen 90-day derivation. */
  | { kind: "styleme-demand"; id: string }
  | { kind: "closet-state"; itemIds: string[] }
  | { kind: "taste-tendency"; id: string }
  /** Honest reference to the BuyOrSkipAnalysis row — never a BuySkipOutcome
   * id. The two are different tables with different id spaces; collapsing
   * them into one generic "buy-skip" slot was the same ambiguity the two
   * styleme-outcome-* variants above exist to prevent, so there is no
   * generic variant here either. */
  | { kind: "buy-skip-analysis"; id: string }
  /** Honest reference to the BuySkipOutcome row — never a BuyOrSkipAnalysis
   * id. Covers the customer's purchase-decision AND post-purchase-outcome
   * findings, since both are read off the same outcome row. */
  | { kind: "buy-skip-outcome"; id: string };

// ── Support ──────────────────────────────────────────────────────────────────
//
// Deliberately not one universal scalar — a demand count and a reconciled
// tendency score answer different questions and are not meant to be
// compared numerically against each other.
//
// The "count" kind carries two optional, source-native qualifiers rather
// than forcing every count to be either a bare number or a full
// "reconciled" shape:
//   tier      — a source's own supported-ness label, when it has one, e.g.
//               "supported" | "strongly-supported" (wardrobe-feedback-
//               evidence.ts's FormulaSupportState — not imported here, kept
//               as a plain string so this contract stays dependency-free;
//               "none" is never actually emitted, since a finding with no
//               tier-worthy evidence produces no finding at all). A count
//               with no native tier (demand, garment-level outcome counts)
//               simply omits this field — never invent one.
//   qualifier — an outcome-specific direction, when the source has one:
//               "positive" | "negative" | "mixed" | "neutral". This is NOT a
//               universal polarity field — demand counts never set it,
//               because a request has no direction. It exists on "count"
//               specifically so outcome evidence can state whether a count
//               is affirming, contradicting, genuinely ambiguous, or
//               genuinely neutral, without forcing every signal class to
//               pretend it has a polarity. "neutral" (added for Buy-or-Skip
//               post-purchase outcome's ITS_OKAY) is deliberately distinct
//               from omitting qualifier entirely: omitted means "this count
//               has no polarity dimension at all" (e.g. a purchase-decision
//               finding — bought/didn't-buy is an action, not a taste
//               claim); "neutral" means "this source DOES have a polarity
//               dimension here, and the customer's answer sits in the
//               middle of it" (she bought it, it was fine either way).
//
// IMPORTANT: signalClass "explicit-outcome" alone never implies a positive
// claim. A "mixed", "negative", or "neutral" qualifier is exactly as
// "explicit-outcome" as a "positive" one — a resolver must read
// support.qualifier before treating any count-shaped outcome finding as
// affirmative.
export type FindingSupport =
  | { kind: "direct" }
  | { kind: "count"; value: number; tier?: string; qualifier?: "positive" | "negative" | "mixed" | "neutral" }
  | { kind: "structural"; value?: number; label?: string }
  | { kind: "reconciled"; score: number; state?: string };

// ── Subject ──────────────────────────────────────────────────────────────────
//
// For findings where `value` IS a decision/outcome state rather than the
// thing the decision was about (Buy-or-Skip purchase-decision and
// post-purchase-outcome: value is "BOUGHT_IT" / "LOVE_IT" / etc.), `value`
// alone loses which item/category the decision was about. Do not encode
// this by compounding it into `value` as a string (e.g. "dress|bought-it")
// and do not overload `source` or `dimension` with it either — both of
// those already mean something specific (where evidence came from; what
// kind of claim value is). `subject` is the smallest additive fix: an
// optional, typed "what this finding is about" companion to `value`, left
// absent for findings (like considered-category, or any Passport/WI
// finding) where the category/subject already IS `value` and there is
// nothing else to separate it from.
export type FindingSubject = { kind: "garment-category"; value: string };

// ── Temporal metadata ────────────────────────────────────────────────────────
//
// Optional in substance via an explicit "none" variant, rather than an
// optional field that invites a caller to invent a date when a source
// (Passport, most structural reads) has no natural one.

export type FindingTemporal =
  | { kind: "range"; firstSeen: string; lastSeen: string }
  | { kind: "snapshot"; observedAt: string }
  | { kind: "stated"; updatedAt?: string }
  | { kind: "none" };

// ── The finding itself ───────────────────────────────────────────────────────
//
// What a future resolveCustomerIntelligence() would return per claim. Not
// implemented here — this is the shape only.

export interface ResolvedFinding {
  /** What nAia concluded, in the vocabulary of its own signal class — never
   * flattened into one generic "preference" string. */
  value: string;
  signalClass: SignalClass;
  /** Which concrete source/evidence family produced this — WHERE it came
   * from, e.g. "passport" | "styleme-outcome" | "styleme-demand" |
   * "closet-state" | "taste-tendency" | "buy-skip". Never used to encode
   * WHAT the value represents or its polarity — that's dimension and
   * support.qualifier respectively. One source can and should produce
   * findings across several dimensions (styleme-demand → register AND
   * intention; styleme-outcome → outfit-formula AND garment). */
  source: string;
  /** WHAT semantic thing `value` represents, independent of where the
   * evidence came from. Free-form, matching how `source` is already typed
   * — and matching TasteEvidence's own real `dimension` field (self-
   * expression | comfort | formality | fit | garment-category), the
   * closest existing precedent in this codebase, rather than inventing a
   * competing vocabulary. Example values actually used by Phase 2
   * adapters: "register" | "intention" (styleme-demand), "outfit-formula"
   * | "garment" (styleme-outcome). A future Passport adapter's dimension
   * would be a Passport field family (e.g. "favorite-color",
   * "silhouette"); a future Buy-or-Skip adapter's might be
   * "garment-category" — deliberately left open rather than closed now
   * for sources that don't exist yet. */
  dimension: string;
  /** What this finding is about, when `value` itself is a decision/outcome
   * state rather than the subject of that state — see FindingSubject.
   * Absent for findings where the category/subject already IS `value`. */
  subject?: FindingSubject;
  provenanceRefs: ProvenanceRef[];
  support: FindingSupport;
  temporal: FindingTemporal;
  /** Can this be shown to the customer as copy, as-is? */
  customerFacingSafe: boolean;
  /** Can an aggregate (e.g. future NADINE cohort intelligence) use this,
   * coarsened? Never a license to expose it at the individual level. */
  cohortEligible: boolean;
}
