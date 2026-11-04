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
// Fix: attach our own `.catch()` to this EXACT `.ready` promise instance
// right after construction (see shopify.server.js's call site). This
// changes nothing about `.ready`'s resolved/rejected VALUE or timing for
// any other consumer — storeSession / loadSession / ensureReady / isReady
// still see the real outcome and behave exactly as before (a genuinely,
// persistently unavailable DB still fails real Shopify auth operations via
// ensureReady()'s own MissingSessionStorageError, inside that request's own
// promise chain, same as today). The only change: Node now sees a handler
// attached, so a transient blip is logged instead of crashing the process.
//
// KNOWN LIMITATION (confirmed 2026-11-04, not fixed here — this safety net
// only prevents the crash, it does NOT restore Shopify auth availability):
// `this.ready` is assigned exactly ONCE, inside PrismaSessionStorage's
// constructor, from a one-time ~10s poll window (2 retries, 5s apart). It
// never changes again on its own. If the DB is still down when that window
// expires, `.ready` is a PERMANENTLY rejected promise for the rest of that
// warm process instance's life — every subsequent storeSession/loadSession/
// OAuth call on that SAME instance keeps failing even after the database is
// fully healthy again. The only reset mechanism the package exposes is
// `isReady()` (which re-polls and reassigns `this.ready`) — confirmed via
// grep across @shopify/shopify-app-react-router and @shopify/shopify-api
// that NOTHING in the framework ever calls it automatically. Recovery on an
// already-affected instance therefore depends entirely on the hosting
// platform naturally recycling that instance (new deployment, scale event,
// idle-instance churn) — not on anything this app or this fix controls.
// Wiring in an on-demand isReady() retry would be a separate, deliberate
// piece of work, not bundled into this fix.
//
// Deliberately its own tiny, side-effect-free module (not inlined in
// shopify.server.js) so it can be unit-tested without triggering
// shopify.server.js's own module-load-time side effects (constructing a
// real PrismaSessionStorage against the real Prisma client, calling
// shopifyApp() with real env vars).
export function attachSessionStorageReadinessSafetyNet(storage) {
  if (!storage || typeof storage.ready?.catch !== "function") return;
  storage.ready.catch((err) => {
    console.error(
      "[shopify-session-storage] background readiness check failed (non-fatal, logged to avoid an unhandled-rejection process crash):",
      err,
    );
  });
}
