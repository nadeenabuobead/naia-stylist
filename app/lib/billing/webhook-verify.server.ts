// app/lib/billing/webhook-verify.server.ts
// Phase 3 — manual Stripe webhook signature verification, implementing
// Stripe's documented scheme directly via Node's crypto module rather than
// the `stripe` npm SDK (see stripe-client.server.ts's header for why this
// codebase integrates providers via raw primitives, not vendor SDKs).
//
// Stripe's Stripe-Signature header format: "t=<timestamp>,v1=<hex-hmac>"
// (possibly with more v1= entries during secret rotation, and other
// unrelated schemes we ignore). The expected signature is
// HMAC-SHA256(secret, `${timestamp}.${rawBody}`), hex-encoded, compared in
// constant time. A timestamp tolerance rejects old/replayed signatures even
// if the HMAC itself were somehow known.
//
// CRITICAL: this must run against the UNPARSED raw request body (JSON.parse
// then JSON.stringify would not reliably reproduce the exact original
// bytes Stripe signed — whitespace/key-order are not guaranteed stable).
// The caller must pass request.text(), never request.json().

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300; // Stripe's own recommended default

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = header.split(",").map((p) => p.trim());
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function constantTimeHexEqual(a: string, b: string): boolean {
  // Mismatched-length inputs can never be genuine — but must still take a
  // safe path rather than let timingSafeEqual throw on unequal buffer
  // lengths, which would otherwise leak length information via an
  // exception vs. a clean boolean.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export interface VerifyStripeSignatureOptions {
  toleranceSeconds?: number;
  _now?: () => number; // ms since epoch — injectable for deterministic tests
}

export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  { toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, _now = () => Date.now() }: VerifyStripeSignatureOptions = {},
): VerifyResult {
  if (!signatureHeader) return { ok: false, reason: "missing_signature_header" };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "malformed_signature_header" };

  const { timestamp, signatures } = parsed;
  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return { ok: false, reason: "malformed_timestamp" };

  const nowSeconds = Math.floor(_now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const matched = signatures.some((sig) => constantTimeHexEqual(sig, expected));
  if (!matched) return { ok: false, reason: "signature_mismatch" };

  return { ok: true };
}
