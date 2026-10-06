// app/routes/api.wi-style-this.tsx
// Wardrobe Intelligence → StyleMe handoff.
// Called when a customer clicks "Style this in StyleMe" on a rediscovered
// Closet piece on /closet/intelligence.
// POST-only: state-changing session writes must not be triggered by GET requests.
// Same-origin (the WI page lives inside this app) — no Origin check needed, unlike
// the cross-origin NADINE handoff in api.styleme-handoff.tsx.
// Ownership is re-verified server-side via resolveClosetAnchor; the browser-supplied
// closetItemId is never trusted on its own.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession, STYLEME_SESSION_KEYS } from "~/lib/session.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";

export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return redirect("/auth/shopify/login");
  }

  const formData = await request.formData();
  const closetItemId = formData.get("closetItemId") as string | null;

  // Fail closed: no id, or the item doesn't exist / isn't owned by this customer
  // (resolveClosetAnchor collapses both cases into the same null — no ownership leak).
  const resolved = closetItemId ? await resolveClosetAnchor(naiaCustomer.id, closetItemId) : null;
  if (!resolved) {
    return redirect("/closet/intelligence");
  }

  // Pre-select the anchor exactly as a manual pick would, on the existing
  // session cookie — the engine never knows this came from Wardrobe
  // Intelligence rather than the closet picker. Mirrors api.styleme-handoff.tsx's
  // session-priming shape, minus the cross-origin check (this is same-origin).
  const session = await getSession(request.headers.get("Cookie"));

  // A fresh Today questionnaire. Clicking a garment in Wardrobe Intelligence starts a new
  // session, so every prior answer goes first — otherwise she arrives at question one with
  // last session's answers already selected. QA hit exactly this: an old intention
  // ("HELP ME FEEL SHARPER") was pre-selected on entry.
  //
  // Driven off STYLEME_SESSION_KEYS rather than a hand-written list, for the reason that
  // registry documents about itself: a key missing from it silently survives into the next
  // questionnaire. The two NADINE doorways clear their own explicit lists; this one cannot
  // drift from the registry, and a key added there is covered here automatically.
  //
  // Only styleMe* keys are in that registry, so authentication and Style Passport data are
  // untouched — the customer stays signed in and her profile is unaffected.
  //
  // ORDER MATTERS: clear first, then set the anchor. The reverse would discard the very
  // garment she clicked.
  for (const key of STYLEME_SESSION_KEYS) {
    session.unset(key);
  }

  session.set("styleMeSource", "my-closet");
  session.set("styleMeMode", "naia");
  session.set("styleMeClosetAnchorId", resolved.id);
  // She tapped this exact garment in Wardrobe Intelligence, so the anchor is MANUAL:
  // New Look may vary the outfit around it but must never move it. Stated rather than
  // left to default — an "AUTO" left in the cookie by an earlier session would otherwise
  // survive and let the reroll replace a piece she explicitly chose.
  session.set("styleMeAnchorProvenance", "MANUAL");
  session.set("styleMeAnchorLocked", "1");

  return redirect("/style-me/state", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
