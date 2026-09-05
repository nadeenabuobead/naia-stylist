// app/lib/plan/billing-window.test.ts
// Tests for the billing window helper.
//
// BW-01  start is the first moment of the current UTC month
// BW-02  end is the first moment of the next UTC month
// BW-03  start < end
// BW-04  label is a readable month+year string
// BW-05  formatResetDate returns a day+month string from window.end

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getBillingWindow, formatResetDate } from "./billing-window.server";

describe("billing-window", () => {
  it("BW-01 start is first moment of current UTC month", () => {
    const { start } = getBillingWindow();
    assert.equal(start.getUTCDate(), 1);
    assert.equal(start.getUTCHours(), 0);
    assert.equal(start.getUTCMinutes(), 0);
    assert.equal(start.getUTCSeconds(), 0);
    assert.equal(start.getUTCMilliseconds(), 0);
  });

  it("BW-02 end is first moment of next UTC month", () => {
    const { start, end } = getBillingWindow();
    assert.equal(end.getUTCDate(), 1);
    assert.equal(end.getUTCHours(), 0);
    // end month is start month + 1 (wrapping year handled)
    const expectedMonth = (start.getUTCMonth() + 1) % 12;
    assert.equal(end.getUTCMonth(), expectedMonth);
  });

  it("BW-03 start is before end", () => {
    const { start, end } = getBillingWindow();
    assert(start < end);
  });

  it("BW-04 label is a non-empty string", () => {
    const { label } = getBillingWindow();
    assert.equal(typeof label, "string");
    assert(label.length > 0);
  });

  it("BW-05 formatResetDate returns a day+month string", () => {
    const w = getBillingWindow();
    const reset = formatResetDate(w);
    assert.equal(typeof reset, "string");
    assert(reset.length > 0);
    // Should contain a number (the day) and letters (the month name)
    assert(/\d/.test(reset));
    assert(/[A-Za-z]/.test(reset));
  });
});
