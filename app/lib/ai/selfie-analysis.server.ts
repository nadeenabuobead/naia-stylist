// app/lib/ai/selfie-analysis.server.ts
// Phase 4A8 — Personal Styling Photo Analysis engine.
//
// Approved AI path: analyzeImage from claude.server.ts — same ANTHROPIC_API_KEY,
// model claude-opus-4-7. No new vendor, credential, or DB service introduced.
//
// Flow:
//   1. Guard: consent required
//   2. Quality check (blurry, obstructed, multiple-faces, strong-filter, etc.)
//   3. If quality passes: styling analysis returning SelfieStyleSignals
//   4. Timeout wraps both calls as a unit
//
// Malformed responses always fail safely — never throw to the caller.

import { analyzeImage } from "./claude.server.js";
import type {
  ColourSwatch,
  SelfieAnalysisOutcome,
  SelfieAnalysisRecord,
  SelfiePhotoIssue,
  SelfiePhotoQualityResult,
  SelfieStyleSignals,
} from "./selfie-analysis.js";

// ── Injectable types ──────────────────────────────────────────────────────────

export type SelfieAnalyzerInput =
  | { imageUrl: string }
  | { imageBase64: string; mediaType: string };

export type SelfieAnalyzerFn = (
  input: SelfieAnalyzerInput,
  prompt: string,
) => Promise<string>;

const defaultAnalyzer: SelfieAnalyzerFn = (input, prompt) =>
  analyzeImage({ ...input, prompt });

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const ANALYSIS_VERSION = 2;

const VALID_QUALITY_ISSUES = new Set<string>([
  "blurry", "obstructed", "multiple-faces",
  "strong-filter", "not-a-selfie", "back-facing",
]);

const VALID_CONTRAST_LEVELS = new Set(["low", "medium", "high"]);
const VALID_COLOUR_TEMPS = new Set(["warm", "cool", "neutral"]);

// ── Prompts ───────────────────────────────────────────────────────────────────

const QUALITY_PROMPT = `\
You are assessing whether a photo is suitable for personal styling analysis.

Evaluate the photo on these criteria:
1. Is at least one person's face clearly visible in the frame?
2. Is the person facing the camera (front-facing, not in profile or rear-facing)?
3. Is the image reasonably sharp — not excessively blurry or out of focus?
4. Is the face not heavily obscured by hands, objects, heavy shadow, or clothing?
5. Does the photo show only one person's face (not multiple different people)?
6. Is the image free from heavy colour-cast filters that significantly distort skin, hair, and eye appearance?

If the photo is not suitable, write brief, kind guidance — name the issue and the fix. Keep it under two sentences.

Respond ONLY with this JSON object — no other text, no code blocks:
{
  "qualityPass": true or false,
  "issues": [],
  "guidance": "brief fix guidance for the customer, or null if quality passes"
}

Valid issue codes (include only those that apply): "blurry", "obstructed", "multiple-faces", "strong-filter", "not-a-selfie", "back-facing"`;

const STYLE_PROMPT = `\
You are a personal styling assistant offering gentle, hedged styling directions based on a photo.

Rules you must follow without exception:
- Use hedged, directional language: "may suit", "tends to work well with", "might complement"
- Do NOT comment on attractiveness, beauty, or physical appearance in any evaluative way
- Do NOT infer, mention, or imply ethnicity, nationality, age, religion, gender identity, or body size
- Do NOT make any health, medical, or clinical assessment
- Do NOT identify or speculate about the person's identity
- Do NOT include explanatory prose outside the JSON fields
- Hex colour codes must be exactly 6-character CSS hex values (e.g. "#C4956A") — never 3-character or named colours

Output ONLY this JSON object — no other text, no markdown, no code blocks:
{
  "faceShapeDirection": "one hedged phrase e.g. 'softly oval tendency — most necklines may suit'",
  "featureBalance": "one phrase e.g. 'gently balanced features with soft definition'",
  "eyeShape": "one phrase e.g. 'almond-shaped with a soft lid'",
  "browShape": "one phrase e.g. 'naturally defined arch'",
  "lipShape": "one phrase e.g. 'full with soft definition'",
  "contrastLevel": "low or medium or high",
  "colourFamilies": ["2–4 colour family descriptions e.g. 'warm earth tones', 'muted dusty rose'"],
  "colourExplanation": "one sentence, hedged: why these colour families may complement",
  "colourTemperature": "warm or cool or neutral",
  "bestNeutrals": [{"name": "warm cream", "hex": "#F5EDD6"}, {"name": "camel", "hex": "#C19A6B"}, {"name": "warm charcoal", "hex": "#4A4140"}],
  "everydayColours": [{"name": "dusty rose", "hex": "#C9917A"}, {"name": "sage green", "hex": "#8A9E8A"}, {"name": "soft terracotta", "hex": "#C0806A"}],
  "accentColours": [{"name": "burnt amber", "hex": "#9E5A2B"}, {"name": "deep olive", "hex": "#5E6B3A"}],
  "useCareNearFace": [{"name": "cool grey", "hex": "#9098A0"}],
  "suggestedNecklines": ["2–4 neckline types e.g. 'V-neck', 'scoop neck'"],
  "necklineExplanation": "one sentence, hedged: why these necklines may work",
  "necklinesTop": ["1–3 most flattering neckline names"],
  "necklinesAlso": ["1–3 neckline names that also work well"],
  "necklinesCareful": ["1–2 neckline names to use more carefully"],
  "earringsDirection": "one phrase e.g. 'longer drop earrings may elongate'",
  "earringsTop": ["2–4 earring shape directions that tend to flatter e.g. 'long drops', 'hoops'"],
  "earringsScale": "one phrase e.g. 'medium to statement scale may suit'",
  "necklaceLengths": ["1–3 necklace length directions e.g. 'princess length (45–50 cm) may suit'"],
  "metalDirection": "one phrase e.g. 'warm gold tones may complement'",
  "glassesFrameDirection": "one phrase e.g. 'oval or round frames may complement angular features'",
  "glassesTop": ["1–3 most flattering frame shapes"],
  "glassesAlso": ["1–2 frame shapes that also work"],
  "glassesCareful": ["1–2 frame shapes to use carefully"],
  "hairLengthDirection": "one phrase e.g. 'shoulder-length or longer may balance proportions'",
  "hairVolumeDirection": "one phrase e.g. 'volume at the crown tends to add lift'",
  "hairPartingDirection": "one phrase e.g. 'a side parting may soften the forehead'",
  "hairLayers": "one phrase e.g. 'layers from the chin may soften the jawline'",
  "hairTextureDirection": "one phrase e.g. 'natural waves or a soft blow-dry may suit'",
  "hairUpdoDirection": "one phrase e.g. 'soft updos with face-framing pieces may flatter'",
  "hairColourFamilies": ["1–3 hair colour direction phrases e.g. 'warm caramel tones may complement'"],
  "makeupColourDirection": "one phrase or null if uncertain",
  "makeupComplexionFinish": "one phrase e.g. 'a luminous or satin finish may suit'",
  "makeupBlush": "one phrase e.g. 'warm peach or apricot tones applied to the apple may lift'",
  "makeupEyeshadow": "one phrase e.g. 'warm browns and bronzes may complement eye colour'",
  "makeupLipsEveryday": "one phrase e.g. 'a nude peach or warm rose may work well day-to-day'",
  "makeupLipsRich": "one phrase e.g. 'a terracotta or rich berry may flatter for evening'",
  "styleFormula": ["3–5 single words or short phrases: e.g. 'Warm', 'Defined', 'Softly Feminine'"],
  "styleFormulaNote": "one hedged sentence synthesising the overall visual style direction",
  "overallNote": "one short, hedged styling note — no evaluative language"
}`;

// ── JSON parsing helper ───────────────────────────────────────────────────────

function parseJsonResponse(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Swatch extraction helpers ─────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidSwatch(item: unknown): item is Record<string, string> {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.name === "string" && (obj.name as string).trim().length > 0 &&
    typeof obj.hex === "string" && HEX_RE.test(obj.hex as string)
  );
}

function extractSwatches(raw: unknown): ColourSwatch[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: ColourSwatch[] = raw
    .filter(isValidSwatch)
    .map(item => ({
      name: (item.name as string).trim(),
      hex: (item.hex as string).toUpperCase(),
    }));
  return result.length > 0 ? result : undefined;
}

function extractStringArr(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: string[] = raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map(s => s.trim());
  return result.length > 0 ? result : undefined;
}

function extractOptStr(raw: unknown): string | undefined {
  return typeof raw === "string" && (raw as string).trim() ? (raw as string).trim() : undefined;
}

// ── Quality check ─────────────────────────────────────────────────────────────

export async function checkSelfieQuality(
  input: SelfieAnalyzerInput,
  _analyzer?: SelfieAnalyzerFn,
): Promise<SelfiePhotoQualityResult> {
  const analyze = _analyzer ?? defaultAnalyzer;
  let raw: string;
  try {
    raw = await analyze(input, QUALITY_PROMPT);
  } catch {
    return {
      pass: false,
      issues: ["quality-assessment-failed"],
      guidance: null,
    };
  }

  const parsed = parseJsonResponse(raw);
  if (!parsed || typeof parsed.qualityPass !== "boolean" || !Array.isArray(parsed.issues)) {
    return {
      pass: false,
      issues: ["quality-assessment-failed"],
      guidance: null,
    };
  }

  const issues = (parsed.issues as unknown[]).filter(
    (i): i is SelfiePhotoIssue => typeof i === "string" && VALID_QUALITY_ISSUES.has(i),
  );

  const guidance = typeof parsed.guidance === "string" && parsed.guidance.trim()
    ? parsed.guidance.trim()
    : null;

  return { pass: parsed.qualityPass, issues, guidance };
}

// ── Style signals validation ──────────────────────────────────────────────────
//
// Extracts only the approved fields from the parsed response.
// Required v1 fields must be present and valid — missing any returns null.
// Optional v2 fields are extracted when present and valid; silently omitted otherwise.
// Any extra keys (including prohibited fields) are silently discarded.

function validateStyleSignals(parsed: Record<string, unknown>): SelfieStyleSignals | null {
  const {
    faceShapeDirection,
    suggestedNecklines,
    necklineExplanation,
    colourFamilies,
    colourExplanation,
    contrastLevel,
    hairLengthDirection,
    hairVolumeDirection,
    hairPartingDirection,
    earringsDirection,
    glassesFrameDirection,
    makeupColourDirection,
    overallNote,
  } = parsed;

  if (
    typeof faceShapeDirection !== "string" || !faceShapeDirection.trim() ||
    !Array.isArray(suggestedNecklines) || suggestedNecklines.length === 0 ||
    typeof necklineExplanation !== "string" || !necklineExplanation.trim() ||
    !Array.isArray(colourFamilies) || colourFamilies.length === 0 ||
    typeof colourExplanation !== "string" || !colourExplanation.trim() ||
    !VALID_CONTRAST_LEVELS.has(contrastLevel as string) ||
    typeof hairLengthDirection !== "string" || !hairLengthDirection.trim() ||
    typeof hairVolumeDirection !== "string" || !hairVolumeDirection.trim() ||
    typeof hairPartingDirection !== "string" || !hairPartingDirection.trim() ||
    typeof earringsDirection !== "string" || !earringsDirection.trim() ||
    typeof glassesFrameDirection !== "string" || !glassesFrameDirection.trim() ||
    (makeupColourDirection !== null && typeof makeupColourDirection !== "string") ||
    typeof overallNote !== "string" || !overallNote.trim()
  ) {
    return null;
  }

  const base: SelfieStyleSignals = {
    faceShapeDirection: (faceShapeDirection as string).trim(),
    suggestedNecklines: (suggestedNecklines as unknown[])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map(s => s.trim()),
    necklineExplanation: (necklineExplanation as string).trim(),
    colourFamilies: (colourFamilies as unknown[])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map(s => s.trim()),
    colourExplanation: (colourExplanation as string).trim(),
    contrastLevel: contrastLevel as "low" | "medium" | "high",
    hairLengthDirection: (hairLengthDirection as string).trim(),
    hairVolumeDirection: (hairVolumeDirection as string).trim(),
    hairPartingDirection: (hairPartingDirection as string).trim(),
    earringsDirection: (earringsDirection as string).trim(),
    glassesFrameDirection: (glassesFrameDirection as string).trim(),
    makeupColourDirection:
      typeof makeupColourDirection === "string" && (makeupColourDirection as string).trim()
        ? (makeupColourDirection as string).trim()
        : null,
    overallNote: (overallNote as string).trim(),
  };

  // Optional v2 fields — Face & Feature Profile
  const featureBalanceV = extractOptStr(parsed.featureBalance);
  if (featureBalanceV !== undefined) base.featureBalance = featureBalanceV;

  const eyeShapeV = extractOptStr(parsed.eyeShape);
  if (eyeShapeV !== undefined) base.eyeShape = eyeShapeV;

  const browShapeV = extractOptStr(parsed.browShape);
  if (browShapeV !== undefined) base.browShape = browShapeV;

  const lipShapeV = extractOptStr(parsed.lipShape);
  if (lipShapeV !== undefined) base.lipShape = lipShapeV;

  // Optional v2 fields — Colour Direction
  const colourTempRaw = parsed.colourTemperature;
  if (typeof colourTempRaw === "string" && VALID_COLOUR_TEMPS.has(colourTempRaw)) {
    base.colourTemperature = colourTempRaw as "warm" | "cool" | "neutral";
  }

  const bestNeutralsV = extractSwatches(parsed.bestNeutrals);
  if (bestNeutralsV !== undefined) base.bestNeutrals = bestNeutralsV;

  const everydayColoursV = extractSwatches(parsed.everydayColours);
  if (everydayColoursV !== undefined) base.everydayColours = everydayColoursV;

  const accentColoursV = extractSwatches(parsed.accentColours);
  if (accentColoursV !== undefined) base.accentColours = accentColoursV;

  const useCareV = extractSwatches(parsed.useCareNearFace);
  if (useCareV !== undefined) base.useCareNearFace = useCareV;

  // Optional v2 fields — Necklines
  const necklinesTopV = extractStringArr(parsed.necklinesTop);
  if (necklinesTopV !== undefined) base.necklinesTop = necklinesTopV;

  const necklinesAlsoV = extractStringArr(parsed.necklinesAlso);
  if (necklinesAlsoV !== undefined) base.necklinesAlso = necklinesAlsoV;

  const necklinesCarefulV = extractStringArr(parsed.necklinesCareful);
  if (necklinesCarefulV !== undefined) base.necklinesCareful = necklinesCarefulV;

  // Optional v2 fields — Jewellery
  const earringsTopV = extractStringArr(parsed.earringsTop);
  if (earringsTopV !== undefined) base.earringsTop = earringsTopV;

  const earringsScaleV = extractOptStr(parsed.earringsScale);
  if (earringsScaleV !== undefined) base.earringsScale = earringsScaleV;

  const necklaceLengthsV = extractStringArr(parsed.necklaceLengths);
  if (necklaceLengthsV !== undefined) base.necklaceLengths = necklaceLengthsV;

  const metalDirectionV = extractOptStr(parsed.metalDirection);
  if (metalDirectionV !== undefined) base.metalDirection = metalDirectionV;

  // Optional v2 fields — Glasses
  const glassesTopV = extractStringArr(parsed.glassesTop);
  if (glassesTopV !== undefined) base.glassesTop = glassesTopV;

  const glassesAlsoV = extractStringArr(parsed.glassesAlso);
  if (glassesAlsoV !== undefined) base.glassesAlso = glassesAlsoV;

  const glassesCarefulV = extractStringArr(parsed.glassesCareful);
  if (glassesCarefulV !== undefined) base.glassesCareful = glassesCarefulV;

  // Optional v2 fields — Hair
  const hairLayersV = extractOptStr(parsed.hairLayers);
  if (hairLayersV !== undefined) base.hairLayers = hairLayersV;

  const hairTextureV = extractOptStr(parsed.hairTextureDirection);
  if (hairTextureV !== undefined) base.hairTextureDirection = hairTextureV;

  const hairUpdoV = extractOptStr(parsed.hairUpdoDirection);
  if (hairUpdoV !== undefined) base.hairUpdoDirection = hairUpdoV;

  const hairColourV = extractStringArr(parsed.hairColourFamilies);
  if (hairColourV !== undefined) base.hairColourFamilies = hairColourV;

  // Optional v2 fields — Makeup
  const makeupFinishV = extractOptStr(parsed.makeupComplexionFinish);
  if (makeupFinishV !== undefined) base.makeupComplexionFinish = makeupFinishV;

  const makeupBlushV = extractOptStr(parsed.makeupBlush);
  if (makeupBlushV !== undefined) base.makeupBlush = makeupBlushV;

  const makeupEyeV = extractOptStr(parsed.makeupEyeshadow);
  if (makeupEyeV !== undefined) base.makeupEyeshadow = makeupEyeV;

  const makeupLipsEdV = extractOptStr(parsed.makeupLipsEveryday);
  if (makeupLipsEdV !== undefined) base.makeupLipsEveryday = makeupLipsEdV;

  const makeupLipsRichV = extractOptStr(parsed.makeupLipsRich);
  if (makeupLipsRichV !== undefined) base.makeupLipsRich = makeupLipsRichV;

  // Optional v2 fields — Style Formula
  const styleFormulaV = extractStringArr(parsed.styleFormula);
  if (styleFormulaV !== undefined) base.styleFormula = styleFormulaV;

  const styleFormulaNote = extractOptStr(parsed.styleFormulaNote);
  if (styleFormulaNote !== undefined) base.styleFormulaNote = styleFormulaNote;

  return base;
}

// ── Style analysis (inner — no timeout) ──────────────────────────────────────

async function runStyleAnalysis(
  input: SelfieAnalyzerInput,
  analyzer: SelfieAnalyzerFn,
): Promise<SelfieAnalysisOutcome> {
  const quality = await checkSelfieQuality(input, analyzer);

  if (!quality.pass) {
    return { status: "quality-failed", issues: quality.issues, guidance: quality.guidance };
  }

  let raw: string;
  try {
    raw = await analyzer(input, STYLE_PROMPT);
  } catch (err) {
    return {
      status: "system-failure",
      internalNote: `Style analysis call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = parseJsonResponse(raw);
  if (!parsed) {
    return {
      status: "system-failure",
      internalNote: `Style response could not be parsed as JSON. Raw: ${raw.slice(0, 200)}`,
    };
  }

  const signals = validateStyleSignals(parsed);
  if (!signals) {
    return {
      status: "system-failure",
      internalNote: `Style response failed field validation. Raw: ${raw.slice(0, 200)}`,
    };
  }

  return { status: "completed", signals, analysedAt: new Date().toISOString() };
}

// ── Main exported function ────────────────────────────────────────────────────

export async function analyseSelfie(
  input: SelfieAnalyzerInput,
  options?: {
    consentAt?: string | null;
    timeoutMs?: number;
    _analyzer?: SelfieAnalyzerFn;
  },
): Promise<SelfieAnalysisOutcome> {
  if (!options?.consentAt) {
    return { status: "consent-missing" };
  }

  const hasContent =
    ("imageUrl" in input && typeof input.imageUrl === "string" && input.imageUrl.trim().length > 0) ||
    ("imageBase64" in input && typeof input.imageBase64 === "string" && input.imageBase64.length > 0);

  if (!hasContent) {
    return { status: "invalid-input", reason: "imageUrl or imageBase64 required" };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const analyzer = options?._analyzer ?? defaultAnalyzer;

  const timeoutSignal = new Promise<null>(resolve =>
    setTimeout(() => resolve(null), timeoutMs),
  );

  const result = await Promise.race([
    runStyleAnalysis(input, analyzer),
    timeoutSignal,
  ]);

  if (result === null) return { status: "timeout" };
  return result;
}

// ── Deletion utility ──────────────────────────────────────────────────────────
//
// Pure function — sets analysisStatus to "deleted", clears signals and photo.
// Route action is responsible for triggering the Cloudinary asset deletion separately.

export function clearSelfieAnalysisRecord(
  record: SelfieAnalysisRecord,
  now: () => string = () => new Date().toISOString(),
): SelfieAnalysisRecord {
  return {
    ...record,
    analysisStatus: "deleted",
    analysisResult: null,
    analysedAt: null,
    photoDeletedAt: now(),
  };
}

export { ANALYSIS_VERSION };
