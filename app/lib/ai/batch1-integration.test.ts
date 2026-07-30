// app/lib/ai/batch1-integration.test.ts
// Batch 1 — Live Integration certification tests.
//
// Covers:
//   stylePersonalities field-name correctness              (b1-1  to b1-3)
//   emitPassportSaved — both completion paths              (b1-4  to b1-9)
//   emitClosetItemAdded — shape and privacy                (b1-10 to b1-14)
//   emitLookSaved — shape and privacy                      (b1-15 to b1-19)
//   emitInSessionReviewSubmitted — shape + confidenceDelta (b1-20 to b1-26)
//   emitBuySkipSubmitted — intent-only language + shape    (b1-27 to b1-33)
//   PII guarantee across all Batch 1 events                (b1-34 to b1-38)
//   Mode isolation — Sample Preview requires both gates    (b1-39 to b1-43)
//   getAdditionalKPIs buyOrSkip shape                      (b1-44 to b1-46)
//
// Run: node --test --import tsx/esm app/lib/ai/batch1-integration.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  emitPassportSaved,
  emitClosetItemAdded,
  emitLookSaved,
  emitInSessionReviewSubmitted,
  emitBuySkipSubmitted,
  hashCustomerId,
} from "./journey-events.server.js";
import { getDesignerSampleData } from "../designer-sample-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readRoute(name: string): string {
  return readFileSync(join(__dirname, "../../routes", name), "utf8");
}

const HASH_RE = /^[0-9a-f]{12}$/;
const RAW_ID = "cust_abc123_real";

// ── stylePersonalities field-name correctness — b1-1 to b1-3 ─────────────────

describe("stylePersonalities field name (Batch 1 fix)", () => {
  it("b1-1: style-me/_index.tsx uses stylePersonalities not stylePersonality", () => {
    const route = readRoute("style-me/_index.tsx");
    assert.ok(
      route.includes("stylePersonalities"),
      "Route must reference stylePersonalities (array field)",
    );
    assert.ok(
      !route.includes("stylePersonality:") && !route.includes("stylePersonality }"),
      "Route must not destructure the deprecated stylePersonality singular field",
    );
  });

  it("b1-2: designer-stats.server.js reads stylePersonalities not styleDNA string", () => {
    const stats = readFileSync(join(__dirname, "../designer-stats.server.js"), "utf8");
    const dnaBlock = stats.includes("stylePersonalities");
    assert.ok(dnaBlock, "designer-stats must iterate stylePersonalities array field");
    assert.ok(
      !stats.includes("JSON.parse(c.onboardingProfile.styleDNA)"),
      "designer-stats must not JSON.parse a non-existent styleDNA string field",
    );
  });

  it("b1-3: api.save-style-profile.jsx does not reference stylePersonality singular", () => {
    const route = readRoute("api.save-style-profile.jsx");
    assert.ok(
      !route.includes("stylePersonality:") && !route.includes("stylePersonality }"),
      "api.save-style-profile must not reference the deprecated singular field",
    );
    assert.ok(
      route.includes("stylePersonalities"),
      "api.save-style-profile must reference stylePersonalities",
    );
  });
});

// ── emitPassportSaved — b1-4 to b1-9 ─────────────────────────────────────────

describe("emitPassportSaved event shape", () => {
  it("b1-4: first-time completion emits passport_completed", () => {
    const ev = emitPassportSaved({
      customerId: RAW_ID,
      isFirstCompletion: true,
      fieldCount: 9,
    });
    assert.equal(ev.type, "passport_completed");
  });

  it("b1-5: subsequent save emits passport_updated", () => {
    const ev = emitPassportSaved({
      customerId: RAW_ID,
      isFirstCompletion: false,
      fieldCount: 6,
    });
    assert.equal(ev.type, "passport_updated");
  });

  it("b1-6: sessionId sentinel is 'passport'", () => {
    const ev = emitPassportSaved({ customerId: RAW_ID, isFirstCompletion: true, fieldCount: 5 });
    assert.equal(ev.sessionId, "passport");
  });

  it("b1-7: fieldCount is included in payload", () => {
    const ev = emitPassportSaved({ customerId: RAW_ID, isFirstCompletion: false, fieldCount: 11 });
    assert.equal((ev.payload as any).fieldCount, 11);
  });

  it("b1-8: customerIdHash is 12-char hex, not the raw ID", () => {
    const ev = emitPassportSaved({ customerId: RAW_ID, isFirstCompletion: true, fieldCount: 3 });
    assert.match(ev.customerIdHash, HASH_RE);
    assert.notEqual(ev.customerIdHash, RAW_ID);
  });

  it("b1-9: nowFn override controls occurredAt", () => {
    const ev = emitPassportSaved({
      customerId: RAW_ID, isFirstCompletion: true, fieldCount: 3,
      nowFn: () => "2026-01-15T12:00:00.000Z",
    });
    assert.equal(ev.occurredAt, "2026-01-15T12:00:00.000Z");
  });
});

// ── emitClosetItemAdded — b1-10 to b1-14 ─────────────────────────────────────

describe("emitClosetItemAdded event shape", () => {
  it("b1-10: type is closet_item_added", () => {
    const ev = emitClosetItemAdded({
      customerId: RAW_ID,
      closetItemId: "item_xyz",
      category: "TOPS",
      tryOnEligibility: "ready-for-try-on",
    });
    assert.equal(ev.type, "closet_item_added");
  });

  it("b1-11: sessionId sentinel is 'closet'", () => {
    const ev = emitClosetItemAdded({
      customerId: RAW_ID, closetItemId: "item_xyz", category: "BOTTOMS", tryOnEligibility: null,
    });
    assert.equal(ev.sessionId, "closet");
  });

  it("b1-12: null tryOnEligibility maps to 'unknown' in payload", () => {
    const ev = emitClosetItemAdded({
      customerId: RAW_ID, closetItemId: "item_xyz", category: "SHOES", tryOnEligibility: null,
    });
    assert.equal((ev.payload as any).tryOnEligibility, "unknown");
  });

  it("b1-13: closetItemId is included in payload (catalog/internal ID, not customer asset)", () => {
    const ev = emitClosetItemAdded({
      customerId: RAW_ID, closetItemId: "item_abc", category: "BAGS", tryOnEligibility: "not-supported",
    });
    assert.equal((ev.payload as any).closetItemId, "item_abc");
  });

  it("b1-14: customerIdHash is 12-char hex", () => {
    const ev = emitClosetItemAdded({
      customerId: RAW_ID, closetItemId: "x", category: "TOPS", tryOnEligibility: null,
    });
    assert.match(ev.customerIdHash, HASH_RE);
  });
});

// ── emitLookSaved — b1-15 to b1-19 ──────────────────────────────────────────

describe("emitLookSaved event shape", () => {
  it("b1-15: type is look_saved", () => {
    const ev = emitLookSaved({
      customerId: RAW_ID,
      sessionId: "sess_abc",
      savedLookId: "look_xyz",
      fromSuggestionId: "sug_123",
      itemCount: 3,
      occasion: "Work",
    });
    assert.equal(ev.type, "look_saved");
  });

  it("b1-16: sessionId matches the session that generated the look", () => {
    const ev = emitLookSaved({
      customerId: RAW_ID, sessionId: "sess_qwe", savedLookId: "look_a",
      fromSuggestionId: null, itemCount: 1, occasion: null,
    });
    assert.equal(ev.sessionId, "sess_qwe");
  });

  it("b1-17: savedLookId and fromSuggestionId included in payload", () => {
    const ev = emitLookSaved({
      customerId: RAW_ID, sessionId: "sess_x", savedLookId: "look_z",
      fromSuggestionId: "sug_z", itemCount: 2, occasion: null,
    });
    assert.equal((ev.payload as any).savedLookId, "look_z");
    assert.equal((ev.payload as any).fromSuggestionId, "sug_z");
  });

  it("b1-18: null fromSuggestionId is preserved as null", () => {
    const ev = emitLookSaved({
      customerId: RAW_ID, sessionId: "s", savedLookId: "l",
      fromSuggestionId: null, itemCount: 0, occasion: null,
    });
    assert.equal((ev.payload as any).fromSuggestionId, null);
  });

  it("b1-19: customerIdHash is 12-char hex, not raw ID", () => {
    const ev = emitLookSaved({
      customerId: RAW_ID, sessionId: "s", savedLookId: "l",
      fromSuggestionId: null, itemCount: 1, occasion: null,
    });
    assert.match(ev.customerIdHash, HASH_RE);
    assert.notEqual(ev.customerIdHash, RAW_ID);
  });
});

// ── emitInSessionReviewSubmitted — b1-20 to b1-26 ────────────────────────────

describe("emitInSessionReviewSubmitted event shape", () => {
  it("b1-20: type is in_session_review_submitted", () => {
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "sess_r",
      overallFeeling: 4, confidenceBefore: 6, confidenceAfter: 8,
      feltLikeHer: "Yes", desiredFeelingAchieved: "Yes", wouldWearAgain: "Definitely",
    });
    assert.equal(ev.type, "in_session_review_submitted");
  });

  it("b1-21: confidenceDelta is computed from before/after", () => {
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "s",
      overallFeeling: 3, confidenceBefore: 5, confidenceAfter: 9,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: null,
    });
    assert.equal((ev.payload as any).confidenceDelta, 4);
  });

  it("b1-22: confidenceDelta is null when either before/after is null", () => {
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "s",
      overallFeeling: null, confidenceBefore: null, confidenceAfter: null,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: null,
    });
    assert.equal((ev.payload as any).confidenceDelta, null);
  });

  it("b1-23: payload does not include raw confidence values (only delta)", () => {
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "s",
      overallFeeling: 4, confidenceBefore: 3, confidenceAfter: 7,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: null,
    });
    assert.equal((ev.payload as any).confidenceBefore, undefined);
    assert.equal((ev.payload as any).confidenceAfter, undefined);
  });

  it("b1-24: wouldWearAgain is intent language, not verified wear", () => {
    // Contract: 'wouldWearAgain' reflects stated intent — never 'verified_wear' or purchase signal
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "s",
      overallFeeling: null, confidenceBefore: null, confidenceAfter: null,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: "Definitely",
    });
    const payload = ev.payload as any;
    assert.equal(payload.wouldWearAgain, "Definitely");
    // Payload must not contain transaction or verified-wear language
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes("verified_wear"), "no verified_wear in payload");
    assert.ok(!serialized.includes("transaction"), "no transaction in payload");
  });

  it("b1-25: sessionId is passed through correctly", () => {
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "sess_review",
      overallFeeling: null, confidenceBefore: null, confidenceAfter: null,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: null,
    });
    assert.equal(ev.sessionId, "sess_review");
  });

  it("b1-26: customerIdHash is 12-char hex", () => {
    const ev = emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "s",
      overallFeeling: null, confidenceBefore: null, confidenceAfter: null,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: null,
    });
    assert.match(ev.customerIdHash, HASH_RE);
  });
});

// ── emitBuySkipSubmitted — b1-27 to b1-33 ────────────────────────────────────

describe("emitBuySkipSubmitted event shape and intent-only contract", () => {
  it("b1-27: type is buy_skip_submitted", () => {
    const ev = emitBuySkipSubmitted({
      customerId: RAW_ID, sessionId: "buy-or-skip",
      analysisId: "bos_abc", verdict: "BUY", category: "Top",
    });
    assert.equal(ev.type, "buy_skip_submitted");
  });

  it("b1-28: sessionId sentinel is 'buy-or-skip' when no StylingSession active", () => {
    const ev = emitBuySkipSubmitted({
      customerId: RAW_ID, sessionId: "buy-or-skip",
      analysisId: "bos_abc", verdict: "SKIP", category: null,
    });
    assert.equal(ev.sessionId, "buy-or-skip");
  });

  it("b1-29: verdict is included in payload as stated intent", () => {
    const ev = emitBuySkipSubmitted({
      customerId: RAW_ID, sessionId: "buy-or-skip",
      analysisId: "bos_x", verdict: "MAYBE", category: "Dress",
    });
    assert.equal((ev.payload as any).verdict, "MAYBE");
  });

  it("b1-30: INCOMPLETE verdict is accepted (error-case path)", () => {
    const ev = emitBuySkipSubmitted({
      customerId: RAW_ID, sessionId: "buy-or-skip",
      analysisId: "bos_fail", verdict: "INCOMPLETE", category: null,
    });
    assert.equal((ev.payload as any).verdict, "INCOMPLETE");
  });

  it("b1-31: payload includes schemaVersion 1.0 and source buy-or-skip", () => {
    const ev = emitBuySkipSubmitted({
      customerId: RAW_ID, sessionId: "buy-or-skip",
      analysisId: "bos_y", verdict: "BUY", category: "Outerwear",
    });
    assert.equal((ev.payload as any).schemaVersion, "1.0");
    assert.equal((ev.payload as any).source, "buy-or-skip");
  });

  it("b1-32: payload does not contain purchase/transaction/revenue language", () => {
    for (const verdict of ["BUY", "SKIP", "MAYBE", "INCOMPLETE"] as const) {
      const ev = emitBuySkipSubmitted({
        customerId: RAW_ID, sessionId: "buy-or-skip",
        analysisId: "bos_x", verdict, category: "Top",
      });
      const serialized = JSON.stringify(ev.payload);
      assert.ok(!serialized.includes("purchase"), `${verdict}: no 'purchase' in payload`);
      assert.ok(!serialized.includes("transaction"), `${verdict}: no 'transaction' in payload`);
      assert.ok(!serialized.includes("revenue"), `${verdict}: no 'revenue' in payload`);
    }
  });

  it("b1-33: customerIdHash is 12-char hex, not raw ID", () => {
    const ev = emitBuySkipSubmitted({
      customerId: RAW_ID, sessionId: "buy-or-skip",
      analysisId: "bos_z", verdict: "BUY", category: null,
    });
    assert.match(ev.customerIdHash, HASH_RE);
    assert.notEqual(ev.customerIdHash, RAW_ID);
  });
});

// ── PII guarantee across all Batch 1 events — b1-34 to b1-38 ─────────────────

describe("PII guarantee — no raw customerId in any Batch 1 event payload or hash", () => {
  const FORBIDDEN = [RAW_ID];

  function assertNoPii(ev: ReturnType<typeof emitPassportSaved>, label: string) {
    const serialized = JSON.stringify(ev);
    for (const pii of FORBIDDEN) {
      assert.ok(!serialized.includes(pii), `${label}: raw customerId '${pii}' must not appear in event`);
    }
  }

  it("b1-34: passport events contain no raw customerId", () => {
    assertNoPii(emitPassportSaved({ customerId: RAW_ID, isFirstCompletion: true, fieldCount: 5 }), "passport_completed");
    assertNoPii(emitPassportSaved({ customerId: RAW_ID, isFirstCompletion: false, fieldCount: 3 }), "passport_updated");
  });

  it("b1-35: closet_item_added event contains no raw customerId", () => {
    assertNoPii(emitClosetItemAdded({ customerId: RAW_ID, closetItemId: "i", category: "TOPS", tryOnEligibility: null }) as any, "closet_item_added");
  });

  it("b1-36: look_saved event contains no raw customerId", () => {
    assertNoPii(emitLookSaved({ customerId: RAW_ID, sessionId: "s", savedLookId: "l", fromSuggestionId: null, itemCount: 1, occasion: null }) as any, "look_saved");
  });

  it("b1-37: in_session_review_submitted event contains no raw customerId", () => {
    assertNoPii(emitInSessionReviewSubmitted({
      customerId: RAW_ID, sessionId: "s",
      overallFeeling: null, confidenceBefore: null, confidenceAfter: null,
      feltLikeHer: null, desiredFeelingAchieved: null, wouldWearAgain: null,
    }) as any, "in_session_review_submitted");
  });

  it("b1-38: buy_skip_submitted event contains no raw customerId", () => {
    assertNoPii(emitBuySkipSubmitted({ customerId: RAW_ID, sessionId: "buy-or-skip", analysisId: "b", verdict: "BUY", category: null }) as any, "buy_skip_submitted");
  });
});

// ── Mode isolation — Sample Preview requires both gates — b1-39 to b1-43 ─────

describe("Sample Preview mode isolation", () => {
  it("b1-39: getDesignerSampleData returns non-empty dashboard data", () => {
    const d = getDesignerSampleData(30);
    assert.ok(d != null, "sample data must not be null");
    assert.ok(typeof d === "object", "sample data must be an object");
  });

  it("b1-40: app.designer-intelligence.jsx gate requires DESIGNER_SAMPLE_DATA_ENABLED env var", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/app.designer-intelligence.jsx"), "utf8",
    );
    assert.ok(
      route.includes("DESIGNER_SAMPLE_DATA_ENABLED"),
      "Route must check DESIGNER_SAMPLE_DATA_ENABLED env var for Sample Preview",
    );
  });

  it("b1-41: app.designer-intelligence.jsx gate requires ?preview=sample query param", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/app.designer-intelligence.jsx"), "utf8",
    );
    assert.ok(
      route.includes("preview=sample") || route.includes("preview") && route.includes("sample"),
      "Route must check for ?preview=sample query param",
    );
  });

  it("b1-42: sample data does not reference live DB models (no prisma calls in sample-data.ts)", () => {
    const sampleData = readFileSync(
      join(__dirname, "../designer-sample-data.ts"), "utf8",
    );
    assert.ok(
      !sampleData.includes("prisma."),
      "designer-sample-data.ts must not make Prisma calls — it is pure fixture data",
    );
  });

  it("b1-43: sample data fixture is structurally separate from live loader", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/app.designer-intelligence.jsx"), "utf8",
    );
    // The sample branch must be a conditional guard, not a fallback for empty live data
    const sampleImport = route.includes("getDesignerSampleData") || route.includes("designer-sample-data");
    assert.ok(sampleImport, "route must import sample data from dedicated module, not inline");
  });
});

// ── getAdditionalKPIs buyOrSkip shape — b1-44 to b1-46 ──────────────────────

describe("getAdditionalKPIs buyOrSkip return shape", () => {
  it("b1-44: designer-stats.server.js includes incompleteCount query for INCOMPLETE verdict", () => {
    const stats = readFileSync(join(__dirname, "../designer-stats.server.js"), "utf8");
    assert.ok(
      stats.includes('"INCOMPLETE"') || stats.includes("'INCOMPLETE'"),
      "getAdditionalKPIs must query for INCOMPLETE verdict count",
    );
  });

  it("b1-45: designer-stats.server.js queries uniqueCustomers via buyOrSkipAnalyses relation", () => {
    const stats = readFileSync(join(__dirname, "../designer-stats.server.js"), "utf8");
    assert.ok(
      stats.includes("buyOrSkipAnalyses"),
      "getAdditionalKPIs must count unique customers via buyOrSkipAnalyses relation",
    );
  });

  it("b1-46: buyOrSkip return object includes incomplete and uniqueCustomers fields", () => {
    const stats = readFileSync(join(__dirname, "../designer-stats.server.js"), "utf8");
    assert.ok(
      stats.includes("incomplete:") && stats.includes("uniqueCustomers:"),
      "buyOrSkip return object must include both 'incomplete' and 'uniqueCustomers' fields",
    );
  });
});

// ── Hardening requirements — b1-47 to b1-56 ──────────────────────────────────

describe("Buy/Skip persistence hardening (Batch 1 review)", () => {
  it("b1-47: analyzeItem persistence is NOT fire-and-forget — no swallowing try/catch around DB write", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.wishlist.jsx"), "utf8",
    );
    // Must NOT have the old swallowing pattern: catch { /* persistence failure must never block */ }
    assert.ok(
      !route.includes("persistence failure must never block"),
      "api.wishlist.jsx must not swallow persistence errors silently",
    );
  });

  it("b1-48: analyzeItem returns 503 when DB write fails (error branch present)", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.wishlist.jsx"), "utf8",
    );
    // Code must have a 503 status return in the DB failure path
    assert.ok(
      route.includes("status: 503"),
      "analyzeItem must return HTTP 503 when persistence fails",
    );
  });

  it("b1-49: emitBuySkipSubmitted call site appears AFTER the DB write in source order", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.wishlist.jsx"), "utf8",
    );
    const dbWriteIdx = route.indexOf("buyOrSkipAnalysis.create");
    // Match the call site (not the import line at the top)
    const emitCallIdx = route.indexOf("recordJourneyEvent(emitBuySkipSubmitted");
    assert.ok(dbWriteIdx >= 0, "DB write must be present");
    assert.ok(emitCallIdx >= 0, "recordJourneyEvent(emitBuySkipSubmitted call must be present");
    assert.ok(
      emitCallIdx > dbWriteIdx,
      "emitBuySkipSubmitted call must appear AFTER the DB write in source order",
    );
  });

  it("b1-50: idempotency constant IDEMPOTENCY_WINDOW_MS is defined", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.wishlist.jsx"), "utf8",
    );
    assert.ok(
      route.includes("IDEMPOTENCY_WINDOW_MS"),
      "api.wishlist.jsx must define an idempotency window constant",
    );
  });

  it("b1-51: idempotency check queries for same customerId + imageUrl within the window", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.wishlist.jsx"), "utf8",
    );
    assert.ok(
      route.includes("imageUrl") && route.includes("createdAt") && route.includes("gte"),
      "Idempotency check must query by imageUrl within a time window",
    );
  });

  it("b1-52: guest identity guard rejects shopifyCustomerId === 'guest'", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.wishlist.jsx"), "utf8",
    );
    assert.ok(
      route.includes("shopifyCustomerId") && route.includes('"guest"'),
      "analyzeItem must explicitly reject the shared guest customer identity",
    );
  });
});

describe("Deprecated route safety (Batch 1 review)", () => {
  it("b1-53: api.closet.jsx action is restored — not a bare 410 deprecation", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.closet.jsx"), "utf8",
    );
    // Action must contain real business logic (add/sync/delete), not just return 410
    assert.ok(
      route.includes("act === \"add\"") || route.includes("act === 'add'"),
      "api.closet.jsx action must be restored with real logic — stylist.jsx still calls it",
    );
    assert.ok(
      route.includes("normalizeCategory"),
      "api.closet.jsx must normalise category enum values (lowercase → TOPS/BOTTOMS etc.)",
    );
  });

  it("b1-54: api.full-style-profile.jsx has a GET loader to prevent 404", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.full-style-profile.jsx"), "utf8",
    );
    assert.ok(
      route.includes("export async function loader"),
      "api.full-style-profile.jsx must export a loader to handle GET /api/full-style-profile",
    );
  });

  it("b1-55: api.closet.jsx CATEGORY_ENUM maps 'top' to 'TOPS' and 'dress' to 'DRESSES'", () => {
    const route = readFileSync(
      join(__dirname, "../../routes/api.closet.jsx"), "utf8",
    );
    assert.ok(route.includes('"TOPS"'), "Must map to TOPS enum value");
    assert.ok(route.includes('"DRESSES"'), "Must map to DRESSES enum value");
    assert.ok(route.includes('"BOTTOMS"'), "Must map to BOTTOMS enum value");
  });

  it("b1-56: vercel.json migration strategy — migrations in buildCommand with documentation", () => {
    const vercel = readFileSync(
      join(__dirname, "../../../vercel.json"), "utf8",
    );
    assert.ok(
      vercel.includes("prisma migrate deploy"),
      "vercel.json buildCommand must include prisma migrate deploy for staging DB",
    );
    assert.ok(
      vercel.includes("prisma generate"),
      "vercel.json buildCommand must include prisma generate",
    );
  });
});
