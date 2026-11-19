// app/lib/trend-takeaway-sections.ts
//
// The single source of truth for which ShopperEdit prose fields a TAKEAWAY
// save or feedback row is allowed to point at — 11 fixed strings.
//
// This used to be a hand-copied array living in saved-items.ts with no
// compile-time link back to ShopperEdit (see trend-evidence.server.ts,
// exported type ShopperEdit). The `satisfies readonly (keyof ShopperEdit)[]`
// assertion below turns a future rename/removal of a ShopperEdit field into
// a TypeScript build failure instead of a silently-stale list.
//
// Pure: no DB, no I/O. The import below is `import type` only — it is
// erased entirely at compile time (nothing is actually imported at
// runtime), so this file never pulls trend-evidence.server.ts's runtime
// code (or its own imports, e.g. prisma) into whatever bundle ends up
// importing this one. That is what makes it safe to use from a route
// COMPONENT (via saved-items.ts / saved-items-resolve.ts) even though
// trend-evidence.server.ts is a .server module — a plain value import of a
// .server file from a route component is the known house pitfall (see
// project memory: feedback_server_client_boundary), but a type-only import
// does not have that problem because nothing is left behind after erasure.
import type { ShopperEdit } from "./trend-evidence.server";

/**
 * Every prose field of a personalised edit (ShopperEdit) that could ever be
 * pointed at by a TAKEAWAY save or feedback row — 11 fixed strings, verified
 * against ShopperEdit's actual field names by the `satisfies` clause below.
 *
 * Only a subset currently has a rendered Save control (see
 * trends.my-edits.$slug.tsx) — the rest are reserved so a future UI addition
 * doesn't need a schema or validation change.
 */
export const TAKEAWAY_SECTION_KEYS = [
  "yourVersion",
  "evidenceStyleDna",
  "evidencePassportSays",
  "evidenceReviews",
  "lowDataNotice",
  "yourBestRouteIn",
  "aLookToTry",
  "theBalanceToProtect",
  "worthInvestingStatement",
  "partToTake",
  "partToLeave",
] as const satisfies readonly (keyof ShopperEdit)[];

export type TakeawaySectionKey = (typeof TAKEAWAY_SECTION_KEYS)[number];

export function isTakeawaySectionKey(value: unknown): value is TakeawaySectionKey {
  return typeof value === "string" && (TAKEAWAY_SECTION_KEYS as readonly string[]).includes(value);
}
