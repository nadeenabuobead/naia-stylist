import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteError, isRouteErrorResponse, useLoaderData } from "react-router";
import { useEffect } from "react";
import { rootAuthLoader, clerkMiddleware } from "@clerk/react-router/server";
import { ClerkProvider } from "@clerk/react-router";

// Clerk (2026-11-04) — makes the signed-in/signed-out state available to
// every route's own loader via context, and to client components
// (ClerkProvider below) via loaderData. Every other existing loader in the
// app is untouched; this wraps the root loader only.
//
// rootAuthLoader requires clerkMiddleware() to have populated the request
// context first (see react-router.config.ts's future.v8_middleware flag,
// required for route middleware to run at all) — without it, every request
// throws "Clerk: clerkMiddleware() not detected" here.
export const middleware = [clerkMiddleware()];

export async function loader(args) {
  return rootAuthLoader(args);
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  // 2026-10-24: a navigation carrying a hash (e.g. "View Saved Looks" ->
  // /style-me#your-styleme-looks) must land on that section, not the top of
  // the page. This effect runs after the DOM commits, so an unconditional
  // scrollTo(0,0) here always wins the race against the browser's own
  // hash-scroll and silently cancels it — every anchor-link navigation in the
  // app was affected, not just this one. Scroll to the hash target instead
  // when one is present; only default to the top when there isn't.
  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export function meta() {
  return [{ title: "nAia" }];
}

// Exported separately from the default App component (rather than inlined
// in one function) so the full <html>/<head>/<body> document shell is
// guaranteed to wrap BOTH the normal route tree and the ErrorBoundary below
// — React Router's documented pattern for this. Without it, an error
// bubbling up from deep in the route tree would leave the ErrorBoundary
// with no document shell to render into.
export function Layout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* frame-ancestors moved to a real Content-Security-Policy response
            header (app/entry.server.jsx) -- the CSP spec defines
            frame-ancestors as ignored when delivered via <meta>, so this
            never actually enforced anything in any spec-compliant browser. */}
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Oswald:wght@200;300;400;500;700&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&display=fallback"
        />
        <style suppressHydrationWarning>{`
          :root {
            --c-bg:       #F6EFE8;
            --c-surface:  #FAF6F1;
            --c-panel:    rgba(252,249,245,0.76);
            --c-ink:      #28150C;
            --c-muted:    #64544C;
            --c-burg:     #6B1D26;
            --c-taupe:    #E3D4C9;
            --c-muted-bg: #EBE3DB;
            --c-border:   #CEC1B8;
            --c-error:    #831922;
            --c-tint:     rgba(107,29,38,0.08);
            --c-tint-med: rgba(107,29,38,0.2);
            --ff-display:   'Oswald', 'Arial Narrow', sans-serif;
            --ff-editorial: 'Cormorant Garamond', Georgia, serif;
            --ff-body:      'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            --ff-ui:        'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          }
        `}</style>
        <Meta />
        <Links />
        <script
          async
          src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js"
          integrity="sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg=="
          crossOrigin="anonymous"
        ></script>
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `(function(){document.cookie='naia_customer_data=; path=/; max-age=0; SameSite=Lax';try{sessionStorage.removeItem('naia_token');}catch(e){}if(window.self!==window.top){document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href&&a.href.startsWith(window.location.origin)){e.preventDefault();window.location.href=a.href;}});}})();` }} />
        <ScrollToTop />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const loaderData = useLoaderData();
  return (
    <ClerkProvider loaderData={loaderData}>
      <Outlet />
    </ClerkProvider>
  );
}

// Root-level ErrorBoundary — catches any uncaught loader/action/render
// error from anywhere in the route tree that doesn't have its own more
// specific boundary. This is deliberately the ONE shared boundary for the
// whole app rather than one per route.
//
// Never renders error.message, error.stack, a Prisma error, or any
// internal ID — a transient database outage (the proven live case this was
// added for) and any other unexpected exception both get the exact same
// generic, branded copy. TRY AGAIN does a full page reload of the current
// URL — the simplest, most reliable retry: it re-runs every loader fresh,
// including whatever failed the first time.
export function ErrorBoundary() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;

  const heading = is404 ? "Page not found" : "Something went wrong";
  const message = is404
    ? "This page doesn't exist."
    : "We couldn't load this right now. Please try again.";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        textAlign: "center",
        fontFamily: "var(--ff-body)",
        background: "var(--c-bg)",
        color: "var(--c-ink)",
      }}
    >
      <div>
        <p style={{ fontFamily: "var(--ff-display)", fontSize: "1.1rem", fontWeight: 600, opacity: 0.85, margin: "0 0 8px" }}>
          {heading}
        </p>
        <p style={{ fontSize: "0.95rem", opacity: 0.7, margin: "0 0 28px" }}>
          {message}
        </p>
        {!is404 && (
          <button
            type="button"
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            style={{
              fontFamily: "var(--ff-ui)",
              fontSize: "0.85rem",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "var(--c-burg)",
              background: "transparent",
              border: "1px solid var(--c-burg)",
              borderRadius: "999px",
              padding: "11px 28px",
              cursor: "pointer",
            }}
          >
            TRY AGAIN
          </button>
        )}
      </div>
    </div>
  );
}
