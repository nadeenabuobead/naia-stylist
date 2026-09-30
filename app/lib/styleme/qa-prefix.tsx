// app/lib/styleme/qa-prefix.tsx
//
// QA front-door harness for manual testing of the reconciled StyleMe build through
// nadine-storefront.vercel.app, where the customer's Shopify session cookie lives.
//
// WHAT THIS IS NOT. It contains no recommendation logic, no scoring, no vocabulary
// and no copy. Every /style-me-qa/* route re-exports the real loader, action and
// component from its /style-me/* counterpart. This file only rewrites *paths*, so
// the flow stays inside the QA prefix instead of escaping to the live build after
// the first navigation.
//
// WHY IT IS NEEDED. The real routes emit absolute "/style-me/..." paths in ~80
// places — redirects, Link targets, Back buttons. A path-stripping proxy rewrite
// alone would render the first page correctly and then send the browser to
// nadine-storefront.vercel.app/style-me/..., which the storefront already proxies
// to the LIVE staging build. The customer would silently fall out of the QA build
// mid-questionnaire and QA would be testing the wrong code.
//
// Two mechanisms, both path-only:
//   server — wrapLoader / wrapAction rewrite the Location header of any redirect
//            the real loader or action returns or throws.
//   client — QaNav intercepts clicks in the capture phase and re-points in-app
//            navigation that targets /style-me/... at /style-me-qa/... instead.
//
// DELETE THIS FILE, ITS ROUTES AND ITS ROUTE REGISTRATIONS when QA is finished.
// Nothing in the product depends on it.

import { useNavigate } from "react-router";
import type { ReactNode } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export const QA_PREFIX = "/style-me-qa";
const REAL_PREFIX = "/style-me";

/**
 * Maps a real StyleMe path onto the QA prefix.
 * Anything outside /style-me is returned untouched — /my-naia, /closet and
 * /auth must keep pointing at their real destinations.
 */
export function toQaPath(path: string): string {
  if (path === REAL_PREFIX) return QA_PREFIX;
  if (path.startsWith(`${REAL_PREFIX}/`)) return QA_PREFIX + path.slice(REAL_PREFIX.length);
  return path;
}

/** True when a redirect Location points at the real StyleMe flow and should be re-prefixed. */
function isStyleMeLocation(loc: string | null): loc is string {
  if (!loc) return false;
  // Absolute URLs (the Shopify login hop) are left alone — only same-origin app paths move.
  if (!loc.startsWith("/")) return false;
  return loc === REAL_PREFIX || loc.startsWith(`${REAL_PREFIX}/`);
}

/**
 * Returns the same Response with its Location re-prefixed when it points into
 * /style-me. Headers on a Response from `redirect()` are mutable, but a thrown
 * Response may be frozen, so a fresh Response is constructed rather than mutated.
 */
function rewriteRedirect(res: Response): Response {
  const loc = res.headers.get("Location");
  if (!isStyleMeLocation(loc)) return res;
  const headers = new Headers(res.headers);
  headers.set("Location", toQaPath(loc));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

type AnyLoader = (args: LoaderFunctionArgs) => unknown | Promise<unknown>;
type AnyAction = (args: ActionFunctionArgs) => unknown | Promise<unknown>;

/**
 * Wraps a real loader so redirects land inside the QA prefix.
 * Non-Response return values (the normal `data()` payload) pass through untouched,
 * so the component receives exactly what it would on the real route.
 */
export function wrapLoader(real: AnyLoader): AnyLoader {
  return async (args: LoaderFunctionArgs) => {
    try {
      const result = await real(args);
      return result instanceof Response ? rewriteRedirect(result) : result;
    } catch (thrown) {
      // React Router signals redirects and 404s by throwing a Response.
      if (thrown instanceof Response) throw rewriteRedirect(thrown);
      throw thrown;
    }
  };
}

/** Same contract as wrapLoader, for actions. */
export function wrapAction(real: AnyAction): AnyAction {
  return async (args: ActionFunctionArgs) => {
    try {
      const result = await real(args);
      return result instanceof Response ? rewriteRedirect(result) : result;
    } catch (thrown) {
      if (thrown instanceof Response) throw rewriteRedirect(thrown);
      throw thrown;
    }
  };
}

/**
 * Keeps client-side navigation inside the QA prefix.
 *
 * The real components render <Link to="/style-me/...">, which React Router turns
 * into an anchor plus its own click handler. Listening in the CAPTURE phase means
 * this runs before that handler, so preventDefault + stopPropagation wins and the
 * navigation goes where QA needs it. Anything that is not an in-app /style-me link
 * — modified clicks, new tabs, /my-naia, /closet, external URLs — is left alone.
 */
export function QaNav({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  function onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;                                   // not a primary click
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // open-in-new-tab etc.

    const anchor = (event.target as HTMLElement | null)?.closest?.("a");
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;

    const href = anchor.getAttribute("href");
    if (!isStyleMeLocation(href)) return;

    event.preventDefault();
    event.stopPropagation();
    navigate(toQaPath(href));
  }

  return <div onClickCapture={onClickCapture}>{children}</div>;
}
