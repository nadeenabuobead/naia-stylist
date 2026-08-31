// app/lib/ai/closet-relationship.test.ts
// Tests FR25-FR28: garmentRelationships persistence contract (unit validation logic)
// Tests FR33-FR34: migration additive-only contract (SQL text verification)
// Tests FR35-FR36: Group 3B reanalysis isolation

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeGarmentRelationships,
  GARMENT_RELATIONSHIP_IDS,
  GARMENT_RELATIONSHIP_MAX,
  GARMENT_RELATIONSHIP_LABELS,
} from "./first-naia-read.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const closetSrc = readFileSync(
  join(__dirname, "../../routes/closet._index.tsx"),
  "utf8",
);

// ── FR25: add intent writes garmentRelationships ──────────────────────────────

describe("FR25 — normalizeGarmentRelationships: valid IDs accepted for add", () => {
  it("[] is valid (empty selection)", () => {
    const result = normalizeGarmentRelationships([]);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, []);
  });

  it("single valid ID accepted", () => {
    const result = normalizeGarmentRelationships(["favourite"]);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, ["favourite"]);
  });

  it("two valid IDs accepted", () => {
    const result = normalizeGarmentRelationships(["favourite", "wear-often"]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.length, 2);
  });

  it("all 8 known IDs are valid individually", () => {
    for (const id of GARMENT_RELATIONSHIP_IDS) {
      const result = normalizeGarmentRelationships([id]);
      assert.equal(result.ok, true, `ID ${id} should be valid`);
    }
  });
});

// ── FR26: edit intent writes garmentRelationships to all update paths ─────────

describe("FR26 — normalizeGarmentRelationships: valid for edit (same validator)", () => {
  it("clearing to [] is valid (user removes all)", () => {
    const result = normalizeGarmentRelationships([]);
    assert.equal(result.ok, true);
  });

  it("changing from 1 to 2 IDs is valid", () => {
    const result = normalizeGarmentRelationships(["unsure", "regret"]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.length, 2);
  });

  it("duplicates are deduplicated", () => {
    const result = normalizeGarmentRelationships(["favourite", "favourite"]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.length, 1);
  });
});

// ── FR27: invalid IDs rejected ────────────────────────────────────────────────

describe("FR27 — normalizeGarmentRelationships: invalid input rejected", () => {
  it("unknown ID rejected", () => {
    const result = normalizeGarmentRelationships(["unknown-id"]);
    assert.equal(result.ok, false);
  });

  it("non-array rejected", () => {
    const result = normalizeGarmentRelationships("favourite");
    assert.equal(result.ok, false);
  });

  it("null rejected", () => {
    const result = normalizeGarmentRelationships(null);
    assert.equal(result.ok, false);
  });

  it("object rejected", () => {
    const result = normalizeGarmentRelationships({});
    assert.equal(result.ok, false);
  });
});

// ── FR28: max 2 enforced ──────────────────────────────────────────────────────

describe("FR28 — normalizeGarmentRelationships: max 2 enforced", () => {
  it("GARMENT_RELATIONSHIP_MAX is 2", () => {
    assert.equal(GARMENT_RELATIONSHIP_MAX, 2);
  });

  it("3 valid IDs rejected with error", () => {
    const ids = [...GARMENT_RELATIONSHIP_IDS].slice(0, 3);
    const result = normalizeGarmentRelationships(ids);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Maximum/);
  });

  it("all 8 IDs rejected", () => {
    const ids = [...GARMENT_RELATIONSHIP_IDS];
    const result = normalizeGarmentRelationships(ids);
    assert.equal(result.ok, false);
  });
});

// ── FR33: migration is additive only (no DROP, no ALTER COLUMN type changes) ──

describe("FR33 — migration 20260830000000 is additive only", () => {
  const migrationPath = join(
    new URL(".", import.meta.url).pathname,
    "../../../prisma/migrations/20260830000000_first_naia_read/migration.sql",
  );

  let sql = "";
  try {
    sql = readFileSync(migrationPath, "utf8").toUpperCase();
  } catch {
    // file not found — test will fail below
  }

  it("migration file exists and is non-empty", () => {
    assert.ok(sql.length > 0, "migration.sql must exist and be non-empty");
  });

  it("no DROP TABLE statement", () => {
    assert.equal(sql.includes("DROP TABLE"), false, "migration must not drop any table");
  });

  it("no DROP COLUMN statement", () => {
    assert.equal(sql.includes("DROP COLUMN"), false, "migration must not drop any column");
  });

  it("no ALTER COLUMN ... TYPE statement", () => {
    // Postgres uses ALTER TABLE ... ALTER COLUMN ... TYPE to change a column's type
    assert.equal(sql.includes("ALTER COLUMN") && sql.includes("TYPE"), false,
      "migration must not change column types");
  });
});

// ── FR34: migration adds exactly the two expected objects ─────────────────────

describe("FR34 — migration adds ClosetItem.garmentRelationships + NaiaObservationFeedback", () => {
  const migrationPath = join(
    new URL(".", import.meta.url).pathname,
    "../../../prisma/migrations/20260830000000_first_naia_read/migration.sql",
  );

  let sql = "";
  try {
    sql = readFileSync(migrationPath, "utf8").toUpperCase();
  } catch {
    // handled below
  }

  it("adds garmentRelationships column to ClosetItem", () => {
    assert.ok(
      sql.includes("CLOSETITEM") && sql.includes("GARMENTRELATIONSHIPS"),
      "migration must add garmentRelationships to ClosetItem"
    );
  });

  it("creates NaiaObservationFeedback table", () => {
    assert.ok(
      sql.includes("CREATE TABLE") && sql.includes("NAIAOBSERVATIONFEEDBACK"),
      "migration must CREATE TABLE NaiaObservationFeedback"
    );
  });

  it("NaiaObservationFeedback has unique constraint on (customerId, observationKey)", () => {
    assert.ok(
      sql.includes("UNIQUE") && sql.includes("OBSERVATIONKEY"),
      "migration must add unique index on (customerId, observationKey)"
    );
  });

  it("GARMENT_RELATIONSHIP_LABELS covers all 8 known IDs", () => {
    assert.equal(Object.keys(GARMENT_RELATIONSHIP_LABELS).length, 8);
    for (const id of GARMENT_RELATIONSHIP_IDS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(GARMENT_RELATIONSHIP_LABELS, id),
        `GARMENT_RELATIONSHIP_LABELS must have label for ${id}`
      );
    }
  });
});

// ── FR35: relationship-only edit does NOT trigger Group 3B reanalysis ─────────

describe("FR35 — relationship-only edit must NOT trigger Group 3B reanalysis", () => {
  // The meta-only edit path has two branches:
  //   1. categoryChanged → sets analysisStatus: "pending" + calls analyzeClosetGarment
  //   2. !categoryChanged → simple update, no reanalysis
  //
  // We prove that the !categoryChanged branch (where only garmentRelationships changes)
  // does NOT include analysisStatus: "pending" or analyzeClosetGarment.

  it("non-category-change meta update does not set analysisStatus: pending", () => {
    const editIdx = closetSrc.indexOf('intent === "edit"');
    assert.ok(editIdx !== -1, "edit intent must exist");
    const block = closetSrc.slice(editIdx, editIdx + 4000);

    // Find the else branch of the categoryChanged check
    const categoryChangedIdx = block.indexOf("categoryChanged");
    assert.ok(categoryChangedIdx !== -1, "must have categoryChanged check");

    // The second update call (else branch) must not set analysisStatus
    const elseUpdateIdx = block.indexOf("} else {", categoryChangedIdx);
    assert.ok(elseUpdateIdx !== -1, "must have else branch for non-category change");
    const elseBlock = block.slice(elseUpdateIdx, elseUpdateIdx + 500);
    assert.ok(
      !elseBlock.includes("analysisStatus"),
      "non-category-change edit must not set analysisStatus",
    );
  });

  it("non-category-change meta update does not call analyzeClosetGarment", () => {
    const editIdx = closetSrc.indexOf('intent === "edit"');
    const block = closetSrc.slice(editIdx, editIdx + 4000);
    const categoryChangedIdx = block.indexOf("categoryChanged");
    const elseUpdateIdx = block.indexOf("} else {", categoryChangedIdx);
    const elseBlock = block.slice(elseUpdateIdx, elseUpdateIdx + 500);
    assert.ok(
      !elseBlock.includes("analyzeClosetGarment"),
      "non-category-change edit must not call analyzeClosetGarment",
    );
  });

  it("non-category-change update does not touch imagePublicId or imageFormat", () => {
    const editIdx = closetSrc.indexOf('intent === "edit"');
    const block = closetSrc.slice(editIdx, editIdx + 4000);
    const categoryChangedIdx = block.indexOf("categoryChanged");
    const elseUpdateIdx = block.indexOf("} else {", categoryChangedIdx);
    const elseBlock = block.slice(elseUpdateIdx, elseUpdateIdx + 500);
    assert.ok(!elseBlock.includes("imagePublicId"), "must not touch imagePublicId");
    assert.ok(!elseBlock.includes("imageFormat"),   "must not touch imageFormat");
  });
});

// ── FR36: relationship edit does not erase Group 3B intelligence fields ────────

describe("FR36 — relationship-only update does not include Group 3B intelligence fields", () => {
  const GROUP3B_FIELDS = [
    "silhouette",
    "fitProfile",
    "hemLength",
    "topLength",
    "sleeveLength",
    "necklineCoverage",
    "shoulderCoverage",
    "midriffExposed",
    "waistShape",
    "formality",
    "stylePersonality",
    "fieldConfidence",
    "analysisStatus",
    "analyzedAt",
    "analysisSchemaVersion",
  ];

  for (const field of GROUP3B_FIELDS) {
    it(`non-category-change else update data object does not set ${field}`, () => {
      const editIdx = closetSrc.indexOf('intent === "edit"');
      const block = closetSrc.slice(editIdx, editIdx + 4000);
      const categoryChangedIdx = block.indexOf("categoryChanged");
      const elseUpdateIdx = block.indexOf("} else {", categoryChangedIdx);
      // Narrow to just the data: { ... } object inside the else update
      const dataStart = block.indexOf("data: {", elseUpdateIdx);
      const dataEnd   = block.indexOf("},", dataStart);
      const dataBlock = block.slice(dataStart, dataEnd);
      assert.ok(
        !dataBlock.includes(field),
        `else update data must not include ${field}`,
      );
    });
  }
});
