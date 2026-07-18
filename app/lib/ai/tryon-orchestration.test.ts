// app/lib/ai/tryon-orchestration.test.ts
// Run: node --test --import tsx/esm app/lib/ai/tryon-orchestration.test.ts

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompleteLookGarments,
  gateSingleGarment,
  gateCompleteLook,
  type GarmentRef,
} from "./tryon-orchestration.js";

// Phase 4A5 accepted handles — only asymmetrical-pants and suede-skirt are eligible.
const mockEligible = (handle: string): boolean =>
  handle === "asymmetrical-pants" || handle === "suede-skirt";

// ── gateSingleGarment ────────────────────────────────────────────────────────

describe("gateSingleGarment", () => {
  test("accepted handle + feature enabled → allowed", () => {
    const result = gateSingleGarment("asymmetrical-pants", true, mockEligible);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, undefined);
  });

  test("accepted handle (suede-skirt) + enabled → allowed", () => {
    const result = gateSingleGarment("suede-skirt", true, mockEligible);
    assert.equal(result.allowed, true);
  });

  test("not-eligible handle (cropped-top) + enabled → garment-not-eligible", () => {
    const result = gateSingleGarment("cropped-top", true, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "garment-not-eligible");
  });

  test("not-eligible handle (dress-set/mesh-top) + enabled → garment-not-eligible", () => {
    const result = gateSingleGarment("dress-set/mesh-top", true, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "garment-not-eligible");
  });

  test("pending handle (not in Phase 4A5 outcomes) + enabled → garment-not-eligible", () => {
    const result = gateSingleGarment("collar-shirt", true, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "garment-not-eligible");
  });

  test("accepted handle + feature disabled → feature-disabled (global gate wins)", () => {
    const result = gateSingleGarment("asymmetrical-pants", false, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "feature-disabled");
  });

  test("not-eligible handle + feature disabled → feature-disabled (not garment-not-eligible)", () => {
    const result = gateSingleGarment("cropped-top", false, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "feature-disabled");
  });
});

// ── gateCompleteLook ─────────────────────────────────────────────────────────

describe("gateCompleteLook", () => {
  const eligibleTop: GarmentRef = { handle: "asymmetrical-pants", title: "Asymmetrical Pants", itemType: "BOTTOM" };
  const eligibleBottom: GarmentRef = { handle: "suede-skirt", title: "Suede Skirt", itemType: "BOTTOM" };
  const ineligible: GarmentRef = { handle: "cropped-top", title: "Cropped Top", itemType: "TOP" };
  const pending: GarmentRef = { handle: "collar-shirt", title: "Collar Shirt", itemType: "TOP" };

  test("single eligible garment + enabled → allowed with that garment", () => {
    const result = gateCompleteLook([eligibleTop], true, mockEligible);
    assert.equal(result.allowed, true);
    assert.equal(result.eligibleGarments.length, 1);
    assert.equal(result.eligibleGarments[0].handle, "asymmetrical-pants");
  });

  test("all ineligible garments + enabled → not allowed", () => {
    const result = gateCompleteLook([ineligible, pending], true, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.eligibleGarments.length, 0);
    assert.equal(result.gateReason, "garment-not-eligible");
  });

  test("mixed garments → only eligible ones returned", () => {
    const result = gateCompleteLook([ineligible, eligibleTop, pending], true, mockEligible);
    assert.equal(result.allowed, true);
    assert.equal(result.eligibleGarments.length, 1);
    assert.equal(result.eligibleGarments[0].handle, "asymmetrical-pants");
  });

  test("eligible garments + feature disabled → not allowed", () => {
    const result = gateCompleteLook([eligibleTop, eligibleBottom], false, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.eligibleGarments.length, 0);
    assert.equal(result.gateReason, "feature-disabled");
  });

  test("empty garments list + enabled → not allowed", () => {
    const result = gateCompleteLook([], true, mockEligible);
    assert.equal(result.allowed, false);
    assert.equal(result.gateReason, "garment-not-eligible");
  });
});

// ── buildCompleteLookGarments ─────────────────────────────────────────────────

describe("buildCompleteLookGarments", () => {
  const bottom: GarmentRef = { handle: "asymmetrical-pants", title: "Asymmetrical Pants", itemType: "BOTTOM" };
  const top: GarmentRef = { handle: "suede-skirt", title: "Suede Skirt", itemType: "BOTTOM" }; // using suede-skirt as eligible stand-in
  const outerwear: GarmentRef = { handle: "asymmetrical-pants", title: "Outerwear Variant", itemType: "OUTERWEAR" };
  const ineligible: GarmentRef = { handle: "cropped-top", title: "Cropped Top", itemType: "TOP" };

  test("filters ineligible handles", () => {
    const result = buildCompleteLookGarments([bottom, ineligible], mockEligible);
    assert.equal(result.length, 1);
    assert.equal(result[0].handle, "asymmetrical-pants");
  });

  test("BOTTOM sorts before OUTERWEAR", () => {
    const outerwearEligible: GarmentRef = { handle: "asymmetrical-pants", title: "A", itemType: "OUTERWEAR" };
    const bottomEligible: GarmentRef = { handle: "suede-skirt", title: "B", itemType: "BOTTOM" };
    const result = buildCompleteLookGarments([outerwearEligible, bottomEligible], mockEligible);
    assert.equal(result[0].itemType, "BOTTOM");
    assert.equal(result[1].itemType, "OUTERWEAR");
  });

  test("BOTTOM (0) → TOP (1) → DRESS (2) → OUTERWEAR (3)", () => {
    const allTypes = (handle: string) => handle === "b" || handle === "t" || handle === "d" || handle === "o";
    const garments: GarmentRef[] = [
      { handle: "o", title: "Outerwear", itemType: "OUTERWEAR" },
      { handle: "d", title: "Dress",     itemType: "DRESS" },
      { handle: "b", title: "Bottom",    itemType: "BOTTOM" },
      { handle: "t", title: "Top",       itemType: "TOP" },
    ];
    const result = buildCompleteLookGarments(garments, allTypes);
    assert.deepEqual(result.map((g) => g.itemType), ["BOTTOM", "TOP", "DRESS", "OUTERWEAR"]);
  });

  test("unknown itemType sorts last", () => {
    const allEligible = () => true;
    const garments: GarmentRef[] = [
      { handle: "a", title: "Unknown", itemType: "SHOES" },
      { handle: "b", title: "Bottom",  itemType: "BOTTOM" },
    ];
    const result = buildCompleteLookGarments(garments, allEligible);
    assert.equal(result[0].itemType, "BOTTOM");
    assert.equal(result[1].itemType, "SHOES");
  });

  test("returns empty array when all garments are ineligible", () => {
    const result = buildCompleteLookGarments([ineligible], mockEligible);
    assert.equal(result.length, 0);
  });

  test("does not mutate the input array", () => {
    const input: GarmentRef[] = [bottom, top];
    const copy = [...input];
    buildCompleteLookGarments(input, mockEligible);
    assert.deepEqual(input, copy);
  });
});
