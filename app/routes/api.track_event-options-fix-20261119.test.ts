// Regression coverage for the 2026-11-19 api.track_event.jsx OPTIONS fix.
//
// React Router dispatches an OPTIONS preflight to a route's loader, never
// its action (confirmed against the working pattern in api.outfit-history.jsx,
// which has both). api.track_event.jsx had only an action, so its own
// `if (request.method === "OPTIONS")` branch inside action() was dead code —
// a real browser preflight fell through to React Router's default no-loader
// handling, producing an inconsistent 400/500 instead of 204. Added a loader
// that answers OPTIONS correctly; every real (non-preflight) call is still a
// POST and still goes through action() exactly as before.
//
// Run: npx vitest run app/routes/api.track_event-options-fix-20261119.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => ({
  default: { stylingEvent: { create: vi.fn() } },
}));

vi.mock("../customer-auth.server", () => ({
  authenticateCustomer: vi.fn(),
}));

import { authenticateCustomer } from "../customer-auth.server";
import { loader, action } from "./api.track_event";

const mockAuth = authenticateCustomer as unknown as ReturnType<typeof vi.fn>;
const PROD_STOREFRONT_ORIGIN = "https://naiabynadine.com";
const EVIL_ORIGIN = "https://naiabynadine.com.evil.com";

function makeRequest(method: string, origin?: string) {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  if (method === "OPTIONS") headers["Access-Control-Request-Method"] = "POST";
  return { request: new Request("https://naia-stylist.vercel.app/api/track_event", { method, headers }) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ customer: null });
});

describe("api.track_event — loader answers OPTIONS preflight (2026-11-19 fix)", () => {
  it("loader exists (OPTIONS must reach it, not action)", () => {
    expect(typeof loader).toBe("function");
  });

  it("loader: OPTIONS from an approved origin gets 204 with that origin reflected", async () => {
    const res = (await loader(makeRequest("OPTIONS", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_STOREFRONT_ORIGIN);
  });

  it("loader: OPTIONS from an unrecognized origin gets 204 with no CORS header — never a wildcard", async () => {
    const res = (await loader(makeRequest("OPTIONS", EVIL_ORIGIN))) as Response;
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("loader: a non-OPTIONS method reaching the loader (shouldn't normally happen) fails safely, not with a 500", async () => {
    const res = (await loader(makeRequest("GET", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.status).toBe(405);
  });

  it("action: OPTIONS still also returns 204 directly (defense in depth, unchanged contract)", async () => {
    const res = (await action(makeRequest("OPTIONS", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.status).toBe(204);
  });

  it("action: a real POST still reaches authentication exactly as before", async () => {
    const res = (await action(makeRequest("POST", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.status).toBe(401);
  });
});
