// app/lib/shopify-session-storage-safety-net.server.test.ts
//
// Regression test for the root cause behind the process-crashing "Something
// went wrong" page seen repeatedly on naia-stylist-staging during transient
// Postgres blips — see attachSessionStorageReadinessSafetyNet's own doc
// comment for the full root-cause writeup.
//
// This imports ONLY the tiny, side-effect-free helper module — never the
// real shopify.server.js (that module constructs a real PrismaSessionStorage
// against the real Prisma client and calls shopifyApp() with real env vars
// at import time — too heavy and environment-dependent for a focused unit
// test). It reproduces the EXACT shape of the real bug (a promise created
// and .catch()-chained inside a constructor, with no other consumer) using
// a minimal fake, to prove the fix actually prevents Node's
// unhandledRejection event from firing.
//
// Run: npx vitest run app/lib/shopify-session-storage-safety-net.server.test.ts

import { describe, it, expect } from "vitest";
import { attachSessionStorageReadinessSafetyNet } from "./shopify-session-storage-safety-net.server.js";

// Reproduces PrismaSessionStorage's own constructor pattern exactly:
// `this.ready = this.pollForTable().then(() => true).catch(cause => { throw
// new MissingSessionTableError(...) })` — a promise built and chained
// inline, stored as an instance property, never awaited or returned by the
// constructor itself.
class FakeSessionStorageLikeRealOne {
  ready: Promise<boolean>;
  constructor(shouldFail: boolean) {
    this.ready = (shouldFail ? Promise.reject(new Error("table check failed")) : Promise.resolve())
      .then(() => true)
      .catch((cause) => {
        throw new Error(`Prisma session table does not exist: ${cause}`);
      });
  }
}

async function flushMicrotasksAndTimers() {
  // unhandledRejection fires once the microtask queue drains without a
  // handler attached — a couple of ticks is enough to observe it either way.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("attachSessionStorageReadinessSafetyNet", () => {
  it("SSR.1 — a readiness-check failure with the safety net attached never surfaces as an unhandled rejection", async () => {
    const seenUnhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => seenUnhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const storage = new FakeSessionStorageLikeRealOne(true);
      attachSessionStorageReadinessSafetyNet(storage);
      await flushMicrotasksAndTimers();
      expect(seenUnhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("SSR.2 — control case: WITHOUT the safety net, the same failure DOES surface as an unhandled rejection (proves the test actually detects the real bug, not just a tautology)", async () => {
    const seenUnhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => seenUnhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      // Deliberately NOT calling attachSessionStorageReadinessSafetyNet here.
      new FakeSessionStorageLikeRealOne(true);
      await flushMicrotasksAndTimers();
      expect(seenUnhandled.length).toBeGreaterThan(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("SSR.3 — the happy path (DB healthy) is completely unaffected: .ready still resolves true, consumers still see it", async () => {
    const storage = new FakeSessionStorageLikeRealOne(false);
    attachSessionStorageReadinessSafetyNet(storage);
    await expect(storage.ready).resolves.toBe(true);
  });

  it("SSR.4 — a genuine, persistent failure is still visible to real consumers (ensureReady-style await) — the safety net only prevents the crash, it never swallows the outcome", async () => {
    const storage = new FakeSessionStorageLikeRealOne(true);
    attachSessionStorageReadinessSafetyNet(storage);
    // A second, independent consumer (standing in for ensureReady()) still
    // observes the real rejection — our side-channel .catch() doesn't
    // replace or mask it for anyone else awaiting the same promise.
    await expect(storage.ready).rejects.toThrow(/table check failed/);
  });

  it("SSR.5 — never throws if passed something without a .ready promise (defensive no-op, e.g. a future package version changing shape)", () => {
    expect(() => attachSessionStorageReadinessSafetyNet({})).not.toThrow();
    expect(() => attachSessionStorageReadinessSafetyNet(null)).not.toThrow();
    expect(() => attachSessionStorageReadinessSafetyNet(undefined)).not.toThrow();
    expect(() => attachSessionStorageReadinessSafetyNet({ ready: "not-a-promise" })).not.toThrow();
  });
});

// ── Authentication recovery ──────────────────────────────────────────────────
//
// Mirrors the REAL package's isReady()/ensureReady() contract exactly (see
// node_modules/@shopify/shopify-app-session-storage-prisma/dist/cjs/prisma.js):
//   - isReady() NEVER throws — it internally try/catches its own re-poll and
//     always resolves, reassigning `this.ready` as its one side effect.
//   - ensureReady() awaits `.ready` and throws if it's falsy (covers BOTH a
//     rejected `.ready` promise and a resolved-false one).
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeSessionStorageWithRecovery {
  ready: Promise<boolean>;
  dbHealthy: boolean;
  isReadyCallCount = 0;

  constructor(initiallyHealthy: boolean) {
    this.dbHealthy = initiallyHealthy;
    this.ready = (initiallyHealthy ? Promise.resolve() : Promise.reject(new Error("initial table check failed")))
      .then(() => true)
      .catch((cause) => {
        throw new Error(`Prisma session table does not exist: ${cause}`);
      });
  }

  async isReady(): Promise<boolean> {
    this.isReadyCallCount++;
    try {
      if (!this.dbHealthy) throw new Error("db still down");
      this.ready = Promise.resolve(true);
    } catch {
      this.ready = Promise.resolve(false);
    }
    return this.ready;
  }

  async ensureReady(): Promise<void> {
    if (!(await this.ready)) throw new Error("MissingSessionStorageError: not ready");
  }
}

describe("attachSessionStorageReadinessSafetyNet — authentication recovery", () => {
  it("RT.6 — initial DB failure: ensureReady() fails closed when .ready starts rejected", async () => {
    const storage = new FakeSessionStorageWithRecovery(false);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 10_000 });
    await expect(storage.ensureReady()).rejects.toThrow();
  });

  it("RT.7 — subsequent recovery: once the DB is healthy again and the cooldown has elapsed, ensureReady() recovers automatically", async () => {
    const storage = new FakeSessionStorageWithRecovery(false);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 20 });

    await expect(storage.ensureReady()).rejects.toThrow(); // still down — triggers the first bounded recovery attempt
    storage.dbHealthy = true; // DB comes back
    await sleep(30); // past the 20ms cooldown

    await expect(storage.ensureReady()).resolves.toBeUndefined(); // recovers automatically
    expect(storage.isReadyCallCount).toBe(2); // exactly one attempt per failing call, bounded by cooldown
  });

  it("RT.8 — bounded retries: a second ensureReady() call within the cooldown window does NOT trigger another isReady() probe", async () => {
    const storage = new FakeSessionStorageWithRecovery(false);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 10_000 }); // long cooldown

    await expect(storage.ensureReady()).rejects.toThrow();
    const countAfterFirst = storage.isReadyCallCount;
    await expect(storage.ensureReady()).rejects.toThrow(); // still within cooldown
    expect(storage.isReadyCallCount).toBe(countAfterFirst); // no new probe — fails fast instead
  });

  it("RT.9 — persistent outage: ensureReady() keeps failing closed across multiple cooldown windows if the DB never recovers", async () => {
    const storage = new FakeSessionStorageWithRecovery(false);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 15 });

    await expect(storage.ensureReady()).rejects.toThrow();
    await sleep(20);
    await expect(storage.ensureReady()).rejects.toThrow(); // retried, still down
    await sleep(20);
    await expect(storage.ensureReady()).rejects.toThrow(); // retried again, still down
    expect(storage.isReadyCallCount).toBe(3); // exactly one bounded probe per window — never swallowed into a false success
  });

  it("RT.10 — concurrent requests: many simultaneous ensureReady() calls during one recovery window trigger exactly ONE isReady() probe", async () => {
    const storage = new FakeSessionStorageWithRecovery(false);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 10_000 });

    const results = await Promise.allSettled([
      storage.ensureReady(),
      storage.ensureReady(),
      storage.ensureReady(),
      storage.ensureReady(),
      storage.ensureReady(),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(storage.isReadyCallCount).toBe(1); // coalesced into a single DB probe, never a retry storm
  });

  it("RT.11 — never duplicates the caller's own operation: a recovery attempt running inline still results in exactly one logical write", async () => {
    const storage = new FakeSessionStorageWithRecovery(false);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 10_000 });
    let writeCount = 0;
    async function simulateStoreSession() {
      await storage.ensureReady(); // stands in for the real package's own internal call
      writeCount++; // stands in for the real package's single upsert() call
    }
    storage.dbHealthy = true; // DB already healthy by the time this one call happens
    await simulateStoreSession();
    expect(writeCount).toBe(1);
    expect(storage.isReadyCallCount).toBe(1);
  });

  it("RT.12 — happy path (DB already healthy at construction) never touches isReady() at all", async () => {
    const storage = new FakeSessionStorageWithRecovery(true);
    attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs: 10_000 });
    await expect(storage.ensureReady()).resolves.toBeUndefined();
    expect(storage.isReadyCallCount).toBe(0);
  });
});
