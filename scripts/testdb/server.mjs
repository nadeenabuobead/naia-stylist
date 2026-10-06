// scripts/testdb/server.mjs
//
// A real, isolated PostgreSQL for the persistence journeys. It runs from a
// throwaway data directory under the system temp dir and listens on a
// non-standard port, so acceptance evidence never requires writing to staging,
// to production, or to anyone's real Closet.
//
//   npm i -D embedded-postgres
//   node scripts/testdb/server.mjs          # leaves it running
//   node scripts/testdb/server.mjs --stop   # tears it down
//
// Then:
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
//     node --test --import tsx/esm app/lib/ai/wardrobe-journeys.test.ts

import EmbeddedPostgres from "embedded-postgres";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";

const dataDir = process.env.TEST_DB_DIR ?? join(tmpdir(), "wi-testdb-pg");
const port = Number(process.env.TEST_DB_PORT ?? 5433);
const fresh = process.argv.includes("--fresh");

if (fresh && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
});

if (!existsSync(join(dataDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
console.log(`READY postgresql://postgres:postgres@127.0.0.1:${port}/postgres  (${dataDir})`);
