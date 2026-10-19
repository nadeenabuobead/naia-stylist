// app/routes/webhooks-privacy.test.ts
// Priority 4 — Shopify mandatory privacy webhooks.
//
// Real route-handler tests for all three: signature verification, duplicate
// delivery, and correct dispatch to the customer-privacy module. Shopify's
// own HMAC verification (authenticate.webhook) is mocked to simulate both a
// valid and a forged request — no real Shopify call, no real database, no
// real Cloudinary call anywhere in this file.
//
// Run: npx vitest run app/routes/webhooks-privacy.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: vi.fn() },
}));

vi.mock("../lib/customer-privacy.server", () => ({
  compileCustomerExport: vi.fn(),
  eraseCustomerData: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import { authenticate } from "../shopify.server";
import { compileCustomerExport, eraseCustomerData } from "../lib/customer-privacy.server";
import prisma from "~/db.server";

const mockWebhook = () => authenticate.webhook as ReturnType<typeof vi.fn>;
const mockCompile = () => compileCustomerExport as ReturnType<typeof vi.fn>;
const mockErase = () => eraseCustomerData as ReturnType<typeof vi.fn>;
const mockCustomerFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockCustomerFindMany = () => (prisma as any).customer.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

function makeRequest() {
  return new Request("http://localhost/webhooks/test", { method: "POST" });
}

describe("§A — signature verification (shared by all three webhooks)", () => {
  it("A1 — data_request: a forged/invalid signature is rejected before any customer lookup", async () => {
    mockWebhook().mockRejectedValueOnce(new Response("Unauthorized", { status: 401 }));
    const { action } = await import("./webhooks.customers.data_request.tsx");

    await expect(action({ request: makeRequest() } as any)).rejects.toBeInstanceOf(Response);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockCompile()).not.toHaveBeenCalled();
  });

  it("A2 — redact: a forged/invalid signature is rejected before any erasure", async () => {
    mockWebhook().mockRejectedValueOnce(new Response("Unauthorized", { status: 401 }));
    const { action } = await import("./webhooks.customers.redact.tsx");

    await expect(action({ request: makeRequest() } as any)).rejects.toBeInstanceOf(Response);
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A3 — shop/redact: a forged/invalid signature is rejected before any erasure", async () => {
    mockWebhook().mockRejectedValueOnce(new Response("Unauthorized", { status: 401 }));
    const { action } = await import("./webhooks.shop.redact.tsx");

    await expect(action({ request: makeRequest() } as any)).rejects.toBeInstanceOf(Response);
    expect(mockCustomerFindMany()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });
});

describe("§B — customers/data_request: correct dispatch", () => {
  it("B1 — compiles the export for the matching customer, does not email anyone (no email provider exists)", async () => {
    mockWebhook().mockResolvedValueOnce({
      shop: "test-shop.myshopify.com",
      topic: "customers/data_request",
      payload: { customer: { id: "shopify-customer-123" } },
    });
    mockCustomerFindUnique().mockResolvedValueOnce({ id: "internal-customer-id" });
    mockCompile().mockResolvedValueOnce({ exportedAt: "2026-10-19T00:00:00Z" });

    const { action } = await import("./webhooks.customers.data_request.tsx");
    const res = await action({ request: makeRequest() } as any);

    expect(mockCustomerFindUnique()).toHaveBeenCalledWith({ where: { shopifyCustomerId: "shopify-customer-123" } });
    expect(mockCompile()).toHaveBeenCalledWith("internal-customer-id");
    expect(res.status).toBe(200);
  });

  it("B2 — no matching customer: still returns success, does not error", async () => {
    mockWebhook().mockResolvedValueOnce({
      shop: "test-shop.myshopify.com",
      topic: "customers/data_request",
      payload: { customer: { id: "unknown-shopify-id" } },
    });
    mockCustomerFindUnique().mockResolvedValueOnce(null);

    const { action } = await import("./webhooks.customers.data_request.tsx");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(200);
    expect(mockCompile()).not.toHaveBeenCalled();
  });
});

describe("§C — customers/redact: correct dispatch and duplicate-delivery handling", () => {
  it("C1 — erases the matching customer", async () => {
    mockWebhook().mockResolvedValueOnce({
      shop: "test-shop.myshopify.com",
      topic: "customers/redact",
      payload: { customer: { id: "shopify-customer-456" } },
    });
    mockCustomerFindUnique().mockResolvedValueOnce({ id: "internal-customer-id-2" });
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 2 });

    const { action } = await import("./webhooks.customers.redact.tsx");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledWith("internal-customer-id-2");
    expect(res.status).toBe(200);
  });

  it("C2 — duplicate delivery (customer already erased / never existed): success, not an error, erase not called again", async () => {
    mockWebhook().mockResolvedValueOnce({
      shop: "test-shop.myshopify.com",
      topic: "customers/redact",
      payload: { customer: { id: "shopify-customer-already-gone" } },
    });
    mockCustomerFindUnique().mockResolvedValueOnce(null); // this webhook's own lookup short-circuits

    const { action } = await import("./webhooks.customers.redact.tsx");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(200);
    expect(mockErase()).not.toHaveBeenCalled();
  });
});

describe("§D — shop/redact: erases every current customer (documented single-shop limitation)", () => {
  it("D1 — calls eraseCustomerData once per customer currently in the database", async () => {
    mockWebhook().mockResolvedValueOnce({ shop: "test-shop.myshopify.com", topic: "shop/redact" });
    mockCustomerFindMany().mockResolvedValueOnce([{ id: "synthetic-A" }, { id: "synthetic-B" }]);
    mockErase().mockResolvedValue({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });

    const { action } = await import("./webhooks.shop.redact.tsx");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledTimes(2);
    expect(mockErase()).toHaveBeenCalledWith("synthetic-A");
    expect(mockErase()).toHaveBeenCalledWith("synthetic-B");
    expect(res.status).toBe(200);
  });

  it("D2 — a repeat shop/redact delivery (all customers already erased) is still a success", async () => {
    mockWebhook().mockResolvedValueOnce({ shop: "test-shop.myshopify.com", topic: "shop/redact" });
    mockCustomerFindMany().mockResolvedValueOnce([]); // nothing left to erase
    const { action } = await import("./webhooks.shop.redact.tsx");
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(200);
    expect(mockErase()).not.toHaveBeenCalled();
  });
});
