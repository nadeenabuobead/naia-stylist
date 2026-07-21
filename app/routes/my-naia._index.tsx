import naiaStyles from "~/styles/naia-design-system.css?url";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import DevFixtureNotice from "~/components/my-naia/DevFixtureNotice";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCurrentNaiaCustomer(request);
  return { isDev: process.env.NODE_ENV !== "production" };
}

/*
 * Overview dashboard — Lovable desktop design supplied and approved.
 * Full 9-section dashboard implementation is Package 2.
 * Existing feature routes are unchanged (Lovable process designs not yet supplied).
 */
export default function MyNaiaOverview() {
  const { isDev } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout currentPath="/my-naia">
      <DevFixtureNotice show={isDev} />
      <div className="mn-overview-placeholder">
        <p className="mn-page-intro-eyebrow">MY nAia</p>
        <h1 className="mn-page-intro-heading">Your personal style space.</h1>
        <p className="mn-page-intro-body">
          Use the navigation to access your features.
        </p>
        <p className="mn-feature-note">
          Existing functionality retained — Lovable process design not yet supplied.
        </p>
      </div>
    </MyNaiaLayout>
  );
}
