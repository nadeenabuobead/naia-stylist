// app/lib/sensitive-profile-fields-logging.test.ts
//
// 2026-11-17, launch-readiness audit (C2 — plaintext sensitive data
// protection). C2's real fix (field-level encryption / RLS) is a staged
// Operations decision gated on key management and a migration plan — see
// the companion design document delivered alongside this commit. This test
// is the smallest SAFE, INDEPENDENT protection available without touching
// any live data or schema: a static regression guard confirming the most
// sensitive OnboardingProfile fields — the religious/cultural free-text
// note, body measurements, and the mood/psychological fields — are never
// passed as an argument to this app's own logging seams anywhere in the
// codebase. It does not encrypt anything; it only prevents a FUTURE commit
// from accidentally writing one of these fields into a log line (stdout
// today, a real provider once H3 is unblocked), which would otherwise be a
// second, independent way this data could leak even after encryption-at-
// rest exists.
//
// Same lightweight static-source-code-assertion convention already used by
// sensitive-logging.test.ts (Claude payload, retired routes) and
// my-naia-model-moderation.test.ts (DI call-site checks) in this repo —
// grep-based, not an AST analysis. It catches the direct case (a field name
// literally appearing on the same source line as a logging call) which is
// the realistic way this kind of leak actually happens in this codebase's
// own style (explicit field access, not object spreading into a log call).
// It does NOT catch an indirect leak (e.g. `console.log(profile)` dumping
// the whole record) — that pattern doesn't exist anywhere in this codebase
// today (checked), and is a materially different, noisier heuristic to
// write safely; flagged here as a known limitation rather than silently
// assumed covered.
//
// Run: npx vitest run app/lib/sensitive-profile-fields-logging.test.ts

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

// The fields themselves, not the model name — grep is intentionally scoped
// to the field identifiers so a rename shows up here too (a renamed field
// that still leaks is still a leak).
const SENSITIVE_PROFILE_FIELDS = [
  "dressingRequirementsNote", // religious/cultural free text
  "bustMeasurement",
  "waistMeasurement",
  "hipMeasurement",
  "currentMood",
  "desiredFeeling",
  "confidenceBlockers",
] as const;

const LOGGING_CALL_PATTERN = "console\\.\\(log\\|error\\|warn\\|info\\)\\|captureError\\|captureFailure";

function grepLoggingLinesContaining(field: string): string {
  try {
    // -r app/ (not just .server.ts) so a client-side console.log of a
    // loader's returned profile data would be caught too, not just a
    // server-side log call. Excludes test files and this file itself —
    // the field names necessarily appear in test fixtures/assertions.
    return execSync(
      `grep -rn "${LOGGING_CALL_PATTERN}" app/ --include="*.ts" --include="*.tsx" --include="*.jsx" ` +
        `| grep -v '\\.test\\.' | grep "${field}"`,
      { encoding: "utf8" },
    );
  } catch (err: any) {
    // grep exits 1 when no lines match — that's the PASSING case here.
    if (err.status === 1) return "";
    throw err;
  }
}

describe("C2 — sensitive OnboardingProfile fields never appear on a logging-call line anywhere in the app", () => {
  for (const field of SENSITIVE_PROFILE_FIELDS) {
    it(`"${field}" is never passed to console.log/error/warn/info, captureError, or captureFailure`, () => {
      const hits = grepLoggingLinesContaining(field);
      expect(hits).toBe("");
    });
  }
});
