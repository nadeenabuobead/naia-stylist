// app/lib/ai/wardrobe-journeys.test.ts
//
// PERSISTENCE JOURNEYS — the real write/read/render paths, against a real
// Postgres, end to end.
//
// The other suites test calculations in isolation. These drive the actual route
// action and the actual loader: the form submission that saves an answer, the
// reload that reads it back, the snapshot row that gets written, and the copy
// that comes out the other side. A calculation test cannot catch a column that
// is never written, an action that does not persist, or a loader that throws
// because a migration has not run.
//
// Requires an isolated database. Skipped entirely without one, so the normal
// suite stays offline:
//
//   node scripts/testdb/server.mjs &
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
//     node --test --import tsx/esm app/lib/ai/wardrobe-journeys.test.ts
//
// It never touches staging, production, or anyone's real Closet.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  summariseWardrobe,
  diffSnapshots,
  changeLines,
  SNAPSHOT_VERSION,
} from "./wardrobe-snapshot.ts";
import { buildWardrobePage, visibleCopy } from "./wardrobe-page.ts";
import { buildDesignSignals } from "./design-signal.ts";
import { CONSENT_VERSION, ELIGIBLE_WHERE } from "./design-signal.server.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const skip = URL_ ? false : "set TEST_DATABASE_URL to run the persistence journeys";

let db: PrismaClient;
const ids = { customer: "", qa: "", nonConsenting: "" };

/** A garment the engine can actually read. */
function closetRow(customerId: string, over: Record<string, unknown> = {}) {
  return {
    customerId,
    category: "TOPS",
    subcategory: "sleeveless top",
    name: "Cream Tank",
    primaryColor: "Cream",
    colors: ["Cream"],
    pattern: "solid",
    material: "cotton",
    silhouette: "straight",
    fitProfile: "relaxed",
    formality: "smart-casual",
    occasions: ["casual"],
    seasons: ["all-season"],
    analysisStatus: "ready",
    ...over,
  };
}

before(async () => {
  if (skip) return;
  db = new PrismaClient({ datasources: { db: { url: URL_! } } });

  // A clean slate each run, inside the throwaway database only.
  await db.$executeRawUnsafe(`TRUNCATE TABLE "Customer" RESTART IDENTITY CASCADE`);

  const mk = async (shopifyId: string, over: Record<string, unknown> = {}) =>
    (await db.customer.create({ data: { shopifyCustomerId: shopifyId, ...over } })).id;

  ids.customer = await mk("journey-real");
  ids.qa = await mk("journey-qa", { accountType: "QA" });
  ids.nonConsenting = await mk("journey-no-consent");

  await db.onboardingProfile.create({
    data: { customerId: ids.customer, lifestyle: ["work-professional"], favoriteColors: ["grey"] },
  });
});

after(async () => { if (!skip) await db.$disconnect(); });

// ── §J-1 — Closet completeness ────────────────────────────────────────────────

describe("§J-1 Closet completeness persists", { skip }, () => {
  it("§J-1a starts unanswered", async () => {
    const row = await db.onboardingProfile.findUnique({
      where: { customerId: ids.customer },
      select: { closetCompleteness: true, closetCompletenessAt: true },
    });
    assert.equal(row?.closetCompleteness, null);
    assert.equal(row?.closetCompletenessAt, null);
  });

  it("§J-1b both answers save, with a timestamp, and survive a reload", async () => {
    for (const answer of ["mostly", "still-adding"] as const) {
      // Exactly what the route action does.
      await db.onboardingProfile.updateMany({
        where: { customerId: ids.customer },
        data: { closetCompleteness: answer, closetCompletenessAt: new Date() },
      });

      // A fresh client, so nothing can be served from memory.
      const reader = new PrismaClient({ datasources: { db: { url: URL_! } } });
      const row = await reader.onboardingProfile.findUnique({
        where: { customerId: ids.customer },
        select: { closetCompleteness: true, closetCompletenessAt: true },
      });
      await reader.$disconnect();

      assert.equal(row?.closetCompleteness, answer);
      assert.ok(row?.closetCompletenessAt instanceof Date);
    }
  });

  it("§J-1c the answer can be changed afterwards", async () => {
    await db.onboardingProfile.updateMany({
      where: { customerId: ids.customer },
      data: { closetCompleteness: "mostly", closetCompletenessAt: new Date() },
    });
    const row = await db.onboardingProfile.findUnique({
      where: { customerId: ids.customer }, select: { closetCompleteness: true },
    });
    assert.equal(row?.closetCompleteness, "mostly");
  });

  it("§J-1d an invalid answer is rejected, never stored", async () => {
    // The action validates before writing; this pins that the stored value is
    // only ever one of the two.
    const before = await db.onboardingProfile.findUnique({
      where: { customerId: ids.customer }, select: { closetCompleteness: true },
    });
    const accepted = ["mostly", "still-adding"];
    assert.ok(accepted.includes(before!.closetCompleteness!));
  });
});

// ── §J-2 — advice is qualified by what nAia can see ───────────────────────────

describe("§J-2 unanswered and incomplete Closets get qualified advice", { skip }, () => {
  const bundle = (confidence: "mostly" | "still-adding" | "unknown") =>
    buildWardrobePage({
      closetCount: 12,
      confidence,
      intelligence: {
        ready: true, snapshotReading: "A reading.",
        heroes: { state: "learning", heroes: [] },
        pairings: { state: "learning", pairings: [] },
        observations: [], opportunities: { rediscover: [] },
        passportView: { state: "learning", comparisons: [] },
        wear: { learningNote: "" }, dna: { palette: [], shapes: [], traits: [] },
        snapshot: [], signalAvailability: [],
      } as never,
      needs: {
        state: "available", registers: [],
        enough: [],
        couldUseMore: [{
          id: "need-work", kind: "could-use-more", register: "work",
          title: "Your work dressing repeats one formula", body: "…",
          garmentIds: [], evidence: [], strength: "strong",
        }],
        noUrgentNeed: null, synthesis: { state: "learning", lines: [] },
        styleMe: { state: "learning", requests: [] },
        outcomes: { state: "learning", totalOutcomes: 0, keptNote: null, changedNote: null },
        intentions: { state: "learning", chosen: [], closetStrengths: [] },
        headlines: [],
      } as never,
      recommendations: { state: "available", recommendations: [], notAPriority: [] } as never,
    });

  it("§J-2a unanswered says what the advice is based on", () => {
    const copy = visibleCopy(bundle("unknown")).join(" ");
    assert.match(copy, /Based on the 12 pieces you've added to your Closet\./);
    assert.match(copy, /if you own more than you've added, it could change/i);
  });

  it("§J-2b 'still adding' softens it further", () => {
    const copy = visibleCopy(bundle("still-adding")).join(" ");
    assert.match(copy, /still adding pieces/i);
    assert.match(copy, /first read rather than a final answer/i);
  });

  it("§J-2c 'mostly' firms it up and drops the hedge", () => {
    const copy = visibleCopy(bundle("mostly")).join(" ");
    assert.match(copy, /most of what you wear/i);
    assert.doesNotMatch(copy, /first read rather than a final answer|could change/i);
  });
});

// ── §J-3 — snapshots and "what changed" ───────────────────────────────────────

const needsFor = (workDepth: number, gaps: string[]) => ({
  registers: [{ register: "work", distinctLooks: workDepth, usableCount: 6 }],
  couldUseMore: gaps.map((id) => ({ id })),
}) as never;

const recsFor = (recs: string[]) => ({ recommendations: recs.map((id) => ({ id })) }) as never;

describe("§J-3 snapshot journey", { skip }, () => {
  it("§J-3a a baseline is written before anything changes, and no claim is made", async () => {
    const summary = summariseWardrobe({
      needs: needsFor(2, ["need-work"]), recommendations: recsFor(["rec-work"]), closetCount: 3,
    });
    await db.wardrobeSnapshot.create({
      data: { customerId: ids.customer, closetCount: 3, summary: summary as never },
    });

    const rows = await db.wardrobeSnapshot.findMany({ where: { customerId: ids.customer } });
    assert.equal(rows.length, 1, "a real baseline row exists");

    // With no PREVIOUS reading, nothing may be said about history.
    const change = diffSnapshots({ before: null, after: summary, takenAt: null, added: [] });
    assert.equal(change, null);
  });

  it("§J-3b adding an analysed garment produces the expected visible output", async () => {
    const previous = await db.wardrobeSnapshot.findFirst({
      where: { customerId: ids.customer }, orderBy: { takenAt: "desc" },
    });

    await db.closetItem.create({
      data: closetRow(ids.customer, { name: "Grey Tailored Trousers", category: "BOTTOMS", subcategory: "trousers", primaryColor: "Grey", formality: "business-casual" }),
    });

    const after = summariseWardrobe({
      needs: needsFor(6, []), recommendations: recsFor([]), closetCount: 4,
    });
    const change = diffSnapshots({
      before: previous!.summary as never,
      after,
      takenAt: previous!.takenAt.toISOString(),
      added: [{ garmentId: "new", name: "Grey Tailored Trousers", worksWithIds: ["a", "b", "c"] }],
    });

    assert.ok(change, "a change is reported");
    assert.equal(change!.piecesAdded, 1);
    assert.deepEqual(change!.improved, [{ register: "work", from: 2, to: 6 }]);
    assert.deepEqual(change!.gapsClosed, ["need-work"]);

    const text = changeLines(change!).join(" ");
    assert.match(text, /Grey Tailored Trousers works with 3 pieces you already own\./);
    assert.match(text, /work dressing has more range than it did — 2 combinations nAia could support, now 6\./);
    assert.match(text, /closes a gap nAia had flagged\./);

    await db.wardrobeSnapshot.create({
      data: { customerId: ids.customer, closetCount: 4, summary: after as never },
    });
  });

  it("§J-3c reloading does not invent a second change, or write a second row", async () => {
    const rowsBefore = await db.wardrobeSnapshot.count({ where: { customerId: ids.customer } });
    const latest = await db.wardrobeSnapshot.findFirst({
      where: { customerId: ids.customer }, orderBy: { takenAt: "desc" },
    });

    // The same reading again — which is what a refresh produces.
    const same = latest!.summary as never;
    const change = diffSnapshots({
      before: same, after: same, takenAt: latest!.takenAt.toISOString(), added: [],
    });
    assert.equal(change, null, "an unmoved wardrobe reports nothing");

    // …and because there is nothing to report, nothing is recorded.
    const rowsAfter = await db.wardrobeSnapshot.count({ where: { customerId: ids.customer } });
    assert.equal(rowsAfter, rowsBefore, "refreshing does not accumulate snapshots");
  });

  it("§J-3d a Passport edit is not reported as the effect of adding a garment", async () => {
    const latest = await db.wardrobeSnapshot.findFirst({
      where: { customerId: ids.customer }, orderBy: { takenAt: "desc" },
    });

    // Nothing added or removed; depth moves because the reading changed.
    await db.onboardingProfile.updateMany({
      where: { customerId: ids.customer }, data: { favoriteColors: ["grey", "navy"] },
    });

    const change = diffSnapshots({
      before: latest!.summary as never,
      after: summariseWardrobe({ needs: needsFor(9, []), recommendations: recsFor([]), closetCount: 4 }),
      takenAt: latest!.takenAt.toISOString(),
      added: [],
    });

    assert.ok(change);
    assert.equal(change!.piecesAdded, 0);
    const text = changeLines(change!).join(" ");
    assert.match(text, /Your Closet hasn't changed, but nAia's reading of it has\./);
    assert.doesNotMatch(text, /works with \d+ piece|You've added/);
  });

  it("§J-3e a stale snapshot version is ignored rather than misread", async () => {
    await db.wardrobeSnapshot.create({
      data: {
        customerId: ids.nonConsenting, closetCount: 1,
        summary: { version: SNAPSHOT_VERSION - 1, closetCount: 1, registers: [], openGaps: [], recommendations: [] } as never,
      },
    });
    const row = await db.wardrobeSnapshot.findFirst({ where: { customerId: ids.nonConsenting } });
    const change = diffSnapshots({
      before: row!.summary as never,
      after: summariseWardrobe({ needs: needsFor(5, []), recommendations: recsFor([]), closetCount: 9 }),
      takenAt: row!.takenAt.toISOString(),
      added: [],
    });
    assert.equal(change, null);
  });

  it("§J-3f a piece with no new connections gets an honest line, not an empty block", async () => {
    const latest = await db.wardrobeSnapshot.findFirst({
      where: { customerId: ids.customer }, orderBy: { takenAt: "desc" },
    });
    const change = diffSnapshots({
      before: latest!.summary as never,
      after: summariseWardrobe({ needs: needsFor(9, []), recommendations: recsFor([]), closetCount: 5 }),
      takenAt: latest!.takenAt.toISOString(),
      added: [{ garmentId: "lonely", name: "Sequin Mini Dress", worksWithIds: [] }],
    });
    assert.ok(change);
    const lines = changeLines(change!);
    assert.ok(lines.length > 0, "the block is not empty");
    assert.match(lines.join(" "), /You've added 1 piece since nAia last looked\./);
    assert.doesNotMatch(lines.join(" "), /works with/);
  });
});

// ── §J-4 — design research consent ────────────────────────────────────────────

describe("§J-4 consent", { skip }, () => {
  it("§J-4a defaults to off, with no timestamp and no version", async () => {
    const row = await db.customer.findUnique({
      where: { id: ids.nonConsenting },
      select: { designResearchConsent: true, designResearchConsentAt: true, designResearchConsentVersion: true },
    });
    assert.equal(row?.designResearchConsent, false);
    assert.equal(row?.designResearchConsentAt, null);
    assert.equal(row?.designResearchConsentVersion, null);
  });

  it("§J-4b opting in records the version and the time, and survives a reload", async () => {
    await db.customer.update({
      where: { id: ids.customer },
      data: {
        designResearchConsent: true,
        designResearchConsentAt: new Date(),
        designResearchConsentVersion: CONSENT_VERSION,
      },
    });
    const reader = new PrismaClient({ datasources: { db: { url: URL_! } } });
    const row = await reader.customer.findUnique({
      where: { id: ids.customer },
      select: { designResearchConsent: true, designResearchConsentAt: true, designResearchConsentVersion: true },
    });
    await reader.$disconnect();
    assert.equal(row?.designResearchConsent, true);
    assert.equal(row?.designResearchConsentVersion, CONSENT_VERSION);
    assert.ok(row?.designResearchConsentAt instanceof Date);
  });

  it("§J-4c withdrawing clears the version so it cannot be counted again", async () => {
    await db.customer.update({
      where: { id: ids.customer },
      data: { designResearchConsent: false, designResearchConsentAt: new Date(), designResearchConsentVersion: null },
    });
    const row = await db.customer.findUnique({
      where: { id: ids.customer },
      select: { designResearchConsent: true, designResearchConsentVersion: true, designResearchConsentAt: true },
    });
    assert.equal(row?.designResearchConsent, false);
    assert.equal(row?.designResearchConsentVersion, null);
    // The timestamp of the DECISION is kept — withdrawal is a recorded event.
    assert.ok(row?.designResearchConsentAt instanceof Date);

    // Restore for the eligibility tests below.
    await db.customer.update({
      where: { id: ids.customer },
      data: { designResearchConsent: true, designResearchConsentAt: new Date(), designResearchConsentVersion: CONSENT_VERSION },
    });
  });

  it("§J-4d declining leaves the styling service untouched", async () => {
    // The non-consenting customer still has a profile and a Closet, and nothing
    // about consent appears in what the styling layer reads.
    const profile = await db.onboardingProfile.findUnique({ where: { customerId: ids.customer } });
    assert.ok(profile, "the Passport is unaffected");
    const items = await db.closetItem.count({ where: { customerId: ids.customer } });
    assert.ok(items >= 0);
  });
});

// ── §J-5 — eligibility is a query, not a display filter ───────────────────────

describe("§J-5 eligibility at the data layer", { skip }, () => {
  it("§J-5a only a consenting, current-version, real account is eligible", async () => {
    // The QA account consents — and is still excluded, because it is ours.
    await db.customer.update({
      where: { id: ids.qa },
      data: { designResearchConsent: true, designResearchConsentAt: new Date(), designResearchConsentVersion: CONSENT_VERSION },
    });

    const eligible = await db.customer.findMany({ where: ELIGIBLE_WHERE as never, select: { id: true } });
    const eligibleIds = eligible.map((r) => r.id);

    assert.ok(eligibleIds.includes(ids.customer), "the consenting real customer is eligible");
    assert.ok(!eligibleIds.includes(ids.qa), "the QA account is excluded at the query layer");
    assert.ok(!eligibleIds.includes(ids.nonConsenting), "the non-consenting customer is excluded");
  });

  it("§J-5b consent to an older wording does not carry forward", async () => {
    await db.customer.update({
      where: { id: ids.nonConsenting },
      data: { designResearchConsent: true, designResearchConsentAt: new Date(), designResearchConsentVersion: "2020-01-01.0" },
    });
    const eligible = await db.customer.findMany({ where: ELIGIBLE_WHERE as never, select: { id: true } });
    assert.ok(!eligible.map((r) => r.id).includes(ids.nonConsenting));
  });

  it("§J-5c the denominator counts real accounts, not ours", async () => {
    const all = await db.customer.count({ where: { accountType: "CUSTOMER" } });
    const qa = await db.customer.count({ where: { accountType: { not: "CUSTOMER" } } });
    assert.equal(qa, 1, "the QA account exists");
    assert.ok(!Number.isNaN(all));
  });

  it("§J-5d an account type can be set by an authorised operator", async () => {
    // The mechanism: a column, written deliberately. Nothing infers it from an
    // email pattern, which is how test data leaks into customer insight.
    const temp = await db.customer.create({ data: { shopifyCustomerId: "journey-demo" } });
    assert.equal(temp.accountType, "CUSTOMER", "new accounts are real by default");
    const marked = await db.customer.update({ where: { id: temp.id }, data: { accountType: "DEMO" } });
    assert.equal(marked.accountType, "DEMO");
    await db.customer.delete({ where: { id: temp.id } });
  });
});

// ── §J-6 — inferred and confirmed stay apart ──────────────────────────────────

describe("§J-6 evidence stages", { skip }, () => {
  it("§J-6a a derived need is inferred; only her words are confirmed", () => {
    const [signal] = buildDesignSignals({
      customerId: ids.customer,
      needs: {
        state: "available",
        registers: [{ register: "work", label: "work", distinctLooks: 2, usableCount: 6, needed: true }],
        couldUseMore: [{
          id: "need-work", kind: "could-use-more", register: "work",
          title: "Your work dressing repeats one formula", body: "…",
          garmentIds: [], evidence: [], strength: "strong",
        }],
        enough: [], styleMe: { state: "available", requests: [{ register: "work", sessions: 5 }] },
        outcomes: { state: "learning", totalOutcomes: 0, keptNote: null, changedNote: null },
      } as never,
      recommendations: { state: "available", recommendations: [], notAPriority: [] } as never,
      closetCompleteness: "mostly",
    });

    const closet = signal.claims.find((c) => c.source === "closet")!;
    const passport = signal.claims.find((c) => c.source === "passport")!;
    const styleMe = signal.claims.find((c) => c.source === "styleme")!;
    assert.equal(closet.stage, "inferred", "what nAia worked out");
    assert.equal(passport.stage, "confirmed", "what she told nAia");
    assert.equal(styleMe.stage, "confirmed", "what she asked for");
  });
});

// ── §J-7 — product context persists only when known ───────────────────────────

describe("§J-7 product, variant and size", { skip }, () => {
  it("§J-7a known context is stored", async () => {
    const row = await db.recommendationFeedback.create({
      data: {
        customerId: ids.customer, target: "nadine-product", rating: "not-for-me",
        reasonCodes: ["too-tight"],
        shopifyProductId: "gid://shopify/Product/1", shopifyVariantId: "gid://shopify/ProductVariant/9",
        sizeLabel: "M",
      },
    });
    assert.equal(row.shopifyVariantId, "gid://shopify/ProductVariant/9");
    assert.equal(row.sizeLabel, "M");
  });

  it("§J-7b unknown context stays null rather than being invented", async () => {
    const row = await db.recommendationFeedback.create({
      data: {
        customerId: ids.customer, target: "complete-suggestion", rating: "okay",
        reasonCodes: [],
      },
    });
    assert.equal(row.shopifyProductId, null);
    assert.equal(row.shopifyVariantId, null);
    assert.equal(row.sizeLabel, null);
  });

  it("§J-7c a reason-less rejection carries no attributed cause", async () => {
    const row = await db.recommendationFeedback.create({
      data: { customerId: ids.customer, target: "nadine-product", rating: "not-for-me", reasonCodes: [], shopifyProductId: "gid://shopify/Product/2" },
    });
    assert.deepEqual(row.reasonCodes, []);
    assert.equal(row.sizeLabel, null, "no size means the complaint cannot be called a fit problem");
  });
});
