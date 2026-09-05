// app/lib/plan/plan-limits.test.ts
// Tests for the central plan limits contract.
//
// PL-01  FREE limits match spec
// PL-02  PAID limits match spec
// PL-03  getLimits returns the correct object for each plan
// PL-04  FREE has welcomeStyleMe = true, PAID has welcomeStyleMe = false
// PL-05  FREE has buySkipIntroLifetime = true, PAID has buySkipIntroLifetime = false
// PL-06  FREE has buySkipPerMonth = 0 (no recurring monthly), PAID has 5
// PL-07  publicTrendReports is true for both plans

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getLimits } from "./plan-limits.server";

describe("plan-limits", () => {
  it("PL-01 FREE limits match spec", () => {
    const f = getLimits("FREE");
    assert.equal(f.closetItems, 50);
    assert.equal(f.styleMePerMonth, 1);
    assert.equal(f.vtoPerMonth, 1);
    assert.equal(f.personalisedTrendPerMonth, 0);
  });

  it("PL-02 PAID limits match spec", () => {
    const p = getLimits("PAID");
    assert.equal(p.closetItems, 250);
    assert.equal(p.styleMePerMonth, 8);
    assert.equal(p.buySkipPerMonth, 5);
    assert.equal(p.vtoPerMonth, 3);
    assert.equal(p.personalisedTrendPerMonth, 1);
  });

  it("PL-03 getLimits returns correct object for each plan", () => {
    assert.notDeepEqual(getLimits("FREE"), getLimits("PAID"));
    assert.deepEqual(getLimits("FREE"), getLimits("FREE"));
  });

  it("PL-04 welcome StyleMe is FREE-only", () => {
    assert.equal(getLimits("FREE").welcomeStyleMe, true);
    assert.equal(getLimits("PAID").welcomeStyleMe, false);
  });

  it("PL-05 lifetime intro BuySkip is FREE-only", () => {
    assert.equal(getLimits("FREE").buySkipIntroLifetime, true);
    assert.equal(getLimits("PAID").buySkipIntroLifetime, false);
  });

  it("PL-06 FREE has no recurring monthly BuySkip, PAID has 5", () => {
    assert.equal(getLimits("FREE").buySkipPerMonth, 0);
    assert.equal(getLimits("PAID").buySkipPerMonth, 5);
  });

  it("PL-07 publicTrendReports is true for both plans", () => {
    assert.equal(getLimits("FREE").publicTrendReports, true);
    assert.equal(getLimits("PAID").publicTrendReports, true);
  });
});
