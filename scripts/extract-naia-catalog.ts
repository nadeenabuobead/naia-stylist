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
  CatalogParsed,
  CatalogSourceFields,
  GeneratedCatalog,
  GeneratedCatalogProduct,
  ProductItemType,
  StylingEffortLevel,
} from "../app/lib/ai/naia-catalog.types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKBOOK_PATH = resolve(
  __dirname,
  "../.claude/reference/styleme/PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx",
);
const EXPECTED_SHA256 =
  "b124b41a52b8004e381ed6dab909622451916ce741ce612592db49aa8ad74501";
const OUTPUT_PATH = resolve(
  __dirname,
  "../app/lib/ai/generated/naia-catalog.generated.ts",
);
const SCHEMA_VERSION = 1;
const SOURCE_WORKBOOK = "PRODUCTS TEMPLATE v8 - Runtime Clean.xlsx";
const LIVE_URL_BASE = "https://naiabynadine.com/products/";

// ─── SHA-256 verification ─────────────────────────────────────────────────────

function verifySha256(): void {
  const bytes = readFileSync(WORKBOOK_PATH);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== EXPECTED_SHA256) {
    throw new Error(
      `V8 SHA-256 mismatch.\n  Expected: ${EXPECTED_SHA256}\n  Got:      ${hash}`,
    );
  }
  console.log(`✓ V8 SHA-256 verified: ${hash}`);
}

// ─── Python extraction ────────────────────────────────────────────────────────

function buildPythonScript(workbookPath: string): string {
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
}

# Stable canonical key order (matches spec field 1-46).
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
]
CANONICAL_KEYS = set(CANONICAL_ORDER)

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

        missing = CANONICAL_KEYS - set(found.keys())
        if missing:
            raise ValueError(
                f"Product {i+1}: missing fields: {sorted(missing)}"
            )
        if len(found) != 46:
            raise ValueError(
                f"Product {i+1}: {len(found)} fields found, expected 46"
            )

        raw = {k: col_b.get(found[k], "") for k in CANONICAL_ORDER}
        products.append(raw)

    return products

col_a, col_b = parse_xlsx(WORKBOOK_PATH)
products = extract(col_a, col_b)
import sys
json.dump(products, sys.stdout, ensure_ascii=False)
`;
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

  verifySha256();

  const pythonScript = buildPythonScript(WORKBOOK_PATH);
  let rawJson: string;
  try {
    rawJson = execSync("python3 -", {
      input: pythonScript,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
    }).toString("utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Python extraction failed:\n${msg}`);
  }

  const rawProducts: Record<string, string>[] = JSON.parse(rawJson);
  console.log(`✓ Python extracted ${rawProducts.length} products`);

  if (rawProducts.length !== 11) {
    throw new Error(`Expected 11 products, got ${rawProducts.length}`);
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
    sourceSha256: EXPECTED_SHA256,
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

main();
