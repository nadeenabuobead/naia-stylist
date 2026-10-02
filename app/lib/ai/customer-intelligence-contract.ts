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
  | { kind: "styleme-outcome"; id: string }
  | { kind: "styleme-demand"; id: string }
  | { kind: "closet-state"; itemIds: string[] }
  | { kind: "taste-tendency"; id: string }
  | { kind: "buy-skip"; id: string };

// ── Support ──────────────────────────────────────────────────────────────────
//
// Deliberately not one universal scalar — a demand count and a reconciled
// tendency score answer different questions and are not meant to be
// compared numerically against each other.

export type FindingSupport =
  | { kind: "direct" }
  | { kind: "count"; value: number }
  | { kind: "structural"; value?: number; label?: string }
  | { kind: "reconciled"; score: number; state?: string };

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
  /** Which concrete source produced this, e.g. "passport" | "styleme-outcome"
   * | "styleme-demand" | "closet-state" | "taste-tendency" | "buy-skip". */
  source: string;
  provenanceRefs: ProvenanceRef[];
  support: FindingSupport;
  temporal: FindingTemporal;
  /** Can this be shown to the customer as copy, as-is? */
  customerFacingSafe: boolean;
  /** Can an aggregate (e.g. future NADINE cohort intelligence) use this,
   * coarsened? Never a license to expose it at the individual level. */
  cohortEligible: boolean;
}
