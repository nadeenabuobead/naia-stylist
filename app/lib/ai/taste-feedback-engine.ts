// app/lib/ai/taste-feedback-engine.ts
// Pure business logic for the taste observation feedback lifecycle.
//
// Injectable via FeedbackDeps — no Prisma import here.
// taste-reconcile.server.ts wires the real Prisma adapter.
// Tests wire an in-memory adapter.

export interface FeedbackDeps {
  findTendency(id: string, customerId: string): Promise<{ id: string; state: string } | null>;
  writeFeedback(id: string, data: FeedbackWrite): Promise<void>;
  runReconcile(customerId: string): Promise<void>;
}

export type FeedbackWrite = {
  state?: "REJECTED";
  customerFeedback: "accurate" | "not-quite";
  customerFeedbackAt: Date;
  updatedAt: Date;
  // Optional "not-quite" context (V1 Noticing UX) — customer feedback
  // context only. Never set for "accurate". Never read as structured
  // Taste evidence and never used to rewrite any other stored answer or
  // recommendation logic — see taste-reconcile.server.ts's
  // reconcileObservations, which this type has no bearing on.
  notQuiteReason?: string | null;
  notQuiteNote?: string | null;
};

// Fixed V1 vocabulary for the inline "What feels off?" picker. Kept here
// (not in taste-contract.ts) because it's feedback-UI vocabulary, not a
// Taste evidence dimension/value — it never flows into aggregateEvidence
// or any threshold.
export const NOT_QUITE_REASONS = [
  "doesnt-feel-like-me",
  "only-sometimes",
  "depends-on-situation",
  "used-to-be-true",
  "something-else",
] as const;
export type NotQuiteReason = (typeof NOT_QUITE_REASONS)[number];

const MAX_NOT_QUITE_NOTE_LENGTH = 500;

export interface NotQuiteDetails {
  reason?: string | null;
  note?: string | null;
}

export async function applyFeedbackWithDeps(
  deps: FeedbackDeps,
  customerId: string,
  tendencyId: string,
  feedback: "accurate" | "not-quite",
  notQuiteDetails?: NotQuiteDetails,
): Promise<{ ok: boolean; errorCode?: string }> {
  const tendency = await deps.findTendency(tendencyId, customerId);

  if (!tendency) return { ok: false, errorCode: "NOT_FOUND" };
  if (tendency.state === "REJECTED") return { ok: false, errorCode: "ALREADY_REJECTED" };

  const now = new Date();
  if (feedback === "not-quite") {
    const reason = notQuiteDetails?.reason;
    const note = notQuiteDetails?.note;
    await deps.writeFeedback(tendencyId, {
      state:              "REJECTED",
      customerFeedback:   "not-quite",
      customerFeedbackAt: now,
      updatedAt:          now,
      // Both null when the customer picked "Skip Details" — identical to
      // the pre-this-feature plain "not-quite" write.
      notQuiteReason: (reason && NOT_QUITE_REASONS.includes(reason as NotQuiteReason)) ? reason : null,
      notQuiteNote:   (note && note.trim()) ? note.trim().slice(0, MAX_NOT_QUITE_NOTE_LENGTH) : null,
    });
    await deps.runReconcile(customerId);
  } else {
    await deps.writeFeedback(tendencyId, {
      customerFeedback:   "accurate",
      customerFeedbackAt: now,
      updatedAt:          now,
    });
  }
  return { ok: true };
}
