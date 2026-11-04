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
