// scripts/nadine-workbook.manifest.ts
// Committed source-of-truth pin for the canonical NADINE workbook.
// The .xlsx itself is gitignored (.claude/) — this small file is the durable,
// git-tracked record of which exact workbook is currently approved, and its
// git history (`git log -p -- scripts/nadine-workbook.manifest.ts`) is the
// audit trail a gitignored binary can't provide on its own.
//
// WORKFLOW — read this before touching the canonical workbook:
//   A legitimate workbook update must NEVER blindly overwrite the canonical
//   .xlsx from an uploaded attachment. Instead:
//     1. Start from the current canonical workbook (this manifest's
//        workbookRevision/approvedSha256 identify it exactly), or explicitly
//        diff/migrate an uploaded candidate against it — never assume an
//        attachment supersedes the canonical file just because it was given.
//     2. Use `scripts/promote-nadine-workbook.ts` to validate a candidate
//        (it enforces the candidate's embedded revision === this manifest's
//        current workbookRevision, and prints a product-level diff) before
//        anything is promoted. It defaults to a dry run — pass --apply only
//        once the diff has actually been reviewed and approved.
//     3. Promotion embeds workbookRevision + 1 into the candidate, computes
//        its SHA-256, installs it as the new canonical file, and rewrites
//        this manifest to match — all four of those must move together.
//   Why: SHA-256 alone cannot detect a stale-but-different workbook being
//   reintroduced — whoever installs it just recomputes the hash to match.
//   The embedded, monotonically-increasing revision (stored in the workbook
//   itself via a hidden defined name — see promote-nadine-workbook.ts) is
//   the thing that can't be satisfied by an older snapshot.
//
// See scripts/extract-naia-catalog.ts for the normal (non-promotion)
// extraction path, which validates the canonical workbook against every
// field below on every run.

export const NADINE_WORKBOOK_MANIFEST = {
  /** Embedded in the workbook itself as a hidden defined name "NaiaWorkbookRevision". */
  workbookRevision: 1,
  /** SHA-256 of the canonical .xlsx, computed AFTER the revision marker was embedded. */
  approvedSha256:
    "5ad4468e46f92c911c9cd078d51a47f5e1d419449c81e27be132f21041388d74",
  /** Hard-fails extraction if the workbook doesn't parse to exactly this many products. */
  expectedProductCount: 11,
  /** Catalog-repo commit this workbook revision was approved alongside. Informational only. */
  approvedAtCatalogCommit: "0236e63",
  /** Filename the canonical workbook is expected to have at its fixed path. */
  sourceWorkbookFilename: "PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx",
} as const;
