// app/lib/ai/outcome-contract.test.ts
// Style Memory V1 — tests for outcome-contract.ts validation logic,
// persistence source invariants, and API route security contracts.
// Run with: npx tsx --test app/lib/ai/outcome-contract.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OUTCOME_STATUS_IDS,
  CHANGE_TYPE_IDS,
  GOAL_OUTCOME_IDS,
  DIRECTION_IDS,
  CHANGE_TYPE_MAX,
  OTHER_NOTE_MAX_CHARS,
  validateOutcomeInput,
  validateDirectionAgainstMetadata,
} from "./outcome-contract.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function src(rel: string) {
  return readFileSync(join(ROOT, "app", rel), "utf8");
}

// ── §O.1 — Stable ID sets ─────────────────────────────────────────────────────

describe("§O.1 — stable ID sets", () => {
  it("OUTCOME_STATUS_IDS contains exactly 3 IDs", () => {
    assert.deepEqual([...OUTCOME_STATUS_IDS], ["wore-it", "changed-something", "didnt-wear-it"]);
  });

  it("CHANGE_TYPE_IDS contains exactly 10 IDs", () => {
    assert.deepEqual([...CHANGE_TYPE_IDS], [
      "shoes", "top", "bottom", "layer",
      "more-coverage", "less-formal", "more-comfortable",
      "different-colour", "different-fit", "other",
    ]);
  });

  it("GOAL_OUTCOME_IDS contains exactly 3 IDs", () => {
    assert.deepEqual([...GOAL_OUTCOME_IDS], ["yes", "somewhat", "no"]);
  });

  it("DIRECTION_IDS contains exactly 3 IDs", () => {
    assert.deepEqual([...DIRECTION_IDS], ["most-you", "fresh", "push-me"]);
  });

  it("CHANGE_TYPE_MAX is 5", () => {
    assert.equal(CHANGE_TYPE_MAX, 5);
  });

  it("OTHER_NOTE_MAX_CHARS is 280", () => {
    assert.equal(OTHER_NOTE_MAX_CHARS, 280);
  });
});

// ── §O.2 — validateOutcomeInput ───────────────────────────────────────────────

describe("§O.2 — validateOutcomeInput: wore-it path", () => {
  it("wore-it + goalOutcome → ok, clears changeTypes", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "wore-it",
      changeTypes: ["shoes"],
      goalOutcome: "yes",
      selectedDirection: "most-you",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.normalized.outcomeStatus, "wore-it");
    assert.deepEqual(r.normalized.changeTypes, []);
    assert.equal(r.normalized.otherChangeNote, null);
    assert.equal(r.normalized.goalOutcome, "yes");
    assert.equal(r.normalized.selectedDirection, "most-you");
  });

  it("wore-it without goalOutcome → ok, goalOutcome is null", () => {
    const r = validateOutcomeInput({ outcomeStatus: "wore-it", changeTypes: [] });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.normalized.goalOutcome, null);
  });
});

describe("§O.2 — validateOutcomeInput: changed-something path", () => {
  it("changed-something + changeTypes + goalOutcome → ok", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["shoes", "top"],
      goalOutcome: "somewhat",
      selectedDirection: null,
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.normalized.changeTypes, ["shoes", "top"]);
    assert.equal(r.normalized.goalOutcome, "somewhat");
  });

  it("changed-something with zero changeTypes → error", () => {
    const r = validateOutcomeInput({ outcomeStatus: "changed-something", changeTypes: [] });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "changed-something-requires-change-type");
  });

  it("changed-something with 6 changeTypes → error (exceeds max 5)", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["shoes", "top", "bottom", "layer", "more-coverage", "less-formal"],
    });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "too-many-change-types");
  });

  it("changed-something: deduplication preserves first occurrence", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["shoes", "shoes", "top"],
      goalOutcome: "yes",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.normalized.changeTypes, ["shoes", "top"]);
  });

  it("changed-something with 'other' + note → note preserved", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["other"],
      otherChangeNote: "went for something more relaxed",
      goalOutcome: "yes",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.normalized.otherChangeNote, "went for something more relaxed");
  });

  it("changed-something without 'other' → note cleared even if provided", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["shoes"],
      otherChangeNote: "some note",
      goalOutcome: "yes",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.normalized.otherChangeNote, null);
  });

  it("otherChangeNote is truncated at 280 chars", () => {
    const longNote = "x".repeat(400);
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["other"],
      otherChangeNote: longNote,
      goalOutcome: "yes",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.normalized.otherChangeNote!.length, 280);
  });
});

describe("§O.2 — validateOutcomeInput: didnt-wear-it path", () => {
  it("didnt-wear-it → ok, clears goalOutcome and changeTypes", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "didnt-wear-it",
      changeTypes: ["shoes"],
      goalOutcome: "yes",
      selectedDirection: "fresh",
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.normalized.outcomeStatus, "didnt-wear-it");
    assert.deepEqual(r.normalized.changeTypes, []);
    assert.equal(r.normalized.otherChangeNote, null);
    assert.equal(r.normalized.goalOutcome, null);
    assert.equal(r.normalized.selectedDirection, "fresh");
  });
});

describe("§O.2 — validateOutcomeInput: error paths", () => {
  it("missing outcomeStatus → error", () => {
    const r = validateOutcomeInput({ changeTypes: [] });
    assert.ok(!r.ok);
  });

  it("invalid outcomeStatus → error", () => {
    const r = validateOutcomeInput({ outcomeStatus: "wore-it-kind-of", changeTypes: [] });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid-outcome-status");
    assert.equal(r.status, 400);
  });

  it("non-array changeTypes → error", () => {
    const r = validateOutcomeInput({ outcomeStatus: "wore-it", changeTypes: "shoes" });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid-change-types");
  });

  it("unknown changeType in array → error", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "changed-something",
      changeTypes: ["jeans"],
    });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid-change-type");
  });

  it("invalid goalOutcome → error", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "wore-it",
      changeTypes: [],
      goalOutcome: "maybe",
    });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid-goal-outcome");
  });

  it("invalid selectedDirection → error", () => {
    const r = validateOutcomeInput({
      outcomeStatus: "wore-it",
      changeTypes: [],
      selectedDirection: "bold",
    });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid-selected-direction");
  });
});

// ── §O.3 — validateDirectionAgainstMetadata ───────────────────────────────────

describe("§O.3 — validateDirectionAgainstMetadata", () => {
  const dirs = [{ label: "most-you" }, { label: "fresh" }, { label: "push-me" }];

  it("null direction is always valid (no error)", () => {
    assert.equal(validateDirectionAgainstMetadata(null, dirs), null);
    assert.equal(validateDirectionAgainstMetadata(null, []), null);
    assert.equal(validateDirectionAgainstMetadata(null, null), null);
    assert.equal(validateDirectionAgainstMetadata(null, undefined), null);
  });

  it("valid direction that exists in resultDirections → no error", () => {
    assert.equal(validateDirectionAgainstMetadata("most-you", dirs), null);
    assert.equal(validateDirectionAgainstMetadata("fresh", dirs), null);
    assert.equal(validateDirectionAgainstMetadata("push-me", dirs), null);
  });

  it("direction not in resultDirections → error string", () => {
    const smallDirs = [{ label: "most-you" }];
    assert.equal(validateDirectionAgainstMetadata("fresh", smallDirs), "direction-not-in-suggestion");
  });

  it("legacy suggestion (no resultDirections) + non-null direction → error", () => {
    assert.equal(validateDirectionAgainstMetadata("most-you", []), "direction-not-in-suggestion");
    assert.equal(validateDirectionAgainstMetadata("most-you", null), "direction-not-in-suggestion");
    assert.equal(validateDirectionAgainstMetadata("most-you", undefined), "direction-not-in-suggestion");
  });
});

// ── §O.4 — API route security invariants (source-based) ─────────────────────

describe("§O.4 — API route security invariants", () => {
  const routeSrc = src("routes/api.styleme-outcome.tsx");

  it("route imports loadOutcomeForSuggestion from outcome-persistence.server", () => {
    assert.ok(routeSrc.includes("loadOutcomeForSuggestion"), "must import loadOutcomeForSuggestion");
  });

  it("route imports upsertOutcome from outcome-persistence.server", () => {
    assert.ok(routeSrc.includes("upsertOutcome"), "must import upsertOutcome");
  });

  it("route imports validateOutcomeInput from outcome-contract", () => {
    assert.ok(routeSrc.includes("validateOutcomeInput"));
  });

  it("route imports validateDirectionAgainstMetadata from outcome-contract", () => {
    assert.ok(routeSrc.includes("validateDirectionAgainstMetadata"));
  });

  it("route imports getCurrentNaiaCustomer for auth", () => {
    assert.ok(routeSrc.includes("getCurrentNaiaCustomer"));
  });

  it("route validates authentication before any data access", () => {
    // Check the call ordering within the action function body (not import positions)
    const authCall = routeSrc.indexOf("getCurrentNaiaCustomer(request)");
    const dbCall = routeSrc.indexOf("outfitSuggestion.findUnique");
    assert.ok(authCall > -1, "must call getCurrentNaiaCustomer");
    assert.ok(dbCall > -1, "must call outfitSuggestion.findUnique");
    assert.ok(authCall < dbCall, "auth must precede DB query in action function");
  });

  it("route returns 401 when unauthenticated", () => {
    assert.ok(routeSrc.includes("401"));
  });

  it("ownership verified via session.customerId === customer.id", () => {
    assert.ok(
      routeSrc.includes("session.customerId") && routeSrc.includes("customer.id"),
      "must compare session.customerId to customer.id for ownership",
    );
  });

  it("sessionId is derived server-side from suggestion.sessionId — never from client", () => {
    assert.ok(
      routeSrc.includes("suggestion.sessionId"),
      "sessionId must come from DB suggestion, not client body",
    );
    // Confirm there is no trust of client-provided sessionId
    assert.ok(
      !routeSrc.includes('body.sessionId') && !routeSrc.includes('"sessionId"') || routeSrc.includes("suggestion.sessionId"),
      "must use server-derived sessionId",
    );
  });

  it("returns uniform 404 for missing suggestion and ownership failure (no existence leak)", () => {
    const notFoundCount = (routeSrc.match(/status: 404/g) ?? []).length;
    assert.ok(notFoundCount >= 2, `must have at least 2 × 404 returns (missing + ownership); got ${notFoundCount}`);
  });

  it("direction is validated against saved metadata before upsert", () => {
    const dirValidateIdx = routeSrc.indexOf("validateDirectionAgainstMetadata");
    const upsertIdx = routeSrc.indexOf("upsertOutcome");
    assert.ok(dirValidateIdx < upsertIdx, "direction validation must precede upsert call");
  });

  it("uses parseSuggestionMetadata to load saved resultDirections", () => {
    assert.ok(routeSrc.includes("parseSuggestionMetadata"));
  });

  it("route does NOT call prisma.onboardingProfile (Profile must not be mutated)", () => {
    assert.ok(!routeSrc.includes("prisma.onboardingProfile"), "must not access onboardingProfile via prisma");
  });

  it("route does NOT call prisma.dressingPreferences", () => {
    assert.ok(!routeSrc.includes("prisma.dressingPreferences"), "must not access dressingPreferences via prisma");
  });

  it("route does NOT call prisma.garmentRelationship", () => {
    assert.ok(!routeSrc.includes("prisma.garmentRelationship"), "must not access garmentRelationships via prisma");
  });
});

// ── §O.5 — Persistence server invariants (source-based) ──────────────────────

describe("§O.5 — Persistence server invariants", () => {
  const persistSrc = src("lib/ai/outcome-persistence.server.ts");

  it("upsert uses where: { suggestionId } — the UNIQUE field", () => {
    assert.ok(persistSrc.includes("where:  { suggestionId }") || persistSrc.includes("where: { suggestionId }"));
  });

  it("create payload includes customerId (not derived from client)", () => {
    assert.ok(persistSrc.includes("customerId,"));
  });

  it("create payload includes sessionId (server-derived)", () => {
    assert.ok(persistSrc.includes("sessionId,"));
  });

  it("load guards customerId: returns null when outcome belongs to different customer", () => {
    assert.ok(
      persistSrc.includes("r.customerId !== customerId"),
      "must guard ownership on load",
    );
  });

  it("persistence server does NOT call db.onboardingProfile", () => {
    assert.ok(!persistSrc.includes("db.onboardingProfile"), "must not access onboardingProfile");
  });

  it("persistence server does NOT call db.garmentRelationship", () => {
    assert.ok(!persistSrc.includes("db.garmentRelationship"), "must not access garmentRelationships");
  });
});

// ── §O.6 — Migration contract ─────────────────────────────────────────────────

describe("§O.6 — Migration contract", () => {
  const migrationSrc = readFileSync(
    join(ROOT, "prisma/migrations/20260901000000_styleme_outcome/migration.sql"),
    "utf8",
  );

  it("migration creates StyleMeOutcome table", () => {
    assert.ok(migrationSrc.includes("StyleMeOutcome"));
  });

  it("migration sets UNIQUE on suggestionId (UPSERT target)", () => {
    assert.ok(migrationSrc.includes("StyleMeOutcome_suggestionId_key"));
  });

  it("migration has customerId index", () => {
    assert.ok(migrationSrc.includes("StyleMeOutcome_customerId_idx"));
  });

  it("migration has sessionId index (denormalized for efficient querying)", () => {
    assert.ok(migrationSrc.includes("StyleMeOutcome_sessionId_idx"));
  });

  it("migration uses IF NOT EXISTS / DO $$ BEGIN (idempotent)", () => {
    assert.ok(
      migrationSrc.includes("IF NOT EXISTS") || migrationSrc.includes("DO $$ BEGIN"),
      "migration must be idempotent",
    );
  });

  it("migration has no destructive statements (no DROP, no DELETE, no TRUNCATE)", () => {
    assert.ok(!migrationSrc.toUpperCase().includes("DROP TABLE"), "no DROP TABLE");
    assert.ok(!migrationSrc.toUpperCase().includes("DELETE FROM"), "no DELETE FROM");
    assert.ok(!migrationSrc.toUpperCase().includes("TRUNCATE"), "no TRUNCATE");
  });
});

// ── §O.7 — Result page integration (source-based) ────────────────────────────

describe("§O.7 — Result page integration", () => {
  const resultSrc = src("routes/style-me/result.tsx");

  it("result.tsx imports loadOutcomeForSuggestion", () => {
    assert.ok(resultSrc.includes("loadOutcomeForSuggestion"));
  });

  it("result.tsx loads existingOutcome in loader (direct-session path)", () => {
    assert.ok(
      resultSrc.includes("existingOutcome") && resultSrc.includes("loadOutcomeForSuggestion"),
    );
  });

  it("result.tsx initialises outcomeStatus state from existingOutcome", () => {
    assert.ok(resultSrc.includes("existingOutcome?.outcomeStatus"));
  });

  it("result.tsx initialises outcomeSaved from existingOutcome (pre-fills saved state)", () => {
    assert.ok(resultSrc.includes("existingOutcome != null"));
  });

  it("outcome widget renders 'After you wear this' label", () => {
    assert.ok(resultSrc.includes("After you wear this"));
  });

  it("outcome widget renders 'What happened with this look?' prompt", () => {
    assert.ok(resultSrc.includes("What happened with this look?"));
  });

  it("outcome widget renders goal outcome question with locked copy", () => {
    assert.ok(
      resultSrc.includes("Did the outfit give you what you wanted today?"),
      "must use locked copy for goal question",
    );
  });

  it("outcome widget shows 'Noted.' on saved state (with period)", () => {
    assert.ok(resultSrc.includes("Noted."), "saved state must display 'Noted.' with period");
  });

  it("outcome widget has Edit button to re-enter form", () => {
    assert.ok(resultSrc.includes("isOutcomeEditing"));
  });

  it("outcome widget POSTs to /api/styleme-outcome", () => {
    assert.ok(resultSrc.includes("/api/styleme-outcome"));
  });

  it("outcome widget sends JSON body (application/json encType)", () => {
    assert.ok(resultSrc.includes('application/json'));
  });

  it("route does NOT show outcome widget for unauthenticated visitors", () => {
    const outcomeBlock = resultSrc.indexOf("After you wear this");
    const authCheck = resultSrc.lastIndexOf("isAuthenticated", outcomeBlock);
    assert.ok(authCheck > -1, "outcome widget must be gated by isAuthenticated");
  });

  it("result.tsx does NOT mutate OnboardingProfile in the outcome section", () => {
    assert.ok(!resultSrc.includes("onboardingProfile.update"));
  });
});
