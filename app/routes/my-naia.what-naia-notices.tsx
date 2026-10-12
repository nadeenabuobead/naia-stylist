// app/routes/my-naia.what-naia-notices.tsx
//
// V1 UX restructure: "What nAia Is Noticing" is no longer a standalone
// destination — it now lives as a section inside Style Passport
// (app/routes/passport.tsx, #noticing). This route exists only so old
// links/bookmarks to /my-naia/what-naia-notices redirect safely instead of
// 404ing or duplicating the UI in two places.

import { type LoaderFunctionArgs, redirect } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCurrentNaiaCustomer(request);
  throw redirect("/passport#noticing");
}

export default function WhatNaiaNoticesRedirect() {
  return null;
}
