// app/lib/shopify-session-storage-safety-net.server.js
//
// Root cause of the process-crashing "Something went wrong" page seen
// repeatedly on naia-stylist-staging during a transient Postgres blip:
// PrismaSessionStorage's own constructor (see
// node_modules/@shopify/shopify-app-session-storage-prisma/dist/cjs/prisma.js)
// kicks off a background `this.pollForTable().then(() => true).catch(cause
// => { throw new MissingSessionTableError(...) })` chain and stores the
// result as `this.ready` — WITHOUT awaiting or returning it, and nothing in
// @shopify/shopify-app-react-router's shopifyApp() factory ever attaches a
// handler to `.ready` at startup either. Nothing consumes it until an
// actual Shopify auth operation calls ensureReady()/isReady(), which may be
// long after construction, or never, in a given process.
//
// Under a DB outage at cold start, `.ready` rejects on its own schedule
// (after ~2 retries, ~5s apart) with zero handlers attached. Node reports
// this as an unhandled rejection and crashes the ENTIRE process — taking
// down whatever request(s) happened to be in flight, regardless of which
// route they were for. This is NOT catchable by any route-level try/catch:
// the rejecting promise lives on a module-singleton instance, created at
// import time, outside every request's own await chain.
//
// PART 1 — crash prevention: attach our own `.catch()` to this EXACT
// `.ready` promise instance right after construction. This changes
// nothing about `.ready`'s resolved/rejected VALUE or timing for any other
// consumer. The only change: Node now sees a handler attached, so a
// transient blip is logged instead of crashing the process.
//
// PART 2 — authentication recovery (2026-11-04): crash prevention alone
// left a confirmed gap — `this.ready` is assigned exactly ONCE, in the
// constructor, from a one-time ~10s poll window. It never changes again
// on its own. If the DB is still down when that window expires, `.ready`
// stays permanently rejected for the rest of that warm instance's life —
// every subsequent storeSession/loadSession/OAuth call keeps failing even
// after the database is fully healthy again, because nothing in the
// framework ever calls the package's own `isReady()` reset method.
//
// `isReady()` (see prisma.js) is a safe building block for recovery: it
// NEVER throws itself — it internally try/catches its own re-poll and
// always resolves, reassigning `this.ready` to `Promise.resolve(true)` or
// `Promise.resolve(false)` as its one side effect. We wrap `ensureReady()`
// (the single method storeSession/loadSession/deleteSession/
// deleteSessions/findSessionsByShop all route through) so that when it's
// about to fail, it first gives the storage ONE chance to re-check
// readiness — bounded and coalesced:
//   - Bounded: at most one recovery attempt per `recoveryCooldownMs`
//     (default 15s) — a persistent outage cannot cause faster or more
//     frequent retries than that, however many requests arrive.
//   - Coalesced: if N requests hit this concurrently while a recovery
//     attempt is already in flight, all N await the SAME single
//     `isReady()` call — never N separate DB probes. This relies on
//     Node's single-threaded microtask execution: the synchronous
//     check-and-set of `inFlightRecovery` between concurrent callers'
//     continuations can never interleave, so there is no race window
//     where two callers both see `inFlightRecovery` unset and each start
//     their own probe.
//   - Never duplicates a session/auth operation: this wrapper touches
//     ONLY `ensureReady()`'s readiness decision — it never calls
//     storeSession/loadSession/etc. itself, so the caller's own single,
//     already-in-progress operation either proceeds or fails closed,
//     exactly once, same as the unwrapped method would decide (just with
//     a chance to notice the DB has recovered first).
//   - Fail-closed preserved: a genuinely persistent outage still makes
//     `isReady()` resolve `false` (after its own internal retries), so
//     `ensureReady()` still throws `MissingSessionStorageError` exactly
//     as the unwrapped package does today — this wrapper only ever makes
//     recovery POSSIBLE, it never weakens the failure path.
//
// Deliberately its own tiny, side-effect-free module (not inlined in
// shopify.server.js) so it can be unit-tested without triggering
// shopify.server.js's own module-load-time side effects (constructing a
// real PrismaSessionStorage against the real Prisma client, calling
// shopifyApp() with real env vars).
export function attachSessionStorageReadinessSafetyNet(storage, { recoveryCooldownMs = 15000 } = {}) {
  if (!storage || typeof storage.ready?.catch !== "function") return;

  storage.ready.catch((err) => {
    console.error(
      "[shopify-session-storage] background readiness check failed (non-fatal, logged to avoid an unhandled-rejection process crash):",
      err,
    );
  });

  // Defensive: if a future package version changes shape, skip the
  // recovery wrapper entirely rather than guessing at an incompatible API.
  // Crash prevention above still applies regardless.
  if (typeof storage.ensureReady !== "function" || typeof storage.isReady !== "function") return;

  const originalEnsureReady = storage.ensureReady.bind(storage);
  let lastAttemptAt = 0;
  let inFlightRecovery = null;

  storage.ensureReady = async function ensureReadyWithRecovery() {
    try {
      // Fast path: when `.ready` is currently fulfilled-true, this
      // resolves immediately — recovery logic is never on the happy
      // path's critical path, and nothing below ever runs.
      return await originalEnsureReady();
    } catch (err) {
      const now = Date.now();
      if (!inFlightRecovery && now - lastAttemptAt >= recoveryCooldownMs) {
        lastAttemptAt = now;
        inFlightRecovery = storage.isReady().finally(() => {
          inFlightRecovery = null;
        });
      }
      if (inFlightRecovery) await inFlightRecovery;
      // Re-check readiness the NORMAL way, exactly once more — if the
      // DB is still down, this throws the same way the unwrapped method
      // always has (fail-closed, unchanged).
      return await originalEnsureReady();
    }
  };
}
