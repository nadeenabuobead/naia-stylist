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

function makeActionRequest(body: object): { request: Request } {
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": STAGING_SECRET },
      body: JSON.stringify(body),
    }),
  };
}

describe("§S5 seed-staging SavedLook fixture actions", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;

    (prisma.customer.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === FIXTURE_CUSTOMER_ID) {
        return Promise.resolve({ id: FIXTURE_CUSTOMER_ID, shopifyCustomerId: "test-batch1-wi-fixture" });
      }
      if (where.id === REAL_CUSTOMER_ID) {
        return Promise.resolve({ id: REAL_CUSTOMER_ID, shopifyCustomerId: "real-customer-456" });
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
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
});
