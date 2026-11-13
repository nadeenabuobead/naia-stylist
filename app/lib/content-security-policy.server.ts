// app/lib/content-security-policy.server.ts
//
// Directive-aware frame-ancestors handling for the CSP response header.
//
// Extracted out of entry.server.jsx (which has no easy unit-test seam of
// its own -- it needs a full React Router SSR render context) so this
// logic can be tested directly as pure string functions.
//
// Why directive-aware, not header-presence-aware: a naive
// `headers.has("Content-Security-Policy")` check would wrongly treat ANY
// existing CSP header as "frame-ancestors is already handled" -- even one
// that only sets, say, script-src. That would silently leave the response
// with no framing restriction at all. This module checks for the
// frame-ancestors DIRECTIVE specifically, and appends it (never
// overwriting other directives) when it's missing.

/**
 * True if `cspValue` already contains a `frame-ancestors` directive,
 * independent of whitespace or letter case. Directive names in a CSP
 * header are case-insensitive per spec; real-world policies occasionally
 * vary casing or spacing, so this splits on `;` and matches each
 * directive's name token rather than doing a single substring check
 * (which could also false-positive on an unrelated directive that merely
 * contains the substring "frame-ancestors" somewhere in its value).
 */
export function hasFrameAncestorsDirective(cspValue: string | null | undefined): boolean {
  if (!cspValue) return false;
  return cspValue
    .split(";")
    .some((directive) => /^\s*frame-ancestors\b/i.test(directive));
}

/**
 * Appends `frame-ancestors 'none'` to an existing CSP value, preserving
 * every other directive already present. Assumes the caller has already
 * confirmed (via hasFrameAncestorsDirective) that no frame-ancestors
 * directive exists yet -- this function does not itself guard against
 * duplicating one.
 */
export function appendFrameAncestorsNone(cspValue: string): string {
  const trimmed = cspValue.trim();
  if (trimmed.length === 0) return "frame-ancestors 'none';";
  const withTrailingSemicolon = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
  return `${withTrailingSemicolon} frame-ancestors 'none';`;
}

/**
 * The single entry point entry.server.jsx calls: given the CSP value
 * already on the response (possibly null/empty, possibly Shopify's own
 * dynamic frame-ancestors value, possibly some other policy entirely),
 * returns the value that should end up on the header. Never overwrites
 * an existing frame-ancestors directive -- including Shopify's own
 * shop-scoped one for embedded-admin routes.
 */
export function ensureFrameAncestorsDirective(existingCspValue: string | null | undefined): string {
  if (hasFrameAncestorsDirective(existingCspValue)) {
    // Non-null by construction: hasFrameAncestorsDirective only returns
    // true for a non-empty string.
    return existingCspValue as string;
  }
  return existingCspValue ? appendFrameAncestorsNone(existingCspValue) : "frame-ancestors 'none';";
}
