// app/routes/auth.shopify.callback.email-collision.test.ts
//
// Behavioral proof (real loader execution, mocked dependencies — not just
// source-text wiring checks) that an email unique-constraint collision:
//   1. never blocks login/signup (non-fatal in both the create and the
//      per-login sync path),
//   2. never writes to any row other than the current customer's own
//      (`where: { id: customer.id }` / a freshly created distinct row) —
//      i.e. it cannot "link" two Shopify customers together or overwrite
//      a DIFFERENT account's stored email.
//
// Run: npx vitest run app/routes/auth.shopify.callback.email-collision.test.ts

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockFindUnique = vi.fn();
const mockCreate     = vi.fn();
const mockUpdate     = vi.fn();

vi.mock("~/db.server", () => ({
  default: {
    customer: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create:     (...args: unknown[]) => mockCreate(...args),
      update:     (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const mockFetchCustomerProfile = vi.fn();

vi.mock("~/lib/shopify-customer-oauth.server", () => ({
  getOidcConfig: vi.fn().mockResolvedValue({
    issuer: "https://shop.example/issuer",
    authorization_endpoint: "https://shop.example/auth",
    token_endpoint: "https://shop.example/token",
    end_session_endpoint: "https://shop.example/logout",
    jwks_uri: "https://shop.example/jwks",
  }),
  exchangeCodeForTokens: vi.fn().mockResolvedValue({
    id_token: "id-token-abc",
    access_token: "access-token-abc",
    token_type: "Bearer",
    expires_in: 3600,
  }),
  validateIdToken: vi.fn().mockResolvedValue(undefined),
  fetchCustomerProfile: (...args: unknown[]) => mockFetchCustomerProfile(...args),
  validateReturnTo: (raw: string | null) => raw ?? "/my-naia",
  validateOriginHost: () => null, // keeps every test on the normal (non cross-domain-handoff) path
}));

const mockCreateNaiaSession = vi.fn().mockResolvedValue("raw-session-token");

vi.mock("~/lib/naia-session.server", () => ({
  createNaiaSession: (...args: unknown[]) => mockCreateNaiaSession(...args),
  buildSessionCookieHeader: (raw: string) => `__naia_tok=${raw}`,
}));

const SESSION_STORE: Record<string, unknown> = {
  pkce_state:    "state-value-0001",
  pkce_verifier: "verifier-value",
  pkce_nonce:    "nonce-value",
  return_to:     "/my-naia",
  origin_host:   null,
};

vi.mock("~/lib/session.server", () => ({
  getSession: vi.fn().mockImplementation(async () => ({
    get:   (key: string) => SESSION_STORE[key],
    unset: () => {},
    set:   () => {},
  })),
  commitSession: vi.fn().mockResolvedValue("__naia_session=cleared"),
}));

function makeCallbackRequest(): Request {
  return new Request(
    "https://naia-stylist-staging.vercel.app/auth/shopify/callback?code=auth-code-0001&state=state-value-0001",
    { headers: { Cookie: "__naia_session=whatever" } },
  );
}

function p2002(message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: "P2002",
    clientVersion: "6.19.2",
  });
}

beforeAll(() => {
  process.env.SHOPIFY_APP_URL = "https://naia-stylist-staging.vercel.app";
  delete process.env.STOREFRONT_HOST;
});

beforeEach(() => {
  mockFindUnique.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockFetchCustomerProfile.mockReset();
  mockCreateNaiaSession.mockClear();
});

describe("auth.shopify.callback loader — new customer, no collision", () => {
  it("persists the on-file email at creation and completes login", async () => {
    const { loader } = await import("./auth.shopify.callback");

    mockFetchCustomerProfile.mockResolvedValue({
      customerId: "111", firstName: "Nadeen", lastName: "Abu Obead", email: "nadeen@example.com",
    });
    mockFindUnique.mockResolvedValueOnce(null); // no existing row
    mockCreate.mockResolvedValueOnce({
      id: "cust-1", shopifyCustomerId: "111", firstName: "Nadeen", lastName: "Abu Obead", email: "nadeen@example.com",
    });

    const response = await loader({ request: makeCallbackRequest(), params: {}, context: {} } as any);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { shopifyCustomerId: "111", firstName: "Nadeen", lastName: "Abu Obead", email: "nadeen@example.com" },
    });
    expect(mockCreateNaiaSession).toHaveBeenCalledWith("cust-1", expect.anything(), "id-token-abc");
    expect((response as Response).status).toBe(302);
  });
});

describe("auth.shopify.callback loader — email collision AT CREATION", () => {
  it("retries without email, creates a distinct row, and does not touch the row that already owns the email", async () => {
    const { loader } = await import("./auth.shopify.callback");

    mockFetchCustomerProfile.mockResolvedValue({
      customerId: "222", firstName: "Sam", lastName: "Rivera", email: "taken@example.com",
    });

    // 1st findUnique: no row for this shopifyCustomerId yet.
    mockFindUnique.mockResolvedValueOnce(null);
    // 1st create (with email) collides — some unrelated existing row already owns that email.
    mockCreate.mockRejectedValueOnce(p2002("Unique constraint failed on the fields: (`email`)"));
    // Re-read by shopifyCustomerId after the P2002 — still nothing (confirms the
    // collision was NOT a concurrent-callback race on shopifyCustomerId).
    mockFindUnique.mockResolvedValueOnce(null);
    // Retry create without email succeeds — a brand-new, distinct row.
    mockCreate.mockResolvedValueOnce({
      id: "cust-2", shopifyCustomerId: "222", firstName: "Sam", lastName: "Rivera", email: null,
    });
    // Immediately after creation, the per-login sync step tries to adopt the
    // (still colliding) Shopify email for this same new row — it collides
    // again, realistically, since the OTHER row still owns that email.
    mockUpdate.mockRejectedValueOnce(p2002("Unique constraint failed on the fields: (`email`)"));

    const response = await loader({ request: makeCallbackRequest(), params: {}, context: {} } as any);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    // First attempt included the colliding email...
    expect(mockCreate.mock.calls[0][0].data.email).toBe("taken@example.com");
    // ...the retry drops email entirely rather than forcing it onto another row.
    expect(mockCreate.mock.calls[1][0]).toEqual({
      data: { shopifyCustomerId: "222", firstName: "Sam", lastName: "Rivera" },
    });
    expect(mockCreate.mock.calls[1][0].data).not.toHaveProperty("email");
    // The new row keeps its OWN shopifyCustomerId — it is never merged/linked
    // into whichever row already holds "taken@example.com".
    expect(mockCreate.mock.calls[1][0].data.shopifyCustomerId).toBe("222");
    // The one update call that does happen targets ONLY this new row's own id —
    // never a lookup/write keyed by the colliding email, never another row.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      where: { id: "cust-2" }, data: { email: "taken@example.com" },
    });
    // nameUpdate was empty here (create already set the matching name), so the
    // non-fatal catch has no name-only subset to retry with — it correctly
    // does NOT attempt a second, pointless no-op update.
    // Login still succeeds — a profile-field collision is never fatal to signup,
    // and the session is created for the correct (still email-less) row.
    expect(mockCreateNaiaSession).toHaveBeenCalledWith("cust-2", expect.anything(), "id-token-abc");
    expect((response as Response).status).toBe(302);
  });
});

describe("auth.shopify.callback loader — existing customer, login sync", () => {
  it("updates name and email together when both changed", async () => {
    const { loader } = await import("./auth.shopify.callback");

    mockFetchCustomerProfile.mockResolvedValue({
      customerId: "333", firstName: "Nadine", lastName: "Abu Obead", email: "nadine-new@example.com",
    });
    mockFindUnique.mockResolvedValueOnce({
      id: "cust-3", shopifyCustomerId: "333", firstName: "Nadeen", lastName: "Abu Obead", email: "nadeen-old@example.com",
    });
    mockUpdate.mockResolvedValueOnce({
      id: "cust-3", shopifyCustomerId: "333", firstName: "Nadine", lastName: "Abu Obead", email: "nadine-new@example.com",
    });

    await loader({ request: makeCallbackRequest(), params: {}, context: {} } as any);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "cust-3" },
      data: { firstName: "Nadine", email: "nadine-new@example.com" },
    });
  });

  it("Shopify returning no email leaves the existing local email untouched — no write at all when nothing changed", async () => {
    const { loader } = await import("./auth.shopify.callback");

    mockFetchCustomerProfile.mockResolvedValue({
      customerId: "444", firstName: "Nadeen", lastName: "Abu Obead", email: null,
    });
    mockFindUnique.mockResolvedValueOnce({
      id: "cust-4", shopifyCustomerId: "444", firstName: "Nadeen", lastName: "Abu Obead", email: "nadeen@example.com",
    });

    await loader({ request: makeCallbackRequest(), params: {}, context: {} } as any);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("auth.shopify.callback loader — email collision ON LOGIN SYNC", () => {
  it("retries with the name-only subset against this customer's OWN id — never writes to any other row", async () => {
    const { loader } = await import("./auth.shopify.callback");

    mockFetchCustomerProfile.mockResolvedValue({
      customerId: "555", firstName: "Jordan", lastName: "Lee", email: "taken@example.com",
    });
    mockFindUnique.mockResolvedValueOnce({
      id: "cust-5", shopifyCustomerId: "555", firstName: "Jordan Old", lastName: "Lee", email: "jordan-old@example.com",
    });
    // First update (name + colliding email) fails — another row already owns that email.
    mockUpdate.mockRejectedValueOnce(p2002("Unique constraint failed on the fields: (`email`)"));
    // Retry with name-only succeeds.
    mockUpdate.mockResolvedValueOnce({
      id: "cust-5", shopifyCustomerId: "555", firstName: "Jordan", lastName: "Lee", email: "jordan-old@example.com",
    });

    const response = await loader({ request: makeCallbackRequest(), params: {}, context: {} } as any);

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    // Both attempts target ONLY this customer's own row — never another id, never a
    // lookup/write keyed by the colliding email itself.
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "cust-5" });
    expect(mockUpdate.mock.calls[1][0].where).toEqual({ id: "cust-5" });
    // First attempt included the colliding email...
    expect(mockUpdate.mock.calls[0][0].data).toEqual({ firstName: "Jordan", email: "taken@example.com" });
    // ...the retry drops it, keeping only the name change.
    expect(mockUpdate.mock.calls[1][0].data).toEqual({ firstName: "Jordan" });
    expect(mockUpdate.mock.calls[1][0].data).not.toHaveProperty("email");
    // Login still succeeds despite the collision.
    expect(mockCreateNaiaSession).toHaveBeenCalledWith("cust-5", expect.anything(), "id-token-abc");
    expect((response as Response).status).toBe(302);
  });

  it("even if the name-only retry ALSO fails, login proceeds with the previously-resolved customer — never fatal", async () => {
    const { loader } = await import("./auth.shopify.callback");

    mockFetchCustomerProfile.mockResolvedValue({
      customerId: "666", firstName: "Taylor", lastName: "Kim", email: "also-taken@example.com",
    });
    mockFindUnique.mockResolvedValueOnce({
      id: "cust-6", shopifyCustomerId: "666", firstName: "Taylor Old", lastName: "Kim", email: "taylor-old@example.com",
    });
    mockUpdate.mockRejectedValueOnce(p2002("Unique constraint failed on the fields: (`email`)"));
    mockUpdate.mockRejectedValueOnce(new Error("transient db error"));

    const response = await loader({ request: makeCallbackRequest(), params: {}, context: {} } as any);

    // The session is created for the ORIGINAL row (cust-6), proving the failed
    // sync never silently fell through to some other customer record.
    expect(mockCreateNaiaSession).toHaveBeenCalledWith("cust-6", expect.anything(), "id-token-abc");
    expect((response as Response).status).toBe(302);
  });
});
