// app/lib/ai/taste-evidence-consumer-boundary.test.ts
//
// V1 completion gap #B — consumer-boundary regression for Taste & Evidence.
//
// Governance rule (V1): raw/unconfirmed TasteEvidence/StyleTendency
// inference must never influence a recommendation engine. Only the two
// customer-facing surfaces (the My nAia overview teaser and the What nAia
// Is Noticing page — both already scoped to CONFIRMED-only reads, see
// taste-reconcile.server.ts) may read tendency data. Everything else —
// StyleMe, Wardrobe Intelligence (incl. Shop Smarter), the Buy/Skip
// decision engine, NADINE product assessment, Public Trend Reports, and
// Personalised Trend Edit — must have zero import of the taste engine
// family and zero direct Prisma access to TasteEvidence/StyleTendency.
//
// Modeled directly on colour-family.consumer-boundary.test.ts's ALLOWLIST
// approach: scan every production file in the repo, fail loudly on any
// importer not on the allowlist, rather than asserting a brittle list of
// "forbidden" files that a new file could silently slip past.
//
// The import regex below matches both this codebase's extensionless style
// ("~/lib/ai/taste-reconcile.server") and an explicit-extension style
// ("./taste-contract.js"), for both `from "..."` and `require("...")` —
// the same two forms colour-family's boundary test guards against, after
// an earlier version of that regex silently missed the .js-suffixed form.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

// Any file whose basename matches is part of the taste engine family itself,
// or a test of it — always allowed to import its siblings.
const ALWAYS_ALLOWED_BASENAMES = new Set([
  "taste-contract.ts",
  "taste-contract.test.ts",
  "taste-extraction.server.ts",
  "taste-extraction.test.ts",
  "taste-reconcile.server.ts",
  "taste-reconcile.journeys.test.ts",
  "taste-feedback-engine.ts",
  "taste-feedback.test.ts",
  "taste-feedback.behavior.test.ts",
  "taste-evidence-deletion.test.ts",
  "taste-evidence-consumer-boundary.test.ts",
  "taste-passport-boundary.server.ts",
  "taste-passport-boundary.test.ts",
  "taste-reemergence.behavior.test.ts",
  "taste-backfill-idempotency.test.ts",
  "taste-staleness-deferred.test.ts",
  // Not a taste-family file itself, but its own test — it exercises
  // my-naia._index.tsx's (already an approved production importer below)
  // raw prisma.styleTendency.count call directly, to pin the exact
  // null-inclusive where-clause shape the NULL-exclusion bug fix depends on.
  "my-naia._index.test.tsx",
]);

// The ONLY production (non-test) files permitted to import any member of
// the taste engine family. Extend this set only in a future phase that
// deliberately wires a new consumer — never silently.
const ALLOWED_PRODUCTION_IMPORTERS = new Set([
  "app/lib/closet-item-deletion.server.ts",
  "app/lib/admin/closet-review.server.ts",
  "app/lib/ai/feedback-persistence.server.ts",
  "app/routes/api.taste-observation-feedback.tsx",
  "app/routes/closet._index.tsx",
  "app/routes/api.post-wear-review.tsx",
  "app/routes/style-me/_index.tsx",
  "app/routes/api.styleme-outcome.tsx",
  "app/routes/api.wishlist.jsx",
  "app/routes/my-naia._index.tsx",
  "app/routes/my-naia.what-naia-notices.tsx",
  "scripts/backfill-taste-evidence.ts",
  "app/routes/api.seed-staging.jsx",
  // TEMP QA DIAGNOSTIC (What nAia Is Noticing V1 evidence investigation) —
  // read-only diagnostic engine shared by the local script and the
  // staging-only authenticated route below. Neither writes evidence.
  "app/lib/ai/taste-evidence-diagnostic.server.ts",
]);

const SKIP_DIRS = new Set(["node_modules", ".git", "build", "dist", ".vercel"]);

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
}

const TASTE_MODULE_BASENAMES = [
  "taste-contract",
  "taste-extraction\\.server",
  "taste-reconcile\\.server",
  "taste-feedback-engine",
  "taste-passport-boundary\\.server",
];
const TASTE_IMPORT_RE = new RegExp(
  `from\\s+["'][^"']*(?:${TASTE_MODULE_BASENAMES.join("|")})(?:\\.(?:js|ts|jsx|tsx))?["']` +
    `|require\\(["'][^"']*(?:${TASTE_MODULE_BASENAMES.join("|")})(?:\\.(?:js|ts|jsx|tsx))?["']\\)`,
);

function importsTasteEngine(content: string): boolean {
  return TASTE_IMPORT_RE.test(content);
}

// Belt-and-suspenders: a file could bypass every taste-* module entirely
// and query the two Prisma models directly via its own `~/db.server`
// import. Guard that path too.
const RAW_PRISMA_RE = /prisma\.(tasteEvidence|styleTendency)\./;

describe("Taste & Evidence — production-consumer boundary", () => {
  it("every importer of the taste engine family is either an allowed test/family file or one of the approved production consumers — nothing else", () => {
    const files: string[] = [];
    walk(join(REPO_ROOT, "app"), files);
    walk(join(REPO_ROOT, "scripts"), files);

    const unexpectedImporters: string[] = [];
    const approvedProductionImportersFound = new Set<string>();

    for (const file of files) {
      const base = file.split("/").pop()!;
      const relPath = relative(REPO_ROOT, file);
      if (ALWAYS_ALLOWED_BASENAMES.has(base)) continue;

      const content = readFileSync(file, "utf8");
      if (!importsTasteEngine(content)) continue;

      if (ALLOWED_PRODUCTION_IMPORTERS.has(relPath)) {
        approvedProductionImportersFound.add(relPath);
      } else {
        unexpectedImporters.push(relPath);
      }
    }

    assert.deepEqual(
      unexpectedImporters,
      [],
      `the taste engine has an unapproved importer: ${unexpectedImporters.join(", ")}`,
    );
  });

  it("no production file queries prisma.tasteEvidence/prisma.styleTendency directly except the approved consumers", () => {
    const files: string[] = [];
    walk(join(REPO_ROOT, "app"), files);
    walk(join(REPO_ROOT, "scripts"), files);

    const unexpected: string[] = [];
    for (const file of files) {
      const base = file.split("/").pop()!;
      const relPath = relative(REPO_ROOT, file);
      if (ALWAYS_ALLOWED_BASENAMES.has(base)) continue;
      if (ALLOWED_PRODUCTION_IMPORTERS.has(relPath)) continue;

      const content = readFileSync(file, "utf8");
      if (RAW_PRISMA_RE.test(content)) unexpected.push(relPath);
    }

    assert.deepEqual(unexpected, [], `unexpected direct TasteEvidence/StyleTendency access: ${unexpected.join(", ")}`);
  });

  it("StyleMe, Wardrobe Intelligence (incl. Shop Smarter), Buy/Skip's decision engine, NADINE product assessment, Public Trend Reports, and Personalised Trend Edit remain untouched", () => {
    const forbiddenPaths = [
      // StyleMe
      "app/lib/ai/styleme-result.server.ts",
      "app/lib/ai/styleme-recommendation.ts",
      "app/lib/ai/styleme-anchor.server.ts",
      // Wardrobe Intelligence (Shop Smarter is rendered inside WI, not a separate engine)
      "app/lib/ai/wardrobe-intelligence.server.ts",
      "app/lib/ai/wardrobe-recommendations.ts",
      "app/lib/ai/wardrobe-needs.ts",
      "app/lib/ai/wardrobe-page.ts",
      "app/lib/ai/wardrobe-feedback-evidence.ts",
      "app/lib/ai/styleme-demand-evidence.ts",
      "app/lib/ai/outfit-formula-integrity.ts",
      "app/routes/closet.intelligence.tsx",
      // Buy/Skip decision engine
      "app/lib/buyskip/decision-evidence.server.ts",
      "app/lib/admin/buyskip-admin.server.ts",
      // NADINE product assessment
      "app/lib/ai/nadine-product-assessment.ts",
      // Public Trend Reports
      "app/lib/trend-reports.ts",
      "app/lib/trend-evidence.server.ts",
      // Personalised Trend Edit
      "app/lib/trend-product-recommendation.server.ts",
      "app/lib/plan/personalised-trend-edit-usage.server.ts",
      "app/routes/trends.my-edits.$slug.tsx",
      "app/routes/trends.my-edits.tsx",
    ];
    for (const relPath of forbiddenPaths) {
      const content = readFileSync(join(REPO_ROOT, relPath), "utf8");
      assert.ok(!importsTasteEngine(content), `${relPath} must not import the taste engine`);
      assert.ok(!RAW_PRISMA_RE.test(content), `${relPath} must not query TasteEvidence/StyleTendency directly`);
    }
  });

  it("Buy/Skip's decision-evidence contract still hard-codes tasteEvidence as unavailable, not wired to the real engine", () => {
    const content = readFileSync(join(REPO_ROOT, "app/lib/buyskip/decision-evidence.server.ts"), "utf8");
    assert.ok(/tasteEvidence:\s*["']unavailable["']/.test(content));
  });

  it("the two allowed customer-facing readers only ever read CONFIRMED-scoped tendency data", () => {
    const whatNaiaNotices = readFileSync(
      join(REPO_ROOT, "app/routes/my-naia.what-naia-notices.tsx"),
      "utf8",
    );
    const overview = readFileSync(join(REPO_ROOT, "app/routes/my-naia._index.tsx"), "utf8");
    assert.ok(/loadConfirmedTendencies/.test(whatNaiaNotices));
    assert.ok(/loadStrongestConfirmedTendency/.test(overview));

    const reconcileSrc = readFileSync(join(__dirname, "taste-reconcile.server.ts"), "utf8");
    assert.ok(/state:\s*["']CONFIRMED["']/.test(reconcileSrc));
  });
});
