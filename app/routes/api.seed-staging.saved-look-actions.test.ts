// Tests for the QA-fixture-only SavedLook actions added to
// api.seed-staging.jsx: createSavedLookDetailed, getSavedLook,
// deleteSavedLook. Kept separate from the §S4 fixture-actions suite.
//
// Run: npx vitest run app/routes/api.seed-staging.saved-look-actions.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    closetItem: { findMany: vi.fn() },
    savedLook: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("../lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn(),
  recordJourneyEvent: vi.fn(),
}));

import prisma from "../db.server";
import { action } from "./api.seed-staging";

const STAGING_SECRET = "test-secret-abc123";
const FIXTURE_CUSTOMER_ID = "cust_fixture_1";
const REAL_CUSTOMER_ID = "cust_real_1";
const REAL_CLERK_NATIVE_CUSTOMER_ID = "cust_real_clerk_native";
const NONEXISTENT_CUSTOMER_ID = "cust_does_not_exist";

function makeActionRequest(body: object): { request: Request } {
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": STAGING_SECRET },
      body: JSON.stringify(body),
    }),
  };
}

const FIXTURE_CUSTOMER_ID_2 = "cust_fixture_2_not_allowlisted";

describe("§S5 seed-staging SavedLook fixture actions", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;
  const originalAllowlist = process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    // The explicit allowlist, set for the positive-path tests below. Tests
    // that specifically exercise the allowlist's own enforcement override
    // or delete this within their own body.
    process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS = FIXTURE_CUSTOMER_ID;

    (prisma.customer.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === FIXTURE_CUSTOMER_ID) {
        return Promise.resolve({ id: FIXTURE_CUSTOMER_ID, shopifyCustomerId: "test-batch1-wi-fixture" });
      }
      if (where.id === REAL_CUSTOMER_ID) {
        // Mirrors the real shape written by the legacy Shopify OAuth callback
        // (auth.shopify.callback.tsx) — a Shopify Customer Account API GID,
        // never caller-suppliable or test-batch1--shaped.
        return Promise.resolve({ id: REAL_CUSTOMER_ID, shopifyCustomerId: "gid://shopify/Customer/7234561890" });
      }
      if (where.id === REAL_CLERK_NATIVE_CUSTOMER_ID) {
        // Mirrors a real Clerk-native customer (signed up directly via Clerk,
        // never through Shopify OAuth) — shopifyCustomerId is null by the
        // schema's own documented convention (see identity-linking.server.ts),
        // not merely "some other string".
        return Promise.resolve({ id: REAL_CLERK_NATIVE_CUSTOMER_ID, shopifyCustomerId: null });
      }
      if (where.id === FIXTURE_CUSTOMER_ID_2) {
        // A SECOND, genuinely valid test-batch1- fixture customer — real
        // prefix, would pass the old requireTestCustomer-only check — but
        // deliberately never placed in SAVED_LOOKS_FIXTURE_CUSTOMER_IDS.
        // Proves the allowlist is an independent, exact-id requirement, not
        // "any test-batch1- customer is fine."
        return Promise.resolve({ id: FIXTURE_CUSTOMER_ID_2, shopifyCustomerId: "test-batch1-wi-fixture-2" });
      }
      // NONEXISTENT_CUSTOMER_ID and anything else: no row at all.
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
    if (originalAllowlist === undefined) delete process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS;
    else process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS = originalAllowlist;
  });

  it("S501 — createSavedLookDetailed refuses a customerId that is not a test-batch1- fixture", async () => {
    const res: any = await action(
      makeActionRequest({ _action: "createSavedLookDetailed", customerId: REAL_CUSTOMER_ID, closetItemIds: ["item1"] }) as any,
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
  });

  it("S502 — createSavedLookDetailed refuses a closetItemId that does not belong to the customer (fewer owned than requested)", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([{ id: "item1", category: "TOPS" }]);
    const res: any = await action(
      makeActionRequest({
        _action: "createSavedLookDetailed",
        customerId: FIXTURE_CUSTOMER_ID,
        closetItemIds: ["item1", "someone-elses-item"],
      }) as any,
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
  });

  it("S503 — createSavedLookDetailed refuses a category with no direct OutfitItemType mapping (e.g. ACTIVEWEAR)", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([{ id: "item1", category: "ACTIVEWEAR" }]);
    const res: any = await action(
      makeActionRequest({ _action: "createSavedLookDetailed", customerId: FIXTURE_CUSTOMER_ID, closetItemIds: ["item1"] }) as any,
    );
    expect((res as Response).status).toBe(400);
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
  });

  it("S504 — createSavedLookDetailed succeeds for owned items with directly-mappable categories, mapping category -> OutfitItemType correctly", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      { id: "item1", category: "TOPS" },
      { id: "item2", category: "BOTTOMS" },
    ]);
    (prisma.savedLook.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: "look1",
        name: data.name,
        occasion: data.occasion,
        items: data.items.create,
      }),
    );
    const res: any = await action(
      makeActionRequest({
        _action: "createSavedLookDetailed",
        customerId: FIXTURE_CUSTOMER_ID,
        name: "Test Look",
        occasion: "EVERYDAY",
        closetItemIds: ["item1", "item2"],
      }) as any,
    );
    const body = await res.json();
    expect(body.savedLookId).toBe("look1");
    expect(body.itemCount).toBe(2);
    const createCall = (prisma.savedLook.create as any).mock.calls[0][0];
    expect(createCall.data.items.create).toEqual([
      { itemType: "TOP", closetItemId: "item1" },
      { itemType: "BOTTOM", closetItemId: "item2" },
    ]);
  });

  it("S505 — getSavedLook refuses a non-fixture customerId", async () => {
    const res: any = await action(
      makeActionRequest({ _action: "getSavedLook", customerId: REAL_CUSTOMER_ID, savedLookId: "look1" }) as any,
    );
    expect((res as Response).status).toBe(403);
  });

  it("S506 — getSavedLook scopes the read by customerId, not just savedLookId (cross-customer read returns notFound, not another customer's data)", async () => {
    (prisma.savedLook.findFirst as any).mockImplementation(({ where }: any) =>
      where.customerId === FIXTURE_CUSTOMER_ID ? Promise.resolve({ id: "look1", customerId: FIXTURE_CUSTOMER_ID, name: null, occasion: null, items: [] }) : Promise.resolve(null),
    );
    const res: any = await action(
      makeActionRequest({ _action: "getSavedLook", customerId: FIXTURE_CUSTOMER_ID, savedLookId: "look1" }) as any,
    );
    const body = await res.json();
    expect(body.savedLook.id).toBe("look1");
    const findFirstCall = (prisma.savedLook.findFirst as any).mock.calls[0][0];
    expect(findFirstCall.where).toEqual({ id: "look1", customerId: FIXTURE_CUSTOMER_ID });
  });

  it("S507 — deleteSavedLook refuses a non-fixture customerId", async () => {
    const res: any = await action(
      makeActionRequest({ _action: "deleteSavedLook", customerId: REAL_CUSTOMER_ID, savedLookId: "look1" }) as any,
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.savedLook.deleteMany).not.toHaveBeenCalled();
  });

  it("S508 — deleteSavedLook deletes by exact id scoped to the customer, never a sweep", async () => {
    (prisma.savedLook.deleteMany as any).mockResolvedValue({ count: 1 });
    const res: any = await action(
      makeActionRequest({ _action: "deleteSavedLook", customerId: FIXTURE_CUSTOMER_ID, savedLookId: "look1" }) as any,
    );
    const body = await res.json();
    expect(body.deletedCount).toBe(1);
    const deleteCall = (prisma.savedLook.deleteMany as any).mock.calls[0][0];
    expect(deleteCall.where).toEqual({ id: "look1", customerId: FIXTURE_CUSTOMER_ID });
  });

  // ── Adversarial / negative security tests ───────────────────────────────
  // Directly targets: "reject arbitrary customer IDs", "fails closed
  // regardless of misconfiguration", requested as an explicit follow-up
  // security pass on these three actions specifically.

  it("S509 — createSavedLookDetailed refuses a real, Shopify-verified customerId (not merely 'some non-fixture string')", async () => {
    const res: any = await action(
      makeActionRequest({ _action: "createSavedLookDetailed", customerId: REAL_CUSTOMER_ID, closetItemIds: ["item1"] }) as any,
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
    expect(prisma.closetItem.findMany).not.toHaveBeenCalled();
  });

  it("S510 — all three actions refuse a real Clerk-native customerId (shopifyCustomerId: null) — null must not coerce into passing a startsWith check", async () => {
    for (const _action of ["createSavedLookDetailed", "getSavedLook", "deleteSavedLook"]) {
      const res: any = await action(
        makeActionRequest({ _action, customerId: REAL_CLERK_NATIVE_CUSTOMER_ID, closetItemIds: ["item1"], savedLookId: "look1" }) as any,
      );
      expect((res as Response).status, `${_action} on a Clerk-native real customer`).toBe(403);
    }
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
    expect(prisma.savedLook.findFirst).not.toHaveBeenCalled();
    expect(prisma.savedLook.deleteMany).not.toHaveBeenCalled();
  });

  it("S511 — all three actions refuse a customerId that does not exist at all, not just ones belonging to someone else", async () => {
    for (const _action of ["createSavedLookDetailed", "getSavedLook", "deleteSavedLook"]) {
      const res: any = await action(
        makeActionRequest({ _action, customerId: NONEXISTENT_CUSTOMER_ID, closetItemIds: ["item1"], savedLookId: "look1" }) as any,
      );
      expect((res as Response).status, `${_action} on a nonexistent customerId`).toBe(403);
    }
  });

  it("S512 — createSavedLookDetailed rejects every malformed customerId shape (object, array, empty string, null, undefined) — never creates a SavedLook, regardless of which status code the particular shape happens to trip", async () => {
    // "" / null / undefined are falsy -> the early `!customerId` check returns
    // 400 before any DB call. {} / [] are TRUTHY in JS, so they instead reach
    // requireTestCustomer, where String({}) === "[object Object]" (and
    // String([]) === "") never matches a real id -> prisma.customer.findUnique
    // correctly returns null -> 403. Both paths are equally safe; the
    // security-relevant invariant is "never creates a look", not the exact
    // status code, which legitimately differs by input shape.
    for (const badCustomerId of [{}, [], "", null, undefined]) {
      vi.clearAllMocks();
      const res: any = await action(
        makeActionRequest({ _action: "createSavedLookDetailed", customerId: badCustomerId, closetItemIds: ["item1"] }) as any,
      );
      const status = (res as Response).status;
      expect([400, 403], `customerId=${JSON.stringify(badCustomerId)} -> unexpected status ${status}`).toContain(status);
      expect(prisma.savedLook.create, `customerId=${JSON.stringify(badCustomerId)}`).not.toHaveBeenCalled();
    }
  });

  it("S513 — all three actions fail closed (404, before any DB call) when NAIA_PROJECT_VARIANT is anything other than the exact string 'staging' — including a plausible-looking misconfiguration, not just 'production' or unset", async () => {
    for (const badVariant of [undefined, "", "production", "Staging", "staging ", "stage"]) {
      vi.clearAllMocks();
      if (badVariant === undefined) delete process.env.NAIA_PROJECT_VARIANT;
      else process.env.NAIA_PROJECT_VARIANT = badVariant;

      for (const _action of ["createSavedLookDetailed", "getSavedLook", "deleteSavedLook"]) {
        const res: any = await action(
          makeActionRequest({ _action, customerId: FIXTURE_CUSTOMER_ID, closetItemIds: ["item1"], savedLookId: "look1" }) as any,
        );
        expect((res as Response).status, `${_action} with NAIA_PROJECT_VARIANT=${JSON.stringify(badVariant)}`).toBe(404);
      }
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
      expect(prisma.savedLook.create).not.toHaveBeenCalled();
      expect(prisma.savedLook.findFirst).not.toHaveBeenCalled();
      expect(prisma.savedLook.deleteMany).not.toHaveBeenCalled();
    }
    process.env.NAIA_PROJECT_VARIANT = "staging";
  });

  // ── Explicit-allowlist defense-in-depth (requireAllowlistedSavedLooksFixtureCustomer) ──
  // Added after an explicit follow-up concern: NAIA_PROJECT_VARIANT === "staging"
  // alone does not fail closed if that exact value is ever accidentally
  // configured on the real production project. These three tests exercise
  // the ADDITIONAL, independent allowlist layer — not a re-test of the
  // NAIA_PROJECT_VARIANT check itself (S513 already covers that).

  it("S514 — simulates NAIA_PROJECT_VARIANT=staging on what is otherwise production (the allowlist unset/empty) — all three actions must still be refused, not just the ones that happen to also fail an unrelated check", async () => {
    delete process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS; // the exact misconfiguration scenario: staging flag present, QA allowlist never provisioned
    for (const _action of ["createSavedLookDetailed", "getSavedLook", "deleteSavedLook"]) {
      const res: any = await action(
        makeActionRequest({ _action, customerId: FIXTURE_CUSTOMER_ID, closetItemIds: ["item1"], savedLookId: "look1" }) as any,
      );
      expect((res as Response).status, `${_action} with NAIA_PROJECT_VARIANT=staging but no allowlist configured`).toBe(403);
    }
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
    expect(prisma.savedLook.findFirst).not.toHaveBeenCalled();
    expect(prisma.savedLook.deleteMany).not.toHaveBeenCalled();
  });

  it("S515 — a genuinely valid test-batch1- fixture customer who is simply NOT in SAVED_LOOKS_FIXTURE_CUSTOMER_IDS is still refused — the allowlist is an independent, exact-id requirement, not merely re-deriving the prefix check", async () => {
    // SAVED_LOOKS_FIXTURE_CUSTOMER_IDS is set to FIXTURE_CUSTOMER_ID only (see
    // beforeEach) — FIXTURE_CUSTOMER_ID_2 would pass requireTestCustomer
    // alone (real test-batch1- prefix) but is deliberately absent here.
    for (const _action of ["createSavedLookDetailed", "getSavedLook", "deleteSavedLook"]) {
      const res: any = await action(
        makeActionRequest({ _action, customerId: FIXTURE_CUSTOMER_ID_2, closetItemIds: ["item1"], savedLookId: "look1" }) as any,
      );
      expect((res as Response).status, `${_action} for a non-allowlisted (but real-prefix) fixture customer`).toBe(403);
    }
    expect(prisma.savedLook.create).not.toHaveBeenCalled();
  });

  it("S516 — a customer whose id (not shopifyCustomerId) is the one listed in the allowlist is still accepted — matching either field is intentional, not a bug", async () => {
    process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS = FIXTURE_CUSTOMER_ID; // matches .id, not shopifyCustomerId
    (prisma.closetItem.findMany as any).mockResolvedValue([{ id: "item1", category: "TOPS" }]);
    (prisma.savedLook.create as any).mockResolvedValue({ id: "look1", name: null, occasion: null, items: [{ id: "x", closetItemId: "item1" }] });
    const res: any = await action(
      makeActionRequest({ _action: "createSavedLookDetailed", customerId: FIXTURE_CUSTOMER_ID, closetItemIds: ["item1"] }) as any,
    );
    expect((res as Response).status).toBe(200);
  });
});
