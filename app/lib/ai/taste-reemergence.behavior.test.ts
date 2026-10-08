// app/lib/ai/taste-reemergence.behavior.test.ts
//
// V1 completion gap #C — real-engine behavioral test for rejection →
// re-emergence. The pre-existing FB.9 test only asserted that
// taste-reconcile.server.ts's SOURCE CONTAINS the re-emergence constant
// names (a string check). This file instead runs the REAL
// writeSourceEvidence / reconcileObservations / applyTasteObservationFeedback
// functions against an in-memory fake of the two Prisma models they touch —
// same harness style as taste-evidence-deletion.test.ts's Part A — and
// proves the full scenario end to end:
//
//   generation 1 CONFIRMED
//   → customer says Not quite → generation 1 REJECTED
//   → insufficient later evidence does not resurrect it
//   → sufficient post-rejection evidence clears the elevated re-emergence
//     threshold → generation 2 forms
//   → generation 1 remains byte-for-byte immutable throughout
//
// Run with: npx vitest run app/lib/ai/taste-reemergence.behavior.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory fake for tasteEvidence + styleTendency ──────────────────────────
// Mirrors only the Prisma calls writeSourceEvidence/reconcileObservations/
// applyTasteObservationFeedback actually make (see taste-reconcile.server.ts).

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

// Same specifier taste-reconcile.server.ts itself uses to import prisma.
vi.mock("../../db.server.js", () => ({ default: fakeDb }));

const { writeSourceEvidence, applyTasteObservationFeedback } = await import("./taste-reconcile.server.js");
const { extractClosetEvidence } = await import("./taste-extraction.server.js");

beforeEach(() => {
  resetFakeDb();
});

async function tendenciesFor(customerId: string, dimension: string, value: string) {
  const all = await fakeDb.styleTendency.findMany({ where: { customerId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return all
    .filter((r: any) => r.dimension === dimension && r.value === value)
    .sort((a: any, b: any) => a.generation - b.generation);
}

const T0 = new Date("2026-10-01T00:00:00Z");

describe("RE — rejection → re-emergence runs through the real engine end to end", () => {
  it("builds CONFIRMED gen 1, rejects it, ignores weak post-rejection evidence, then re-emerges as gen 2 while gen 1 stays immutable", async () => {
    const cust = "cust-reemergence-1";

    // ── Step 1: build generation 1 to CONFIRMED (8 favourite DRESSES items,
    // single source → no cross-source bonus: wSupport = 8*0.5 = 4.0,
    // distinctRecords = 8, matches the confirmed threshold exactly). ──────────
    for (let i = 1; i <= 8; i++) {
      const rows = extractClosetEvidence({
        id: `item-${i}`,
        customerId: cust,
        category: "DRESSES",
        garmentRelationships: ["favourite"],
        updatedAt: T0,
      });
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", `item-${i}`, rows);
    }

    let gens = await tendenciesFor(cust, "garment-category", "DRESSES");
    expect(gens).toHaveLength(1);
    expect(gens[0].generation).toBe(1);
    expect(gens[0].state).toBe("CONFIRMED");
    expect(gens[0].wSupport).toBeCloseTo(4.0);

    // ── Step 2: customer rejects it. ─────────────────────────────────────────
    const gen1Id = gens[0].id;
    const result = await applyTasteObservationFeedback(cust, gen1Id, "not-quite");
    expect(result.ok).toBe(true);

    gens = await tendenciesFor(cust, "garment-category", "DRESSES");
    expect(gens).toHaveLength(1);
    expect(gens[0].state).toBe("REJECTED");
    const rejectedAt: Date = gens[0].customerFeedbackAt;
    expect(rejectedAt).toBeInstanceOf(Date);

    // ── Step 3: insufficient post-rejection evidence does not resurrect it.
    // 2 more favourite items (wSupport contribution 1.0, well under the
    // elevated 6.0 re-emergence bar). ────────────────────────────────────────
    const afterRejection = new Date(rejectedAt.getTime() + 1000);
    for (let i = 9; i <= 10; i++) {
      const rows = extractClosetEvidence({
        id: `item-${i}`,
        customerId: cust,
        category: "DRESSES",
        garmentRelationships: ["favourite"],
        updatedAt: afterRejection,
      });
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", `item-${i}`, rows);
    }

    gens = await tendenciesFor(cust, "garment-category", "DRESSES");
    expect(gens, "weak post-rejection evidence must not create a generation 2").toHaveLength(1);
    expect(gens[0].state).toBe("REJECTED");
    expect(gens[0].id).toBe(gen1Id);
    // Post-correction tracking fields update even while still rejected.
    expect(gens[0].distinctRecordsSinceCorrection).toBe(2);
    expect(gens[0].wSupportSinceCorrection).toBeCloseTo(1.0);
    // Generation 1's own claim (state/wSupport/claimText) never changes —
    // only its post-correction TRACKING metadata moves while still rejected.
    expect(gens[0].wSupport).toBeCloseTo(4.0);
    expect(gens[0].state).toBe("REJECTED");
    expect(gens[0].claimText).toBe(
      "Dresses come up consistently in the pieces you love and wear most — there seems to be a real affinity here.",
    );

    // ── Step 3b: still not enough (11 of the needed 12 post-rejection
    // records) — one call short of the re-emergence bar on every axis
    // simultaneously. Snapshot generation 1 HERE: this is the last moment
    // before the triggering call, and the bar "immutable" is checked
    // against below — once generation 2 exists, reconcileObservations must
    // never write to generation 1 again. ─────────────────────────────────────
    for (let i = 11; i <= 19; i++) {
      const rows = extractClosetEvidence({
        id: `item-${i}`,
        customerId: cust,
        category: "DRESSES",
        garmentRelationships: ["favourite"],
        updatedAt: afterRejection,
      });
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", `item-${i}`, rows);
    }

    gens = await tendenciesFor(cust, "garment-category", "DRESSES");
    expect(gens, "still not at the re-emergence bar — must still be one generation").toHaveLength(1);
    expect(gens[0].state).toBe("REJECTED");
    expect(gens[0].distinctRecordsSinceCorrection).toBe(11); // 2 + 9 — one short of 12
    expect(gens[0].wSupportSinceCorrection).toBeCloseTo(5.5); // one short of 6.0

    const gen1Snapshot = { ...gens[0] };

    // ── Step 4: the 12th post-rejection record — the single call that
    // finally clears every re-emergence threshold at once (postWSupport
    // 6.0 >= 6.0, postDistinctRecords 12 >= 5, postWNet 6.0 >= 4.0). ────────
    {
      const rows = extractClosetEvidence({
        id: "item-20",
        customerId: cust,
        category: "DRESSES",
        garmentRelationships: ["favourite"],
        updatedAt: afterRejection,
      });
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-20", rows);
    }

    gens = await tendenciesFor(cust, "garment-category", "DRESSES");
    expect(gens, "sufficient post-rejection evidence must create generation 2").toHaveLength(2);

    const gen1Final = gens.find((g: any) => g.generation === 1);
    const gen2 = gens.find((g: any) => g.generation === 2);
    expect(gen1Final).toBeDefined();
    expect(gen2).toBeDefined();

    // Generation 2 formed from only the post-rejection evidence window and
    // is itself CONFIRMED (6.0 effectiveSupport, 6.0 wNet, 12 distinctRecords).
    expect(gen2.state).toBe("CONFIRMED");
    expect(gen2.wSupport).toBeCloseTo(6.0);
    expect(gen2.distinctRecords).toBe(12);
    expect(gen2.customerFeedback).toBeNull();

    // Generation 1 remains byte-for-byte immutable — the create-generation-2
    // branch in reconcileObservations `continue`s without ever touching it.
    expect(gen1Final).toEqual(gen1Snapshot);
  });
});
