// app/lib/ai/styleme-anchor.test.ts
// Tests for anchor resolution.
// resolveNadineAnchor: pure catalog lookup, fully testable.
// resolveActionAnchor: tested via DI for all paths including unknown/foreign closet.
// resolveClosetAnchor (real DB): integration-only, not tested here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveNadineAnchor, resolveActionAnchor } from "./styleme-anchor.server.ts";
import type { ClosetAnchorInput } from "./styleme-recommendation.types.ts";

const V8_HANDLES = [
  "double-top",
  "collar-shirt",
  "cropped-top",
  "asymmetrical-pants",
  "straight-pants",
  "suede-skirt",
  "trench-coat",
  "kimono-jacket",
  "leather-suede-jacket",
  "midi-dress",
  "dress-set",
];

// Minimal ClosetAnchorInput fixture for DI tests
const OWNED_CLOSET_ANCHOR: ClosetAnchorInput = {
  type: "closet",
  id: "ci-owned",
  name: "Black Dress",
  category: "DRESSES",
  colors: ["black"],
  primaryColor: "black",
  pattern: null,
  material: null,
  styleTags: ["minimal"],
  occasions: ["everyday"],
  imageUrl: "https://example.com/img.jpg",
};

// ── resolveNadineAnchor ───────────────────────────────────────────────────────

describe("resolveNadineAnchor", () => {
  it("AN.1 — returns NadineAnchorInput with type='nadine' for a known handle", () => {
    const result = resolveNadineAnchor("collar-shirt");
    assert.ok(result !== null);
    assert.equal(result.type, "nadine");
    assert.equal(result.handle, "collar-shirt");
  });

  it("AN.2 — returns null for an unknown handle", () => {
    assert.equal(resolveNadineAnchor("not-a-real-product"), null);
  });

  it("AN.3 — returns null for an empty string", () => {
    assert.equal(resolveNadineAnchor(""), null);
  });

  it("AN.4 — all 11 V8 handles are accepted", () => {
    for (const handle of V8_HANDLES) {
      const result = resolveNadineAnchor(handle);
      assert.ok(result !== null, `Expected valid anchor for handle: ${handle}`);
      assert.equal(result.handle, handle);
    }
  });

  it("AN.5 — handle is preserved verbatim in the returned input", () => {
    const result = resolveNadineAnchor("midi-dress");
    assert.equal(result?.handle, "midi-dress");
  });

  it("AN.6 — rejects a near-miss handle variant (case mismatch)", () => {
    assert.equal(resolveNadineAnchor("Collar-Shirt"), null);
  });

  it("AN.7 — V8 catalog contains exactly 11 products", () => {
    assert.equal(V8_HANDLES.length, 11);
  });
});

// ── resolveActionAnchor — naia-piece source ───────────────────────────────────

describe("resolveActionAnchor — naia-piece", () => {
  it("CA.1 — valid V8 handle → ok=true with NadineAnchorInput", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "collar-shirt", null);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor.type, "nadine");
    assert.equal((result.anchor as { handle: string }).handle, "collar-shirt");
  });

  it("CA.2 — invalid (non-V8) handle → ok=false, status=400", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "not-a-real-product", null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.ok(result.message.length > 0);
  });

  it("CA.3 — missing handle (null) → ok=false, status=400", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", null, null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
  });

  it("CA.4 — empty-string handle → ok=false, status=400", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "", null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
  });

  it("CA.5 — case-mismatched handle → ok=false, status=400", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "Collar-Shirt", null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
  });

  it("CA.6 — all 11 V8 handles → ok=true, anchor is always non-null NadineAnchorInput", async () => {
    for (const handle of V8_HANDLES) {
      const result = await resolveActionAnchor("naia-piece", "cust-1", handle, null);
      assert.equal(result.ok, true, `Expected ok=true for handle ${handle}`);
      if (!result.ok) throw new Error("unreachable");
      assert.equal(result.anchor.type, "nadine");
    }
  });
});

// ── resolveActionAnchor — closet sources (DI) ────────────────────────────────
// The real resolveClosetAnchor queries Prisma with WHERE id=? AND customerId=?.
// Tests here inject a fake resolver so no live DB is required.

describe("resolveActionAnchor — my-closet and both (DI resolver)", () => {
  it("CA.7 — my-closet: missing closetItemId (null) → ok=false, status=400, resolver not called", async () => {
    let resolverCalled = false;
    const fakeResolver = async () => { resolverCalled = true; return null; };

    const result = await resolveActionAnchor("my-closet", "cust-1", null, null, fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(resolverCalled, false, "resolver must not be called for missing closetItemId");
  });

  it("CA.8 — my-closet: empty-string closetItemId → ok=false, status=400, resolver not called", async () => {
    let resolverCalled = false;
    const fakeResolver = async () => { resolverCalled = true; return null; };

    const result = await resolveActionAnchor("my-closet", "cust-1", null, "", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(resolverCalled, false, "resolver must not be called for empty closetItemId");
  });

  it("CA.9 — both: missing closetItemId → ok=false, status=400, resolver not called", async () => {
    let resolverCalled = false;
    const fakeResolver = async () => { resolverCalled = true; return null; };

    const result = await resolveActionAnchor("both", "cust-1", null, null, fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(resolverCalled, false, "resolver must not be called for missing closetItemId");
  });

  it("CA.10 — valid owned closet ID → resolver returns anchor → ok=true with that anchor", async () => {
    const fakeResolver = async (_cid: string, _iid: string) => OWNED_CLOSET_ANCHOR;

    const result = await resolveActionAnchor("my-closet", "cust-1", null, "ci-owned", fakeResolver);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor.type, "closet");
    assert.equal((result.anchor as ClosetAnchorInput).id, "ci-owned");
  });

  it("CA.11 — unknown closet ID → resolver returns null → ok=false, status=403", async () => {
    const fakeResolver = async () => null;

    const result = await resolveActionAnchor("my-closet", "cust-1", null, "unknown-id", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 403);
    assert.ok(result.message.length > 0);
  });

  it("CA.12 — foreign closet ID → resolver returns null → ok=false, status=403", async () => {
    // Simulates: item exists but belongs to a different customer.
    // The real DB query uses WHERE id=? AND customerId=?, so a foreign item returns null.
    const fakeResolver = async (_cid: string, _iid: string): Promise<ClosetAnchorInput | null> => null;

    const result = await resolveActionAnchor("my-closet", "attacker-cust", null, "foreign-ci", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 403);
  });

  it("CA.13 — resolver receives the authenticated customerId and requested closetItemId exactly once", async () => {
    const calls: Array<{ cid: string; iid: string }> = [];
    const fakeResolver = async (cid: string, iid: string): Promise<ClosetAnchorInput | null> => {
      calls.push({ cid, iid });
      return OWNED_CLOSET_ANCHOR;
    };

    await resolveActionAnchor("my-closet", "real-customer-id", null, "exact-item-id", fakeResolver);

    assert.equal(calls.length, 1, "resolver must be called exactly once");
    assert.equal(calls[0].cid, "real-customer-id", "resolver must receive the authenticated customerId");
    assert.equal(calls[0].iid, "exact-item-id", "resolver must receive the requested closetItemId");
  });

  it("CA.14 — both source: valid closet ID → ok=true (both uses same closet resolution path)", async () => {
    const fakeResolver = async () => OWNED_CLOSET_ANCHOR;

    const result = await resolveActionAnchor("both", "cust-1", null, "ci-owned", fakeResolver);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor.type, "closet");
  });

  it("CA.15 — both source: unknown ID → resolver returns null → ok=false, status=403", async () => {
    const fakeResolver = async () => null;

    const result = await resolveActionAnchor("both", "cust-1", null, "unknown-id", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 403);
  });
});
