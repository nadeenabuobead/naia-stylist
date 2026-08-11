// app/lib/image-moderation.server.ts
// Layer 2 — Global image content safety moderation.
//
// Accepts a server-generated signed Cloudinary URL (never a client-supplied URL).
// Uses Claude Haiku for fast, cheap binary content screening.
// Provider-abstracted: swap out _analyze to replace the underlying model or vendor.
//
// Fail-closed contract:
//   - Parse failure, timeout, or API error → MODERATION_UNAVAILABLE (NEVER PASS)
//   - MODERATION_UNAVAILABLE: image must not proceed to any downstream AI pipeline
//   - SAFETY_REJECT: delete asset, log audit event, return error to caller
//   - PASS: proceed to Layer 3 or downstream analysis

import { analyzeImage } from "./ai/claude.server.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type SafetyReasonCode =
  | "explicit_sexual"
  | "graphic_violence"
  | "self_harm"
  | "child_safety"
  | "unsafe_content";

export type ModerationResult =
  | { status: "PASS" }
  | { status: "SAFETY_REJECT"; reasonCode: SafetyReasonCode }
  | { status: "MODERATION_UNAVAILABLE" };

// Injectable analyzer type — replaces the Claude Haiku call in tests.
export type AnalyzeForModerationFn = (args: { imageUrl: string; prompt: string }) => Promise<string>;

// ── Prompt ────────────────────────────────────────────────────────────────────

const MODERATION_PROMPT = `\
You are a content safety classifier for an AI fashion styling app.

Evaluate this image for the presence of:
1. Explicit sexual or pornographic content (nudity, sexual acts, explicit body parts)
2. Graphic violence or gore
3. Self-harm imagery
4. Child safety concerns (sexual depictions of minors)
5. Other clearly unsafe content (extremist symbols used to harm, real weapons used in violence)

This is a fashion app. Clothing items, model photos, selfies, and virtual try-on images are all expected and normal.
Flag only clearly unsafe content as described above. Do not flag fashion, nudity in a medical context, or tasteful art.

Respond ONLY with this JSON object — no other text, no markdown, no code fences:
{
  "safe": true or false,
  "reasonCode": null or one of: "explicit_sexual", "graphic_violence", "self_harm", "child_safety", "unsafe_content"
}

If safe is true, reasonCode must be null.
If safe is false, reasonCode must be the single most applicable code.`;

// ── Constants ─────────────────────────────────────────────────────────────────

const MODERATION_TIMEOUT_MS = 12_000;

const VALID_REASON_CODES = new Set<string>([
  "explicit_sexual",
  "graphic_violence",
  "self_harm",
  "child_safety",
  "unsafe_content",
]);

// ── Core moderation function ──────────────────────────────────────────────────

export async function moderateImageContent(
  imageUrl: string,
  _analyze: AnalyzeForModerationFn = analyzeImage,
): Promise<ModerationResult> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), MODERATION_TIMEOUT_MS),
  );

  let raw: string | null;
  try {
    const result = await Promise.race([
      _analyze({ imageUrl, prompt: MODERATION_PROMPT }),
      timeout,
    ]);
    raw = result;
  } catch {
    return { status: "MODERATION_UNAVAILABLE" };
  }

  if (raw === null) return { status: "MODERATION_UNAVAILABLE" };

  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed: unknown = JSON.parse(cleaned);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: "MODERATION_UNAVAILABLE" };
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.safe !== "boolean") return { status: "MODERATION_UNAVAILABLE" };

    if (obj.safe === true) return { status: "PASS" };

    const reasonCode: SafetyReasonCode =
      typeof obj.reasonCode === "string" && VALID_REASON_CODES.has(obj.reasonCode)
        ? (obj.reasonCode as SafetyReasonCode)
        : "unsafe_content";

    return { status: "SAFETY_REJECT", reasonCode };
  } catch {
    return { status: "MODERATION_UNAVAILABLE" };
  }
}
