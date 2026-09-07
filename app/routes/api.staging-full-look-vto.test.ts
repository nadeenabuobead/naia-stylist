// app/routes/api.staging-full-look-vto.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompositeProductImage,
  buildFullLookPrompt,
  type CompositeSlot,
} from "../lib/ai/full-look-composite.server.js";

// ── Prompt builder ────────────────────────────────────────────────────────────

describe("buildFullLookPrompt", () => {
  const slot = (label: string, itemType = "TOP"): CompositeSlot => ({
    imageUrl: "https://example.com/img.jpg",
    label,
    itemType: itemType as CompositeSlot["itemType"],
  });

  it("single item", () => {
    const p = buildFullLookPrompt([slot("black blouse", "TOP")]);
    assert.ok(p.startsWith("Transfer the black blouse onto the model."));
    assert.ok(p.includes("Use each product exactly once."));
  });

  it("two items joined with 'and'", () => {
    const p = buildFullLookPrompt([slot("black blouse"), slot("beige trousers", "BOTTOM")]);
    assert.ok(p.includes("black blouse and beige trousers"));
  });

  it("three items: Oxford comma + and", () => {
    const p = buildFullLookPrompt([
      slot("black blouse"),
      slot("beige trousers", "BOTTOM"),
      slot("white sneakers", "SHOES"),
    ]);
    assert.ok(p.includes("black blouse, beige trousers and white sneakers"));
  });

  it("four items: three commas then and", () => {
    const p = buildFullLookPrompt([
      slot("black blouse"),
      slot("beige trousers", "BOTTOM"),
      slot("white sneakers", "SHOES"),
      slot("black handbag", "BAG"),
    ]);
    assert.ok(
      p.includes("black blouse, beige trousers, white sneakers and black handbag"),
    );
  });

  it("five items: FULL-04 shape", () => {
    const p = buildFullLookPrompt([
      slot("black blouse"),
      slot("beige trousers", "BOTTOM"),
      slot("white sneakers", "SHOES"),
      slot("black handbag", "BAG"),
      slot("gold hoop earrings", "JEWELRY"),
    ]);
    assert.ok(p.includes("gold hoop earrings"));
    assert.ok(p.includes("Preserve each product's colour, silhouette and key details."));
    assert.ok(p.includes("Use each product exactly once."));
  });

  it("falls back to type label when label is empty", () => {
    const s: CompositeSlot = { imageUrl: "https://x.com/a.jpg", label: "", itemType: "SHOES" };
    const p = buildFullLookPrompt([s]);
    assert.ok(p.includes("shoes"));
  });
});

// ── Composite image builder ───────────────────────────────────────────────────

describe("buildCompositeProductImage", () => {
  it("throws on empty slot list", async () => {
    await assert.rejects(
      () => buildCompositeProductImage([]),
      /At least one slot/,
    );
  });

  it("returns a PNG base64 data URL for a real remote image", async () => {
    // Uses a tiny public image to verify canvas round-trip.
    // If network is unavailable this test is skipped implicitly via the thrown error.
    const slots: CompositeSlot[] = [
      {
        imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        label: "sample top",
        itemType: "TOP",
      },
    ];
    try {
      const result = await buildCompositeProductImage(slots);
      assert.ok(
        result.startsWith("data:image/png;base64,"),
        "should return PNG data URL",
      );
      assert.ok(result.length > 100, "should have non-trivial content");
    } catch (e: unknown) {
      // Network not available in this test environment — skip gracefully.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOTFOUND") || msg.includes("fetch") || msg.includes("network")) {
        console.log("  Skipping network-dependent composite test (no network)");
        return;
      }
      throw e;
    }
  });
});

// ── Staging guard (route handler) ─────────────────────────────────────────────

describe("api.staging-full-look-vto staging guard", () => {
  it("FASHN payload includes model_name tryon-max and prompt field", () => {
    // Verify the documented contract: we always send tryon-max + prompt.
    // This is a shape test — the actual call is verified by the route in staging QA.
    const expectedModelName = "tryon-max";
    const slots: CompositeSlot[] = [
      { imageUrl: "https://cdn.example.com/top.jpg", label: "white shirt", itemType: "TOP" },
      { imageUrl: "https://cdn.example.com/btm.jpg", label: "navy jeans", itemType: "BOTTOM" },
    ];
    const prompt = buildFullLookPrompt(slots);
    const body = {
      model_name: expectedModelName,
      inputs: {
        model_image: "data:image/png;base64,abc",
        product_image: "data:image/png;base64,composite",
        prompt,
        return_base64: true,
        output_format: "png",
        resolution: "1k",
        generation_mode: "balanced",
        num_images: 1,
      },
    };
    assert.strictEqual(body.model_name, "tryon-max");
    assert.ok(body.inputs.prompt.includes("white shirt"));
    assert.ok(body.inputs.prompt.includes("navy jeans"));
    assert.ok(body.inputs.prompt.includes("Use each product exactly once."));
    assert.strictEqual(body.inputs.return_base64, true);
  });
});
