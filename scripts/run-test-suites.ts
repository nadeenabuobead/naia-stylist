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
  "test:billing",
  "test:taste-evidence-deletion",
  "test:taste-v1-completion",
  "test:styleme-ui",
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
