// app/lib/ai/colour-family.consumer-boundary.test.ts
//
// B2a's zero-production-consumer test is now intentionally obsolete — B2b2
// is the first legitimate production consumer. This replaces that
// assertion with a narrow ALLOWLIST: exactly which production files may
// import colour-family.ts, enforced mechanically so a future accidental
// import (StyleMe, GI, WI, NADINE, or an unrelated API route reaching in
// directly) fails loudly rather than silently expanding the boundary.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

// Test files for colour-family.ts itself are always allowed to import it.
const ALWAYS_ALLOWED_BASENAMES = new Set([
  "colour-family.ts",
  "colour-family.test.ts",
  "colour-family.parity.test.ts",
  "colour-family.consumer-boundary.test.ts",
]);

// The ONLY production (non-test) file permitted to import colour-family.ts
// as of B2b2. Buy/Skip's colour-preference resolution owns this import —
// nothing else does. Extend this set only in a future phase that
// deliberately wires a new consumer (B2c for NADINE, etc.), never silently.
const ALLOWED_PRODUCTION_IMPORTERS = new Set([
  "app/lib/buyskip/constraint-evidence.server.ts",
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

function importsColourFamily(content: string): boolean {
  return /from\s+["'][^"']*colour-family["']/.test(content) || /require\(["'][^"']*colour-family["']\)/.test(content);
}

describe("B2b2 — colour-family.ts production-consumer boundary", () => {
  it("every importer is either an allowed test file or the one approved production consumer — nothing else", () => {
    const files: string[] = [];
    walk(join(REPO_ROOT, "app"), files);

    const unexpectedImporters: string[] = [];
    const approvedProductionImportersFound = new Set<string>();

    for (const file of files) {
      const base = file.split("/").pop()!;
      const relPath = relative(REPO_ROOT, file);
      if (ALWAYS_ALLOWED_BASENAMES.has(base)) continue;

      const content = readFileSync(file, "utf8");
      if (!importsColourFamily(content)) continue;

      if (ALLOWED_PRODUCTION_IMPORTERS.has(relPath)) {
        approvedProductionImportersFound.add(relPath);
      } else {
        unexpectedImporters.push(relPath);
      }
    }

    assert.deepEqual(unexpectedImporters, [], `colour-family.ts has an unapproved production importer: ${unexpectedImporters.join(", ")}`);
    assert.deepEqual([...approvedProductionImportersFound].sort(), [...ALLOWED_PRODUCTION_IMPORTERS].sort(), "the approved consumer must actually be importing it, not just permitted to");
  });

  it("StyleMe, Garment Intelligence, Wardrobe Intelligence, Shared Customer Intelligence, and NADINE remain untouched — none import colour-family.ts", () => {
    const forbiddenPaths = [
      "app/lib/ai/styleme-result.server.ts",
      "app/lib/ai/styleme-recommendation.ts",
      "app/lib/ai/styleme-anchor.server.ts",
      "app/lib/admin/garment-intelligence-v1.server.ts",
      "app/lib/ai/resolved-garment.server.ts",
      "app/lib/ai/wardrobe-intelligence.server.ts",
      "app/lib/ai/wardrobe-recommendations.ts",
      "app/lib/ai/customer-intelligence-resolver.server.ts",
      "app/lib/ai/nadine-product-assessment.ts",
    ];
    for (const relPath of forbiddenPaths) {
      const content = readFileSync(join(REPO_ROOT, relPath), "utf8");
      assert.ok(!importsColourFamily(content), `${relPath} must not import colour-family.ts`);
    }
  });

  it("api.wishlist.jsx does not import colour-family.ts directly — it goes through constraint-evidence.server.ts only", () => {
    const content = readFileSync(join(REPO_ROOT, "app/routes/api.wishlist.jsx"), "utf8");
    assert.ok(!importsColourFamily(content));
  });
});
