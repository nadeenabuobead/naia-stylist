// nAia Admin — index redirect to Closet Intelligence.
//
// Uses the Shopify embedded-safe redirect helper (from authenticate.admin) so
// that ALL embedded context params (embedded, host, shop, id_token, etc.) are
// automatically copied to the redirect target URL.  Plain React Router
// redirect() only preserves what we manually append, which dropped id_token
// and caused "shopify.com refused to connect" inside the Shopify Admin iframe.

import type { LoaderFunctionArgs } from "react-router";
import { requireNaiaAdminAccess } from "~/lib/naia-admin-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { redirect: shopifyRedirect } = await requireNaiaAdminAccess(request);
  return shopifyRedirect("/app/naia-admin/closet");
}
