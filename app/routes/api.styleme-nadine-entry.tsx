// app/routes/api.styleme-nadine-entry.tsx
//
// The generic NADINE doorway: she arrived from the NADINE context wanting to be styled,
// without having chosen a product.
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO: set the mode. Arriving from NADINE is not the
// same as asking for NADINE merchandise. The PDP handoff sets mode=nadine at entry because
// tapping a specific product IS that request; this route records only the doorway, and the
// mode is settled on the source screen by her choosing "NADINE + My Closet". Setting it
// here would make "My Closet" a nadine-mode session and hand the live-five selector a
// customer who had explicitly declined it.
//
// It sets no source and no anchor either, for the same reason — both are hers to choose.
//
// Enters the existing Rev 3 questionnaire unchanged. The only thing distinguishing this
// session from an nAia one is the origin stamp, which source.tsx reads to unlock the
// two-option choice. Every other session has no origin and stays closet-only through the
// Rev 3 source lock.
//
// POST-only and origin-guarded, mirroring api.styleme-handoff.tsx: a state-changing session
// write must not be triggerable by a GET or by a page other than the storefront.
//
// NOT YET CONNECTED to the public storefront. The NADINE StyleMe CTA still points at the
// legacy path; pointing it here is a separate, deliberate switch.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import {
  STYLEME_HANDOFF_ORIGIN_KEY,
  HANDOFF_ORIGIN_NADINE_ENTRY,
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

  const session = await getSession(request.headers.get("Cookie"));

  // The one thing this route establishes.
  session.set(STYLEME_HANDOFF_ORIGIN_KEY, HANDOFF_ORIGIN_NADINE_ENTRY);

  // A fresh doorway starts a fresh questionnaire. Drop any half-finished answers so she is
  // never scored on a vocabulary she did not see, and drop any stale source/anchor/mode
  // from a previous visit so the source screen is a genuine choice rather than a
  // confirmation of something she picked days ago.
  clearLegacyQuestionnaireKeys(session);
  session.unset("styleMeState");
  session.unset("styleMeStateOtherText");
  session.unset("styleMeIntentions");
  session.unset("styleMeSourcePrev");
  session.unset("styleMeAnchorMode");
  session.unset("styleMeAnchorProvenance");
  session.unset("styleMeAnchorLocked");
  session.unset("styleMeNadineAnchorHandle");

  return redirect(HANDOFF_ENTRY_PATH, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
