// app/lib/styleme/mode-resolution.ts
//
// Which product context a StyleMe generation is running in.
//
//   naia    style from the customer's own closet; the NADINE catalogue must never leak in
//   nadine  the customer's closet plus eligible NADINE pieces
//
// This used to live only in the `styleMeMode` cookie. Nothing persisted it, and the two
// route readers defaulted it to "naia" while the engine defaulted it to "nadine" — two
// answers to the same missing value. A NADINE session whose cookie expired, and every
// reload by sessionId, therefore became an nAia session.
//
// PRECEDENCE: persisted > cookie > naia.
//
// The persisted value wins because it is what the session actually was. The cookie is a
// statement about the browser in front of us, and a hint must not overrule a record — that
// is the whole point of persisting it. "naia" is last because an unknown product context
// must fail closed to closet-only: showing a closet look to a NADINE customer is
// disappointing, while showing catalogue merchandise to an nAia customer is wrong.
//
// VALIDATION IS NOT DECORATION. Both inputs arrive from outside the type system — one from
// a database column that predates this code and is null on every existing row, one from a
// client cookie. An unrecognised value falls through to the next source rather than being
// trusted, so a hand-edited cookie cannot invent a third mode, and a future schema value
// cannot quietly change behaviour on an old build.

import type { StyleMeMode } from "../ai/styleme-recommendation.types.js";

/** Closet-only. The value every unknown context resolves to. */
export const DEFAULT_STYLEME_MODE: StyleMeMode = "naia";

const VALID: ReadonlySet<string> = new Set<StyleMeMode>(["naia", "nadine"]);

function asMode(value: unknown): StyleMeMode | null {
  return typeof value === "string" && VALID.has(value) ? (value as StyleMeMode) : null;
}

/**
 * The product context for this generation.
 *
 * @param persisted the StylingSession's own styleMeMode — null for rows written before the
 *                  column existed, which is why the cookie fallback is kept rather than
 *                  treating a null as "naia" outright.
 * @param cookie    the browser's styleMeMode, a hint only.
 */
export function resolveStyleMeMode(
  persisted: unknown,
  cookie: unknown,
): StyleMeMode {
  return asMode(persisted) ?? asMode(cookie) ?? DEFAULT_STYLEME_MODE;
}
