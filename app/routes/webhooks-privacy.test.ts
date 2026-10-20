// app/routes/webhooks-privacy.test.ts
// Priority 4 — Shopify mandatory privacy webhooks.
//
// Real route-handler tests for all three: signature verification, duplicate
// delivery, and correct dispatch to the customer-privacy module.
//
// Verification itself (verifyShopifyWebhookRequest) is mocked here so these
// tests stay focused on dispatch logic — no real Shopify call, no real
// database, no real Cloudinary call anywhere in this file. The real crypto
// path has its own dedicated, unmocked coverage in webhook-hmac.server.test.ts.
//
// §E below is the one group that does NOT mock verification — it uses a
// genuinely signed request end-to-end, with no session/Prisma-session mock
// present at all, as a direct regression test against the exact bug this
// change fixes (authenticate.webhook() requiring a `session` table this
// app's custom NaiaSession architecture never creates).
//
// Run: npx vitest run app/routes/webhooks-privacy.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.mock("../lib/webhook-hmac.server", () => ({
  verifyShopifyWebhookRequest: vi.fn(),
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

import { verifyShopifyWebhookRequest } from "../lib/webhook-hmac.server";
import { compileCustomerExport, eraseCustomerData } from "../lib/customer-privacy.server";
import prisma from "~/db.server";

const mockVerify = () => verifyShopifyWebhookRequest as ReturnType<typeof vi.fn>;
const mockCompile = () => compileCustomerExport as ReturnType<typeof vi.fn>;
const mockErase = () => eraseCustomerData as ReturnType<typeof vi.fn>;
const mockCustomerFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockCustomerFindMany = () => (prisma as any).customer.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

function makeRequest() {
  return new Request("http://localhost/webhooks/test", { method: "POST" });
}

describe("§A — signature verification (shared by all three webhooks)", () => {
  it("A1 — data_request: an invalid signature is rejected before any customer lookup, with a 401", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "invalid_signature" });
    const { action } = await import("./webhooks.customers.data_request.tsx");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockCompile()).not.toHaveBeenCalled();
  });

  it("A2 — redact: an invalid signature is rejected before any erasure, with a 401", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "invalid_signature" });
    const { action } = await import("./webhooks.customers.redact.tsx");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A3 — shop/redact: an invalid signature is rejected before any erasure, with a 401", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "invalid_signature" });
    const { action } = await import("./webhooks.shop.redact.tsx");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockCustomerFindMany()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A4 — missing signature header is rejected the same way as an invalid one, for all three", async () => {
    mockVerify().mockResolvedValue({ ok: false, reason: "missing_signature" });
    const dataRequest = await import("./webhooks.customers.data_request.tsx");
    const redact = await import("./webhooks.customers.redact.tsx");
    const shopRedact = await import("./webhooks.shop.redact.tsx");

    for (const { action } of [dataRequest, redact, shopRedact]) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(401);
    }
    expect(mockCompile()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A5 — a valid signature but malformed body is rejected the same way, never reaching customer lookup", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "malformed_body" });
    const { action } = await import("./webhooks.customers.data_request.tsx");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
  });
});

describe("§B — customers/data_request: correct dispatch", () => {
  it("B1 — compiles the export for the matching customer, does not email anyone (no email provider exists)", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "test-shop.myshopify.com",
      topic: "customers/data_request",
      webhookId: "wh-1",
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
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "test-shop.myshopify.com",
      topic: "customers/data_request",
      webhookId: "wh-2",
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
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "test-shop.myshopify.com",
      topic: "customers/redact",
      webhookId: "wh-3",
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
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "test-shop.myshopify.com",
      topic: "customers/redact",
      webhookId: "wh-3-retry",
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
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-4", payload: {} });
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
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-4-retry", payload: {} });
    mockCustomerFindMany().mockResolvedValueOnce([]); // nothing left to erase
    const { action } = await import("./webhooks.shop.redact.tsx");
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(200);
    expect(mockErase()).not.toHaveBeenCalled();
  });
});

describe("§E — regression: a genuinely signed request succeeds with zero session/Prisma-session dependency", () => {
  // No mock of verifyShopifyWebhookRequest in this group — real crypto, real
  // header reading, exactly what MissingSessionTableError broke. If this
  // group ever needs a session-table mock to pass, the bug is back.
  it("E1 — customers/data_request: a real HMAC-signed request completes with no session table involved", async () => {
    vi.doUnmock("../lib/webhook-hmac.server");
    vi.resetModules();
    process.env.SHOPIFY_API_SECRET = "e2e-test-secret";

    const { compileCustomerExport: realCompile } = await import("../lib/customer-privacy.server");
    (realCompile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ exportedAt: "2026-10-20T00:00:00Z" });
    (prisma as any).customer.findUnique.mockResolvedValueOnce({ id: "internal-customer-e2e" });

    const body = JSON.stringify({ customer: { id: "shopify-customer-e2e" } });
    const hmac = createHmac("sha256", "e2e-test-secret").update(body, "utf8").digest("base64");
    const request = new Request("http://localhost/webhooks/customers/data_request", {
      method: "POST",
      headers: {
        "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Topic": "customers/data_request",
        "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
      },
      body,
    });

    const { action } = await import("./webhooks.customers.data_request.tsx");
    const res = await action({ request } as any);

    expect(res.status).toBe(200);
    expect(realCompile).toHaveBeenCalledWith("internal-customer-e2e");

    vi.doMock("../lib/webhook-hmac.server", () => ({ verifyShopifyWebhookRequest: vi.fn() }));
    vi.resetModules();
  });
});
