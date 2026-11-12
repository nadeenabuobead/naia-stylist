// app/lib/clerk-webhook-verify.test.ts
// Behavioral tests for Clerk/Svix webhook signature verification — the gate
// that proves a request genuinely came from Clerk before any business logic
// runs. No real network, no real Clerk account: every signature is
// constructed in this file with the same HMAC scheme the implementation
// verifies, using a shared test-only secret.
//
// Run: node --import tsx/esm --test app/lib/clerk-webhook-verify.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { verifyClerkWebhookSignature, type ClerkWebhookHeaders } from "./clerk-webhook-verify.server";

// A real-shaped Svix secret: "whsec_" + base64. The bytes after decoding are
// the actual HMAC key — arbitrary here, just needs to be valid base64.
const SECRET_KEY_BYTES = Buffer.from("clerk-webhook-verify-test-fixture-key");
const SECRET = `whsec_${SECRET_KEY_BYTES.toString("base64")}`;

function sign(id: string, timestampSeconds: number, body: string, secret = SECRET): ClerkWebhookHeaders {
  const keyPart = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const keyBytes = Buffer.from(keyPart, "base64");
  const signedContent = `${id}.${timestampSeconds}.${body}`;
  const sig = createHmac("sha256", keyBytes).update(signedContent).digest("base64");
  return { svixId: id, svixTimestamp: String(timestampSeconds), svixSignature: `v1,${sig}` };
}

describe("verifyClerkWebhookSignature", () => {
  it("CWV.1 — accepts a correctly signed payload within tolerance", () => {
    const body = JSON.stringify({ type: "user.deleted", data: { id: "user_abc" } });
    const nowSeconds = 1_700_000_000;
    const headers = sign("msg_1", nowSeconds, body);
    const result = verifyClerkWebhookSignature(body, headers, SECRET, { _now: () => nowSeconds * 1000 });
    assert.deepEqual(result, { ok: true });
  });

  it("CWV.2 — rejects a payload whose signature doesn't match (tampered body)", () => {
    const nowSeconds = 1_700_000_000;
    const headers = sign("msg_1", nowSeconds, "original body");
    const result = verifyClerkWebhookSignature("tampered body", headers, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "signature_mismatch");
  });

  it("CWV.3 — rejects a signature computed with the wrong secret", () => {
    const wrongSecret = `whsec_${Buffer.from("a completely different key").toString("base64")}`;
    const nowSeconds = 1_700_000_000;
    const headers = sign("msg_1", nowSeconds, "{}", wrongSecret);
    const result = verifyClerkWebhookSignature("{}", headers, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "signature_mismatch");
  });

  it("CWV.4 — rejects a signature computed for a DIFFERENT svix-id — the id is part of the signed content, not just a lookup key", () => {
    const nowSeconds = 1_700_000_000;
    const headers = sign("msg_original", nowSeconds, "{}");
    // Swap in a different id after signing — exactly what an attacker
    // replaying a captured event under a different envelope would do.
    const tampered: ClerkWebhookHeaders = { ...headers, svixId: "msg_attacker_supplied" };
    const result = verifyClerkWebhookSignature("{}", tampered, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "signature_mismatch");
  });

  it("CWV.5 — rejects missing svix headers, individually", () => {
    const base = sign("msg_1", 1_700_000_000, "{}");
    assert.deepEqual(
      verifyClerkWebhookSignature("{}", { ...base, svixId: null }, SECRET),
      { ok: false, reason: "missing_svix_headers" },
    );
    assert.deepEqual(
      verifyClerkWebhookSignature("{}", { ...base, svixTimestamp: null }, SECRET),
      { ok: false, reason: "missing_svix_headers" },
    );
    assert.deepEqual(
      verifyClerkWebhookSignature("{}", { ...base, svixSignature: null }, SECRET),
      { ok: false, reason: "missing_svix_headers" },
    );
  });

  it("CWV.6 — rejects a malformed signature header (no v1, entry)", () => {
    const nowSeconds = 1_700_000_000;
    const base = sign("msg_1", nowSeconds, "{}");
    const result = verifyClerkWebhookSignature(
      "{}",
      { ...base, svixSignature: "garbage-no-version-prefix" },
      SECRET,
      { _now: () => nowSeconds * 1000 },
    );
    assert.deepEqual(result, { ok: false, reason: "malformed_signature_header" });
  });

  it("CWV.7 — rejects a timestamp outside the tolerance window (replay protection)", () => {
    const signedAtSeconds = 1_700_000_000;
    const headers = sign("msg_1", signedAtSeconds, "{}");
    // 10 minutes later — outside the default 5-minute tolerance
    const result = verifyClerkWebhookSignature("{}", headers, SECRET, {
      _now: () => (signedAtSeconds + 600) * 1000,
    });
    assert.deepEqual(result, { ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("CWV.8 — accepts a signature matching ANY v1 entry (secret-rotation window sends two)", () => {
    const nowSeconds = 1_700_000_000;
    const body = "{}";
    const genuine = sign("msg_1", nowSeconds, body).svixSignature!.replace("v1,", "");
    const bogus = Buffer.from("not-the-real-signature").toString("base64");
    const headers: ClerkWebhookHeaders = {
      svixId: "msg_1",
      svixTimestamp: String(nowSeconds),
      svixSignature: `v1,${bogus} v1,${genuine}`,
    };
    const result = verifyClerkWebhookSignature(body, headers, SECRET, { _now: () => nowSeconds * 1000 });
    assert.deepEqual(result, { ok: true });
  });

  it("CWV.9 — never throws on a malformed/short base64 signature instead of crashing the webhook route", () => {
    const nowSeconds = 1_700_000_000;
    const headers: ClerkWebhookHeaders = { svixId: "msg_1", svixTimestamp: String(nowSeconds), svixSignature: "v1,x" };
    assert.doesNotThrow(() => verifyClerkWebhookSignature("{}", headers, SECRET, { _now: () => nowSeconds * 1000 }));
    const result = verifyClerkWebhookSignature("{}", headers, SECRET, { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
  });

  it("CWV.10 — correctly strips the 'whsec_' prefix before decoding the secret — a bare base64 secret without the prefix also works", () => {
    const bareSecret = SECRET.slice("whsec_".length);
    const nowSeconds = 1_700_000_000;
    const headers = sign("msg_1", nowSeconds, "{}", bareSecret);
    const result = verifyClerkWebhookSignature("{}", headers, bareSecret, { _now: () => nowSeconds * 1000 });
    assert.deepEqual(result, { ok: true });
  });

  it("CWV.11 — rejects an empty secret rather than treating it as a valid zero-length key", () => {
    const nowSeconds = 1_700_000_000;
    const headers = sign("msg_1", nowSeconds, "{}");
    const result = verifyClerkWebhookSignature("{}", headers, "whsec_", { _now: () => nowSeconds * 1000 });
    assert.equal(result.ok, false);
  });
});
