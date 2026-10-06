// app/routes/style-me.nadine-preview.tsx
//
// TEMPORARY STAGING/QA DOORWAY. Lets us exercise the NADINE context end to end without
// touching the storefront.
//
// Its only job: stamp styleMeHandoffOrigin = "nadine-entry" and continue into the existing
// Rev 3 questionnaire. From there source.tsx offers "My Closet" / "NADINE + My Closet",
// and the mode is settled by HER choice — not here. Setting mode=nadine at this point
// would make "My Closet" a nadine-mode session and hand the live-five selector a customer
// who had explicitly declined it.
//
// NOT the eventual public NADINE StyleMe URL. That architecture is deliberately undecided;
// this exists to get the flow through QA first. It is not linked from the NADINE website,
// and nothing on the storefront points at it.
//
// STAGING ONLY — 404s elsewhere. This is the one route in the StyleMe flow that mutates
// session state on a GET, which it must, because QA reaches it by typing the URL. A GET
// that writes is CSRF-reachable, so it is fenced to the staging deployment and the write
// is deliberately inert: a provenance marker that unlocks a choice screen. No anchor, no
// mode, no database write, nothing purchasable. The real entry
// (api.styleme-nadine-entry.tsx) is POST-only and origin-guarded, and is what the
// storefront will eventually use.

import { redirect, type LoaderFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import {
  STYLEME_HANDOFF_ORIGIN_KEY,
  HANDOFF_ORIGIN_NADINE_ENTRY,
  HANDOFF_ENTRY_PATH,
  clearLegacyQuestionnaireKeys,
} from "~/lib/styleme/handoff";

export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    throw new Response("Not Found", { status: 404 });
  }

  const session = await getSession(request.headers.get("Cookie"));

  session.set(STYLEME_HANDOFF_ORIGIN_KEY, HANDOFF_ORIGIN_NADINE_ENTRY);

  // Same teardown as the real entry: a fresh doorway starts a fresh questionnaire, and
  // stale source/anchor state would turn the source screen into a confirmation of
  // something chosen in a previous visit rather than a genuine choice.
  clearLegacyQuestionnaireKeys(session);
  session.unset("styleMeState");
  session.unset("styleMeStateOtherText");
  session.unset("styleMeIntentions");
  session.unset("styleMeSource");
  session.unset("styleMeMode");
  session.unset("styleMeSourcePrev");
  session.unset("styleMeAnchorMode");
  session.unset("styleMeAnchorProvenance");
  session.unset("styleMeAnchorLocked");
  session.unset("styleMeClosetAnchorId");
  session.unset("styleMeNadineAnchorHandle");

  return redirect(HANDOFF_ENTRY_PATH, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
