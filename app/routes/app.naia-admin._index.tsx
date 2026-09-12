// nAia Admin — index redirect to Closet Intelligence.

import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireNaiaAdminAccess } from "~/lib/naia-admin-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireNaiaAdminAccess(request);
  return redirect("/app/naia-admin/closet");
}
