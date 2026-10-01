// app/lib/ai/taste-evidence-deletion.test.ts
// Bug fix — orphaned TasteEvidence after source-record deletion.
//
// Scope: TasteEvidence.sourceRecordId has no DB-level FK, so deleting a
// ClosetItem / StyleMeOutcome / PostOutfitReview never cleaned up the
// evidence it had produced. Fix: every deletion path that removes a
// TasteEvidence source now calls the existing writeSourceEvidence(..., [])
// contract to clear that source's rows and let reconcileObservations
// recompute naturally. No new reconciliation mechanism was added.
//
// Part A (TA.*) — behavioral: runs the REAL writeSourceEvidence /
//   reconcileObservations against an in-memory fake of the two Prisma
//   models they touch (tasteEvidence, styleTendency), proving the
//   contract itself behaves correctly end to end.
// Part B (TB.*) — source-invariant: confirms each of the four edited
//   call sites actually wires the contract in correctly (delete happens
//   before cleanup, cleanup is non-blocking, correct ids are used) —
//   same style as taste-feedback.test.ts, for routes/helpers that are
//   impractical to exercise live without a real DB.
//
// Run with: npx vitest run app/lib/ai/taste-evidence-deletion.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");

// ── Part A setup: in-memory fake for tasteEvidence + styleTendency ────────────
// Mirrors only the Prisma calls writeSourceEvidence/reconcileObservations
// actually make (see taste-reconcile.server.ts) — not a general Prisma mock.

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

// Same specifier taste-reconcile.server.ts itself uses to import prisma —
// vitest resolves both to the same module id, so this mock applies.
vi.mock("../../db.server.js", () => ({ default: fakeDb }));

const { writeSourceEvidence, reconcileObservations } = await import("./taste-reconcile.server.js");
const {
  extractClosetEvidence,
  extractBuySkipEvidence,
  extractStyleMeEvidence,
  extractPostWearEvidence,
} = await import("./taste-extraction.server.js");

beforeEach(() => {
  resetFakeDb();
});

// Small helpers over the fake store, scoped through the real exported API only.
async function evidenceFor(customerId: string, source?: string, sourceRecordId?: string) {
  const all = await fakeDb.tasteEvidence.findMany({ where: { customerId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return all.filter((r: any) =>
    (source === undefined || r.source === source) &&
    (sourceRecordId === undefined || r.sourceRecordId === sourceRecordId),
  );
}

async function tendencyFor(customerId: string, dimension: string, value: string) {
  const all = await fakeDb.styleTendency.findMany({ where: { customerId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return all.find((r: any) => r.dimension === dimension && r.value === value) ?? null;
}

const NOW = new Date("2026-10-01T12:00:00Z");

// ── TA.1 — Closet item deletion removes only its CLOSET_RELATIONSHIP evidence ─

describe("TA.1 — closet item deletion removes only its own evidence", () => {
  it("TA.1.1 deleting one of two favourite-DRESSES items leaves the other's evidence intact", async () => {
    const cust = "cust-1";
    const rowsA = extractClosetEvidence({ id: "item-A", customerId: cust, category: "DRESSES", garmentRelationships: ["favourite"], updatedAt: NOW });
    const rowsB = extractClosetEvidence({ id: "item-B", customerId: cust, category: "DRESSES", garmentRelationships: ["favourite"], updatedAt: NOW });
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", rowsA);
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-B", rowsB);

    expect(await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-A")).toHaveLength(1);
    expect(await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-B")).toHaveLength(1);

    // Simulate the fix: deletion cleanup for item-A only.
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", []);

    expect(await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-A")).toHaveLength(0);
    expect(await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-B")).toHaveLength(1);
  });
});

// ── TA.2 — Reconciliation runs afterward ───────────────────────────────────────

describe("TA.2 — reconciliation runs after cleanup", () => {
  it("TA.2.1 tendency wSupport recomputes down after one of four sources is removed", async () => {
    const cust = "cust-2";
    for (const id of ["item-A", "item-B", "item-C", "item-D"]) {
      const rows = extractClosetEvidence({ id, customerId: cust, category: "DRESSES", garmentRelationships: ["favourite"], updatedAt: NOW });
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", id, rows);
    }

    const before = await tendencyFor(cust, "garment-category", "DRESSES");
    expect(before).not.toBeNull();
    expect(before.state).toBe("CANDIDATE"); // 4 * 0.5 = 2.0 wSupport, meets CANDIDATE exactly
    expect(before.wSupport).toBeCloseTo(2.0);

    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", []);

    const after = await tendencyFor(cust, "garment-category", "DRESSES");
    expect(after.wSupport).toBeCloseTo(1.5); // 3 remaining * 0.5
    expect(after.state).toBe("SUPPRESSED"); // below CANDIDATE_EFFECTIVE_SUPPORT (2.0)
  });
});

// ── TA.3 — Tendency supported only by deleted evidence demotes/suppresses ─────

describe("TA.3 — tendency with zero remaining evidence demotes to SUPPRESSED", () => {
  it("TA.3.1 CONFIRMED tendency is demoted once its only evidence source is fully cleared", async () => {
    const cust = "cust-3";
    const ids = ["item-A", "item-B", "item-C", "item-D", "item-E", "item-F", "item-G", "item-H"];
    for (const id of ids) {
      const rows = extractClosetEvidence({ id, customerId: cust, category: "DRESSES", garmentRelationships: ["favourite"], updatedAt: NOW });
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", id, rows);
    }

    const confirmed = await tendencyFor(cust, "garment-category", "DRESSES");
    expect(confirmed.state).toBe("CONFIRMED"); // 8 * 0.5 = 4.0 wSupport meets CONFIRMED exactly

    // Delete every item one by one (as repeated closet-item deletions would).
    for (const id of ids) {
      await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", id, []);
    }

    expect(await evidenceFor(cust)).toHaveLength(0);

    const demoted = await tendencyFor(cust, "garment-category", "DRESSES");
    expect(demoted.state).toBe("SUPPRESSED");
    // The row is preserved (history), not deleted — demotion, not fabrication.
    expect(demoted.id).toBe(confirmed.id);
  });
});

// ── TA.4 — Other-source evidence for the same tendency is untouched ───────────

describe("TA.4 — unrelated source evidence for the same tendency survives", () => {
  it("TA.4.1 deleting the CLOSET_RELATIONSHIP source leaves BUYSKIP_OUTCOME evidence for the same dimension/value", async () => {
    const cust = "cust-4";
    const closetRows = extractClosetEvidence({ id: "item-A", customerId: cust, category: "DRESSES", garmentRelationships: ["favourite"], updatedAt: NOW });
    const buySkipRows = extractBuySkipEvidence({ id: "analysis-A", customerId: cust, postPurchaseOutcome: "LOVE_IT", category: "DRESSES", createdAt: NOW });
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", closetRows);
    await writeSourceEvidence(cust, "BUYSKIP_OUTCOME", "analysis-A", buySkipRows);

    const withBoth = await tendencyFor(cust, "garment-category", "DRESSES");
    expect(withBoth.distinctSources).toBe(2); // cross-source bonus applied

    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", []);

    expect(await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-A")).toHaveLength(0);
    const buySkipEvidence = await evidenceFor(cust, "BUYSKIP_OUTCOME", "analysis-A");
    expect(buySkipEvidence).toHaveLength(1); // untouched

    const afterOnly = await tendencyFor(cust, "garment-category", "DRESSES");
    expect(afterOnly.distinctSources).toBe(1); // bonus no longer applies, but evidence itself remains
    expect(afterOnly.wSupport).toBeCloseTo(0.6); // the surviving BUYSKIP_OUTCOME row's strength
  });
});

// ── TA.5 — StyleMe session deletion removes derived STYLEME_OUTCOME + POST_OUTFIT_REVIEW evidence ─

describe("TA.5 — session-deletion cleanup clears both derived evidence sources", () => {
  it("TA.5.1 both STYLEME_OUTCOME and POST_OUTFIT_REVIEW evidence disappear after their cleanup calls", async () => {
    const cust = "cust-5";
    const outcomeRows = extractStyleMeEvidence({
      id: "outcome-A", customerId: cust, outcomeStatus: "wore-it", changeTypes: [],
      goalOutcome: "yes", whatWorked: ["felt-like-me"], whatFeltOff: [], didntWearReasons: [], submittedAt: NOW,
    });
    const reviewRows = extractPostWearEvidence({
      id: "review-A", customerId: cust, physicallyComfortable: "comfortable", createdAt: NOW,
    });
    await writeSourceEvidence(cust, "STYLEME_OUTCOME", "outcome-A", outcomeRows);
    await writeSourceEvidence(cust, "POST_OUTFIT_REVIEW", "review-A", reviewRows);

    expect(await evidenceFor(cust, "STYLEME_OUTCOME", "outcome-A")).toHaveLength(1);
    expect(await evidenceFor(cust, "POST_OUTFIT_REVIEW", "review-A")).toHaveLength(1);

    // Simulate the session-delete cleanup loop added to style-me/_index.tsx.
    await writeSourceEvidence(cust, "STYLEME_OUTCOME", "outcome-A", []);
    await writeSourceEvidence(cust, "POST_OUTFIT_REVIEW", "review-A", []);

    expect(await evidenceFor(cust, "STYLEME_OUTCOME", "outcome-A")).toHaveLength(0);
    expect(await evidenceFor(cust, "POST_OUTFIT_REVIEW", "review-A")).toHaveLength(0);

    const selfExpr = await tendencyFor(cust, "self-expression", "self-expression");
    expect(selfExpr.state).toBe("SUPPRESSED"); // zero remaining evidence → demoted
  });
});

// ── TA.6 — Deletion never fabricates negative evidence ────────────────────────

describe("TA.6 — clearing a source inserts nothing, positive or negative", () => {
  it("TA.6.1 writeSourceEvidence(..., []) creates zero rows and the tendency math reflects pure absence, not a negative signal", async () => {
    const cust = "cust-6";
    const rows = extractClosetEvidence({ id: "item-A", customerId: cust, category: "OUTERWEAR", garmentRelationships: ["favourite"], updatedAt: NOW });
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", rows);

    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", []);

    const remaining = await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-A");
    expect(remaining).toHaveLength(0); // not replaced by a negative row

    const tendency = await tendencyFor(cust, "garment-category", "OUTERWEAR");
    // The demotion path (reconcileObservations' "no evidence group" branch) only
    // flips state — it never re-zeroes wSupport/wContradict on the row, and
    // never touched by this fix (pre-existing engine behavior, left untouched
    // per scope). The customer-facing point holds regardless: wContradict was
    // never incremented by the cleanup, so no negative signal was fabricated.
    expect(tendency.wContradict).toBe(0); // no negative weight was ever introduced
    expect(tendency.state).toBe("SUPPRESSED"); // demoted on absence, not contradiction
  });
});

// ── TA.7 — Repeated cleanup is idempotent ──────────────────────────────────────

describe("TA.7 — repeated cleanup calls are idempotent", () => {
  it("TA.7.1 calling writeSourceEvidence(..., []) a second and third time changes nothing further", async () => {
    const cust = "cust-7";
    const rows = extractClosetEvidence({ id: "item-A", customerId: cust, category: "TOPS", garmentRelationships: ["favourite"], updatedAt: NOW });
    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", rows);

    await writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", []);
    const afterFirst = await tendencyFor(cust, "garment-category", "TOPS");

    await expect(writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", [])).resolves.not.toThrow();
    await expect(writeSourceEvidence(cust, "CLOSET_RELATIONSHIP", "item-A", [])).resolves.not.toThrow();

    const afterRepeat = await tendencyFor(cust, "garment-category", "TOPS");
    expect(afterRepeat.state).toBe(afterFirst.state);
    expect(afterRepeat.wSupport).toBe(afterFirst.wSupport);
    expect(afterRepeat.id).toBe(afterFirst.id); // same row, demoted — never duplicated
    expect(await evidenceFor(cust, "CLOSET_RELATIONSHIP", "item-A")).toHaveLength(0);
  });
});

// ── TA.8 — No other customer's evidence is affected ────────────────────────────

describe("TA.8 — cleanup is scoped strictly to the owning customer", () => {
  it("TA.8.1 two customers with evidence under the SAME sourceRecordId — cleaning one leaves the other untouched", async () => {
    const custA = "cust-8a";
    const custB = "cust-8b";
    const sharedId = "item-shared-id"; // adversarial: identical sourceRecordId across customers
    const rowsA = extractClosetEvidence({ id: sharedId, customerId: custA, category: "SHOES", garmentRelationships: ["favourite"], updatedAt: NOW });
    const rowsB = extractClosetEvidence({ id: sharedId, customerId: custB, category: "SHOES", garmentRelationships: ["favourite"], updatedAt: NOW });
    await writeSourceEvidence(custA, "CLOSET_RELATIONSHIP", sharedId, rowsA);
    await writeSourceEvidence(custB, "CLOSET_RELATIONSHIP", sharedId, rowsB);

    await writeSourceEvidence(custA, "CLOSET_RELATIONSHIP", sharedId, []);

    expect(await evidenceFor(custA, "CLOSET_RELATIONSHIP", sharedId)).toHaveLength(0);
    expect(await evidenceFor(custB, "CLOSET_RELATIONSHIP", sharedId)).toHaveLength(1); // untouched

    const tendencyA = await tendencyFor(custA, "garment-category", "SHOES");
    const tendencyB = await tendencyFor(custB, "garment-category", "SHOES");
    // A's tendency lost its only evidence and was demoted to SUPPRESSED (the
    // demotion path doesn't re-zero wSupport on the row — see TA.6 note — but
    // the state flip is what matters: it stops surfacing). B's is completely
    // untouched: still its original single-item, below-CANDIDATE wSupport.
    expect(tendencyA.state).toBe("SUPPRESSED");
    expect(tendencyB.wSupport).toBeCloseTo(0.5);
    expect(tendencyB.state).not.toBe("REJECTED"); // B was never touched by A's cleanup
  });
});

// ── Part B — source-invariant checks on the four edited call sites ────────────

const closetDeletionSrc = readFileSync(join(__dirname, "../closet-item-deletion.server.ts"), "utf8");
const closetReviewSrc   = readFileSync(join(__dirname, "../admin/closet-review.server.ts"), "utf8");
const styleMeIndexSrc   = readFileSync(join(ROOT, "app/routes/style-me/_index.tsx"), "utf8");
const feedbackPersistSrc = readFileSync(join(__dirname, "feedback-persistence.server.ts"), "utf8");

describe("TB.1 — closet-item-deletion.server.ts wires the fix correctly", () => {
  it("TB.1.1 writeSourceEvidence is called with an empty array after the Prisma delete", () => {
    const deleteIdx = closetDeletionSrc.indexOf("prisma.closetItem.delete(");
    const cleanupIdx = closetDeletionSrc.indexOf('writeSourceEvidence(customerId, "CLOSET_RELATIONSHIP", item.id, [])');
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(cleanupIdx).toBeGreaterThan(deleteIdx);
  });

  it("TB.1.2 cleanup is wrapped in try/catch so it can never block the delete result", () => {
    const cleanupIdx = closetDeletionSrc.indexOf("writeSourceEvidence(customerId");
    const tryIdx = closetDeletionSrc.lastIndexOf("try {", cleanupIdx);
    expect(tryIdx).toBeGreaterThan(-1);
  });
});

describe("TB.2 — admin closet-review.server.ts wires the fix correctly (bulk + single delete)", () => {
  it("TB.2.1 deleteClosetItem fetches customerId before delete and cleans up after", () => {
    const fnStart = closetReviewSrc.indexOf("export async function deleteClosetItem(");
    const fnEnd = closetReviewSrc.indexOf("\n}", fnStart);
    const body = closetReviewSrc.slice(fnStart, fnEnd);
    const findIdx = body.indexOf("closetItem.findUnique(");
    const deleteIdx = body.indexOf("closetItem.delete(");
    const cleanupIdx = body.indexOf("writeSourceEvidence(");
    expect(findIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(findIdx);
    expect(cleanupIdx).toBeGreaterThan(deleteIdx);
  });

  it("TB.2.2 deleteClosetItems fetches all customerIds before the bulk delete and cleans up each", () => {
    const fnStart = closetReviewSrc.indexOf("export async function deleteClosetItems(");
    const fnEnd = closetReviewSrc.indexOf("\n}", fnStart);
    const body = closetReviewSrc.slice(fnStart, fnEnd);
    const findIdx = body.indexOf("closetItem.findMany(");
    const deleteIdx = body.indexOf("closetItem.deleteMany(");
    const cleanupIdx = body.indexOf("writeSourceEvidence(");
    expect(findIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(findIdx);
    expect(cleanupIdx).toBeGreaterThan(deleteIdx);
  });

  it("TB.2.3 both deletion functions guard cleanup in try/catch", () => {
    const count = (closetReviewSrc.match(/try \{\s*\n\s*await writeSourceEvidence/g) ?? []).length;
    expect(count).toBe(2);
  });
});

describe("TB.3 — style-me session deletion captures ids before cascade and cleans up after", () => {
  it("TB.3.1 suggestion outcome ids and the review id are selected before stylingSession.delete", () => {
    const outcomeSelectIdx = styleMeIndexSrc.indexOf("outcome: { select: { id: true } }");
    const reviewSelectIdx = styleMeIndexSrc.indexOf("review: { select: { id: true } }");
    const deleteIdx = styleMeIndexSrc.indexOf("prisma.stylingSession.delete(");
    expect(outcomeSelectIdx).toBeGreaterThan(-1);
    expect(reviewSelectIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(outcomeSelectIdx);
    expect(deleteIdx).toBeGreaterThan(reviewSelectIdx);
  });

  it("TB.3.2 cleanup loop runs after the cascade delete, for both STYLEME_OUTCOME and POST_OUTFIT_REVIEW", () => {
    const deleteIdx = styleMeIndexSrc.indexOf("prisma.stylingSession.delete(");
    const outcomeCleanupIdx = styleMeIndexSrc.indexOf('writeSourceEvidence(customer.id, "STYLEME_OUTCOME"', deleteIdx);
    const reviewCleanupIdx = styleMeIndexSrc.indexOf('writeSourceEvidence(customer.id, "POST_OUTFIT_REVIEW"', deleteIdx);
    expect(outcomeCleanupIdx).toBeGreaterThan(deleteIdx);
    expect(reviewCleanupIdx).toBeGreaterThan(deleteIdx);
  });

  it("TB.3.3 cleanup is wrapped in try/catch so it never blocks the delete response", () => {
    const deleteIdx = styleMeIndexSrc.indexOf("prisma.stylingSession.delete(");
    const tryIdx = styleMeIndexSrc.indexOf("try {", deleteIdx);
    const catchIdx = styleMeIndexSrc.indexOf("taste-evidence: failed to clean up evidence after session delete");
    expect(tryIdx).toBeGreaterThan(deleteIdx);
    expect(catchIdx).toBeGreaterThan(tryIdx);
  });
});

describe("TB.4 — post-wear review delete clears POST_OUTFIT_REVIEW evidence (content-nulling path)", () => {
  it("TB.4.1 _deletePostWearReview clears evidence after nulling the 4B1 fields, not before", () => {
    const fnStart = feedbackPersistSrc.indexOf("async function _deletePostWearReview(");
    const fnEnd = feedbackPersistSrc.indexOf("\n}", fnStart);
    const body = feedbackPersistSrc.slice(fnStart, fnEnd);
    const nullingUpdateIdx = body.indexOf("postOutfitReview.update(");
    const cleanupIdx = body.indexOf('writeSourceEvidence(customerId, "POST_OUTFIT_REVIEW", existing.id, [])');
    expect(nullingUpdateIdx).toBeGreaterThan(-1);
    expect(cleanupIdx).toBeGreaterThan(nullingUpdateIdx);
  });

  it("TB.4.2 the PostOutfitReview row itself is never deleted — only updated — matching the existing 'preserve legacy fields' contract", () => {
    const fnStart = feedbackPersistSrc.indexOf("async function _deletePostWearReview(");
    const fnEnd = feedbackPersistSrc.indexOf("\n}", fnStart);
    const body = feedbackPersistSrc.slice(fnStart, fnEnd);
    expect(body.includes("postOutfitReview.delete(")).toBe(false);
  });
});
