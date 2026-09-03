// app/routes/api.styleme-handoff.tsx
// Phase 4A4 — StyleMe pre-selection handoff.
// Called when a customer clicks "Style Me with this piece" on a NADINE product page.
// POST-only: state-changing session writes must not be triggered by GET requests.
// Origin-validated: rejects requests not originating from the Shopify storefront.
// No database writes. No profile mutation.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import { LOCKED_CATALOGUE_HANDLES } from "~/lib/ai/naia-product-media";

const VALID_HANDLES = new Set<string>(LOCKED_CATALOGUE_HANDLES);
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
  if (!handle || !VALID_HANDLES.has(handle)) {
    return redirect("/style-me/mood");
  }

  const session = await getSession(request.headers.get("Cookie"));

  // Pre-select source and anchor so source.tsx skips straight to anchor confirmation.
  session.set("styleMeSource", "naia-piece");
  session.set("styleMeNadineAnchorHandle", handle);
  // Clear stale closet anchor if any.
  session.unset("styleMeClosetAnchorId");
  // Mark as NADINE-website session: Closet + NADINE catalogue recommendations.
  session.set("styleMeMode", "nadine");

  return redirect("/style-me/mood", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
