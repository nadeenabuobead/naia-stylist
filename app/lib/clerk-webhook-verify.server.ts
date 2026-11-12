// app/lib/clerk-webhook-verify.server.ts
//
// Manual Svix webhook signature verification for Clerk's account-sync
// webhook (fix/stripe-clerk-phase1-security, 2026-11-12) — implementing the
// Svix scheme Clerk uses directly via Node's crypto module, not the svix npm
// package, matching this codebase's existing provider convention (see
// app/lib/billing/webhook-verify.server.ts's own header for why raw
// primitives, not vendor SDKs, are used throughout this codebase for
// provider integrations).
//
// Svix's documented scheme: headers svix-id, svix-timestamp, svix-signature.
// The signed content is "{svix-id}.{svix-timestamp}.{raw body}" —
// HMAC-SHA256 using the secret's base64-decoded bytes (Clerk delivers the
// secret as "whsec_<base64>"; only the part after "whsec_" is the actual key
// material), itself base64-encoded. svix-signature can carry multiple
// space-separated "v1,<base64sig>" entries (key-rotation support, Svix's
// own convention) — a match against ANY of them is a valid signature, the
// same multi-entry pattern Stripe's own Stripe-Signature header uses.
//
// CRITICAL: this must run against the UNPARSED raw request body — same
// requirement and reason as Stripe's verifier (a parse-then-reserialize
// round-trip is not guaranteed byte-identical to what was actually signed).
// The caller must pass request.text(), never request.json().

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300; // Svix's own recommended default

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export interface ClerkWebhookHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

function constantTimeBase64Equal(a: string, b: string): boolean {
  // Mismatched-length inputs can never be genuine — but must still take a
  // safe path rather than let timingSafeEqual throw on unequal buffer
  // lengths, which would otherwise leak length information via an
  // exception vs. a clean boolean (same defensive shape as Stripe's verifier).
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "base64"), Buffer.from(b, "base64"));
  } catch {
    return false;
  }
}

function parseSignatureHeader(header: string): string[] {
  // "v1,<sig1> v1,<sig2> ..." — space-separated, each a "version,base64sig" pair.
  return header
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [version, sig] = entry.split(",", 2);
      return version === "v1" && sig ? sig : null;
    })
    .filter((sig): sig is string => sig !== null);
}

export interface VerifyClerkWebhookOptions {
  toleranceSeconds?: number;
  _now?: () => number; // ms since epoch — injectable for deterministic tests
}

export function verifyClerkWebhookSignature(
  rawBody: string,
  headers: ClerkWebhookHeaders,
  secret: string,
  { toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, _now = () => Date.now() }: VerifyClerkWebhookOptions = {},
): VerifyResult {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return { ok: false, reason: "missing_svix_headers" };

  const timestampNum = Number(svixTimestamp);
  if (!Number.isFinite(timestampNum)) return { ok: false, reason: "malformed_timestamp" };

  const nowSeconds = Math.floor(_now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const secretKey = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretKey, "base64");
  } catch {
    return { ok: false, reason: "malformed_secret" };
  }
  if (secretBytes.length === 0) return { ok: false, reason: "malformed_secret" };

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  const candidates = parseSignatureHeader(svixSignature);
  if (candidates.length === 0) return { ok: false, reason: "malformed_signature_header" };

  const matched = candidates.some((sig) => constantTimeBase64Equal(sig, expected));
  if (!matched) return { ok: false, reason: "signature_mismatch" };

  return { ok: true };
}
