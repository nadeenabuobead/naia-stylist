// app/routes/style-me/handoff-route-registration.test.ts
//
// The NADINE PDP "Style Me" button posted into a 404.
//
// app/routes/api.styleme-handoff.tsx has existed, complete and origin-guarded, the whole
// time — it was simply never added to app/routes.ts, so React Router never knew about it.
// Confirmed live against production before this fix:
//
//   GET https://naia-stylist.vercel.app/api/styleme-handoff   ->  404
//
// and the storefront block posts to exactly that path:
//
//   extensions/naia-storefront/assets/naia-product-block.js
//     form.action = appUrl + "/api/styleme-handoff";
//     form.method = "POST";
//
// So every customer who tapped "Style Me" on a NADINE product page got nothing. This is
// registration only — the handoff's own logic, its origin guard and its handle allowlist
// are untouched.
//
// The load-bearing assertion is HR-A.4: the path the storefront posts to and the path
// routes.ts registers are compared to each other, not each checked in isolation. That is
// the drift that produced the bug, and checking only one side would not have caught it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

const ROUTES = "app/routes.ts";
const ROUTE_FILE = "app/routes/api.styleme-handoff.tsx";
const PDP_JS = "extensions/naia-storefront/assets/naia-product-block.js";

/** Every route("<path>", "<file>") pair declared in routes.ts. */
function registeredRoutes(): Array<{ path: string; file: string }> {
  const out: Array<{ path: string; file: string }> = [];
  const re = /route\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  const src = read(ROUTES);
  while ((m = re.exec(src)) !== null) out.push({ path: m[1], file: m[2] });
  return out;
}

describe("HR-A — the PDP handoff route is reachable", () => {
  test("HR-A.1 routes.ts registers api/styleme-handoff", () => {
    const hit = registeredRoutes().find((r) => r.path === "api/styleme-handoff");
    assert.ok(hit, "unregistered means every PDP 'Style Me' tap is a 404");
    assert.equal(hit!.file, "routes/api.styleme-handoff.tsx");
  });

  test("HR-A.2 the route module exists and exports an action", () => {
    assert.ok(existsSync(join(process.cwd(), ROUTE_FILE)), `${ROUTE_FILE} must exist`);
    assert.match(read(ROUTE_FILE), /export async function action\(/);
  });

  test("HR-A.3 it stays POST-only — no loader to answer a GET", () => {
    // A loader would make a drive-by GET succeed; the handoff mutates session state.
    assert.doesNotMatch(read(ROUTE_FILE), /export async function loader\(/,
      "a GET must not be able to drive this route");
  });

  test("HR-A.4 the storefront posts to exactly the path routes.ts registers", () => {
    const js = read(PDP_JS);
    const m = /form\.action\s*=\s*appUrl\s*\+\s*"([^"]+)"/.exec(js);
    assert.ok(m, "the PDP block must build its form action from a literal path");
    const posted = m![1].replace(/^\//, "");
    const paths = registeredRoutes().map((r) => r.path);
    assert.ok(
      paths.includes(posted),
      `the PDP posts to "/${posted}" but routes.ts registers no such path — this exact ` +
        `drift is the bug: the route file existed and the button still 404'd`,
    );
    assert.match(js, /form\.method\s*=\s*"POST"/);
  });

  test("HR-A.5 the origin guard and allowlist are untouched", () => {
    const src = read(ROUTE_FILE);
    // 2026-11-17 — the single hardcoded-origin `!==` check was replaced by
    // a narrow, shared allowlist (isAllowedHandoffOrigin) covering
    // production + the documented staging test store; see
    // app/lib/styleme/handoff.ts and api.styleme-handoff.origin.test.ts for
    // the actual fail-closed behavior, exercised against real Requests.
    assert.match(src, /isAllowedHandoffOrigin/, "must use the shared origin allowlist helper");
    assert.match(src, /status: 403/, "a foreign origin must still be refused");
    assert.match(src, /isValidNadineHandle|HANDOFF_RESOLVABLE_HANDLES/,
      "the handle allowlist must still gate what can anchor");
  });
});

describe("HR-B — no storefront POST target is left unregistered", () => {
  test("HR-B.1 every app path the storefront blocks post to is registered", () => {
    const paths = new Set(registeredRoutes().map((r) => r.path));
    const js = read(PDP_JS);
    const targets = [...js.matchAll(/appUrl\s*\+\s*"(\/[A-Za-z0-9/_-]+)"/g)].map((m) =>
      m[1].replace(/^\//, ""),
    );
    assert.ok(targets.length > 0, "expected at least the handoff target");
    for (const t of new Set(targets)) {
      assert.ok(paths.has(t), `storefront posts to "/${t}" which routes.ts does not register`);
    }
  });
});
