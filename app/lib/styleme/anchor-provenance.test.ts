// app/lib/styleme/anchor-provenance.test.ts
//
// COMMIT D — an anchor nAia chose is a starting point; one the customer chose is the brief.
//
// Commit B re-ran automatic anchor selection on every reroll so the structural centre could
// move. That is right when nAia picked the garment and wrong when the customer did: "Style
// This Piece" means style THIS piece, and silently swapping it is the worse failure.
//
// StylingSession recorded closetAnchorId but no provenance, and the two flows were
// indistinguishable by the time the row was written — source.tsx unsets styleMeAnchorMode
// immediately after a manual pick. Provenance is now captured at both write sites and
// persisted as AnchorProvenance (AUTO | MANUAL), nullable. Historical rows read null and are
// treated as MANUAL.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeCoreLookSignature } from "../ai/styleme-result.server.js";

const src = (f: string) => readFileSync(join(process.cwd(), "app/routes/style-me", f), "utf8");
const schema = () => readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

// ── AP-A: provenance is captured where the two flows diverge ────────────────

describe("AP-A — session creation records who chose the anchor", () => {
  const source = src("source.tsx");
  const result = src("result.tsx");

  test("AP-A.1 nAia chooses → AUTO, written beside the auto-selected anchor", () => {
    const i = source.indexOf('session.set("styleMeClosetAnchorId", selected.id)');
    assert.ok(i > 0, "the auto-selection write site must exist");
    assert.ok(/styleMeAnchorProvenance",\s*"AUTO"/.test(source.slice(i, i + 400)));
  });

  test("AP-A.2 a manual closet pick → MANUAL", () => {
    const i = source.indexOf('session.set("styleMeClosetAnchorId", closetItemId)');
    assert.ok(i > 0, "the manual pick write site must exist");
    assert.ok(/styleMeAnchorProvenance",\s*"MANUAL"/.test(source.slice(i, i + 500)));
  });

  test("AP-A.3 MANUAL is recorded BEFORE styleMeAnchorMode is unset", () => {
    // The ordering is the whole point: the discriminator existed and was being discarded.
    const prov = source.indexOf('"styleMeAnchorProvenance", "MANUAL"');
    const unset = source.indexOf('session.unset("styleMeAnchorMode")', prov);
    assert.ok(prov > 0 && unset > prov, "provenance must be captured before the mode is cleared");
  });

  test("AP-A.4 specific-piece / Style This Piece routes through the manual pick", () => {
    // It sets anchorMode manual and redirects to the picker, which is the AP-A.2 site.
    assert.ok(/rawSource === "specific-piece"/.test(source));
    assert.ok(/styleMeAnchorMode",\s*"manual"/.test(source));
  });

  test("AP-A.5 clearing the anchor also clears provenance", () => {
    // A changed source must not leave stale provenance pointing at a discarded anchor.
    const unsets = source.split('session.unset("styleMeClosetAnchorId")').length - 1;
    const provUnsets = source.split('session.unset("styleMeAnchorProvenance")').length - 1;
    assert.equal(provUnsets, unsets, "every anchor clear must clear provenance too");
  });

  test("AP-A.6 the value is persisted on the StylingSession row", () => {
    assert.ok(/anchorProvenance:\s*\(source === "my-closet" \|\| source === "both"\)/.test(result));
  });

  test("AP-A.7 only AUTO/MANUAL are accepted; anything else resolves to null", () => {
    const i = result.indexOf("const anchorProvenance:");
    const block = result.slice(i, i + 260);
    assert.ok(/=== "AUTO" \? "AUTO"/.test(block));
    assert.ok(/=== "MANUAL" \? "MANUAL"/.test(block));
    assert.ok(/:\s*null;/.test(block), "an unrecognised cookie value must not be trusted");
  });
});

// ── AP-B: schema shape ──────────────────────────────────────────────────────

describe("AP-B — the persistence contract", () => {
  test("AP-B.1 AnchorProvenance is an enum with exactly AUTO and MANUAL", () => {
    const s = schema();
    const i = s.indexOf("enum AnchorProvenance");
    assert.ok(i > 0, "enum must exist");
    const body = s.slice(i, s.indexOf("}", i));
    assert.ok(/\bAUTO\b/.test(body) && /\bMANUAL\b/.test(body));
  });

  test("AP-B.2 the column is nullable so historical rows are valid", () => {
    assert.ok(/anchorProvenance\s+AnchorProvenance\?/.test(schema()),
      "a non-nullable column would require backfilling every existing session");
  });

  test("AP-B.3 styleFrom is NOT overloaded to carry provenance", () => {
    const s = schema();
    const i = s.indexOf("enum StyleSource");
    const body = s.slice(i, s.indexOf("}", i));
    assert.ok(!/AUTO|MANUAL/.test(body), "source and provenance are different questions");
  });
});

// ── AP-C: the reroll gate ───────────────────────────────────────────────────

describe("AP-C — only an AUTO anchor may be moved", () => {
  const result = src("result.tsx");

  test("AP-C.1 the reroll anchor path is gated on AUTO", () => {
    assert.ok(/const anchorIsAuto = session\.anchorProvenance === "AUTO";/.test(result));
    assert.ok(/if \(anchorIsAuto &&/.test(result),
      "automatic re-selection must not run for a manual anchor");
  });

  test("AP-C.2 null and MANUAL both fall through to the persisted anchor", () => {
    // Strict equality against "AUTO" means every other value — MANUAL, null, anything
    // unexpected — keeps session.closetAnchorId. Conservative by construction.
    const strictAuto = /session\.anchorProvenance === "AUTO"/.test(result);
    assert.ok(strictAuto, "must be a positive AUTO test, never a negative MANUAL test");
    assert.ok(!/anchorProvenance !== "MANUAL"/.test(result),
      "a negative test would treat an unknown value as AUTO");
  });

  test("AP-C.3 the persisted session anchor is never rewritten on reroll", () => {
    const branch = result.slice(result.indexOf('if (intent === "regenerate")'));
    const body = branch.slice(0, branch.indexOf('if (intent === "save"'));
    assert.ok(!/closetAnchorId:\s/.test(body),
      "regenerate must not write closetAnchorId back to the session");
    assert.ok(!/anchorProvenance:\s/.test(body),
      "regenerate must not rewrite provenance either");
  });

  test("AP-C.4 the most recent suggestion remains the comparison source", () => {
    assert.ok(/orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/.test(result),
      "a second reroll must be measured against the first reroll, not the original look");
  });

  test("AP-C.5 previous ids reach the anchor selector only inside the AUTO branch", () => {
    const i = result.indexOf("const anchorIsAuto");
    const j = result.indexOf("const engineInput = buildEngineInput", i);
    const autoBlock = result.slice(i, j);
    assert.ok(/previousOutfitClosetIds:\s*recentlyShownClosetIds/.test(autoBlock));
    assert.ok(!/previousOutfitClosetIds/.test(result.slice(0, i)),
      "the diversity signal must not leak outside the AUTO path");
  });
});

// ── AP-D: a fixed anchor still allows core diversity where structure permits ─

describe("AP-D — varying the outfit AROUND a fixed garment", () => {
  const p = (slot: string, closetId: string) => ({ slot, closetId });

  test("AP-D.1 manual top fixed, bottom changes → the core signature differs", () => {
    const before = [p("top", "chosenTop"), p("bottom", "trouserA"), p("shoe", "s1")];
    const after = [p("top", "chosenTop"), p("bottom", "trouserB"), p("shoe", "s1")];
    assert.notEqual(computeCoreLookSignature(before), computeCoreLookSignature(after));
  });

  test("AP-D.2 manual outerwear fixed, the core underneath changes → differs", () => {
    // outerwear is not part of the core, so a fixed jacket constrains nothing structurally.
    const before = [p("outerwear", "chosenCoat"), p("top", "t1"), p("bottom", "b1")];
    const after = [p("outerwear", "chosenCoat"), p("top", "t2"), p("bottom", "b1")];
    assert.notEqual(computeCoreLookSignature(before), computeCoreLookSignature(after));
  });

  test("AP-D.3 manual dress fills the core — only finishing can move → identical", () => {
    const before = [p("dress", "chosenDress"), p("shoe", "s1"), p("bag", "g1")];
    const after = [p("dress", "chosenDress"), p("shoe", "s2"), p("bag", "g2")];
    assert.equal(computeCoreLookSignature(before), computeCoreLookSignature(after),
      "no different core exists, so the reroll must report sameCombination");
  });

  test("AP-D.4 manual set behaves exactly as a manual dress", () => {
    const before = [p("set", "chosenSet"), p("shoe", "s1")];
    const after = [p("set", "chosenSet"), p("shoe", "s2"), p("jewelry", "j1")];
    assert.equal(computeCoreLookSignature(before), computeCoreLookSignature(after));
  });

  test("AP-D.5 a fixed top with an added outer layer is still the same core", () => {
    const before = [p("top", "chosenTop"), p("bottom", "b1")];
    const after = [p("top", "chosenTop"), p("bottom", "b1"), p("outerwear", "coat")];
    assert.equal(computeCoreLookSignature(before), computeCoreLookSignature(after));
  });
});
