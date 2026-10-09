// app/lib/customer-name-display.test.ts
// Run: node --test --import tsx/esm app/lib/customer-name-display.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conciseFamilyName } from "./customer-name-display.ts";

describe("conciseFamilyName()", () => {
  it("drops bare single-letter initials — the real staging case: 'W M Abuobead' → 'Abuobead'", () => {
    assert.equal(conciseFamilyName("W M Abuobead"), "Abuobead");
  });

  it("drops a single initial with a trailing period", () => {
    assert.equal(conciseFamilyName("M. Abuobead"), "Abuobead");
  });

  it("never touches a genuine multi-word surname — no word is a bare initial", () => {
    assert.equal(conciseFamilyName("Abu Obead"), "Abu Obead");
  });

  it("never touches a genuine multi-word surname with three real words", () => {
    assert.equal(conciseFamilyName("Van Der Berg"), "Van Der Berg");
  });

  it("leaves a plain single-word surname untouched", () => {
    assert.equal(conciseFamilyName("Abuobead"), "Abuobead");
  });

  it("falls back to the original string rather than erasing everything, if every word is a bare initial", () => {
    assert.equal(conciseFamilyName("W M"), "W M");
  });

  it("returns null for null input", () => {
    assert.equal(conciseFamilyName(null), null);
  });

  it("returns null for an empty string", () => {
    assert.equal(conciseFamilyName(""), null);
  });

  it("collapses irregular whitespace between words", () => {
    assert.equal(conciseFamilyName("  W   M   Abuobead "), "Abuobead");
  });
});
