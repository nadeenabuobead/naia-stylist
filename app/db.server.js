import { PrismaClient } from "@prisma/client";

// NAIA_DATABASE_URL is Prisma Postgres's POOLED runtime connection (see
// prisma/schema.prisma's directUrl split — migrations use the separate,
// pre-existing DATABASE_URL direct connection, never this one). Prisma's
// own pooler already absorbs concurrent connections across however many
// serverless function instances cold-start at once; this keeps each
// instance's OWN Prisma Client footprint small, not the limit that
// matters server-side.
//
// 2, not 1 (2026-11-06): on cold start, @shopify/shopify-app-session-storage-prisma's
// PrismaSessionStorage constructs itself against this SAME client and
// fires its own background pollForTable() check (shopify.server.*) —
// an independent consumer of this pool, unrelated to whatever route
// triggered the cold start. At limit=1, that poll and the route's own
// first query compete for the single slot, which was timing out as
// "Timed out fetching a new connection from the connection pool" on
// unrelated routes (/, /sign-in, /my-naia, /auth/clerk-callback) that
// never shared any query logic — confirmed by tracing the exact error
// text to that package's pollForTable(), not to any nAia route code.
// Raising to 2 gives each of those two independent consumers its own
// slot during that window; verified against staging's actual headroom
// (max_connections=50, ~9 in use) before changing this.
function makeClient() {
  const url = process.env.NAIA_DATABASE_URL ?? "";
  const sep = url.includes("?") ? "&" : "?";
  const datasourceUrl = url.includes("connection_limit") ? url : `${url}${sep}connection_limit=2`;
  return new PrismaClient({ datasources: { db: { url: datasourceUrl } } });
}

// Always use a global singleton to survive hot-reload in dev and module
// re-evaluation edge cases in production.
if (!global.prismaGlobal) {
  global.prismaGlobal = makeClient();
}

const prisma = global.prismaGlobal;

export default prisma;
