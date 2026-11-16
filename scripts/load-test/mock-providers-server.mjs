#!/usr/bin/env node
// scripts/load-test/mock-providers-server.mjs
//
// Standalone, offline mock server for FASHN and Claude/Anthropic — the two
// paid-AI providers this app can currently redirect to via the
// ALLOW_PROVIDER_MOCKS escape hatch added to app/lib/ai/fashn-try-on.server.ts
// and app/lib/ai/claude.server.ts. Nothing here touches a real provider, a
// real database, or any customer data. It exists so a synthetic load test
// can exercise FASHN/Claude-calling routes without making a single real
// paid API call.
//
// Usage:
//   node scripts/load-test/mock-providers-server.mjs
//   PORT=8899 FAILURE_RATE=0.05 LATENCY_MS=400 node scripts/load-test/mock-providers-server.mjs
//
// Then, when starting the app itself for a local load test, set:
//   ALLOW_PROVIDER_MOCKS=true
//   FASHN_MOCK_BASE_URL=http://127.0.0.1:8899/fashn
//   CLAUDE_MOCK_BASE_URL=http://127.0.0.1:8899/claude
//
// NOT WIRED YET: Cloudinary has no equivalent override point in
// app/lib/cloudinary-admin.server.ts today (its upload/destroy/download
// URLs are built inline at 5+ call sites, not through one BASE_URL
// constant like FASHN/Claude). This mock server still exposes a
// Cloudinary-shaped /cloudinary/upload endpoint so that wiring, if added
// later, has something to point at — see
// docs/ops/vercel-limits-and-db-budget-review.md §5 for what that change
// would need. Stripe has no code at all on this branch (no
// stripe-client.server.ts exists here), so there is nothing to mock for it.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8899);
const LATENCY_MS = Number(process.env.LATENCY_MS || 300);
const FAILURE_RATE = Number(process.env.FAILURE_RATE || 0); // 0..1, fraction of requests that return a provider-style failure
const POLL_COMPLETIONS_AFTER = Number(process.env.POLL_COMPLETIONS_AFTER || 2); // FASHN: how many /v1/status polls before "completed"

const predictions = new Map(); // id -> poll count

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFail() {
  return Math.random() < FAILURE_RATE;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  await sleep(LATENCY_MS);
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── FASHN ──────────────────────────────────────────────────────────────
  if (url.pathname === "/fashn/v1/run" && req.method === "POST") {
    await readBody(req); // drain, never parsed — mock never looks at image data
    if (shouldFail()) return json(res, 503, { error: "mock: simulated provider rejection" });
    const id = `mock-pred-${randomUUID()}`;
    predictions.set(id, 0);
    return json(res, 200, { id });
  }

  if (url.pathname.startsWith("/fashn/v1/status/") && req.method === "GET") {
    const id = url.pathname.split("/").pop();
    if (shouldFail()) return json(res, 502, { error: "mock: simulated poll failure" });
    const count = (predictions.get(id) ?? 0) + 1;
    predictions.set(id, count);
    if (count < POLL_COMPLETIONS_AFTER) {
      return json(res, 200, { status: "processing" });
    }
    predictions.delete(id);
    return json(res, 200, {
      status: "completed",
      output: ["data:image/png;base64,bW9jay1vdXRwdXQ="], // "mock-output" base64, never a real image
    });
  }

  // ── Claude / Anthropic ────────────────────────────────────────────────
  if (url.pathname === "/claude/v1/messages" && req.method === "POST") {
    await readBody(req);
    if (shouldFail()) return json(res, 529, { error: { type: "overloaded_error", message: "mock: simulated overload" } });
    return json(res, 200, { content: [{ type: "text", text: "{\"mock\":true}" }] });
  }

  // ── Cloudinary (not wired into app code yet — see header comment) ─────
  if (url.pathname.startsWith("/cloudinary/") && req.method === "POST") {
    await readBody(req);
    if (shouldFail()) return json(res, 500, { error: { message: "mock: simulated Cloudinary failure" } });
    return json(res, 200, {
      public_id: `mock/${randomUUID()}`,
      secure_url: "https://res.cloudinary.com/mock/image/private/mock.jpg",
      bytes: 123456,
    });
  }

  json(res, 404, { error: `mock-providers-server: no handler for ${req.method} ${url.pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-providers-server] listening on http://127.0.0.1:${PORT} (latency=${LATENCY_MS}ms, failureRate=${FAILURE_RATE})`);
  console.log(`[mock-providers-server]   FASHN_MOCK_BASE_URL=http://127.0.0.1:${PORT}/fashn`);
  console.log(`[mock-providers-server]   CLAUDE_MOCK_BASE_URL=http://127.0.0.1:${PORT}/claude`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
