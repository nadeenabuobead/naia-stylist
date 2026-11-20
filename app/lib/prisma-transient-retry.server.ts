// app/lib/prisma-transient-retry.server.ts
//
// Single, canonical implementation of the transient-database-error
// classification and bounded single-retry pattern. Ported from
// integrate/trunk on 2026-11-20 (prog-1 release-readiness review) to
// protect this exact same classification/retry logic on main's own
// customer-session lookup.
//
// main does not have Clerk at all -- this app's production customer auth
// is entirely the pre-Clerk Shopify-OAuth system (naia-session.server.ts +
// shopify-customer-oauth.server.ts). On trunk, Clerk is the primary
// customer-auth provider and clerk-session.server.ts carries its own
// getCurrentNaiaCustomer, but naia-session.server.ts's resolveNaiaSession
// is explicitly NOT dead code there either -- trunk's own comments say
// it's still the real implementation behind the legacy Shopify OAuth
// routes. On main, resolveNaiaSession IS the primary (only) customer
// session lookup, with the same unprotected-against-a-transient-DB-
// hiccup shape the original 2026-11-13 incident found in the Clerk path.
// This port gives it the same protection, nothing more.
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

import { captureError } from "./error-tracking.server";

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

// 2026-11-18 — confirmed live via Five-Persona QA (a genuine
// /style-me crash on quknuu0if, root-caused through vercel logs, not
// assumed): Prisma also throws a codeless PrismaClientInitializationError
// for a plain P1001 ("Can't reach database server") when the client fails
// at connect time rather than mid-query — a different message shape from
// the "connection pool" (P2024-as-initialization-error) case this file's
// fallback already covered. Same underlying transient-connectivity
// class, same safe-to-retry contract; the message text is just Prisma's
// own P1001 wording (see TRANSIENT_PRISMA_ERROR_CODES's own comment on
// that code above) instead of a pool-specific one.
const TRANSIENT_INITIALIZATION_ERROR_MESSAGE = /connection pool|can't reach database server/i;

export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code && TRANSIENT_PRISMA_ERROR_CODES.has(code)) return true;
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? "";
  if (name === "PrismaClientInitializationError" && TRANSIENT_INITIALIZATION_ERROR_MESSAGE.test(message)) return true;
  return false;
}

// 2026-11-19 — 08P01 (protocol_violation), PrismaClientUnknownRequestError.
//
// Deliberately NOT added to isTransientDatabaseError itself, even though
// the evidence below is real and new — that function is also consulted
// directly (not via withTransientRetry) by the TRANSACTIONAL write-retry
// loops in entitlement.server.ts (reserveClosetSlot / reserveStyleMeSlot /
// reserveBuySkipSlot / reservePersonalisedTrendSlot) and api.closet.jsx's
// sync action. Those loops retry a count-check-then-create transaction
// FROM SCRATCH, and their own existing comments explain why that's safe
// for P2024/P2034: both mean the client never even got a connection, or
// Postgres itself guarantees a full rollback, so nothing executed to
// duplicate. 08P01 does NOT have that same guarantee — it fires on an
// established connection, potentially after some statements in a
// transaction already ran, and (per the new evidence below) one known
// cause is the pool handing out a connection whose underlying backend
// already died, which cannot be ruled out as having happened *after* a
// commit was sent but before the acknowledgment reached the client.
// Retrying a reservation's create in that scenario could create a
// duplicate row. isTransientDatabaseError's existing two write callers
// must stay exactly as they already are — unaffected by this change.
//
// This SQLSTATE was deliberately EXCLUDED from retry up to now for a
// DIFFERENT reason too (see this incident's own history in project
// memory): the original theory was a client/pooler prepared-statement
// desync under PgBouncer transaction-mode pooling, where retrying the
// SAME broken session seemed unlikely to help.
//
// New, independent, Prisma-maintainer-acknowledged evidence changes that
// assessment for the STANDALONE-READ case specifically (not a repeat of
// the same hypothesis — a different one, found by investigating
// alternatives rather than assuming PgBouncer): Prisma's own tracker
// (prisma/orm#30275) documents the managed Prisma Postgres pooler itself
// (pooled.db.prisma.io — the exact endpoint this app uses) handing a
// client a half-dead/stale backend connection after an idle period, with
// Prisma's own team replying "the stall comes from the Prisma Postgres
// pooler... we've reproduced it on our side" — and one reporter's own
// failure on that exact endpoint was literally
// `Code: 08P01. Message: server conn crashed?`, on a plain SELECT, with no
// fix shipped yet (issue open, fix described as rolling out "in stages").
// The only workaround anyone in that thread found was exactly this: treat
// it as retryable and reacquire a connection.
//
// For a pure, standalone READ (withTransientRetry's own caller contract —
// see below) this carries none of the duplicate-write risk above: a
// SELECT has no side effect to duplicate regardless of which exact
// mechanism produced the 08P01, so it is scoped to ONLY the callers that
// go through withTransientRetry, via the separate check below rather than
// widening isTransientDatabaseError itself.
const TRANSIENT_POSTGRES_SQLSTATE = new Set([
  "08P01", // protocol_violation — see comment above. Read-only retry ONLY.
]);
const POSTGRES_SQLSTATE_PATTERN = /PostgresError\s*\{\s*code:\s*"([0-9A-Za-z]{5})"/;

function isTransientOnUnknownRequestError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { name?: string }).name !== "PrismaClientUnknownRequestError") return false;
  const message = (error as { message?: string }).message ?? "";
  const sqlState = POSTGRES_SQLSTATE_PATTERN.exec(message)?.[1];
  return !!sqlState && TRANSIENT_POSTGRES_SQLSTATE.has(sqlState);
}

// Only withTransientRetry (standalone reads) treats 08P01 as transient —
// see the comment above isTransientOnUnknownRequestError. Every other
// consumer of this file must keep calling isTransientDatabaseError
// directly, unaffected.
function isRetryableForStandaloneRead(error: unknown): boolean {
  return isTransientDatabaseError(error) || isTransientOnUnknownRequestError(error);
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
    if (!isRetryableForStandaloneRead(firstError)) throw firstError;

    // Logged BEFORE retrying, not after — this is the only place a
    // transient error's real diagnostics (Postgres SQLSTATE/severity/
    // routine, extracted by captureError itself) survive at all: if the
    // retry also fails, the caller only ever sees DatabaseUnavailableError,
    // whose own .message is the generic "Database temporarily unavailable"
    // string, not the original error's. It's also the only signal that a
    // successful retry recovery ever happened — a recovered retry
    // otherwise produces no other observable trace.
    captureError("transient-retry", firstError);

    await sleep(TRANSIENT_RETRY_DELAY_MS);

    try {
      return await operation();
    } catch (secondError) {
      if (isRetryableForStandaloneRead(secondError)) throw new DatabaseUnavailableError(secondError);
      throw secondError;
    }
  }
}
