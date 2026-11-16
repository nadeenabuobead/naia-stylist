// app/routes/quick-style/_index.test.ts
//
// Regression coverage for the 2026-11-16 guest-teaser rewrite of /quick-style.
// Source-text assertions, same convention as this codebase's other route
// boundary tests (e.g. closet-image-security.test.ts) — no DOM, no live
// database, no network call.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const quickStyleSrc = readFileSync(join(__dirname, "_index.tsx"), "utf8");

// The file's header comment deliberately *names* what it does NOT do (no DB,
// no AI provider, no upload) to document the design decision. Strip comments
// before asserting absence, so those explanatory mentions don't self-trigger.
const quickStyleCode = quickStyleSrc
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("quick-style is a self-contained, free guest teaser", () => {
  it("exports no loader and no action — nothing here calls the server", () => {
    assert.ok(!quickStyleSrc.includes("export async function action"), "no action export");
    assert.ok(!quickStyleSrc.includes("export async function loader"), "no loader export");
    assert.ok(!quickStyleSrc.includes("export const action"), "no action export (const form)");
    assert.ok(!quickStyleSrc.includes("export const loader"), "no loader export (const form)");
  });

  it("never touches the database, a cookie session, or the entitlement-checked StyleMe path", () => {
    assert.ok(!quickStyleCode.includes("prisma"), "no database access");
    assert.ok(!quickStyleCode.includes("session.server"), "no session-cookie write");
    assert.ok(!quickStyleCode.includes("/style-me/result"), "never hands off into the paid StyleMe path");
    assert.ok(!quickStyleCode.includes("getCurrentNaiaCustomer"), "no customer-identity read");
  });

  it("never calls a network endpoint or an AI provider", () => {
    assert.ok(!quickStyleCode.includes("fetch("), "no network calls");
    assert.ok(!/anthropic|openai/i.test(quickStyleCode), "no AI provider reference");
  });

  it("has no file-upload step — the nonfunctional closet-upload UI is gone", () => {
    assert.ok(!quickStyleCode.includes('type="file"'), "no file input");
    assert.ok(!quickStyleCode.includes("FileReader"), "no client-side image read");
    assert.ok(!quickStyleCode.includes("upload"), "no upload affordance at all");
  });

  it("reduces to exactly three questions (mood, occasion, feeling)", () => {
    assert.ok(quickStyleSrc.includes("moodOpts"), "asks mood");
    assert.ok(quickStyleSrc.includes("occasionOpts"), "asks occasion");
    assert.ok(quickStyleSrc.includes("feelingOpts"), "asks desired feeling");
    assert.ok(!quickStyleSrc.includes("bodyComfortOpts"), "no body-needs step");
    assert.ok(!quickStyleSrc.includes("sourceOpts"), "no source/closet-upload step");
  });

  it("computes its insight from the deterministic local lib, not an inline template with AI", () => {
    assert.ok(quickStyleSrc.includes("buildStyleDirection"), "uses the shared deterministic insight builder");
    assert.ok(quickStyleSrc.includes("~/lib/quick-style/insight"), "imports from the pure insight module");
  });

  it("clearly states that full AI styling requires nAia Membership", () => {
    assert.ok(/nAia Membership/.test(quickStyleSrc), "names nAia Membership");
    assert.ok(/full AI styling|full styled look/i.test(quickStyleSrc), "distinguishes the teaser from full styling");
    assert.ok(quickStyleSrc.includes("/my-naia/plan-usage"), "links to the membership page");
  });

  it("does not call alert() — matches the rest of the customer app's inline-error convention", () => {
    assert.ok(!quickStyleSrc.includes("alert("));
  });

  it("stays marked non-canonical, per app/routes/style-me/nadine-handoff-rev3.test.ts", () => {
    assert.ok(quickStyleSrc.includes("NOT CANONICAL STYLEME"));
  });

  it("question pills are real <button> elements (keyboard/screen-reader accessible), not bare <div onClick>", () => {
    assert.ok(!/<div[^>]*className="pill"/.test(quickStyleSrc), "no non-interactive div used as a selectable pill");
    assert.ok(quickStyleSrc.includes('aria-pressed'), "selection state is exposed to assistive tech");
  });
});
