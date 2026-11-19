// app/lib/lazy-shopify-session-storage.server.test.ts
//
// This module is deliberately injectable (createReal is a parameter, not
// imported) specifically so it can be unit-tested without a real Prisma
// client, real PrismaSessionStorage, or real Shopify SDK — see
// shopify.server.js's own comment for why that matters (those have real
// module-load-time side effects).
//
// Run: npx vitest run app/lib/lazy-shopify-session-storage.server.test.ts

import { describe, it, expect, vi } from "vitest";
import { createLazySessionStorage } from "./lazy-shopify-session-storage.server.js";

function fakeRealStorage() {
  return {
    storeSession: vi.fn().mockResolvedValue(true),
    loadSession: vi.fn().mockResolvedValue({ id: "sess_1" }),
    deleteSession: vi.fn().mockResolvedValue(true),
    deleteSessions: vi.fn().mockResolvedValue(true),
    findSessionsByShop: vi.fn().mockResolvedValue([]),
    isReady: vi.fn().mockResolvedValue(true),
    ensureReady: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createLazySessionStorage", () => {
  it("never calls createReal before any method is invoked", () => {
    const createReal = vi.fn(fakeRealStorage);
    createLazySessionStorage(createReal);
    expect(createReal).not.toHaveBeenCalled();
  });

  it("calls createReal exactly once, on the first method call — no matter which method", async () => {
    const createReal = vi.fn(fakeRealStorage);
    const lazy = createLazySessionStorage(createReal);
    await lazy.isReady();
    expect(createReal).toHaveBeenCalledTimes(1);
  });

  it("does NOT construct a second real instance on later method calls", async () => {
    const createReal = vi.fn(fakeRealStorage);
    const lazy = createLazySessionStorage(createReal);
    await lazy.ensureReady();
    await lazy.loadSession("sess_1");
    await lazy.storeSession({ id: "sess_1" } as never);
    expect(createReal).toHaveBeenCalledTimes(1);
  });

  it("does not construct twice when two methods are called concurrently without awaiting the first", async () => {
    const createReal = vi.fn(fakeRealStorage);
    const lazy = createLazySessionStorage(createReal);
    await Promise.all([lazy.ensureReady(), lazy.isReady()]);
    expect(createReal).toHaveBeenCalledTimes(1);
  });

  it("delegates every method to the real instance with the same arguments and return value", async () => {
    const real = fakeRealStorage();
    const lazy = createLazySessionStorage(() => real);

    const session = { id: "sess_1" } as never;
    await expect(lazy.storeSession(session)).resolves.toBe(true);
    expect(real.storeSession).toHaveBeenCalledWith(session);

    await expect(lazy.loadSession("sess_1")).resolves.toEqual({ id: "sess_1" });
    expect(real.loadSession).toHaveBeenCalledWith("sess_1");

    await expect(lazy.deleteSession("sess_1")).resolves.toBe(true);
    expect(real.deleteSession).toHaveBeenCalledWith("sess_1");

    await expect(lazy.deleteSessions(["sess_1", "sess_2"])).resolves.toBe(true);
    expect(real.deleteSessions).toHaveBeenCalledWith(["sess_1", "sess_2"]);

    await expect(lazy.findSessionsByShop("shop.myshopify.com")).resolves.toEqual([]);
    expect(real.findSessionsByShop).toHaveBeenCalledWith("shop.myshopify.com");

    await expect(lazy.isReady()).resolves.toBe(true);
    expect(real.isReady).toHaveBeenCalledTimes(1);

    await expect(lazy.ensureReady()).resolves.toBeUndefined();
    expect(real.ensureReady).toHaveBeenCalledTimes(1);
  });

  it("propagates a rejection from the real instance's method instead of swallowing it", async () => {
    const real = fakeRealStorage();
    real.ensureReady.mockRejectedValueOnce(new Error("Prisma session storage is not ready"));
    const lazy = createLazySessionStorage(() => real);
    await expect(lazy.ensureReady()).rejects.toThrow("Prisma session storage is not ready");
  });

  it("propagates a synchronous throw from createReal itself (construction failure is not swallowed)", async () => {
    const createReal = vi.fn(() => {
      throw new Error("PrismaClient does not have a session table");
    });
    const lazy = createLazySessionStorage(createReal);
    await expect(lazy.isReady()).rejects.toThrow("PrismaClient does not have a session table");
  });
});
