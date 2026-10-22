// app/lib/ai/poc-wi-combination-resolver.test.ts
//
// Covers only the pure logic: no DB access occurs in any case exercised
// here (the duplicate/empty-input guards in resolveOwnedWiGarments return
// before ever calling prisma). The DB-backed ownership lookup itself is
// integration-only, same convention as resolveClosetAnchor — see the header
// of poc-wi-combination-resolver.server.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveOwnedWiGarments,
  toPendingSequentialTryOnInputs,
  type WiResolvedGarmentMetadata,
} from "./poc-wi-combination-resolver.server.ts";

describe("resolveOwnedWiGarments — pure guards (no DB reached)", () => {
  it("WIR.1 — empty customerId fails closed before any lookup", async () => {
    const result = await resolveOwnedWiGarments("", ["a", "b", "c"]);
    assert.equal(result, null);
  });

  it("WIR.2 — empty id list fails closed before any lookup", async () => {
    const result = await resolveOwnedWiGarments("cust-sara", []);
    assert.equal(result, null);
  });

  it("WIR.3 — a duplicated id fails the whole set closed before any lookup", async () => {
    const result = await resolveOwnedWiGarments("cust-sara", ["a", "b", "a"]);
    assert.equal(result, null);
  });
});

describe("toPendingSequentialTryOnInputs — pure mapping", () => {
  const TROUSERS: WiResolvedGarmentMetadata = {
    closetItemId: "ci-trousers",
    name: "Beige Tailored Trousers",
    category: "BOTTOMS",
    subcategory: null,
    slot: "bottom",
  };
  const SHIRT: WiResolvedGarmentMetadata = {
    closetItemId: "ci-shirt",
    name: "Blue Chambray Button-Up Shirt",
    category: "TOPS",
    subcategory: null,
    slot: "top",
  };
  const BLAZER: WiResolvedGarmentMetadata = {
    closetItemId: "ci-blazer",
    name: "Beige Tailored Blazer",
    category: "OUTERWEAR",
    subcategory: null,
    slot: "outerwear",
  };

  it("WIR.4 — maps each garment's label/category/subcategory/slot, preserving input order", () => {
    const pending = toPendingSequentialTryOnInputs([TROUSERS, SHIRT, BLAZER]);
    assert.deepEqual(pending.map((p) => p.label), [
      "Beige Tailored Trousers",
      "Blue Chambray Button-Up Shirt",
      "Beige Tailored Blazer",
    ]);
    assert.deepEqual(pending.map((p) => p.slot), ["bottom", "top", "outerwear"]);
    assert.deepEqual(pending.map((p) => p.closetItemId), ["ci-trousers", "ci-shirt", "ci-blazer"]);
  });

  it("WIR.5 — falls back to the closetItemId as label when name is null", () => {
    const pending = toPendingSequentialTryOnInputs([{ ...TROUSERS, name: null }]);
    assert.equal(pending[0].label, "ci-trousers");
  });

  it("WIR.6 — never includes an image/photo field of any kind", () => {
    const pending = toPendingSequentialTryOnInputs([TROUSERS, SHIRT, BLAZER]);
    for (const p of pending) {
      assert.equal("productImageUrl" in p, false);
      assert.equal("imageUrl" in p, false);
    }
  });
});
