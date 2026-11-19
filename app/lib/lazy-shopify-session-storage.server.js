// app/lib/lazy-shopify-session-storage.server.js
//
// 2026-11-19 — root cause of the "Error obtaining session table" /
// connection-pool-timeout noise this file's caller (shopify.server.js)
// used to generate on EVERY cold start, for EVERY route this server
// serves: PrismaSessionStorage's own constructor
// (node_modules/@shopify/shopify-app-session-storage-prisma) calls
// pollForTable() unconditionally and immediately, at module-load time —
// even for a request to a customer-facing Clerk-only route (/style-me,
// /my-naia, ...) that will NEVER call a single session-storage method,
// because nAia's own customer auth is Clerk, not Shopify's embedded-app
// session. That poll still competes with the SAME cold start's own route
// code for db.server.js's tiny connection_limit=2 pool.
//
// This defers construction (and therefore the poll) until the FIRST time
// any session-storage method is actually called — which, for this app,
// only ever happens on a genuine Shopify embedded-admin/auth request
// (/app/*, /auth/shopify/*). Confirmed safe to duck-type rather than
// construct eagerly:
//   - shopifyApp() (node_modules/@shopify/shopify-app-react-router/dist/
//     cjs/server/shopify-app.js) only ever checks `sessionStorage` for
//     truthiness during its own synchronous setup — it never calls a
//     method on it before a real request needs one.
//   - PrismaSessionStorage itself is a plain class with no `extends`
//     clause (confirmed by reading its own source) — nothing in
//     @shopify/shopify-api does an `instanceof SessionStorage` check
//     anywhere (confirmed by grep) — so any object implementing the same
//     method shapes is accepted, the real class is never required.
//
// This changes WHEN the real session storage is constructed, never
// WHETHER or HOW — a genuine Shopify route still gets a fully correct,
// fully initialized PrismaSessionStorage (readiness poll, recovery safety
// net, everything) on its own first use. The one disclosed trade-off:
// that first Shopify-route request on a cold start now waits for the
// poll inline instead of it having started in the background earlier —
// an acceptable cost for the rare embedded-admin cold start, in exchange
// for never paying it at all on the vastly more common customer-facing
// routes.
//
// `createReal` is injected (not called from here directly) specifically
// so this module has zero import-time side effects of its own and can be
// unit-tested with a fake factory — no real Prisma client, no real
// PrismaSessionStorage, no real Shopify SDK needed.
export function createLazySessionStorage(createReal) {
  let real = null;

  // Synchronous check-and-set — safe even under concurrent async callers,
  // same reasoning shopify-session-storage-safety-net.server.js's own
  // coalescing logic already relies on: Node's single-threaded microtask
  // execution means this synchronous line can never interleave between
  // two callers, so there is no race window where both see `real` unset
  // and each construct their own instance.
  function getReal() {
    if (!real) real = createReal();
    return real;
  }

  // Every method below is `async` deliberately, not a plain arrow
  // returning the inner call's result directly — the real
  // PrismaSessionStorage's own constructor can throw SYNCHRONOUSLY
  // (confirmed by reading it: `if (this.getSessionTable() === undefined)
  // throw new Error(...)`), and `getReal()` calling `createReal()` for
  // the first time happens INSIDE these methods. An `async` function
  // body converts any synchronous throw into a rejected promise
  // automatically, matching every other method on this same interface
  // (and the real class's own behavior) — a plain arrow would instead
  // throw synchronously out of the method call itself, inconsistent
  // with the rest of this async interface and liable to crash a caller
  // that correctly assumes every method here returns a promise.
  return {
    storeSession: async (session) => getReal().storeSession(session),
    loadSession: async (id) => getReal().loadSession(id),
    deleteSession: async (id) => getReal().deleteSession(id),
    deleteSessions: async (ids) => getReal().deleteSessions(ids),
    findSessionsByShop: async (shop) => getReal().findSessionsByShop(shop),
    isReady: async () => getReal().isReady(),
    ensureReady: async () => getReal().ensureReady(),
  };
}
