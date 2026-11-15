// app/routes/quick-style/_index.boundaries.test.ts
//
// Documents and verifies the three boundaries Five-Persona QA was asked to
// check for the legacy /quick-style guest funnel, without repointing the
// route or touching guest access — per explicit instruction. Source-text and
// cross-file assertions only, same convention as this codebase's other
// route-security tests (e.g. closet-image-security.test.ts) — no DOM, no
// live database, no network call.
//
// A. AUTH — /quick-style's own action never requires (or even reads) an
//    authenticated session; it writes only to an anonymous cookie and
//    redirects into a path that is documented to tolerate anonymous access
//    via a shared "guest" Customer row, not a hard auth wall.
// B. QUOTA — the funnel's eventual generation step enforces the SAME
//    fail-closed, atomic quota as every other caller, with guests
//    explicitly included at the NONE membership tier (0 allowance) — not an
//    open door, and not a guest-specific unfairness, since a real signed-up
//    non-member gets the identical 0.
// C. PRIVACY — the Step 5 "upload from your closet" UI never actually
//    transmits the selected image/category/color/tags to the server; the
//    only fields the real POST carries are mood/feeling/occasion/bodyNeeds/
//    source. The one server-side guest identity used (a single shared
//    "guest" Customer row) carries no real PII.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const quickStyleSrc = readFileSync(join(__dirname, "_index.tsx"), "utf8");
const resultSrc = readFileSync(join(__dirname, "..", "style-me", "result.tsx"), "utf8");
const entitlementSrc = readFileSync(join(__dirname, "..", "..", "lib", "plan", "entitlement.server.ts"), "utf8");
const planLimitsSrc = readFileSync(join(__dirname, "..", "..", "lib", "plan", "plan-limits.server.ts"), "utf8");

describe("A — /quick-style is genuinely auth-independent, not silently gated", () => {
  it("the route's action never imports or calls requireCurrentNaiaCustomer / getCurrentNaiaCustomer", () => {
    assert.ok(!quickStyleSrc.includes("requireCurrentNaiaCustomer"), "no hard auth gate in quick-style's own action");
    assert.ok(!quickStyleSrc.includes("getCurrentNaiaCustomer"), "no session-identity read in quick-style's own action either");
  });

  it("the action only ever touches an anonymous cookie session, never prisma.customer directly", () => {
    const actionStart = quickStyleSrc.indexOf("export async function action");
    const actionEnd = quickStyleSrc.indexOf("\nconst moodOpts");
    const actionSlice = quickStyleSrc.slice(actionStart, actionEnd);
    assert.ok(actionSlice.includes("getSession") && actionSlice.includes("commitSession"), "writes via the generic cookie session helpers");
    assert.ok(!actionSlice.includes("prisma."), "does not touch the database at all — purely a session write + redirect");
  });

  it("redirects to /style-me/result, which is documented to resolve an anonymous visitor to a shared guest row rather than redirecting to login", () => {
    assert.ok(quickStyleSrc.includes('redirect("/style-me/result"'), "quick-style hands off to the result route");
    assert.ok(
      resultSrc.includes('shopifyCustomerId: "guest"') && resultSrc.includes("unauthenticated visitors fall back to the"),
      "result.tsx's own comment documents the anonymous-guest fallback this depends on",
    );
    assert.ok(!resultSrc.slice(0, resultSrc.indexOf("const cookieSession = await getSession")).includes("throw redirect"),
      "no redirect-to-login/throwing auth check precedes the cookie-session read result.tsx uses for the quick-style continuation",
    );
  });
});

describe("B — quota is fail-closed and genuinely applies to guests, not an open door", () => {
  it("result.tsx resolves a NONE membershipStatus for a null naiaCustomer before checking quota", () => {
    assert.ok(
      resultSrc.includes('naiaCustomer?.membershipStatus ?? "NONE"'),
      "an anonymous visitor is explicitly typed as membershipStatus NONE for the quota check, not skipped",
    );
  });

  it("the quota reservation (reserveStyleMeSlot) runs unconditionally for every caller, with no guest-specific bypass branch", () => {
    const reserveCallSite = resultSrc.indexOf("await reserveStyleMeSlot(");
    assert.ok(reserveCallSite > -1, "reserveStyleMeSlot is actually called on this path");
    const before = resultSrc.slice(Math.max(0, reserveCallSite - 400), reserveCallSite);
    assert.ok(!before.includes("if (naiaCustomer)") && !before.includes("if (!naiaCustomer)"),
      "no conditional branch skips the reservation call based on auth state",
    );
  });

  it("reserveStyleMeSlot's own quota check is atomic (Serializable transaction + retry), closing the count-vs-create race for every caller including guests", () => {
    const fnStart = entitlementSrc.indexOf("export async function reserveStyleMeSlot");
    const fnSlice = entitlementSrc.slice(fnStart, fnStart + 2000);
    assert.ok(fnSlice.includes("_runTransaction") && fnSlice.includes("MAX_TX_RETRIES"), "transaction + retry present");
    assert.ok(fnSlice.includes("used >= effectiveLimit"), "count-then-compare happens inside the same transaction as the create");
  });

  it("the NONE tier's styleMePerMonth allowance is exactly 0 — identical for a guest and a real signed-up non-member, not a guest-specific penalty", () => {
    const noneTierMatch = planLimitsSrc.match(/NONE:\s*{[^}]*styleMePerMonth:\s*(\d+)/s);
    assert.ok(noneTierMatch, "NONE tier entry with styleMePerMonth found");
    assert.equal(noneTierMatch[1], "0", "NONE tier gets 0 StyleMe sessions/month — same figure applies regardless of guest vs. signed-in-free");
  });

  it("documents the practical consequence: a true guest completing /quick-style always receives the 429 sign-up prompt, never a generated result", () => {
    assert.ok(
      resultSrc.includes('"Sign in or join nAia to start styling."'),
      "the guest-specific quota-exceeded message exists, confirming this path is reachable and intentional, not dead code",
    );
    assert.ok(resultSrc.includes("status: 429"), "quota exhaustion returns a real 429, not a silent 200 or a crash");
  });
});

describe("C — privacy: the closet-upload UI in Step 5 is never actually transmitted", () => {
  it("the real POST body (hidden form fields) carries only mood/feeling/occasion/bodyNeeds/source — no image or item-detail field", () => {
    const formStart = quickStyleSrc.indexOf('<Form method="post"');
    const formEnd = quickStyleSrc.indexOf("</Form>");
    const formSlice = quickStyleSrc.slice(formStart, formEnd);
    const hiddenFieldNames = [...formSlice.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      hiddenFieldNames.sort(),
      ["bodyNeeds", "feeling", "mood", "occasion", "source"].sort(),
      "exactly these five fields are submitted — no image data, no category/color/tags field",
    );
  });

  it("uploadedItem (image + category + color + tags) is local React state only, read nowhere inside the Form", () => {
    assert.ok(quickStyleSrc.includes("const [uploadedItem, setUploadedItem]"), "uploadedItem is component state");
    const formStart = quickStyleSrc.indexOf('<Form method="post"');
    const formEnd = quickStyleSrc.indexOf("</Form>");
    const formSlice = quickStyleSrc.slice(formStart, formEnd);
    assert.ok(!formSlice.includes("uploadedItem"), "the uploaded item's data never appears inside the submitted form");
  });

  it("the uploaded image never leaves the browser — FileReader reads it to a local data: URL, nothing calls fetch/upload/cloudinary for it", () => {
    const handlerStart = quickStyleSrc.indexOf("const handleFileSelect");
    const handlerEnd = quickStyleSrc.indexOf("const toggleTag");
    const handlerSlice = quickStyleSrc.slice(handlerStart, handlerEnd);
    assert.ok(handlerSlice.includes("new FileReader()") && handlerSlice.includes("readAsDataURL"), "client-only FileReader path");
    assert.ok(!handlerSlice.includes("fetch(") && !handlerSlice.includes("cloudinary"), "no network call anywhere in the upload handler");
  });

  it("the one server-side guest identity used carries no real PII — a single synthetic row, not per-visitor data", () => {
    assert.ok(resultSrc.includes('email: "guest@naia.app"'), "the shared guest row's email is a synthetic placeholder, not collected from the visitor");
  });
});
