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
// PL-08  getEffectiveVtoLimit FREE without override = 1
// PL-09  getEffectiveVtoLimit PAID without override = 10
// PL-10  VTO_MONTHLY_LIMIT_OVERRIDE=20 overrides limit for both plans
// PL-11  invalid or empty VTO_MONTHLY_LIMIT_OVERRIDE falls back to plan limit
// PL-12  getEffectiveStyleMeLimit FREE without override = 1
// PL-13  getEffectiveStyleMeLimit PAID without override = 8
// PL-14  STYLEME_MONTHLY_LIMIT_OVERRIDE=100 overrides limit for both plans
// PL-15  invalid STYLEME_MONTHLY_LIMIT_OVERRIDE falls back to plan limit

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getLimits, getEffectiveVtoLimit, getEffectiveStyleMeLimit } from "./plan-limits.server";

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
    assert.equal(p.vtoPerMonth, 10);
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

  it("PL-08 getEffectiveVtoLimit FREE without override equals plan vtoPerMonth (1)", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveVtoLimit("FREE"), 1);
    } finally {
      if (prev !== undefined) process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-09 getEffectiveVtoLimit PAID without override equals plan vtoPerMonth (10)", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveVtoLimit("PAID"), 10);
    } finally {
      if (prev !== undefined) process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-10 VTO_MONTHLY_LIMIT_OVERRIDE=20 overrides limit for both plans", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    process.env.VTO_MONTHLY_LIMIT_OVERRIDE = "20";
    try {
      assert.equal(getEffectiveVtoLimit("FREE"), 20);
      assert.equal(getEffectiveVtoLimit("PAID"), 20);
    } finally {
      if (prev === undefined) delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
      else process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-11 invalid VTO_MONTHLY_LIMIT_OVERRIDE falls back to plan limit", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    process.env.VTO_MONTHLY_LIMIT_OVERRIDE = "not-a-number";
    try {
      assert.equal(getEffectiveVtoLimit("FREE"), 1);
      assert.equal(getEffectiveVtoLimit("PAID"), 10);
    } finally {
      if (prev === undefined) delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
      else process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-12 getEffectiveStyleMeLimit FREE without override equals plan styleMePerMonth (1)", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveStyleMeLimit("FREE"), 1);
    } finally {
      if (prev !== undefined) process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-13 getEffectiveStyleMeLimit PAID without override equals plan styleMePerMonth (8)", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveStyleMeLimit("PAID"), 8);
    } finally {
      if (prev !== undefined) process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-14 STYLEME_MONTHLY_LIMIT_OVERRIDE=100 overrides limit for both plans", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = "100";
    try {
      assert.equal(getEffectiveStyleMeLimit("FREE"), 100);
      assert.equal(getEffectiveStyleMeLimit("PAID"), 100);
    } finally {
      if (prev === undefined) delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
      else process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-15 invalid STYLEME_MONTHLY_LIMIT_OVERRIDE falls back to plan limit", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = "not-a-number";
    try {
      assert.equal(getEffectiveStyleMeLimit("FREE"), 1);
      assert.equal(getEffectiveStyleMeLimit("PAID"), 8);
    } finally {
      if (prev === undefined) delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
      else process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });
});
