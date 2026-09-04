// app/lib/ai/closet-eligibility.server.ts
//
// Phase 4A6 — Stage B: async visual-content assessment for closet try-on eligibility.
//
// Stage A (closet-eligibility.ts) must run first and return "pending-assessment"
// before Stage B is invoked. Stage B calls Claude vision to assess whether the photo
// content itself is suitable for virtual try-on.
//
// Approved AI path: claude.server.ts / analyzeImage — same ANTHROPIC_API_KEY,
// no new vendor or credential introduced.

import { analyzeImage } from "./claude.server.js";
import type { ClosetItemCategory, ClosetStageBResult, ClosetVisualIssue } from "./closet-eligibility.js";

// Simple injectable type — wraps analyzeImage signature for testing
type VisualAnalyzerFn = (imageUrl: string, prompt: string) => Promise<string>;

// Injectable DB updater — passed by the route action for persistence; injectable for testing
export type StageBDbUpdater = (
  itemId: string,
  fields: {
    tryOnEligibility: string;
    tryOnAssessedAt: Date;
    tryOnCustomerHint: string | null;
    tryOnInternalNote: string;
  },
) => Promise<void>;

export type StageBOutcome = "persisted" | "timeout" | "system-failure" | "db-failure";

const STAGE_B_DEFAULT_TIMEOUT_MS = 8_000;

const CATEGORY_LABELS: Record<ClosetItemCategory, string> = {
  tops:        "top (shirt, blouse, or knitwear)",
  bottoms:     "trousers, skirt, or shorts",
  dresses:     "dress or jumpsuit",
  outerwear:   "jacket, coat, or blazer",
  shoes:       "shoes, boots, heels, or sneakers",
  bags:        "bag, purse, or backpack",
  unsupported: "fashion item",
};

const STAGE_B_PROMPT_TEMPLATE = (categoryLabel: string) => `\
You are assessing whether a fashion photo is suitable for virtual try-on.
The customer selected category: ${categoryLabel}.

Product photos, studio shots, and flat lays on plain backgrounds are all valid image types.
You are assessing whether the item can be identified for try-on, not judging photography style.

Evaluate this image on these criteria:
1. Is there exactly one clear primary fashion item visible (not multiple separate garments in the same photo)?
2. Is substantially all of the item visible in the frame? The item may fill the frame or touch the edges — only fail if a key part (such as the hem, neckline, or full waistband) is genuinely cut off and missing, not merely close to the edge.
3. Is the item not heavily obstructed by other objects or people?
4. Is the image reasonably in focus (not excessively blurry)?
5. Are the item's key edges and silhouette reasonably distinguishable? A dark item on a light background or a light item on a dark background automatically meets this criterion due to contrast.
6. Does the item visually match the selected category "${categoryLabel}"?
7. Is this a wearable fashion item (clothing, shoes, or bag) rather than a non-fashion object?

Only mark an image as not eligible if a genuine problem would prevent identifying the item for try-on.
Do not fail images for minor framing imperfections, the photo style being unusual, or slight edge proximity.
When in doubt, pass the image — a false rejection is worse than a false pass.

If the image is not eligible, also write a brief, calm customer guidance message that names the specific problem and the solution. Keep it under 2 sentences. Do not use technical jargon.

Example messages:
- "The sleeves and hem are cut off. Retake the photo with the full garment visible."
- "More than one item is in the photo. Photograph one item at a time."
- "The image is too blurry. Retake it in good, even lighting."
- "The bag strap is not fully visible. Retake the photo showing the complete bag."

Respond ONLY with this JSON object — no other text, no code blocks:
{
  "eligible": true or false,
  "issues": [],
  "reason": "one sentence internal note",
  "customerMessage": "calm retake guidance for the customer, or null if eligible"
}

Valid issue codes (only include codes that actually apply): "blurry", "obstructed", "cropped-item", "multiple-items", "category-mismatch", "not-fashion-item"`;

const VALID_VISUAL_ISSUES = new Set<string>([
  "blurry", "obstructed", "cropped-item", "multiple-items",
  "category-mismatch", "not-fashion-item",
]);

// ── Stage B: visual-content assessment ───────────────────────────────────────
//
// _analyzer is injectable for tests. Production callers omit it.

export async function assessClosetEligibilityStageB(
  imageUrl: string,
  category: ClosetItemCategory,
  _analyzer?: VisualAnalyzerFn,
): Promise<ClosetStageBResult> {
  const now = new Date().toISOString();
  const analyze: VisualAnalyzerFn = _analyzer
    ?? ((url, prompt) => analyzeImage({ imageUrl: url, prompt }));

  const categoryLabel = CATEGORY_LABELS[category] ?? "fashion item";

  let rawResponse: string;
  try {
    rawResponse = await analyze(imageUrl, STAGE_B_PROMPT_TEMPLATE(categoryLabel));
  } catch (err) {
    return {
      eligible: "needs-clearer-photo",
      visualIssues: ["visual-assessment-failed"],
      internalNote: `Stage B AI call failed: ${err instanceof Error ? err.message : String(err)}`,
      customerHint: null,
      assessedAt: now,
    };
  }

  // Parse JSON response — strip optional code fences
  let parsed: { eligible: unknown; issues: unknown; reason?: unknown; customerMessage?: unknown };
  try {
    const cleaned = rawResponse
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      eligible: "needs-clearer-photo",
      visualIssues: ["visual-assessment-failed"],
      internalNote: `Stage B response could not be parsed as JSON. Raw: ${rawResponse.slice(0, 200)}`,
      customerHint: null,
      assessedAt: now,
    };
  }

  // Validate required fields — reject malformed or incomplete responses
  if (typeof parsed.eligible !== "boolean" || !Array.isArray(parsed.issues)) {
    return {
      eligible: "needs-clearer-photo",
      visualIssues: ["visual-assessment-failed"],
      internalNote: `Stage B response missing required fields (eligible=${typeof parsed.eligible}, issues=${Array.isArray(parsed.issues) ? "array" : typeof parsed.issues}). Raw: ${rawResponse.slice(0, 200)}`,
      customerHint: null,
      assessedAt: now,
    };
  }

  const visualIssues = (parsed.issues as unknown[])
    .filter((i): i is ClosetVisualIssue => typeof i === "string" && VALID_VISUAL_ISSUES.has(i));

  // "not-fashion-item" → not-supported; photo quality issues → needs-clearer-photo
  let eligible: ClosetStageBResult["eligible"];
  if (parsed.eligible) {
    eligible = "ready-for-try-on";
  } else if (visualIssues.includes("not-fashion-item")) {
    eligible = "not-supported";
  } else {
    eligible = "needs-clearer-photo";
  }

  // Customer hint: use AI-generated message for photo issues; null when eligible or unsupported
  const rawCustomerMessage = parsed.customerMessage;
  const customerHint = (!parsed.eligible && eligible !== "not-supported" && typeof rawCustomerMessage === "string" && rawCustomerMessage.trim())
    ? rawCustomerMessage.trim()
    : null;

  const reasonText = typeof parsed.reason === "string" ? parsed.reason : "no reason";

  return {
    eligible,
    visualIssues,
    internalNote: `Stage B visual assessment: ${reasonText}. Issues: ${visualIssues.join(", ") || "none"}`,
    customerHint,
    assessedAt: now,
  };
}

// ── Stage B + persistence ─────────────────────────────────────────────────────
//
// Awaits Stage B within a controlled timeout. On timeout or system failure the
// item's existing "pending-assessment" DB state is preserved — the DB update is
// not called. Only genuine assessment results (ready-for-try-on, needs-clearer-photo
// from real photo issues, not-supported) trigger a DB update.
//
// dbUpdate is injectable for testing. The route action passes a closure over
// prisma.closetItem.update.

export async function runStageBAssessment(
  itemId: string,
  imageUrl: string,
  category: ClosetItemCategory,
  dbUpdate: StageBDbUpdater,
  options?: { timeoutMs?: number; _analyzer?: VisualAnalyzerFn },
): Promise<StageBOutcome> {
  const timeoutMs = options?.timeoutMs ?? STAGE_B_DEFAULT_TIMEOUT_MS;

  const timeoutSignal = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));
  const result = await Promise.race([
    assessClosetEligibilityStageB(imageUrl, category, options?._analyzer),
    timeoutSignal,
  ]);

  // Timeout: null — preserve pending-assessment, do not update DB
  if (result === null) return "timeout";

  // System failure inside Stage B — do not persist, preserve pending-assessment
  if (result.visualIssues.includes("visual-assessment-failed")) return "system-failure";

  // Genuine result — persist all required fields
  try {
    await dbUpdate(itemId, {
      tryOnEligibility: result.eligible,
      tryOnAssessedAt: new Date(result.assessedAt),
      tryOnCustomerHint: result.customerHint,
      tryOnInternalNote: result.internalNote,
    });
    return "persisted";
  } catch {
    // DB update failed — item's existing pending-assessment in DB is preserved
    return "db-failure";
  }
}
