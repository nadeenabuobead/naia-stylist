// app/lib/delayed-start.test.ts
//
// Delayed-start date computation — Founder Decision 2.
// Run: node --test --import tsx/esm app/lib/delayed-start.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDelayedStart, formatDelayedStartDate, STATUTORY_PERIOD_DAYS } from "./delayed-start";

describe("STATUTORY_PERIOD_DAYS", () => {
  it("defaults to 14 — flagged as unconfirmed against this product's actual jurisdiction, not silently assumed settled", () => {
    assert.strictEqual(STATUTORY_PERIOD_DAYS, 14);
  });
});

describe("computeDelayedStart", () => {
  it("service start is exactly statutoryPeriodDays after the order date", () => {
    const order = new Date("2026-11-17T10:00:00.000Z");
    const { serviceStartDate } = computeDelayedStart(order, 14);
    assert.strictEqual(serviceStartDate.toISOString(), "2026-12-01T10:00:00.000Z");
  });

  it("first billing happens on the same date as service start — no separate, earlier charge", () => {
    const order = new Date("2026-11-17T10:00:00.000Z");
    const { serviceStartDate, firstBillingDate } = computeDelayedStart(order, 14);
    assert.strictEqual(firstBillingDate.getTime(), serviceStartDate.getTime());
  });

  it("accepts a custom period without being hardcoded to 14 everywhere", () => {
    const order = new Date("2026-11-17T10:00:00.000Z");
    const { serviceStartDate } = computeDelayedStart(order, 30);
    assert.strictEqual(serviceStartDate.toISOString(), "2026-12-17T10:00:00.000Z");
  });

  it("the original orderDate is returned unmodified, not mutated", () => {
    const order = new Date("2026-11-17T10:00:00.000Z");
    const orderTimeBefore = order.getTime();
    const result = computeDelayedStart(order, 14);
    assert.strictEqual(order.getTime(), orderTimeBefore, "input Date object must not be mutated");
    assert.strictEqual(result.orderDate.getTime(), orderTimeBefore);
  });
});

describe("formatDelayedStartDate", () => {
  it("renders a human-readable, unambiguous date — not a locale-ambiguous numeric format", () => {
    const formatted = formatDelayedStartDate(new Date("2026-12-01T10:00:00.000Z"));
    assert.strictEqual(formatted, "1 December 2026");
  });
});
