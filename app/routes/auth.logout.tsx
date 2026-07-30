import type { ActionFunctionArgs } from "react-router";
import { redirect }                 from "react-router";
import { deleteNaiaSession, buildClearSessionCookieHeader } from "~/lib/naia-session.server";

// POST /auth/logout
// Requires a <form method="post" action="/auth/logout"> — not a GET link.
// Using an action (POST) prevents logout-via-prefetch or link-following.

export async function action({ request }: ActionFunctionArgs) {
  await deleteNaiaSession(request);

  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? "";
  const storeHome   = storeDomain
    ? `https://${storeDomain}`
    : "/auth/shopify/login";

  return redirect(storeHome, {
    headers: { "Set-Cookie": buildClearSessionCookieHeader() },
  });
}

// Redirect GET requests to the login page (e.g. someone navigates to /auth/logout directly)
export async function loader() {
  return redirect("/auth/shopify/login");
}
