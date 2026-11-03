// app/lib/billing/webhook-verify.test.ts
// Behavioral tests for Stripe webhook signature verification — the gate
// that proves a request genuinely came from Stripe before any business
// logic runs. No real network, no real Stripe account: every signature is
// constructed in this file with the same HMAC scheme the implementation
// verifies, using a shared test-only secret.
//
// Run: node --import tsx/esm --test app/lib/billing/webhook-verify.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "./webhook-verify.server";

const SECRET = "whsec_test_fixture_secret";

function sign(payload: string, timestampSeconds: number, secret = SECRET): string {
  const hmac = createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
  return `t=${timestampSeconds},v1=${hmac}`;
}

describe("verifyStripeSignature", () => {
  it("WV.1 — accepts a correctly signed payload within tolerance", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const nowSeconds = 1_700_000_000;
    const header = sign(payload, nowSeconds);
    const result = verifyStripeSignature(payload, header, SECRET, { _now: () => nowSeconds * 1000 });
    assert.deepEqual(result, { ok: true });
  });

  it("WV.2 — rejects a payload whose signature doesn't match (tampered body)", () => {
    const nowSeconds = 1_700_000_000;
    const header = sign("original body", nowSeconds);
    const result = verifyStripeSignature("tampered body", header, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "signature_mismatch");
  });

  it("WV.3 — rejects a signature computed with the wrong secret", () => {
    const payload = "{}";
    const nowSeconds = 1_700_000_000;
    const header = sign(payload, nowSeconds, "whsec_different_secret");
    const result = verifyStripeSignature(payload, header, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "signature_mismatch");
  });

  it("WV.4 — rejects a missing Stripe-Signature header", () => {
    const result = verifyStripeSignature("{}", null, SECRET);
    assert.deepEqual(result, { ok: false, reason: "missing_signature_header" });
  });

  it("WV.5 — rejects a malformed header (no v1= entry)", () => {
    const result = verifyStripeSignature("{}", "t=1700000000", SECRET);
    assert.deepEqual(result, { ok: false, reason: "malformed_signature_header" });
  });

  it("WV.6 — rejects a timestamp outside the tolerance window (replay protection)", () => {
    const payload = "{}";
    const signedAtSeconds = 1_700_000_000;
    const header = sign(payload, signedAtSeconds);
    // 10 minutes later — outside the default 5-minute tolerance
    const result = verifyStripeSignature(payload, header, SECRET, {
      _now: () => (signedAtSeconds + 600) * 1000,
    });
    assert.deepEqual(result, { ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("WV.7 — accepts a signature matching ANY v1= entry (secret-rotation window sends two)", () => {
    const payload = "{}";
    const nowSeconds = 1_700_000_000;
    const genuine = createHmac("sha256", SECRET).update(`${nowSeconds}.${payload}`).digest("hex");
    const bogus = "0".repeat(64);
    const header = `t=${nowSeconds},v1=${bogus},v1=${genuine}`;
    const result = verifyStripeSignature(payload, header, SECRET, { _now: () => nowSeconds * 1000 });
    assert.deepEqual(result, { ok: true });
  });

  it("WV.8 — never throws on a mismatched-length hex signature instead of crashing the webhook route", () => {
    const nowSeconds = 1_700_000_000;
    const header = `t=${nowSeconds},v1=deadbeef`; // far shorter than a real sha256 hex digest
    assert.doesNotThrow(() => verifyStripeSignature("{}", header, SECRET, { _now: () => nowSeconds * 1000 }));
    const result = verifyStripeSignature("{}", header, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
  });
});
