// app/components/checkout/ServicePerformanceAcknowledgement.tsx
//
// Service-full-performance acknowledgement for checkout review copy —
// Founder Decision 2 (2026-11-17): "Retain the required
// service-full-performance acknowledgement in the review copy, subject
// to Legal's final jurisdiction check. Do not introduce an immediate
// digital-content waiver."
//
// No existing copy matching this description was found anywhere in this
// codebase's checkout surface during this session's own read-only review
// of my-naia.plan-usage.tsx (Revision 15/18) — so this is prepared as a
// NEW, clearly-flagged recommendation, not a verified restoration of
// something already there. If Stripe + Clerk Claude's own review copy
// already has one, treat this file as a cross-check against Decision 2's
// constraints, not a replacement.
//
// Deliberately generic and placeholder-marked rather than a specific
// legal claim: which jurisdictions this applies in, and the EXACT
// wording of what's being acknowledged, is Legal's call per
// jurisdiction — this file states only the one hard constraint Decision
// 2 already gives in plain terms (no digital-content waiver), and leaves
// the rest visibly unfilled.

export default function ServicePerformanceAcknowledgement() {
  return (
    <p className="service-performance-acknowledgement">
      [Service-full-performance acknowledgement — exact wording and applicable jurisdictions pending Legal's
      final check.] This acknowledgement does not waive your statutory digital-content withdrawal right.
    </p>
  );
}
