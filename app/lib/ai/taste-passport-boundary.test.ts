// app/lib/ai/taste-passport-boundary.test.ts
//
// V1 completion — Passport contradiction-awareness boundary tests.
//
// PP.1-2, PP.10-11 exercise the real production PASSPORT_TASTE_MAPPINGS
// table (empty in V1 — see taste-passport-boundary.server.ts's doc
// comment for the audited reason per dimension).
//
// PP.3, PP.5, PP.9 exercise the resolution engine's MECHANISM via an
// injected SYNTHETIC mapping (not a real production dimension) — this
// proves detectPassportContradiction/generateObservationText work
// correctly once a dimension ever does clear the deterministic bar,
// without claiming any of the 5 current dimensions already has.
//
// PP.4, PP.6, PP.7, PP.12 are source-invariant checks proving this module
// and its neighbours in the feedback path have no Passport-write capability
// at all (grep-based, same style as taste-evidence-deletion.test.ts's
// Part B and taste-feedback.test.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectPassportContradiction,
  generateObservationText,
  PASSPORT_TASTE_MAPPINGS,
  type PassportSnapshot,
  type PassportTasteMapping,
  type MappingEvaluation,
} from "./taste-passport-boundary.server.js";
import { TASTE_DIMENSIONS, generateTendencyText } from "./taste-contract.js";

const WORKS_WELL_COMFORT_TEXT = generateTendencyText("comfort", "comfort", "WORKS_WELL", 3, 1, ["STYLEME_OUTCOME"]);
const FRICTION_COMFORT_TEXT = generateTendencyText("comfort", "comfort", "FRICTION", 3, 1, ["STYLEME_OUTCOME"]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const boundarySrc = readFileSync(join(__dirname, "taste-passport-boundary.server.ts"), "utf8");
const reconcileSrc = readFileSync(join(__dirname, "taste-reconcile.server.ts"), "utf8");
const feedbackEngineSrc = readFileSync(join(__dirname, "taste-feedback-engine.ts"), "utf8");
const feedbackRouteSrc = readFileSync(
  join(__dirname, "../../routes/api.taste-observation-feedback.tsx"),
  "utf8",
);

const EMPTY_PASSPORT: PassportSnapshot = {
  styleExpression: [],
  dressingHabits: [],
  silhouette: [],
  fitConcerns: [],
};

// A synthetic test-only mapping: "comfort" tendency conflicts with an
// explicit Passport dressingHabits answer of "comfort-first" only when the
// tendency's dominant polarity is negative (repeated comfort friction
// despite having said comfort comes first). This is NOT a production
// mapping — PASSPORT_TASTE_MAPPINGS stays empty in V1 (see PP.1/PP.11) —
// it exists only to prove the resolution engine and text layer work.
const SYNTHETIC_MAPPING: PassportTasteMapping = {
  passportField: "dressingHabits",
  rationale: "test fixture only — proves the resolution engine, not a real V1 mapping",
  evaluate(passport, _tasteValue, dominantPolarity): MappingEvaluation | null {
    if (!passport.dressingHabits.includes("comfort-first")) return null;
    return { passportValue: "comfort-first", conflicts: dominantPolarity === "negative" };
  },
  describePassportValue(value) {
    if (value === "comfort-first") return "comfort comes first for you when getting dressed";
    return value;
  },
};
const SYNTHETIC_MAPPINGS: Partial<Record<string, PassportTasteMapping>> = { comfort: SYNTHETIC_MAPPING };

describe("PP.1 — no explicit Passport equivalent → no contradiction invented (production table)", () => {
  it("PASSPORT_TASTE_MAPPINGS is empty in V1", () => {
    assert.deepEqual(Object.keys(PASSPORT_TASTE_MAPPINGS), []);
  });

  for (const dimension of TASTE_DIMENSIONS) {
    it(`"${dimension}" → no-explicit-equivalent against the real production table`, () => {
      const result = detectPassportContradiction(dimension, dimension, "negative", {
        styleExpression: ["relaxed"],
        dressingHabits: ["comfort-first"],
        silhouette: ["fitted"],
        fitConcerns: ["tops-pull-bust"],
      });
      assert.equal(result.status, "no-explicit-equivalent");
      assert.equal(result.passportValue, undefined);
    });
  }
});

describe("PP.2 — Passport and tendency agree → ordinary observation", () => {
  it("synthetic mapping: dressingHabits has comfort-first, tendency is POSITIVE comfort → agrees, not conflict", () => {
    const passport: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: ["comfort-first"] };
    const result = detectPassportContradiction("comfort", "comfort", "positive", passport, SYNTHETIC_MAPPINGS);
    assert.equal(result.status, "agrees");
    assert.equal(result.passportValue, "comfort-first");
  });

  it("agreeing observation renders the unmodified base claim text (no conflict framing)", () => {
    const passport: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: ["comfort-first"] };
    const contradiction = detectPassportContradiction("comfort", "comfort", "positive", passport, SYNTHETIC_MAPPINGS);
    const text = generateObservationText(WORKS_WELL_COMFORT_TEXT.claimText, WORKS_WELL_COMFORT_TEXT.rationaleText, contradiction, SYNTHETIC_MAPPING);
    assert.ok(!text.claimText.includes("You've told nAia"));
    assert.ok(!text.claimText.includes("becoming more your style"));
  });
});

describe("PP.3 — deterministic Passport contradiction detected (synthetic mapping)", () => {
  it("dressingHabits has comfort-first, tendency is NEGATIVE comfort → conflict", () => {
    const passport: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: ["comfort-first"] };
    const result = detectPassportContradiction("comfort", "comfort", "negative", passport, SYNTHETIC_MAPPINGS);
    assert.equal(result.status, "conflict");
    assert.equal(result.passportValue, "comfort-first");
    assert.equal(result.passportField, "dressingHabits");
  });
});

describe("PP.4 — conflicting observation does not mutate Passport", () => {
  it("the Passport snapshot object is unchanged after detectPassportContradiction + generateObservationText run", () => {
    const passport: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: ["comfort-first"] };
    const before = JSON.parse(JSON.stringify(passport));
    const contradiction = detectPassportContradiction("comfort", "comfort", "negative", passport, SYNTHETIC_MAPPINGS);
    generateObservationText(FRICTION_COMFORT_TEXT.claimText, FRICTION_COMFORT_TEXT.rationaleText, contradiction, SYNTHETIC_MAPPING);
    assert.deepEqual(passport, before);
  });

  it("the module contains no Customer write call of any kind", () => {
    assert.ok(!/prisma\.customer\.(update|upsert|create|delete)/i.test(boundarySrc));
  });

  it("the module makes no Customer access at all — the Passport fields live on OnboardingProfile", () => {
    // Previously read these four fields directly off Customer via
    // prisma.customer.findUnique — a PrismaClientValidationError in
    // production, since styleExpression/dressingHabits/silhouette/
    // fitConcerns are OnboardingProfile fields, not Customer fields.
    const calls = boundarySrc.match(/prisma\.customer\.\w+\(/g) ?? [];
    assert.deepEqual(calls, []);
  });

  it("the module's only DB access is a single read-only OnboardingProfile findUnique, scoped by customerId", () => {
    const calls = boundarySrc.match(/prisma\.onboardingProfile\.\w+\(/g) ?? [];
    assert.deepEqual(calls, ["prisma.onboardingProfile.findUnique("]);
    assert.ok(/findUnique\(\s*\{\s*where:\s*\{\s*customerId\s*\}/.test(boundarySrc));
  });
});

describe("PP.5 — conflicting observation can still surface as a possible change", () => {
  it("conflict text is non-empty, renderable, and frames a possible evolution rather than a correction", () => {
    const passport: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: ["comfort-first"] };
    const contradiction = detectPassportContradiction("comfort", "comfort", "negative", passport, SYNTHETIC_MAPPINGS);
    const text = generateObservationText(FRICTION_COMFORT_TEXT.claimText, FRICTION_COMFORT_TEXT.rationaleText, contradiction, SYNTHETIC_MAPPING);
    assert.ok(text.claimText.length > 0);
    assert.ok(text.claimText.includes("You've told nAia"));
    assert.ok(text.claimText.includes("becoming more your style"));
    // Never phrased as a correction of the customer.
    assert.ok(!/you('|’)re wrong|that('|’)s incorrect|you made a mistake/i.test(text.claimText));
  });
});

describe("PP.6 — Accurate persists feedback but does not modify Passport", () => {
  it("applyTasteObservationFeedback's accurate path has no Customer/Passport write capability", () => {
    assert.ok(!/prisma\.customer\./.test(feedbackEngineSrc));
    assert.ok(!/passport/i.test(feedbackEngineSrc));
  });

  it("the feedback route never references Customer or Passport fields", () => {
    assert.ok(!/prisma\.customer\.(update|upsert|create)/i.test(feedbackRouteSrc));
    assert.ok(!/passport/i.test(feedbackRouteSrc));
  });
});

describe("PP.7 — Not quite rejects tendency but does not modify Passport", () => {
  it("the REJECTED write path only ever touches styleTendency, never customer", () => {
    // Same source files as PP.6 — the accurate/not-quite branches share one
    // writeFeedback contract with no Passport-reachable dependency either way.
    assert.ok(!/prisma\.customer\./.test(feedbackEngineSrc));
    assert.ok(/state:\s*["']REJECTED["']/.test(feedbackEngineSrc));
  });
});

describe("PP.8 — raw conflicting tendency is not consumed downstream", () => {
  it("taste-passport-boundary.server.ts is imported only by the two allowed customer-facing routes", () => {
    const ROOT = join(__dirname, "../../..");
    const allowed = new Set([
      "app/routes/my-naia._index.tsx",
      // "What nAia Is Noticing" moved into Style Passport (V1 UX restructure);
      // the old route only redirects there now and imports nothing from the
      // taste engine.
      "app/routes/passport.tsx",
    ]);
    const files: string[] = [];
    const skip = new Set(["node_modules", ".git", "build", "dist", ".vercel"]);
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry)) files.push(full);
      }
    })(join(ROOT, "app"));

    const unexpected: string[] = [];
    for (const file of files) {
      const base = file.split("/").pop()!;
      if (base === "taste-passport-boundary.server.ts" || base === "taste-passport-boundary.test.ts") continue;
      const content = readFileSync(file, "utf8");
      const importsIt =
        /from\s+["'][^"']*taste-passport-boundary(?:\.server)?(?:\.(?:js|ts|jsx|tsx))?["']/.test(content) ||
        /require\(["'][^"']*taste-passport-boundary(?:\.server)?(?:\.(?:js|ts|jsx|tsx))?["']\)/.test(content);
      if (!importsIt) continue;
      const rel = file.slice(ROOT.length + 1);
      if (!allowed.has(rel)) unexpected.push(rel);
    }
    assert.deepEqual(unexpected, []);
  });
});

describe("PP.9 — customer A's Passport cannot affect customer B's observation", () => {
  it("results depend only on the snapshot passed in — no cross-call state", () => {
    const customerA: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: ["comfort-first"] };
    const customerB: PassportSnapshot = { ...EMPTY_PASSPORT, dressingHabits: [] };

    const resultA1 = detectPassportContradiction("comfort", "comfort", "negative", customerA, SYNTHETIC_MAPPINGS);
    const resultB = detectPassportContradiction("comfort", "comfort", "negative", customerB, SYNTHETIC_MAPPINGS);
    const resultA2 = detectPassportContradiction("comfort", "comfort", "negative", customerA, SYNTHETIC_MAPPINGS);

    assert.equal(resultA1.status, "conflict");
    assert.equal(resultB.status, "no-passport-data");
    assert.deepEqual(resultA1, resultA2, "calling with customer B in between must not change customer A's result");
  });

  it("loadPassportSnapshot scopes its Prisma read by the given customerId only", () => {
    assert.ok(/where:\s*\{\s*customerId\s*\}/.test(boundarySrc));
  });
});

describe("PP.10 — missing/partial Passport fails safely", () => {
  it("synthetic mapping + empty Passport field → no-passport-data, never a thrown error, never a guessed conflict", () => {
    const result = detectPassportContradiction("comfort", "comfort", "negative", EMPTY_PASSPORT, SYNTHETIC_MAPPINGS);
    assert.equal(result.status, "no-passport-data");
    assert.equal(result.passportValue, undefined);
  });

  it("all 5 real dimensions against a fully empty Passport still resolve safely (no-explicit-equivalent, not a crash)", () => {
    for (const dimension of TASTE_DIMENSIONS) {
      const result = detectPassportContradiction(dimension, dimension, "negative", EMPTY_PASSPORT);
      assert.equal(result.status, "no-explicit-equivalent");
    }
  });
});

describe("PP.11 — unsupported dimension does not use fuzzy inference", () => {
  it("a dimension string with no mapping at all never guesses — not even for an unknown/garbage dimension", () => {
    const result = detectPassportContradiction("not-a-real-dimension", "whatever", "negative", {
      styleExpression: ["relaxed"],
      dressingHabits: ["comfort-first"],
      silhouette: ["fitted"],
      fitConcerns: ["tops-pull-bust"],
    });
    assert.equal(result.status, "no-explicit-equivalent");
  });
});

describe("PP.12 — explicit Passport truth remains separately retrievable and unchanged after reconciliation", () => {
  it("taste-reconcile.server.ts (the real reconciliation engine) never writes to Customer/Passport", () => {
    assert.ok(!/prisma\.customer\.(update|upsert|create|delete)/i.test(reconcileSrc));
  });

  it("the boundary module never caches or memoizes a Passport snapshot across calls", () => {
    // No module-level mutable state that could leak a previous customer's
    // Passport into the next call.
    assert.ok(!/^\s*let\s+\w*[Pp]assport/m.test(boundarySrc));
    assert.ok(!/^\s*const\s+\w*[Cc]ache\w*\s*=/m.test(boundarySrc));
  });
});
