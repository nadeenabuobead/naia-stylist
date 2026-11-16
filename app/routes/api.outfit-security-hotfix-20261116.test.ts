// Regression coverage for the 2026-11-16 StyleMe API security hotfix:
//   - CORS restricted from wildcard to an allowlist (api.outfit-history.jsx,
//     api.outfit-rating.jsx)
//   - api.outfit-history.jsx's loader was never covered by a dedicated
//     ownership test — added here, alongside api.outfit-rating-ownership.test.ts
//   - verbose Closet/body-preference/style-DNA logging trimmed to counts
//     (2026-11-14 hotfix) — a static check that the specific removed
//     patterns don't resurface
//
// Run: npx vitest run app/routes/api.outfit-security-hotfix-20261116.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../db.server", () => ({
  default: {
    stylingSession: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    postOutfitReview: { findMany: vi.fn() },
    outfitSuggestion: { create: vi.fn() },
  },
}));

vi.mock("../customer-auth.server", () => ({
  authenticateCustomer: vi.fn(),
}));

import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";
import { loader as historyLoader } from "./api.outfit-history";
import { loader as ratingLoader } from "./api.outfit-rating";

const mockAuth = authenticateCustomer as unknown as ReturnType<typeof vi.fn>;
const PROD_STOREFRONT_ORIGIN = "https://naiabynadine.com";
const STAGING_STOREFRONT_ORIGIN = "https://naia-test-store.myshopify.com";

function makeGet(url: string, origin?: string) {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return { request: new Request(url, { method: "GET", headers }) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── CORS allowlist ────────────────────────────────────────────────────────────

describe("CORS — restricted from wildcard to an allowlist", () => {
  it("api.outfit-history: a request from the production storefront origin gets that exact origin reflected back", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_STOREFRONT_ORIGIN);
  });

  it("api.outfit-history: a request from the approved staging test-store origin gets that exact origin reflected back", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history", STAGING_STOREFRONT_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STAGING_STOREFRONT_ORIGIN);
  });

  it("api.outfit-history: a request from an unrecognized origin gets NO Access-Control-Allow-Origin header — never a wildcard", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history", "https://evil.example.com"))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("api.outfit-history: a request with no Origin header at all (non-browser caller) gets no CORS header, and is otherwise unaffected", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history"))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("api.outfit-rating: a request from the production storefront origin gets that exact origin reflected back", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await ratingLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-rating", PROD_STOREFRONT_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_STOREFRONT_ORIGIN);
  });

  it("api.outfit-rating: a request from the approved staging test-store origin gets that exact origin reflected back", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await ratingLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-rating", STAGING_STOREFRONT_ORIGIN))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STAGING_STOREFRONT_ORIGIN);
  });

  it("api.outfit-rating: a request from an unrecognized origin gets NO Access-Control-Allow-Origin header", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });
    const res = (await ratingLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-rating", "https://evil.example.com"))) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("neither route file sends a wildcard Access-Control-Allow-Origin anywhere in source", () => {
    const historySrc = fs.readFileSync(path.resolve("app/routes/api.outfit-history.jsx"), "utf8");
    const ratingSrc = fs.readFileSync(path.resolve("app/routes/api.outfit-rating.jsx"), "utf8");
    expect(historySrc).not.toMatch(/Access-Control-Allow-Origin["'\s:]*["']\*["']/);
    expect(ratingSrc).not.toMatch(/Access-Control-Allow-Origin["'\s:]*["']\*["']/);
  });
});

// ── api.outfit-history loader — ownership / isolation (previously untested) ──

describe("api.outfit-history loader — ownership and isolation", () => {
  it("an unauthenticated GET returns an empty history, not an error and not another customer's data", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });

    const res = (await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history"))) as Response;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ history: [], authenticated: false });
    expect(prisma.stylingSession.findMany).not.toHaveBeenCalled();
  });

  it("the query is scoped to the authenticated caller's own customerId — never a client-supplied id", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.stylingSession.findMany as any).mockResolvedValueOnce([]);

    // Even if a caller tries to smuggle a different customerId via a query
    // param, authenticateCustomer's resolved customer.id is the only
    // identity ever used to build the Prisma query below.
    await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history?customerId=customer-B"));

    expect(prisma.stylingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "customer-A" } }),
    );
  });

  it("customer A's returned history never includes customer B's sessions (Prisma scoping is the actual boundary; this proves the call is scoped before any data returns)", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.stylingSession.findMany as any).mockImplementationOnce(async ({ where }: any) => {
      // Simulates a real DB: only rows matching the queried customerId are
      // ever returned. If the route ever queried with the wrong id, this
      // mock would return customer B's row instead.
      const rows = [
        { id: "session-A1", customerId: "customer-A", createdAt: new Date(), currentMood: "confident" },
        { id: "session-B1", customerId: "customer-B", createdAt: new Date(), currentMood: "secret" },
      ];
      return rows.filter(r => r.customerId === where.customerId);
    });

    const res = (await historyLoader(makeGet("https://naia-stylist.vercel.app/api/outfit-history"))) as Response;
    const body = await res.json();

    expect(body.history).toHaveLength(1);
    expect(body.history[0].id).toBe("session-A1");
  });
});

// ── Log redaction — static regression check ──────────────────────────────────

describe("sensitive-data logging — trimmed patterns do not resurface", () => {
  it("api.outfit-history.jsx no longer logs the full closetItems/naiaPiece payload", () => {
    const src = fs.readFileSync(path.resolve("app/routes/api.outfit-history.jsx"), "utf8");
    expect(src).not.toMatch(/console\.log\([^)]*naiaPieceTitle/);
    expect(src).not.toMatch(/console\.log\(["']Outfit history received:["'][^)]*closetItems,\s*naiaPiece/);
    expect(src).not.toMatch(/console\.log\(["']SAVING SUGGESTIONS[^"']*["'],\s*closetItems/);
  });

  it("api.outfit-rating.jsx no longer logs full tag arrays, bodyPreference, styleDNA, or product titles", () => {
    const src = fs.readFileSync(path.resolve("app/routes/api.outfit-rating.jsx"), "utf8");
    expect(src).not.toMatch(/workedTags:\s*body\.workedTags/);
    expect(src).not.toMatch(/bodyPref:\s*linkedSession\?\.bodyPreference/);
    expect(src).not.toMatch(/styleDNA:\s*linkedSession\?\.styleDNA/);
    expect(src).not.toMatch(/productTitle\s*\|\|\s*`Closet/);
  });

  it("neither file contains a literally duplicated console.log call", () => {
    for (const file of ["app/routes/api.outfit-history.jsx", "app/routes/api.outfit-rating.jsx"]) {
      const src = fs.readFileSync(path.resolve(file), "utf8");
      const logLines = src.split("\n").filter(l => l.trim().startsWith("console.log("));
      const unique = new Set(logLines.map(l => l.trim()));
      expect(unique.size, `${file} has a duplicated console.log line`).toBe(logLines.length);
    }
  });
});
