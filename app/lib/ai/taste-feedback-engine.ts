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
};

export async function applyFeedbackWithDeps(
  deps: FeedbackDeps,
  customerId: string,
  tendencyId: string,
  feedback: "accurate" | "not-quite",
): Promise<{ ok: boolean; errorCode?: string }> {
  const tendency = await deps.findTendency(tendencyId, customerId);

  if (!tendency) return { ok: false, errorCode: "NOT_FOUND" };
  if (tendency.state === "REJECTED") return { ok: false, errorCode: "ALREADY_REJECTED" };

  const now = new Date();
  if (feedback === "not-quite") {
    await deps.writeFeedback(tendencyId, {
      state:              "REJECTED",
      customerFeedback:   "not-quite",
      customerFeedbackAt: now,
      updatedAt:          now,
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
