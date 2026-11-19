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

function unknownRequestError(message: string) {
  const err = new Error(message);
  err.name = "PrismaClientUnknownRequestError";
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

  it("classifies a codeless 'Can't reach database server' PrismaClientInitializationError as transient (2026-11-18 QA finding — the exact real error captured from quknuu0if's /style-me crash)", () => {
    const realMessage = "\nInvalid `prisma.customer.findUnique()` invocation:\n\n\nCan't reach database server at `pooled.db.prisma.io:5432`\n\nPlease make sure your database server is running at `pooled.db.prisma.io:5432`.";
    expect(isTransientDatabaseError(initializationError(realMessage))).toBe(true);
  });

  it("is case-insensitive and matches the bare phrase regardless of surrounding text", () => {
    expect(isTransientDatabaseError(initializationError("CAN'T REACH DATABASE SERVER at somewhere"))).toBe(true);
    expect(isTransientDatabaseError(initializationError("some prefix text can't reach database server some suffix"))).toBe(true);
  });

  it("does not classify an unrelated error as transient", () => {
    expect(isTransientDatabaseError(new Error("some other failure"))).toBe(false);
    expect(isTransientDatabaseError(prismaError("P2002"))).toBe(false);
  });

  it("SAFETY BOUNDARY (2026-11-19 founder safety review): does NOT classify 08P01 as transient at the isTransientDatabaseError level — this is the function the WRITE-transaction retry loops in entitlement.server.ts and api.closet.jsx call directly. 08P01 retry is deliberately scoped to withTransientRetry's read-only callers only (see isTransientOnUnknownRequestError in the source) so a reservation's count-check-then-create transaction is never blindly retried on a protocol error that could, under the newly-evidenced stale-pooled-connection mechanism, occur after a commit already reached the server", () => {
    const realMessage =
      'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "08P01", message: "protocol violation", severity: "ERROR", detail: None, hint: None, routine: Some("exec_bind_message") }) })';
    expect(isTransientDatabaseError(unknownRequestError(realMessage))).toBe(false);
    const staleConnMessage = 'PostgresError { code: "08P01", message: "server conn crashed?", routine: Some("SocketBackend") }';
    expect(isTransientDatabaseError(unknownRequestError(staleConnMessage))).toBe(false);
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

  it("retries exactly once on 08P01, then returns the second attempt's result (the new stale-pooled-connection mitigation, read-only callers only)", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(unknownRequestError('PostgresError { code: "08P01", message: "server conn crashed?" }'))
      .mockResolvedValueOnce("recovered");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withTransientRetry(op, { _sleep: sleep });

    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("08P01 retry is bounded exactly like every other transient error — a second 08P01 throws DatabaseUnavailableError, not a third attempt, and never silently conceals the persistent failure", async () => {
    const op = vi.fn().mockRejectedValue(unknownRequestError('PostgresError { code: "08P01", message: "server conn crashed?" }'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withTransientRetry(op, { _sleep: sleep })).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unrelated SQLSTATE on a PrismaClientUnknownRequestError, exercised through withTransientRetry itself (not just the classifier in isolation)", async () => {
    const notTransient = unknownRequestError('PostgresError { code: "23505", message: "duplicate key value" }');
    const op = vi.fn().mockRejectedValue(notTransient);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withTransientRetry(op, { _sleep: sleep })).rejects.toBe(notTransient);
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry an 08P01-shaped message on a plain Error whose name isn't PrismaClientUnknownRequestError, exercised through withTransientRetry itself", async () => {
    const notTransient = new Error('PostgresError { code: "08P01", message: "protocol violation" }');
    const op = vi.fn().mockRejectedValue(notTransient);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withTransientRetry(op, { _sleep: sleep })).rejects.toBe(notTransient);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("logs the original error's diagnostics (via captureError) before retrying — the only place a recovered retry's occurrence is observable at all, and the only place the original SQLSTATE/routine survive if the retry also fails", async () => {
    const originalConsoleError = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const op = vi
        .fn()
        .mockRejectedValueOnce(
          unknownRequestError('PostgresError { code: "08P01", message: "server conn crashed?", routine: Some("SocketBackend") }'),
        )
        .mockResolvedValueOnce("recovered");
      const sleep = vi.fn().mockResolvedValue(undefined);

      await withTransientRetry(op, { _sleep: sleep });

      const captureLine = logs.find((l) => l.includes("[error-capture]"));
      expect(captureLine).toBeDefined();
      const event = JSON.parse(captureLine!.replace("[error-capture] ", ""));
      expect(event.context).toBe("transient-retry");
      expect(event.postgresSqlState).toBe("08P01");
      expect(event.postgresRoutine).toBe("SocketBackend");
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("does NOT log anything when the first attempt simply succeeds (no retry, no noise)", async () => {
    const originalConsoleError = console.error;
    const logs: string[] = [];
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const op = vi.fn().mockResolvedValue("ok");
      await withTransientRetry(op, { _sleep: vi.fn().mockResolvedValue(undefined) });
      expect(logs.some((l) => l.includes("[error-capture]"))).toBe(false);
    } finally {
      console.error = originalConsoleError;
    }
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
