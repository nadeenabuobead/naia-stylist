// app/lib/preview-migration-gate.test.ts
//
// scripts/build-preview.sh — explicit migration-control gate (2026-11-04).
//
// Root cause this closes: every preview build previously ran
// `npx prisma migrate deploy` unconditionally (gated only on VERCEL_ENV ===
// "preview"), so the moment a branch carrying new, unreviewed migrations
// (e.g. the Clerk identity-linking schema) was pushed, its very first
// preview build would silently apply them against staging's real database
// — no separate approval step existed between "push" and "migrate".
//
// Fix: migrate deploy now runs only when NAIA_ALLOW_PREVIEW_MIGRATIONS is
// explicitly "true" as a Vercel environment variable for that deployment —
// a deliberate, reviewable action, never a side effect of merely pushing.
//
// Source-string assertions on the shell script itself — no sh interpreter
// invoked, same convention as batch1-integration.test.ts's own vercel.json
// checks.
//
// Run: node --test --import tsx/esm app/lib/preview-migration-gate.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(resolve(__dirname, "../../scripts/build-preview.sh"), "utf8");

describe("scripts/build-preview.sh — migrations are opt-in, not a side effect of pushing", () => {
  it("still refuses to build at all outside VERCEL_ENV=preview — unchanged fail-closed guard", () => {
    assert.match(SCRIPT, /if\s*\[\s*"\$VERCEL_ENV"\s*!=\s*"preview"\s*\]/);
    assert.match(SCRIPT, /exit 1/);
  });

  it("migrate deploy is wrapped in an explicit NAIA_ALLOW_PREVIEW_MIGRATIONS check, not called unconditionally", () => {
    const migrateIdx = SCRIPT.indexOf("npx prisma migrate deploy");
    assert.ok(migrateIdx > -1, "migrate deploy call must still exist somewhere");
    const guardIdx = SCRIPT.lastIndexOf('if [ "$NAIA_ALLOW_PREVIEW_MIGRATIONS" = "true" ]', migrateIdx);
    assert.ok(guardIdx > -1, "the gate must appear before the migrate deploy call");
    assert.ok(guardIdx < migrateIdx, "migrate deploy must be inside the gated branch, not above/outside it");
  });

  it("the default (gate variable unset or anything other than exactly 'true') path explicitly skips migrate deploy rather than falling through to it", () => {
    assert.match(SCRIPT, /else/);
    const elseIdx = SCRIPT.indexOf("else");
    const fiIdx = SCRIPT.indexOf("\nfi", elseIdx);
    const elseBlock = SCRIPT.slice(elseIdx, fiIdx);
    // Anchored on the actual command, not the phrase "migrate deploy" —
    // the skip branch's own echo message explains WHY it's skipping using
    // that exact phrase in prose, which would otherwise make this
    // assertion fail on the explanatory text rather than a real command.
    assert.ok(!elseBlock.includes("npx prisma migrate deploy"), "the skip branch must not also call migrate deploy");
  });

  it("prisma generate and the build itself still run regardless of the migration gate — only migrate deploy is conditional", () => {
    const fiLastIdx = SCRIPT.lastIndexOf("fi");
    const tail = SCRIPT.slice(fiLastIdx);
    assert.match(tail, /npx prisma generate/);
    assert.match(tail, /npm run build/);
  });
});
