// app/lib/ops-alert.test.ts
//
// Behavioral tests for the minimal ops-alert sink. No real network call
// in any test — fetch is always injected. No env var is ever set to a
// real URL in this file.
//
// Run: node --import tsx/esm --test app/lib/ops-alert.test.ts

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sendOpsAlert, resetOpsAlertCooldowns } from "./ops-alert.server";

afterEach(() => {
  resetOpsAlertCooldowns();
});

describe("sendOpsAlert — off by default", () => {
  it("OA.1 — with no webhook URL configured (env unset, no override), never calls fetch and reports why", async () => {
    let fetchCalls = 0;
    const originalEnv = process.env.OPS_ALERT_WEBHOOK_URL;
    delete process.env.OPS_ALERT_WEBHOOK_URL;
    try {
      const result = await sendOpsAlert("test:context", "something happened", undefined, {
        _fetch: (async () => { fetchCalls++; return new Response(null); }) as typeof fetch,
      });
      assert.deepEqual(result, { sent: false, reason: "no_webhook_configured" });
      assert.equal(fetchCalls, 0);
    } finally {
      if (originalEnv !== undefined) process.env.OPS_ALERT_WEBHOOK_URL = originalEnv;
    }
  });
});

describe("sendOpsAlert — when a destination is configured (test-only override, never a real URL)", () => {
  it("OA.2 — posts one JSON payload with context, message, occurredAt, and meta", async () => {
    let capturedUrl: any = null;
    let capturedInit: any = null;
    const result = await sendOpsAlert(
      "withdrawal-request:submitted",
      "A new EU withdrawal request was submitted.",
      { reference: "WD-20261117-ABC123" },
      {
        _webhookUrl: "https://example.test/ops-alert-sink",
        _fetch: (async (url: any, init: any) => { capturedUrl = url; capturedInit = init; return new Response(null); }) as typeof fetch,
        _now: () => 1_700_000_000_000,
      },
    );
    assert.deepEqual(result, { sent: true });
    assert.equal(capturedUrl, "https://example.test/ops-alert-sink");
    assert.equal(capturedInit?.method, "POST");
    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.context, "withdrawal-request:submitted");
    assert.equal(body.message, "A new EU withdrawal request was submitted.");
    assert.equal(body.meta.reference, "WD-20261117-ABC123");
    assert.equal(body.occurredAt, new Date(1_700_000_000_000).toISOString());
  });

  it("OA.3 — a second alert for the SAME context within the cooldown window is suppressed, fetch called only once", async () => {
    let fetchCalls = 0;
    const deps = {
      _webhookUrl: "https://example.test/ops-alert-sink",
      _fetch: (async () => { fetchCalls++; return new Response(null); }) as typeof fetch,
      _now: () => 1_700_000_000_000,
      _cooldownMs: 300_000,
    };
    const first = await sendOpsAlert("stripe-dispute:created", "dispute 1", undefined, deps);
    const second = await sendOpsAlert("stripe-dispute:created", "dispute 2 — same context, inside cooldown", undefined, deps);
    assert.deepEqual(first, { sent: true });
    assert.deepEqual(second, { sent: false, reason: "cooldown_active" });
    assert.equal(fetchCalls, 1);
  });

  it("OA.4 — a DIFFERENT context is never suppressed by another context's cooldown", async () => {
    let fetchCalls = 0;
    const deps = {
      _webhookUrl: "https://example.test/ops-alert-sink",
      _fetch: (async () => { fetchCalls++; return new Response(null); }) as typeof fetch,
      _now: () => 1_700_000_000_000,
      _cooldownMs: 300_000,
    };
    await sendOpsAlert("stripe-dispute:created", "dispute", undefined, deps);
    const other = await sendOpsAlert("withdrawal-request:submitted", "withdrawal", undefined, deps);
    assert.deepEqual(other, { sent: true });
    assert.equal(fetchCalls, 2);
  });

  it("OA.5 — once the cooldown window has elapsed, the next alert for the same context sends again", async () => {
    let fetchCalls = 0;
    let nowMs = 1_700_000_000_000;
    const deps = {
      _webhookUrl: "https://example.test/ops-alert-sink",
      _fetch: (async () => { fetchCalls++; return new Response(null); }) as typeof fetch,
      _now: () => nowMs,
      _cooldownMs: 300_000,
    };
    await sendOpsAlert("ctx", "a", undefined, deps);
    nowMs += 300_001;
    const result = await sendOpsAlert("ctx", "b", undefined, deps);
    assert.deepEqual(result, { sent: true });
    assert.equal(fetchCalls, 2);
  });

  it("OA.6 — a throwing fetch is swallowed: never throws, still reports sent:true (an attempt was made)", async () => {
    const result = await sendOpsAlert("ctx", "a", undefined, {
      _webhookUrl: "https://example.test/ops-alert-sink",
      _fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch,
    });
    assert.deepEqual(result, { sent: true });
  });

  it("OA.7 — message is truncated to 500 chars, never sent unbounded", async () => {
    let body: any = null;
    const longMessage = "x".repeat(2000);
    await sendOpsAlert("ctx", longMessage, undefined, {
      _webhookUrl: "https://example.test/ops-alert-sink",
      _fetch: (async (_url: any, init: any) => { body = JSON.parse(String(init.body)); return new Response(null); }) as typeof fetch,
    });
    assert.equal(body.message.length, 500);
  });
});
