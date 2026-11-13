// app/lib/pdf-export-dependency-contract.test.ts
//
// Phase 2 ops: guards the fix for the `dompurify` critical vulnerability
// (reached only via the unused npm `jspdf` dependency -> dompurify).
//
// The three "Download PDF" features in this codebase (Trend Report,
// Trend Lens, My Edits) never import the npm `jspdf` package — they load
// jsPDF client-side from a CDN <script> tag in app/root.jsx and read it
// off `window.jspdf`. The npm package was dead weight that existed only
// in package.json, pulling in a critical-severity vulnerable transitive
// dependency (dompurify) for zero runtime benefit. It has been removed.
//
// These tests exist so a future change can't silently reintroduce either
// half of that mistake: adding `jspdf` back to package.json (reopening
// the vulnerability), or removing the CDN script / window.jspdf usage
// (breaking the three PDF export features, which have no other test
// coverage for this specific contract).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const PACKAGE_JSON = readFileSync(resolve(REPO_ROOT, "package.json"), "utf8");
const ROOT_JSX = readFileSync(resolve(REPO_ROOT, "app/root.jsx"), "utf8");

const PDF_EXPORT_FILES = [
  "app/routes/trends.$slug.tsx",
  "app/routes/trends.$slug.lens.$lens.tsx",
  "app/routes/trends.my-edits.$slug.tsx",
];

describe("PDF export dependency contract (jspdf/dompurify vulnerability fix)", () => {
  it("package.json no longer declares the unused npm jspdf dependency", () => {
    const pkg = JSON.parse(PACKAGE_JSON);
    assert.equal(
      pkg.dependencies?.jspdf,
      undefined,
      "jspdf must not be reintroduced as an npm dependency — it pulls in a " +
        "critical-severity vulnerable version of dompurify and is never " +
        "actually imported anywhere; the app uses a CDN script instead " +
        "(see app/root.jsx). If real PDF export needs change, re-evaluate " +
        "deliberately rather than reintroducing this exact dependency.",
    );
  });

  it("app/root.jsx still loads jsPDF from the CDN, matching how the three PDF export routes use it", () => {
    assert.match(
      ROOT_JSX,
      /cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[\d.]+\/jspdf\.umd\.min\.js/,
      "the CDN script is the only source of window.jspdf — removing it " +
        "would break every 'Download PDF' button with no npm fallback",
    );
  });

  for (const file of PDF_EXPORT_FILES) {
    it(`${file} still reads jsPDF off window.jspdf (the CDN global), not an npm import`, () => {
      const src = readFileSync(resolve(REPO_ROOT, file), "utf8");
      assert.match(
        src,
        /\(window as any\)\.jspdf/,
        `${file} must continue using the CDN global, not an npm import of jspdf`,
      );
      assert.ok(
        !/from\s+["']jspdf["']/.test(src),
        `${file} must not import the npm jspdf package directly`,
      );
    });
  }
});
