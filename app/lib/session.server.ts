import { createCookieSessionStorage } from "react-router";

const sessionSecret = process.env.SESSION_SECRET || "default-secret-change-me";

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "__naia_session",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "none",
    secrets: [sessionSecret],
    secure: true,
  },
});

export { getSession, commitSession, destroySession };

// Exported so tests can assert Start Over's coverage: clearStyleMeSession iterates
// this list, so a key missing from it silently survives into the next questionnaire.
export const STYLEME_SESSION_KEYS = [
  "styleMeMood",
  "styleMeFeelings",
  "styleMeBodyNeeds",
  "styleMeBodyNeedsRaw",
  "styleMePractical",
  "styleMeOccasion",
  "styleMeFormalityConditional",
  "styleMeSource",
  "styleMeSourcePrev",
  "styleMeAnchorMode",
  "styleMeAnchorMethodPrev",
  "styleMeNadineAnchorHandle",
  "styleMeClosetAnchorId",
  // AUTO or MANUAL. Governs whether New Look may move the anchor, so it must not outlive
  // the anchor it describes: a stale MANUAL pins the next session's reroll to a piece the
  // customer never chose, and a stale AUTO lets a reroll move one she did. It was missing
  // from this list, so Start Over left it behind.
  "styleMeAnchorProvenance",
  // Wardrobe Intelligence handoff — anchor pre-selected, skip the picker.
  "styleMeAnchorLocked",
  // A MANUAL closet pick that failed occasion eligibility, kept only so Change Occasion
  // can re-offer the same piece against a different occasion. NOT a validated anchor —
  // never read by anything that assumes a stored anchor is eligible. Cleared the moment
  // it is promoted to styleMeClosetAnchorId, or a different piece is chosen.
  "styleMePendingClosetAnchorId",
  // Rev 3 — Psychology-First StyleMe (Group 5)
  "styleMeState",
  "styleMeStateOtherText",
  "styleMeIntentions",
  "styleMeCoverageConditional",
  // Website context — "naia" (Closet-only) or "nadine" (Closet + NADINE catalogue)
  "styleMeMode",
  // Provenance — set only by /api/styleme-handoff. Distinguishes a NADINE product
  // handoff from an ordinary closet Rev 3 session; see app/lib/styleme/handoff.ts.
  "styleMeHandoffOrigin",
] as const;

export async function clearStyleMeSession(request: Request): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  for (const key of STYLEME_SESSION_KEYS) {
    session.unset(key);
  }
  return commitSession(session);
}
