// app/routes/style-me/result-ownership.test.ts
//
// Regression coverage for three cross-customer IDOR bugs hotfixed
// 2026-11-12 on the production source (commit 0b96e40):
//   - "generate" had NO ownership check at all on a client-supplied sessionId.
//   - "regenerate" had a check, but `naiaCustomer && ...` skipped it entirely
//     for an UNAUTHENTICATED request — StylingSession.customerId is always a
//     real owner (required field, no genuine anonymous session), so an
//     unauthenticated caller could regenerate another customer's session.
//   - "review" had NO ownership check, letting a client-supplied sessionId
//     overwrite another customer's existing PostOutfitReview via upsert.
//
// Static source-code assertions, not a full behavioral mock test: this
// file is 1200+ lines with a heavy AI/engine dependency graph (anchor
// resolution, journey context, NAIA model readiness, pending-save, etc.) —
// fully mocking action() to exercise it behaviorally is disproportionate to
// a 3-line-guard fix. This directly targets the exact bug each fix closed
// and fails if any guard is ever removed or weakened back to its
// vulnerable shape. The equivalent Prisma-mocked behavioral test exists for
// the two smaller files this same hotfix touches
// (api.outfit-rating-ownership.test.ts, feedback-persistence-ownership.test.ts,
// api.post-wear-review-ownership.test.ts), where that approach is
// proportionate.
//
// Run: node --test --import tsx/esm app/routes/style-me/result-ownership.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "result.tsx");
const source = readFileSync(filePath, "utf8");

function sliceIntentBlock(intentMarker: string): string {
  const idx = source.indexOf(intentMarker);
  assert.ok(idx !== -1, `expected to find ${intentMarker} in result.tsx`);
  // Each intent block is followed eventually by the next `if (intent ===`,
  // or by the function end — 4000 chars comfortably covers every existing
  // block's ownership-guard region without needing an exact boundary.
  return source.slice(idx, idx + 4000);
}

test('"generate": client-supplied sessionId is checked against the authenticated customer before use', () => {
  const block = sliceIntentBlock('if (intent === "generate") {');
  assert.ok(
    /if\s*\(\s*!naiaCustomer\s*\|\|\s*session\.customerId\s*!==\s*naiaCustomer\.id\s*\)/.test(block),
    '"generate" must reject when naiaCustomer is missing or does not match session.customerId',
  );
  // The guard must appear BEFORE the session is used to build the anchor/engine input.
  const guardIdx = block.search(/if\s*\(\s*!naiaCustomer\s*\|\|\s*session\.customerId/);
  const anchorIdx = block.indexOf("resolveActionAnchor");
  assert.ok(guardIdx !== -1 && anchorIdx !== -1 && guardIdx < anchorIdx, "ownership guard must run before the session is used");
});

test('"regenerate": ownership check does not short-circuit for an unauthenticated caller', () => {
  const block = sliceIntentBlock('if (intent === "regenerate") {');
  // The historical bug was `if (naiaCustomer && session.customerId !== naiaCustomer.id)`,
  // which is skipped entirely when naiaCustomer is null. Assert that exact
  // vulnerable shape is gone, and the corrected shape is present.
  assert.ok(
    !/if\s*\(\s*naiaCustomer\s*&&\s*session\.customerId\s*!==\s*naiaCustomer\.id\s*\)/.test(block),
    'the old unauthenticated-bypass guard shape must not reappear',
  );
  assert.ok(
    /if\s*\(\s*!naiaCustomer\s*\|\|\s*session\.customerId\s*!==\s*naiaCustomer\.id\s*\)/.test(block),
    '"regenerate" must require naiaCustomer to be present AND matching',
  );
});

test('"review": client-supplied sessionId is checked before the PostOutfitReview upsert', () => {
  const block = sliceIntentBlock('if (intent === "review") {');
  assert.ok(
    /if\s*\(\s*!naiaCustomer\s*\|\|\s*reviewSession\.customerId\s*!==\s*naiaCustomer\.id\s*\)/.test(block),
    '"review" must reject when naiaCustomer is missing or does not match reviewSession.customerId',
  );
  // The guard must appear BEFORE the upsert, not after.
  const guardIdx = block.search(/if\s*\(\s*!naiaCustomer\s*\|\|\s*reviewSession\.customerId/);
  const upsertIdx = block.indexOf("postOutfitReview.upsert");
  assert.ok(guardIdx !== -1 && upsertIdx !== -1 && guardIdx < upsertIdx, "ownership guard must run before the upsert");
});
