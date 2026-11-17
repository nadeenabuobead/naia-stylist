// app/lib/no-duplicate-prisma-client.test.ts
//
// Regression guard for the 2026-11-17 fix: app/lib/prisma.server.ts was a
// SECOND PrismaClient instance, entirely separate from the shared,
// connection-capped client in app/db.server.js (see that file's own header
// for why the cap matters — a real production connection-pool-exhaustion
// incident on 2026-11-06). Six StyleMe/onboarding routes imported this
// uncapped duplicate instead of the shared client. In production it didn't
// even reuse a singleton across cold starts (only the dev branch did),
// making the actual risk worse than "uncapped" alone suggests.
//
// All six have been repointed at app/db.server.js and the duplicate file
// deleted outright. This test guards against either regressing.
//
// Run: node --test --import tsx/esm app/lib/no-duplicate-prisma-client.test.ts

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

const SKIP_DIRS = new Set(["node_modules", ".git", "build", "dist", ".vercel"]);

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
}

const ALL_APP_FILES: string[] = [];
walk(join(REPO_ROOT, "app"), ALL_APP_FILES);

// The six routes the original defect actually affected — named explicitly
// so a regression on any ONE of them fails with a specific, useful message
// rather than only showing up in the repo-wide scan below.
const PREVIOUSLY_AFFECTED_ROUTES = [
  "app/routes/post-wear-review.tsx",
  "app/routes/api.styleme-outcome.tsx",
  "app/routes/onboarding/complete.tsx",
  "app/routes/onboarding/step.$step.tsx",
  "app/routes/style-me/_index.tsx",
  "app/routes/style-me/result.tsx",
];

describe("no-duplicate-prisma-client — app/lib/prisma.server.ts must stay deleted", () => {
  it("the duplicate, uncapped PrismaClient file does not exist", () => {
    assert.ok(
      !existsSync(join(REPO_ROOT, "app/lib/prisma.server.ts")),
      "app/lib/prisma.server.ts was deleted as a duplicate, uncapped PrismaClient — it must not be re-added",
    );
  });

  for (const rel of PREVIOUSLY_AFFECTED_ROUTES) {
    it(`${rel} imports the shared capped client, not the deleted duplicate`, () => {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      assert.ok(
        !/from\s+["']~\/lib\/prisma\.server["']/.test(src),
        `${rel} must not import from the deleted ~/lib/prisma.server`,
      );
      assert.ok(
        /from\s+["']~\/db\.server["']/.test(src),
        `${rel} must import prisma from the shared ~/db.server client`,
      );
    });
  }

  it("no file anywhere under app/ imports from lib/prisma.server — not just the six originally-affected routes", () => {
    const offenders = ALL_APP_FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from\s+["'][~.\/]*lib\/prisma\.server["']/.test(src);
    });
    assert.deepEqual(
      offenders.map((f) => f.slice(REPO_ROOT.length + 1)),
      [],
      "found file(s) still importing the deleted duplicate PrismaClient module",
    );
  });

  it("app/db.server.js (the one true client) still caps its connection_limit — unchanged by this fix", () => {
    const src = readFileSync(join(REPO_ROOT, "app/db.server.js"), "utf8");
    assert.match(src, /connection_limit=2/, "db.server.js must keep its connection_limit=2 cap — this fix must not touch it");
  });
});
