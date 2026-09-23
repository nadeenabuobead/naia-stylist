// app/lib/trend-feedback.server.test.ts
//
// Reversibility, non-duplication and isolation. Prisma is faked with a store
// that enforces the same unique constraint the migration declares, so the
// "ten clicks is one signal" guarantee is tested against the real rule.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string; customerId: string; reportId: string;
  contentType: string; contentId: string; action: string;
  contentLabel: string | null; createdAt: Date; updatedAt: Date;
}

const { db, fakePrisma, resetSeq } = vi.hoisted(() => {
  const store = { rows: [] as Row[], evidence: [] as Array<{ recordId: string; rows: unknown[] }> };
  let counter = 0;
  const key = (r: { customerId: string; reportId: string; contentType: string; contentId: string; action: string }) =>
    `${r.customerId}|${r.reportId}|${r.contentType}|${r.contentId}|${r.action}`;

  const client = {
    trendContentFeedback: {
      findUnique: vi.fn(async ({ where }: never) => {
        const w = (where as Record<string, never>).customerId_reportId_contentType_contentId_action as unknown as Row;
        return store.rows.find((r) => key(r) === key(w)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { customerId: string; reportId: string };
        return store.rows.filter((r) => r.customerId === w.customerId && r.reportId === w.reportId);
      }),
      create: vi.fn(async ({ data }: never) => {
        const d = data as unknown as Omit<Row, "id" | "createdAt" | "updatedAt">;
        if (store.rows.some((r) => key(r) === key(d))) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row: Row = { ...d, id: `fb_${++counter}`, createdAt: new Date(), updatedAt: new Date() };
        store.rows.push(row);
        return row;
      }),
      delete: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { id: string };
        store.rows = store.rows.filter((r) => r.id !== w.id);
        return { id: w.id };
      }),
    },
  };
  return { db: store, fakePrisma: { default: client }, resetSeq: () => { counter = 0; } };
});

vi.mock("../db.server", () => fakePrisma);
vi.mock("./ai/taste-reconcile.server", () => ({
  writeSourceEvidence: vi.fn(async (_c: string, _s: string, recordId: string, rows: unknown[]) => {
    // Mirrors the real delete-and-reinsert: one entry per source record.
    db.evidence = db.evidence.filter((e) => e.recordId !== recordId);
    if (rows.length > 0) db.evidence.push({ recordId, rows });
  }),
}));

import { setTrendFeedback, loadTrendFeedback } from "./trend-feedback.server";

const TARGET = {
  reportId: "rep_1", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa",
  contentLabel: "Softened tailoring", facets: { category: ["OUTERWEAR"] },
};

beforeEach(() => {
  db.rows = []; db.evidence = []; resetSeq(); vi.clearAllMocks();
});

// ── §FB-1 Not for me ──────────────────────────────────────────────────────────

describe("§FB-1 not for me", () => {
  it("the first dismissal persists and emits negative evidence", async () => {
    const r = await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    expect(r.active).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.evidence).toHaveLength(1);
  });

  it("state survives a reload — it is read from rows, not remembered", async () => {
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    const state = await loadTrendFeedback("cust-1", "rep_1");
    expect(state.notForMe).toEqual(["tc_aaaaaaaaaaaa"]);
  });

  it("reversing removes the row AND withdraws the evidence", async () => {
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    const r = await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", false);
    expect(r.active).toBe(false);
    expect(db.rows).toHaveLength(0);
    expect(db.evidence).toHaveLength(0);
  });

  it("TEN clicks are ONE signal", async () => {
    for (let i = 0; i < 10; i++) await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    expect(db.rows).toHaveLength(1);
    expect(db.evidence).toHaveLength(1);
  });

  it("re-asserting the same state does not rewrite evidence", async () => {
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    const calls = vi.mocked((await import("./ai/taste-reconcile.server")).writeSourceEvidence).mock.calls.length;
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    const after = vi.mocked((await import("./ai/taste-reconcile.server")).writeSourceEvidence).mock.calls.length;
    expect(after).toBe(calls);
  });

  it("reversing something never dismissed is a harmless no-op", async () => {
    const r = await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", false);
    expect(r.active).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("a concurrent double-submit lands on one row", async () => {
    fakePrisma.default.trendContentFeedback.findUnique.mockResolvedValueOnce(null);
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    fakePrisma.default.trendContentFeedback.findUnique.mockResolvedValueOnce(null);
    const r = await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    expect(r.active).toBe(true);
    expect(db.rows).toHaveLength(1);
  });
});

// ── §FB-2 Style this ──────────────────────────────────────────────────────────

describe("§FB-2 style this", () => {
  it("records a deliberate positive signal", async () => {
    await setTrendFeedback("cust-1", TARGET, "STYLED", true);
    expect(db.rows[0].action).toBe("STYLED");
    expect(db.evidence).toHaveLength(1);
  });

  it("styling the same trend ten times does not multiply it", async () => {
    for (let i = 0; i < 10; i++) await setTrendFeedback("cust-1", TARGET, "STYLED", true);
    expect(db.rows).toHaveLength(1);
    expect(db.evidence).toHaveLength(1);
  });

  it("save, style and dismiss coexist as separate rows", async () => {
    await setTrendFeedback("cust-1", TARGET, "STYLED", true);
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    expect(db.rows).toHaveLength(2);
    // The conflict is represented honestly rather than resolved by guessing.
    const state = await loadTrendFeedback("cust-1", "rep_1");
    expect(state.styled).toContain("tc_aaaaaaaaaaaa");
    expect(state.notForMe).toContain("tc_aaaaaaaaaaaa");
  });

  it("dismissing does not delete a styled record", async () => {
    await setTrendFeedback("cust-1", TARGET, "STYLED", true);
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    expect(db.rows.filter((r) => r.action === "STYLED")).toHaveLength(1);
  });
});

// ── §FB-3 isolation ───────────────────────────────────────────────────────────

describe("§FB-3 customer isolation", () => {
  it("customer A cannot alter customer B's feedback", async () => {
    await setTrendFeedback("cust-b", TARGET, "NOT_FOR_ME", true);
    // A reversal from the wrong customer finds nothing and removes nothing.
    const r = await setTrendFeedback("cust-a", TARGET, "NOT_FOR_ME", false);
    expect(r.active).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].customerId).toBe("cust-b");
  });

  it("each customer has their own signal for the same content", async () => {
    await setTrendFeedback("cust-a", TARGET, "NOT_FOR_ME", true);
    await setTrendFeedback("cust-b", TARGET, "NOT_FOR_ME", true);
    expect(db.rows).toHaveLength(2);
  });

  it("loading feedback shows only this customer's", async () => {
    await setTrendFeedback("cust-b", TARGET, "NOT_FOR_ME", true);
    expect((await loadTrendFeedback("cust-a", "rep_1")).notForMe).toEqual([]);
  });
});

// ── §FB-4 identity ────────────────────────────────────────────────────────────

describe("§FB-4 stable identity", () => {
  it("feedback is keyed on the stable content id, never the label", async () => {
    await setTrendFeedback("cust-1", TARGET, "NOT_FOR_ME", true);
    expect(db.rows[0].contentId).toBe("tc_aaaaaaaaaaaa");
    // A renamed trend is the same signal.
    await setTrendFeedback("cust-1", { ...TARGET, contentLabel: "Renamed entirely" }, "NOT_FOR_ME", true);
    expect(db.rows).toHaveLength(1);
  });

  it("content with no mappable facet still records the dismissal", async () => {
    // The raw feedback is kept even when V1 taste cannot express it — a future
    // Taste V2 needs the record to exist.
    await setTrendFeedback("cust-1", { ...TARGET, facets: { colourFamily: ["red-burgundy"] } }, "NOT_FOR_ME", true);
    expect(db.rows).toHaveLength(1);
    expect(db.evidence).toHaveLength(0);
  });
});
