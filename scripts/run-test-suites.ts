// scripts/run-test-suites.ts
// Runs each dedicated test npm-script to completion regardless of earlier
// failures, then reports a combined summary. Exits non-zero iff any step failed.
import { spawnSync } from "node:child_process";

const steps = [
  "test:unit",
  "test:security",
  // 2026-11-17 (C7): the cross-customer isolation / GID-leak certification
  // suite (app/lib/ai/nadine-security.test.ts) existed but was unreachable
  // from `npm test` — it appeared in no npm script, so nothing ever ran it
  // and its one stale assertion went unnoticed indefinitely.
  //
  // It is a node:test file, NOT a vitest file, so it cannot simply be
  // appended to "test:security": vitest reports a node:test file as
  // "1 failed (1) / no tests" regardless of whether its assertions actually
  // pass, which would have made this suite look broken while telling us
  // nothing. It gets its own `node --test` script instead.
  "test:nadine-security",
  // 2026-11-17 (H7): app/lib/ai/my-naia-model.test.ts had the exact same
  // unreachability problem C7 found above — tests covering the My nAia Model
  // face/body photo service (upload validation, moderation gates,
  // compensation deletes, consent withdrawal) appeared in NO npm script, so
  // nothing ever ran them. Same reason it gets its own `node --test` script
  // rather than being appended to "test:security": it is a node:test file,
  // which vitest would report as a failure regardless of its assertions.
  "test:my-naia-model",
  "test:billing",
  "test:taste-evidence-deletion",
  "test:taste-v1-completion",
  "test:styleme-ui",
  "test:legal-ops",
  // 2026-11-18: app/lib/error-tracking.server.test.ts had the exact same
  // unreachability problem C7/H7 found above — appeared in no npm script,
  // so nothing ever ran it. Same node:test-vs-vitest reason it gets its
  // own script rather than being appended to "test:security".
  "test:error-tracking",
  // 2026-11-19 (08P01 investigation follow-up): found while re-verifying
  // coverage around the intermittent 08P01/protocol_violation incident —
  // app/lib/clerk-session.test.ts, clerk-session.server.key-guard.test.ts,
  // clerk-session-db-resilience.test.ts, clerk-session.server
  // .authorized-parties.test.ts, and prisma-transient-retry.server.test.ts
  // (the exact DatabaseUnavailableError / isTransientDatabaseError /
  // getCurrentNaiaCustomer DB-resilience coverage this incident depends
  // on) had the same unreachability problem as C7/H7/error-tracking above:
  // none of them appeared in any npm script, so `npm test` never ran them.
  // All 5 files pass today (51 tests) — this just makes that visible to
  // every future run instead of silently skipping them. They are vitest
  // files (unlike the node:test suites above), so they're combined into
  // one new "test:clerk-session" script rather than node:test's own runner.
  "test:clerk-session",
];

const results: { script: string; exitCode: number }[] = [];

for (const script of steps) {
  console.log(`\n=== npm run ${script} ===\n`);
  const { status, signal } = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  results.push({ script, exitCode: signal ? 1 : status ?? 1 });
}

console.log("\n=== test suite summary ===");
let anyFailed = false;
for (const { script, exitCode } of results) {
  const passed = exitCode === 0;
  if (!passed) anyFailed = true;
  console.log(`${passed ? "PASS" : "FAIL"}  ${script}`);
}

process.exit(anyFailed ? 1 : 0);
