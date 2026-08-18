// app/lib/professional-lens-content.phase3.test.ts
// Phase 3 structural contract tests — Professional Lens Differentiation.
// Verifies: Designer ordering, Buyer deduplication, Marketer WHAT NOT TO DO
// removal + BRIEF AGAINST addition, CD consolidation, Stylist prescription,
// public report Rising/Fading unchanged.
//
// Run: node --test --import tsx/esm app/lib/professional-lens-content.phase3.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROFESSIONAL_LENS_CONTENT,
  VALID_LENSES,
  type LensModule,
} from "./professional-lens-content.js";
import { trendReports } from "./trend-reports.js";

const REPORTS = [
  "spring-2026-soft-structure",
  "modern-tailoring-spring-2026",
  "spring-2026-colour-direction",
] as const;

const LENSES = Array.from(VALID_LENSES) as string[];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getModules(report: string, lens: string): LensModule[] {
  const r = PROFESSIONAL_LENS_CONTENT[report];
  assert.ok(r, `Report not found: ${report}`);
  const l = r[lens as keyof typeof r];
  assert.ok(l, `Lens not found: ${lens} in ${report}`);
  return l.modules as LensModule[];
}

function labelOf(m: LensModule): string {
  return (m as { label: string }).label;
}

function typeOf(m: LensModule): string | undefined {
  return (m as { type?: string }).type;
}

function hasLabel(modules: LensModule[], label: string): boolean {
  return modules.some((m) => labelOf(m) === label);
}

// ─── Structural coverage: all 15 combinations exist ──────────────────────────

describe("all 15 report/lens combinations present", () => {
  for (const report of REPORTS) {
    for (const lens of LENSES) {
      it(`${report} / ${lens}`, () => {
        const modules = getModules(report, lens);
        assert.ok(modules.length > 0, "modules array must not be empty");
      });
    }
  }
});

// ─── Designer ordering ────────────────────────────────────────────────────────

describe("Designer: WHAT NOT TO COPY before PRODUCT TRANSLATION", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "designer");
      const wntcIndex = modules.findIndex((m) => labelOf(m) === "WHAT NOT TO COPY");
      const ptIndex = modules.findIndex((m) => labelOf(m) === "THE PRODUCT TRANSLATION");
      assert.ok(wntcIndex !== -1, "WHAT NOT TO COPY must exist");
      assert.ok(ptIndex !== -1, "THE PRODUCT TRANSLATION must exist");
      assert.ok(
        wntcIndex < ptIndex,
        `WHAT NOT TO COPY (${wntcIndex}) must come before THE PRODUCT TRANSLATION (${ptIndex})`,
      );
    });
  }
});

describe("Designer: WHAT NOT TO COPY before DESIGN DECISIONS", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "designer");
      const wntcIndex = modules.findIndex((m) => labelOf(m) === "WHAT NOT TO COPY");
      const ddIndex = modules.findIndex((m) => labelOf(m) === "DESIGN DECISIONS");
      assert.ok(wntcIndex < ddIndex, "WHAT NOT TO COPY must precede DESIGN DECISIONS");
    });
  }
});

describe("Designer: THE DESIGN CODE is first module", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "designer");
      assert.equal(labelOf(modules[0]), "THE DESIGN CODE");
    });
  }
});

// ─── Buyer: deduplication ────────────────────────────────────────────────────

describe("Buyer: BUYING DEPTH present", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "buyer");
      assert.ok(hasLabel(modules, "BUYING DEPTH"), "BUYING DEPTH must exist");
    });
  }
});

describe("Buyer: COMMERCIAL CONFIDENCE removed", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "buyer");
      assert.ok(!hasLabel(modules, "COMMERCIAL CONFIDENCE"), "COMMERCIAL CONFIDENCE must be removed");
    });
  }
});

describe("Buyer: DEPTH RECOMMENDATION removed", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "buyer");
      assert.ok(!hasLabel(modules, "DEPTH RECOMMENDATION"), "DEPTH RECOMMENDATION must be removed");
    });
  }
});

describe("Buyer: BUYING DEPTH has 3 rows (BUY DEEPER / TEST LIGHTLY / HOLD OFF)", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "buyer");
      const bd = modules.find((m) => labelOf(m) === "BUYING DEPTH") as {
        type: string;
        rows: { label: string }[];
      };
      assert.ok(bd, "BUYING DEPTH must exist");
      assert.equal(bd.type, "stacked-rows");
      const rowLabels = bd.rows.map((r) => r.label);
      assert.ok(rowLabels.includes("BUY DEEPER"), "must have BUY DEEPER row");
      assert.ok(rowLabels.includes("TEST LIGHTLY"), "must have TEST LIGHTLY row");
      assert.ok(rowLabels.includes("HOLD OFF"), "must have HOLD OFF row");
    });
  }
});

// ─── Marketer: WHAT NOT TO DO removed; BRIEF AGAINST added ──────────────────

describe("Marketer: WHAT NOT TO DO removed", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "marketer");
      assert.ok(!hasLabel(modules, "WHAT NOT TO DO"), "WHAT NOT TO DO must be removed");
    });
  }
});

describe("Marketer: COPY RULES has BRIEF AGAINST row", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "marketer");
      const cr = modules.find((m) => labelOf(m) === "COPY RULES") as {
        type: string;
        rows: { label: string }[];
      };
      assert.ok(cr, "COPY RULES must exist");
      assert.equal(cr.type, "stacked-rows");
      const rowLabels = cr.rows.map((r) => r.label);
      assert.ok(rowLabels.includes("SAY"), "must have SAY row");
      assert.ok(rowLabels.includes("AVOID"), "must have AVOID row");
      assert.ok(rowLabels.includes("BRIEF AGAINST"), "must have BRIEF AGAINST row");
      assert.equal(cr.rows.length, 3, "COPY RULES must have exactly 3 rows");
    });
  }
});

// ─── Creative Director: consolidation 9→6 ────────────────────────────────────

describe("Creative Director: 6 modules", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "creative-director");
      assert.equal(modules.length, 6, `CD must have 6 modules, got ${modules.length}`);
    });
  }
});

describe("Creative Director: THE CREATIVE BRIEF present (merged READ + VISUAL WORLD)", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "creative-director");
      assert.ok(hasLabel(modules, "THE CREATIVE BRIEF"), "THE CREATIVE BRIEF must exist");
      assert.ok(!hasLabel(modules, "THE CREATIVE READ"), "THE CREATIVE READ must be merged away");
      assert.ok(!hasLabel(modules, "THE VISUAL WORLD"), "THE VISUAL WORLD must be merged away");
    });
  }
});

describe("Creative Director: THE IMAGE present (merged IMAGE MUST PROVE + IMAGE LANGUAGE)", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "creative-director");
      assert.ok(hasLabel(modules, "THE IMAGE"), "THE IMAGE must exist");
      assert.ok(!hasLabel(modules, "THE IMAGE MUST PROVE"), "THE IMAGE MUST PROVE must be merged");
      assert.ok(!hasLabel(modules, "IMAGE LANGUAGE"), "IMAGE LANGUAGE must be merged");
    });
  }
});

describe("Creative Director: CAST & SET present (merged CASTING + ENERGY + SET + ATMOSPHERE)", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "creative-director");
      assert.ok(hasLabel(modules, "CAST & SET"), "CAST & SET must exist");
      assert.ok(!hasLabel(modules, "CASTING + ENERGY"), "CASTING + ENERGY must be merged");
      assert.ok(!hasLabel(modules, "SET + ATMOSPHERE"), "SET + ATMOSPHERE must be merged");
    });
  }
});

describe("Creative Director: STYLING DIRECTION retained", () => {
  for (const report of REPORTS) {
    it(report, () => {
      assert.ok(hasLabel(getModules(report, "creative-director"), "STYLING DIRECTION"));
    });
  }
});

describe("Creative Director: CREATIVE RISK retained", () => {
  for (const report of REPORTS) {
    it(report, () => {
      assert.ok(hasLabel(getModules(report, "creative-director"), "CREATIVE RISK"));
    });
  }
});

describe("Creative Director: last module is THE DIRECTION (highlight)", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "creative-director");
      const last = modules[modules.length - 1];
      assert.equal(labelOf(last), "THE DIRECTION");
      assert.equal(typeOf(last), "highlight");
    });
  }
});

// ─── Stylist: prescription modules intact ─────────────────────────────────────

describe("Stylist: key prescription modules present", () => {
  const required = ["HOW TO STYLE IT", "THE FORMULA", "THE MIRROR TEST"];
  for (const report of REPORTS) {
    for (const label of required) {
      it(`${report} / ${label}`, () => {
        assert.ok(hasLabel(getModules(report, "stylist"), label), `${label} must exist`);
      });
    }
  }
});

describe("Stylist: last module is THE STYLING DECISION (highlight)", () => {
  for (const report of REPORTS) {
    it(report, () => {
      const modules = getModules(report, "stylist");
      const last = modules[modules.length - 1];
      assert.equal(labelOf(last), "THE STYLING DECISION");
      assert.equal(typeOf(last), "highlight");
    });
  }
});

// ─── Public report Rising/Fading unchanged (Phase 2 guard) ───────────────────

describe("Public report: Rising signals still TrendSignal[] with signal/why/source", () => {
  for (const report of trendReports.filter((r) => r.rising && r.rising.length > 0)) {
    it(report.slug, () => {
      for (const sig of report.rising!) {
        assert.ok(typeof sig.signal === "string", "signal must be string");
        assert.ok(typeof sig.why === "string", "why must be string");
        assert.ok(typeof sig.source === "string", "source must be string");
        assert.ok(sig.signal.length > 0, "signal must not be empty");
      }
    });
  }
});

describe("Public report: Fading signals still TrendSignal[] with signal/why/source", () => {
  for (const report of trendReports.filter((r) => r.fading && r.fading.length > 0)) {
    it(report.slug, () => {
      for (const sig of report.fading!) {
        assert.ok(typeof sig.signal === "string", "signal must be string");
        assert.ok(typeof sig.why === "string", "why must be string");
        assert.ok(typeof sig.source === "string", "source must be string");
        assert.ok(sig.source.length > 0, "source must not be empty");
      }
    });
  }
});

// ─── All lenses end with a highlight (THE DECISION / THE DIRECTION / etc.) ──

describe("All lenses: last module is always a highlight type", () => {
  for (const report of REPORTS) {
    for (const lens of LENSES) {
      it(`${report} / ${lens}`, () => {
        const modules = getModules(report, lens);
        const last = modules[modules.length - 1];
        assert.equal(typeOf(last), "highlight", "last module must be highlight");
      });
    }
  }
});
