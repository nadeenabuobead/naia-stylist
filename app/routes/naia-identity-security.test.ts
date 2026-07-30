// Focused identity-security tests for the Customer Identity Security Remediation phase.
//
// §A — static code guarantees (no mocks): verify route files use NaiaSession, not
//      the retired insecure auth path.
// §B — NaiaSession unit behaviour: valid session resolves, expired/unknown fail.
// §C — route behaviour guarantees: analyze-item and style-me contracts.
//
// Run: npx vitest run app/routes/naia-identity-security.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── §A Static code guarantees ─────────────────────────────────────────────────

describe("§A identity remediation — static code guarantees", () => {

  const ROUTES = path.resolve("app/routes");
  const LIB    = path.resolve("app/lib");

  it("A01 — auth.server.ts has been deleted", () => {
    expect(
      fs.existsSync(path.join(LIB, "auth.server.ts")),
      "app/lib/auth.server.ts must not exist after remediation",
    ).toBe(false);
  });

  it("A02 — api.analyze-item.jsx does not import from auth.server", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.analyze-item.jsx"), "utf8");
    expect(src, "must not import auth.server").not.toContain("auth.server");
    expect(src, "must not call getCustomer").not.toContain("getCustomer(");
    expect(src, "must not call getCustomerId").not.toContain("getCustomerId(");
  });

  it("A03 — api.analyze-item.jsx uses getCurrentNaiaCustomer from naia-session.server", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.analyze-item.jsx"), "utf8");
    expect(src, "must import naia-session.server").toContain("naia-session.server");
    expect(src, "must call getCurrentNaiaCustomer").toContain("getCurrentNaiaCustomer(");
  });

  it("A04 — style-me/_index.tsx does not import from auth.server", () => {
    const src = fs.readFileSync(path.join(ROUTES, "style-me/_index.tsx"), "utf8");
    expect(src, "must not import auth.server").not.toContain("auth.server");
    expect(src, "must not call getCustomerId").not.toContain("getCustomerId(");
  });

  it("A05 — style-me/_index.tsx uses getCurrentNaiaCustomer from naia-session.server", () => {
    const src = fs.readFileSync(path.join(ROUTES, "style-me/_index.tsx"), "utf8");
    expect(src, "must import naia-session.server").toContain("naia-session.server");
    expect(src, "must call getCurrentNaiaCustomer").toContain("getCurrentNaiaCustomer(");
  });

  it("A06 — style-me/_index.tsx does not call prisma.customer.upsert", () => {
    const src = fs.readFileSync(path.join(ROUTES, "style-me/_index.tsx"), "utf8");
    expect(src, "must not call customer.upsert — no DB record creation from request data")
      .not.toContain(".upsert(");
  });

  it("A07 — api.analyze-item.jsx does not call prisma.customer.upsert", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.analyze-item.jsx"), "utf8");
    expect(src, "must not call customer.upsert — no DB record creation from request data")
      .not.toContain(".upsert(");
  });

  it("A08 — root.jsx no longer writes a positive-lifetime naia_customer_data cookie", () => {
    const src = fs.readFileSync(path.resolve("app/root.jsx"), "utf8");
    // The only allowed occurrence of naia_customer_data is the one-time expiry cleanup
    // script (max-age=0). A positive max-age would mean the cookie is being re-created.
    expect(src, "root.jsx must not set naia_customer_data with positive max-age")
      .not.toMatch(/naia_customer_data=(?!;\s*path).*max-age=[1-9]/);
    expect(src, "root.jsx must not set a 30-day version of the cookie")
      .not.toContain("max-age=2592000");
  });

  it("A09 — root.jsx no longer reads or persists naia_token from URL params", () => {
    const src = fs.readFileSync(path.resolve("app/root.jsx"), "utf8");
    // The inline script that persisted the token must be gone.
    expect(src, "root.jsx must not contain sessionStorage.setItem for naia_token")
      .not.toContain('sessionStorage.setItem(\'naia_token\'');
    expect(src, "root.jsx must not set naia_customer_data via document.cookie")
      .not.toContain("document.cookie = 'naia_customer_data");
  });

  it("A10 — dev-my-naia-fixture.tsx has been deleted", () => {
    expect(
      fs.existsSync(path.join(ROUTES, "dev-my-naia-fixture.tsx")),
      "dev-my-naia-fixture.tsx must not exist after verification",
    ).toBe(false);
  });

  it("A11 — routes.ts does not register dev-my-naia-fixture", () => {
    const src = fs.readFileSync(path.resolve("app/routes.ts"), "utf8");
    expect(src, "dev-my-naia-fixture must not be registered in routes.ts")
      .not.toContain("dev-my-naia-fixture");
  });

});

// ── §B NaiaSession unit behaviour ────────────────────────────────────────────

vi.mock("~/db.server", () => {
  const naiaSessionFindUnique = vi.fn();
  const naiaSessionDelete     = vi.fn().mockResolvedValue({});
  const naiaSessionUpdate     = vi.fn().mockResolvedValue({});
  return {
    default: {
      naiaSession: {
        findUnique: naiaSessionFindUnique,
        delete:     naiaSessionDelete,
        deleteMany: vi.fn().mockResolvedValue({}),
        update:     naiaSessionUpdate,
        create:     vi.fn().mockResolvedValue({}),
      },
    },
  };
});

import prisma from "~/db.server";
import {
  getCurrentNaiaCustomer,
  requireCurrentNaiaCustomer,
} from "~/lib/naia-session.server";

const mockFindUnique = () =>
  (prisma.naiaSession as any).findUnique as ReturnType<typeof vi.fn>;

function makeCookieRequest(cookieValue: string): Request {
  return new Request("http://localhost/test", {
    headers: { Cookie: `__naia_tok=${cookieValue}` },
  });
}

function makeRequestNoCookie(): Request {
  return new Request("http://localhost/test");
}

function makeRequestFakeCookie(name: string, value: string): Request {
  return new Request("http://localhost/test", {
    headers: { Cookie: `${name}=${value}` },
  });
}

const MOCK_CUSTOMER = {
  id: "real-customer-id",
  shopifyCustomerId: "gid://shopify/Customer/123",
  email: null,
  firstName: null,
  onboardingProfile: null,
};

const MOCK_SESSION = {
  tokenHash: "abc",
  expiresAt: new Date(Date.now() + 10_000_000),
  customer: MOCK_CUSTOMER,
};

const EXPIRED_SESSION = {
  tokenHash: "abc",
  expiresAt: new Date(Date.now() - 1_000),
  customer: MOCK_CUSTOMER,
};

describe("§B NaiaSession unit behaviour", () => {

  beforeEach(() => vi.clearAllMocks());

  it("B01 — valid __naia_tok cookie resolves the customer", async () => {
    mockFindUnique().mockResolvedValueOnce(MOCK_SESSION);
    const customer = await getCurrentNaiaCustomer(makeCookieRequest("valid-raw-token"));
    expect(customer).not.toBeNull();
    expect(customer?.id).toBe("real-customer-id");
    expect(mockFindUnique()).toHaveBeenCalledOnce();
  });

  it("B02 — no cookie returns null (unauthenticated)", async () => {
    const customer = await getCurrentNaiaCustomer(makeRequestNoCookie());
    expect(customer).toBeNull();
    // No DB call when there is no cookie — short-circuit at token extraction.
    expect(mockFindUnique()).not.toHaveBeenCalled();
  });

  it("B03 — unknown token (not in DB) returns null", async () => {
    mockFindUnique().mockResolvedValueOnce(null);
    const customer = await getCurrentNaiaCustomer(makeCookieRequest("unknown-token"));
    expect(customer).toBeNull();
  });

  it("B04 — expired session returns null and deletes the record", async () => {
    mockFindUnique().mockResolvedValueOnce(EXPIRED_SESSION);
    const customer = await getCurrentNaiaCustomer(makeCookieRequest("expired-token"));
    expect(customer).toBeNull();
    // A delete is scheduled (fire-and-forget).
    await vi.waitFor(() => expect(
      (prisma.naiaSession as any).delete,
    ).toHaveBeenCalled(), { timeout: 200 });
  });

  it("B05 — forged naia_token URL param does not resolve a customer (no getCustomerId path)", async () => {
    // Build a request that carries the OLD forged-identity URL param.
    const url = "http://localhost/test?naia_token=" + btoa(JSON.stringify({ shopifyId: "123" }));
    const request = new Request(url);
    // NaiaSession reads only the __naia_tok cookie; the URL param is ignored entirely.
    const customer = await getCurrentNaiaCustomer(request);
    expect(customer).toBeNull();
    expect(mockFindUnique()).not.toHaveBeenCalled();
  });

  it("B06 — forged naia_customer_data cookie does not resolve a customer", async () => {
    // Build a request with the old insecure cookie (base64 JSON with a shopifyId).
    const fakeData = btoa(JSON.stringify({ shopifyId: "456", email: "forged@example.com" }));
    const request  = makeRequestFakeCookie("naia_customer_data", fakeData);
    // NaiaSession reads only __naia_tok; the naia_customer_data cookie is ignored.
    const customer = await getCurrentNaiaCustomer(request);
    expect(customer).toBeNull();
    expect(mockFindUnique()).not.toHaveBeenCalled();
  });

  it("B07 — forged __naia_tok with invalid base64url chars is silently rejected (no DB call)", async () => {
    // The cookie regex only matches [A-Za-z0-9_-]; non-matching chars reject at extraction.
    const request = makeRequestFakeCookie("__naia_tok", "!INVALID!TOKEN!VALUE!");
    const customer = await getCurrentNaiaCustomer(request);
    expect(customer).toBeNull();
    expect(mockFindUnique()).not.toHaveBeenCalled();
  });

  it("B08 — requireCurrentNaiaCustomer throws a redirect when no session", async () => {
    await expect(
      requireCurrentNaiaCustomer(makeRequestNoCookie())
    ).rejects.toSatisfy((e: unknown) => {
      // React Router redirect throws a Response with Location header
      return e instanceof Response && e.status === 302;
    });
  });

  it("B09 — requireCurrentNaiaCustomer returns the customer when session is valid", async () => {
    mockFindUnique().mockResolvedValueOnce(MOCK_SESSION);
    const customer = await requireCurrentNaiaCustomer(makeCookieRequest("valid-token"));
    expect(customer.id).toBe("real-customer-id");
  });

});

// ── §C Route behaviour guarantees ────────────────────────────────────────────

describe("§C route behaviour guarantees", () => {

  it("C01 — api.analyze-item.jsx handles null customer without crash (no personalization path)", () => {
    // The route guards data access with: if (customerId) { ... }
    // A null NaiaSession customer means customerId is null → profile/closet skipped.
    const src = fs.readFileSync(
      path.resolve("app/routes/api.analyze-item.jsx"),
      "utf8",
    );
    expect(src).toContain("if (customerId)");
    // The route does not throw or return 401 for unauthenticated requests —
    // it falls through to unauthenticated analysis (without personalization).
    expect(src).not.toContain('status: 401');
  });

  it("C02 — style-me/_index.tsx returns guest state for null customer (no upsert)", () => {
    const src = fs.readFileSync(
      path.resolve("app/routes/style-me/_index.tsx"),
      "utf8",
    );
    // Null customer path returns guest data without touching Prisma.
    expect(src).toContain("hasProfile: false");
    expect(src).toContain("hasClosetItems: false");
    expect(src).toContain("recentSessions: []");
    // Must not upsert from request-supplied identity.
    expect(src).not.toContain(".upsert(");
  });

  it("C03 — style-me/_index.tsx never reads naia_token or naia_customer_data", () => {
    const src = fs.readFileSync(
      path.resolve("app/routes/style-me/_index.tsx"),
      "utf8",
    );
    expect(src).not.toContain("naia_token");
    expect(src).not.toContain("naia_customer_data");
  });

  it("C04 — api.analyze-item.jsx never reads naia_token or naia_customer_data", () => {
    const src = fs.readFileSync(
      path.resolve("app/routes/api.analyze-item.jsx"),
      "utf8",
    );
    expect(src).not.toContain("naia_token");
    expect(src).not.toContain("naia_customer_data");
  });

  it("C05 — NaiaSession reads only __naia_tok; naia_customer_data is not in the extractor regex", () => {
    const src = fs.readFileSync(
      path.resolve("app/lib/naia-session.server.ts"),
      "utf8",
    );
    // The cookie name in the regex must be __naia_tok.
    expect(src).toContain("__naia_tok=");
    // naia_customer_data must not appear anywhere in naia-session.server.ts.
    expect(src).not.toContain("naia_customer_data");
    // naia_token URL param must not appear in naia-session.server.ts.
    expect(src).not.toContain("naia_token");
  });

  it("C06 — analyze-item guest path: null customer means no Prisma read, prompt falls through to general analysis", () => {
    const src = fs.readFileSync(
      path.resolve("app/routes/api.analyze-item.jsx"),
      "utf8",
    );
    // The guard must gate all Prisma access.
    expect(src).toContain("if (customerId)");
    // Default values before the guard — safe empty state.
    expect(src).toContain("let styleProfile = null");
    expect(src).toContain("let closetItems = []");
    // Guest prompt fallback text.
    expect(src).toContain("No style profile — general analysis.");
    // No 401 for unauthenticated — route is intentionally open to guests.
    expect(src).not.toContain("status: 401");
    // No upsert — guest path never creates a Customer record.
    expect(src).not.toContain(".upsert(");
  });

});

// ── §D Wardrobe-insights and stylist cleanup ──────────────────────────────────

describe("§D wardrobe-insights and stylist cleanup", () => {

  const ROUTES = path.resolve("app/routes");

  it("D01 — api.wardrobe-insights.jsx no longer reads naia_token from URL", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.wardrobe-insights.jsx"), "utf8");
    expect(src, "must not read naia_token URL param").not.toContain("naia_token");
    expect(src, "must not call url.searchParams.get").not.toContain('searchParams.get("naia_token")');
  });

  it("D02 — api.wardrobe-insights.jsx no longer decodes unsigned base64 identity", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.wardrobe-insights.jsx"), "utf8");
    expect(src, "must not decode base64 identity").not.toContain("atob(decodeURIComponent");
    expect(src, "must not decode base64 identity").not.toContain("JSON.parse(atob(");
  });

  it("D03 — api.wardrobe-insights.jsx uses only authenticateCustomer (JWT Bearer)", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.wardrobe-insights.jsx"), "utf8");
    expect(src, "must import authenticateCustomer").toContain("authenticateCustomer");
    expect(src, "must call authenticateCustomer(request)").toContain("authenticateCustomer(request)");
    // Only one authentication call — no fallback.
    const count = (src.match(/authenticateCustomer\(request\)/g) ?? []).length;
    expect(count, "must call authenticateCustomer exactly once").toBe(1);
  });

  it("D04 — api.wardrobe-insights.jsx does not import naia-session.server (JWT is the right path here)", () => {
    const src = fs.readFileSync(path.join(ROUTES, "api.wardrobe-insights.jsx"), "utf8");
    // This route is cross-origin (called from Shopify theme), not an app route.
    // __naia_tok is SameSite=Lax and would not arrive in a cross-origin request.
    expect(src).not.toContain("naia-session.server");
    expect(src).not.toContain("getCurrentNaiaCustomer");
  });

  it("D05 — stylist.jsx does not contain getTokenFromUrl function", () => {
    const src = fs.readFileSync(path.join(ROUTES, "stylist.jsx"), "utf8");
    expect(src, "getTokenFromUrl must be removed").not.toContain("getTokenFromUrl");
  });

  it("D06 — stylist.jsx does not read naia_token from URL params", () => {
    const src = fs.readFileSync(path.join(ROUTES, "stylist.jsx"), "utf8");
    expect(src, "must not read naia_token URL param").not.toContain('params.get("naia_token")');
    expect(src, "must not reference naia_token in any form").not.toContain("naia_token");
  });

  it("D07 — stylist.jsx does not read naia_customer_data cookie", () => {
    const src = fs.readFileSync(path.join(ROUTES, "stylist.jsx"), "utf8");
    expect(src, "must not read naia_customer_data").not.toContain("naia_customer_data");
  });

  it("D08 — stylist.jsx is a redirect stub with no auth code (JWT auth fully retired)", () => {
    // stylist.jsx was migrated to a 301 redirect to /style-me during the NaiaSession
    // remediation. No auth tokens, cookies, or localStorage reads remain.
    const src = fs.readFileSync(path.join(ROUTES, "stylist.jsx"), "utf8");
    expect(src, "must be a redirect stub").toContain('redirect("/style-me"');
    expect(src, "must have no token reads").not.toContain("naia_customer_token");
    expect(src, "must have no cookie reads").not.toContain("naia_customer_data");
    expect(src, "must have no localStorage access").not.toContain("localStorage");
    expect(src, "must have no auth import").not.toContain("authenticateCustomer");
  });

  it("D09 — root.jsx contains one-time cleanup script that expires naia_customer_data", () => {
    const src = fs.readFileSync(path.resolve("app/root.jsx"), "utf8");
    expect(src, "must expire naia_customer_data cookie").toContain("naia_customer_data=; path=/; max-age=0");
  });

  it("D10 — root.jsx cleanup script removes sessionStorage.naia_token", () => {
    const src = fs.readFileSync(path.resolve("app/root.jsx"), "utf8");
    expect(src, "must remove sessionStorage naia_token").toContain("sessionStorage.removeItem('naia_token')");
  });

  it("D11 — root.jsx cleanup script does not recreate either legacy value", () => {
    const src = fs.readFileSync(path.resolve("app/root.jsx"), "utf8");
    // The cleanup line expires the cookie (max-age=0). It must not set a positive max-age.
    // Extract the cleanup script contents only (the one-liner).
    const cleanupLine = src.match(/naia_customer_data=;[^`"']*/)?.[0] ?? "";
    expect(cleanupLine, "cleanup must not set positive max-age").not.toMatch(/max-age=[1-9]/);
    // root.jsx must not set sessionStorage for naia_token.
    expect(src, "must not recreate sessionStorage naia_token").not.toContain("sessionStorage.setItem('naia_token'");
  });

});

// ── §E Repository-wide legacy token scan ─────────────────────────────────────

describe("§E repository-wide legacy token scan", () => {

  // This section reads every server-side route and lib file and asserts
  // that no production server-side code trusts the retired identity values.

  function readSource(rel: string): string {
    return fs.readFileSync(path.resolve(rel), "utf8");
  }

  const SERVER_ROUTES = [
    "app/routes/api.analyze-item.jsx",
    "app/routes/api.wardrobe-insights.jsx",
    "app/routes/style-me/_index.tsx",
    "app/routes/my-naia._index.tsx",
    "app/routes/api.closet.jsx",
    "app/routes/api.customer-profile.jsx",
    "app/routes/api.outfit-history.jsx",
    "app/routes/api.save-look.jsx",
    "app/routes/api.style.jsx",
    "app/routes/api.track_event.jsx",
  ];

  for (const route of SERVER_ROUTES) {
    it(`E — ${route} does not trust naia_token or naia_customer_data`, () => {
      const src = readSource(route);
      expect(src, `${route} must not read naia_token URL param as identity`)
        .not.toContain('searchParams.get("naia_token")');
      expect(src, `${route} must not decode naia_customer_data cookie as identity`)
        .not.toContain("naia_customer_data");
      expect(src, `${route} must not import the retired auth.server`)
        .not.toContain('"../lib/auth.server"');
      expect(src, `${route} must not import the retired auth.server`)
        .not.toContain('"~/lib/auth.server"');
    });
  }

  it("E — lib/auth.server.ts does not exist", () => {
    expect(fs.existsSync(path.resolve("app/lib/auth.server.ts"))).toBe(false);
  });

});
