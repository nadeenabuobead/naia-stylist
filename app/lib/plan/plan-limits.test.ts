// app/lib/plan/plan-limits.test.ts
// Tests for the central membership allowances contract.
//
// PL-01  NONE limits are all zero
// PL-02  MEMBER limits match spec (closet 250, styleMe 8, buySkip 5, vto 10, trend 1)
// PL-03  getMembershipAllowances returns distinct objects for NONE and MEMBER
// PL-08  getEffectiveVtoLimit NONE without override = 0
// PL-09  getEffectiveVtoLimit MEMBER without override = 10
// PL-10  VTO_MONTHLY_LIMIT_OVERRIDE=20 overrides limit for NONE and MEMBER
// PL-11  invalid or empty VTO_MONTHLY_LIMIT_OVERRIDE falls back to membership limit
// PL-12  getEffectiveStyleMeLimit NONE without override = 0
// PL-13  getEffectiveStyleMeLimit MEMBER without override = 8
// PL-14  STYLEME_MONTHLY_LIMIT_OVERRIDE=100 overrides limit for NONE and MEMBER
// PL-15  invalid STYLEME_MONTHLY_LIMIT_OVERRIDE falls back to membership limit

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getMembershipAllowances, getEffectiveVtoLimit, getEffectiveStyleMeLimit } from "./plan-limits.server";

describe("plan-limits", () => {
  it("PL-01 NONE limits are all zero", () => {
    const n = getMembershipAllowances("NONE");
    assert.equal(n.closetItems, 0);
    assert.equal(n.styleMePerMonth, 0);
    assert.equal(n.buySkipPerMonth, 0);
    assert.equal(n.vtoPerMonth, 0);
    assert.equal(n.personalisedTrendPerMonth, 0);
  });

  it("PL-02 MEMBER limits match spec", () => {
    const m = getMembershipAllowances("MEMBER");
    assert.equal(m.closetItems, 250);
    assert.equal(m.styleMePerMonth, 8);
    assert.equal(m.buySkipPerMonth, 5);
    assert.equal(m.vtoPerMonth, 10);
    assert.equal(m.personalisedTrendPerMonth, 1);
  });

  it("PL-03 getMembershipAllowances returns distinct objects for NONE and MEMBER", () => {
    assert.notDeepEqual(getMembershipAllowances("NONE"), getMembershipAllowances("MEMBER"));
    assert.deepEqual(getMembershipAllowances("NONE"), getMembershipAllowances("NONE"));
  });

  it("PL-08 getEffectiveVtoLimit NONE without override equals vtoPerMonth (0)", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveVtoLimit("NONE"), 0);
    } finally {
      if (prev !== undefined) process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-09 getEffectiveVtoLimit MEMBER without override equals vtoPerMonth (10)", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveVtoLimit("MEMBER"), 10);
    } finally {
      if (prev !== undefined) process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-10 VTO_MONTHLY_LIMIT_OVERRIDE=20 overrides limit for NONE and MEMBER", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    process.env.VTO_MONTHLY_LIMIT_OVERRIDE = "20";
    try {
      assert.equal(getEffectiveVtoLimit("NONE"), 20);
      assert.equal(getEffectiveVtoLimit("MEMBER"), 20);
    } finally {
      if (prev === undefined) delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
      else process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-11 invalid VTO_MONTHLY_LIMIT_OVERRIDE falls back to membership limit", () => {
    const prev = process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    process.env.VTO_MONTHLY_LIMIT_OVERRIDE = "not-a-number";
    try {
      assert.equal(getEffectiveVtoLimit("NONE"), 0);
      assert.equal(getEffectiveVtoLimit("MEMBER"), 10);
    } finally {
      if (prev === undefined) delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
      else process.env.VTO_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-12 getEffectiveStyleMeLimit NONE without override equals styleMePerMonth (0)", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveStyleMeLimit("NONE"), 0);
    } finally {
      if (prev !== undefined) process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-13 getEffectiveStyleMeLimit MEMBER without override equals styleMePerMonth (8)", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    try {
      assert.equal(getEffectiveStyleMeLimit("MEMBER"), 8);
    } finally {
      if (prev !== undefined) process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-14 STYLEME_MONTHLY_LIMIT_OVERRIDE=100 overrides limit for NONE and MEMBER", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = "100";
    try {
      assert.equal(getEffectiveStyleMeLimit("NONE"), 100);
      assert.equal(getEffectiveStyleMeLimit("MEMBER"), 100);
    } finally {
      if (prev === undefined) delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
      else process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });

  it("PL-15 invalid STYLEME_MONTHLY_LIMIT_OVERRIDE falls back to membership limit", () => {
    const prev = process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
    process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = "not-a-number";
    try {
      assert.equal(getEffectiveStyleMeLimit("NONE"), 0);
      assert.equal(getEffectiveStyleMeLimit("MEMBER"), 8);
    } finally {
      if (prev === undefined) delete process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE;
      else process.env.STYLEME_MONTHLY_LIMIT_OVERRIDE = prev;
    }
  });
});
