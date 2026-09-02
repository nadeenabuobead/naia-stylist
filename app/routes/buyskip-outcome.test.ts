// app/routes/buyskip-outcome.test.ts
// Phase A — BuySkip V1 Outcome regression tests.
//
// Tests A–Y as specified in the Phase A contract.
// All tests are static source-read checks — no DB, no network, no LLM.
//
// Run: node --test --import tsx/esm app/routes/buyskip-outcome.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf8");
}

function readSchema(): string {
  return readSrc("../../prisma/schema.prisma");
}

function readWishlist(): string {
  return readSrc("api.wishlist.jsx");
}

function schemaBlock(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName}`);
  assert.ok(start !== -1, `model ${modelName} not found in schema`);
  const end = schema.indexOf("\n}", start) + 2;
  return schema.slice(start, end);
}

// ─── SCHEMA / MODEL (A–D) ────────────────────────────────────────────────────

describe("A — BuySkipOutcome model exists", () => {
  it("schema declares BuySkipOutcome model", () => {
    const schema = readSchema();
    assert.ok(
      schema.includes("model BuySkipOutcome"),
      "schema must contain 'model BuySkipOutcome'",
    );
  });

  it("BuySkipDecision enum exists with all three values", () => {
    const schema = readSchema();
    assert.ok(schema.includes("enum BuySkipDecision"), "BuySkipDecision enum required");
    assert.ok(schema.includes("BOUGHT_IT"), "BuySkipDecision must have BOUGHT_IT");
    assert.ok(schema.includes("DIDNT_BUY_IT"), "BuySkipDecision must have DIDNT_BUY_IT");
    assert.ok(schema.includes("STILL_DECIDING"), "BuySkipDecision must have STILL_DECIDING");
  });

  it("BuySkipPostOutcome enum exists with all three values", () => {
    const schema = readSchema();
    assert.ok(schema.includes("enum BuySkipPostOutcome"), "BuySkipPostOutcome enum required");
    assert.ok(schema.includes("LOVE_IT"), "BuySkipPostOutcome must have LOVE_IT");
    assert.ok(schema.includes("ITS_OKAY"), "BuySkipPostOutcome must have ITS_OKAY");
    assert.ok(schema.includes("RETURNED_IT"), "BuySkipPostOutcome must have RETURNED_IT");
  });

  it("BuySkipOutcome has decision and optional postPurchaseOutcome fields", () => {
    const schema = readSchema();
    const block = schemaBlock(schema, "BuySkipOutcome");
    assert.ok(block.includes("decision"), "BuySkipOutcome must have decision field");
    assert.ok(block.includes("BuySkipDecision"), "decision must use BuySkipDecision enum");
    assert.ok(block.includes("postPurchaseOutcome"), "BuySkipOutcome must have postPurchaseOutcome");
    assert.ok(block.includes("BuySkipPostOutcome?"), "postPurchaseOutcome must be optional");
  });
});

describe("B — analysisId is unique", () => {
  it("BuySkipOutcome.analysisId has @unique constraint", () => {
    const schema = readSchema();
    const block = schemaBlock(schema, "BuySkipOutcome");
    assert.ok(
      block.includes("analysisId") && block.includes("@unique"),
      "BuySkipOutcome.analysisId must be @unique",
    );
  });

  it("migration SQL creates unique index on analysisId", () => {
    const sql = readSrc("../../prisma/migrations/20260901120000_buyskip_outcome/migration.sql");
    assert.ok(
      sql.includes("UNIQUE INDEX") && sql.includes("analysisId"),
      "migration must create unique index on analysisId",
    );
  });
});

describe("C — one analysis can have at most one outcome", () => {
  it("BuyOrSkipAnalysis has BuySkipOutcome? (zero-or-one) back-relation", () => {
    const schema = readSchema();
    const block = schemaBlock(schema, "BuyOrSkipAnalysis");
    assert.ok(
      block.includes("outcome") && block.includes("BuySkipOutcome?"),
      "BuyOrSkipAnalysis must have 'outcome BuySkipOutcome?' relation",
    );
  });

  it("BuySkipOutcome has foreign key to BuyOrSkipAnalysis with CASCADE", () => {
    const schema = readSchema();
    const block = schemaBlock(schema, "BuySkipOutcome");
    assert.ok(block.includes("BuyOrSkipAnalysis"), "BuySkipOutcome must reference BuyOrSkipAnalysis");
    const sql = readSrc("../../prisma/migrations/20260901120000_buyskip_outcome/migration.sql");
    assert.ok(sql.includes("ON DELETE CASCADE"), "foreign key must CASCADE on delete");
  });
});

describe("D — customerId not duplicated onto BuySkipOutcome", () => {
  it("BuySkipOutcome model does not contain a customerId field", () => {
    const schema = readSchema();
    const block = schemaBlock(schema, "BuySkipOutcome");
    assert.ok(
      !block.includes("customerId"),
      "BuySkipOutcome must NOT duplicate customerId — ownership is through analysis",
    );
  });

  it("migration SQL does not add customerId column to BuySkipOutcome", () => {
    const sql = readSrc("../../prisma/migrations/20260901120000_buyskip_outcome/migration.sql");
    const table = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf(");", sql.indexOf("CREATE TABLE")) + 2);
    assert.ok(!table.includes("customerId"), "BuySkipOutcome table must not have customerId column");
  });
});

// ─── VALIDATION (E–L) ────────────────────────────────────────────────────────

describe("E — bought-it is a valid decision value", () => {
  it("api.wishlist DECISION_MAP contains bought-it → BOUGHT_IT", () => {
    const src = readWishlist();
    assert.ok(src.includes('"bought-it"') && src.includes("BOUGHT_IT"), "DECISION_MAP must map bought-it → BOUGHT_IT");
  });
});

describe("F — didnt-buy-it is a valid decision value", () => {
  it("api.wishlist DECISION_MAP contains didnt-buy-it → DIDNT_BUY_IT", () => {
    const src = readWishlist();
    assert.ok(src.includes('"didnt-buy-it"') && src.includes("DIDNT_BUY_IT"), "DECISION_MAP must map didnt-buy-it → DIDNT_BUY_IT");
  });
});

describe("G — still-deciding is a valid decision value", () => {
  it("api.wishlist DECISION_MAP contains still-deciding → STILL_DECIDING", () => {
    const src = readWishlist();
    assert.ok(src.includes('"still-deciding"') && src.includes("STILL_DECIDING"), "DECISION_MAP must map still-deciding → STILL_DECIDING");
  });
});

describe("H — love-it valid only with bought-it", () => {
  it("POST_OUTCOME_MAP contains love-it → LOVE_IT", () => {
    const src = readWishlist();
    assert.ok(src.includes('"love-it"') && src.includes("LOVE_IT"), "POST_OUTCOME_MAP must map love-it → LOVE_IT");
  });

  it("postPurchaseOutcome guard requires BOUGHT_IT decision", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("BOUGHT_IT") && src.includes("postPurchaseOutcome is only valid with decision"),
      "server must reject postPurchaseOutcome when decision is not BOUGHT_IT",
    );
  });
});

describe("I — its-okay valid only with bought-it", () => {
  it("POST_OUTCOME_MAP contains its-okay → ITS_OKAY", () => {
    const src = readWishlist();
    assert.ok(src.includes('"its-okay"') && src.includes("ITS_OKAY"), "POST_OUTCOME_MAP must map its-okay → ITS_OKAY");
  });
});

describe("J — returned-it valid only with bought-it", () => {
  it("POST_OUTCOME_MAP contains returned-it → RETURNED_IT", () => {
    const src = readWishlist();
    assert.ok(src.includes('"returned-it"') && src.includes("RETURNED_IT"), "POST_OUTCOME_MAP must map returned-it → RETURNED_IT");
  });
});

describe("K — invalid decision is rejected", () => {
  it("recordOutcome returns 400 when dbDecision is falsy", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("invalid_decision"),
      "server must return invalid_decision error for unknown decision values",
    );
    assert.ok(
      src.includes("status: 400") || src.includes("{ status: 400 }"),
      "invalid decision must return 400",
    );
  });
});

describe("L — invalid postPurchaseOutcome is rejected", () => {
  it("recordOutcome returns 400 when dbPostOutcome is falsy", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("invalid_post_outcome"),
      "server must return invalid_post_outcome error for unknown postPurchaseOutcome values",
    );
  });
});

// ─── UPSERT (M–O) ────────────────────────────────────────────────────────────

describe("M — first submission creates outcome", () => {
  it("recordOutcome uses prisma.buySkipOutcome.upsert with a create clause", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("buySkipOutcome.upsert"),
      "must use buySkipOutcome.upsert (not create/update separately)",
    );
    assert.ok(src.includes("create:"), "upsert must have a create clause");
  });
});

describe("N — second submission updates same outcome", () => {
  it("recordOutcome upsert has an update clause", () => {
    const src = readWishlist();
    assert.ok(src.includes("update:"), "upsert must have an update clause for repeat submissions");
  });
});

describe("O — duplicate row is not created", () => {
  it("upsert is keyed on analysisId (unique) — prevents duplicate rows", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("where:  { analysisId: analysis.id }") ||
      src.includes('where: { analysisId: analysis.id }'),
      "upsert where clause must key on analysisId",
    );
  });
});

// ─── OWNERSHIP (P–R) ─────────────────────────────────────────────────────────

describe("P — customer can update own analysis outcome", () => {
  it("recordOutcome loads analysis by id then checks customerId === naiaCustomer.id", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("analysis.customerId !== naiaCustomer.id"),
      "server must compare analysis.customerId with session-derived naiaCustomer.id",
    );
    assert.ok(
      src.includes("forbidden"),
      "mismatch must return forbidden (403)",
    );
  });
});

describe("Q — customer cannot update another customer's analysis", () => {
  it("ownership mismatch returns 403 forbidden", () => {
    const src = readWishlist();
    assert.ok(
      src.includes('"forbidden"') && src.includes("status: 403"),
      "cross-customer access must return 403 with error: forbidden",
    );
  });
});

describe("R — client-supplied ownership information is ignored", () => {
  it("recordOutcome does not read customerId from the request body", () => {
    const src = readWishlist();
    // The only destructure in recordOutcome must be { analysisId, decision, postPurchaseOutcome }
    // Verify customerId is NOT in the body destructure of recordOutcome.
    // Locate recordOutcome function text.
    const fnStart = src.indexOf("async function recordOutcome");
    assert.ok(fnStart !== -1, "recordOutcome function must exist");
    // Find the body destructure line within recordOutcome
    const destructurePos = src.indexOf("const { analysisId, decision, postPurchaseOutcome } = body", fnStart);
    assert.ok(
      destructurePos !== -1,
      "recordOutcome must destructure exactly { analysisId, decision, postPurchaseOutcome } from body — no customerId",
    );
  });

  it("naiaCustomer is obtained from getCurrentNaiaCustomer(request) before body is read", () => {
    const src = readWishlist();
    const fnStart = src.indexOf("async function recordOutcome");
    const authPos = src.indexOf("getCurrentNaiaCustomer(request)", fnStart);
    const bodyPos = src.indexOf("request.json()", fnStart);
    assert.ok(authPos < bodyPos, "auth check must appear before request.json() in recordOutcome");
  });
});

// ─── EVIDENCE CONTRACT (S–U) ──────────────────────────────────────────────────

describe("S — no outcome does not mutate Profile", () => {
  it("recordOutcome does not write to onboardingProfile or StyleProfile", () => {
    const src = readWishlist();
    const fnStart = src.indexOf("async function recordOutcome");
    const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
    const fnBody = fnEnd === -1 ? src.slice(fnStart) : src.slice(fnStart, fnEnd);
    assert.ok(!fnBody.includes("onboardingProfile"), "recordOutcome must not touch onboardingProfile");
    assert.ok(!fnBody.includes("styleProfile"), "recordOutcome must not touch styleProfile");
    assert.ok(!fnBody.includes("stylePersonalities"), "recordOutcome must not mutate style personality");
  });
});

describe("T — outcome does not mutate Passport fields", () => {
  it("recordOutcome does not write currentGoal, favoriteColors, fitPreferences, or silhouette", () => {
    const src = readWishlist();
    const fnStart = src.indexOf("async function recordOutcome");
    const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
    const fnBody = fnEnd === -1 ? src.slice(fnStart) : src.slice(fnStart, fnEnd);
    const forbidden = ["currentGoal", "favoriteColors", "avoidColors", "fitPreferences", "silhouette", "desiredFeelings"];
    for (const field of forbidden) {
      assert.ok(!fnBody.includes(field), `recordOutcome must not write Passport field: ${field}`);
    }
  });
});

describe("U — outcome does not mutate Closet relationships", () => {
  it("recordOutcome does not write to closetItems, wardrobeMatches, or hasSimilar", () => {
    const src = readWishlist();
    const fnStart = src.indexOf("async function recordOutcome");
    const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
    const fnBody = fnEnd === -1 ? src.slice(fnStart) : src.slice(fnStart, fnEnd);
    assert.ok(!fnBody.includes("closetItem"), "recordOutcome must not touch closetItems");
    assert.ok(!fnBody.includes("wardrobeMatch"), "recordOutcome must not touch wardrobeMatches");
    assert.ok(!fnBody.includes("hasSimilar"), "recordOutcome must not touch hasSimilar");
  });
});

// ─── CURRENT GOAL (V–Y) ──────────────────────────────────────────────────────

describe("V — currentGoal is included in Buy/Skip reasoning context", () => {
  it("analyzeItem reads styleProfile.currentGoal for prompt construction", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("currentGoal"),
      "api.wishlist must reference currentGoal",
    );
    assert.ok(
      src.includes("styleProfile?.currentGoal") || src.includes("styleProfile.currentGoal"),
      "currentGoal must be read from styleProfile (session-loaded) not from request body",
    );
  });

  it("prompt includes CURRENT FOCUS section when goals are set", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("CURRENT FOCUS"),
      "prompt must contain a CURRENT FOCUS section",
    );
  });

  it("all 9 non-exclusive currentGoal IDs are mapped", () => {
    const src = readWishlist();
    const EXPECTED_IDS = [
      "understand-my-style",
      "feel-more-like-myself",
      "use-what-i-own",
      "easier-getting-dressed",
      "stop-regret-purchases",
      "more-cohesive-wardrobe",
      "dress-for-my-life",
      "refresh-my-style",
      "specific-event-trip-change",
    ];
    for (const id of EXPECTED_IDS) {
      assert.ok(src.includes(`"${id}"`), `CURRENT_GOAL_CONTEXT must map id: ${id}`);
    }
  });
});

describe("W — currentGoal is framed as Current Focus, not identity", () => {
  it("prompt section is labeled CURRENT FOCUS, not style identity or personality", () => {
    const src = readWishlist();
    assert.ok(src.includes("CURRENT FOCUS"), "section label must be CURRENT FOCUS");
    // The section must appear inside the analyzeItem prompt, not in recordOutcome
    const analyzeStart = src.indexOf("async function analyzeItem");
    const promptStart = src.indexOf("CURRENT FOCUS", analyzeStart);
    assert.ok(promptStart !== -1, "CURRENT FOCUS must appear inside analyzeItem prompt");
  });

  it("not-sure-yet is filtered out and never sent to the prompt", () => {
    const src = readWishlist();
    assert.ok(
      src.includes('"not-sure-yet"'),
      "code must reference not-sure-yet for filtering",
    );
    // The filter must exclude it — verified by the filter line
    assert.ok(
      src.includes('id !== "not-sure-yet"'),
      "not-sure-yet must be filtered out before building the goal context string",
    );
  });
});

describe("X — currentGoal does not become a hard BUY/SKIP rule", () => {
  it("CURRENT FOCUS prompt block includes explicit no-override instruction", () => {
    const src = readWishlist();
    assert.ok(
      src.includes("Do NOT use CURRENT FOCUS to generate an automatic BUY or SKIP"),
      "prompt must explicitly state that CURRENT FOCUS cannot generate an automatic verdict",
    );
  });

  it("no rule maps a single currentGoal ID directly to a verdict", () => {
    const src = readWishlist();
    // Verify that CURRENT_GOAL_CONTEXT does not contain "BUY" or "SKIP" as values
    const ctxStart = src.indexOf("CURRENT_GOAL_CONTEXT");
    const ctxEnd = src.indexOf("};", ctxStart) + 2;
    const ctxBlock = src.slice(ctxStart, ctxEnd);
    assert.ok(!ctxBlock.includes(": \"BUY\""), "goal context values must not map to BUY");
    assert.ok(!ctxBlock.includes(": \"SKIP\""), "goal context values must not map to SKIP");
  });
});

describe("Y — First Read remains unchanged", () => {
  it("first-naia-read.ts records currentGoal as intentionally EXCLUDED (not used as input)", () => {
    const firstRead = readSrc("../lib/ai/first-naia-read.ts");
    // The existing pre-Phase-A comment explicitly marks currentGoal as excluded from First Read.
    // Phase A must not change this: currentGoal is mutable session context, not stable style identity.
    assert.ok(
      firstRead.includes("EXCLUDED") && firstRead.includes("currentGoal"),
      "first-naia-read must preserve the comment marking currentGoal as intentionally EXCLUDED",
    );
  });

  it("first-naia-read.ts does not use currentGoal as a prompt input field", () => {
    const firstRead = readSrc("../lib/ai/first-naia-read.ts");
    // currentGoal may appear in a comment (the exclusion annotation) but must not appear
    // in any data fetch, select clause, or prompt template string.
    const lines = firstRead.split("\n");
    const usageLines = lines.filter(l => {
      const trimmed = l.trim();
      return trimmed.includes("currentGoal") && !trimmed.startsWith("//") && !trimmed.startsWith("*");
    });
    assert.equal(
      usageLines.length,
      0,
      `first-naia-read must not use currentGoal in executable code. Found in: ${usageLines.join(" | ")}`,
    );
  });
});
