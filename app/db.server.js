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
//
// pgbouncer=true (2026-11-21 — prog-1, live 08P01/protocol_violation
// investigation): disables Prisma's own prepared-statement cache, which
// otherwise assumes session affinity — once a query's named statement is
// prepared on a connection, Prisma skips re-sending Parse on every later
// use of that same connection and sends only Bind+Execute. That
// assumption is unsafe against NAIA_DATABASE_URL's pooled host
// (pooled.db.prisma.io, a first-party managed PgBouncer-style pooler
// running in transaction mode — see prisma/schema.prisma's own comment):
// a pooler that does not preserve prepared-statement state across a
// client's transactions can hand the next request to a different
// physical backend, where that statement name either doesn't exist or —
// more consequentially — was separately prepared under the same name for
// a DIFFERENT query shape.
//
// Verified directly, not assumed: a real local Postgres (no shared DB
// involved) reproduces the exact signature this investigation's original
// incident showed — SQLSTATE 08P01, routine exec_bind_message — for a
// Bind supplying the wrong parameter count against an already-prepared
// statement. The same harness confirms always re-Parsing (this flag's
// actual effect) avoids that specific failure class; a bare cross-
// connection reference to a statement name PgBouncer never carried over
// instead raises 26000 (invalid_sql_statement_name), not 08P01 — so this
// fix targets the stale-prepared-statement-collision mechanism
// specifically, not every way a pooler can desync a client.
//
// Residual, explicitly unresolved risk: the real PgBouncer version/build
// behind pooled.db.prisma.io is not publicly documented and this
// repository has no way to query it directly (no credentials to connect
// as anything other than the application itself, no pgbouncer admin
// console exposed) — Prisma's own community has not settled this either
// (see prisma/orm#31113). PgBouncer 1.21+ can itself track and replay
// protocol-level prepared statements across backends when configured
// with max_prepared_statements > 0, which would make this flag
// unnecessary (though not harmful) rather than required. This flag is a
// no-regret change either way: it only removes an optimization Prisma
// applies for session-affine connections, which this pooled connection
// never guarantees regardless of the pooler's exact version.
export function appendQueryParamIfMissing(url, param, value) {
  if (url.includes(param)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${param}=${value}`;
}

function makeClient() {
  const rawUrl = process.env.NAIA_DATABASE_URL ?? "";
  const withConnectionLimit = appendQueryParamIfMissing(rawUrl, "connection_limit", "2");
  const datasourceUrl = appendQueryParamIfMissing(withConnectionLimit, "pgbouncer", "true");
  return new PrismaClient({ datasources: { db: { url: datasourceUrl } } });
}

// Always use a global singleton to survive hot-reload in dev and module
// re-evaluation edge cases in production.
if (!global.prismaGlobal) {
  global.prismaGlobal = makeClient();
}

const prisma = global.prismaGlobal;

export default prisma;
