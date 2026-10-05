// app/routes/api.styleme-handoff.tsx
// StyleMe pre-selection handoff.
// Called when a customer clicks "Style Me with this piece" on a NADINE product page.
//
// Enters the CANONICAL Rev 3 questionnaire (State → Intention → Fit/Comfort →
// Occasion), not the retired mood/feeling/comfort flow. The clicked product is
// stamped into the session and survives every step; see app/lib/styleme/handoff.ts.
//
// Never redirect through /style-me — that route clears the whole StyleMe session
// and would destroy the anchor this route just stored.
// POST-only: state-changing session writes must not be triggered by GET requests.
// Origin-validated: rejects requests not originating from the Shopify storefront.
// No database writes. No profile mutation.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import {
  isValidNadineHandle,
  STYLEME_HANDOFF_ORIGIN_KEY,
  HANDOFF_ORIGIN_NADINE_PDP,
  HANDOFF_ENTRY_PATH,
  clearLegacyQuestionnaireKeys,
} from "~/lib/styleme/handoff";

const ALLOWED_ORIGIN = "https://naiabynadine.com";

export async function action({ request }: ActionFunctionArgs) {
  // Origin guard — rejects CSRF from any page other than the Shopify storefront.
  // Browsers always set Origin on cross-origin form POSTs; null/missing is also rejected.
  const origin = request.headers.get("Origin");
  if (origin !== ALLOWED_ORIGIN) {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const handle = formData.get("handle") as string | null;

  // Reject unknown or missing handles — fail closed.
  // Server-side validation against LOCKED_CATALOGUE_HANDLES; browser-supplied value cannot
  // resolve to an arbitrary anchor — only the 11 verified NADINE handles are accepted.
  if (!isValidNadineHandle(handle)) {
    // Fail closed: no anchor is stamped, so this becomes an ordinary Rev 3 session.
    return redirect(HANDOFF_ENTRY_PATH);
  }

  const session = await getSession(request.headers.get("Cookie"));

  // Pre-select source and anchor. source.tsx recognises the provenance stamp and
  // lets this session keep its NADINE anchor instead of forcing closet-only.
  session.set("styleMeSource", "naia-piece");
  session.set("styleMeNadineAnchorHandle", handle);
  session.set(STYLEME_HANDOFF_ORIGIN_KEY, HANDOFF_ORIGIN_NADINE_PDP);
  // Clear stale closet anchor if any.
  session.unset("styleMeClosetAnchorId");
  // Mark as NADINE-website session: Closet + NADINE catalogue recommendations.
  session.set("styleMeMode", "nadine");
  // A handoff always starts a fresh questionnaire — drop any half-finished legacy
  // answers so the customer is never scored on a vocabulary they did not see.
  clearLegacyQuestionnaireKeys(session);
  session.unset("styleMeState");
  session.unset("styleMeStateOtherText");
  session.unset("styleMeIntentions");

  return redirect(HANDOFF_ENTRY_PATH, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
