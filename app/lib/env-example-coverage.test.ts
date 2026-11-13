// app/lib/env-example-coverage.test.ts
//
// Phase 2 ops: guards .env.example against silent drift. Every
// process.env.X reference actually used by application code under app/
// must appear somewhere in .env.example (as a real entry or in its
// commented "platform-injected" section) — otherwise a future env var
// gets added to the code with nobody ever documenting it.
//
// Deliberately scoped to app/, not scripts/ — one-off ops/QA scripts
// (scripts/) read several ad-hoc/legacy variable names
// (DATABASE_POSTGRES_URL, DIRECT_URL, CLD_*) that are explicitly listed
// in .env.example as script-only, not standing deployment config; this
// test does not require every script's env var to appear, only the
// application's own.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const APP_DIR = resolve(REPO_ROOT, "app");

// Known false positives from dynamic template-literal access
// (`process.env[\`CLOUDINARY_${x}\`]`-style code gets misread by a naive
// regex as a literal var named "CLOUDINARY_"), not real env var names.
const KNOWN_NON_VARS = new Set(["CLOUDINARY_", "X"]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function envVarsUsedInApp(): Set<string> {
  const vars = new Set<string>();
  for (const file of walk(APP_DIR)) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      if (!KNOWN_NON_VARS.has(match[1])) vars.add(match[1]);
    }
  }
  return vars;
}

function envVarsDocumentedInExample(): Set<string> {
  const src = readFileSync(resolve(REPO_ROOT, ".env.example"), "utf8");
  const vars = new Set<string>();
  // Matches both live entries (FOO=) and commented platform-injected
  // entries (# FOO=) — both count as "documented".
  for (const match of src.matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)) {
    vars.add(match[1]);
  }
  return vars;
}

describe(".env.example stays in sync with app/'s actual process.env.* usage", () => {
  const used = envVarsUsedInApp();
  const documented = envVarsDocumentedInExample();

  it("found a non-trivial number of env vars to check (sanity check on the walk itself)", () => {
    assert.ok(used.size > 30, `expected >30 distinct env vars referenced under app/, found ${used.size}`);
  });

  it("every env var referenced under app/ is documented in .env.example", () => {
    const missing = [...used].filter((v) => !documented.has(v)).sort();
    assert.deepEqual(
      missing,
      [],
      `these env vars are used in app/ but missing from .env.example: ${missing.join(", ")}`,
    );
  });
});
