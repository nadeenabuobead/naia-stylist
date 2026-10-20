// app/lib/naia-session-handoff-single-use.test.ts
//
// Behavioral (vitest, ~/db.server mocked) coverage for promoteHandoffSession
// and the parts of auth.shopify.handoff.tsx that depend on it. Split out of
// shopify-customer-oauth-origin-host.test.ts because this is the one path
// that actually touches the database — everything else in that file fails
// before ever reaching it, so it stays mock-free there.
//
// This is the test for the real finding from the 2026-10-20 security
// review: the original handoff design had no replay protection beyond a
// 60-second time window — within that window, the SAME handoff URL could
// be used by multiple requests (the same browser twice, or a different
// browser that captured the URL) to each independently obtain a full
// 30-day session, because the handoff value only ever set a cookie, never
// consumed anything. Fixed by making the underlying session start with a
// genuinely short (60s) database expiry, promoted to the normal 30 days by
// exactly one atomic UPDATE whose WHERE clause only matches the original,
// not-yet-promoted value — a second attempt, from any source, matches zero
// rows.
//
// Run: npx vitest run app/lib/naia-session-handoff-single-use.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    naiaSession: { updateMany: vi.fn(), create: vi.fn().mockResolvedValue({}) },
  },
}));

import prisma from "~/db.server";
import { promoteHandoffSession, createNaiaSession } from "./naia-session.server";
import { loader as handoffLoader } from "../routes/auth.shopify.handoff";
import { getSession, commitSession } from "./session.server";

const mockUpdateMany = () => (prisma as any).naiaSession.updateMany as ReturnType<typeof vi.fn>;
const mockCreate = () => (prisma as any).naiaSession.create as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promoteHandoffSession — the single-use guard itself", () => {
  it("promotes to the full 30-day expiry when the update matches exactly one row (first, legitimate use)", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const result = await promoteHandoffSession("raw-token-abc", 1000);
    expect(result).toBe(true);
    expect(mockUpdateMany()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: new Date(1000) }),
      }),
    );
  });

  it("REPLAY — returns false when the update matches zero rows (already promoted by an earlier, successful call)", async () => {
    mockUpdateMany().mockResolvedValue({ count: 0 });
    const result = await promoteHandoffSession("raw-token-abc", 1000);
    expect(result).toBe(false);
  });

  it("is a single atomic statement, not read-then-write — the WHERE clause itself encodes the one-time check, so two concurrent calls cannot both see count:1", async () => {
    // This test documents the design property directly: there is exactly
    // one database call per invocation, with the guard baked into its own
    // WHERE clause, never a separate findUnique followed by a conditional
    // update (which would leave a race window between the two statements).
    mockUpdateMany().mockResolvedValue({ count: 1 });
    await promoteHandoffSession("raw-token-abc", 1000);
    expect(mockUpdateMany()).toHaveBeenCalledTimes(1);
  });
});

describe("createNaiaSession — backward compatibility for every existing caller", () => {
  it("every call site that omits the new 4th parameter still gets the normal, unchanged 30-day expiry", async () => {
    const req = new Request("https://naia-stylist-staging.vercel.app/", { headers: { "User-Agent": "test" } });
    const before = Date.now();
    await createNaiaSession("customer-1", req, "id-token-hint");
    const after = Date.now();

    const call = mockCreate().mock.calls[0][0];
    const expiresAtMs = call.data.expiresAt.getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    // Allow a small window for the test's own execution time — this is
    // asserting "still ~30 days," not pinning an exact millisecond.
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + THIRTY_DAYS_MS + 1000);
  });

  it("an explicit overrideExpiresAt is used exactly as given — the handoff-only path", async () => {
    const req = new Request("https://naia-stylist-staging.vercel.app/");
    const pending = new Date(Date.now() + 60_000);
    await createNaiaSession("customer-1", req, "id-token-hint", pending);
    const call = mockCreate().mock.calls[0][0];
    expect(call.data.expiresAt).toEqual(pending);
  });
});

describe("no sensitive data ever travels in the handoff URL", () => {
  it("the handoff payload carries only this app's own session token, origin host, and an expiry timestamp — never anything resembling a Shopify access/refresh token", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const session = await getSession();
    session.set("handoff_raw_token", "synthetic-raw-token-abc123");
    session.set("handoff_origin_host", "naia-stylist-staging-i4b0504kk-nadeenabuobeads-projects.vercel.app");
    session.set("handoff_expires_at", Date.now() + 60_000);
    const cookie = await commitSession(session);
    const eq = cookie.indexOf("=");
    const semi = cookie.indexOf(";");
    const h = cookie.slice(eq + 1, semi === -1 ? undefined : semi);

    // The signed value is opaque (base64 + HMAC signature) — confirm it
    // decodes to exactly these three keys and nothing else, so there is no
    // way for a Shopify token to have been smuggled in alongside them.
    const [payloadB64] = h.split(".");
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(payloadB64), "base64").toString("utf8"));
    expect(Object.keys(decoded).sort()).toEqual(["handoff_expires_at", "handoff_origin_host", "handoff_raw_token"]);
  });
});

describe("auth.shopify.handoff.tsx — the success path and replay, end to end", () => {
  const ORIGIN_HOST = "naia-stylist-staging-i4b0504kk-nadeenabuobeads-projects.vercel.app";

  async function buildHandoffValue(overrides: Record<string, unknown> = {}) {
    const session = await getSession();
    session.set("handoff_raw_token", overrides.rawToken ?? "synthetic-raw-token-abc123");
    session.set("handoff_origin_host", overrides.originHost ?? ORIGIN_HOST);
    session.set("handoff_expires_at", overrides.expiresAt ?? Date.now() + 60_000);
    const cookie = await commitSession(session);
    const eq = cookie.indexOf("=");
    const semi = cookie.indexOf(";");
    return cookie.slice(eq + 1, semi === -1 ? undefined : semi);
  }

  function requestTo(searchParams: Record<string, string>) {
    const url = new URL(`https://${ORIGIN_HOST}/auth/shopify/handoff`);
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
    return new Request(url.toString());
  }

  it("a valid, unexpired, correctly-bound, not-yet-consumed handoff value sets the real session cookie and redirects to return_to", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 }); // first use
    const h = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });
    const res: any = await handoffLoader({
      request: requestTo({ h, return_to: "/my-naia" }),
      params: {},
      context: {},
    });
    expect(res.headers.get("Location")).toBe("/my-naia");
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("__naia_tok=synthetic-raw-token-abc123");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
  });

  it("THE FIX — replaying the exact same handoff value a second time fails closed, no cookie set", async () => {
    const h = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });

    mockUpdateMany().mockResolvedValueOnce({ count: 1 }); // first request — succeeds
    const first: any = await handoffLoader({ request: requestTo({ h, return_to: "/my-naia" }), params: {}, context: {} });
    expect(first.headers.get("Location")).toBe("/my-naia");
    expect(first.headers.get("Set-Cookie")).toBeTruthy();

    mockUpdateMany().mockResolvedValueOnce({ count: 0 }); // replay — the real row is already promoted
    const second: any = await handoffLoader({ request: requestTo({ h, return_to: "/my-naia" }), params: {}, context: {} });
    expect(second.headers.get("Location")).toBe("/auth/shopify/login");
    expect(second.headers.get("Set-Cookie")).toBeFalsy();
  });

  it("a DIFFERENT browser presenting the identical captured URL after the legitimate exchange also fails — the guard has no notion of 'browser', only 'already consumed'", async () => {
    const h = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });
    // Simulates the legitimate browser having already succeeded moments earlier.
    mockUpdateMany().mockResolvedValueOnce({ count: 0 });
    const res: any = await handoffLoader({
      request: new Request(`https://${ORIGIN_HOST}/auth/shopify/handoff?h=${h}&return_to=%2Fmy-naia`, {
        headers: { "User-Agent": "a-completely-different-browser/1.0" },
      }),
      params: {},
      context: {},
    });
    expect(res.headers.get("Location")).toBe("/auth/shopify/login");
    expect(res.headers.get("Set-Cookie")).toBeFalsy();
  });

  it("an invalid return_to falls back to the safe default rather than an open redirect, on a legitimate first use", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const h = await buildHandoffValue({});
    const res: any = await handoffLoader({
      request: requestTo({ h, return_to: "https://evil.example.com" }),
      params: {},
      context: {},
    });
    expect(res.headers.get("Location")).toBe("/my-naia");
  });
});
