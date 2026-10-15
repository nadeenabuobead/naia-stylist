import type { ActionFunctionArgs } from "react-router";
import { redirect }                 from "react-router";
import { deleteNaiaSession, buildClearSessionCookieHeader } from "~/lib/naia-session.server";

// POST /auth/logout
// Requires a <form method="post" action="/auth/logout"> — not a GET link.
// Using an action (POST) prevents logout-via-prefetch or link-following.

export async function action({ request }: ActionFunctionArgs) {
  await deleteNaiaSession(request);

  // Always a same-host relative redirect to nAia's own signed-out landing —
  // never the raw Shopify store domain, and never straight into
  // /auth/shopify/login. That route, with no existing nAia session,
  // immediately starts a fresh Shopify OAuth authorization — which, if the
  // browser still carries an active Shopify customer session (the normal
  // case right after a customer was just using the app), silently
  // re-authenticates the same account with no explicit Sign In click at
  // all. /auth/signed-out is deliberately inert: it shows the customer is
  // signed out and waits for them to click Sign In before any OAuth starts.
  return redirect("/auth/signed-out", {
    headers: { "Set-Cookie": buildClearSessionCookieHeader() },
  });
}

// Redirect GET requests to the login page (e.g. someone navigates to /auth/logout directly)
export async function loader() {
  return redirect("/auth/shopify/login");
}
