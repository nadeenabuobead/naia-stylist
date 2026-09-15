// app/lib/admin/garment-semantics.test.ts
//
// Tests for Phase 2B garment-level styling interpretation.
//
// Sections:
//   §GS-01  Shape dimension — Structured / Relaxed / Fluid rules
//   §GS-02  Polish dimension — Dressy / Polished / Smart / Casual rules
//   §GS-03  Visual character — Statement / Distinctive / Understated precedence
//   §GS-04  Coverage — Higher / Lower / absent rules
//   §GS-05  Style identity — Classic / Minimal / Romantic / Edgy / Creative
//   §GS-06  Beige trench acceptance test
//   §GS-07  Forbidden vocabulary — emotional concepts never emitted
//   §GS-08  Empty / sparse input — no labels invented
//   §GS-09  Corrections validated — Phase 2B sign-off rules
//   §GS-10  List view independence — semantics not imported into list route
//   §GS-11  No editing — no mutation exports
//   §GS-12  Phase boundary — no StyleMe imports
//
// Run: node --test --import tsx/esm app/lib/admin/garment-semantics.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  interpretGarment,
  FORBIDDEN_VOCABULARY,
  type GarmentInterpretation,
} from "~/lib/admin/garment-semantics.server";
import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function blank(): ClosetClassification {
  return {
    subcategory: null, silhouette: null, fitProfile: null,
    hemLength: null, topLength: null, waistShape: null,
    sleeveLength: null, necklineCoverage: null,
    shoulderCoverage: null, midriffExposed: null,
    material: null, pattern: null, primaryColor: null,
    colors: [], occasions: [], seasons: [],
    formality: null, stylePersonality: null,
    styleTags: [], garmentRelationships: [],
  };
}

function labels(result: GarmentInterpretation): string[] {
  return result.labels.map(l => l.label);
}

function allEvidence(result: GarmentInterpretation): string[] {
  return result.evidence;
}

// ── §GS-01 Shape ─────────────────────────────────────────────────────────────

describe("§GS-01 Shape dimension", () => {
  it("tailored fitProfile → Structured", () => {
    const c = { ...blank(), fitProfile: "tailored" };
    const r = interpretGarment(c, "TOPS");
    assert.ok(labels(r).includes("Structured"), `got: ${labels(r).join(", ")}`);
    assert.ok(r.evidence.includes("tailored fit"));
  });

  it("structured fitProfile → Structured", () => {
    const c = { ...blank(), fitProfile: "structured" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Structured"));
  });

  it("styleTags structured → Structured", () => {
    const c = { ...blank(), styleTags: ["structured"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Structured"));
  });

  it("belted waist alone does NOT trigger Structured without fitProfile/tag support", () => {
    const c = { ...blank(), waistShape: "belted" };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Structured"));
  });

  it("belted waist IS added as evidence when Structured fires from fitProfile", () => {
    const c = { ...blank(), fitProfile: "tailored", waistShape: "belted" };
    const r = interpretGarment(c, "TOPS");
    assert.ok(r.evidence.includes("belted waist"));
  });

  it("relaxed fitProfile → Relaxed", () => {
    const c = { ...blank(), fitProfile: "relaxed" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Relaxed"));
  });

  it("loose fitProfile → Relaxed", () => {
    const c = { ...blank(), fitProfile: "loose" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Relaxed"));
  });

  it("oversized fitProfile → Relaxed", () => {
    const c = { ...blank(), fitProfile: "oversized" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Relaxed"));
  });

  it("shift silhouette alone → Relaxed", () => {
    const c = { ...blank(), silhouette: "shift" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Relaxed"));
  });

  it("flowy fitProfile → Fluid", () => {
    const c = { ...blank(), fitProfile: "flowy" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Fluid"));
  });

  it("flowy style tag → Fluid", () => {
    const c = { ...blank(), styleTags: ["flowy"] };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Fluid"));
  });

  it("a-line silhouette alone does NOT trigger Fluid (Phase 2B correction)", () => {
    const c = { ...blank(), silhouette: "a-line" };
    assert.ok(!labels(interpretGarment(c, "DRESSES")).includes("Fluid"));
  });

  it("Structured beats Relaxed when fitProfile=tailored AND shift silhouette", () => {
    const c = { ...blank(), fitProfile: "tailored", silhouette: "shift" };
    const l = labels(interpretGarment(c, "DRESSES"));
    assert.ok(l.includes("Structured"), "should have Structured");
    assert.ok(!l.includes("Relaxed"), "should not have Relaxed when Structured wins");
  });

  it("no relevant Shape fields → Shape dimension absent", () => {
    const c = { ...blank(), fitProfile: "body-skimming" }; // neutral fit
    assert.ok(!labels(interpretGarment(c, "DRESSES")).includes("Structured"));
    assert.ok(!labels(interpretGarment(c, "DRESSES")).includes("Relaxed"));
    assert.ok(!labels(interpretGarment(c, "DRESSES")).includes("Fluid"));
  });
});

// ── §GS-02 Polish ─────────────────────────────────────────────────────────────

describe("§GS-02 Polish dimension", () => {
  it("formality=business-casual → Polished", () => {
    const c = { ...blank(), formality: "business-casual" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Polished"));
    assert.ok(interpretGarment(c, "TOPS").evidence.includes("business-casual formality"));
  });

  it("formality=business-formal → Polished", () => {
    const c = { ...blank(), formality: "business-formal" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Polished"));
  });

  it("styleTags=elevated → Polished", () => {
    const c = { ...blank(), styleTags: ["elevated"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Polished"));
  });

  it("formality=smart-casual → Smart (NOT Polished)", () => {
    const c = { ...blank(), formality: "smart-casual" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(l.includes("Smart"), "smart-casual should produce Smart");
    assert.ok(!l.includes("Polished"), "smart-casual must NOT produce Polished");
  });

  it("formality=smart-casual + tailored fit → Smart, NOT Polished (Phase 2B correction)", () => {
    const c = { ...blank(), formality: "smart-casual", fitProfile: "tailored" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(l.includes("Smart"), "should have Smart");
    assert.ok(!l.includes("Polished"), "tailored fit must NOT elevate smart-casual to Polished");
  });

  it("formality=casual → Casual", () => {
    const c = { ...blank(), formality: "casual" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Casual"));
  });

  it("formality=evening → Dressy", () => {
    const c = { ...blank(), formality: "evening" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Dressy"));
  });

  it("formality=occasion → Dressy", () => {
    const c = { ...blank(), formality: "occasion" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Dressy"));
  });

  it("Dressy beats Polished when formality=evening and style tags say polished", () => {
    const c = { ...blank(), formality: "evening", styleTags: ["polished"] };
    const l = labels(interpretGarment(c, "DRESSES"));
    assert.ok(l.includes("Dressy"));
    assert.ok(!l.includes("Polished"));
  });

  it("work occasion → Smart when formality absent", () => {
    const c = { ...blank(), occasions: ["work"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Smart"));
  });

  it("no formality or relevant occasions → Polish dimension absent", () => {
    const c = blank();
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Polished") && !l.includes("Smart") && !l.includes("Casual") && !l.includes("Dressy"));
  });
});

// ── §GS-03 Visual character ───────────────────────────────────────────────────

describe("§GS-03 Visual character dimension", () => {
  it("solid + neutral colour → Understated", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "beige" };
    assert.ok(labels(interpretGarment(c, "OUTERWEAR")).includes("Understated"));
    assert.ok(interpretGarment(c, "OUTERWEAR").evidence.includes("solid neutral beige"));
  });

  it("solid + non-neutral colour alone → NO Visual character (not Distinctive, not Understated)", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "red" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Distinctive"), "red solid alone must NOT be Distinctive — colour alone is not sufficient");
    assert.ok(!l.includes("Understated"), "red is not a neutral colour — not Understated");
    assert.ok(!l.includes("Statement"), "plain red solid is not Statement");
  });

  it("floral pattern → Statement", () => {
    const c = { ...blank(), pattern: "floral" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Statement"));
  });

  it("animal-print → Statement", () => {
    const c = { ...blank(), pattern: "animal-print" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Statement"));
  });

  it("check pattern → Distinctive", () => {
    const c = { ...blank(), pattern: "check" };
    assert.ok(labels(interpretGarment(c, "OUTERWEAR")).includes("Distinctive"));
  });

  it("houndstooth pattern → Distinctive", () => {
    const c = { ...blank(), pattern: "houndstooth" };
    assert.ok(labels(interpretGarment(c, "BOTTOMS")).includes("Distinctive"));
  });

  it("Statement beats Understated: solid neutral piece with explicit statement tag", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "black", styleTags: ["statement"] };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(l.includes("Statement"), "statement tag should win");
    assert.ok(!l.includes("Understated"), "must not be Understated when statement tag present");
  });

  it("no pattern data → Visual character absent", () => {
    const c = blank(); // pattern = null
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Understated") && !l.includes("Distinctive") && !l.includes("Statement"));
  });
});

// ── §GS-04 Coverage ───────────────────────────────────────────────────────────

describe("§GS-04 Coverage dimension", () => {
  it("midi + full sleeves → Higher coverage (2 signals sufficient)", () => {
    const c = { ...blank(), hemLength: "midi", sleeveLength: "full" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Higher coverage"));
  });

  it("full sleeves + shoulder coverage → Higher coverage without hem (outerwear case)", () => {
    const c = { ...blank(), sleeveLength: "full", shoulderCoverage: true };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Higher coverage"));
  });

  it("hemLength=n/a does NOT count as a coverage signal", () => {
    const c = { ...blank(), hemLength: "n/a", sleeveLength: "full", shoulderCoverage: true };
    // 2 real signals (sleeveLength, shoulderCoverage) → still Higher coverage
    assert.ok(labels(interpretGarment(c, "OUTERWEAR")).includes("Higher coverage"));
  });

  it("single covered signal without n/a → coverage absent (need ≥2)", () => {
    const c = { ...blank(), sleeveLength: "full" }; // only 1 covered signal
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Higher coverage"));
  });

  it("mini + sleeveless → Lower coverage", () => {
    const c = { ...blank(), hemLength: "mini", sleeveLength: "sleeveless" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Lower coverage"));
  });

  it("midriffExposed=true + sleeveless → Lower coverage", () => {
    const c = { ...blank(), midriffExposed: true, sleeveLength: "sleeveless" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Lower coverage"));
  });

  it("SHOES → coverage absent", () => {
    const c = { ...blank(), hemLength: "midi", sleeveLength: "full" };
    assert.ok(!labels(interpretGarment(c, "SHOES")).includes("Higher coverage"));
  });

  it("BAGS → coverage absent", () => {
    const c = { ...blank(), sleeveLength: "full", shoulderCoverage: true };
    assert.ok(!labels(interpretGarment(c, "BAGS")).includes("Higher coverage"));
  });

  it("ACCESSORIES → coverage absent", () => {
    assert.ok(!labels(interpretGarment(blank(), "ACCESSORIES")).includes("Higher coverage"));
  });

  it("JEWELRY → coverage absent", () => {
    assert.ok(!labels(interpretGarment(blank(), "JEWELRY")).includes("Higher coverage"));
  });

  it("mixed signals (1 covered + 1 exposed) → coverage absent", () => {
    const c = { ...blank(), hemLength: "midi", sleeveLength: "sleeveless" };
    const l = labels(interpretGarment(c, "DRESSES"));
    assert.ok(!l.includes("Higher coverage") && !l.includes("Lower coverage"));
  });

  it("scoop neckline alone → NOT Higher coverage (neutral)", () => {
    const c = { ...blank(), necklineCoverage: "scoop" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Higher coverage"), "scoop alone must not produce Higher coverage");
  });

  it("scoop neckline alone → NOT Lower coverage (neutral)", () => {
    const c = { ...blank(), necklineCoverage: "scoop" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Lower coverage"), "scoop alone must not produce Lower coverage");
  });

  it("scoop neckline + full sleeves + shoulder coverage → Higher coverage (other signals still fire)", () => {
    const c = { ...blank(), necklineCoverage: "scoop", sleeveLength: "full", shoulderCoverage: true };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Higher coverage"));
  });

  it("shirt-collar alone → NOT Higher coverage (neutral — collar alone is insufficient)", () => {
    const c = { ...blank(), necklineCoverage: "shirt-collar" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Higher coverage"), "shirt-collar alone must not produce Higher coverage");
  });

  it("shirt-collar alone → NOT Lower coverage (neutral)", () => {
    const c = { ...blank(), necklineCoverage: "shirt-collar" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Lower coverage"), "shirt-collar alone must not produce Lower coverage");
  });

  it("shirt-collar + full sleeves + shoulder coverage → Higher coverage (other signals fire)", () => {
    const c = { ...blank(), necklineCoverage: "shirt-collar", sleeveLength: "full", shoulderCoverage: true };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Higher coverage"));
  });
});

// ── §GS-05 Style identity ─────────────────────────────────────────────────────

describe("§GS-05 Style identity dimension", () => {
  it("stylePersonality=classic-polished → Classic", () => {
    const c = { ...blank(), stylePersonality: "classic-polished" };
    assert.ok(labels(interpretGarment(c, "OUTERWEAR")).includes("Classic"));
  });

  it("styleTags=classic → Classic", () => {
    const c = { ...blank(), styleTags: ["classic"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("subcategory=trench coat ALONE does NOT trigger Classic (Phase 2B correction)", () => {
    const c = { ...blank(), subcategory: "trench coat" };
    assert.ok(!labels(interpretGarment(c, "OUTERWEAR")).includes("Classic"),
      "subcategory alone must not trigger Classic");
  });

  it("subcategory=trench coat WITH classic-polished personality → Classic + construction evidence", () => {
    const c = { ...blank(), stylePersonality: "classic-polished", subcategory: "trench coat" };
    const r = interpretGarment(c, "OUTERWEAR");
    assert.ok(labels(r).includes("Classic"));
    assert.ok(r.evidence.includes("trench coat construction"),
      "subcategory should add supporting evidence when personality fires Classic");
  });

  it("stylePersonality=minimal-relaxed → Minimal", () => {
    const c = { ...blank(), stylePersonality: "minimal-relaxed" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Minimal"));
  });

  it("styleTags=minimal → Minimal", () => {
    const c = { ...blank(), styleTags: ["minimal"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Minimal"));
  });

  it("stylePersonality=feminine-romantic → Romantic", () => {
    const c = { ...blank(), stylePersonality: "feminine-romantic" };
    assert.ok(labels(interpretGarment(c, "DRESSES")).includes("Romantic"));
  });

  it("styleTags=edgy → Edgy", () => {
    const c = { ...blank(), styleTags: ["edgy"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Edgy"));
  });

  it("leather material alone does NOT trigger Edgy (Phase 2B correction)", () => {
    const c = { ...blank(), material: "leather" };
    assert.ok(!labels(interpretGarment(c, "BAGS")).includes("Edgy"),
      "leather alone must not trigger Edgy — classic leather handbag must not become Edgy");
  });

  it("suede material alone does NOT trigger Edgy (Phase 2B correction)", () => {
    const c = { ...blank(), material: "suede" };
    assert.ok(!labels(interpretGarment(c, "BAGS")).includes("Edgy"));
  });

  it("stylePersonality=creative-expressive → Creative", () => {
    const c = { ...blank(), stylePersonality: "creative-expressive" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Creative"));
  });

  it("styleTags=trendy → Trend-led", () => {
    const c = { ...blank(), styleTags: ["trendy"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Trend-led"));
  });

  it("no personality, no relevant tags, generic subcategory → Style identity absent", () => {
    const c = { ...blank(), subcategory: "t-shirt" };
    const l = labels(interpretGarment(c, "TOPS"));
    const identityLabels = ["Classic", "Minimal", "Romantic", "Edgy", "Creative", "Trend-led"];
    const found = identityLabels.filter(label => l.includes(label));
    assert.equal(found.length, 0, `unexpected style identity labels: ${found.join(", ")}`);
  });
});

// ── §GS-06 Beige trench acceptance test ──────────────────────────────────────

describe("§GS-06 Beige trench acceptance test", () => {
  // Uses ACTUAL stored values visible in Closet Intelligence for the live beige trench.
  // All labels must emerge from generic rules — nothing hardcoded for this garment.
  const beigeTrench: ClosetClassification = {
    subcategory: "trench coat",
    silhouette: "straight",
    fitProfile: "tailored",
    hemLength: "midi",
    topLength: "n/a",
    waistShape: "belted",
    sleeveLength: "full",
    necklineCoverage: "crew",
    shoulderCoverage: true,
    midriffExposed: false,
    material: "wool",
    pattern: "solid",
    primaryColor: "beige",
    colors: ["beige"],
    occasions: ["work", "travel"],
    seasons: ["fall", "winter"],
    formality: "business-casual",
    stylePersonality: "classic-polished",
    styleTags: ["classic", "elevated"],
    garmentRelationships: [],
  };

  it("produces exactly: Structured, Polished, Classic, Understated, Higher coverage", () => {
    const r = interpretGarment(beigeTrench, "OUTERWEAR");
    const l = labels(r);
    assert.deepEqual(l, ["Structured", "Polished", "Classic", "Understated", "Higher coverage"],
      `got: ${l.join(", ")}`);
  });

  it("evidence includes tailored fit", () => {
    assert.ok(allEvidence(interpretGarment(beigeTrench, "OUTERWEAR")).includes("tailored fit"));
  });

  it("evidence includes belted waist", () => {
    assert.ok(allEvidence(interpretGarment(beigeTrench, "OUTERWEAR")).includes("belted waist"));
  });

  it("evidence includes midi length", () => {
    assert.ok(allEvidence(interpretGarment(beigeTrench, "OUTERWEAR")).includes("midi length"));
  });

  it("evidence includes solid neutral beige (Understated signal)", () => {
    assert.ok(allEvidence(interpretGarment(beigeTrench, "OUTERWEAR")).includes("solid neutral beige"));
  });

  it("evidence includes trench coat construction", () => {
    assert.ok(allEvidence(interpretGarment(beigeTrench, "OUTERWEAR")).includes("trench coat construction"));
  });

  it("hasInterpretation is true", () => {
    assert.equal(interpretGarment(beigeTrench, "OUTERWEAR").hasInterpretation, true);
  });
});

// ── §GS-07 Forbidden vocabulary ───────────────────────────────────────────────

describe("§GS-07 Forbidden vocabulary never emitted", () => {
  const garments: Array<[string, ClosetClassification, string]> = [
    ["tailored trench", {
      ...blank(), fitProfile: "tailored", formality: "business-casual",
      stylePersonality: "classic-polished", pattern: "solid", primaryColor: "black",
      styleTags: ["polished", "structured"],
    }, "OUTERWEAR"],
    ["casual tee", {
      ...blank(), fitProfile: "relaxed", formality: "casual", pattern: "solid",
      primaryColor: "white",
    }, "TOPS"],
    ["bold-edgy leather look", {
      ...blank(), stylePersonality: "bold-edgy", styleTags: ["edgy", "bold"],
      material: "leather",
    }, "TOPS"],
    ["floral dress", {
      ...blank(), pattern: "floral", formality: "occasion",
      stylePersonality: "feminine-romantic",
    }, "DRESSES"],
  ];

  for (const [name, c, cat] of garments) {
    for (const forbidden of FORBIDDEN_VOCABULARY) {
      it(`"${forbidden}" does not appear in output for ${name}`, () => {
        const r = interpretGarment(c, cat);
        const allText = [
          ...r.labels.map(l => l.label.toLowerCase()),
          ...r.evidence.map(e => e.toLowerCase()),
        ].join(" ");
        assert.ok(
          !allText.includes(forbidden),
          `forbidden word "${forbidden}" found in output for ${name}: "${allText}"`,
        );
      });
    }
  }
});

// ── §GS-08 Empty / sparse input ───────────────────────────────────────────────

describe("§GS-08 Empty and sparse input", () => {
  it("all-null classification → hasInterpretation: false, no labels", () => {
    const r = interpretGarment(blank(), "TOPS");
    assert.equal(r.hasInterpretation, false);
    assert.equal(r.labels.length, 0);
    assert.equal(r.evidence.length, 0);
  });

  it("only primaryColor=red with solid pattern → no Visual character (colour alone is not sufficient)", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "red" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Distinctive"), "red solid must NOT be Distinctive under new rules");
    assert.ok(!l.includes("Understated"), "red is not neutral — not Understated");
    assert.ok(!l.includes("Structured") && !l.includes("Polished") && !l.includes("Higher coverage"));
  });

  it("only pattern=solid with no colour → Visual character absent", () => {
    const c = { ...blank(), pattern: "solid" }; // no primaryColor
    // can't determine Understated without colour, but also no Distinctive/Statement
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Understated"),
      "Understated requires both solid pattern AND neutral colour");
  });
});

// ── §GS-09 Phase 2B corrections validated ─────────────────────────────────────

describe("§GS-09 Phase 2B corrections", () => {
  it("a-line silhouette + no other signals → no Fluid (a-line can be structured)", () => {
    const c = { ...blank(), silhouette: "a-line" };
    assert.ok(!labels(interpretGarment(c, "DRESSES")).includes("Fluid"));
  });

  it("balloon silhouette alone → no Fluid", () => {
    const c = { ...blank(), silhouette: "balloon" };
    assert.ok(!labels(interpretGarment(c, "DRESSES")).includes("Fluid"));
  });

  it("leather material does not alone produce any Style identity label", () => {
    const c = { ...blank(), material: "leather" };
    const l = labels(interpretGarment(c, "BAGS"));
    const identityLabels = ["Classic", "Minimal", "Romantic", "Edgy", "Creative", "Trend-led"];
    assert.ok(!identityLabels.some(id => l.includes(id)),
      `unexpected style identity from leather alone: ${l.join(", ")}`);
  });

  it("trench coat subcategory alone → no Classic (subcategory not sufficient)", () => {
    const c = { ...blank(), subcategory: "trench coat" };
    assert.ok(!labels(interpretGarment(c, "OUTERWEAR")).includes("Classic"));
  });

  it("blazer subcategory alone → no Classic", () => {
    const c = { ...blank(), subcategory: "blazer" };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("smart-casual → Smart regardless of fit profile", () => {
    for (const fp of ["tailored", "structured", "fitted"] as const) {
      const c = { ...blank(), formality: "smart-casual", fitProfile: fp };
      const l = labels(interpretGarment(c, "TOPS"));
      assert.ok(l.includes("Smart"), `${fp} + smart-casual should give Smart`);
      assert.ok(!l.includes("Polished"), `${fp} + smart-casual must not give Polished`);
    }
  });

  it("Statement wins over Understated for solid neutral piece with bold tag", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "beige", styleTags: ["bold"] };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(l.includes("Statement"));
    assert.ok(!l.includes("Understated"));
  });
});

// ── §GS-10 List view independence ─────────────────────────────────────────────

describe("§GS-10 List view does not use garment semantics", () => {
  it("garment-semantics.server is not imported by the list route", async () => {
    const src = await import("node:fs/promises");
    const content = await src.readFile(
      new URL("../../routes/admin.naia.closet._index.tsx", import.meta.url),
      "utf-8",
    );
    assert.ok(
      !content.includes("garment-semantics"),
      "list route must not import garment-semantics",
    );
  });
});

// ── §GS-11 No editing exposed ─────────────────────────────────────────────────

describe("§GS-11 No editing or mutation exports", () => {
  it("garment-semantics.server has no mutation exports", async () => {
    const src = await import("node:fs/promises");
    const content = await src.readFile(
      new URL("./garment-semantics.server.ts", import.meta.url),
      "utf-8",
    );
    const mutationKeywords = ["action", "mutation", "update", "delete", "save", "override", "edit"];
    for (const kw of mutationKeywords) {
      assert.ok(
        !content.toLowerCase().includes(`export.*${kw}`),
        `garment-semantics.server must not export mutation: ${kw}`,
      );
    }
  });

  it("detail route action (Phase 3A) handles only permitted intents", async () => {
    const src = await import("node:fs/promises");
    const content = await src.readFile(
      new URL("../../routes/admin.naia.closet.$itemId.tsx", import.meta.url),
      "utf-8",
    );
    // Phase 3A adds an action — verify the three permitted intents are present
    assert.ok(
      content.includes('"mark-correct"') &&
      content.includes('"save-overrides"') &&
      content.includes('"revert-field"'),
      "Phase 3A action must handle mark-correct, save-overrides, and revert-field",
    );
    // Reviewer identity must come from session, never from form
    assert.ok(
      content.includes("session.identity.email"),
      "reviewer identity must come from session.identity.email",
    );
  });
});

// ── §GS-13 Phase 2B Refinements (live QA pass) ───────────────────────────────

describe("§GS-13 Phase 2B Refinements", () => {

  // Visual character — Understated normalisation
  it("neutral solid white → Understated (uppercase/case-normalisation fix)", () => {
    // DB may store "Solid" or "WHITE" — normalise before comparing.
    const c = { ...blank(), pattern: "Solid", primaryColor: "White" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(l.includes("Understated"), `expected Understated, got: ${l.join(", ")}`);
  });

  it("neutral solid beige → Understated (generic rule, not hardcoded)", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "beige" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Understated"));
  });

  // Visual character — colour-alone restriction
  it("mauve solid alone → no Visual character (mauve is non-neutral but no pattern/construction)", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "mauve" };
    const l = labels(interpretGarment(c, "ACTIVEWEAR"));
    assert.ok(!l.includes("Distinctive"), "mauve solid must NOT be Distinctive");
    assert.ok(!l.includes("Understated"), "mauve is not a neutral colour");
  });

  it("blue solid alone → no Visual character", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "blue" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Distinctive") && !l.includes("Understated") && !l.includes("Statement"));
  });

  it("green solid alone → no Visual character", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "green" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(!l.includes("Distinctive") && !l.includes("Understated") && !l.includes("Statement"));
  });

  // Visual character — construction-based Distinctive
  it("asymmetric silhouette → Distinctive (construction signal, colour irrelevant)", () => {
    const c = { ...blank(), silhouette: "asymmetric", pattern: "solid", primaryColor: "black" };
    const r = interpretGarment(c, "DRESSES");
    assert.ok(labels(r).includes("Distinctive"), `expected Distinctive, got: ${labels(r).join(", ")}`);
    assert.ok(r.evidence.some(e => e.includes("asymmetric")), "evidence should mention asymmetric");
  });

  // Visual character — precedence
  it("Statement beats Distinctive: floral pattern + asymmetric silhouette → Statement", () => {
    const c = { ...blank(), pattern: "floral", silhouette: "asymmetric" };
    const l = labels(interpretGarment(c, "DRESSES"));
    assert.ok(l.includes("Statement"), "Statement should win");
    assert.ok(!l.includes("Distinctive"), "Distinctive must not appear when Statement fires");
  });

  it("Distinctive beats Understated: check pattern + neutral colour → Distinctive", () => {
    const c = { ...blank(), pattern: "check", primaryColor: "white" };
    const l = labels(interpretGarment(c, "TOPS"));
    assert.ok(l.includes("Distinctive"));
    assert.ok(!l.includes("Understated"));
  });

  // Activity — Sporty
  it("ACTIVEWEAR category → Sporty", () => {
    const c = { ...blank(), formality: "casual" };
    const r = interpretGarment(c, "ACTIVEWEAR");
    assert.ok(labels(r).includes("Sporty"), `expected Sporty, got: ${labels(r).join(", ")}`);
    assert.ok(r.evidence.includes("activewear category"));
  });

  it("sports bra subcategory → Sporty (regardless of category)", () => {
    const c = { ...blank(), subcategory: "sports bra", formality: "casual" };
    const r = interpretGarment(c, "ACTIVEWEAR");
    assert.ok(labels(r).includes("Sporty"));
    assert.ok(r.evidence.includes("sports bra construction"));
  });

  it("athletic running shoes subcategory → Sporty (SHOES category)", () => {
    const c = { ...blank(), subcategory: "athletic running shoes", formality: "casual" };
    const r = interpretGarment(c, "SHOES");
    assert.ok(labels(r).includes("Sporty"), `expected Sporty, got: ${labels(r).join(", ")}`);
  });

  it("gym occasion alone does NOT create Sporty", () => {
    const c = { ...blank(), occasions: ["gym", "casual"], formality: "casual" };
    const r = interpretGarment(c, "TOPS");
    assert.ok(!labels(r).includes("Sporty"), "gym occasion alone must not trigger Sporty");
  });

  it("Sporty can coexist with Minimal", () => {
    const c = {
      ...blank(),
      subcategory: "sports bra", formality: "casual",
      stylePersonality: "minimal-relaxed",
    };
    const l = labels(interpretGarment(c, "ACTIVEWEAR"));
    assert.ok(l.includes("Sporty") && l.includes("Minimal"),
      `expected both Sporty and Minimal, got: ${l.join(", ")}`);
  });

  // Polish — formality-vs-occasion authority
  it("smart-casual formality + evening occasion → Smart, NOT Dressy", () => {
    const c = { ...blank(), formality: "smart-casual", occasions: ["evening", "special-occasion"] };
    const pol = interpretGarment(c, "DRESSES").labels.find(l => l.dimension === "Polish");
    assert.equal(pol?.label, "Smart", `formality must win; got: ${pol?.label}`);
  });

  it("business-casual formality + evening occasion → Polished, NOT Dressy", () => {
    const c = { ...blank(), formality: "business-casual", occasions: ["evening"] };
    const pol = interpretGarment(c, "TOPS").labels.find(l => l.dimension === "Polish");
    assert.equal(pol?.label, "Polished", `formality must win; got: ${pol?.label}`);
  });

  it("occasion fallback only when formality absent: casual formality + date-night → Casual", () => {
    const c = { ...blank(), formality: "casual", occasions: ["date-night"] };
    const pol = interpretGarment(c, "TOPS").labels.find(l => l.dimension === "Polish");
    assert.equal(pol?.label, "Casual");
  });

  it("occasion fallback active when formality absent: no formality + date-night → Dressy", () => {
    const c = { ...blank(), formality: null, occasions: ["date-night"] };
    const pol = interpretGarment(c, "TOPS").labels.find(l => l.dimension === "Polish");
    assert.equal(pol?.label, "Dressy");
  });

  // WHY — per-label evidence
  it("every label carries at least one evidence item", () => {
    const c = {
      ...blank(),
      fitProfile: "tailored", formality: "business-casual",
      stylePersonality: "classic-polished", pattern: "solid", primaryColor: "beige",
      hemLength: "midi", sleeveLength: "full", shoulderCoverage: true, waistShape: "belted",
      subcategory: "trench coat",
    };
    const r = interpretGarment(c, "OUTERWEAR");
    assert.ok(r.labels.length > 0, "expected labels");
    r.labels.forEach(lbl => {
      assert.ok(lbl.evidence.length > 0, `label "${lbl.label}" has no evidence`);
    });
  });

  it("Understated label evidence is a single human-readable string", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "beige" };
    const r = interpretGarment(c, "TOPS");
    const vc = r.labels.find(l => l.dimension === "Visual character");
    assert.equal(vc?.label, "Understated");
    assert.equal(vc?.evidence.length, 1);
    assert.ok(vc?.evidence[0].includes("beige"), `expected beige in evidence: ${vc?.evidence[0]}`);
  });

  // Four live QA acceptance targets
  it("LIVE: beige trench → Structured · Polished · Classic · Understated · Higher coverage", () => {
    const c = {
      ...blank(),
      subcategory: "trench coat", fitProfile: "tailored",
      formality: "business-casual", stylePersonality: "classic-polished",
      pattern: "solid", primaryColor: "beige",
      hemLength: "midi", sleeveLength: "full",
      shoulderCoverage: true, waistShape: "belted",
      styleTags: ["classic", "elevated"], occasions: ["work", "travel"],
    };
    const l = labels(interpretGarment(c, "OUTERWEAR"));
    assert.deepEqual(l, ["Structured", "Polished", "Classic", "Understated", "Higher coverage"]);
  });

  it("LIVE: mauve sports bra → Casual · Sporty · Minimal · Lower coverage", () => {
    const c = {
      ...blank(),
      subcategory: "sports bra", fitProfile: "fitted",
      formality: "casual", stylePersonality: "minimal-relaxed",
      pattern: "solid", primaryColor: "mauve",
      sleeveLength: "sleeveless", midriffExposed: true,
      styleTags: ["minimal", "clean", "contemporary"],
    };
    const l = labels(interpretGarment(c, "ACTIVEWEAR"));
    assert.deepEqual(l, ["Casual", "Sporty", "Minimal", "Lower coverage"]);
  });

  it("LIVE: black draped maxi skirt → Fluid · Smart · Romantic · Distinctive", () => {
    const c = {
      ...blank(),
      fitProfile: "flowy", formality: "smart-casual",
      stylePersonality: "feminine-romantic",
      pattern: "solid", primaryColor: "black",
      hemLength: "maxi", silhouette: "asymmetric",
      occasions: ["evening", "special-occasion", "casual"],
      styleTags: ["feminine"],
    };
    const l = labels(interpretGarment(c, "BOTTOMS"));
    assert.deepEqual(l, ["Fluid", "Smart", "Romantic", "Distinctive"]);
  });

  it("LIVE: white running sneakers → Casual · Sporty · Minimal · Understated", () => {
    const c = {
      ...blank(),
      subcategory: "athletic running shoes",
      formality: "casual", stylePersonality: "minimal-relaxed",
      pattern: "solid", primaryColor: "white",
      occasions: ["gym", "casual", "travel"],
      styleTags: ["minimal", "clean", "contemporary"],
    };
    const l = labels(interpretGarment(c, "SHOES"));
    assert.deepEqual(l, ["Casual", "Sporty", "Minimal", "Understated"]);
  });
});

// ── §GS-14 Final contract corrections ────────────────────────────────────────

describe("§GS-14 Final contract corrections", () => {

  // Null pattern must not mean Understated
  it("solid + neutral beige → Understated (solid is explicit evidence)", () => {
    const c = { ...blank(), pattern: "solid", primaryColor: "beige" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Understated"));
  });

  it("solid + neutral white → Understated (case-normalised)", () => {
    const c = { ...blank(), pattern: "Solid", primaryColor: "White" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Understated"));
  });

  it("null pattern + neutral beige → NOT Understated (null = unknown, not plain)", () => {
    const c = { ...blank(), pattern: null, primaryColor: "beige" };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Understated"),
      "null pattern must not trigger Understated — it is unknown, not solid");
  });

  it("null pattern + neutral white → NOT Understated", () => {
    const c = { ...blank(), pattern: null, primaryColor: "white" };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Understated"));
  });

  it("null pattern + neutral colour + asymmetric silhouette → Distinctive (null pattern does not block construction evidence)", () => {
    const c = { ...blank(), pattern: null, primaryColor: "beige", silhouette: "asymmetric" };
    const l = labels(interpretGarment(c, "DRESSES"));
    assert.ok(l.includes("Distinctive"), "asymmetric silhouette must still fire Distinctive when pattern is null");
    assert.ok(!l.includes("Understated"), "Distinctive wins and null pattern alone would not give Understated");
  });

  // Classic tag restrictions
  it("elevated tag alone → NOT Classic (elevated is a polish concept)", () => {
    const c = { ...blank(), styleTags: ["elevated"] };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Classic"),
      "elevated alone must not trigger Classic — it signals Polished");
  });

  it("refined tag alone → NOT Classic (refined is a polish concept)", () => {
    const c = { ...blank(), styleTags: ["refined"] };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("polished tag alone → NOT Classic", () => {
    const c = { ...blank(), styleTags: ["polished"] };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("sophisticated tag alone → NOT Classic", () => {
    const c = { ...blank(), styleTags: ["sophisticated"] };
    assert.ok(!labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("classic tag → Classic ✓", () => {
    const c = { ...blank(), styleTags: ["classic"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("timeless tag → Classic ✓", () => {
    const c = { ...blank(), styleTags: ["timeless"] };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  it("classic-polished personality → Classic ✓", () => {
    const c = { ...blank(), stylePersonality: "classic-polished" };
    assert.ok(labels(interpretGarment(c, "TOPS")).includes("Classic"));
  });

  // Four live QA garments unchanged
  it("LIVE: beige trench still → Structured · Polished · Classic · Understated · Higher coverage", () => {
    const c = {
      ...blank(),
      subcategory: "trench coat", fitProfile: "tailored",
      formality: "business-casual", stylePersonality: "classic-polished",
      pattern: "solid", primaryColor: "beige",
      hemLength: "midi", sleeveLength: "full",
      shoulderCoverage: true, waistShape: "belted",
      styleTags: ["classic", "elevated"], occasions: ["work", "travel"],
    };
    assert.deepEqual(
      labels(interpretGarment(c, "OUTERWEAR")),
      ["Structured", "Polished", "Classic", "Understated", "Higher coverage"],
    );
  });

  it("LIVE: mauve sports bra still → Casual · Sporty · Minimal · Lower coverage", () => {
    const c = {
      ...blank(),
      subcategory: "sports bra", fitProfile: "fitted",
      formality: "casual", stylePersonality: "minimal-relaxed",
      pattern: "solid", primaryColor: "mauve",
      sleeveLength: "sleeveless", midriffExposed: true,
      styleTags: ["minimal", "clean", "contemporary"],
    };
    assert.deepEqual(
      labels(interpretGarment(c, "ACTIVEWEAR")),
      ["Casual", "Sporty", "Minimal", "Lower coverage"],
    );
  });

  it("LIVE: black draped maxi skirt still → Fluid · Smart · Romantic · Distinctive", () => {
    const c = {
      ...blank(),
      fitProfile: "flowy", formality: "smart-casual",
      stylePersonality: "feminine-romantic",
      pattern: "solid", primaryColor: "black",
      hemLength: "maxi", silhouette: "asymmetric",
      occasions: ["evening", "special-occasion", "casual"],
      styleTags: ["feminine"],
    };
    assert.deepEqual(
      labels(interpretGarment(c, "BOTTOMS")),
      ["Fluid", "Smart", "Romantic", "Distinctive"],
    );
  });

  it("LIVE: white running sneakers still → Casual · Sporty · Minimal · Understated", () => {
    const c = {
      ...blank(),
      subcategory: "athletic running shoes",
      formality: "casual", stylePersonality: "minimal-relaxed",
      pattern: "solid", primaryColor: "white",
      occasions: ["gym", "casual", "travel"],
      styleTags: ["minimal", "clean", "contemporary"],
    };
    assert.deepEqual(
      labels(interpretGarment(c, "SHOES")),
      ["Casual", "Sporty", "Minimal", "Understated"],
    );
  });
});

// ── §GS-12 Phase boundary — no StyleMe contamination ─────────────────────────

describe("§GS-12 Phase boundary — no StyleMe imports", () => {
  it("garment-semantics.server does not import any StyleMe file", async () => {
    const src = await import("node:fs/promises");
    const content = await src.readFile(
      new URL("./garment-semantics.server.ts", import.meta.url),
      "utf-8",
    );
    // Only scan import declarations, not comments or prose.
    const importLines = content
      .split("\n")
      .filter(line => /^\s*import\s/.test(line))
      .join("\n")
      .toLowerCase();
    const styleFiles = ["styleme", "style-me", "styleme-recommendation", "outfit", "result.server"];
    for (const sf of styleFiles) {
      assert.ok(
        !importLines.includes(sf),
        `garment-semantics.server must not import StyleMe-related file: ${sf}`,
      );
    }
  });
});
