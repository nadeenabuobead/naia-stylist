// app/lib/closet-card-colors.test.ts
//
// Regression test for the Digital Closet multi-colour card display bug:
// multi-colour persistence (colors[]) was working, but the customer-facing
// card still rendered only primaryColor ("BLACK · GEOMETRIC" instead of
// "BLACK · BEIGE · PINK · GEOMETRIC").

import { test } from "node:test";
import assert from "node:assert/strict";
import { closetCardMetaLine, displayColors } from "./closet-card-colors";

test("displayColors — multi-colour item displays all selected colours in selected order", () => {
  const item = { colors: ["BLACK", "BEIGE", "PINK"], primaryColor: "BLACK" };
  assert.deepEqual(displayColors(item), ["BLACK", "BEIGE", "PINK"]);
});

test("closet card meta line — exact bug scenario: colors=[BLACK,BEIGE,PINK], primaryColor=BLACK", () => {
  const item = { colors: ["BLACK", "BEIGE", "PINK"], primaryColor: "BLACK", pattern: null };
  assert.equal(closetCardMetaLine(item), "BLACK · BEIGE · PINK");
});

test("closet card meta line — colours followed by pattern, as rendered on the card", () => {
  const item = { colors: ["BLACK", "BEIGE", "PINK"], primaryColor: "BLACK", pattern: "GEOMETRIC" };
  assert.equal(closetCardMetaLine(item), "BLACK · BEIGE · PINK · GEOMETRIC");
});

test("displayColors — primary/first-selected colour stays first even if not alphabetically or chromatically first", () => {
  const item = { colors: ["PINK", "BLACK", "BEIGE"], primaryColor: "PINK" };
  assert.deepEqual(displayColors(item), ["PINK", "BLACK", "BEIGE"]);
});

test("displayColors — legacy row with empty colors[] falls back to primaryColor", () => {
  const item = { colors: [], primaryColor: "NAVY" };
  assert.deepEqual(displayColors(item), ["NAVY"]);
});

test("displayColors — legacy row with colors undefined falls back to primaryColor", () => {
  const item = { primaryColor: "NAVY" };
  assert.deepEqual(displayColors(item), ["NAVY"]);
});

test("displayColors — no colour data at all returns empty array", () => {
  const item = { colors: [], primaryColor: null };
  assert.deepEqual(displayColors(item), []);
});

test("closet card meta line — single legacy colour plus pattern matches the pre-fix single-colour format", () => {
  const item = { colors: [], primaryColor: "BLACK", pattern: "GEOMETRIC" };
  assert.equal(closetCardMetaLine(item), "BLACK · GEOMETRIC");
});
