// app/lib/bodyscan-session-binding.server.ts
//
// Binds a Bodygram scan sessionId to the customer it was issued for.
//
// Session-derived customerId alone (see api.bodyscan.jsx) closes the
// cross-customer OnboardingProfile write vector, but does not prove the
// Bodygram sessionId being polled was actually issued for THIS customer —
// Bodygram's token is handed back to the browser in action()'s response, so
// it is not secret from whoever holds it. This module lets action() sign
// {sessionId, customer.id} and lets loader() verify that signature against
// the CURRENTLY authenticated customer.id before trusting the sessionId.
//
// Reuses SESSION_SECRET (already present in every environment) with a
// domain-separation label — no new secret required.
//
// .server.ts, not exported from the route file: a named export from a route
// module is bundled into the client build by React Router's convention,
// which would pull Node's `crypto` into the browser bundle and break the
// build (confirmed — this was tried first and failed exactly that way).

import { createHmac, timingSafeEqual } from "crypto";

const SIG_LABEL = "bodyscan-session-v1";

export function signSessionOwnership(sessionId: string, customerId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`${SIG_LABEL}:${sessionId}:${customerId}`)
    .digest("base64url");
}

export function sessionOwnershipValid(
  sessionId: string,
  customerId: string,
  providedSig: string | null | undefined,
): boolean {
  if (!providedSig || typeof providedSig !== "string") return false;
  let expected: string;
  try {
    expected = signSessionOwnership(sessionId, customerId);
  } catch {
    return false; // fail closed if SESSION_SECRET is missing
  }
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
