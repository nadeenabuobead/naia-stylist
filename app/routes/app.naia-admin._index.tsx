// nAia Admin — index redirect to Closet Intelligence.
//
// Preserves Shopify embedded context (?host=...&shop=...) in the redirect.
// Without these params the Shopify adapter can't validate the embedded frame
// and triggers a re-auth redirect, creating the "too many redirects" loop.

import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireNaiaAdminAccess } from "~/lib/naia-admin-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireNaiaAdminAccess(request);
  const url = new URL(request.url);
  const qs = new URLSearchParams();
  const host = url.searchParams.get("host");
  const shop = url.searchParams.get("shop");
  if (host) qs.set("host", host);
  if (shop) qs.set("shop", shop);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  return redirect(`/app/naia-admin/closet${suffix}`);
}
