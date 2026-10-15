import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// Temporary root-route redirect for the pre-Lovable staging phase: the bare
// `/` used to render a legacy dashboard (superseded by /my-naia and no
// longer linked from customer-facing navigation), so any stale link, bookmark,
// or return_to value that still lands here must not expose it. Once the
// Lovable public site is integrated, `/` becomes the new public homepage and
// this redirect is removed.
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(`/my-naia${url.search}`);
}
