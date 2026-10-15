import type { ActionFunctionArgs } from "react-router";
import { redirect }                 from "react-router";
import { deleteNaiaSession, buildClearSessionCookieHeader } from "~/lib/naia-session.server";

// POST /auth/logout
// Requires a <form method="post" action="/auth/logout"> — not a GET link.
// Using an action (POST) prevents logout-via-prefetch or link-following.

export async function action({ request }: ActionFunctionArgs) {
  await deleteNaiaSession(request);

  // Always a same-host relative redirect to nAia's own login entry point —
  // never the raw Shopify store domain. Shopify is only the auth mechanism
  // underneath; a signed-out customer must never see the Shopify storefront.
  return redirect("/auth/shopify/login", {
    headers: { "Set-Cookie": buildClearSessionCookieHeader() },
  });
}

// Redirect GET requests to the login page (e.g. someone navigates to /auth/logout directly)
export async function loader() {
  return redirect("/auth/shopify/login");
}
