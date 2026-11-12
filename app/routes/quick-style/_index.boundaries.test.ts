// app/routes/quick-style/_index.boundaries.test.ts
//
// Documents and verifies the three boundaries Five-Persona QA was asked to
// check for the public /quick-style guest teaser, updated for the 2026-11-16
// approved product rewrite (ab06800): /quick-style is no longer a 5-step
// funnel that hands off into the paid, entitlement-checked StyleMe path. It
// is now three questions (mood, occasion, feeling) answered entirely in
// local React state, producing one deterministic insight computed by a pure
// lookup+template (app/lib/quick-style/insight.ts) — no loader, no action,
// no Form submission, no database write, no session cookie, no AI provider
// call, and no "upload from your closet" step at all. Source-text and
// cross-file assertions only, same convention as this codebase's other
// route-security tests (e.g. closet-image-security.test.ts) — no DOM, no
// live database, no network call.
//
// A. AUTH — the boundary that used to matter (does the route's own action
//    require/read an authenticated session?) no longer applies: the route
//    exports no loader and no action at all, so there is nothing server-side
//    to gate in the first place. Genuinely auth-independent, not silently
//    gated.
// B. QUOTA — the old funnel eventually handed off into /style-me/result,
//    where a true guest always hit the fail-closed NONE-tier (0 allowance)
//    quota check and got a 429 sign-up prompt. That hand-off is gone: this
//    route never calls reserveStyleMeSlot, never imports the entitlement
//    module, and never redirects into /style-me/result, so there is no quota
//    wall to hit at all — every visitor, guest or not, always gets the free
//    insight.
// C. PRIVACY — the old Step 5 "upload from your closet" UI staged a preview
//    in local state but never actually transmitted it to the server. That
//    whole step (and its image/category/color/tags state) is now removed
//    entirely, not merely non-transmitting. The only data this route ever
//    collects (mood/occasion/feeling) lives in this component's React state
//    and is discarded on navigation — nothing is written to a cookie,
//    nothing is sent to the server, nothing is persisted.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const quickStyleSrc = readFileSync(join(__dirname, "_index.tsx"), "utf8");
const insightSrc = readFileSync(join(__dirname, "..", "..", "lib", "quick-style", "insight.ts"), "utf8");

// The file's header comment deliberately *names* what it does NOT do (no DB,
// no AI provider, no upload, no /style-me/result hand-off, no 429) to
// document the design decision. Strip comment lines before asserting
// absence, so those explanatory mentions don't self-trigger — same
// convention as app/routes/quick-style/_index.test.ts.
const quickStyleCode = quickStyleSrc
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("A — /quick-style has no server-side surface left to gate", () => {
  it("exports no loader and no action at all — there is nothing for an auth check to wrap", () => {
    assert.ok(!quickStyleSrc.includes("export async function action"), "no action export");
    assert.ok(!quickStyleSrc.includes("export async function loader"), "no loader export");
    assert.ok(!quickStyleSrc.includes("export const action"), "no action export (const form)");
    assert.ok(!quickStyleSrc.includes("export const loader"), "no loader export (const form)");
  });

  it("never imports or calls requireCurrentNaiaCustomer / getCurrentNaiaCustomer — not even a hidden gate", () => {
    assert.ok(!quickStyleSrc.includes("requireCurrentNaiaCustomer"), "no hard auth gate anywhere in the route");
    assert.ok(!quickStyleSrc.includes("getCurrentNaiaCustomer"), "no session-identity read anywhere in the route");
  });

  it("never touches a cookie session or the database — the three answers live only in component state", () => {
    assert.ok(!quickStyleSrc.includes("getSession(") && !quickStyleSrc.includes("commitSession("), "no cookie-session read/write");
    assert.ok(!quickStyleSrc.includes("prisma."), "no database access of any kind");
    assert.ok(quickStyleSrc.includes("useState") && quickStyleSrc.includes("const [mood, setMood]"), "answers are local React state");
  });
});

describe("B — no quota wall exists on this path; the free insight is unconditional", () => {
  it("never redirects into /style-me/result, the route that carries the paid-StyleMe quota check", () => {
    assert.ok(!quickStyleCode.includes("/style-me/result"), "quick-style no longer hands off into the entitlement-checked StyleMe path");
  });

  it("never imports or calls the entitlement/reservation module that enforces the NONE-tier 0 allowance", () => {
    assert.ok(!quickStyleSrc.includes("reserveStyleMeSlot"), "no quota-reservation call");
    assert.ok(!quickStyleSrc.includes("entitlement.server"), "no import of the entitlement module");
  });

  it("documents the practical consequence: a true guest completing /quick-style always gets the free insight, never a 429", () => {
    assert.ok(!quickStyleCode.includes("429"), "no quota-exceeded status code appears on this path");
    assert.ok(
      quickStyleSrc.includes("no sign-up, no AI call, no cost") || quickStyleSrc.includes("Three quick questions, one free style direction"),
      "the route's own copy states this is free and unconditional",
    );
  });

  it("the deterministic insight builder is pure — no quota/session/AI dependency could reintroduce a hidden wall", () => {
    assert.ok(!insightSrc.includes("prisma"), "insight.ts has no database access");
    assert.ok(!insightSrc.includes("fetch("), "insight.ts makes no network call");
    assert.ok(!/anthropic|openai/i.test(insightSrc), "insight.ts has no AI provider reference");
  });
});

describe("C — privacy: the old closet-upload step is gone, not merely non-transmitting", () => {
  it("has no file-upload affordance anywhere — not a hidden one, not a staged-preview one", () => {
    assert.ok(!quickStyleCode.includes('type="file"'), "no file input");
    assert.ok(!quickStyleCode.includes("FileReader"), "no client-side image read");
    assert.ok(!quickStyleCode.includes("uploadedItem"), "no uploaded-item state of any kind");
    assert.ok(!/\bupload\b/i.test(quickStyleCode), "no upload affordance or reference at all");
  });

  it("collects only mood, occasion, and feeling — no image, category, color, or tags field exists to leak", () => {
    assert.ok(quickStyleSrc.includes("moodOpts") && quickStyleSrc.includes("occasionOpts") && quickStyleSrc.includes("feelingOpts"));
    assert.ok(!quickStyleCode.includes("bodyComfortOpts"), "no body-needs step carried over from the old funnel");
    assert.ok(!quickStyleCode.includes("sourceOpts"), "no source/closet-upload step carried over from the old funnel");
  });

  it("the three answers are never sent anywhere — no fetch, no Form submission, no network call in the whole route", () => {
    assert.ok(!quickStyleCode.includes("<Form"), "no form submission exists to carry the answers off-device");
    assert.ok(!quickStyleCode.includes("fetch("), "no network call anywhere in the route");
  });
});
