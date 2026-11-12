// app/lib/billing/checkout-reservation.test.ts
// Behavioral tests for concurrent-checkout protection
// (fix/stripe-clerk-phase1-security, 2026-11-12). No real Prisma, no real
// network: every dependency is injected via CheckoutReservationDeps,
// mirroring the WebhookHandlerDeps / EffectiveContextDeps convention
// already established elsewhere in app/lib/billing and app/lib/plan.
//
// What these tests can and cannot prove: they prove the actual decision
// logic (reject when a non-expired reservation exists, recover when it's
// expired, propagate a genuine unique-constraint collision as a rejection)
// against an injected fake database. They cannot (and nothing in this
// environment can) empirically prove two real overlapping network requests
// against a live Postgres instance behave this way — that would require a
// live instance under real concurrent load. The genuinely-concurrent case
// (CR.4 below) simulates it the same way entitlement-reservation.test.ts's
// RSV tests simulate their own transaction races: by having the injected
// create function itself throw P2002 on a specific call, exactly as a real
// unique-constraint violation would.
//
// Run: node --import tsx/esm --test app/lib/billing/checkout-reservation.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reserveCheckoutAttempt,
  releaseCheckoutReservation,
  CHECKOUT_RESERVATION_TTL_MS,
  type CheckoutReservationDeps,
} from "./checkout-reservation.server";

const CUSTOMER_ID = "cust-checkout-reservation-test";
const NOW = new Date("2026-11-12T12:00:00.000Z");

function p2002() {
  return Object.assign(new Error("Unique constraint failed on the fields: (`customerId`)"), {
    code: "P2002",
    meta: { target: ["customerId"] },
  });
}

describe("reserveCheckoutAttempt", () => {
  it("CR.1 — no existing reservation: creates one and allows the attempt", async () => {
    let created: any = null;
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => null,
      _createReservation: async (input) => { created = input; return { id: "res-1" }; },
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps);
    assert.equal(result.allowed, true);
    assert.ok(created, "must actually create a reservation row");
    assert.equal(created.customerId, CUSTOMER_ID);
    assert.equal(created.planType, "MONTHLY");
  });

  it("CR.2 — the reservation's expiresAt is exactly now + the 30-minute TTL", async () => {
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => null,
      _createReservation: async (input) => ({ id: "res-1", ...input }),
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps);
    assert.equal(result.allowed, true);
    if (!result.allowed) throw new Error("unreachable");
    assert.equal(result.expiresAt.getTime(), NOW.getTime() + CHECKOUT_RESERVATION_TTL_MS);
    assert.equal(CHECKOUT_RESERVATION_TTL_MS, 30 * 60 * 1000, "must match Stripe's own enforced minimum expires_at window");
  });

  it("CR.3 — a NON-expired existing reservation blocks the attempt, and create is never called", async () => {
    let createCalls = 0;
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => ({ id: "res-existing", expiresAt: new Date(NOW.getTime() + 60_000) }), // 1 min in the future
      _createReservation: async () => { createCalls++; throw new Error("must not be called"); },
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "checkout_already_pending");
    assert.equal(createCalls, 0);
  });

  it("CR.4 — a genuinely CONCURRENT insert (unique-constraint violation on create, not detected by the prior read) is correctly rejected, not thrown", async () => {
    // Simulates two requests racing: this one's own _findReservation read
    // sees nothing (the other request hasn't committed yet), but by the time
    // THIS request's create actually runs, the other has already won —
    // exactly what a real Postgres unique constraint would produce.
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => null,
      _createReservation: async () => { throw p2002(); },
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "checkout_already_pending");
  });

  it("CR.5 — a non-unique-constraint error from create propagates unchanged — only P2002 is a deliberate rejection", async () => {
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => null,
      _createReservation: async () => { throw new Error("connection refused"); },
      _now: () => NOW,
    };
    await assert.rejects(() => reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps), /connection refused/);
  });

  it("CR.6 — an EXPIRED existing reservation (abandoned checkout, missed/delayed webhook) is deleted, and a fresh one is allowed", async () => {
    let deletedCustomerId: string | null = null;
    let created: any = null;
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => ({ id: "res-stale", expiresAt: new Date(NOW.getTime() - 1_000) }), // 1s in the past
      _deleteReservation: async (customerId) => { deletedCustomerId = customerId; },
      _createReservation: async (input) => { created = input; return { id: "res-new" }; },
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "ANNUAL", deps);
    assert.equal(deletedCustomerId, CUSTOMER_ID, "the stale reservation must be cleared before retrying");
    assert.ok(created, "a fresh reservation must be created after clearing the stale one");
    assert.equal(result.allowed, true);
  });

  it("CR.7 — a reservation expiring at EXACTLY now counts as expired, not still-valid — boundary is <=, not <", async () => {
    let deleted = false;
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => ({ id: "res-boundary", expiresAt: NOW }),
      _deleteReservation: async () => { deleted = true; },
      _createReservation: async (input) => ({ id: "res-new", ...input }),
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps);
    assert.equal(deleted, true);
    assert.equal(result.allowed, true);
  });

  it("CR.8 — even the expired-replacement path can lose a race to a truly concurrent request — still a clean rejection, not a crash", async () => {
    // Two requests both see the same stale reservation, both delete it (the
    // second delete is a safe no-op against an already-gone row), but only
    // one of their re-creates can win the unique constraint.
    const deps: CheckoutReservationDeps = {
      _findReservation: async () => ({ id: "res-stale", expiresAt: new Date(NOW.getTime() - 1_000) }),
      _deleteReservation: async () => {},
      _createReservation: async () => { throw p2002(); },
      _now: () => NOW,
    };
    const result = await reserveCheckoutAttempt(CUSTOMER_ID, "MONTHLY", deps);
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.equal(result.reason, "checkout_already_pending");
  });
});

describe("releaseCheckoutReservation", () => {
  it("CR.9 — deletes the reservation row for the given customer", async () => {
    let deletedCustomerId: string | null = null;
    await releaseCheckoutReservation(CUSTOMER_ID, {
      _deleteReservation: async (customerId) => { deletedCustomerId = customerId; },
    });
    assert.equal(deletedCustomerId, CUSTOMER_ID);
  });
});
