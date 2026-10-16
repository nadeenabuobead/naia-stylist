import { PrismaClient } from "@prisma/client";

// NAIA_DATABASE_URL is Prisma Postgres's POOLED runtime connection (see
// prisma/schema.prisma's directUrl split — migrations use the separate,
// pre-existing DATABASE_URL direct connection, never this one). Prisma's
// own pooler already absorbs concurrent connections across however many
// serverless function instances cold-start at once; capping each
// instance's OWN Prisma Client at 1 connection here is not compensating
// for a low server-side limit the way it would against a direct
// connection — it just keeps every instance's individual footprint
// minimal, since a single instance only ever needs one connection at a
// time for the one request it's serving.
function makeClient() {
  const url = process.env.NAIA_DATABASE_URL ?? "";
  const sep = url.includes("?") ? "&" : "?";
  const datasourceUrl = url.includes("connection_limit") ? url : `${url}${sep}connection_limit=1`;
  return new PrismaClient({ datasources: { db: { url: datasourceUrl } } });
}

// Always use a global singleton to survive hot-reload in dev and module
// re-evaluation edge cases in production.
if (!global.prismaGlobal) {
  global.prismaGlobal = makeClient();
}

const prisma = global.prismaGlobal;

export default prisma;
