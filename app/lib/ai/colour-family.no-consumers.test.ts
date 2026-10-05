// app/lib/ai/colour-family.no-consumers.test.ts
//
// B2a must not change any live consumer's behavior. Proves it mechanically:
// a repo-wide import search for colour-family.ts must show only the
// module itself and its own test files — nothing production-facing.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const SELF_DIR = new URL(".", import.meta.url).pathname;

const ALLOWED_IMPORTERS = new Set([
  "colour-family.ts",
  "colour-family.test.ts",
  "colour-family.parity.test.ts",
  "colour-family.no-consumers.test.ts",
]);

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

describe("B2a — zero production consumers", () => {
  it("no file outside colour-family.ts and its own tests imports from it", () => {
    const files: string[] = [];
    walk(join(REPO_ROOT, "app"), files);

    const importers: string[] = [];
    for (const file of files) {
      const rel = relative(SELF_DIR, file);
      const base = file.split("/").pop()!;
      if (ALLOWED_IMPORTERS.has(base)) continue;
      const content = readFileSync(file, "utf8");
      if (/from\s+["'][^"']*colour-family["']/.test(content) || /require\(["'][^"']*colour-family["']\)/.test(content)) {
        importers.push(relative(REPO_ROOT, file));
      }
    }
    assert.deepEqual(importers, [], `colour-family.ts must have zero production importers in B2a; found: ${importers.join(", ")}`);
  });

  it("constraint-evidence.server.ts, api.wishlist.jsx, and nadine-product-assessment.ts are completely unmodified from the B1 checkpoint (text-level sanity: no colour-family reference at all)", () => {
    const targets = [
      "app/lib/buyskip/constraint-evidence.server.ts",
      "app/routes/api.wishlist.jsx",
      "app/lib/ai/nadine-product-assessment.ts",
    ];
    for (const rel of targets) {
      const content = readFileSync(join(REPO_ROOT, rel), "utf8");
      assert.ok(!content.includes("colour-family"), `${rel} must not reference colour-family.ts in B2a`);
    }
  });
});
