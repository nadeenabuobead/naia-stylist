// app/lib/ai/naia-catalog.test.ts
// 25 validation tests for the nAia product catalog (Phase 3B).
// Runner: node:test (Node 18+). No extra test packages required.
// Run: node --import tsx/esm --test app/lib/ai/naia-catalog.test.ts

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  PRODUCT_ELIGIBILITY,
  PROVISIONAL_EVIDENCE,
  BPE_ALIAS_MAP,
  PSM_SUPPLEMENTAL_PRODUCT_TOKENS,
} from "./signal-contract.js";
import {
  getAllCatalogProducts,
  getProductByHandle,
  getRecommendationEligibleProducts,
  catalog,
} from "./naia-catalog.js";
import { NADINE_WORKBOOK_MANIFEST } from "../../../scripts/nadine-workbook.manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GENERATED_PATH = resolve(
  __dirname,
  "generated/naia-catalog.generated.ts",
);
// Sourced from scripts/nadine-workbook.manifest.ts — the single committed pin.
// Do not hardcode a copy of the SHA here; update the manifest instead.
const V8_SHA256 = NADINE_WORKBOOK_MANIFEST.approvedSha256;
const V8_PATH = resolve(
  __dirname,
  "../../../.claude/reference/styleme/PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx",
);

const EXPECTED_HANDLES = new Set([
  "double-top",
  "collar-shirt",
  "asymmetrical-pants",
  "draped-leather-pants",
  "suede-skirt",
  "trench-coat",
  "kimono-jacket",
  "leather-suede-jacket",
  "oversized-blazer",
  "midi-dress",
  "dress-set",
]);

const CANONICAL_54_KEYS = [
  "verifiedTitle", "handle", "liveUrl", "featuredImageUrl", "itemType",
  "styleableComponents", "colors", "silhouette", "fit", "fabric",
  "activePublished", "artStoryDescription", "stylingRole",
  "desiredFeelingMatch", "stylePersonalityMatch", "styleTags",
  "occasionTags", "productStyleDescriptors", "formalityScore",
  "formalityDescription", "season", "bodyFitLogic",
  "bodyProportionEffects", "styleMeComfortMatch", "coverageModesty",
  "proportionRule", "notIdealFor", "currentEmotionalStateSupport",
  "emotionalSupportLogic", "practicalSupportMatch", "practicalSupportLogic",
  "stylingEffortLevel", "bestPairedWithNadinePieces",
  "conditionalNadinePairings", "avoidPairingWithNadinePieces",
  "bestPairedWithGeneral", "avoidPairingWithGeneral", "pairingReason",
  "accessoriesDirection", "shoeDirection", "colorDirection",
  "skinToneColourHarmony", "complexionStylingNote", "hairStylingDirection",
  "hairStylingNote", "styleMeExplanation",
  // Dressing metadata — added V8 Rev 3 (Group 2 / Rev 5 spec)
  "modestySafe", "abayaCompatible", "hijabCompatible",
  "sleeveLength", "necklineCoverage", "hemLength", "topLength", "fitProfile",
] as const;

const VALID_ITEM_TYPES = new Set(["TOP", "BOTTOM", "OUTERWEAR", "DRESS", "SET"]);
const VALID_EFFORT = new Set(["low", "medium", "high"]);

describe("nAia catalog — Phase 3B validation", () => {
  const products = getAllCatalogProducts();

  // ── 1. Exactly 11 products ──────────────────────────────────────────────
  test("1. exactly 11 products", () => {
    assert.equal(products.length, 11);
  });

  // ── 2. Exact V8 source SHA-256 in catalog metadata ─────────────────────
  test("2. V8 source SHA-256 in catalog metadata", () => {
    assert.equal(catalog.sourceSha256, V8_SHA256);
  });

  // ── 3. Exactly 54 source fields per product (46 original + 8 dressing) ──
  test("3. exactly 54 source fields per product", () => {
    for (const p of products) {
      const count = Object.keys(p.sourceFields).length;
      assert.equal(count, 54, `${p.handle}: expected 54 sourceFields, got ${count}`);
    }
  });

  // ── 4. Exact canonical 54-key set in every product ─────────────────────
  test("4. exact canonical 54-key set in sourceFields", () => {
    for (const p of products) {
      const keys = new Set(Object.keys(p.sourceFields));
      for (const k of CANONICAL_54_KEYS) {
        assert.ok(keys.has(k), `${p.handle}: missing sourceField '${k}'`);
      }
      assert.equal(keys.size, 54, `${p.handle}: unexpected extra keys`);
    }
  });

  // ── 5. Unique handles ───────────────────────────────────────────────────
  test("5. unique handles", () => {
    const seen = new Set<string>();
    for (const p of products) {
      assert.ok(!seen.has(p.handle), `Duplicate handle: ${p.handle}`);
      seen.add(p.handle);
    }
  });

  // ── 6. Unique normalized titles ─────────────────────────────────────────
  test("6. unique normalized titles", () => {
    const seen = new Set<string>();
    for (const p of products) {
      const t = p.parsed.identity.verifiedTitle.toLowerCase().trim();
      assert.ok(!seen.has(t), `Duplicate title: ${t}`);
      seen.add(t);
    }
  });

  // ── 7. No leading/trailing whitespace in generated titles or handles ───
  test("7. no leading/trailing whitespace in titles or root handles", () => {
    for (const p of products) {
      assert.equal(p.handle, p.handle.trim(), `handle not trimmed: ${JSON.stringify(p.handle)}`);
      const t = p.parsed.identity.verifiedTitle;
      assert.equal(t, t.trim(), `${p.handle}: title not trimmed: ${JSON.stringify(t)}`);
    }
  });

  // ── 8. All item types valid ─────────────────────────────────────────────
  test("8. all item types valid", () => {
    for (const p of products) {
      assert.ok(
        VALID_ITEM_TYPES.has(p.parsed.identity.itemType),
        `${p.handle}: invalid itemType '${p.parsed.identity.itemType}'`,
      );
    }
  });

  // ── 9. All styling-effort values valid ──────────────────────────────────
  test("9. all styling-effort values valid", () => {
    for (const p of products) {
      assert.ok(
        VALID_EFFORT.has(p.parsed.scalars.stylingEffortLevel),
        `${p.handle}: invalid stylingEffortLevel '${p.parsed.scalars.stylingEffortLevel}'`,
      );
    }
  });

  // ── 10. All formality scores are finite numbers ─────────────────────────
  test("10. formality scores are finite numbers", () => {
    for (const p of products) {
      const s = p.parsed.scalars.formalityScore;
      assert.ok(typeof s === "number" && isFinite(s), `${p.handle}: invalid formalityScore ${s}`);
    }
  });

  // ── 11. All 11 products remain unverified ──────────────────────────────
  test("11. all 11 products are unverified", () => {
    for (const p of products) {
      assert.equal(p.eligibility, "unverified", `${p.handle}: unexpected eligibility '${p.eligibility}'`);
    }
  });

  // ── 12. All V8 handles align with PRODUCT_ELIGIBILITY ─────────────────
  test("12. V8 handles align with PRODUCT_ELIGIBILITY", () => {
    for (const p of products) {
      assert.ok(
        p.handle in PRODUCT_ELIGIBILITY,
        `${p.handle}: not in PRODUCT_ELIGIBILITY`,
      );
      assert.equal(
        p.eligibility,
        PRODUCT_ELIGIBILITY[p.handle],
        `${p.handle}: eligibility mismatch`,
      );
    }
  });

  // ── 13. No orphan eligibility handles ─────────────────────────────────
  test("13. no orphan handles in PRODUCT_ELIGIBILITY", () => {
    const catalogHandles = new Set(products.map((p) => p.handle));
    for (const handle of Object.keys(PRODUCT_ELIGIBILITY)) {
      assert.ok(
        catalogHandles.has(handle),
        `PRODUCT_ELIGIBILITY handle '${handle}' not in catalog`,
      );
    }
  });

  // ── 14. Canonical array fields are arrays ──────────────────────────────
  test("14. canonical ranking fields are arrays", () => {
    const rankingKeys = [
      "desiredFeelingMatch", "stylePersonalityMatch", "styleTags",
      "occasionTags", "season", "bodyProportionEffects",
      "styleMeComfortMatch", "currentEmotionalStateSupport",
      "practicalSupportMatch",
    ] as const;
    for (const p of products) {
      for (const k of rankingKeys) {
        const val = p.parsed.rankings[k];
        assert.ok(Array.isArray(val), `${p.handle}.${k} is not an array`);
        assert.ok(val.length > 0, `${p.handle}.${k} is empty`);
      }
    }
  });

  // ── 15. Canonical arrays contain no duplicates ─────────────────────────
  test("15. canonical arrays contain no duplicates", () => {
    const rankingKeys = [
      "desiredFeelingMatch", "stylePersonalityMatch", "styleTags",
      "occasionTags", "season", "bodyProportionEffects",
      "styleMeComfortMatch", "currentEmotionalStateSupport",
      "practicalSupportMatch",
    ] as const;
    for (const p of products) {
      for (const k of rankingKeys) {
        const arr = p.parsed.rankings[k];
        const unique = new Set(arr);
        assert.equal(
          unique.size,
          arr.length,
          `${p.handle}.${k} contains duplicates: ${arr.join(", ")}`,
        );
      }
    }
  });

  // ── 16. Signal-contract vocabulary validation ──────────────────────────
  test("16. stylingEffortLevel values are contract-aligned", () => {
    // STYLING_EFFORT_RULE.direction defines the three valid values.
    for (const p of products) {
      const el = p.parsed.scalars.stylingEffortLevel;
      assert.ok(["low", "medium", "high"].includes(el));
    }
  });

  // ── 17. BPE aliases normalize correctly ────────────────────────────────
  test("17. BPE alias tokens in bodyProportionEffects are recognized by BPE_ALIAS_MAP", () => {
    // Any token that IS a key in BPE_ALIAS_MAP must resolve; tokens not in the map are pass-through.
    for (const p of products) {
      for (const token of p.parsed.rankings.bodyProportionEffects) {
        if (token in BPE_ALIAS_MAP) {
          const resolved = BPE_ALIAS_MAP[token];
          assert.ok(
            resolved.length > 0,
            `${p.handle}: BPE alias '${token}' resolves to empty array`,
          );
        }
      }
    }
  });

  // ── 18. ESL and PSL are consistently unpopulated ────────────────────────
  test("18. emotionalSupportLogic and practicalSupportLogic are empty for every product", () => {
    // Workbook restructured 2026-08-24 — these reasoning-essay columns are no
    // longer populated for any product (confirmed EXPLANATION_ONLY, no ranking
    // effect). This asserts the removal is consistent, not a partial data gap.
    for (const p of products) {
      assert.equal(
        p.parsed.prose.emotionalSupportLogic, "",
        `${p.handle}: expected emotionalSupportLogic to be empty`,
      );
      assert.equal(
        p.parsed.prose.practicalSupportLogic, "",
        `${p.handle}: expected practicalSupportLogic to be empty`,
      );
    }
  });

  // ── 19. Provisional evidence entries reference real handles, fields, values ─
  test("19. provisional evidence entries cross-check against catalog", () => {
    const catalogHandles = new Set(products.map((p) => p.handle));
    for (const entry of PROVISIONAL_EVIDENCE) {
      assert.ok(
        catalogHandles.has(entry.productHandle),
        `PROVISIONAL_EVIDENCE: unknown handle '${entry.productHandle}'`,
      );

      const product = getProductByHandle(entry.productHandle)!;

      // The field must exist in sourceFields by its camelCase key.
      assert.ok(
        entry.field in product.sourceFields,
        `${entry.productHandle}: field '${entry.field}' not in sourceFields`,
      );

      // The canonical value must appear somewhere in the relevant parsed array or string.
      // For array fields, check array inclusion; for prose, check substring.
      const fieldKey = entry.field as keyof typeof product.sourceFields;
      const rawSource = product.sourceFields[fieldKey];
      assert.ok(
        rawSource.includes(entry.canonicalValue),
        `${entry.productHandle}.${entry.field}: canonicalValue '${entry.canonicalValue}' not found in raw source '${rawSource}'`,
      );
    }
  });

  // ── 20. NADINE pairing references resolve or are explicitly reported ───────
  test("20. NADINE pairing references resolve or are explicitly reported as unresolved", () => {
    // Build the title set and sort longest-first for greedy resolution of
    // multi-word titles (e.g. "Becoming Defined" before "Becoming De...").
    const catalogTitles = products.map((p) => p.parsed.identity.verifiedTitle);
    const titlesLongestFirst = [...catalogTitles].sort((a, b) => b.length - a.length);

    const unresolved: string[] = [];

    for (const p of products) {
      const pairings = p.parsed.pairings;
      const fields: [string, string | null][] = [
        ["bestPairedWithNadinePieces",   pairings.bestPairedWithNadinePieces],
        ["conditionalNadinePairings",    pairings.conditionalNadinePairings],
        ["avoidPairingWithNadinePieces", pairings.avoidPairingWithNadinePieces],
      ];

      for (const [fieldName, prose] of fields) {
        if (prose === null) continue;

        // Non-null pairing fields must never be empty strings.
        assert.ok(
          prose.length > 0,
          `${p.handle}: ${fieldName} is non-null but empty`,
        );

        // Walk every "Becoming …" occurrence and resolve it against known titles.
        // titlesLongestFirst ensures we match the full title before a shorter prefix.
        let pos = 0;
        while (true) {
          const idx = prose.indexOf("Becoming ", pos);
          if (idx === -1) break;

          let resolved = false;
          for (const title of titlesLongestFirst) {
            if (prose.startsWith(title, idx)) {
              resolved = true;
              pos = idx + title.length;
              break;
            }
          }

          if (!resolved) {
            // Extract the raw "Becoming <word>" fragment for the error report.
            const fragment =
              prose.slice(idx).match(/^Becoming\s+\w+/)?.[0] ?? "Becoming?";
            unresolved.push(`${p.handle}/${fieldName}: "${fragment}"`);
            pos = idx + Math.max(fragment.length, 1);
          }
        }
      }
    }

    assert.deepStrictEqual(
      unresolved,
      [],
      `Unresolved NADINE title references (expected empty for V8):\n${unresolved.join("\n")}`,
    );
  });

  // ── 21. Blank/base-only URLs normalize correctly without losing raw source ─
  test("21. liveUrl null rules and raw source preservation", () => {
    const BASE = "https://naiabynadine.com/products/";
    for (const p of products) {
      const raw = p.sourceFields.liveUrl;
      const parsed = p.parsed.identity.liveUrl;

      if (!raw.trim() || raw.trim() === BASE) {
        assert.equal(parsed, null, `${p.handle}: base-only URL should parse to null`);
      }
      // suede-skirt has slug "skirt" ≠ handle "suede-skirt"
      if (p.handle === "suede-skirt") {
        assert.equal(parsed, null, "suede-skirt: slug≠handle should be null");
        assert.ok(raw.startsWith(BASE), "suede-skirt: raw liveUrl preserved in sourceFields");
      }
      // trench-coat has matching slug
      if (p.handle === "trench-coat") {
        assert.equal(
          parsed,
          "https://naiabynadine.com/products/trench-coat",
          "trench-coat: valid URL should not be null",
        );
        assert.equal(raw, parsed, "trench-coat: raw must equal parsed");
      }
    }
  });

  // ── 22. No embedded image payload in generated output ──────────────────
  test("22. no embedded image payload in generated catalog", () => {
    const content = readFileSync(GENERATED_PATH, "utf8");
    // PNG magic bytes base64-encoded; JPEG magic; raw binary markers
    const imageMarkers = ["iVBORw0KGgo", "/9j/", "data:image/"];
    for (const marker of imageMarkers) {
      assert.ok(
        !content.includes(marker),
        `Generated file contains image marker: ${marker}`,
      );
    }
  });

  // ── 23. Deterministic generation: run twice and compare ────────────────
  test("23. extraction is deterministic (two runs produce identical bytes)", (t) => {
    if (!existsSync(V8_PATH)) {
      t.skip("V8 workbook not accessible from test runner path");
      return;
    }
    const before = readFileSync(GENERATED_PATH);

    execSync("npx tsx scripts/extract-naia-catalog.ts", {
      cwd: resolve(__dirname, "../../.."),
      timeout: 60_000,
      stdio: "pipe",
    });

    const after = readFileSync(GENERATED_PATH);
    assert.equal(
      createHash("sha256").update(before).digest("hex"),
      createHash("sha256").update(after).digest("hex"),
      "Re-extraction produced different bytes",
    );
  });

  // ── 24. Committed generated file equals a fresh extraction ─────────────
  test("24. committed generated file matches extraction output", () => {
    const content = readFileSync(GENERATED_PATH, "utf8");
    // The file must declare the known V8 SHA-256 and source workbook name.
    assert.ok(
      content.includes(V8_SHA256),
      "Generated file does not contain expected V8 SHA-256",
    );
    assert.ok(
      content.includes("PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx"),
      "Generated file does not reference V8 workbook name",
    );
    assert.ok(
      content.includes("DO NOT EDIT MANUALLY"),
      "Generated file missing auto-generation notice",
    );
  });

  // ── 26. stylePersonalityMatch tokens belong to approved 10-ID vocabulary ──
  test("26. stylePersonalityMatch tokens are in the approved 10-ID vocabulary", () => {
    const APPROVED = new Set([
      "old-money", "artsy", "edgy", "feminine", "corporate-chic",
      "effortlessly-chic", "minimal", "trendy", "romantic", "casual-cool",
    ]);
    const violations: string[] = [];
    for (const p of products) {
      for (const token of p.parsed.rankings.stylePersonalityMatch) {
        if (!APPROVED.has(token)) {
          violations.push(`${p.handle}: "${token}" not in approved vocabulary`);
        }
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `stylePersonalityMatch off-contract tokens:\n${violations.join("\n")}`,
    );
  });

  // ── 27. practicalSupportMatch tokens are in direct or supplemental set ───
  test("27. practicalSupportMatch tokens are in the direct or supplemental set", () => {
    const DIRECT = new Set([
      "quick-to-style", "movement-friendly", "long-day", "practical-footwear",
      "day-to-night", "hot-outdoors", "cool-air-conditioning",
    ]);
    const violations: string[] = [];
    for (const p of products) {
      for (const token of p.parsed.rankings.practicalSupportMatch) {
        if (!DIRECT.has(token) && !PSM_SUPPLEMENTAL_PRODUCT_TOKENS.has(token)) {
          violations.push(`${p.handle}: "${token}" not in direct or supplemental set`);
        }
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `practicalSupportMatch unknown tokens:\n${violations.join("\n")}`,
    );
  });

  // ── 25. Becoming Seen field 35 (V8 fix) ────────────────────────────────
  // Updated 2026-08-24: reconciliation gave trench-coat real avoid-pairing
  // content (it now conflicts with the redesigned Becoming Clear bomber and
  // with Becoming Whole), so the raw value is no longer the literal "None"
  // this test originally locked in. No product currently has a literal
  // "None" in any NADINE pairing field, so the None -> null parsing path
  // (still exercised by conditionalNadinePairings on several products) has
  // no dedicated single-product regression case right now.
  test("25. Becoming Seen avoidPairingWithNadinePieces reflects the redesigned Becoming Clear conflict", () => {
    const becomingSeen = getProductByHandle("trench-coat");
    assert.ok(becomingSeen, "trench-coat not found in catalog");

    assert.equal(
      becomingSeen.sourceFields.avoidPairingWithNadinePieces,
      "Becoming Clear; Becoming Whole",
      "sourceFields.avoidPairingWithNadinePieces changed unexpectedly",
    );

    assert.equal(
      becomingSeen.parsed.pairings.avoidPairingWithNadinePieces,
      "Becoming Clear; Becoming Whole",
      "parsed.pairings.avoidPairingWithNadinePieces must pass through non-null prose unchanged",
    );
  });
});
