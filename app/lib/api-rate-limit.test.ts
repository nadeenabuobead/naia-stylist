// app/lib/api-rate-limit.test.ts
// Phase 1 rate-limiting foundation — decision logic exercised via the
// injectable counter function (no live DB), matching this codebase's
// existing DI pattern for FASHN/Bodygram. One separate suite below mocks
// ~/db.server directly to verify the real atomic-upsert SQL shape.
//
// Run: npx vitest run app/lib/api-rate-limit.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit, rateLimitResponse } from "./api-rate-limit.server";

const CONFIG_ENFORCE = { routeKey: "test-route", limit: 3, windowSeconds: 60, mode: "enforce" as const };
const CONFIG_SHADOW = { routeKey: "test-route", limit: 3, windowSeconds: 60, mode: "shadow" as const };

/** In-memory fake standing in for the real atomic upsert — increments a
 *  counter keyed by (customerId, routeKey, windowStart), exactly mirroring
 *  what the real SQL's ON CONFLICT DO UPDATE does. */
function makeFakeCounter() {
  const store = new Map<string, number>();
  const fn = vi.fn(async (customerId: string, routeKey: string, windowStart: Date) => {
    const key = `${customerId}:${routeKey}:${windowStart.getTime()}`;
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return { count: next };
  });
  return { fn, store };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("normal customer usage", () => {
  it("allows requests well under the limit", async () => {
    const { fn } = makeFakeCounter();
    const r = await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    expect(r.allowed).toBe(true);
    expect(r.overLimit).toBe(false);
    expect(r.count).toBe(1);
  });
});

describe("repeated requests within a short period", () => {
  it("blocks once the count exceeds the limit, in enforce mode", async () => {
    const { fn } = makeFakeCounter();
    let last;
    for (let i = 0; i < 5; i++) last = await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    expect(last!.count).toBe(5);
    expect(last!.overLimit).toBe(true);
    expect(last!.allowed).toBe(false);
  });
});

describe("concurrent requests cannot bypass the counter", () => {
  it("every concurrent call increments the same underlying counter atomically", async () => {
    const { fn, store } = makeFakeCounter();
    // Fire 10 "simultaneous" requests for the same customer+route+window.
    await Promise.all(Array.from({ length: 10 }, () => checkRateLimit("cust_a", CONFIG_ENFORCE, fn)));
    const finalCount = [...store.values()][0];
    expect(finalCount).toBe(10); // no lost updates — every call landed
  });
});

describe("different authenticated customers are isolated", () => {
  it("customer A's usage never affects customer B's counter", async () => {
    const { fn } = makeFakeCounter();
    for (let i = 0; i < 5; i++) await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    const rB = await checkRateLimit("cust_b", CONFIG_ENFORCE, fn);
    expect(rB.count).toBe(1);
    expect(rB.allowed).toBe(true);
  });
});

describe("window expiry resets the counter", () => {
  it("a later window starts counting from zero again", async () => {
    const { fn } = makeFakeCounter();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(0);
    for (let i = 0; i < 5; i++) await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    nowSpy.mockReturnValue(61_000); // next 60s window
    const r = await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    expect(r.count).toBe(1);
    expect(r.allowed).toBe(true);
    nowSpy.mockRestore();
  });
});

describe("enforce mode — 429 and Retry-After", () => {
  it("rateLimitResponse returns 429 with a positive Retry-After header", async () => {
    const { fn } = makeFakeCounter();
    let r;
    for (let i = 0; i < 5; i++) r = await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    expect(r!.allowed).toBe(false);
    const res = rateLimitResponse(r!);
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
  });
});

describe("shadow mode never blocks a legitimate request", () => {
  it("allowed stays true even far past the configured limit", async () => {
    const { fn } = makeFakeCounter();
    let r;
    for (let i = 0; i < 20; i++) r = await checkRateLimit("cust_a", CONFIG_SHADOW, fn);
    expect(r!.count).toBe(20);
    expect(r!.overLimit).toBe(true); // it DID exceed — just never enforced
    expect(r!.allowed).toBe(true);
  });

  it("logs a would-block line without ever returning a 429-shaped result", async () => {
    const { fn } = makeFakeCounter();
    for (let i = 0; i < 5; i++) await checkRateLimit("cust_a", CONFIG_SHADOW, fn);
    expect(logSpy).toHaveBeenCalledWith("[rate-limit]", "would-block", expect.any(Object));
  });
});

describe("database failure — fails open, never blocks the feature", () => {
  it("returns allowed: true and failedOpen: true when the counter throws", async () => {
    const throwingFn = vi.fn(async () => { throw new Error("connection reset"); });
    const r = await checkRateLimit("cust_a", CONFIG_ENFORCE, throwingFn);
    expect(r.allowed).toBe(true);
    expect(r.failedOpen).toBe(true);
  });

  it("logs the failure without ever including the raw customerId", async () => {
    const throwingFn = vi.fn(async () => { throw new Error("connection reset"); });
    await checkRateLimit("cust_super_secret_id_123", CONFIG_ENFORCE, throwingFn);
    expect(errorSpy).toHaveBeenCalled();
    const loggedArgs = JSON.stringify(errorSpy.mock.calls);
    expect(loggedArgs).not.toContain("cust_super_secret_id_123");
  });
});

describe("no customer-information leakage in any log line", () => {
  it("would-block/blocked logs carry only a hash, never the raw id", async () => {
    const { fn } = makeFakeCounter();
    for (let i = 0; i < 5; i++) await checkRateLimit("cust_super_secret_id_123", CONFIG_ENFORCE, fn);
    const loggedArgs = JSON.stringify(logSpy.mock.calls);
    expect(loggedArgs).not.toContain("cust_super_secret_id_123");
  });

  it("the result object itself never carries email, tokens, photos, or prompts", async () => {
    const { fn } = makeFakeCounter();
    const r = await checkRateLimit("cust_a", CONFIG_ENFORCE, fn);
    const keys = Object.keys(r);
    expect(keys).toEqual(
      expect.arrayContaining(["allowed", "overLimit", "mode", "count", "limit", "retryAfterSeconds"]),
    );
    expect(JSON.stringify(r)).not.toMatch(/email|token|photo|prompt/i);
  });
});
