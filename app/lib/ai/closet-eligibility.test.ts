// app/lib/ai/closet-eligibility.test.ts
// Phase 4A6 — tests for closet image eligibility: Stage A (metadata), Stage B (visual),
// and Stage B + persistence (runStageBAssessment).
// Run: node --test --import tsx/esm app/lib/ai/closet-eligibility.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessClosetEligibility,
  isVtoCategoryAllowed,
  resolveActivewearVtoType,
  PRISMA_CATEGORY_MAP,
  CLOSET_ELIGIBILITY_DISPLAY,
  STAGE_A_CUSTOMER_HINTS,
  type AssessClosetEligibilityInput,
  type VtoWearableType,
} from "./closet-eligibility.ts";
import {
  assessClosetEligibilityStageB,
  runStageBAssessment,
  type StageBDbUpdater,
} from "./closet-eligibility.server.ts";

// Baseline "good" image metadata — passes all Stage A checks
const GOOD: Omit<AssessClosetEligibilityInput, "prismaCategory"> = {
  width: 1024,
  height: 1536,
  format: "jpg",
  bytes: 250_000,
};

// ── Helpers for Stage B testing ───────────────────────────────────────────────

type AnalyzerFn = (url: string, prompt: string) => Promise<string>;

const makeAnalyzer = (
  eligible: boolean,
  issues: string[] = [],
  reason = "test",
  customerMessage?: string | null,
): AnalyzerFn =>
  async () => JSON.stringify({ eligible, issues, reason, customerMessage: customerMessage ?? null });

const failingAnalyzer: AnalyzerFn = async () => {
  throw new Error("Network timeout");
};

const brokenJsonAnalyzer: AnalyzerFn = async () => "not json at all";

// ── Stage A: clothing categories ──────────────────────────────────────────────

describe("Stage A — supported clothing categories with good image → pending-assessment", () => {
  const clothingCats = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"] as const;

  for (const cat of clothingCats) {
    it(`${cat} → pending-assessment, null customerHint`, () => {
      const result = assessClosetEligibility({ prismaCategory: cat, ...GOOD });
      assert.equal(result.eligible, "pending-assessment");
      assert.equal(result.photoIssues.length, 0);
      assert.equal(result.customerHint, null);
    });
  }
});

// ── Stage A: shoes and bags are supported ─────────────────────────────────────

describe("Stage A — shoes and bags with good image → pending-assessment", () => {
  it("SHOES → pending-assessment, null customerHint", () => {
    const result = assessClosetEligibility({ prismaCategory: "SHOES", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "shoes");
    assert.equal(result.customerHint, null);
  });

  it("BAGS → pending-assessment, null customerHint", () => {
    const result = assessClosetEligibility({ prismaCategory: "BAGS", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "bags");
    assert.equal(result.customerHint, null);
  });
});

// ── Stage A: unsupported categories ──────────────────────────────────────────

describe("Stage A — unsupported categories → not-supported", () => {
  // ACTIVEWEAR without a subcategory remains blocked (no subcategory → cannot resolve type).
  // ACTIVEWEAR with a supported subcategory is tested separately below.
  const unsupportedCats = [
    "ACCESSORIES", "JEWELRY", "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR", "OTHER",
  ] as const;

  for (const cat of unsupportedCats) {
    it(`${cat} (no subcategory) → not-supported, null customerHint`, () => {
      const result = assessClosetEligibility({ prismaCategory: cat, ...GOOD });
      assert.equal(result.eligible, "not-supported");
      assert.equal(result.category, "unsupported");
      assert.equal(result.customerHint, null);
    });
  }

  it("unknown prismaCategory string → not-supported", () => {
    const result = assessClosetEligibility({ prismaCategory: "UNKNOWN_FUTURE_CAT", ...GOOD });
    assert.equal(result.eligible, "not-supported");
  });
});

// ── Stage A: accessory subcategory gate ───────────────────────────────────────

describe("Stage A — ACCESSORIES/JEWELRY with allowlisted subcategory → pending-assessment", () => {
  it("ACCESSORIES + subcategory 'scarf' → pending-assessment, category 'accessories'", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", subcategory: "scarf", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
    assert.equal(result.customerHint, null);
  });

  it("ACCESSORIES + subcategory 'belt' → pending-assessment", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", subcategory: "belt", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
  });

  it("JEWELRY + subcategory 'earrings' → pending-assessment", () => {
    const result = assessClosetEligibility({ prismaCategory: "JEWELRY", subcategory: "earrings", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
  });
  it("JEWELRY + subcategory 'hoop earrings' → pending-assessment (AI-generated descriptive value)", () => {
    const result = assessClosetEligibility({ prismaCategory: "JEWELRY", subcategory: "hoop earrings", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
  });
  it("JEWELRY + subcategory 'gold hoop earrings' → pending-assessment (AI-generated descriptive value)", () => {
    const result = assessClosetEligibility({ prismaCategory: "JEWELRY", subcategory: "gold hoop earrings", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
  });

  it("ACCESSORIES + subcategory 'hat' → pending-assessment", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", subcategory: "hat", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
  });
  it("ACCESSORIES + subcategory 'baseball cap' → pending-assessment (AI-generated descriptive value)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", subcategory: "baseball cap", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "accessories");
  });

  it("JEWELRY + non-allowlisted subcategory 'ring' → blocked (not-supported)", () => {
    const result = assessClosetEligibility({ prismaCategory: "JEWELRY", subcategory: "ring", ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });

  it("ACCESSORIES + null subcategory → blocked (not-supported)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", subcategory: null, ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });

  it("ACCESSORIES + missing subcategory → blocked (not-supported)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });

  it("TOPS eligibility unchanged when subcategory field is present", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS", subcategory: "scarf", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "tops");
  });

  it("SHOES eligibility unchanged by subcategory field", () => {
    const result = assessClosetEligibility({ prismaCategory: "SHOES", subcategory: "belt", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "shoes");
  });

  it("BAGS eligibility unchanged by subcategory field", () => {
    const result = assessClosetEligibility({ prismaCategory: "BAGS", subcategory: "earrings", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "bags");
  });
});

// ── isVtoCategoryAllowed — behavioral function tests ─────────────────────────
// These call the shared authorization function directly.
// The same function is used by the UI gate (closet._index.tsx) AND the trigger
// route (api.trigger-tryon.tsx), so these tests cover both.

describe("isVtoCategoryAllowed — main supported categories", () => {
  for (const cat of ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS"] as const) {
    it(`${cat} → allowed (no subcategory needed)`, () => {
      assert.equal(isVtoCategoryAllowed(cat), true);
    });
    it(`${cat} with irrelevant subcategory → still allowed`, () => {
      assert.equal(isVtoCategoryAllowed(cat, "anything"), true);
    });
  }
});

describe("isVtoCategoryAllowed — ACCESSORIES with allowlisted subcategory", () => {
  it("ACCESSORIES + 'scarf' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "scarf"), true);
  });
  it("ACCESSORIES + 'belt' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "belt"), true);
  });
  it("ACCESSORIES + subcategory with extra whitespace → allowed (trimmed)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "  scarf  "), true);
  });
  it("ACCESSORIES + uppercase subcategory → allowed (case-folded)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "BELT"), true);
  });
});

describe("isVtoCategoryAllowed — JEWELRY with allowlisted subcategory", () => {
  it("JEWELRY + 'earrings' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "earrings"), true);
  });
  it("JEWELRY + 'hoop earrings' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "hoop earrings"), true);
  });
  it("JEWELRY + 'gold earrings' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "gold earrings"), true);
  });
  it("JEWELRY + 'stud earrings' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "stud earrings"), true);
  });
  it("JEWELRY + 'HOOP EARRINGS' → allowed (case-folded)", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "HOOP EARRINGS"), true);
  });
});

describe("isVtoCategoryAllowed — ACCESSORIES with hat/headwear subcategory", () => {
  it("ACCESSORIES + 'hat' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "hat"), true);
  });
  it("ACCESSORIES + 'sun hat' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "sun hat"), true);
  });
  it("ACCESSORIES + 'bucket hat' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "bucket hat"), true);
  });
  it("ACCESSORIES + 'cowboy hat' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "cowboy hat"), true);
  });
  it("ACCESSORIES + 'wide-brim hat' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "wide-brim hat"), true);
  });
  it("ACCESSORIES + 'cap' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "cap"), true);
  });
  it("ACCESSORIES + 'baseball cap' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "baseball cap"), true);
  });
  it("ACCESSORIES + 'trucker cap' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "trucker cap"), true);
  });
  it("ACCESSORIES + 'beanie' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "beanie"), true);
  });
  it("ACCESSORIES + 'knit beanie' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "knit beanie"), true);
  });
  it("ACCESSORIES + 'beret' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "beret"), true);
  });
  it("ACCESSORIES + 'wool beret' → allowed (AI-generated descriptive value)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "wool beret"), true);
  });
  it("ACCESSORIES + 'BASEBALL CAP' → allowed (case-folded)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "BASEBALL CAP"), true);
  });
  it("ACCESSORIES + 'sunglasses' → still rejected (non-hat accessory)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "sunglasses"), false);
  });
  it("ACCESSORIES + 'watch' → still rejected (non-hat accessory)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "watch"), false);
  });
  it("ACCESSORIES + 'bracelet' → still rejected (non-hat accessory)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "bracelet"), false);
  });
});

describe("isVtoCategoryAllowed — rejected cases (FASHN must never be reached)", () => {
  it("ACCESSORIES + 'sunglasses' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "sunglasses"), false);
  });
  it("JEWELRY + 'ring' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "ring"), false);
  });
  it("JEWELRY + 'necklace' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "necklace"), false);
  });
  it("ACCESSORIES + null subcategory → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", null), false);
  });
  it("ACCESSORIES + undefined subcategory → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", undefined), false);
  });
  it("JEWELRY + null subcategory → rejected", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", null), false);
  });
  it("ACTIVEWEAR with no subcategory → rejected (cannot resolve garment type)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR"), false);
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", null), false);
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", ""), false);
  });
  it("ACTIVEWEAR with non-wearable subcategory (gloves) → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "gloves"), false);
  });
  it("ACTIVEWEAR with non-wearable subcategory (socks) → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "socks"), false);
  });
  it("ACTIVEWEAR with non-wearable subcategory (wrist guards) → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "wrist guards"), false);
  });
  it("ACTIVEWEAR with non-wearable subcategory (compression sleeves) → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "compression sleeves"), false);
  });
  it("SWIMWEAR → rejected", () => {
    assert.equal(isVtoCategoryAllowed("SWIMWEAR"), false);
  });
  it("LOUNGEWEAR → rejected", () => {
    assert.equal(isVtoCategoryAllowed("LOUNGEWEAR"), false);
  });
  it("OTHER → rejected", () => {
    assert.equal(isVtoCategoryAllowed("OTHER"), false);
  });
  it("unknown future category → rejected", () => {
    assert.equal(isVtoCategoryAllowed("SPORTSWEAR"), false);
  });
});

// ── Stage A: dimension checks ─────────────────────────────────────────────────

describe("Stage A — dimension issues → needs-clearer-photo with customerHint", () => {
  it("width below 300px → low-resolution, customer hint set", () => {
    const result = assessClosetEligibility({
      prismaCategory: "TOPS",
      width: 200, height: 400, format: "jpg", bytes: 50_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("low-resolution"));
    assert.equal(result.customerHint, STAGE_A_CUSTOMER_HINTS["low-resolution"]);
  });

  it("height below 300px → low-resolution", () => {
    const result = assessClosetEligibility({
      prismaCategory: "BOTTOMS",
      width: 600, height: 150, format: "png", bytes: 80_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("low-resolution"));
    assert.ok(result.customerHint !== null);
  });

  it("both dimensions below 300px → low-resolution", () => {
    const result = assessClosetEligibility({
      prismaCategory: "DRESSES",
      width: 100, height: 100, format: "jpg", bytes: 5_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("low-resolution"));
  });

  it("exactly 300×300 passes Stage A → pending-assessment", () => {
    const result = assessClosetEligibility({
      prismaCategory: "TOPS",
      width: 300, height: 300, format: "jpg", bytes: 30_000,
    });
    assert.equal(result.eligible, "pending-assessment");
  });
});

// ── Stage A: aspect ratio checks ──────────────────────────────────────────────

describe("Stage A — unusual aspect ratio → needs-clearer-photo with customerHint", () => {
  it("very wide image → unusual-aspect-ratio, customer hint set", () => {
    const result = assessClosetEligibility({
      prismaCategory: "TOPS",
      width: 2000, height: 400, format: "jpg", bytes: 200_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("unusual-aspect-ratio"));
    assert.equal(result.customerHint, STAGE_A_CUSTOMER_HINTS["unusual-aspect-ratio"]);
  });

  it("extreme portrait → unusual-aspect-ratio", () => {
    const result = assessClosetEligibility({
      prismaCategory: "BOTTOMS",
      width: 200, height: 2000, format: "jpg", bytes: 100_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("unusual-aspect-ratio"));
  });

  it("square image passes Stage A → pending-assessment", () => {
    const result = assessClosetEligibility({
      prismaCategory: "TOPS",
      width: 1024, height: 1024, format: "jpg", bytes: 200_000,
    });
    assert.equal(result.eligible, "pending-assessment");
  });

  it("standard portrait 2:3 passes Stage A → pending-assessment", () => {
    const result = assessClosetEligibility({ prismaCategory: "DRESSES", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
  });
});

// ── Stage A: file size check ──────────────────────────────────────────────────

describe("Stage A — tiny file size → needs-clearer-photo with customerHint", () => {
  it("file below 10 KB → tiny-file, customer hint set", () => {
    const result = assessClosetEligibility({
      prismaCategory: "TOPS",
      width: 1024, height: 1536, format: "jpg", bytes: 5_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("tiny-file"));
    assert.equal(result.customerHint, STAGE_A_CUSTOMER_HINTS["tiny-file"]);
  });

  it("exactly 10 KB passes Stage A → pending-assessment", () => {
    const result = assessClosetEligibility({
      prismaCategory: "TOPS",
      width: 1024, height: 1536, format: "jpg", bytes: 10_000,
    });
    assert.equal(result.eligible, "pending-assessment");
  });
});

// ── Stage A: format checks ────────────────────────────────────────────────────

describe("Stage A — format checks", () => {
  for (const fmt of ["jpg", "png", "webp", "heic"]) {
    it(`${fmt} passes Stage A → pending-assessment`, () => {
      const result = assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD, format: fmt });
      assert.equal(result.eligible, "pending-assessment");
    });
  }

  it("unsupported format (bmp) → not-supported with format customerHint", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD, format: "bmp" });
    assert.equal(result.eligible, "not-supported");
    assert.ok(result.photoIssues.includes("unsupported-format"));
    assert.equal(result.customerHint, STAGE_A_CUSTOMER_HINTS["unsupported-format"]);
  });

  it("unsupported format (tiff) → not-supported", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD, format: "tiff" });
    assert.equal(result.eligible, "not-supported");
  });

  it("missing format (undefined) does not block → pending-assessment", () => {
    const { format: _, ...noFormat } = GOOD;
    const result = assessClosetEligibility({ prismaCategory: "TOPS", ...noFormat });
    assert.equal(result.eligible, "pending-assessment");
  });
});

// ── Stage A: missing metadata ─────────────────────────────────────────────────

describe("Stage A — missing metadata (legacy or edge cases)", () => {
  it("no metadata, clothing → pending-assessment, null customerHint", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS" });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.customerHint, null);
  });

  it("no metadata, shoes → pending-assessment (shoes are supported)", () => {
    const result = assessClosetEligibility({ prismaCategory: "SHOES" });
    assert.equal(result.eligible, "pending-assessment");
  });

  it("no metadata, accessories → not-supported (category check fires first)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES" });
    assert.equal(result.eligible, "not-supported");
  });
});

// ── Stage A: result structure ─────────────────────────────────────────────────

describe("Stage A — result structure", () => {
  it("always includes assessedAt as ISO 8601", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD });
    assert.equal(new Date(result.assessedAt).toISOString(), result.assessedAt);
  });

  it("pending-assessment has empty photoIssues and null customerHint", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD });
    assert.equal(result.photoIssues.length, 0);
    assert.equal(result.customerHint, null);
  });

  it("not-supported for accessories has null customerHint", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACCESSORIES", ...GOOD });
    assert.equal(result.customerHint, null);
  });

  it("internalNote is populated for all outcomes", () => {
    const results = [
      assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD }),
      assessClosetEligibility({ prismaCategory: "ACCESSORIES", ...GOOD }),
      assessClosetEligibility({ prismaCategory: "TOPS", width: 100, height: 100, format: "jpg", bytes: 1000 }),
    ];
    for (const r of results) {
      assert.ok(r.internalNote.length > 0);
    }
  });
});

// ── STAGE_A_CUSTOMER_HINTS coverage ──────────────────────────────────────────

describe("STAGE_A_CUSTOMER_HINTS", () => {
  it("all four issue codes have a non-empty hint", () => {
    const codes = ["low-resolution", "tiny-file", "unusual-aspect-ratio", "unsupported-format"] as const;
    for (const code of codes) {
      assert.ok(STAGE_A_CUSTOMER_HINTS[code].length > 0, `missing hint for ${code}`);
    }
  });
});

// ── PRISMA_CATEGORY_MAP coverage ──────────────────────────────────────────────

describe("PRISMA_CATEGORY_MAP", () => {
  it("maps all expected Prisma categories", () => {
    const expected = [
      "TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS",
      "ACCESSORIES", "JEWELRY", "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR", "OTHER",
    ];
    for (const cat of expected) {
      assert.notEqual(PRISMA_CATEGORY_MAP[cat], undefined, `missing mapping for ${cat}`);
    }
  });
});

// ── CLOSET_ELIGIBILITY_DISPLAY coverage ──────────────────────────────────────

describe("CLOSET_ELIGIBILITY_DISPLAY", () => {
  const allStates = ["ready-for-try-on", "needs-clearer-photo", "not-supported", "pending-assessment"] as const;

  it("all four states have a non-empty label", () => {
    for (const key of allStates) {
      assert.ok(CLOSET_ELIGIBILITY_DISPLAY[key].label.length > 0, `missing label for ${key}`);
    }
  });

  it("ready-for-try-on has null fallbackHint", () => {
    assert.equal(CLOSET_ELIGIBILITY_DISPLAY["ready-for-try-on"].fallbackHint, null);
  });

  it("needs-clearer-photo has a fallbackHint", () => {
    assert.notEqual(CLOSET_ELIGIBILITY_DISPLAY["needs-clearer-photo"].fallbackHint, null);
  });

  it("pending-assessment has null fallbackHint", () => {
    assert.equal(CLOSET_ELIGIBILITY_DISPLAY["pending-assessment"].fallbackHint, null);
  });
});

// ── Stage B: supported categories — clear items → ready-for-try-on ────────────

describe("Stage B — clear item photos → ready-for-try-on, null customerHint", () => {
  const clearItems: Array<{ category: "tops" | "bottoms" | "dresses" | "outerwear" | "shoes" | "bags"; label: string }> = [
    { category: "tops",      label: "clear top" },
    { category: "bottoms",   label: "clear trousers/skirt" },
    { category: "dresses",   label: "dress" },
    { category: "outerwear", label: "outerwear" },
    { category: "shoes",     label: "shoes" },
    { category: "bags",      label: "bag" },
  ];

  for (const { category, label } of clearItems) {
    it(`${label} → ready-for-try-on, null customerHint`, async () => {
      const result = await assessClosetEligibilityStageB(
        "https://example.com/image.jpg",
        category,
        makeAnalyzer(true, [], "Clear single item"),
      );
      assert.equal(result.eligible, "ready-for-try-on");
      assert.equal(result.visualIssues.length, 0);
      assert.equal(result.customerHint, null);
    });
  }
});

// ── Stage B: photo quality issues → needs-clearer-photo with customerHint ────

describe("Stage B — photo quality issues → needs-clearer-photo with customerHint", () => {
  it("blurry image → needs-clearer-photo, specific customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/blurry.jpg",
      "tops",
      makeAnalyzer(false, ["blurry"], "Out of focus", "The image is too blurry. Retake it in good, even lighting."),
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("blurry"));
    assert.equal(result.customerHint, "The image is too blurry. Retake it in good, even lighting.");
  });

  it("obstructed item → needs-clearer-photo with customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/obstructed.jpg",
      "tops",
      makeAnalyzer(false, ["obstructed"], "Partially hidden", "The item is partially covered. Remove any objects covering it and retake the photo."),
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("obstructed"));
    assert.ok(result.customerHint !== null);
  });

  it("cropped item → needs-clearer-photo with customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/cropped.jpg",
      "dresses",
      makeAnalyzer(false, ["cropped-item"], "Hem cut off", "The hem is cut off. Retake the photo with the full garment visible."),
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("cropped-item"));
    assert.ok(result.customerHint !== null);
  });

  it("multiple items → needs-clearer-photo with customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/outfit.jpg",
      "tops",
      makeAnalyzer(false, ["multiple-items"], "Multiple garments", "More than one item is in the photo. Photograph one item at a time."),
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("multiple-items"));
    assert.ok(result.customerHint !== null);
  });

  it("category mismatch → needs-clearer-photo with customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/shoes.jpg",
      "tops",
      makeAnalyzer(false, ["category-mismatch"], "Category mismatch", "The uploaded item does not match the selected category. Check the category and try again."),
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("category-mismatch"));
    assert.ok(result.customerHint !== null);
  });
});

// ── Stage B: bag-specific hint ────────────────────────────────────────────────

describe("Stage B — bag with specific customerHint", () => {
  it("bag strap not visible → customerHint names the strap", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/bag.jpg",
      "bags",
      makeAnalyzer(false, ["obstructed"], "Strap hidden", "The bag strap is not fully visible. Retake the photo showing the complete bag."),
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.customerHint?.includes("strap"));
  });
});

// ── Stage B: non-fashion item → not-supported, null customerHint ──────────────

describe("Stage B — non-fashion item → not-supported, null customerHint", () => {
  it("non-fashion object → not-supported, no retake guidance", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/chair.jpg",
      "tops",
      makeAnalyzer(false, ["not-fashion-item"], "Not a garment", "This is not a fashion item."),
    );
    assert.equal(result.eligible, "not-supported");
    assert.ok(result.visualIssues.includes("not-fashion-item"));
    assert.equal(result.customerHint, null);
  });
});

// ── Stage B: assessment failure modes ─────────────────────────────────────────

describe("Stage B — assessment failure modes", () => {
  it("AI call throws → needs-clearer-photo, visual-assessment-failed, null customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/image.jpg",
      "tops",
      failingAnalyzer,
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("visual-assessment-failed"));
    assert.equal(result.customerHint, null);
  });

  it("AI returns broken JSON → needs-clearer-photo, null customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/image.jpg",
      "tops",
      brokenJsonAnalyzer,
    );
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("visual-assessment-failed"));
    assert.equal(result.customerHint, null);
  });

  it("JSON with non-boolean eligible → visual-assessment-failed", async () => {
    const badAnalyzer: AnalyzerFn = async () => JSON.stringify({ eligible: "yes", issues: [], reason: "test" });
    const result = await assessClosetEligibilityStageB("https://example.com/img.jpg", "tops", badAnalyzer);
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("visual-assessment-failed"));
    assert.equal(result.customerHint, null);
  });

  it("JSON with non-array issues → visual-assessment-failed", async () => {
    const badAnalyzer: AnalyzerFn = async () => JSON.stringify({ eligible: false, issues: "blurry", reason: "test" });
    const result = await assessClosetEligibilityStageB("https://example.com/img.jpg", "tops", badAnalyzer);
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("visual-assessment-failed"));
  });

  it("JSON missing both eligible and issues → visual-assessment-failed", async () => {
    const badAnalyzer: AnalyzerFn = async () => JSON.stringify({ reason: "test" });
    const result = await assessClosetEligibilityStageB("https://example.com/img.jpg", "tops", badAnalyzer);
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.visualIssues.includes("visual-assessment-failed"));
  });
});

// ── Stage B: result structure ─────────────────────────────────────────────────

describe("Stage B — result structure", () => {
  it("assessedAt is ISO 8601", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/image.jpg",
      "tops",
      makeAnalyzer(true),
    );
    assert.equal(new Date(result.assessedAt).toISOString(), result.assessedAt);
  });

  it("ready-for-try-on has empty visualIssues and null customerHint", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/image.jpg",
      "dresses",
      makeAnalyzer(true),
    );
    assert.equal(result.eligible, "ready-for-try-on");
    assert.equal(result.visualIssues.length, 0);
    assert.equal(result.customerHint, null);
  });

  it("internalNote is always populated", async () => {
    const result = await assessClosetEligibilityStageB(
      "https://example.com/image.jpg",
      "bags",
      makeAnalyzer(false, ["blurry"], "blurry", "Retake in better light."),
    );
    assert.ok(result.internalNote.length > 0);
  });
});

// ── pending-assessment state (Stage A output) ─────────────────────────────────

describe("pending-assessment as Stage A output", () => {
  it("Stage A pass produces eligible = pending-assessment", () => {
    const result = assessClosetEligibility({ prismaCategory: "TOPS", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
  });

  it("pending-assessment is in CLOSET_ELIGIBILITY_DISPLAY with a label", () => {
    const display = CLOSET_ELIGIBILITY_DISPLAY["pending-assessment"];
    assert.ok(display !== undefined);
    assert.ok(display.label.length > 0);
  });
});

// ── runStageBAssessment: awaited successful persistence ───────────────────────

describe("runStageBAssessment — awaited successful persistence", () => {
  it("persists ready-for-try-on with internalNote and null customerHint", async () => {
    let capturedId: string | null = null;
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (id, fields) => {
      capturedId = id;
      capturedFields = fields;
    };

    const outcome = await runStageBAssessment(
      "item-1",
      "https://example.com/img.jpg",
      "tops",
      dbUpdate,
      { _analyzer: makeAnalyzer(true, [], "Clear single item") },
    );

    assert.equal(outcome, "persisted");
    assert.equal(capturedId, "item-1");
    assert.ok(capturedFields !== null);
    assert.equal(capturedFields!.tryOnEligibility, "ready-for-try-on");
    assert.equal(capturedFields!.tryOnCustomerHint, null);
    assert.ok(capturedFields!.tryOnInternalNote.length > 0);
    assert.ok(capturedFields!.tryOnAssessedAt instanceof Date);
  });

  it("persists needs-clearer-photo for genuine photo issue", async () => {
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (_id, fields) => { capturedFields = fields; };

    const outcome = await runStageBAssessment(
      "item-2",
      "https://example.com/cropped.jpg",
      "dresses",
      dbUpdate,
      { _analyzer: makeAnalyzer(false, ["cropped-item"], "Hem cut off", "Retake with full item visible.") },
    );

    assert.equal(outcome, "persisted");
    assert.ok(capturedFields !== null);
    assert.equal(capturedFields!.tryOnEligibility, "needs-clearer-photo");
  });

  it("persists not-supported for non-fashion item", async () => {
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (_id, fields) => { capturedFields = fields; };

    const outcome = await runStageBAssessment(
      "item-3",
      "https://example.com/chair.jpg",
      "tops",
      dbUpdate,
      { _analyzer: makeAnalyzer(false, ["not-fashion-item"], "Not a garment", null) },
    );

    assert.equal(outcome, "persisted");
    assert.equal(capturedFields!.tryOnEligibility, "not-supported");
  });
});

// ── runStageBAssessment: customer hint persistence ────────────────────────────

describe("runStageBAssessment — customer hint persistence", () => {
  it("customer hint is included in DB update for photo issues", async () => {
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (_id, fields) => { capturedFields = fields; };

    await runStageBAssessment(
      "item-4",
      "https://example.com/blurry.jpg",
      "tops",
      dbUpdate,
      { _analyzer: makeAnalyzer(false, ["blurry"], "Blurry", "The image is blurry. Retake in better light.") },
    );

    assert.equal(capturedFields!.tryOnCustomerHint, "The image is blurry. Retake in better light.");
  });

  it("customer hint is null for eligible items", async () => {
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (_id, fields) => { capturedFields = fields; };

    await runStageBAssessment(
      "item-5",
      "https://example.com/clear.jpg",
      "bags",
      dbUpdate,
      { _analyzer: makeAnalyzer(true, [], "Clear bag") },
    );

    assert.equal(capturedFields!.tryOnCustomerHint, null);
  });
});

// ── runStageBAssessment: internal reason-code persistence ─────────────────────

describe("runStageBAssessment — internal reason-code persistence", () => {
  it("tryOnInternalNote is included in DB update", async () => {
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (_id, fields) => { capturedFields = fields; };

    await runStageBAssessment(
      "item-6",
      "https://example.com/img.jpg",
      "bags",
      dbUpdate,
      { _analyzer: makeAnalyzer(false, ["obstructed"], "Strap hidden", "Show the full bag.") },
    );

    assert.ok(capturedFields!.tryOnInternalNote.length > 0);
    assert.ok(capturedFields!.tryOnInternalNote.includes("obstructed"));
  });

  it("tryOnInternalNote uses internal phrasing, not raw provider output", async () => {
    let capturedFields: Parameters<StageBDbUpdater>[1] | null = null;
    const dbUpdate: StageBDbUpdater = async (_id, fields) => { capturedFields = fields; };

    await runStageBAssessment(
      "item-7",
      "https://example.com/img.jpg",
      "tops",
      dbUpdate,
      { _analyzer: makeAnalyzer(true, [], "Looks good") },
    );

    assert.ok(capturedFields!.tryOnInternalNote.startsWith("Stage B visual assessment:"));
  });
});

// ── runStageBAssessment: timeout preserves pending-assessment ─────────────────

describe("runStageBAssessment — timeout preserves pending-assessment", () => {
  it("timeout — dbUpdate is not called, outcome is 'timeout'", async () => {
    const neverResolve: AnalyzerFn = () => new Promise(() => {});
    let dbCalled = false;
    const dbUpdate: StageBDbUpdater = async () => { dbCalled = true; };

    const outcome = await runStageBAssessment(
      "item-8",
      "https://example.com/img.jpg",
      "tops",
      dbUpdate,
      { timeoutMs: 10, _analyzer: neverResolve },
    );

    assert.equal(outcome, "timeout");
    assert.equal(dbCalled, false);
  });
});

// ── runStageBAssessment: provider failure preserves pending-assessment ─────────

describe("runStageBAssessment — provider failure preserves pending-assessment", () => {
  it("AI throws — dbUpdate is not called, outcome is 'system-failure'", async () => {
    let dbCalled = false;
    const dbUpdate: StageBDbUpdater = async () => { dbCalled = true; };

    const outcome = await runStageBAssessment(
      "item-9",
      "https://example.com/img.jpg",
      "tops",
      dbUpdate,
      { _analyzer: failingAnalyzer },
    );

    assert.equal(outcome, "system-failure");
    assert.equal(dbCalled, false);
  });

  it("malformed JSON — dbUpdate is not called, outcome is 'system-failure'", async () => {
    let dbCalled = false;
    const dbUpdate: StageBDbUpdater = async () => { dbCalled = true; };

    const outcome = await runStageBAssessment(
      "item-10",
      "https://example.com/img.jpg",
      "tops",
      dbUpdate,
      { _analyzer: brokenJsonAnalyzer },
    );

    assert.equal(outcome, "system-failure");
    assert.equal(dbCalled, false);
  });

  it("JSON missing required fields — dbUpdate not called, outcome is 'system-failure'", async () => {
    let dbCalled = false;
    const dbUpdate: StageBDbUpdater = async () => { dbCalled = true; };
    const incompleteAnalyzer: AnalyzerFn = async () => JSON.stringify({ reason: "incomplete" });

    const outcome = await runStageBAssessment(
      "item-11",
      "https://example.com/img.jpg",
      "tops",
      dbUpdate,
      { _analyzer: incompleteAnalyzer },
    );

    assert.equal(outcome, "system-failure");
    assert.equal(dbCalled, false);
  });
});

// ── runStageBAssessment: database update failure ──────────────────────────────

describe("runStageBAssessment — database update failure", () => {
  it("DB throws — outcome is 'db-failure', pending-assessment preserved in DB", async () => {
    const throwingDb: StageBDbUpdater = async () => { throw new Error("Connection lost"); };

    const outcome = await runStageBAssessment(
      "item-12",
      "https://example.com/img.jpg",
      "tops",
      throwingDb,
      { _analyzer: makeAnalyzer(true, [], "Clear item") },
    );

    assert.equal(outcome, "db-failure");
  });

  it("DB throws on needs-clearer-photo result — outcome is 'db-failure'", async () => {
    const throwingDb: StageBDbUpdater = async () => { throw new Error("Timeout"); };

    const outcome = await runStageBAssessment(
      "item-13",
      "https://example.com/blurry.jpg",
      "tops",
      throwingDb,
      { _analyzer: makeAnalyzer(false, ["blurry"], "Blurry", "Retake in better light.") },
    );

    assert.equal(outcome, "db-failure");
  });
});

// ── resolveActivewearVtoType ──────────────────────────────────────────────────

describe("resolveActivewearVtoType — null / empty / unknown → unsupported", () => {
  it("null → unsupported", () => {
    assert.equal(resolveActivewearVtoType(null), "unsupported");
  });
  it("undefined → unsupported", () => {
    assert.equal(resolveActivewearVtoType(undefined), "unsupported");
  });
  it("empty string → unsupported", () => {
    assert.equal(resolveActivewearVtoType(""), "unsupported");
  });
  it("whitespace only → unsupported", () => {
    assert.equal(resolveActivewearVtoType("   "), "unsupported");
  });
  it("unknown subcategory → unsupported", () => {
    assert.equal(resolveActivewearVtoType("unknown gear"), "unsupported");
  });
});

describe("resolveActivewearVtoType — unsupported accessories", () => {
  it("socks → unsupported", () => {
    assert.equal(resolveActivewearVtoType("socks"), "unsupported");
  });
  it("gloves → unsupported", () => {
    assert.equal(resolveActivewearVtoType("gloves"), "unsupported");
  });
  it("wrist guards → unsupported", () => {
    assert.equal(resolveActivewearVtoType("wrist guards"), "unsupported");
  });
  it("compression sleeves → unsupported", () => {
    assert.equal(resolveActivewearVtoType("compression sleeves"), "unsupported");
  });
});

describe("resolveActivewearVtoType — bottoms (staging examples + variants)", () => {
  // Staging fixture: Charcoal Flare Leggings
  it("'flare leggings' → bottom", () => {
    assert.equal(resolveActivewearVtoType("flare leggings"), "bottom");
  });
  // Staging fixture: Black High-Waist Leggings
  it("'high-waist leggings' → bottom", () => {
    assert.equal(resolveActivewearVtoType("high-waist leggings"), "bottom");
  });
  it("'leggings' → bottom", () => {
    assert.equal(resolveActivewearVtoType("leggings"), "bottom");
  });
  // Staging fixture: Black Nike Athletic Shorts
  it("'athletic shorts' → bottom", () => {
    assert.equal(resolveActivewearVtoType("athletic shorts"), "bottom");
  });
  it("'shorts' → bottom", () => {
    assert.equal(resolveActivewearVtoType("shorts"), "bottom");
  });
  it("'bike shorts' → bottom", () => {
    assert.equal(resolveActivewearVtoType("bike shorts"), "bottom");
  });
  it("'joggers' → bottom", () => {
    assert.equal(resolveActivewearVtoType("joggers"), "bottom");
  });
  it("'track pants' → bottom", () => {
    assert.equal(resolveActivewearVtoType("track pants"), "bottom");
  });
});

describe("resolveActivewearVtoType — tops (staging examples + variants)", () => {
  // Staging fixture: Ivory Racerback Tank Top
  it("'racerback tank' → top", () => {
    assert.equal(resolveActivewearVtoType("racerback tank"), "top");
  });
  it("'tank top' → top", () => {
    assert.equal(resolveActivewearVtoType("tank top"), "top");
  });
  // Staging fixture: Black Nike Dri-FIT T-Shirt
  it("'Dri-FIT T-shirt' → top (case-insensitive)", () => {
    assert.equal(resolveActivewearVtoType("Dri-FIT T-shirt"), "top");
  });
  it("'athletic T-shirt' → top", () => {
    assert.equal(resolveActivewearVtoType("athletic T-shirt"), "top");
  });
  it("'T-shirt' → top", () => {
    assert.equal(resolveActivewearVtoType("T-shirt"), "top");
  });
  // Staging fixture: Black Nike Zip-Up Hoodie
  it("'zip-up hoodie' → top", () => {
    assert.equal(resolveActivewearVtoType("zip-up hoodie"), "top");
  });
  it("'hoodie' → top", () => {
    assert.equal(resolveActivewearVtoType("hoodie"), "top");
  });
  it("'pullover hoodie' → top", () => {
    assert.equal(resolveActivewearVtoType("pullover hoodie"), "top");
  });
  it("'sweatshirt' → top", () => {
    assert.equal(resolveActivewearVtoType("sweatshirt"), "top");
  });
  it("'sports bra' → top", () => {
    assert.equal(resolveActivewearVtoType("sports bra"), "top");
  });
  it("'crop top' → top", () => {
    assert.equal(resolveActivewearVtoType("crop top"), "top");
  });
});

describe("resolveActivewearVtoType — outerwear (staging examples + variants)", () => {
  // Staging fixture: Gray Zip-Up Athletic Jacket
  it("'athletic jacket' → outerwear", () => {
    assert.equal(resolveActivewearVtoType("athletic jacket"), "outerwear");
  });
  it("'track jacket' → outerwear", () => {
    assert.equal(resolveActivewearVtoType("track jacket"), "outerwear");
  });
  it("'windbreaker' → outerwear", () => {
    assert.equal(resolveActivewearVtoType("windbreaker"), "outerwear");
  });
});

describe("resolveActivewearVtoType — one-piece", () => {
  it("'bodysuit' → one-piece", () => {
    assert.equal(resolveActivewearVtoType("bodysuit"), "one-piece");
  });
  it("'unitard' → one-piece", () => {
    assert.equal(resolveActivewearVtoType("unitard"), "one-piece");
  });
  it("'active one-piece' → one-piece", () => {
    assert.equal(resolveActivewearVtoType("active one-piece"), "one-piece");
  });
});

describe("resolveActivewearVtoType — shoes", () => {
  it("'sneakers' → shoes", () => {
    assert.equal(resolveActivewearVtoType("sneakers"), "shoes");
  });
  it("'running shoes' → shoes", () => {
    assert.equal(resolveActivewearVtoType("running shoes"), "shoes");
  });
  it("'training shoes' → shoes", () => {
    assert.equal(resolveActivewearVtoType("training shoes"), "shoes");
  });
});

// ── isVtoCategoryAllowed — ACTIVEWEAR ────────────────────────────────────────

describe("isVtoCategoryAllowed — ACTIVEWEAR supported subcategories → allowed", () => {
  // Seven staging fixtures
  it("ACTIVEWEAR + 'zip-up hoodie' → allowed (staging: Black Nike Zip-Up Hoodie)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "zip-up hoodie"), true);
  });
  it("ACTIVEWEAR + 'flare leggings' → allowed (staging: Charcoal Flare Leggings)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "flare leggings"), true);
  });
  it("ACTIVEWEAR + 'racerback tank' → allowed (staging: Ivory Racerback Tank Top)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "racerback tank"), true);
  });
  it("ACTIVEWEAR + 'athletic jacket' → allowed (staging: Gray Zip-Up Athletic Jacket)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "athletic jacket"), true);
  });
  it("ACTIVEWEAR + 'athletic shorts' → allowed (staging: Black Nike Athletic Shorts)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "athletic shorts"), true);
  });
  it("ACTIVEWEAR + 'high-waist leggings' → allowed (staging: Black High-Waist Leggings)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "high-waist leggings"), true);
  });
  it("ACTIVEWEAR + 'Dri-FIT T-shirt' → allowed (staging: Black Nike Dri-FIT T-Shirt)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "Dri-FIT T-shirt"), true);
  });
  // Additional supported variants
  it("ACTIVEWEAR + 'hoodie' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "hoodie"), true);
  });
  it("ACTIVEWEAR + 'sweatshirt' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "sweatshirt"), true);
  });
  it("ACTIVEWEAR + 'joggers' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "joggers"), true);
  });
  it("ACTIVEWEAR + 'sports bra' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "sports bra"), true);
  });
  it("ACTIVEWEAR + 'sneakers' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "sneakers"), true);
  });
  it("ACTIVEWEAR + 'bodysuit' → allowed", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "bodysuit"), true);
  });
});

describe("isVtoCategoryAllowed — ACTIVEWEAR unsupported subcategories → rejected", () => {
  it("ACTIVEWEAR + null → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", null), false);
  });
  it("ACTIVEWEAR + undefined → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", undefined), false);
  });
  it("ACTIVEWEAR + '' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", ""), false);
  });
  it("ACTIVEWEAR + 'gloves' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "gloves"), false);
  });
  it("ACTIVEWEAR + 'socks' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "socks"), false);
  });
  it("ACTIVEWEAR + 'wrist guards' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "wrist guards"), false);
  });
  it("ACTIVEWEAR + 'compression sleeves' → rejected", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "compression sleeves"), false);
  });
});

describe("isVtoCategoryAllowed — beanie/accessory regression (unchanged)", () => {
  it("ACCESSORIES + 'beanie' → allowed (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "beanie"), true);
  });
  it("ACCESSORIES + 'knit beanie' → allowed (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "knit beanie"), true);
  });
  it("ACCESSORIES + 'scarf' → allowed (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "scarf"), true);
  });
  it("ACCESSORIES + 'belt' → allowed (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "belt"), true);
  });
  it("JEWELRY + 'earrings' → allowed (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("JEWELRY", "earrings"), true);
  });
  it("ACCESSORIES + 'handbag' → rejected (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "handbag"), false);
  });
  it("SWIMWEAR → rejected (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("SWIMWEAR"), false);
  });
  it("LOUNGEWEAR → rejected (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("LOUNGEWEAR"), false);
  });
});

// ── Stage A: ACTIVEWEAR with supported subcategory → normal assessment path ──

describe("Stage A — ACTIVEWEAR with supported subcategory → proceeds through photo checks", () => {
  // Staging fixtures — good image → pending-assessment
  it("ACTIVEWEAR + 'zip-up hoodie' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "zip-up hoodie", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "tops");
    assert.equal(result.customerHint, null);
  });
  it("ACTIVEWEAR + 'flare leggings' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "flare leggings", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "bottoms");
    assert.equal(result.customerHint, null);
  });
  it("ACTIVEWEAR + 'racerback tank' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "racerback tank", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "tops");
  });
  it("ACTIVEWEAR + 'athletic jacket' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "athletic jacket", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "outerwear");
  });
  it("ACTIVEWEAR + 'athletic shorts' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "athletic shorts", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "bottoms");
  });
  it("ACTIVEWEAR + 'high-waist leggings' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "high-waist leggings", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "bottoms");
  });
  it("ACTIVEWEAR + 'Dri-FIT T-shirt' + good image → pending-assessment (staging fixture)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "Dri-FIT T-shirt", ...GOOD });
    assert.equal(result.eligible, "pending-assessment");
    assert.equal(result.category, "tops");
  });

  // Photo quality still applies
  it("ACTIVEWEAR + 'leggings' + low-resolution image → needs-clearer-photo", () => {
    const result = assessClosetEligibility({
      prismaCategory: "ACTIVEWEAR", subcategory: "leggings",
      width: 200, height: 300, format: "jpg", bytes: 50_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("low-resolution"));
    assert.ok(result.customerHint !== null);
  });
  it("ACTIVEWEAR + 'tank top' + tiny file → needs-clearer-photo", () => {
    const result = assessClosetEligibility({
      prismaCategory: "ACTIVEWEAR", subcategory: "tank top",
      width: 1024, height: 1536, format: "jpg", bytes: 5_000,
    });
    assert.equal(result.eligible, "needs-clearer-photo");
    assert.ok(result.photoIssues.includes("tiny-file"));
  });
  it("ACTIVEWEAR + 'hoodie' + unsupported format → not-supported", () => {
    const result = assessClosetEligibility({
      prismaCategory: "ACTIVEWEAR", subcategory: "hoodie",
      ...GOOD, format: "bmp",
    });
    assert.equal(result.eligible, "not-supported");
    assert.ok(result.photoIssues.includes("unsupported-format"));
  });
});

describe("Stage A — ACTIVEWEAR with unsupported subcategory → not-supported", () => {
  it("ACTIVEWEAR + 'gloves' → not-supported regardless of image quality", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "gloves", ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });
  it("ACTIVEWEAR + 'socks' → not-supported", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "socks", ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });
  it("ACTIVEWEAR + 'compression sleeves' → not-supported", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: "compression sleeves", ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });
  it("ACTIVEWEAR + null subcategory → not-supported (cannot resolve without subcategory)", () => {
    const result = assessClosetEligibility({ prismaCategory: "ACTIVEWEAR", subcategory: null, ...GOOD });
    assert.equal(result.eligible, "not-supported");
    assert.equal(result.category, "unsupported");
  });
});

// ── Stale-item reconciliation (unit simulation) ───────────────────────────────
// These tests verify the reconciliation logic's preconditions — that
// isVtoCategoryAllowed correctly identifies which stale items should be promoted
// and which should not, mirroring the loader filter.

describe("stale-item reconciliation preconditions via isVtoCategoryAllowed", () => {
  it("ACTIVEWEAR + supported subcategory + not-supported → isVtoCategoryAllowed=true → would be promoted", () => {
    // An item with category=ACTIVEWEAR, subcategory='leggings', tryOnEligibility='not-supported'
    // would be included in staleIds because isVtoCategoryAllowed returns true.
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "leggings"), true);
  });
  it("ACTIVEWEAR + gloves + not-supported → isVtoCategoryAllowed=false → NOT promoted (wrong)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "gloves"), false);
  });
  it("ACTIVEWEAR + null subcategory + not-supported → isVtoCategoryAllowed=false → NOT promoted", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", null), false);
  });
  it("ACCESSORIES + beanie + not-supported → isVtoCategoryAllowed=true → still promoted (unchanged)", () => {
    assert.equal(isVtoCategoryAllowed("ACCESSORIES", "beanie"), true);
  });
  it("ACTIVEWEAR + 'athletic jacket' → would be promoted (outerwear garment)", () => {
    assert.equal(isVtoCategoryAllowed("ACTIVEWEAR", "athletic jacket"), true);
  });
  it("existing ready-for-try-on item: reconciliation filter requires not-supported → ready-for-try-on not in staleIds", () => {
    // The loader filter checks tryOnEligibility === 'not-supported'. A ready-for-try-on
    // item is never touched even if category is ACTIVEWEAR.
    // (This test confirms the guard logic by checking what the filter would produce.)
    const fakeItem = { tryOnEligibility: "ready-for-try-on", category: "ACTIVEWEAR", subcategory: "leggings" };
    const wouldBeStale = fakeItem.tryOnEligibility === "not-supported"
      && isVtoCategoryAllowed(fakeItem.category, fakeItem.subcategory);
    assert.equal(wouldBeStale, false);
  });
  it("existing needs-clearer-photo item: not promoted (only not-supported is reconciled)", () => {
    const fakeItem = { tryOnEligibility: "needs-clearer-photo", category: "ACTIVEWEAR", subcategory: "leggings" };
    const wouldBeStale = fakeItem.tryOnEligibility === "not-supported"
      && isVtoCategoryAllowed(fakeItem.category, fakeItem.subcategory);
    assert.equal(wouldBeStale, false);
  });
});
