import { redirect, type LoaderFunctionArgs } from "react-router";

// Permanent redirect — My Trend Edits moved to /trends/my-edits/:slug.
// Handles bookmarks and external links to the old /trends/:slug/edit path.
export async function loader({ params }: LoaderFunctionArgs) {
  return redirect(`/trends/my-edits/${params.slug}`, 302);
}

export default function TrendEditRedirect() {
  return null;
}
