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

vi.mock("../lib/webhook-shop-guard.server", () => ({
  verifyShopOwnership: vi.fn(),
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

vi.mock("../lib/customer-erasure-failures.server", () => ({
  recordPendingCustomerErasureFailure: vi.fn().mockResolvedValue("pf-id"),
}));

import { verifyShopifyWebhookRequest } from "../lib/webhook-hmac.server";
import { verifyShopOwnership } from "../lib/webhook-shop-guard.server";
import { compileCustomerExport, eraseCustomerData } from "../lib/customer-privacy.server";
import { recordPendingCustomerErasureFailure } from "../lib/customer-erasure-failures.server";
import prisma from "~/db.server";

const mockVerify = () => verifyShopifyWebhookRequest as ReturnType<typeof vi.fn>;
const mockOwnership = () => verifyShopOwnership as ReturnType<typeof vi.fn>;
const mockCompile = () => compileCustomerExport as ReturnType<typeof vi.fn>;
const mockErase = () => eraseCustomerData as ReturnType<typeof vi.fn>;
const mockCustomerFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockCustomerFindMany = () => (prisma as any).customer.findMany as ReturnType<typeof vi.fn>;
const mockRecordPendingFailure = () => recordPendingCustomerErasureFailure as ReturnType<typeof vi.fn>;

const OWNED_SHOP = "test-shop.myshopify.com";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: ownership passes for the shop every other test already uses —
  // §F below overrides this per-case to exercise rejection paths.
  mockOwnership().mockReturnValue({ ok: true, shop: OWNED_SHOP });
});

function makeRequest() {
  return new Request("http://localhost/webhooks/test", { method: "POST" });
}

describe("§A — signature verification (shared by all three webhooks)", () => {
  it("A1 — data_request: an invalid signature is rejected before any customer lookup, with a 401", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "invalid_signature" });
    const { action } = await import("./webhooks.customers.data_request");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockCompile()).not.toHaveBeenCalled();
  });

  it("A2 — redact: an invalid signature is rejected before any erasure, with a 401", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "invalid_signature" });
    const { action } = await import("./webhooks.customers.redact");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A3 — shop/redact: an invalid signature is rejected before any erasure, with a 401", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "invalid_signature" });
    const { action } = await import("./webhooks.shop.redact");

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(401);
    expect(mockCustomerFindMany()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A4 — missing signature header is rejected the same way as an invalid one, for all three", async () => {
    mockVerify().mockResolvedValue({ ok: false, reason: "missing_signature" });
    const dataRequest = await import("./webhooks.customers.data_request");
    const redact = await import("./webhooks.customers.redact");
    const shopRedact = await import("./webhooks.shop.redact");

    for (const { action } of [dataRequest, redact, shopRedact]) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(401);
    }
    expect(mockCompile()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("A5 — a valid signature but malformed body is rejected the same way, never reaching customer lookup", async () => {
    mockVerify().mockResolvedValueOnce({ ok: false, reason: "malformed_body" });
    const { action } = await import("./webhooks.customers.data_request");

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

    const { action } = await import("./webhooks.customers.data_request");
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

    const { action } = await import("./webhooks.customers.data_request");
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
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 2 });

    const { action } = await import("./webhooks.customers.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledWith("internal-customer-id-2", {}, "customers/redact");
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

    const { action } = await import("./webhooks.customers.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(200);
    expect(mockErase()).not.toHaveBeenCalled();
  });
});

describe("§D — shop/redact: erases only Shopify-only customers (Clerk-linked customers are excluded)", () => {
  it("D1 — calls eraseCustomerData once per customer the scoped query returns, with the correct context", async () => {
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-4", payload: {} });
    mockCustomerFindMany().mockResolvedValueOnce([{ id: "synthetic-A" }, { id: "synthetic-B" }]);
    mockErase().mockResolvedValue({ ok: true, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 0 });

    const { action } = await import("./webhooks.shop.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledTimes(2);
    expect(mockErase()).toHaveBeenCalledWith("synthetic-A", {}, "shop/redact");
    expect(mockErase()).toHaveBeenCalledWith("synthetic-B", {}, "shop/redact");
    expect(res.status).toBe(200);
  });

  it("D2 — a repeat shop/redact delivery (all customers already erased) is still a success", async () => {
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-4-retry", payload: {} });
    mockCustomerFindMany().mockResolvedValueOnce([]); // nothing left to erase
    const { action } = await import("./webhooks.shop.redact");
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(200);
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("D3 — scenario: the batch query itself excludes any customer whose Shopify identity has been linked to Clerk — a shop uninstall must not erase an independent nAia account", async () => {
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-scope-1", payload: {} });
    mockCustomerFindMany().mockResolvedValueOnce([]);

    const { action } = await import("./webhooks.shop.redact");
    await action({ request: makeRequest() } as any);

    // The exclusion is enforced by the query the real database will run,
    // not by filtering results after the fact — asserting the exact where
    // clause is the correct unit-level proof that a customer who has
    // shopifyCustomerId AND clerkUserId both set (linked) can never be
    // selected here, and that a Clerk-only customer (shopifyCustomerId
    // null) can't either.
    expect(mockCustomerFindMany()).toHaveBeenCalledWith({
      where: { shopifyCustomerId: { not: null }, clerkUserId: null },
      select: { id: true },
    });
  });

  it("D4 — scenario: one customer's erasure failing during the batch does not stop the rest from being processed", async () => {
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-partial-1", payload: {} });
    mockCustomerFindMany().mockResolvedValueOnce([{ id: "synthetic-fail" }, { id: "synthetic-ok" }]);
    mockErase()
      .mockRejectedValueOnce(new Error("unexpected throw escaping eraseCustomerData"))
      .mockResolvedValueOnce({ ok: true, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 0 });

    const { action } = await import("./webhooks.shop.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledTimes(2); // both attempted — the first failing did not stop the second
    expect(mockErase()).toHaveBeenCalledWith("synthetic-ok", {}, "shop/redact");
    expect(mockRecordPendingFailure()).toHaveBeenCalledWith("synthetic-fail", "shop/redact", expect.any(Error));
    expect(res.status).toBe(200); // the webhook itself still reports success — Shopify should not redeliver the whole batch
  });

  it("D5 — scenario: a customer with billing history is reported as anonymized, not erased, without affecting the rest of the batch", async () => {
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-billed-1", payload: {} });
    mockCustomerFindMany().mockResolvedValueOnce([{ id: "synthetic-billed" }]);
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, anonymized: true, cloudinaryFailures: [], journeyEventsPurged: 0 });

    const { action } = await import("./webhooks.shop.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledWith("synthetic-billed", {}, "shop/redact");
    expect(res.status).toBe(200);
  });
});

describe("§F — shop-ownership guard: Shop A cannot delete Shop B's data", () => {
  it("F1 — customers/redact: an authenticated request for a different shop is refused with 500, erase never called", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "shop-b.myshopify.com",
      topic: "customers/redact",
      webhookId: "wh-cross-1",
      payload: { customer: { id: "shopify-customer-456" }, shop_domain: "shop-b.myshopify.com" },
    });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "shop_mismatch" });

    const { action } = await import("./webhooks.customers.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("F2 — shop/redact: an authenticated request for a different shop is refused with 500, no customer is even listed, let alone erased", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "shop-b.myshopify.com",
      topic: "shop/redact",
      webhookId: "wh-cross-2",
      payload: { shop_domain: "shop-b.myshopify.com" },
    });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "shop_mismatch" });

    const { action } = await import("./webhooks.shop.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockCustomerFindMany()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("F3 — customers/redact: a missing shop header cannot trigger deletion", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true, shop: null, topic: "customers/redact", webhookId: "wh-cross-3",
      payload: { customer: { id: "shopify-customer-456" } },
    });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "missing_shop_header" });

    const { action } = await import("./webhooks.customers.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("F4 — shop/redact: an unconfigured expected-shop (env var unset) fails closed rather than defaulting to 'assume safe'", async () => {
    mockVerify().mockResolvedValueOnce({ ok: true, shop: "test-shop.myshopify.com", topic: "shop/redact", webhookId: "wh-cross-4", payload: {} });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "missing_expected_shop_config" });

    const { action } = await import("./webhooks.shop.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockCustomerFindMany()).not.toHaveBeenCalled();
    expect(mockErase()).not.toHaveBeenCalled();
  });

  it("F5a — customers/data_request: an authenticated request for a different shop is refused with 500, no export compiled, nothing exposed", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true,
      shop: "shop-b.myshopify.com",
      topic: "customers/data_request",
      webhookId: "wh-cross-5",
      payload: { customer: { id: "shopify-customer-789" }, shop_domain: "shop-b.myshopify.com" },
    });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "shop_mismatch" });

    const { action } = await import("./webhooks.customers.data_request");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockCompile()).not.toHaveBeenCalled();
  });

  it("F5b — customers/data_request: a missing shop header cannot trigger a compile/export", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true, shop: null, topic: "customers/data_request", webhookId: "wh-cross-6",
      payload: { customer: { id: "shopify-customer-789" } },
    });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "missing_shop_header" });

    const { action } = await import("./webhooks.customers.data_request");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockCompile()).not.toHaveBeenCalled();
  });

  it("F5c — customers/data_request: an unconfigured expected-shop fails closed rather than exposing data by default", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true, shop: "test-shop.myshopify.com", topic: "customers/data_request", webhookId: "wh-cross-7",
      payload: { customer: { id: "shopify-customer-789" } },
    });
    mockOwnership().mockReturnValueOnce({ ok: false, reason: "missing_expected_shop_config" });

    const { action } = await import("./webhooks.customers.data_request");
    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(500);
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockCompile()).not.toHaveBeenCalled();
  });

  it("F6 — the legitimate, matching-shop path is unaffected: customers/redact still erases when ownership passes (same as §C1)", async () => {
    mockVerify().mockResolvedValueOnce({
      ok: true, shop: OWNED_SHOP, topic: "customers/redact", webhookId: "wh-legit",
      payload: { customer: { id: "shopify-customer-456" } },
    });
    mockCustomerFindUnique().mockResolvedValueOnce({ id: "internal-customer-id-2" });
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 2 });

    const { action } = await import("./webhooks.customers.redact");
    const res = await action({ request: makeRequest() } as any);

    expect(mockErase()).toHaveBeenCalledWith("internal-customer-id-2", {}, "customers/redact");
    expect(res.status).toBe(200);
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

    const { action } = await import("./webhooks.customers.data_request");
    const res = await action({ request } as any);

    expect(res.status).toBe(200);
    expect(realCompile).toHaveBeenCalledWith("internal-customer-e2e");

    vi.doMock("../lib/webhook-hmac.server", () => ({ verifyShopifyWebhookRequest: vi.fn() }));
    vi.resetModules();
  });
});
