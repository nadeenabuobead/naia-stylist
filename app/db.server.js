import { PrismaClient } from "@prisma/client";

// In serverless, many function instances cold-start concurrently.
// Capping each instance at 1 DB connection prevents pool exhaustion
// when the DB server's total connection limit is low.
function makeClient() {
  const url = process.env.DATABASE_URL ?? "";
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
