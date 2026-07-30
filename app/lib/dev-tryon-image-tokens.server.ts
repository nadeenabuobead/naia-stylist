// app/lib/dev-tryon-image-tokens.server.ts
// Process-scoped short-lived tokens for the dev-tryon result gallery.
//
// Tokens are issued by the staff-authenticated loader and validated by the
// image proxy resource route. They never leave the server (they appear only
// as URL query parameters on /app/dev-tryon-img/:handle?t=<token>).
//
// Appropriate for dev-only single-process use. Not suitable for multi-instance
// production deployments (tokens are not shared across processes).

import crypto from "node:crypto";

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface TokenEntry {
  handleSlug: string;
  expiresAt: number;
}

const _store = new Map<string, TokenEntry>();

// Issue a new random token for the given handle slug.
// Call from a staff-authenticated loader only.
export function issueImageToken(handleSlug: string): string {
  const token = crypto.randomBytes(20).toString("base64url");
  _store.set(token, { handleSlug, expiresAt: Date.now() + TTL_MS });
  // Prune stale entries periodically.
  if (_store.size > 200) {
    const now = Date.now();
    for (const [t, v] of _store) {
      if (v.expiresAt < now) _store.delete(t);
    }
  }
  return token;
}

// Returns true only if the token is valid, non-expired, and bound to the given slug.
export function verifyImageToken(token: string, handleSlug: string): boolean {
  const entry = _store.get(token);
  if (!entry) return false;
  if (entry.handleSlug !== handleSlug) return false;
  if (entry.expiresAt < Date.now()) {
    _store.delete(token);
    return false;
  }
  return true;
}
