// Regression coverage for the 2026-11-19 wardrobe-insights security hotfix:
// api.wardrobe-insights.jsx sent "Access-Control-Allow-Origin: *" on every
// response (never restricted by PR #3's 2026-11-16 CORS hotfix, which only
// covered api.outfit-history.jsx/api.outfit-rating.jsx). This route is
// auto-registered by flatRoutes() despite not being listed in routes.ts, and
// authenticates via the same JWT mechanism those two routes use — the same
// token-replay risk PR #3 already closed elsewhere. Restricted to the same
// approved storefront allowlist via buildCorsHeaders(), the established
// pattern. No other behavior changed.
//
// Run: npx vitest run app/routes/api.wardrobe-insights-cors-hotfix-20261119.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    closetItem: { findMany: vi.fn() },
  },
}));

vi.mock("../customer-auth.server", () => ({
  authenticateCustomer: vi.fn(),
}));

import { authenticateCustomer } from "../customer-auth.server";
import { loader } from "./api.wardrobe-insights";

const mockAuth = authenticateCustomer as unknown as ReturnType<typeof vi.fn>;
const PROD_STOREFRONT_ORIGIN = "https://naiabynadine.com";
const STAGING_STOREFRONT_ORIGIN = "https://naia-test-store.myshopify.com";
const EVIL_ORIGIN = "https://naiabynadine.com.evil.com";

function makeRequest(method: string, origin?: string) {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return { request: new Request("https://naia-stylist.vercel.app/api/wardrobe-insights", { method, headers }) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ customer: null }); // cheapest, unauthenticated path — all we need for a CORS-header check
});

describe("CORS — api.wardrobe-insights restricted from wildcard to the approved allowlist (2026-11-19 hotfix)", () => {
  it("a request from the production storefront origin gets that exact origin reflected back", async () => {
    const res = (await loader(makeRequest("GET", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_STOREFRONT_ORIGIN);
  });

  it("a request from the approved staging test-store origin gets that exact origin reflected back", async () => {
    const res = (await loader(makeRequest("GET", STAGING_STOREFRONT_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STAGING_STOREFRONT_ORIGIN);
  });

  it("a request from an unrecognized origin gets NO Access-Control-Allow-Origin header — never a wildcard", async () => {
    const res = (await loader(makeRequest("GET", EVIL_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("a request with no Origin header at all (non-browser caller) gets no CORS header, and is otherwise unaffected", async () => {
    const res = (await loader(makeRequest("GET", undefined))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.status).toBeLessThan(500);
  });

  it("OPTIONS preflight from an approved origin gets that origin reflected back, 204, no body", async () => {
    const res = (await loader(makeRequest("OPTIONS", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_STOREFRONT_ORIGIN);
  });

  it("OPTIONS preflight from an unrecognized origin gets 204 with no CORS header, never a wildcard", async () => {
    const res = (await loader(makeRequest("OPTIONS", EVIL_ORIGIN))) as Response;
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("unauthenticated request (no customer) still returns 401 — CORS restriction did not loosen auth", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await loader(makeRequest("GET", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.status).toBe(401);
  });
});
