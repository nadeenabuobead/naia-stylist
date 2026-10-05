// app/lib/styleme/mode-resolution.test.ts
//
// PHASE A — product context must be a fact, not an inference from a cookie.
//
// StyleMe has two product contexts sharing one Rev 3 engine:
//
//   naia    style from the customer's own closet; the NADINE catalogue must never leak in
//   nadine  the customer's closet plus eligible NADINE pieces
//
// Before this change `mode` existed ONLY as the `styleMeMode` cookie key. Two readers in
// result.tsx defaulted it to "naia" and the engine defaulted it to "nadine" — two different
// answers to the same missing value. Nothing persisted it: no column on StylingSession, no
// field in StyleMeMetadata. So a NADINE session whose cookie expired, or any reload by
// sessionId, silently became an nAia session.
//
// WHY THE FAILURE DIRECTION MATTERS. Every one of those paths fell back to "naia" —
// closet-only — which is the SAFE direction: a NADINE customer got a closet look, which is
// disappointing rather than wrong. The reverse was never possible: nothing sets "nadine"
// without the allowlisted, provenance-stamped PDP handoff. These tests pin both halves —
// that NADINE context survives, and that it can never be acquired by accident.
//
// PRECEDENCE, asserted in MR-A: persisted (DB) > cookie > "naia".
// The DB wins because it is what the session actually was; the cookie is a hint about the
// current browser, and a hint must not overrule a record. "naia" is last because an unknown
// context must fail closed to closet-only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { resolveStyleMeMode, DEFAULT_STYLEME_MODE } from "./mode-resolution.js";

/** Source text of a repo file. Static imports only: `require` is not defined under ESM,
 *  and the first draft of this file used it — eleven assertions "failed" for that reason
 *  rather than for the defect they were written to catch. */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");

// ── MR-A: the precedence rule ──────────────────────────────────────────────

describe("MR-A — persisted beats cookie beats default", () => {
  test("MR-A.1 the default is naia, never nadine", () => {
    assert.equal(DEFAULT_STYLEME_MODE, "naia",
      "an unknown product context must fail closed to closet-only");
    assert.equal(resolveStyleMeMode(null, null), "naia");
    assert.equal(resolveStyleMeMode(undefined, undefined), "naia");
  });

  test("MR-A.2 a persisted mode wins over the cookie", () => {
    // The decisive case: the browser says naia, the record says nadine. The record is what
    // the session WAS; the cookie is only what this browser currently carries.
    assert.equal(resolveStyleMeMode("nadine", "naia"), "nadine");
    assert.equal(resolveStyleMeMode("naia", "nadine"), "naia");
  });

  test("MR-A.3 the cookie is used only when nothing is persisted", () => {
    assert.equal(resolveStyleMeMode(null, "nadine"), "nadine");
    assert.equal(resolveStyleMeMode(undefined, "naia"), "naia");
  });

  test("MR-A.4 an unrecognised stored value falls through rather than being trusted", () => {
    // A hand-edited cookie or a value from a future schema must not become a third mode.
    assert.equal(resolveStyleMeMode("NADINE", null), "naia", "case-variant is not a valid mode");
    assert.equal(resolveStyleMeMode("", "nadine"), "nadine", "empty persisted value defers to the cookie");
    assert.equal(resolveStyleMeMode("something-else", null), "naia");
    assert.equal(resolveStyleMeMode(null, "something-else"), "naia");
  });

  test("MR-A.5 a garbage persisted value does not promote a garbage cookie", () => {
    assert.equal(resolveStyleMeMode("nope", "also-nope"), "naia");
  });
});

// ── MR-B: the engine default ───────────────────────────────────────────────

describe("MR-B — the engine agrees with the route", () => {
  test("MR-B.1 computeStyleMeResult defaults mode to naia", () => {
    // Read from source: importing the module here would pull the whole server graph, and the
    // value is a one-line default whose only failure mode is saying "nadine".
    const src = read("app/lib/ai/styleme-result.server.ts");
    assert.ok(
      /const mode: StyleMeMode = engineInput\.mode \?\? "naia"/.test(src),
      "the engine default must be naia so an omitted mode cannot silently enable the catalogue",
    );
    assert.ok(
      !/engineInput\.mode \?\? "nadine"/.test(src),
      "the old nadine default must be gone — it disagreed with both route readers",
    );
  });
});

// ── MR-C: the route reads the record first ─────────────────────────────────
//
// Source assertions, because these live inside a loader/action that needs a request, a
// cookie and Prisma. What they pin is the wiring: that the persisted value is consulted and
// that the cookie is no longer read on its own.

describe("MR-C — result.tsx resolves mode through the record", () => {
  const src = () => read("app/routes/style-me/result.tsx");

  test("MR-C.1 the route uses the shared resolver, not a bare cookie read", () => {
    const text = src();
    assert.ok(text.includes("resolveStyleMeMode"), "result.tsx must use the shared resolver");
    const bareCookieReads = text.split('cookieSession.get("styleMeMode")').length - 1
      + text.split('regenCookieSession.get("styleMeMode")').length - 1;
    const resolverUses = text.split("resolveStyleMeMode(").length - 1;
    assert.ok(
      resolverUses >= 2,
      `both generation paths must resolve through it; found ${resolverUses}`,
    );
    assert.ok(
      bareCookieReads <= resolverUses,
      "every styleMeMode cookie read must feed the resolver rather than being used directly",
    );
  });

  test("MR-C.2 the generated session persists its mode", () => {
    assert.ok(/styleMeMode:/.test(src()),
      "stylingSession.create must write styleMeMode so the context outlives the cookie");
  });

  test("MR-C.3 New Look resolves from the loaded session record", () => {
    const text = src();
    // The regenerate branch already loads the StylingSession; the mode must come from it.
    const regen = text.slice(text.indexOf('if (intent === "regenerate")'));
    assert.ok(
      /resolveStyleMeMode\(\s*session\.styleMeMode/.test(regen),
      "New Look must prefer the session record over the cookie",
    );
  });

  test("MR-C.4 Adjust Vibe inherits the parent session's mode", () => {
    const text = src();
    assert.ok(
      /parentSessionId/.test(text) && /parentMode|parentSession\?\.styleMeMode|inheritedMode/.test(text),
      "a continuation session must take its product context from the session it continues, " +
      "because Adjust Vibe skips the source step that would otherwise stamp it",
    );
  });
});

// ── MR-D: the persisted schema and metadata ────────────────────────────────

describe("MR-D — mode is recorded, not inferred", () => {
  test("MR-D.1 StylingSession carries a styleMeMode column", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model StylingSession "));
    const body = model.slice(0, model.indexOf("\n}"));
    assert.ok(/styleMeMode\s+String\?/.test(body),
      "StylingSession must persist styleMeMode (nullable: pre-existing rows have none)");
  });

  test("MR-D.2 a migration exists for the column and is not applied to production here", () => {
    const root = join(process.cwd(), "prisma/migrations");
    const dirs = readdirSync(root).filter((d) => /styleme_mode|style_me_mode/.test(d));
    assert.ok(dirs.length >= 1, "a migration directory for the column must exist");
    const sql = readFileSync(join(root, dirs[0], "migration.sql"), "utf8");
    assert.ok(/ALTER TABLE/i.test(sql) && /styleMeMode/.test(sql),
      "the migration must add the column");
    assert.ok(!/DROP\s+TABLE/i.test(sql), "an additive migration must not drop anything");
  });

  test("MR-D.3 the suggestion metadata records the mode it was generated under", () => {
    const types = read("app/lib/ai/styleme-result.types.ts");
    const meta = types.slice(types.indexOf("export interface StyleMeMetadata"));
    const body = meta.slice(0, meta.indexOf("\n}"));
    assert.ok(/mode\??:/.test(body),
      "a persisted suggestion must carry its own product context for history and audit");
  });
});

// ── MR-E: the invariants that must NOT change ──────────────────────────────
//
// Green before and after. If Phase A moved any of these, the fix went too far.

describe("MR-E — nAia isolation is unchanged by mode persistence", () => {
  test("MR-E.1 nAia mode still returns before the catalogue is evaluated", () => {
    const src = read("app/lib/ai/styleme-recommendation.ts");
    const branch = src.slice(src.indexOf('if (input.mode === "naia")'));
    const body = branch.slice(0, 900);
    assert.ok(/primary: null/.test(body), "nAia must yield no primary product");
    assert.ok(/alternatives: \[\]/.test(body), "nAia must yield no alternatives");
    assert.ok(/evaluatedProducts: \[\]/.test(body), "nAia must evaluate no catalogue products");
    assert.ok(/totalCatalogProducts: 0/.test(body), "nAia must report zero catalogue coverage");
  });

  test("MR-E.2 the explicit PDP anchor is still never substituted", () => {
    const src = read("app/lib/ai/styleme-recommendation.ts");
    const branch = src.slice(src.indexOf('if (input.mode === "nadine" && anchor?.type === "nadine")'));
    const body = branch.slice(0, 900);
    assert.ok(/totalScore: 100/.test(body), "the chosen product is returned as primary directly");
    assert.ok(/alternatives: \[\]/.test(body), "no substitute may be offered for a piece she chose");
  });

  test("MR-E.3 Complete the Look still cannot be a product", () => {
    const types = read("app/lib/ai/styleme-result.types.ts");
    const piece = types.slice(types.indexOf("export interface StyleMeCompletionPiece"));
    const body = piece.slice(0, piece.indexOf("}"));
    assert.ok(/slot:/.test(body) && /description:/.test(body));
    for (const forbidden of ["handle", "productUrl", "liveUrl", "shopifyProductId", "imageUrl"]) {
      assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(body),
        `a completion piece must carry no ${forbidden} — it is guidance, not merchandise`);
    }
  });

  test("MR-E.4 the closet-only source still suppresses NADINE alternatives", () => {
    const src = read("app/lib/ai/styleme-result.server.ts");
    assert.ok(/session\.source === "my-closet"/.test(src),
      "the my-closet alternatives suppression must remain");
  });
});
