// app/lib/styleme/handoff.ts
//
// NADINE product handoff → canonical Rev 3 StyleMe.
//
// A customer who taps "Style Me with this piece" on a NADINE product page must
// land in the SAME Rev 3 questionnaire as everyone else (State → Intention →
// Fit/Comfort → Occasion) while the exact product they tapped survives all the
// way to resolveActionAnchor().
//
// Two things make that work:
//
//   1. PROVENANCE. `styleMeMode` cannot carry provenance on its own — source.tsx
//      overwrites it to "naia" in three places during normal Rev 3 navigation.
//      A handoff therefore stamps its own key, STYLEME_HANDOFF_ORIGIN_KEY, which
//      only /api/styleme-handoff ever sets and only clearStyleMeSession clears.
//
//   2. SERVER-SIDE REVALIDATION. The session cookie is signed and httpOnly, so a
//      browser cannot forge the handle. We still re-check it every time it
//      unlocks behaviour, so a stale, renamed or withdrawn handle can never mint
//      an anchor. Fail closed: an unrecognised handle degrades to an ordinary
//      closet-only Rev 3 session.
//
//      A handle must satisfy BOTH gates: the storefront allowlist
//      (LOCKED_CATALOGUE_HANDLES) and the live product catalogue that
//      resolveNadineAnchor() reads. These are not the same set — as of this
//      commit "cropped-top" and "straight-pants" are allowlisted but absent from
//      the catalogue. Accepting a handle we cannot resolve would carry the
//      customer through the whole questionnaire only to dead-end at the result
//      with "Selected product is not available", so we reject it at the door.

import type { Session } from "react-router";
import { LOCKED_CATALOGUE_HANDLES } from "../ai/naia-product-media.js";
import { getAllCatalogProducts } from "../ai/naia-catalog.js";

/** Session key stamping where a StyleMe session came from. */
export const STYLEME_HANDOFF_ORIGIN_KEY = "styleMeHandoffOrigin";

/** The only recognised handoff origin today: the NADINE product page. */
export const HANDOFF_ORIGIN_NADINE_PDP = "nadine-pdp";

/** Where /api/styleme-handoff sends the customer: the canonical Rev 3 entry. */
export const HANDOFF_ENTRY_PATH = "/style-me/state";

/** The canonical Rev 3 entry point. Every legacy fallback resolves here. */
export const CANONICAL_STYLEME_ENTRY = "/style-me/state";

// Storefront allowlist ∩ live catalogue. Both gates, computed once.
const ALLOWLISTED: ReadonlySet<string> = new Set<string>(LOCKED_CATALOGUE_HANDLES);
const IN_CATALOGUE: ReadonlySet<string> = new Set<string>(
  getAllCatalogProducts().map((p) => p.handle),
);

/**
 * Handles a NADINE handoff may actually anchor on: allowlisted AND resolvable by
 * resolveNadineAnchor(). Exported so tests can assert the two sets stay aligned.
 */
export const HANDOFF_RESOLVABLE_HANDLES: readonly string[] =
  LOCKED_CATALOGUE_HANDLES.filter((h) => IN_CATALOGUE.has(h));

/**
 * True only for a handle that is both allowlisted for the storefront button and
 * present in the live product catalogue. The single place that decides whether a
 * handle is real — used by the handoff route on the way in and by the source
 * lock on the way out.
 */
export function isValidNadineHandle(handle: unknown): handle is string {
  return typeof handle === "string" && ALLOWLISTED.has(handle) && IN_CATALOGUE.has(handle);
}

export interface NadineHandoff {
  /** The exact product the customer tapped. Already revalidated. */
  handle: string;
}

/**
 * Reads a *verified* NADINE handoff out of the session, or null.
 *
 * Returns null unless BOTH the provenance stamp and a handle that still exists
 * in the locked catalogue are present. Callers may therefore treat a non-null
 * result as authorisation to leave closet-only mode.
 */
export function readNadineHandoff(
  session: Pick<Session, "get">,
): NadineHandoff | null {
  if (session.get(STYLEME_HANDOFF_ORIGIN_KEY) !== HANDOFF_ORIGIN_NADINE_PDP) return null;
  const handle = session.get("styleMeNadineAnchorHandle");
  if (!isValidNadineHandle(handle)) return null;
  return { handle };
}

// ── Legacy → canonical transition ────────────────────────────────────────────

/**
 * Session keys written ONLY by the retired mood/feeling/comfort questionnaire.
 *
 * These carry a different vocabulary from Rev 3: `styleMeMood` and
 * `styleMeFeelings` hold emotional IDs with no approved mapping onto the 12
 * intention IDs, and the legacy comfort step wrote *canonical engine* body-need
 * IDs where Rev 3 writes Rev 3 IDs. Carrying either forward would silently
 * change what the customer said, so the transition drops them and re-asks.
 *
 * Deliberately NOT listed — these are vocabulary-compatible or provenance and
 * must survive: styleMeOccasion, styleMeOccasionDisplayLabel,
 * styleMeFormalityConditional, styleMeSource, styleMeMode,
 * styleMeNadineAnchorHandle, styleMeClosetAnchorId, styleMeHandoffOrigin.
 */
export const LEGACY_QUESTIONNAIRE_KEYS = [
  "styleMeMood",
  "styleMeFeelings",
  "styleMePractical",
  // Written by both flows but in incompatible vocabularies — re-ask rather than reinterpret.
  "styleMeBodyNeeds",
  "styleMeBodyNeedsRaw",
] as const;

/** True when the session holds legacy questionnaire answers and no Rev 3 State. */
export function hasStrandedLegacySession(session: Pick<Session, "get">): boolean {
  if (session.get("styleMeState")) return false;
  return !!(session.get("styleMeMood") || session.get("styleMeFeelings"));
}

/**
 * Drops legacy questionnaire answers so the customer restarts cleanly at State.
 *
 * Restarting is intentional. We do not invent a mood → intention mapping: no
 * approved one exists, and guessing would change the meaning of the customer's
 * answer without telling them.
 */
export function clearLegacyQuestionnaireKeys(session: Pick<Session, "unset">): void {
  for (const key of LEGACY_QUESTIONNAIRE_KEYS) session.unset(key);
}
