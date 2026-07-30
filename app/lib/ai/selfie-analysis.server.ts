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
const ANALYSIS_VERSION = 1;

const VALID_QUALITY_ISSUES = new Set<string>([
  "blurry", "obstructed", "multiple-faces",
  "strong-filter", "not-a-selfie", "back-facing",
]);

const VALID_CONTRAST_LEVELS = new Set(["low", "medium", "high"]);

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
- Use hedged, directional language only: "may suit", "tends to work well with", "you might consider"
- Do NOT rate or comment on attractiveness, beauty, or physical appearance in any evaluative way
- Do NOT infer, mention, or imply ethnicity, nationality, age, religion, gender identity, or body size
- Do NOT make any health, medical, or clinical assessment of any kind
- Do NOT make any statement that could be read as a diagnosis, therapy claim, or wellness recommendation
- Do NOT identify or speculate about the person's identity
- Do NOT include explanatory prose, uncertainty disclaimers, or self-referential statements outside the JSON fields

Output ONLY this JSON object — no other text, no code blocks:
{
  "faceShapeDirection": "one short phrase: e.g. 'softly oval tendency — most necklines may suit'",
  "suggestedNecklines": ["2 to 4 neckline types that may suit, e.g. V-neck, scoop neck"],
  "necklineExplanation": "one sentence, hedged: why these necklines may work",
  "colourFamilies": ["2 to 4 colour family descriptions, e.g. warm earth tones, muted dusty rose"],
  "colourExplanation": "one sentence, hedged: why these colour families may complement",
  "contrastLevel": "low or medium or high",
  "hairLengthDirection": "one phrase: e.g. shoulder-length or longer may balance proportions",
  "hairVolumeDirection": "one phrase: e.g. volume at the crown tends to add lift",
  "hairPartingDirection": "one phrase: e.g. a side parting may soften the forehead",
  "earringsDirection": "one phrase: e.g. longer drop earrings may elongate",
  "glassesFrameDirection": "one phrase: e.g. oval or round frames may complement angular features",
  "makeupColourDirection": "one phrase or null if uncertain",
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

// ── Quality check ─────────────────────────────────────────────────────────────

export async function checkSelfieQuality(
  input: SelfieAnalyzerInput,
  _analyzer?: SelfieAnalyzerFn,
): Promise<SelfiePhotoQualityResult> {
  const analyze = _analyzer ?? defaultAnalyzer;
  let raw: string;
  try {
    raw = await analyze(input, QUALITY_PROMPT);
  } catch (err) {
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
// Only the 13 approved fields are extracted from the parsed response.
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

  return {
    faceShapeDirection: (faceShapeDirection as string).trim(),
    suggestedNecklines: (suggestedNecklines as unknown[])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map(s => (s as string).trim()),
    necklineExplanation: (necklineExplanation as string).trim(),
    colourFamilies: (colourFamilies as unknown[])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map(s => (s as string).trim()),
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
