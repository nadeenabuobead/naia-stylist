// app/root.test.ts
//
// Root-level Layout/ErrorBoundary — the shared fallback for any uncaught
// loader/action/render error anywhere in the route tree (the live
// "Application Error" on /settings this closes, and React Router's default
// "Unexpected Server Error" for anything else). Source-string assertions,
// no DOM rendering harness in this codebase (same convention as
// MyNaiaLayout.test.ts, auth.signed-out.test.ts) — these prove the pieces
// are wired correctly, not a rendered snapshot.
//
// Run: node --test --import tsx/esm app/root.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "root.jsx"), "utf-8");

describe("root.jsx — ScrollToTop respects a navigation hash (2026-10-24)", () => {
  // Bug: ScrollToTop unconditionally called window.scrollTo(0, 0) on every
  // pathname change — this runs in a useEffect AFTER the DOM commits, so it
  // always won the race against any hash-anchor scroll (e.g. "View Saved
  // Looks" -> /style-me#your-styleme-looks) and silently cancelled it. This
  // affected every hash-carrying navigation in the app, not just that one.
  const fnBody = SRC.slice(SRC.indexOf("function ScrollToTop()"), SRC.indexOf("export function meta()"));

  it("reads hash from useLocation, not just pathname", () => {
    assert.match(fnBody, /const\s*\{\s*pathname,\s*hash\s*\}\s*=\s*useLocation\(\)/);
  });

  it("when a hash is present, scrolls the target element into view instead of forcing the top", () => {
    assert.match(fnBody, /if\s*\(hash\)/);
    assert.match(fnBody, /document\.getElementById\(hash\.slice\(1\)\)/);
    assert.match(fnBody, /scrollIntoView\(\)/);
  });

  it("still defaults to scrolling to the top for an ordinary navigation with no hash", () => {
    assert.match(fnBody, /window\.scrollTo\(0,\s*0\)/);
  });

  it("the effect re-runs on both pathname and hash changes", () => {
    const effectIdx = fnBody.indexOf("useEffect(");
    const depsBlock = fnBody.slice(effectIdx, effectIdx + 500);
    assert.match(depsBlock, /\[pathname,\s*hash\]/);
  });
});

describe("root.jsx — Layout wraps both the normal app and the ErrorBoundary", () => {
  it("exports a Layout component containing the full <html>/<head>/<body> document shell", () => {
    assert.match(SRC, /export\s+function\s+Layout\s*\(\s*\{\s*children\s*\}\s*\)/);
    const layoutBody = SRC.slice(SRC.indexOf("export function Layout"), SRC.indexOf("export default function App"));
    assert.match(layoutBody, /<html/);
    assert.match(layoutBody, /<head>/);
    assert.match(layoutBody, /<body>/);
    assert.match(layoutBody, /\{children\}/);
    assert.match(layoutBody, /<Scripts\s*\/>/);
  });

  it("the default App export is now a thin Outlet — the document shell moved to Layout, not duplicated", () => {
    const appBody = SRC.slice(SRC.indexOf("export default function App"), SRC.indexOf("export function ErrorBoundary"));
    assert.match(appBody, /<Outlet\s*\/>/);
    assert.ok(!appBody.includes("<html"), "App itself must not also render its own <html> — Layout already does");
  });

  it("exports an ErrorBoundary — the one shared boundary for the whole route tree, not duplicated per route", () => {
    assert.match(SRC, /export\s+function\s+ErrorBoundary\s*\(\s*\)/);
  });
});

describe("root.jsx — ErrorBoundary never exposes internal error detail", () => {
  const boundaryBody = SRC.slice(SRC.indexOf("export function ErrorBoundary"));

  it("reads the error via useRouteError but never renders error.message, error.stack, or the error object itself", () => {
    assert.match(boundaryBody, /useRouteError\(\)/);
    assert.ok(!boundaryBody.includes("error.message"), "must not render the raw error message");
    assert.ok(!boundaryBody.includes("error.stack"), "must not render a stack trace");
    assert.ok(!/\{error\}/.test(boundaryBody), "must not interpolate the raw error object into JSX");
  });

  it("contains no mention of Prisma, SQL, or database-specific language — the customer never sees that vocabulary", () => {
    assert.ok(!/prisma|P1001|P1002|P1008|P1017|sql|database/i.test(boundaryBody));
  });

  it("renders concise, branded copy: a heading and the specified recovery message", () => {
    assert.match(boundaryBody, /Something went wrong/);
    assert.match(boundaryBody, /We couldn't load this right now\. Please try again\./);
  });

  it("distinguishes a real 404 via isRouteErrorResponse, with its own distinct copy — not the same generic crash message", () => {
    assert.match(boundaryBody, /isRouteErrorResponse\(error\)/);
    assert.match(boundaryBody, /error\.status === 404/);
    assert.match(boundaryBody, /Page not found/);
  });

  it("TRY AGAIN safely reloads the current URL — the simplest, most reliable retry", () => {
    assert.match(boundaryBody, />\s*TRY AGAIN\s*</);
    const buttonBlock = boundaryBody.slice(boundaryBody.lastIndexOf("onClick", boundaryBody.indexOf("TRY AGAIN")));
    assert.match(buttonBlock, /window\.location\.reload\(\)/);
  });

  it("TRY AGAIN is hidden for the 404 case — reloading the same URL would just 404 again", () => {
    assert.match(boundaryBody, /\{!is404\s*&&/);
  });
});
