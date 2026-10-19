// app/lib/admin-login-rate-limit.test.ts
// Priority 5 (2026-10-19) — durable admin-login brute-force protection.
//
// Mocked Prisma — no live DB. Verifies lockout counting, IP hashing (never
// the raw address reaches the DB layer), isolation between different IPs,
// and the opportunistic prune.
//
// Run: npx vitest run app/lib/admin-login-rate-limit.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    adminLoginAttempt: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

import prisma from "~/db.server";
import {
  checkAdminLoginLockout,
  recordAdminLoginAttempt,
  getClientIp,
  hashIp,
} from "./admin-login-rate-limit.server";

const mockCount = () => (prisma as any).adminLoginAttempt.count as ReturnType<typeof vi.fn>;
const mockFindFirst = () => (prisma as any).adminLoginAttempt.findFirst as ReturnType<typeof vi.fn>;
const mockCreate = () => (prisma as any).adminLoginAttempt.create as ReturnType<typeof vi.fn>;
const mockDeleteMany = () => (prisma as any).adminLoginAttempt.deleteMany as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("hashIp — never stores the raw address", () => {
  it("is deterministic and does not simply echo the input", () => {
    const h1 = hashIp("203.0.113.5");
    const h2 = hashIp("203.0.113.5");
    expect(h1).toBe(h2);
    expect(h1).not.toContain("203.0.113.5");
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("different IPs hash differently", () => {
    expect(hashIp("203.0.113.5")).not.toBe(hashIp("198.51.100.9"));
  });
});

describe("getClientIp", () => {
  it("prefers the first entry of x-forwarded-for", () => {
    const req = new Request("http://localhost/admin/login", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip, then to a constant bucket", () => {
    const req1 = new Request("http://localhost/admin/login", { headers: { "x-real-ip": "198.51.100.9" } });
    expect(getClientIp(req1)).toBe("198.51.100.9");

    const req2 = new Request("http://localhost/admin/login");
    expect(getClientIp(req2)).toBe("unknown");
  });
});

describe("checkAdminLoginLockout", () => {
  it("not locked below the threshold", async () => {
    mockCount().mockResolvedValueOnce(4);
    const result = await checkAdminLoginLockout("203.0.113.5");
    expect(result.locked).toBe(false);

    // Scoped by ipHash, succeeded:false, and the time window — not a bare count-all.
    expect(mockCount()).toHaveBeenCalledWith({
      where: {
        ipHash: hashIp("203.0.113.5"),
        succeeded: false,
        createdAt: { gte: expect.any(Date) },
      },
    });
  });

  it("locked at the threshold, with a positive retryAfterSeconds derived from the oldest failed attempt", async () => {
    mockCount().mockResolvedValueOnce(5);
    mockFindFirst().mockResolvedValueOnce({ createdAt: new Date(Date.now() - 60_000) }); // 1 minute ago
    const result = await checkAdminLoginLockout("203.0.113.5");
    expect(result.locked).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("two different IPs are tracked independently — one being locked never locks the other", async () => {
    mockCount().mockResolvedValueOnce(5); // IP A: locked
    mockFindFirst().mockResolvedValueOnce({ createdAt: new Date() });
    const a = await checkAdminLoginLockout("203.0.113.5");
    expect(a.locked).toBe(true);

    mockCount().mockResolvedValueOnce(0); // IP B: clean
    const b = await checkAdminLoginLockout("198.51.100.9");
    expect(b.locked).toBe(false);

    expect(mockCount()).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ ipHash: hashIp("203.0.113.5") }) }));
    expect(mockCount()).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ ipHash: hashIp("198.51.100.9") }) }));
  });
});

describe("recordAdminLoginAttempt", () => {
  it("writes the hashed IP and outcome, never the raw IP", async () => {
    await recordAdminLoginAttempt("203.0.113.5", false);
    expect(mockCreate()).toHaveBeenCalledWith({ data: { ipHash: hashIp("203.0.113.5"), succeeded: false } });
  });

  it("opportunistically prunes rows older than the window on every write", async () => {
    await recordAdminLoginAttempt("203.0.113.5", true);
    expect(mockDeleteMany()).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
  });

  it("a prune failure is swallowed — it must never block login", async () => {
    mockDeleteMany().mockRejectedValueOnce(new Error("db hiccup"));
    await expect(recordAdminLoginAttempt("203.0.113.5", true)).resolves.toBeUndefined();
  });
});
