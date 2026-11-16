// app/lib/ai/provider-mock-override.test.ts
//
// Load-test prep (2026-11-16): fashn-try-on.server.ts's BASE_URL and
// claude.server.ts's ANTHROPIC_MESSAGES_URL are both computed once, at
// module load, from process.env. Testing that correctly requires each
// case to see a FRESH module evaluation with a specific env — the only
// reliable way to do that in Node's module system is a fresh child
// process per case, so each test here spawns `node --import tsx/esm`
// with a tiny inline script and asserts on its stdout. No real network
// call is made in any case (a DI _fetch mock captures the URL and
// returns a synthetic response without ever calling out).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

function runInChildProcess(env: Record<string, string | undefined>, script: string): string {
  const fullEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) fullEnv[k] = v;
  }
  // Explicitly unset keys whose value is `undefined` in `env` so a var
  // inherited from this test runner's own process can't leak in.
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete fullEnv[k];
  }
  return execFileSync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "-e", script],
    { env: fullEnv, encoding: "utf8", timeout: 15_000 },
  ).trim();
}

const FASHN_PROBE = `
  import { submitTryOnToProvider } from "./app/lib/ai/fashn-try-on.server.ts";
  let captured = "";
  const _fetch = async (url) => {
    captured = String(url);
    return new Response(JSON.stringify({ id: "pred-probe" }), { status: 200 });
  };
  await submitTryOnToProvider(
    {
      customerId: "c1",
      modelImageDataUrl: "data:image/jpeg;base64,/9j/4AAQ",
      productImageUrl: "https://cdn.shopify.com/s/files/1/p.jpg",
      consent: { virtualTryOnConsent: true, policyVersion: "1.0", consentedAt: "2026-01-01T00:00:00Z" },
    },
    { _fetch, _getApiKey: () => "k" },
  );
  console.log(captured);
`;

const CLAUDE_PROBE = `
  import { callClaude } from "./app/lib/ai/claude.server.ts";
  let captured = "";
  const _fetch = async (url) => {
    captured = String(url);
    return new Response(JSON.stringify({ content: [{ text: "ok" }] }), { status: 200 });
  };
  await callClaude({ messages: [{ role: "user", content: "hi" }], _fetch });
  console.log(captured);
`;

describe("Load-test prep — FASHN mock-base-URL override is fail-safe", () => {
  it("MOCK.1 — with neither env var set, the real FASHN endpoint is called", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: undefined, FASHN_MOCK_BASE_URL: undefined },
      FASHN_PROBE,
    );
    assert.equal(url, "https://api.fashn.ai/v1/run");
  });

  it("MOCK.2 — with only FASHN_MOCK_BASE_URL set (no explicit opt-in), the real endpoint is still called", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: undefined, FASHN_MOCK_BASE_URL: "http://127.0.0.1:9901" },
      FASHN_PROBE,
    );
    assert.equal(url, "https://api.fashn.ai/v1/run");
  });

  it("MOCK.3 — with only ALLOW_PROVIDER_MOCKS=true (no mock URL given), the real endpoint is still called", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: "true", FASHN_MOCK_BASE_URL: undefined },
      FASHN_PROBE,
    );
    assert.equal(url, "https://api.fashn.ai/v1/run");
  });

  it("MOCK.4 — with both ALLOW_PROVIDER_MOCKS=true and FASHN_MOCK_BASE_URL set, the mock URL is used", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: "true", FASHN_MOCK_BASE_URL: "http://127.0.0.1:9901" },
      FASHN_PROBE,
    );
    assert.equal(url, "http://127.0.0.1:9901/v1/run");
  });

  it("MOCK.5 — ALLOW_PROVIDER_MOCKS=\"1\" (not the literal string \"true\") does NOT activate the override", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: "1", FASHN_MOCK_BASE_URL: "http://127.0.0.1:9901" },
      FASHN_PROBE,
    );
    assert.equal(url, "https://api.fashn.ai/v1/run");
  });
});

describe("Load-test prep — Claude mock-base-URL override is fail-safe", () => {
  it("MOCK.6 — with neither env var set, the real Anthropic endpoint is called", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: undefined, CLAUDE_MOCK_BASE_URL: undefined },
      CLAUDE_PROBE,
    );
    assert.equal(url, "https://api.anthropic.com/v1/messages");
  });

  it("MOCK.7 — with only CLAUDE_MOCK_BASE_URL set (no explicit opt-in), the real endpoint is still called", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: undefined, CLAUDE_MOCK_BASE_URL: "http://127.0.0.1:9902" },
      CLAUDE_PROBE,
    );
    assert.equal(url, "https://api.anthropic.com/v1/messages");
  });

  it("MOCK.8 — with both env vars set, the mock URL is used, with /v1/messages appended", () => {
    const url = runInChildProcess(
      { ALLOW_PROVIDER_MOCKS: "true", CLAUDE_MOCK_BASE_URL: "http://127.0.0.1:9902" },
      CLAUDE_PROBE,
    );
    assert.equal(url, "http://127.0.0.1:9902/v1/messages");
  });
});
