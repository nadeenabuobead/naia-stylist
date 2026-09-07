// app/lib/plan/usage-window.test.ts
//
// UW-01  getUsageWindow returns a start on the first of the current UTC month
// UW-02  getUsageWindow end is the first moment of the following month
// UW-03  getUsageWindow start < end
// UW-04  formatResetDate returns "1 <MonthName>" (day numeric, month long)
// UW-05  getUsageWindow label matches "Month Year" in en-GB

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getUsageWindow, formatResetDate } from "./usage-window.server";

describe("usage-window", () => {
  it("UW-01 start is first day of current UTC month", () => {
    const w = getUsageWindow();
    const now = new Date();
    assert.equal(w.start.getUTCDate(), 1);
    assert.equal(w.start.getUTCMonth(), now.getUTCMonth());
    assert.equal(w.start.getUTCFullYear(), now.getUTCFullYear());
    assert.equal(w.start.getUTCHours(), 0);
    assert.equal(w.start.getUTCMinutes(), 0);
    assert.equal(w.start.getUTCSeconds(), 0);
  });

  it("UW-02 end is the first moment of the following UTC month", () => {
    const w = getUsageWindow();
    const expectedMonth = (new Date().getUTCMonth() + 1) % 12;
    assert.equal(w.end.getUTCDate(), 1);
    assert.equal(w.end.getUTCMonth(), expectedMonth);
    assert.equal(w.end.getUTCHours(), 0);
  });

  it("UW-03 start is strictly before end", () => {
    const w = getUsageWindow();
    assert.ok(w.start < w.end, "start must be before end");
  });

  it("UW-04 formatResetDate returns '1 <MonthName>'", () => {
    const w = getUsageWindow();
    const label = formatResetDate(w);
    assert.match(label, /^1 [A-Z][a-z]+$/,
      `formatResetDate should be "1 Month", got: ${label}`);
  });

  it("UW-05 window label is 'Month Year' format", () => {
    const w = getUsageWindow();
    assert.match(w.label, /^[A-Z][a-z]+ \d{4}$/,
      `label should be "Month Year", got: ${w.label}`);
  });
});
