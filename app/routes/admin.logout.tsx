// app/routes/admin.logout.tsx
//
// Logout action for the standalone nAia Internal Admin portal.
// This route is NOT nested under admin.tsx — no protected parent loader.
//
// POST /admin/logout  → destroy __naia_admin session, redirect to /admin/login
// GET  /admin/logout  → 405 Method Not Allowed (logout must be a POST)

import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { destroyAdminSession } from "~/lib/internal-auth.server";

export async function loader() {
  throw new Response("Method Not Allowed — use POST to log out", { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", { status: 405 });
  }
  const cookie = await destroyAdminSession(request);
  return redirect("/admin/login", { headers: { "Set-Cookie": cookie } });
}
