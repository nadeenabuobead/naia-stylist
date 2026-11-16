#!/usr/bin/env node
// scripts/load-test/run-load-test.mjs
//
// Synthetic staged-concurrency load test harness. Zero new npm
// dependencies (global fetch + a hand-rolled worker pool). Designed to be
// run against a LOCAL dev server or a disposable, explicitly-approved
// isolated environment only — see the hard host guard below. This script
// has never been run against naia-stylist-staging or naia-stylist
// (production) and must not be, without a separate, explicit approval for
// that specific run (see docs/ops/load-test-plan.md).
//
// Usage:
//   node scripts/load-test/run-load-test.mjs --self-test
//     Runs the harness against its own bundled mock-providers-server
//     instead of the real app, to prove the concurrency/metrics/reporting
//     machinery works. Makes zero requests to the real app, the real
//     database, or any real provider.
//
//   TARGET_BASE_URL=http://127.0.0.1:3000 \
//   FIXTURES_FILE=scripts/load-test/fixtures/local-dev-sessions.json \
//   node scripts/load-test/run-load-test.mjs
//     Runs the real journeys (journeys.config.mjs) against a locally
//     running dev server. See fixtures/README.md before using this.
//
// Env vars:
//   TARGET_BASE_URL        default http://127.0.0.1:3000
//   STAGES                 default "10,25,50,100" (comma-separated VU counts)
//   STAGE_DURATION_SECONDS default 30
//   ALLOW_PROVIDER_MOCKS   must be "true" for any journey marked
//                          requiresProviderMock to run at all (independent
//                          of the app-side env var of the same name)
//   ALLOW_REMOTE_LOAD_TEST_HOST
//                          exact hostname to allow if TARGET_BASE_URL is
//                          not localhost/127.0.0.1/::1 — see guardHost()
//   OUTPUT_FILE            default scripts/load-test/results/<timestamp>.json
//   FIXTURES_FILE          path to a JSON array of { cookie: string } used
//                          round-robin for requiresAuth journeys

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));

function guardHost(targetBaseUrl) {
  const url = new URL(targetBaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const isLocal = localHosts.has(url.hostname) || url.hostname.endsWith(".localhost");
  if (isLocal) return;
  const allowed = process.env.ALLOW_REMOTE_LOAD_TEST_HOST;
  if (allowed && allowed === url.hostname) {
    console.warn(`[run-load-test] WARNING: running against non-local host "${url.hostname}" because ALLOW_REMOTE_LOAD_TEST_HOST matches exactly. This must have been explicitly approved for this specific run.`);
    return;
  }
  console.error(
    `[run-load-test] REFUSING to run against non-local target "${url.hostname}".\n` +
    `This harness only targets localhost/127.0.0.1/::1 by default. To target anything else\n` +
    `(a disposable Preview deployment, never naia-stylist-staging or naia-stylist directly),\n` +
    `set ALLOW_REMOTE_LOAD_TEST_HOST="${url.hostname}" explicitly after getting approval for that exact run.`,
  );
  process.exit(1);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function pickWeighted(journeys) {
  const total = journeys.reduce((sum, j) => sum + j.weight, 0);
  let r = Math.random() * total;
  for (const j of journeys) {
    r -= j.weight;
    if (r <= 0) return j;
  }
  return journeys[journeys.length - 1];
}

async function runStage({ baseUrl, journeys, fixtures, concurrency, durationMs, allowProviderMocks }) {
  const deadline = performance.now() + durationMs;
  const latencies = [];
  const statusCounts = {};
  const errors = [];
  let requestCount = 0;
  let fixtureIdx = 0;

  const runnable = journeys.filter((j) => !j.requiresProviderMock || allowProviderMocks);
  if (runnable.length === 0) {
    throw new Error("No runnable journeys — every configured journey requires ALLOW_PROVIDER_MOCKS=true.");
  }

  async function worker() {
    while (performance.now() < deadline) {
      const journey = pickWeighted(runnable);
      let session;
      if (journey.requiresAuth) {
        if (fixtures.length === 0) continue; // nothing to authenticate with — skip this iteration
        session = fixtures[fixtureIdx % fixtures.length];
        fixtureIdx += 1;
      }
      for (const step of journey.steps) {
        const path = step.path({ session });
        const headers = step.headers ? step.headers({ session }) : {};
        if (session?.cookie) headers["Cookie"] = session.cookie;
        const started = performance.now();
        try {
          const res = await fetch(`${baseUrl}${path}`, { method: step.method, headers, redirect: "manual" });
          const elapsed = performance.now() - started;
          latencies.push(elapsed);
          const bucket = `${Math.floor(res.status / 100)}xx`;
          statusCounts[bucket] = (statusCounts[bucket] || 0) + 1;
          requestCount += 1;
        } catch (err) {
          const elapsed = performance.now() - started;
          latencies.push(elapsed);
          statusCounts["error"] = (statusCounts["error"] || 0) + 1;
          requestCount += 1;
          errors.push({ journey: journey.name, message: String(err?.message || err) });
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const total2xx3xx = (statusCounts["2xx"] || 0) + (statusCounts["3xx"] || 0);
  const errorRate = requestCount === 0 ? 0 : 1 - total2xx3xx / requestCount;

  return {
    concurrency,
    durationMs,
    requestCount,
    throughputRps: requestCount / (durationMs / 1000),
    latencyMs: {
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      p99: Math.round(percentile(latencies, 99)),
      max: Math.round(latencies[latencies.length - 1] || 0),
    },
    statusCounts,
    errorRate: Math.round(errorRate * 10000) / 10000,
    sampleErrors: errors.slice(0, 5),
  };
}

async function main() {
  const selfTest = process.argv.includes("--self-test");
  let baseUrl = process.env.TARGET_BASE_URL || "http://127.0.0.1:3000";
  const allowProviderMocks = process.env.ALLOW_PROVIDER_MOCKS === "true";
  const stages = (process.env.STAGES || "10,25,50,100").split(",").map((s) => parseInt(s.trim(), 10));
  const stageDurationMs = (parseInt(process.env.STAGE_DURATION_SECONDS || "30", 10)) * 1000;

  let journeys;
  let fixtures = [];
  let mockServerProc;

  if (selfTest) {
    // Self-test mode: spin up the bundled mock-providers-server and define
    // two trivial journeys that hit IT directly — this proves the
    // harness's own concurrency/metrics/reporting logic works, without
    // touching the real app, a real database, or any real provider.
    const { spawn } = await import("node:child_process");
    const port = 18899 + Math.floor(Math.random() * 100);
    baseUrl = `http://127.0.0.1:${port}`;
    mockServerProc = spawn(process.execPath, [`${__dirname}/mock-providers-server.mjs`], {
      env: { ...process.env, PORT: String(port), LATENCY_MS: "20" },
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 400)); // let it bind
    journeys = [
      { name: "self-test-fashn-submit", weight: 1, requiresProviderMock: false, requiresAuth: false, steps: [{ method: "POST", path: () => "/fashn/v1/run" }] },
      { name: "self-test-claude", weight: 1, requiresProviderMock: false, requiresAuth: false, steps: [{ method: "POST", path: () => "/claude/v1/messages" }] },
    ];
    console.log(`[run-load-test] SELF-TEST MODE — running against the bundled mock server only (${baseUrl}), not the real app.`);
  } else {
    guardHost(baseUrl);
    ({ journeys } = await import("./journeys.config.mjs"));
    const fixturesFile = process.env.FIXTURES_FILE;
    if (fixturesFile && existsSync(fixturesFile)) {
      fixtures = JSON.parse(readFileSync(fixturesFile, "utf8"));
    } else if (journeys.some((j) => j.requiresAuth)) {
      console.warn("[run-load-test] No FIXTURES_FILE provided — journeys marked requiresAuth will be skipped. See fixtures/README.md.");
    }
  }

  const report = { startedAt: new Date().toISOString(), baseUrl, selfTest, stages: [] };

  console.log(`[run-load-test] target=${baseUrl} stages=${stages.join(",")} stageDuration=${stageDurationMs / 1000}s allowProviderMocks=${allowProviderMocks}`);

  for (const concurrency of stages) {
    console.log(`\n── Stage: ${concurrency} concurrent users ──────────────────────────`);
    const result = await runStage({ baseUrl, journeys, fixtures, concurrency, durationMs: stageDurationMs, allowProviderMocks });
    console.log(
      `  requests=${result.requestCount} rps=${result.throughputRps.toFixed(1)} ` +
      `p50=${result.latencyMs.p50}ms p95=${result.latencyMs.p95}ms p99=${result.latencyMs.p99}ms ` +
      `errorRate=${(result.errorRate * 100).toFixed(2)}% statusCounts=${JSON.stringify(result.statusCounts)}`,
    );
    report.stages.push(result);
  }

  if (mockServerProc) mockServerProc.kill();

  const outputFile = process.env.OUTPUT_FILE || `${__dirname}/results/${Date.now()}.json`;
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`\n[run-load-test] report written to ${outputFile}`);
}

main().catch((err) => {
  console.error("[run-load-test] fatal:", err);
  process.exit(1);
});
