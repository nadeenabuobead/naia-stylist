// app/lib/prisma-transient-retry.server.ts
//
// Single, canonical implementation of the transient-database-error
// classification and bounded single-retry pattern — previously hand-rolled
// as two byte-for-byte duplicates in clerk-session.server.ts and
// naia-session.server.ts (both from the 2026-11-13 live staging incident).
// Both files now import from here and re-export the same symbols, so every
// existing caller and test (which imports DatabaseUnavailableError from
// clerk-session.server.ts or naia-session.server.ts directly) keeps working
// unchanged — re-exporting preserves the exact same class reference, so
// `instanceof` checks are unaffected.
//
// Deliberately NOT a Prisma Client extension ($extends) applied globally to
// the shared client in db.server.js. Whether a $extends query extension
// reliably applies to the `tx` client inside an interactive
// prisma.$transaction(async (tx) => {...}) callback is not clearly
// documented by Prisma, and getting that wrong would mean silently retrying
// a read against an already-broken transaction's connection — a correctness
// risk, not just an efficiency one. withTransientRetry below is a plain
// function wrapping a single thunk instead: it can only ever retry the
// exact operation a caller explicitly passes in, so it is impossible for it
// to reach into a $transaction callback's tx client by accident. Every call
// site using it has been individually confirmed to run a standalone,
// non-transactional, read-only query — see the two existing call sites in
// clerk-session.server.ts / naia-session.server.ts, and the two new ones in
// buyskip.$id.tsx / my-naia.buying-decisions.tsx.
//
// This also directly avoids nested/duplicate retries: there is exactly one
// retry implementation now, called explicitly once per call site — nothing
// here auto-applies to a query a caller didn't explicitly wrap.

const TRANSIENT_PRISMA_ERROR_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // The database server was reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
  // Connection-pool exhaustion arrives as a PrismaClientKnownRequestError
  // WITH this stable code in this Prisma version (6.16.3) — confirmed
  // against the 2026-11-13 live staging incident. The name+regex fallback
  // below is kept in case an older/different code path still produces the
  // codeless PrismaClientInitializationError shape instead.
  "P2024", // Timed out fetching a new connection from the connection pool
]);

// A transient DB failure must never be collapsed into "not signed in" (or
// any other "this record doesn't exist" null) — that would bounce a
// genuinely-authenticated customer, or hide a genuinely-saved record, just
// because the database had a bad moment. Callers catch this specifically
// (or let it bubble to the root ErrorBoundary) instead of treating it like
// an ordinary not-found result.
export class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database temporarily unavailable");
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code && TRANSIENT_PRISMA_ERROR_CODES.has(code)) return true;
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? "";
  if (name === "PrismaClientInitializationError" && /connection pool/i.test(message)) return true;
  return false;
}

const TRANSIENT_RETRY_DELAY_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TransientRetryDeps {
  _sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs `operation` once; on a classified-transient error, waits
 * TRANSIENT_RETRY_DELAY_MS and tries exactly once more. A second transient
 * failure is rethrown as DatabaseUnavailableError (never silently
 * swallowed); any non-transient error is rethrown as-is on either attempt.
 *
 * Caller contract: `operation` must be a single, standalone, read-only
 * query — never a write, and never a query that is part of an open
 * `prisma.$transaction(...)`. Retrying a write risks a duplicate side
 * effect; retrying a query whose transaction's connection may already be
 * broken is unsafe regardless of read/write. This function has no way to
 * enforce that from the outside — it is a caller obligation, verified at
 * each call site when it is introduced, not something this helper can
 * check at runtime.
 */
export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  deps: TransientRetryDeps = {},
): Promise<T> {
  const sleep = deps._sleep ?? defaultSleep;
  try {
    return await operation();
  } catch (firstError) {
    if (!isTransientDatabaseError(firstError)) throw firstError;

    await sleep(TRANSIENT_RETRY_DELAY_MS);

    try {
      return await operation();
    } catch (secondError) {
      if (isTransientDatabaseError(secondError)) throw new DatabaseUnavailableError(secondError);
      throw secondError;
    }
  }
}
