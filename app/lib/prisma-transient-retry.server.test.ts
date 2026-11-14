import { describe, it, expect, vi } from "vitest";
import { isTransientDatabaseError, withTransientRetry, DatabaseUnavailableError } from "./prisma-transient-retry.server";

function prismaError(code: string) {
  const err = new Error("boom") as Error & { code: string };
  err.code = code;
  return err;
}

function initializationError(message: string) {
  const err = new Error(message);
  err.name = "PrismaClientInitializationError";
  return err;
}

describe("isTransientDatabaseError", () => {
  for (const code of ["P1001", "P1002", "P1008", "P1017", "P2024"]) {
    it(`classifies ${code} as transient`, () => {
      expect(isTransientDatabaseError(prismaError(code))).toBe(true);
    });
  }

  it("classifies a codeless connection-pool PrismaClientInitializationError as transient", () => {
    expect(isTransientDatabaseError(initializationError("Timed out fetching a new connection from the connection pool"))).toBe(true);
  });

  it("does not classify an unrelated error as transient", () => {
    expect(isTransientDatabaseError(new Error("some other failure"))).toBe(false);
    expect(isTransientDatabaseError(prismaError("P2002"))).toBe(false);
  });

  it("does not throw on null/non-object input", () => {
    expect(isTransientDatabaseError(null)).toBe(false);
    expect(isTransientDatabaseError(undefined)).toBe(false);
    expect(isTransientDatabaseError("a string")).toBe(false);
  });
});

describe("withTransientRetry", () => {
  it("returns the result on first success without any retry", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withTransientRetry(op, { _sleep: sleep });

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries exactly once on a transient error, then returns the second attempt's result", async () => {
    const op = vi.fn().mockRejectedValueOnce(prismaError("P2024")).mockResolvedValueOnce("recovered");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withTransientRetry(op, { _sleep: sleep });

    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it("never retries more than once — a second transient failure throws DatabaseUnavailableError, not a third attempt", async () => {
    const op = vi.fn().mockRejectedValue(prismaError("P2024"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withTransientRetry(op, { _sleep: sleep })).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-transient error immediately, without sleeping or retrying", async () => {
    const nonTransient = new Error("not transient");
    const op = vi.fn().mockRejectedValue(nonTransient);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withTransientRetry(op, { _sleep: sleep })).rejects.toBe(nonTransient);
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rethrows a non-transient error on the second attempt as-is, not wrapped in DatabaseUnavailableError", async () => {
    const nonTransient = new Error("different failure on retry");
    const op = vi.fn().mockRejectedValueOnce(prismaError("P2024")).mockRejectedValueOnce(nonTransient);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withTransientRetry(op, { _sleep: sleep })).rejects.toBe(nonTransient);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("uses the real timer-based sleep by default when no _sleep dependency is injected", async () => {
    const op = vi.fn().mockRejectedValueOnce(prismaError("P2024")).mockResolvedValueOnce("ok");
    const start = Date.now();
    const result = await withTransientRetry(op);
    expect(result).toBe("ok");
    expect(Date.now() - start).toBeGreaterThanOrEqual(190); // ~200ms real delay, small tolerance
  });
});
