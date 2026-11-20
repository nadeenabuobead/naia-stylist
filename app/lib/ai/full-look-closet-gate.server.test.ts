// app/lib/ai/full-look-closet-gate.server.test.ts
//
// Fully mocked screening — no network, no AI call. Proves the pre-FASHN
// eligibility gate for closet-backed Full-Look garments: ineligible or
// unassessed pieces cannot pass, eligible pieces can, and every failure path
// fails closed.

import { describe, it, expect, vi } from "vitest";
import { gateFullLookClosetGarments } from "./full-look-closet-gate.server";
import type { SelectableOutfitItem } from "./full-look-vto-orchestrator.server";

const CUSTOMER = "cust-1";
const CFG = { cloudName: "test-cloud", apiKey: "k", apiSecret: "s" } as any;

function closetItem(over: Partial<NonNullable<SelectableOutfitItem["closetItem"]>> = {}, id = "ci-1", itemType: any = "TOP"): SelectableOutfitItem {
  return {
    itemType,
    productTitle: null,
    closetItemId: id,
    closetItem: {
      name: "My piece",
      imagePublicId: `naia-wardrobe/${CUSTOMER}/${id}`,
      imageFormat: "jpg",
      category: "TOPS",
      subcategory: null,
      tryOnEligibility: "pending-assessment",
      ...over,
    },
  } as SelectableOutfitItem;
}
const catalogItem = (): SelectableOutfitItem =>
  ({ itemType: "BOTTOM", productTitle: "Catalog trousers", closetItemId: null, productImageUrl: "https://cdn.example/p.jpg", closetItem: null }) as SelectableOutfitItem;

const pass = () => vi.fn().mockResolvedValue({ status: "PASS" });
const run = (items: SelectableOutfitItem[], screen: any, cfg: any = CFG) =>
  gateFullLookClosetGarments({ customerId: CUSTOMER, chosenItems: items, cloudinaryConfig: cfg, screen });

describe("gateFullLookClosetGarments — eligible pieces proceed", () => {
  it("passes when every closet piece is an allowed category and screening passes, screening each once with its declared category", async () => {
    const screen = pass();
    const items = [
      closetItem({ category: "TOPS" }, "a", "TOP"),
      closetItem({ category: "SHOES" }, "b", "SHOES"),
      closetItem({ category: "ACCESSORIES", subcategory: "scarf" }, "c", "ACCESSORY"),
    ];
    const r = await run(items, screen);
    expect(r).toEqual({ ok: true, screened: 3 });
    expect(screen).toHaveBeenCalledTimes(3);
    expect(screen.mock.calls.map((c: any[]) => c[1].declaredCategory).sort()).toEqual(["ACCESSORIES", "SHOES", "TOPS"]);
    expect(screen.mock.calls[0][0]).toContain("test-cloud"); // signed private URL, never a raw public id
  });

  it.each(["pending-assessment", "ready-for-try-on", null, undefined])("an item with tryOnEligibility %s (assessed, or never assessed) is screened live and proceeds on PASS", async (elig) => {
    const screen = pass();
    const r = await run([closetItem({ tryOnEligibility: elig as any })], screen);
    expect(r.ok).toBe(true);
    expect(screen).toHaveBeenCalledTimes(1);
  });

  it("catalog (non-closet) pieces are out of scope: nothing screened, gate passes", async () => {
    const screen = pass();
    expect(await run([catalogItem()], screen)).toEqual({ ok: true, screened: 0 });
    expect(screen).not.toHaveBeenCalled();
  });

  it("a mixed look screens only its closet-backed pieces", async () => {
    const screen = pass();
    const r = await run([catalogItem(), closetItem({}, "x")], screen);
    expect(r).toEqual({ ok: true, screened: 1 });
    expect(screen).toHaveBeenCalledTimes(1);
  });
});

describe("gateFullLookClosetGarments — ineligible pieces cannot pass, and never cost a screening call when rejected by rule", () => {
  it.each([
    ["ACTIVEWEAR with no resolvable subcategory", { category: "ACTIVEWEAR", subcategory: null }],
    ["SWIMWEAR", { category: "SWIMWEAR" }],
    ["LOUNGEWEAR", { category: "LOUNGEWEAR" }],
    ["OTHER", { category: "OTHER" }],
    ["ACCESSORIES with no subcategory", { category: "ACCESSORIES", subcategory: null }],
    ["ACCESSORIES with a non-allowlisted subcategory", { category: "ACCESSORIES", subcategory: "sunglasses" }],
    ["JEWELRY with no subcategory", { category: "JEWELRY", subcategory: null }],
    ["missing category", { category: null }],
  ])("rejects %s with category_not_allowed before any screening", async (_l, over) => {
    const screen = pass();
    const r = await run([closetItem(over as any)], screen);
    expect(r).toMatchObject({ ok: false, reason: "category_not_allowed" });
    expect(screen).not.toHaveBeenCalled();
  });

  it.each(["needs-clearer-photo", "not-supported"])("rejects a Stage-A %s item (photo_flagged) before any screening", async (flag) => {
    const screen = pass();
    const r = await run([closetItem({ tryOnEligibility: flag })], screen);
    expect(r).toMatchObject({ ok: false, reason: "photo_flagged", label: "My piece" });
    expect(screen).not.toHaveBeenCalled();
  });

  it("one ineligible piece refuses the whole look even when the other four are fine", async () => {
    const screen = pass();
    const items = [closetItem({}, "a"), closetItem({}, "b"), closetItem({ category: "SWIMWEAR" }, "c"), closetItem({}, "d"), closetItem({}, "e")];
    const r = await run(items, screen);
    expect(r).toMatchObject({ ok: false, reason: "category_not_allowed" });
    expect(screen).not.toHaveBeenCalled();
  });

  it("a closet-backed OutfitItem whose closet row is missing fails closed (unresolved_closet_item)", async () => {
    const screen = pass();
    const orphan = { itemType: "TOP", productTitle: "Gone", closetItemId: "ci-x", closetItem: null } as SelectableOutfitItem;
    expect(await run([orphan], screen)).toMatchObject({ ok: false, reason: "unresolved_closet_item", label: "Gone" });
    expect(screen).not.toHaveBeenCalled();
  });

  it("an unresolvable image (no Cloudinary config) fails closed (image_unresolved)", async () => {
    const screen = pass();
    expect(await run([closetItem()], screen, null)).toMatchObject({ ok: false, reason: "image_unresolved" });
    expect(screen).not.toHaveBeenCalled();
  });

  it("an image whose public id belongs to ANOTHER customer fails closed (ownership) and is never screened", async () => {
    const screen = pass();
    const foreign = closetItem({ imagePublicId: "naia-wardrobe/someone-else/x" });
    expect(await run([foreign], screen)).toMatchObject({ ok: false, reason: "image_unresolved" });
    expect(screen).not.toHaveBeenCalled();
  });
});

describe("gateFullLookClosetGarments — live suitability screening is enforced (fail closed)", () => {
  it.each([
    [{ status: "RETRY_IMAGE", subCode: "image_too_blurry" }, "image_too_blurry"],
    [{ status: "NEEDS_CLARIFICATION", subCode: "category_mismatch" }, "category_mismatch"],
  ])("a genuine non-PASS verdict %j refuses the look as unsuitable_image", async (result, subCode) => {
    const screen = vi.fn().mockResolvedValue(result);
    const r = await run([closetItem()], screen);
    expect(r).toMatchObject({ ok: false, reason: "unsuitable_image", subCode });
  });

  it("a check that could not complete (assessment_failed: timeout/API error/unparseable) still refuses (fail closed) but is reported as screening_unavailable, not as a bad photo", async () => {
    const screen = vi.fn().mockResolvedValue({ status: "RETRY_IMAGE", subCode: "assessment_failed" });
    const r = await run([closetItem()], screen);
    expect(r).toMatchObject({ ok: false, reason: "screening_unavailable", subCode: "assessment_failed" });
  });

  it("a screening call that throws is treated as NOT passed (screening_unavailable)", async () => {
    const screen = vi.fn().mockRejectedValue(new Error("anthropic down"));
    const r = await run([closetItem()], screen);
    expect(r).toMatchObject({ ok: false, reason: "screening_unavailable", subCode: "assessment_failed" });
  });

  it("every screening is started concurrently (all calls issued before any resolves) with the gate's longer timeout", async () => {
    let started = 0;
    let maxInFlight = 0;
    let inFlight = 0;
    const screen = vi.fn().mockImplementation(async () => {
      started++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: "PASS" };
    });
    const items = ["a", "b", "c", "d", "e"].map((id) => closetItem({}, id));
    expect(await run(items, screen)).toEqual({ ok: true, screened: 5 });
    expect(started).toBe(5);
    expect(maxInFlight).toBe(5); // concurrent, not sequential
    expect(screen.mock.calls.every((c: any[]) => c[1].timeoutMs === 10_000)).toBe(true);
  });

  it("reports the failing piece's label when only one of several fails screening", async () => {
    const screen = vi.fn().mockImplementation(async (url: string) => (url.includes("bad") ? { status: "RETRY_IMAGE", subCode: "no_garment_visible" } : { status: "PASS" }));
    const items = [closetItem({ name: "Good one" }, "good"), closetItem({ name: "Bad one" }, "bad")];
    expect(await run(items, screen)).toMatchObject({ ok: false, reason: "unsuitable_image", label: "Bad one" });
  });
});
