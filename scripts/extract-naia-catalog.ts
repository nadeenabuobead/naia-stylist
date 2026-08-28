// scripts/extract-naia-catalog.ts
// Deterministic catalog extraction from V8 workbook.
// Reads PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx via Python3 (built-in zipfile + xml),
// validates, parses, and writes app/lib/ai/generated/naia-catalog.generated.ts.
//
// Usage:
//   tsx scripts/extract-naia-catalog.ts
//
// Requirements: Python 3 on PATH. No npm XLSX package needed.
// DO NOT stage, commit, push, or deploy the output automatically.

import { execSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  PRODUCT_ELIGIBILITY,
  PRODUCT_TEMPLATE_FIELDS,
} from "../app/lib/ai/signal-contract.js";
import type {
  DressingMetadata,
  SleeveLength,
  NecklineCoverage,
  HemLength,
  TopLength,
  FitProfile,
} from "../app/lib/ai/signal-contract.js";
import type {
  CatalogParsed,
  CatalogSourceFields,
  GeneratedCatalog,
  GeneratedCatalogProduct,
  ProductItemType,
  StylingEffortLevel,
} from "../app/lib/ai/naia-catalog.types.js";
import { NADINE_WORKBOOK_MANIFEST } from "./nadine-workbook.manifest.js";
import { readEmbeddedRevision } from "./lib/nadine-workbook-revision.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKBOOK_PATH = resolve(
  __dirname,
  "../.claude/reference/styleme/PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx",
);
// SHA-256, embedded workbook revision, and expected product count are no longer
// pinned here — they live in scripts/nadine-workbook.manifest.ts (committed,
// single source of truth; naia-catalog.test.ts and naia-product-media.test.ts
// import the same constant rather than each keeping their own copy). See that
// file for the full workbook-update workflow and why a SHA pin alone isn't
// sufficient protection against a stale-but-valid workbook snapshot.
const OUTPUT_PATH = resolve(
  __dirname,
  "../app/lib/ai/generated/naia-catalog.generated.ts",
);
const SCHEMA_VERSION = 1;
const SOURCE_WORKBOOK = "PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx";
const LIVE_URL_BASE = "https://naiabynadine.com/products/";

// ─── Workbook identity verification ────────────────────────────────────────────
// Three independent checks, all against scripts/nadine-workbook.manifest.ts:
// SHA-256 (exact byte identity), embedded revision (catches a stale-but-different
// workbook whose installer only remembered to update the SHA pin), and — after
// extraction — product count. All three must agree for extraction to proceed.

/** Verifies the canonical workbook's SHA-256 and returns it (used as generated metadata). */
function verifySha256(): string {
  const bytes = readFileSync(WORKBOOK_PATH);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== NADINE_WORKBOOK_MANIFEST.approvedSha256) {
    throw new Error(
      `Workbook SHA-256 mismatch.\n` +
      `  Expected (manifest): ${NADINE_WORKBOOK_MANIFEST.approvedSha256}\n` +
      `  Got (on disk):       ${hash}\n` +
      `If this workbook update is intentional, use scripts/promote-nadine-workbook.ts ` +
      `rather than overwriting the canonical file directly.`,
    );
  }
  console.log(`✓ Workbook SHA-256 verified: ${hash}`);
  return hash;
}

/** Verifies the workbook's embedded NaiaWorkbookRevision matches the manifest. */
function verifyEmbeddedRevision(): void {
  const embedded = readEmbeddedRevision(WORKBOOK_PATH);
  const expected = String(NADINE_WORKBOOK_MANIFEST.workbookRevision);
  if (embedded !== expected) {
    throw new Error(
      `Workbook embedded revision mismatch.\n` +
      `  Expected (manifest): ${expected}\n` +
      `  Got (embedded in workbook): ${embedded ?? "(none found)"}\n` +
      `The workbook's SHA-256 matched but its embedded NaiaWorkbookRevision did not — ` +
      `this indicates the manifest and the workbook file have drifted out of sync. ` +
      `Do not hand-edit either one; use scripts/promote-nadine-workbook.ts.`,
    );
  }
  console.log(`✓ Workbook embedded revision verified: ${embedded}`);
}

// ─── Python extraction ────────────────────────────────────────────────────────

export function buildPythonScript(workbookPath: string): string {
  return `WORKBOOK_PATH = ${JSON.stringify(workbookPath)}

import json, zipfile, re
import xml.etree.ElementTree as ET

# Normalized label → camelCase field key.
# Normalization: strip().lower(), "formaility" → "formality".
LABEL_TO_KEY = {
    "verified title": "verifiedTitle",
    "handle": "handle",
    "live url": "liveUrl",
    "featured image url": "featuredImageUrl",
    "item type": "itemType",
    "styleable components": "styleableComponents",
    "colors": "colors",
    "silhouette": "silhouette",
    "fit": "fit",
    "fabric": "fabric",
    "active/published": "activePublished",
    "art story description": "artStoryDescription",
    "styling role": "stylingRole",
    "desired feeling match": "desiredFeelingMatch",
    "style personality match": "stylePersonalityMatch",
    "style tags": "styleTags",
    "occasion tags": "occasionTags",
    "product style descriptors": "productStyleDescriptors",
    "formality score": "formalityScore",
    "formality level": "formalityScore",
    "formality description": "formalityDescription",
    "season": "season",
    "body/fit logic": "bodyFitLogic",
    "body proportion effects": "bodyProportionEffects",
    "style me comfort match": "styleMeComfortMatch",
    "coverage/modesty": "coverageModesty",
    "proportion rule": "proportionRule",
    "not ideal for": "notIdealFor",
    "current emotional state support": "currentEmotionalStateSupport",
    "emotional support logic": "emotionalSupportLogic",
    "practical support match": "practicalSupportMatch",
    "practical support logic": "practicalSupportLogic",
    "styling effort level": "stylingEffortLevel",
    "best paired with - nadine pieces": "bestPairedWithNadinePieces",
    "conditional nadine pairings": "conditionalNadinePairings",
    "avoid pairing with - nadine pieces": "avoidPairingWithNadinePieces",
    "best paired with - general": "bestPairedWithGeneral",
    "avoid pairing with - general": "avoidPairingWithGeneral",
    "pairing reason": "pairingReason",
    "accessories direction": "accessoriesDirection",
    "shoe direction": "shoeDirection",
    "color direction": "colorDirection",
    "skin-tone colour harmony": "skinToneColourHarmony",
    "complexion styling note": "complexionStylingNote",
    "hair styling direction": "hairStylingDirection",
    "hair styling note": "hairStylingNote",
    "styleme explanation": "styleMeExplanation",
    # Dressing metadata — added V8 Rev 3 (Group 2 / Rev 5 spec)
    "modesty safe": "modestySafe",
    "abaya compatible": "abayaCompatible",
    "hijab compatible": "hijabCompatible",
    "sleeve length": "sleeveLength",
    "neckline coverage": "necklineCoverage",
    "hem length": "hemLength",
    "top length": "topLength",
    "fit profile": "fitProfile",
}

# Stable canonical key order (fields 1-54: 46 original + 8 dressing metadata).
CANONICAL_ORDER = [
    "verifiedTitle", "handle", "liveUrl", "featuredImageUrl", "itemType",
    "styleableComponents", "colors", "silhouette", "fit", "fabric",
    "activePublished", "artStoryDescription", "stylingRole",
    "desiredFeelingMatch", "stylePersonalityMatch", "styleTags",
    "occasionTags", "productStyleDescriptors", "formalityScore",
    "formalityDescription", "season", "bodyFitLogic",
    "bodyProportionEffects", "styleMeComfortMatch", "coverageModesty",
    "proportionRule", "notIdealFor", "currentEmotionalStateSupport",
    "emotionalSupportLogic", "practicalSupportMatch", "practicalSupportLogic",
    "stylingEffortLevel", "bestPairedWithNadinePieces",
    "conditionalNadinePairings", "avoidPairingWithNadinePieces",
    "bestPairedWithGeneral", "avoidPairingWithGeneral", "pairingReason",
    "accessoriesDirection", "shoeDirection", "colorDirection",
    "skinToneColourHarmony", "complexionStylingNote", "hairStylingDirection",
    "hairStylingNote", "styleMeExplanation",
    # Dressing metadata
    "modestySafe", "abayaCompatible", "hijabCompatible",
    "sleeveLength", "necklineCoverage", "hemLength", "topLength", "fitProfile",
]
CANONICAL_KEYS = set(CANONICAL_ORDER)

# No longer populated in any Rev 3+ product block (workbook restructured 2026-08-24
# to drop the reasoning-essay columns). Extraction tolerates their absence and
# defaults to "" rather than treating them as required.
# All 8 dressing metadata fields (modestySafe … fitProfile) are now required —
# they were temporary optional during the Rev 2→3 promotion dry-run only.
OPTIONAL_KEYS = {"emotionalSupportLogic", "practicalSupportLogic"}

def norm(label):
    s = label.strip().lower()
    s = s.replace("formaility", "formality")
    return s

def parse_xlsx(path):
    with zipfile.ZipFile(path) as zf:
        ss_xml = zf.read("xl/sharedStrings.xml").decode("utf-8")
        ss_root = ET.fromstring(ss_xml)
        ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        shared = []
        for si in ss_root.findall("x:si", ns):
            parts = []
            for t in si.findall(".//x:t", ns):
                if t.text:
                    parts.append(t.text)
            shared.append("".join(parts))

        sheet_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
        sheet_root = ET.fromstring(sheet_xml)

        col_a = {}
        col_b = {}
        for row_el in sheet_root.findall(".//x:row", ns):
            for cell in row_el.findall("x:c", ns):
                ref = cell.get("r")
                if not ref:
                    continue
                m = re.match(r"([AB])(\\d+)$", ref)
                if not m:
                    continue
                col, rn = m.group(1), int(m.group(2))
                t = cell.get("t")
                v_el = cell.find("x:v", ns)
                if v_el is None or v_el.text is None:
                    val = ""
                elif t == "s":
                    val = shared[int(v_el.text)]
                elif t == "inlineStr":
                    parts = []
                    for tp in cell.findall(".//x:t", ns):
                        if tp.text:
                            parts.append(tp.text)
                    val = "".join(parts)
                else:
                    val = v_el.text
                if col == "A":
                    col_a[rn] = val
                else:
                    col_b[rn] = val
        return col_a, col_b

def extract(col_a, col_b):
    title_rows = sorted(
        r for r, v in col_a.items() if norm(v) == "verified title"
    )
    if len(title_rows) != 11:
        raise ValueError(f"Expected 11 products, found {len(title_rows)}")

    all_rows = sorted(col_a.keys())
    products = []
    for i, start in enumerate(title_rows):
        end = title_rows[i + 1] - 1 if i + 1 < len(title_rows) else max(all_rows)

        found = {}  # camelCase key → row
        for r in range(start, end + 1):
            raw_label = col_a.get(r, "")
            if not raw_label.strip():
                continue
            n = norm(raw_label)
            if n not in LABEL_TO_KEY:
                continue
            key = LABEL_TO_KEY[n]
            if key in found:
                raise ValueError(
                    f"Product {i+1}: duplicate field '{key}' at row {r}"
                )
            found[key] = r

        missing = CANONICAL_KEYS - OPTIONAL_KEYS - set(found.keys())
        if missing:
            raise ValueError(
                f"Product {i+1}: missing required fields: {sorted(missing)}"
            )
        expected_count = 54 - len(OPTIONAL_KEYS - set(found.keys()))
        if len(found) != expected_count:
            raise ValueError(
                f"Product {i+1}: {len(found)} fields found, expected {expected_count}"
            )

        raw = {k: col_b.get(found.get(k), "") for k in CANONICAL_ORDER}
        products.append(raw)

    return products

col_a, col_b = parse_xlsx(WORKBOOK_PATH)
products = extract(col_a, col_b)
import sys
json.dump(products, sys.stdout, ensure_ascii=False)
`;
}

/**
 * Runs the Python extraction against an arbitrary workbook path and returns
 * the raw (untransformed) per-product field dicts. Shared by main() (for the
 * canonical workbook) and promote-nadine-workbook.ts (for canonical + candidate,
 * to build a product-level diff before promotion).
 */
export function runPythonExtraction(workbookPath: string): Record<string, string>[] {
  const pythonScript = buildPythonScript(workbookPath);
  let rawJson: string;
  try {
    rawJson = execSync("python3 -", {
      input: pythonScript,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
    }).toString("utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Python extraction failed for ${workbookPath}:\n${msg}`);
  }
  return JSON.parse(rawJson);
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function trimScalar(raw: string): string {
  return raw.trim();
}

function parseLiveUrl(raw: string, handle: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === LIVE_URL_BASE) return null;
  if (!trimmed.startsWith(LIVE_URL_BASE)) return null;
  const slug = trimmed.slice(LIVE_URL_BASE.length).replace(/\/$/, "");
  return slug === handle ? trimmed : null;
}

function parseFeaturedImageUrl(raw: string): string | null {
  return raw.trim() || null;
}

function parseItemType(raw: string): ProductItemType {
  const val = raw.trim();
  const valid = new Set<string>(["TOP", "BOTTOM", "OUTERWEAR", "DRESS", "SET"]);
  if (!valid.has(val)) throw new Error(`Invalid item type: ${JSON.stringify(raw)}`);
  return val as ProductItemType;
}

function parseStyleableComponents(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return [];
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseCommaSplit(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseTokenArray(raw: string): string[] {
  const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}

function parseFormalityScore(raw: string): number {
  const n = parseFloat(raw.trim());
  if (!isFinite(n)) throw new Error(`Invalid formality score: ${JSON.stringify(raw)}`);
  return n;
}

function parseStylingEffortLevel(raw: string): StylingEffortLevel {
  const val = raw.trim().toLowerCase();
  if (val !== "low" && val !== "medium" && val !== "high") {
    throw new Error(`Invalid styling effort level: ${JSON.stringify(raw)}`);
  }
  return val as StylingEffortLevel;
}

function parseNadinePairing(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "none") return null;
  return trimmed || null;
}

// ─── Dressing metadata ────────────────────────────────────────────────────────
// Parsed directly from the V8 workbook (Rev 3+). Each product block carries
// 8 structured dressing fields that are extracted into raw[] and then validated
// here. Rule semantics applied by checkHardExclusions() in styleme-recommendation.ts.

const VALID_SLEEVE_LENGTHS = new Set<string>([
  "full", "three-quarter", "short", "sleeveless", "n/a",
]);
const VALID_NECKLINE_COVERAGES = new Set<string>([
  "high", "crew", "mock", "cowl-high", "wrap-variable", "n/a",
]);
const VALID_HEM_LENGTHS = new Set<string>([
  "full", "maxi", "midi", "knee", "mini", "n/a",
]);
const VALID_TOP_LENGTHS = new Set<string>([
  "hip-length", "longline", "tunic", "cropped", "n/a",
]);
const VALID_FIT_PROFILES = new Set<string>([
  "fitted", "tailored", "relaxed", "loose", "oversized", "flowy",
  "body-skimming", "n/a",
]);

export function parseDressingMetadata(
  raw: Record<string, string>,
): DressingMetadata {
  const parseBool = (key: string): boolean => {
    const v = (raw[key] ?? "").trim().toUpperCase();
    if (v === "TRUE") return true;
    if (v === "FALSE") return false;
    throw new Error(
      `dressingMetadata.${key}: expected TRUE or FALSE, got ${JSON.stringify(raw[key] ?? "(missing)")}`,
    );
  };
  const parseEnum = <T extends string>(key: string, valid: Set<string>): T => {
    const v = (raw[key] ?? "").trim();
    if (!v) {
      throw new Error(`dressingMetadata.${key}: missing value`);
    }
    if (!valid.has(v)) {
      throw new Error(
        `dressingMetadata.${key}: invalid value ${JSON.stringify(v)}, ` +
        `must be one of ${[...valid].join(", ")}`,
      );
    }
    return v as T;
  };
  return {
    modestySafe: parseBool("modestySafe"),
    abayaCompatible: parseBool("abayaCompatible"),
    hijabCompatible: parseBool("hijabCompatible"),
    sleeveLength: parseEnum<SleeveLength>("sleeveLength", VALID_SLEEVE_LENGTHS),
    necklineCoverage: parseEnum<NecklineCoverage>("necklineCoverage", VALID_NECKLINE_COVERAGES),
    hemLength: parseEnum<HemLength>("hemLength", VALID_HEM_LENGTHS),
    topLength: parseEnum<TopLength>("topLength", VALID_TOP_LENGTHS),
    fitProfile: parseEnum<FitProfile>("fitProfile", VALID_FIT_PROFILES),
  };
}

// ─── Transform raw JSON → GeneratedCatalogProduct ────────────────────────────

function buildSourceFields(raw: Record<string, string>): CatalogSourceFields {
  const f = PRODUCT_TEMPLATE_FIELDS;
  return {
    [f.VERIFIED_TITLE]: raw.verifiedTitle,
    [f.HANDLE]: raw.handle,
    [f.LIVE_URL]: raw.liveUrl,
    [f.FEATURED_IMAGE_URL]: raw.featuredImageUrl,
    [f.ITEM_TYPE]: raw.itemType,
    [f.STYLEABLE_COMPONENTS]: raw.styleableComponents,
    [f.COLORS]: raw.colors,
    [f.SILHOUETTE]: raw.silhouette,
    [f.FIT]: raw.fit,
    [f.FABRIC]: raw.fabric,
    [f.ACTIVE_PUBLISHED]: raw.activePublished,
    [f.ART_STORY_DESCRIPTION]: raw.artStoryDescription,
    [f.STYLING_ROLE]: raw.stylingRole,
    [f.DESIRED_FEELING_MATCH]: raw.desiredFeelingMatch,
    [f.STYLE_PERSONALITY_MATCH]: raw.stylePersonalityMatch,
    [f.STYLE_TAGS]: raw.styleTags,
    [f.OCCASION_TAGS]: raw.occasionTags,
    [f.PRODUCT_STYLE_DESCRIPTORS]: raw.productStyleDescriptors,
    [f.FORMALITY_SCORE]: raw.formalityScore,
    [f.FORMALITY_DESCRIPTION]: raw.formalityDescription,
    [f.SEASON]: raw.season,
    [f.BODY_FIT_LOGIC]: raw.bodyFitLogic,
    [f.BODY_PROPORTION_EFFECTS]: raw.bodyProportionEffects,
    [f.STYLE_ME_COMFORT_MATCH]: raw.styleMeComfortMatch,
    [f.COVERAGE_MODESTY]: raw.coverageModesty,
    [f.PROPORTION_RULE]: raw.proportionRule,
    [f.NOT_IDEAL_FOR]: raw.notIdealFor,
    [f.CURRENT_EMOTIONAL_STATE_SUPPORT]: raw.currentEmotionalStateSupport,
    [f.EMOTIONAL_SUPPORT_LOGIC]: raw.emotionalSupportLogic,
    [f.PRACTICAL_SUPPORT_MATCH]: raw.practicalSupportMatch,
    [f.PRACTICAL_SUPPORT_LOGIC]: raw.practicalSupportLogic,
    [f.STYLING_EFFORT_LEVEL]: raw.stylingEffortLevel,
    [f.BEST_PAIRED_WITH_NADINE]: raw.bestPairedWithNadinePieces,
    [f.CONDITIONAL_NADINE_PAIRINGS]: raw.conditionalNadinePairings,
    [f.AVOID_PAIRING_WITH_NADINE]: raw.avoidPairingWithNadinePieces,
    [f.BEST_PAIRED_WITH_GENERAL]: raw.bestPairedWithGeneral,
    [f.AVOID_PAIRING_WITH_GENERAL]: raw.avoidPairingWithGeneral,
    [f.PAIRING_REASON]: raw.pairingReason,
    [f.ACCESSORIES_DIRECTION]: raw.accessoriesDirection,
    [f.SHOE_DIRECTION]: raw.shoeDirection,
    [f.COLOR_DIRECTION]: raw.colorDirection,
    [f.SKIN_TONE_COLOUR_HARMONY]: raw.skinToneColourHarmony,
    [f.COMPLEXION_STYLING_NOTE]: raw.complexionStylingNote,
    [f.HAIR_STYLING_DIRECTION]: raw.hairStylingDirection,
    [f.HAIR_STYLING_NOTE]: raw.hairStylingNote,
    [f.STYLEME_EXPLANATION]: raw.styleMeExplanation,
    [f.MODESTY_SAFE]: raw.modestySafe,
    [f.ABAYA_COMPATIBLE]: raw.abayaCompatible,
    [f.HIJAB_COMPATIBLE]: raw.hijabCompatible,
    [f.SLEEVE_LENGTH]: raw.sleeveLength,
    [f.NECKLINE_COVERAGE]: raw.necklineCoverage,
    [f.HEM_LENGTH]: raw.hemLength,
    [f.TOP_LENGTH]: raw.topLength,
    [f.FIT_PROFILE]: raw.fitProfile,
  } as CatalogSourceFields;
}

function parseParsed(raw: Record<string, string>): CatalogParsed {
  const handle = raw.handle.trim();
  return {
    identity: {
      verifiedTitle: trimScalar(raw.verifiedTitle),
      liveUrl: parseLiveUrl(raw.liveUrl, handle),
      featuredImageUrl: parseFeaturedImageUrl(raw.featuredImageUrl),
      itemType: parseItemType(raw.itemType),
      styleableComponents: parseStyleableComponents(raw.styleableComponents),
      colors: parseCommaSplit(raw.colors),
      silhouette: trimScalar(raw.silhouette),
      fit: trimScalar(raw.fit),
      fabric: trimScalar(raw.fabric),
      activePublished: trimScalar(raw.activePublished),
      artStoryDescription: trimScalar(raw.artStoryDescription),
    },
    rankings: {
      desiredFeelingMatch: parseTokenArray(raw.desiredFeelingMatch),
      stylePersonalityMatch: parseTokenArray(raw.stylePersonalityMatch),
      styleTags: parseTokenArray(raw.styleTags),
      occasionTags: parseTokenArray(raw.occasionTags),
      season: parseTokenArray(raw.season),
      bodyProportionEffects: parseTokenArray(raw.bodyProportionEffects),
      styleMeComfortMatch: parseTokenArray(raw.styleMeComfortMatch),
      currentEmotionalStateSupport: parseTokenArray(
        raw.currentEmotionalStateSupport,
      ),
      practicalSupportMatch: parseTokenArray(raw.practicalSupportMatch),
    },
    scalars: {
      formalityScore: parseFormalityScore(raw.formalityScore),
      stylingEffortLevel: parseStylingEffortLevel(raw.stylingEffortLevel),
    },
    prose: {
      stylingRole: trimScalar(raw.stylingRole),
      productStyleDescriptors: parseCommaSplit(raw.productStyleDescriptors),
      formalityDescription: trimScalar(raw.formalityDescription),
      bodyFitLogic: trimScalar(raw.bodyFitLogic),
      coverageModesty: trimScalar(raw.coverageModesty),
      proportionRule: trimScalar(raw.proportionRule),
      notIdealFor: trimScalar(raw.notIdealFor),
      emotionalSupportLogic: trimScalar(raw.emotionalSupportLogic),
      practicalSupportLogic: trimScalar(raw.practicalSupportLogic),
      pairingReason: trimScalar(raw.pairingReason),
      accessoriesDirection: trimScalar(raw.accessoriesDirection),
      shoeDirection: trimScalar(raw.shoeDirection),
      colorDirection: trimScalar(raw.colorDirection),
      skinToneColourHarmony: trimScalar(raw.skinToneColourHarmony),
      complexionStylingNote: trimScalar(raw.complexionStylingNote),
      hairStylingDirection: parseCommaSplit(raw.hairStylingDirection),
      hairStylingNote: trimScalar(raw.hairStylingNote),
      styleMeExplanation: trimScalar(raw.styleMeExplanation),
    },
    pairings: {
      bestPairedWithNadinePieces: parseNadinePairing(
        raw.bestPairedWithNadinePieces,
      ),
      conditionalNadinePairings: parseNadinePairing(
        raw.conditionalNadinePairings,
      ),
      avoidPairingWithNadinePieces: parseNadinePairing(
        raw.avoidPairingWithNadinePieces,
      ),
      bestPairedWithGeneral: trimScalar(raw.bestPairedWithGeneral),
      avoidPairingWithGeneral: trimScalar(raw.avoidPairingWithGeneral),
    },
  };
}

function transformProduct(
  raw: Record<string, string>,
): GeneratedCatalogProduct {
  const handle = raw.handle.trim();
  const eligibility = PRODUCT_ELIGIBILITY[handle];
  if (!eligibility) {
    throw new Error(`Handle '${handle}' not found in PRODUCT_ELIGIBILITY`);
  }
  return {
    handle,
    eligibility,
    sourceFields: buildSourceFields(raw),
    parsed: parseParsed(raw),
    dressingMetadata: parseDressingMetadata(raw),
  };
}

// ─── TypeScript emitter ───────────────────────────────────────────────────────

function emitCatalogTs(catalog: GeneratedCatalog): string {
  const json = JSON.stringify(catalog, null, 2);
  return [
    `// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.`,
    `// Source: ${catalog.sourceWorkbook}`,
    `// SHA-256: ${catalog.sourceSha256}`,
    `// Re-generate: tsx scripts/extract-naia-catalog.ts`,
    ``,
    `import type { GeneratedCatalog } from "../naia-catalog.types.js";`,
    ``,
    `export const NAIA_CATALOG: GeneratedCatalog = ${json};`,
    ``,
  ].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("Phase 3B catalog extraction — naia-catalog");
  console.log(`Workbook: ${WORKBOOK_PATH}`);

  const sourceSha256 = verifySha256();
  verifyEmbeddedRevision();

  const rawProducts = runPythonExtraction(WORKBOOK_PATH);
  console.log(`✓ Python extracted ${rawProducts.length} products`);

  if (rawProducts.length !== NADINE_WORKBOOK_MANIFEST.expectedProductCount) {
    throw new Error(
      `Expected ${NADINE_WORKBOOK_MANIFEST.expectedProductCount} products ` +
      `(per manifest), got ${rawProducts.length}`,
    );
  }

  const products: GeneratedCatalogProduct[] = rawProducts.map((raw, i) => {
    try {
      return transformProduct(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Product ${i + 1} (${raw.handle ?? "?"}): ${msg}`);
    }
  });

  const catalog: GeneratedCatalog = {
    schemaVersion: SCHEMA_VERSION,
    sourceWorkbook: SOURCE_WORKBOOK,
    sourceSha256,
    products,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const ts = emitCatalogTs(catalog);
  writeFileSync(OUTPUT_PATH, ts, "utf8");

  console.log(`✓ Written: ${OUTPUT_PATH}`);
  console.log(`  Products: ${products.length}`);
  console.log(
    `  Handles: ${products.map((p) => p.handle).join(", ")}`,
  );
}

// Only auto-run when executed directly (tsx scripts/extract-naia-catalog.ts),
// not when imported by promote-nadine-workbook.ts for buildPythonScript /
// runPythonExtraction.
if (process.argv[1] === __filename) {
  main();
}
