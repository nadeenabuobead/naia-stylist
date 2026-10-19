// app/routes/webhooks-privacy-config.test.ts
//
// Priority 4 follow-up (2026-10-19) — the three mandatory GDPR webhooks in
// shopify.app.toml were originally registered with `topics = [...]`, which
// is the WRONG field for this specific subscription kind: Shopify's current
// docs (shopify.dev/docs/apps/build/compliance/privacy-law-compliance) and
// its own MISSING_COMPLIANCE_WEBHOOKS app-review check both require
// `compliance_topics = [...]` for customers/data_request, customers/redact
// and shop/redact. An app using `topics` for these is treated by Shopify as
// NOT having subscribed to the mandatory compliance webhooks at all, even
// though the route exists and the local tests pass.
//
// Source-string assertion, same convention as the other *.test.ts files in
// this directory — no live Shopify call, no CLI, no network.
//
// Run: node --import tsx/esm --test app/routes/webhooks-privacy-config.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toml = readFileSync(join(__dirname, "../../shopify.app.toml"), "utf8");

const MANDATORY_TOPICS = ["customers/data_request", "customers/redact", "shop/redact"];

describe("shopify.app.toml — mandatory compliance webhooks use the correct field", () => {
  for (const topic of MANDATORY_TOPICS) {
    it(`${topic} is declared under compliance_topics, not topics`, () => {
      const complianceLine = `compliance_topics = [ "${topic}" ]`;
      assert.ok(
        toml.includes(complianceLine),
        `expected shopify.app.toml to contain: ${complianceLine}`,
      );

      // The wrong, pre-fix shape — fail loudly if it ever comes back.
      // Matched with a word boundary so "compliance_topics" (correct) never
      // false-positives as the plain "topics" (wrong) it ends with.
      const wrongLinePattern = new RegExp(`(?<!compliance_)topics = \\[ "${topic.replace("/", "\\/")}" \\]`);
      assert.ok(
        !wrongLinePattern.test(toml),
        `${topic} must not be declared under plain "topics" — Shopify requires "compliance_topics" for mandatory privacy webhooks`,
      );
    });
  }

  it("every mandatory topic still has a matching uri pointing at a registered route", () => {
    assert.ok(toml.includes('uri = "/webhooks/customers/data_request"'));
    assert.ok(toml.includes('uri = "/webhooks/customers/redact"'));
    assert.ok(toml.includes('uri = "/webhooks/shop/redact"'));
  });
});
