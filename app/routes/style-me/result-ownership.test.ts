// app/routes/style-me/result-ownership.test.ts
//
// Regression coverage for three cross-customer IDOR bugs fixed 2026-10-21:
//   - "generate" had NO ownership check at all on a client-supplied sessionId.
//   - "regenerate" had a check, but `naiaCustomer && ...` skipped it entirely
//     for an UNAUTHENTICATED request — StylingSession.customerId is always a
//     real owner (required field, no genuine anonymous session), so an
//     unauthenticated caller could regenerate another customer's session.
//   - "review" had NO ownership check, letting a client-supplied sessionId
//     overwrite another customer's existing PostOutfitReview via upsert.
//
// Static source-code assertions, matching the convention already used for
// this codebase's large route files (see closet-image-security.test.ts) —
// result.tsx is 2500+ lines with a heavy AI/engine dependency graph, so a
// full behavioral mock test is disproportionate; these assertions directly
// target the exact bug each fix closed and will fail if the guard is ever
// removed or weakened.
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

// H2 (2026-11-21) — the action-level behavioral tests (result-ownership-behavioral.test.ts)
// already prove a rate-limited regenerate response never sets `.error`. This test closes
// the other half: that the COMPONENT actually renders a retry message for it, and that the
// message sits in the same render path as sameCombination/companionRecoveryBlocked (i.e.
// outside the `if (error || !suggestion)` early-return that would otherwise discard the
// customer's current, still-good suggestion and show the full error-page takeover).
test('"regenerate" rate-limit hit: component renders a retry message, not the error-page takeover', () => {
  assert.ok(
    /generateFetcher\.data\?\.rateLimited\s*&&/.test(source),
    "component must render something conditioned on generateFetcher.data?.rateLimited",
  );
  // Same guard that gates companionRecoveryBlocked's sibling message — confirms this
  // isn't a second, parallel mechanism that could diverge from the established pattern.
  const rateLimitedBlockIdx = source.indexOf("generateFetcher.data?.rateLimited &&");
  const companionBlockIdx = source.indexOf("generateFetcher.data?.companionRecoveryBlocked &&");
  const errorGuardIdx = source.indexOf("if (error || !suggestion)");
  assert.ok(rateLimitedBlockIdx !== -1 && companionBlockIdx !== -1 && errorGuardIdx !== -1);
  // Both sibling-message blocks render AFTER (i.e. at a higher line position than) the
  // early-return error guard in source order, meaning the error guard — which only fires
  // on a truthy `.error` field — cannot be what's gating this message; a rateLimited
  // response never sets `.error` (proven at the action level), so it reaches this render
  // path with the prior suggestion still intact, same as companionRecoveryBlocked.
  assert.ok(errorGuardIdx < companionBlockIdx, "error guard must run before the companionRecoveryBlocked render");
  assert.ok(errorGuardIdx < rateLimitedBlockIdx, "error guard must run before the rateLimited render — same convention");
  // A real, non-empty retry message string is present near the rateLimited check.
  const nearby = source.slice(rateLimitedBlockIdx, rateLimitedBlockIdx + 300);
  assert.ok(/wait a few seconds|try New Look again/i.test(nearby), "a human-readable retry message must accompany rateLimited");
});
