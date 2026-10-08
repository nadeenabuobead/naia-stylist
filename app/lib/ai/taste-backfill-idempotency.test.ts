// app/lib/ai/taste-backfill-idempotency.test.ts
//
// V1 completion gap #D — true double-backfill idempotency test.
//
// The pre-existing taste-evidence-deletion.test.ts (TA.7) only proved
// idempotency of repeated EMPTY-array writes (the deletion/cleanup path).
// This file proves the backfill path itself is idempotent: running
// extraction + writeSourceEvidence for the SAME set of real historical
// source records TWICE — exactly what scripts/backfill-taste-evidence.ts
// and the api.seed-staging.jsx backfillTaste action both do when re-run —
// produces byte-identical TasteEvidence rows and StyleTendency generations
// after the second run as after the first. Does not touch staging; uses
// the same in-memory Prisma fake as taste-evidence-deletion.test.ts's
// Part A and taste-reemergence.behavior.test.ts.
//
// Run with: npx vitest run app/lib/ai/taste-backfill-idempotency.test.ts

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
const {
  extractClosetEvidence,
  extractStyleMeEvidence,
  extractBuySkipEvidence,
  extractPostWearEvidence,
} = await import("./taste-extraction.server.js");

beforeEach(() => {
  resetFakeDb();
});

async function allEvidence(customerId: string) {
  return fakeDb.tasteEvidence.findMany({ where: { customerId } });
}
async function allTendencies(customerId: string) {
  return fakeDb.styleTendency.findMany({ where: { customerId } });
}

// Mirrors the 4 real historical sources a backfill pass walks, matching
// scripts/backfill-taste-evidence.ts and api.seed-staging.jsx's
// backfillTaste action — one record per source, run through the exact same
// extract*Evidence + writeSourceEvidence calls a real backfill makes.
async function runBackfillPass(customerId: string) {
  const T0 = new Date("2026-09-01T00:00:00Z");

  const closetRows = extractClosetEvidence({
    id: "closet-item-1",
    customerId,
    category: "OUTERWEAR",
    garmentRelationships: ["favourite"],
    updatedAt: T0,
  });
  await writeSourceEvidence(customerId, "CLOSET_RELATIONSHIP", "closet-item-1", closetRows);

  const styleMeRows = extractStyleMeEvidence({
    id: "styleme-outcome-1",
    customerId,
    outcomeStatus: "wore-it",
    changeTypes: [],
    goalOutcome: "yes",
    whatWorked: ["felt-like-me", "comfortable"],
    whatFeltOff: [],
    didntWearReasons: [],
    submittedAt: T0,
  });
  await writeSourceEvidence(customerId, "STYLEME_OUTCOME", "styleme-outcome-1", styleMeRows);

  const postWearRows = extractPostWearEvidence({
    id: "post-wear-1",
    customerId,
    feltLikeHer: "yes",
    physicallyComfortable: "comfortable",
    wouldWearAgain: "definitely",
    fitFeedback: "yes",
    didWearIt: "yes",
    createdAt: T0,
  });
  await writeSourceEvidence(customerId, "POST_OUTFIT_REVIEW", "post-wear-1", postWearRows);

  const buySkipRows = extractBuySkipEvidence({
    id: "buyskip-outcome-1",
    customerId,
    postPurchaseOutcome: "LOVE_IT",
    category: "OUTERWEAR",
    createdAt: T0,
  });
  await writeSourceEvidence(customerId, "BUYSKIP_OUTCOME", "buyskip-outcome-1", buySkipRows);
}

describe("BF — a full backfill pass is idempotent when run twice", () => {
  it("no duplicate TasteEvidence rows after a second identical pass", async () => {
    const cust = "cust-backfill-1";
    await runBackfillPass(cust);
    const afterFirst = await allEvidence(cust);
    expect(afterFirst.length).toBeGreaterThan(0);

    await runBackfillPass(cust);
    const afterSecond = await allEvidence(cust);

    expect(afterSecond).toHaveLength(afterFirst.length);
    // Same (source, sourceRecordId, dimension, value, polarity) identity
    // set — the unique-key dimension of TasteEvidence — not just same count.
    const identity = (r: any) => `${r.source}|${r.sourceRecordId}|${r.dimension}|${r.value}|${r.polarity}`;
    expect(new Set(afterSecond.map(identity))).toEqual(new Set(afterFirst.map(identity)));
  });

  it("no duplicate StyleTendency generations after a second identical pass", async () => {
    const cust = "cust-backfill-2";
    await runBackfillPass(cust);
    const afterFirst = await allTendencies(cust);
    expect(afterFirst.length).toBeGreaterThan(0);

    await runBackfillPass(cust);
    const afterSecond = await allTendencies(cust);

    expect(afterSecond).toHaveLength(afterFirst.length);
    const generationKeys = (rows: any[]) =>
      new Set(rows.map((r) => `${r.observationKey}|${r.generation}`));
    expect(generationKeys(afterSecond)).toEqual(generationKeys(afterFirst));
  });

  it("weights do not double merely because the same source was backfilled twice", async () => {
    const cust = "cust-backfill-3";
    await runBackfillPass(cust);
    const firstPass = await allTendencies(cust);
    const closetTendencyFirst = firstPass.find(
      (t: any) => t.dimension === "garment-category" && t.value === "OUTERWEAR",
    );
    expect(closetTendencyFirst).toBeDefined();
    const wSupportFirst = closetTendencyFirst.wSupport;

    await runBackfillPass(cust);
    const secondPass = await allTendencies(cust);
    const closetTendencySecond = secondPass.find(
      (t: any) => t.dimension === "garment-category" && t.value === "OUTERWEAR",
    );
    expect(closetTendencySecond).toBeDefined();

    // Delete-and-reinsert per (customerId, source, sourceRecordId) means the
    // second pass replaces, not adds to, each source record's evidence —
    // weight must be identical, never doubled.
    expect(closetTendencySecond.wSupport).toBeCloseTo(wSupportFirst);
  });

  it("resulting state is equivalent after the first and second runs, field for field", async () => {
    const cust = "cust-backfill-4";
    await runBackfillPass(cust);
    const evidenceFirst = (await allEvidence(cust)).map(({ id, ...rest }: any) => rest);
    const tendenciesFirst = (await allTendencies(cust)).map(({ id, updatedAt, ...rest }: any) => rest);

    await runBackfillPass(cust);
    const evidenceSecond = (await allEvidence(cust)).map(({ id, ...rest }: any) => rest);
    const tendenciesSecond = (await allTendencies(cust)).map(({ id, updatedAt, ...rest }: any) => rest);

    const sortByIdentity = (rows: any[]) =>
      [...rows].sort((a, b) =>
        `${a.source}|${a.sourceRecordId}|${a.dimension}|${a.value}`.localeCompare(
          `${b.source}|${b.sourceRecordId}|${b.dimension}|${b.value}`,
        ),
      );
    const sortByKey = (rows: any[]) =>
      [...rows].sort((a, b) => `${a.observationKey}|${a.generation}`.localeCompare(`${b.observationKey}|${b.generation}`));

    expect(sortByIdentity(evidenceSecond)).toEqual(sortByIdentity(evidenceFirst));
    expect(sortByKey(tendenciesSecond)).toEqual(sortByKey(tendenciesFirst));
  });
});
