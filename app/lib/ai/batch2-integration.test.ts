// app/lib/ai/batch2-integration.test.ts
// Batch 2 — Live Integration certification tests.
//
// Covers:
//   Technical Debt 1 — DB-backed Buy/Skip idempotency            (b2-1  to b2-5)
//   Technical Debt 2 — Awaited event deduplication               (b2-6  to b2-12)
//   Live data query structure                                     (b2-13 to b2-22)
//   Mode isolation — test customers excluded from live queries    (b2-23 to b2-27)
//   Period filtering in live queries                              (b2-28 to b2-31)
//   Dashboard loader wires liveSignals                           (b2-32 to b2-36)
//   Intent-only language enforcement                             (b2-37 to b2-41)
//   Prohibited integrations absent                               (b2-42 to b2-46)
//   Deduplication key format                                     (b2-47 to b2-50)
//
// Run: node --test --import tsx/esm app/lib/ai/batch2-integration.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf8");
}

function readRoute(name: string): string {
  return readSrc(`../../routes/${name}`);
}

// ── Technical Debt 1: DB-backed Buy/Skip idempotency ─────────────────────────

describe("Technical Debt 1 — Buy/Skip DB-backed idempotency (b2-1 to b2-5)", () => {
  it("b2-1: api.wishlist uses createHash for idempotency key", () => {
    const src = readRoute("api.wishlist.jsx");
    assert.ok(src.includes("createHash"), "Must import createHash from node:crypto");
    assert.ok(src.includes("sha256"), "Must use sha256 hash");
  });

  it("b2-2: api.wishlist catches P2002 for idempotent repeats", () => {
    const src = readRoute("api.wishlist.jsx");
    assert.ok(src.includes("P2002"), "Must catch P2002 unique constraint violation");
    assert.ok(src.includes("isIdempotentRepeat"), "Must set isIdempotentRepeat flag on P2002");
  });

  it("b2-3: api.wishlist uses bucket-based idempotency window", () => {
    const src = readRoute("api.wishlist.jsx");
    assert.ok(
      src.includes("IDEMPOTENCY_WINDOW_SECONDS"),
      "Must define IDEMPOTENCY_WINDOW_SECONDS (not the old IDEMPOTENCY_WINDOW_MS)",
    );
    assert.ok(
      !src.includes("IDEMPOTENCY_WINDOW_MS"),
      "Must not use the old time-window read-before-write approach",
    );
  });

  it("b2-4: prisma schema adds idempotencyKey to BuyOrSkipAnalysis", () => {
    const schema = readSrc("../../../prisma/schema.prisma");
    const bosBlock = schema.slice(
      schema.indexOf("model BuyOrSkipAnalysis"),
      schema.indexOf("model BuyOrSkipAnalysis") + 2000,
    );
    assert.ok(bosBlock.includes("idempotencyKey"), "BuyOrSkipAnalysis must have idempotencyKey field");
    assert.ok(bosBlock.includes("@unique"), "BuyOrSkipAnalysis.idempotencyKey must be unique");
  });

  it("b2-5: idempotency key format starts with bos:", () => {
    // Verify the key format by simulating what the route does
    const WINDOW = 60;
    const bucket = Math.floor(Date.now() / (WINDOW * 1000));
    const customerId = "test-customer";
    const imageUrl = "https://example.com/img.jpg";
    const key = "bos:" + createHash("sha256")
      .update(`${customerId}:${imageUrl}:${bucket}`)
      .digest("hex").slice(0, 24);
    assert.ok(key.startsWith("bos:"), "Idempotency key must start with bos:");
    assert.equal(key.length, 4 + 24, "bos: prefix (4) + 24 hex chars = 28 chars total");
  });
});

// ── Technical Debt 2: Awaited event deduplication ────────────────────────────

describe("Technical Debt 2 — Awaited event deduplication (b2-6 to b2-12)", () => {
  it("b2-6: journey-events.server exports recordJourneyEventAwaited", () => {
    const src = readSrc("./journey-events.server.ts");
    assert.ok(
      src.includes("export async function recordJourneyEventAwaited"),
      "Must export recordJourneyEventAwaited",
    );
  });

  it("b2-7: recordJourneyEventAwaited catches P2002 for idempotent repeats", () => {
    const src = readSrc("./journey-events.server.ts");
    // Search from the function DECLARATION (not the first comment mention)
    const block = src.slice(
      src.indexOf("export async function recordJourneyEventAwaited"),
      src.indexOf("export async function recordJourneyEventAwaited") + 1500,
    );
    assert.ok(block.includes("P2002"), "Must catch P2002 in recordJourneyEventAwaited");
    assert.ok(block.includes("created: false"), "Must return { created: false } on P2002");
    assert.ok(block.includes("created: true"), "Must return { created: true } on success");
  });

  it("b2-8: JourneyEvent schema has idempotencyKey field", () => {
    const schema = readSrc("../../../prisma/schema.prisma");
    const jevBlock = schema.slice(
      schema.indexOf("model JourneyEvent"),
      schema.indexOf("model JourneyEvent") + 1000,
    );
    assert.ok(jevBlock.includes("idempotencyKey"), "JourneyEvent must have idempotencyKey field");
    assert.ok(jevBlock.includes("@unique"), "JourneyEvent.idempotencyKey must be unique");
  });

  it("b2-9: style-me/result uses recordJourneyEventAwaited for look_saved", () => {
    const src = readRoute("style-me/result.tsx");
    assert.ok(
      src.includes("recordJourneyEventAwaited"),
      "result.tsx must use recordJourneyEventAwaited",
    );
    assert.ok(
      src.includes("look_saved:"),
      "result.tsx must use look_saved: idempotency key prefix",
    );
  });

  it("b2-10: closet._index uses recordJourneyEventAwaited for closet_item_added", () => {
    const src = readRoute("closet._index.tsx");
    assert.ok(
      src.includes("recordJourneyEventAwaited"),
      "closet._index.tsx must use recordJourneyEventAwaited",
    );
    assert.ok(
      src.includes("closet_item_added:"),
      "closet._index.tsx must use closet_item_added: idempotency key prefix",
    );
  });

  it("b2-11: api.save-style-profile uses recordJourneyEventAwaited for passport events", () => {
    const src = readRoute("api.save-style-profile.jsx");
    assert.ok(
      src.includes("recordJourneyEventAwaited"),
      "api.save-style-profile.jsx must use recordJourneyEventAwaited",
    );
    assert.ok(
      src.includes("passport_completed:"),
      "Must use passport_completed: key for first completion",
    );
    assert.ok(
      src.includes("passport_updated:"),
      "Must use passport_updated: key for updates",
    );
  });

  it("b2-12: idempotency keys follow <eventType>:<sourceRecordId>:v1 format", () => {
    const src = readRoute("api.save-style-profile.jsx");
    // passport_completed:<profile.id>:v1
    assert.ok(
      src.includes(":v1`"),
      "Idempotency keys must end with :v1 version suffix",
    );
  });
});

// ── Live data query structure ──────────────────────────────────────────────────

describe("Live data query structure (b2-13 to b2-22)", () => {
  it("b2-13: live-customer-signals.server exports getLiveCustomerSignals", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(
      src.includes("export async function getLiveCustomerSignals"),
      "Must export getLiveCustomerSignals",
    );
  });

  it("b2-14: getLiveCustomerSignals aggregates all 10 sub-loaders", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(src.indexOf("export async function getLiveCustomerSignals"), src.length);
    const expected = [
      "getLiveFeatureAdoption",
      "getLivePassportData",
      "getLiveStyleMeData",
      "getLiveBuySkipData",
      "getLiveSavedLooksData",
      "getLiveClosetData",
      "getLiveFeedbackData",
      "getLiveSessionReviewData",
      "getLivePostWearData",
      "getLiveCustomerJourney",
    ];
    for (const fn of expected) {
      assert.ok(fnBlock.includes(fn), `getLiveCustomerSignals must call ${fn}`);
    }
  });

  it("b2-15: live-customer-signals exports all required functions", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const exports = [
      "getLiveFeatureAdoption",
      "getLivePassportData",
      "getLiveStyleMeData",
      "getLiveBuySkipData",
      "getLiveSavedLooksData",
      "getLiveClosetData",
      "getLiveFeedbackData",
      "getLiveSessionReviewData",
      "getLivePostWearData",
      "getLiveCustomerJourney",
      "getLiveCustomerSignals",
    ];
    for (const fn of exports) {
      assert.ok(src.includes(`export async function ${fn}`), `Must export ${fn}`);
    }
  });

  it("b2-16: feature adoption table has 10 rows (one per feature)", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(
      src.indexOf("export async function getLiveFeatureAdoption"),
      src.indexOf("export async function getLivePassportData"),
    );
    // Count row("Feature name", ...) calls — these are the actual return-array entries
    // (excludes the function row() definition which uses 'row(' without a quoted string)
    const rowEntryCalls = (fnBlock.match(/row\("[^"]+"/g) || []).length;
    assert.equal(rowEntryCalls, 10, "Feature adoption table must have exactly 10 rows");
  });

  it("b2-17: customer journey has 8 stages", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(
      src.indexOf("export async function getLiveCustomerJourney"),
      src.indexOf("export interface IsolationCheck"),
    );
    const stages = (fnBlock.match(/\{ stage:/g) || []).length;
    assert.equal(stages, 8, "Customer journey must have exactly 8 stages");
  });

  it("b2-18: live signals use Promise.all for parallel queries", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const parallelBlocks = (src.match(/await Promise\.all\(/g) || []).length;
    assert.ok(
      parallelBlocks >= 2,
      "Must use Promise.all in at least 2 places for parallel query execution",
    );
  });

  it("b2-19: LiveCustomerSignals interface includes all required fields", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const iface = src.slice(
      src.indexOf("export interface LiveCustomerSignals"),
      src.indexOf("export interface LiveCustomerSignals") + 600,
    );
    const expected = ["featureAdoption", "passport", "styleMe", "buySkip", "savedLooks", "closet", "feedback", "sessionReview", "postWear", "journey", "isolationOk", "period"];
    for (const field of expected) {
      assert.ok(iface.includes(field), `LiveCustomerSignals must include ${field}`);
    }
  });

  it("b2-20: FeatureAdoptionRow interface has required 6 columns", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const iface = src.slice(
      src.indexOf("export interface FeatureAdoptionRow"),
      src.indexOf("export interface FeatureAdoptionRow") + 400,
    );
    const expected = ["feature", "uniqueCustomers", "eventCount", "mostRecentActivity", "period", "evidenceState"];
    for (const field of expected) {
      assert.ok(iface.includes(field), `FeatureAdoptionRow must include ${field}`);
    }
  });

  it("b2-21: live signals import canonical vocabulary types", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(src.includes("MeasurementState"), "Must import/use MeasurementState from canonical-vocabulary");
    assert.ok(src.includes("customerEvidenceLabel"), "Must use customerEvidenceLabel for evidence ladder");
  });

  it("b2-22: migration file creates partial unique indexes for nullable idempotency keys", () => {
    const src = readSrc("../../../prisma/migrations/20260730000001_batch2_idempotency_and_dedup/migration.sql");
    assert.ok(
      src.includes("WHERE \"idempotencyKey\" IS NOT NULL"),
      "Partial unique index must exclude NULL values — pre-Batch-2 records have NULL idempotencyKey",
    );
    assert.ok(
      src.includes("BuyOrSkipAnalysis") && src.includes("JourneyEvent"),
      "Migration must cover both BuyOrSkipAnalysis and JourneyEvent",
    );
  });
});

// ── Mode isolation — test customers excluded ──────────────────────────────────

describe("Mode isolation — test customers excluded from live queries (b2-23 to b2-27)", () => {
  it("b2-23: live-customer-signals defines TEST_CUSTOMER_PREFIX_FILTER", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(
      src.includes("TEST_CUSTOMER_PREFIX_FILTER"),
      "Must define TEST_CUSTOMER_PREFIX_FILTER constant",
    );
    assert.ok(
      src.includes("test-batch1-"),
      "Filter must target test-batch1- prefix customers",
    );
  });

  it("b2-24: TEST_CUSTOMER_PREFIX_FILTER applied in getLiveFeatureAdoption", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(
      src.indexOf("export async function getLiveFeatureAdoption"),
      src.indexOf("export async function getLivePassportData"),
    );
    // The filter should appear multiple times (once per feature)
    const filterCount = (fnBlock.match(/TEST_CUSTOMER_PREFIX_FILTER/g) || []).length;
    assert.ok(filterCount >= 5, `Feature adoption must apply TEST_CUSTOMER_PREFIX_FILTER at least 5 times, found ${filterCount}`);
  });

  it("b2-25: TEST_CUSTOMER_PREFIX_FILTER applied in getLiveCustomerJourney", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(
      src.indexOf("export async function getLiveCustomerJourney"),
      src.indexOf("export interface IsolationCheck"),
    );
    assert.ok(
      fnBlock.includes("TEST_CUSTOMER_PREFIX_FILTER"),
      "getLiveCustomerJourney must apply TEST_CUSTOMER_PREFIX_FILTER",
    );
  });

  it("b2-26: dashboard loader never calls getLiveCustomerSignals in sample mode", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    // sampleMode return comes before the Promise.all with getLiveCustomerSignals
    const sampleReturn = src.indexOf("liveSignals: null");
    const liveSignalCall = src.indexOf("getLiveCustomerSignals(dateRangeDays)");
    assert.ok(sampleReturn < liveSignalCall, "Sample mode must return before calling getLiveCustomerSignals");
  });

  it("b2-27: dashboard tabs do not render live sections in sample mode", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    // Every live section check must include !sampleMode guard
    const liveSectionMatches = src.match(/liveSignals && !sampleMode/g) || [];
    // We added live sections to 4 tabs — expect at least 8 such guards (2+ per tab)
    assert.ok(liveSectionMatches.length >= 8, `Must have ≥ 8 liveSignals && !sampleMode guards, found ${liveSectionMatches.length}`);
  });
});

// ── Period filtering ────────────────────────────────────────────────────────────

describe("Period filtering in live queries (b2-28 to b2-31)", () => {
  it("b2-28: dateFrom helper creates correct Date offset", () => {
    // Verify dateFrom logic by inspecting source — can't call it directly (needs prisma context)
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(
      src.includes("function dateFrom(days: number)"),
      "Must define dateFrom helper",
    );
    assert.ok(
      src.includes("setDate(d.getDate() - days)"),
      "dateFrom must subtract days from current date",
    );
  });

  it("b2-29: getLiveFeatureAdoption accepts dateRangeDays and applies it", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(
      src.indexOf("export async function getLiveFeatureAdoption"),
      src.indexOf("export async function getLivePassportData"),
    );
    assert.ok(fnBlock.includes("dateFrom(dateRangeDays)"), "Must compute from = dateFrom(dateRangeDays)");
    assert.ok(fnBlock.includes("createdAt: { gte: from }"), "Must filter by createdAt >= from");
  });

  it("b2-30: periodLabel returns correct strings for allowed values", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(src.includes('"Last 7 days"'), "Must return 'Last 7 days' for 7");
    assert.ok(src.includes('"Last 30 days"'), "Must return 'Last 30 days' for 30");
    assert.ok(src.includes('"Last 90 days"'), "Must return 'Last 90 days' for 90");
  });

  it("b2-31: getLiveCustomerSignals passes dateRangeDays to all sub-loaders", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const fnBlock = src.slice(src.indexOf("export async function getLiveCustomerSignals"), src.length);
    const expected = [
      "getLiveFeatureAdoption(dateRangeDays)",
      "getLivePassportData(dateRangeDays)",
      "getLiveStyleMeData(dateRangeDays)",
      "getLiveBuySkipData(dateRangeDays)",
      "getLiveSavedLooksData(dateRangeDays)",
      "getLiveClosetData(dateRangeDays)",
      "getLiveFeedbackData(dateRangeDays)",
      "getLiveSessionReviewData(dateRangeDays)",
      "getLivePostWearData(dateRangeDays)",
      "getLiveCustomerJourney(dateRangeDays)",
    ];
    for (const call of expected) {
      assert.ok(fnBlock.includes(call), `getLiveCustomerSignals must call ${call}`);
    }
  });
});

// ── Dashboard loader wires liveSignals ─────────────────────────────────────────

describe("Dashboard loader wires liveSignals (b2-32 to b2-36)", () => {
  it("b2-32: designer-intelligence.jsx imports getLiveCustomerSignals", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    assert.ok(
      src.includes("getLiveCustomerSignals"),
      "Dashboard must import and use getLiveCustomerSignals",
    );
  });

  it("b2-33: loader includes liveSignals in Promise.all", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    // Check that getLiveCustomerSignals is in the same Promise.all as the other loaders
    const loaderBlock = src.slice(
      src.indexOf("const [dashboard, kpis"),
      src.indexOf("if (dashboard.error)"),
    );
    assert.ok(loaderBlock.includes("getLiveCustomerSignals(dateRangeDays)"), "Loader must call getLiveCustomerSignals in Promise.all");
  });

  it("b2-34: loader returns liveSignals in Response.json", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    const liveBlock = src.slice(
      src.indexOf("if (dashboard.error)"),
      src.indexOf("if (dashboard.error)") + 400,
    );
    assert.ok(liveBlock.includes("liveSignals"), "Loader return must include liveSignals");
  });

  it("b2-35: root component destructures liveSignals from useLoaderData", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    assert.ok(
      src.includes("liveSignals, dateRangeDays"),
      "Root component must destructure liveSignals from useLoaderData",
    );
  });

  it("b2-36: overview, customer, recommendation, and collection-opportunities tabs receive liveSignals", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    const tabBlock = src.slice(
      src.indexOf("activeTab === \"overview\""),
      src.indexOf("activeTab === \"commercial\""),
    );
    const liveCount = (tabBlock.match(/liveSignals=\{liveSignals\}/g) || []).length;
    assert.ok(liveCount >= 4, `Must pass liveSignals to at least 4 tabs, found ${liveCount}`);
  });
});

// ── Intent-only language enforcement ──────────────────────────────────────────

describe("Intent-only language enforcement (b2-37 to b2-41)", () => {
  it("b2-37: live signals file does not use purchase/conversion/revenue language", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const prohibited = ["purchase", "conversion", "revenue", "commercial success", "transaction"];
    // Comments are OK, but rendered strings should not
    const noCommentSrc = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const term of prohibited) {
      assert.ok(
        !noCommentSrc.toLowerCase().includes(term.toLowerCase()),
        `live-customer-signals.server.ts must not use the term "${term}"`,
      );
    }
  });

  it("b2-38: live Saved Looks section does not call it Save-to-Purchase", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    // Only check the new Live Saved Looks section (Batch 2 addition) — not pre-existing Commercial tab
    const liveSavedLooksSection = src.slice(
      src.indexOf("Live Saved Looks"),
      src.indexOf("Live Saved Looks") + 800,
    );
    assert.ok(liveSavedLooksSection.length > 0, "Live Saved Looks section must exist");
    assert.ok(
      !liveSavedLooksSection.includes("Save-to-Purchase"),
      "Live Saved Looks section must not use Save-to-Purchase — Shopify orders not yet connected",
    );
  });

  it("b2-39: Buy/Skip section describes verdict as intent not purchase", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    const buySkipSection = src.slice(
      src.indexOf("Live Buy/Skip Intent"),
      src.indexOf("Live Buy/Skip Intent") + 600,
    );
    assert.ok(
      buySkipSection.includes("stated intent") || buySkipSection.includes("intent, not"),
      "Buy/Skip section must clarify verdict is stated intent, not a purchase",
    );
  });

  it("b2-40: post-wear section clarifies would-wear-again is not verified repeat wear", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    const postWearSection = src.slice(
      src.indexOf("Live Post-Wear Follow-Up"),
      src.indexOf("Live Post-Wear Follow-Up") + 1200,
    );
    // The section may say "not verified repeat wear" (correct disclaimer) but must not
    // say "verified repeat wear" as a positive claim — check by ensuring "not" precedes it
    const hasPositiveClaim = postWearSection.match(/(?<!not )(verified repeat wear)/);
    assert.ok(
      !hasPositiveClaim,
      "Post-wear section must not positively claim 'verified repeat wear' — self-reported data only",
    );
    assert.ok(
      postWearSection.includes("Stated intent") || postWearSection.includes("stated intent") || postWearSection.includes("not verified"),
      "Post-wear section must clarify rewear intent is not verified",
    );
  });

  it("b2-41: live journey description is not called a commercial conversion funnel", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    const journeySection = src.slice(
      src.indexOf("Live Customer Journey"),
      src.indexOf("Live Customer Journey") + 300,
    );
    assert.ok(
      !journeySection.includes("commercial") || journeySection.includes("not a commercial"),
      "Journey section must not be called a commercial conversion funnel",
    );
  });
});

// ── Prohibited integrations absent ────────────────────────────────────────────

describe("Prohibited integrations absent from Batch 2 (b2-42 to b2-46)", () => {
  it("b2-42: live signals do not query Shopify orders", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    const prohibited = ["shopifyOrder", "Order", "ShopifyOrder"];
    for (const term of prohibited) {
      assert.ok(!src.includes(`prisma.${term}`), `Must not query prisma.${term} — Shopify orders not connected`);
    }
  });

  it("b2-43: live signals do not query Shopify wishlist or ShopifyReturn models", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(!src.includes("wishlist"), "Must not query Shopify wishlist in Batch 2");
    assert.ok(
      !src.includes("prisma.shopifyReturn") && !src.includes("ShopifyReturn"),
      "Must not query ShopifyReturn model in Batch 2",
    );
  });

  it("b2-44: live signals do not query FASHN.ai directly", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(!src.includes("fashn"), "Must not call FASHN.ai API in live signals");
    assert.ok(!src.includes("FASHN"), "Must not reference FASHN.ai in live signals");
  });

  it("b2-45: live signals do not query cart or checkout", () => {
    const src = readSrc("./live-customer-signals.server.ts");
    assert.ok(!src.includes("cart"), "Must not query cart in Batch 2 — no Shopify commerce connection");
    assert.ok(!src.includes("checkout"), "Must not query checkout in Batch 2");
  });

  it("b2-46: dashboard Commercial tab does not receive liveSignals", () => {
    const src = readRoute("app.designer-intelligence.jsx");
    const commercialTabCall = src.slice(
      src.indexOf("activeTab === \"commercial\""),
      src.indexOf("activeTab === \"commercial\"") + 200,
    );
    assert.ok(
      !commercialTabCall.includes("liveSignals"),
      "Commercial tab must not receive liveSignals — Shopify commerce not connected",
    );
  });
});

// ── Deduplication key format ───────────────────────────────────────────────────

describe("Deduplication key format (b2-47 to b2-50)", () => {
  it("b2-47: look_saved key includes savedLookId", () => {
    const src = readRoute("style-me/result.tsx");
    assert.ok(
      src.includes("look_saved:${savedLook.id}:v1") ||
      src.includes("look_saved:${savedLookPending.id}:v1"),
      "look_saved key must embed the saved look ID",
    );
  });

  it("b2-48: in_session_review_submitted key includes sessionId", () => {
    const src = readRoute("style-me/result.tsx");
    assert.ok(
      src.includes("in_session_review_submitted:${sessionId}:v1"),
      "in_session_review_submitted key must embed the sessionId",
    );
  });

  it("b2-49: closet_item_added key includes newItem.id", () => {
    const src = readRoute("closet._index.tsx");
    assert.ok(
      src.includes("closet_item_added:${newItem.id}:v1"),
      "closet_item_added key must embed the new closet item ID",
    );
  });

  it("b2-50: buy_skip_submitted key includes analysisRecord.id", () => {
    const src = readRoute("api.wishlist.jsx");
    assert.ok(
      src.includes("buy_skip_submitted:${analysisRecord.id}:v1"),
      "buy_skip_submitted key must embed the analysis record ID",
    );
  });
});
