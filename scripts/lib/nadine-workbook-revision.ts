// scripts/lib/nadine-workbook-revision.ts
// Reads the "NaiaWorkbookRevision" hidden defined name embedded in a NADINE
// workbook's xl/workbook.xml. Shared by extract-naia-catalog.ts (validates the
// canonical file) and promote-nadine-workbook.ts (validates canonical + candidate).
//
// Uses Python3's built-in zipfile/xml (same approach as extract-naia-catalog.ts)
// rather than a Node zip-reading dependency.

import { execSync } from "child_process";

/**
 * Returns the embedded revision string (e.g. "1"), or null if the workbook
 * has no NaiaWorkbookRevision defined name at all (e.g. a pre-versioning
 * snapshot, or a candidate that was never through the promotion workflow).
 */
export function readEmbeddedRevision(workbookPath: string): string | null {
  const pythonScript = `
import zipfile, re
import xml.etree.ElementTree as ET

path = ${JSON.stringify(workbookPath)}
ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

with zipfile.ZipFile(path) as zf:
    wb_xml = zf.read("xl/workbook.xml")

root = ET.fromstring(wb_xml)
value = None
for dn in root.findall(".//x:definedNames/x:definedName", ns):
    if dn.get("name") == "NaiaWorkbookRevision":
        value = dn.text
        break

import sys
sys.stdout.write(value if value is not None else "")
`;
  let out: string;
  try {
    out = execSync("python3 -", {
      input: pythonScript,
      timeout: 30_000,
    }).toString("utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read embedded revision from ${workbookPath}:\n${msg}`);
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}
