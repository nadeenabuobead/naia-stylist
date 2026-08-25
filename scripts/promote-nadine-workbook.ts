// scripts/promote-nadine-workbook.ts
// Validates and (only with --apply) promotes a candidate NADINE workbook to
// become the new canonical source. See scripts/nadine-workbook.manifest.ts
// for the full workflow this exists to enforce.
//
// Usage:
//   tsx scripts/promote-nadine-workbook.ts <candidate.xlsx>            # dry run
//   tsx scripts/promote-nadine-workbook.ts <candidate.xlsx> --apply    # promote
//
// Dry run (default): validates the candidate and prints a product-level diff
// against the current canonical workbook. Makes no changes anywhere.
//
// --apply: after the same validation, embeds workbookRevision + 1 into the
// candidate, installs it as the new canonical workbook, and updates the
// manifest to match. Only run this after actually reviewing the dry-run diff.
//
// This script owns the revision increment — a candidate is expected to still
// carry the CURRENT revision (i.e. it's an edited copy of the canonical file,
// not something that's already been promoted or invented its own numbering).

import { execSync } from "child_process";
import { createHash } from "crypto";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { NADINE_WORKBOOK_MANIFEST } from "./nadine-workbook.manifest.js";
import { readEmbeddedRevision } from "./lib/nadine-workbook-revision.js";
import { runPythonExtraction } from "./extract-naia-catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CANONICAL_PATH = resolve(
  __dirname,
  "../.claude/reference/styleme/PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx",
);
const MANIFEST_PATH = resolve(__dirname, "nadine-workbook.manifest.ts");

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ─── Product-level diff ────────────────────────────────────────────────────────

function diffProducts(
  canonical: Record<string, string>[],
  candidate: Record<string, string>[],
): { hasChanges: boolean } {
  const canByHandle = new Map(canonical.map((p) => [p.handle, p]));
  const candByHandle = new Map(candidate.map((p) => [p.handle, p]));
  let hasChanges = false;

  const added = [...candByHandle.keys()].filter((h) => !canByHandle.has(h));
  const removed = [...canByHandle.keys()].filter((h) => !candByHandle.has(h));

  if (added.length > 0) {
    hasChanges = true;
    console.log(`\nProducts added (${added.length}): ${added.join(", ")}`);
  }
  if (removed.length > 0) {
    hasChanges = true;
    console.log(`\nProducts removed (${removed.length}): ${removed.join(", ")}`);
  }

  for (const [handle, canProduct] of canByHandle) {
    const candProduct = candByHandle.get(handle);
    if (!candProduct) continue; // already reported above
    const fieldDiffs: string[] = [];
    const allFields = new Set([...Object.keys(canProduct), ...Object.keys(candProduct)]);
    for (const field of allFields) {
      const before = canProduct[field] ?? "";
      const after = candProduct[field] ?? "";
      if (before !== after) {
        fieldDiffs.push(`    ${field}:\n      - ${JSON.stringify(before)}\n      + ${JSON.stringify(after)}`);
      }
    }
    if (fieldDiffs.length > 0) {
      hasChanges = true;
      console.log(`\n${handle} (${fieldDiffs.length} field${fieldDiffs.length === 1 ? "" : "s"} changed):`);
      console.log(fieldDiffs.join("\n"));
    }
  }

  if (!hasChanges) {
    console.log("\nNo product-data differences found (candidate is byte-for-byte");
    console.log("identical to canonical at the field level, or differs only in");
    console.log("formatting the extractor doesn't read).");
  }

  return { hasChanges };
}

// ─── Main ───────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const candidatePath = args.find((a) => !a.startsWith("--"));

  if (!candidatePath) {
    fail(
      "Usage: tsx scripts/promote-nadine-workbook.ts <candidate.xlsx> [--apply]",
    );
  }
  const resolvedCandidatePath = resolve(candidatePath);

  console.log("NADINE workbook promotion — " + (apply ? "APPLY" : "DRY RUN"));
  console.log(`Canonical: ${CANONICAL_PATH}`);
  console.log(`Candidate: ${resolvedCandidatePath}`);

  const N = NADINE_WORKBOOK_MANIFEST.workbookRevision;

  // 1. Canonical workbook's own embedded revision must equal the manifest.
  const canonicalEmbedded = readEmbeddedRevision(CANONICAL_PATH);
  if (canonicalEmbedded !== String(N)) {
    fail(
      `Canonical workbook's embedded revision (${canonicalEmbedded ?? "none"}) does not ` +
      `match the manifest's workbookRevision (${N}). The canonical file and manifest have ` +
      `drifted — resolve this before attempting a promotion.`,
    );
  }
  console.log(`✓ Canonical workbook confirmed at revision ${N}`);

  // 2/3. Candidate must identify its base revision as exactly N — reject missing, older, or newer.
  const candidateEmbedded = readEmbeddedRevision(resolvedCandidatePath);
  if (candidateEmbedded === null) {
    fail(
      `Candidate has no embedded NaiaWorkbookRevision at all. It was never derived from ` +
      `the canonical workbook via this workflow — do not promote it directly. Start from ` +
      `the current canonical file (revision ${N}) and re-apply the intended changes to it.`,
    );
  }
  const candidateRev = Number(candidateEmbedded);
  if (candidateRev < N) {
    fail(
      `Candidate's embedded revision (${candidateRev}) is OLDER than the current canonical ` +
      `revision (${N}). This is exactly the stale-snapshot scenario this guard exists to ` +
      `stop — refusing to promote. Do not overwrite the canonical workbook with this file.`,
    );
  }
  if (candidateRev > N) {
    fail(
      `Candidate's embedded revision (${candidateRev}) is NEWER than the current canonical ` +
      `revision (${N}). Either the manifest is behind a promotion that already happened, or ` +
      `this candidate was already promoted/edited outside this workflow. Investigate before ` +
      `proceeding — refusing to promote.`,
    );
  }
  console.log(`✓ Candidate confirmed based on current revision ${N}`);

  // 4. Diff candidate vs canonical before allowing promotion.
  console.log("\nExtracting both workbooks for a product-level diff...");
  const canonicalProducts = runPythonExtraction(CANONICAL_PATH);
  const candidateProducts = runPythonExtraction(resolvedCandidatePath);
  const { hasChanges } = diffProducts(canonicalProducts, candidateProducts);

  if (!apply) {
    console.log(
      `\nDry run complete. Re-run with --apply once this diff has been reviewed ` +
      `and approved to promote this candidate to revision ${N + 1}.`,
    );
    return;
  }

  if (!hasChanges) {
    console.log(
      "\nNo changes detected — nothing to promote. (If you intended to force a " +
      "revision bump with no content change, do that manually.)",
    );
    return;
  }

  // 5. Embed N+1 into the candidate (surgical — same pattern as the initial
  //    revision-1 embed, but replacing an existing value rather than the
  //    empty <definedNames/> placeholder).
  console.log(`\nApplying: promoting candidate to revision ${N + 1}...`);
  const newRevision = N + 1;
  const embedScript = `
import zipfile, re

SRC = ${JSON.stringify(resolvedCandidatePath)}
DST = ${JSON.stringify(resolvedCandidatePath + ".promoted.tmp")}

with zipfile.ZipFile(SRC) as zin:
    wb_xml = zin.read("xl/workbook.xml").decode("utf-8")

OLD = '<definedName name="NaiaWorkbookRevision" hidden="1">${N}</definedName>'
NEW = '<definedName name="NaiaWorkbookRevision" hidden="1">${newRevision}</definedName>'
assert wb_xml.count(OLD) == 1, f"expected exactly 1 occurrence of {OLD!r}, found {wb_xml.count(OLD)}"
new_wb_xml = wb_xml.replace(OLD, NEW)

with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "xl/workbook.xml":
            data = new_wb_xml.encode("utf-8")
        zout.writestr(item, data)
print("ok")
`;
  try {
    execSync("python3 -", { input: embedScript, timeout: 30_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Failed to embed revision ${newRevision} into candidate:\n${msg}`);
  }
  const promotedPath = resolvedCandidatePath + ".promoted.tmp";

  // 6. Compute new SHA, back up the outgoing canonical file, install, update manifest.
  const newSha256 = sha256Of(promotedPath);
  const backupPath = CANONICAL_PATH + `.rev${N}.bak`;
  copyFileSync(CANONICAL_PATH, backupPath);
  copyFileSync(promotedPath, CANONICAL_PATH);

  const manifestSrc = readFileSync(MANIFEST_PATH, "utf8");
  const updatedManifest = manifestSrc
    .replace(/workbookRevision:\s*\d+/, `workbookRevision: ${newRevision}`)
    .replace(/approvedSha256:\s*\n?\s*"[0-9a-f]{64}"/, `approvedSha256:\n    "${newSha256}"`);
  if (updatedManifest === manifestSrc) {
    fail(
      "Manifest text did not change after substitution — refusing to leave the workbook " +
      "promoted but the manifest stale. Update scripts/nadine-workbook.manifest.ts by hand " +
      `to workbookRevision: ${newRevision} / approvedSha256: "${newSha256}" and investigate ` +
      "why the automatic replacement didn't match.",
    );
  }
  writeFileSync(MANIFEST_PATH, updatedManifest, "utf8");

  console.log(`✓ Canonical workbook promoted to revision ${newRevision}`);
  console.log(`✓ Previous canonical backed up to: ${backupPath}`);
  console.log(`✓ Manifest updated: workbookRevision=${newRevision}, approvedSha256=${newSha256}`);
  console.log(
    `\nNext: run "tsx scripts/extract-naia-catalog.ts" to regenerate the catalog, ` +
    `then run the catalog + StyleMe test suites before committing.`,
  );
}

main();
