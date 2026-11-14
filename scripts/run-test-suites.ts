// scripts/run-test-suites.ts
// Runs each dedicated test npm-script to completion regardless of earlier
// failures, then reports a combined summary. Exits non-zero iff any step failed.
import { spawnSync } from "node:child_process";

const steps = [
  "test:unit",
  "test:security",
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
