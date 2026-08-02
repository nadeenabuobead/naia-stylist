// app/lib/ai/closet-eligibility.test.ts
// Phase 4A6 — tests for closet image eligibility: Stage A (metadata), Stage B (visual),
// and Stage B + persistence (runStageBAssessment).
// Run: node --test --import tsx/esm app/lib/ai/closet-eligibility.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessClosetEligibility,
  PRISMA_CATEGORY_MAP,
  CLOSET_ELIGIBILITY_DISPLAY,
  STAGE_A_CUSTOMER_HINTS,
  type AssessClosetEligibilityInput,
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
  const unsupportedCats = [
    "ACCESSORIES", "JEWELRY", "ACTIVEWEAR", "SWIMWEAR", "LOUNGEWEAR", "OTHER",
  ] as const;

  for (const cat of unsupportedCats) {
    it(`${cat} → not-supported, null customerHint`, () => {
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
