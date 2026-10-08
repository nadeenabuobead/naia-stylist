// app/lib/ai/taste-staleness-deferred.test.ts
//
// V1 completion gap #8 — staleness/decay is explicitly DEFERRED to V2.
//
// No production decay logic was added. This file proves the documented V1
// rule (see taste-contract.ts's "Staleness / recency" comment) against the
// REAL engine: evidence age does not modify weight. Two otherwise-identical
// pieces of evidence, one from a year ago and one from today, contribute
// identically to wSupport/wNet/state — occurredAt is tracked for display
// and for the re-emergence cutoff only, never as a decay input.
//
// Run with: npx vitest run app/lib/ai/taste-staleness-deferred.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { fakeDb, resetFakeDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let evidenceStore: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tendencyStore: any[] = [];
  let idCounter = 0;
  const nextId = (p: string) => `${p}_${++idCounter}`;

  const fakeDb = {
    tasteEvidence: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deleteMany: async ({ where }: any) => {
        const before = evidenceStore.length;
        evidenceStore = evidenceStore.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any) =>
            !(
              r.customerId === where.customerId &&
              r.source === where.source &&
              r.sourceRecordId === where.sourceRecordId
            ),
        );
        return { count: before - evidenceStore.length };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createMany: async ({ data }: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const row of data) evidenceStore.push({ id: nextId("ev"), ...row });
        return { count: data.length };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evidenceStore.filter((r: any) => r.customerId === where.customerId).map((r: any) => ({ ...r })),
    },
    styleTendency: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tendencyStore.filter((r: any) => r.customerId === where.customerId).map((r: any) => ({ ...r })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where }: any) =>
        tendencyStore.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any) =>
            (where.id === undefined || r.id === where.id) &&
            (where.customerId === undefined || r.customerId === where.customerId) &&
            (where.observationKey === undefined || r.observationKey === where.observationKey) &&
            (where.generation === undefined || r.generation === where.generation),
        ) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data }: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = tendencyStore.find((r: any) => r.id === where.id);
        if (!row) throw new Error("fakeDb.styleTendency.update: row not found");
        Object.assign(row, data);
        return { ...row };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        const row = { id: nextId("st"), ...data };
        tendencyStore.push(row);
        return { ...row };
      },
    },
  };

  const resetFakeDb = () => {
    evidenceStore = [];
    tendencyStore = [];
    idCounter = 0;
  };

  return { fakeDb, resetFakeDb };
});

vi.mock("../../db.server.js", () => ({ default: fakeDb }));

const { writeSourceEvidence } = await import("./taste-reconcile.server.js");
const { extractClosetEvidence } = await import("./taste-extraction.server.js");

beforeEach(() => {
  resetFakeDb();
});

async function tendencyFor(customerId: string, dimension: string, value: string) {
  const all = await fakeDb.styleTendency.findMany({ where: { customerId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return all.find((r: any) => r.dimension === dimension && r.value === value) ?? null;
}

describe("V1 staleness/decay — deferred to V2, proven absent against the real engine", () => {
  it("a year-old piece of evidence contributes exactly as much as one from today", async () => {
    const custOld = "cust-old-evidence";
    const custNew = "cust-new-evidence";
    const oneYearAgo = new Date("2025-10-01T00:00:00Z");
    const today = new Date("2026-10-01T00:00:00Z");

    // Same shape of evidence (4 favourite OUTERWEAR items), differing only
    // in occurredAt — one customer's items are a year old, the other's are
    // from today.
    for (let i = 1; i <= 4; i++) {
      const rowsOld = extractClosetEvidence({
        id: `old-item-${i}`,
        customerId: custOld,
        category: "OUTERWEAR",
        garmentRelationships: ["favourite"],
        updatedAt: oneYearAgo,
      });
      await writeSourceEvidence(custOld, "CLOSET_RELATIONSHIP", `old-item-${i}`, rowsOld);

      const rowsNew = extractClosetEvidence({
        id: `new-item-${i}`,
        customerId: custNew,
        category: "OUTERWEAR",
        garmentRelationships: ["favourite"],
        updatedAt: today,
      });
      await writeSourceEvidence(custNew, "CLOSET_RELATIONSHIP", `new-item-${i}`, rowsNew);
    }

    const tendencyOld = await tendencyFor(custOld, "garment-category", "OUTERWEAR");
    const tendencyNew = await tendencyFor(custNew, "garment-category", "OUTERWEAR");

    expect(tendencyOld).toBeDefined();
    expect(tendencyNew).toBeDefined();

    // Identical weights and state — age had zero effect on the computation.
    expect(tendencyOld.wSupport).toBe(tendencyNew.wSupport);
    expect(tendencyOld.wNet).toBe(tendencyNew.wNet);
    expect(tendencyOld.effectiveSupport).toBe(tendencyNew.effectiveSupport);
    expect(tendencyOld.distinctRecords).toBe(tendencyNew.distinctRecords);
    expect(tendencyOld.state).toBe(tendencyNew.state);
    expect(tendencyOld.claimText).toBe(tendencyNew.claimText);

    // occurredAt IS tracked for display (lastEvidenceAt) — just never used
    // as a decay input into the weights above.
    expect(tendencyOld.lastEvidenceAt).toEqual(oneYearAgo);
    expect(tendencyNew.lastEvidenceAt).toEqual(today);
  });

  it("mixing a year-old row with a fresh row in the SAME tendency sums both at full, undiscounted strength", async () => {
    const cust = "cust-mixed-ages";
    const oneYearAgo = new Date("2025-10-01T00:00:00Z");
    const today = new Date("2026-10-01T00:00:00Z");

    const rowsOld = extractClosetEvidence({
      id: "item-old",
      customerId: cust,
      category: "OUTERWEAR",
      garmentRelationships: ["favourite"],
      updatedAt: oneYearAgo,
    });
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-old", rowsOld);

    const rowsNew = extractClosetEvidence({
      id: "item-new",
      customerId: cust,
      category: "OUTERWEAR",
      garmentRelationships: ["favourite"],
      updatedAt: today,
    });
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-new", rowsNew);

    const tendency = await tendencyFor(cust, "garment-category", "OUTERWEAR");
    // base 0.5 * favourite 1.0 = 0.5 per item; two items, full strength each
    // regardless of the one-year gap between them.
    expect(tendency.wSupport).toBeCloseTo(1.0);
    expect(tendency.distinctRecords).toBe(2);
  });
});
