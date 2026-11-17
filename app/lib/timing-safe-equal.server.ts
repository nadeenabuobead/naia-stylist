import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison for secrets (header values, tokens) —
 * extracted from the established pattern already in api.seed-staging.jsx
 * (its own timingSafeStringEqual) so new code comparing a caller-supplied
 * value against a server secret uses the same reviewed approach instead of
 * a plain `===`/`!==`, which leaks timing information byte-by-byte.
 */
export function timingSafeStringEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
