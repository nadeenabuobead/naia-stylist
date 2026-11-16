// app/lib/ai/claude.server.ts
import { captureError, captureFailure } from "../error-tracking.server.js";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CallAIParams {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Test-only override for the fetch implementation. Defaults to global fetch. */
  _fetch?: typeof fetch;
}

// Per-request timeout. Bounds a single Claude API call so a hung
// connection fails fast instead of holding the serverless function open
// indefinitely. Existing behavior on timeout is unchanged: an aborted
// fetch rejects, which the existing try/catch below already turns into a
// thrown Error — exactly the same path a network failure already took.
const CLAUDE_REQUEST_TIMEOUT_MS = 30_000;

// Load-test / local-dev escape hatch — same fail-safe shape as the FASHN
// adapter's BASE_URL override (fashn-try-on.server.ts): both
// ALLOW_PROVIDER_MOCKS="true" AND CLAUDE_MOCK_BASE_URL must be set, so a
// stray env var alone never redirects a real call. Unset anywhere in this
// repo's own config today — behavior is unchanged by default.
const ANTHROPIC_MESSAGES_URL =
  process.env.ALLOW_PROVIDER_MOCKS === "true" && process.env.CLAUDE_MOCK_BASE_URL
    ? `${process.env.CLAUDE_MOCK_BASE_URL}/v1/messages`
    : "https://api.anthropic.com/v1/messages";

/**
 * Call Claude API with messages
 */
export async function callClaude({
  messages,
  system,
  maxTokens = 4096,
  temperature = 1,
  _fetch = fetch,
}: CallAIParams): Promise<string> {
  try {
    const response = await _fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: maxTokens,
        system: system || undefined,
        messages: messages
      }),
      signal: AbortSignal.timeout(CLAUDE_REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();

    if (!response.ok) {
      captureFailure("claude:text", "PROVIDER_REJECTED", { httpStatus: response.status, errorType: data?.error?.type });
      throw new Error(data.error?.message || "Claude API failed");
    }

    return data.content[0]?.text || "";
  } catch (error) {
    captureError("claude:text", error);
    throw error;
  }
}

/**
 * Call Claude with JSON output parsing
 */
export async function callClaudeJSON<T>({
  messages,
  system,
  maxTokens = 4096,
  temperature = 1
}: CallAIParams): Promise<T> {
  const enhancedSystem = system 
    ? `${system}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown formatting, no code blocks, no explanatory text.`
    : "Respond ONLY with valid JSON. No markdown formatting, no code blocks, no explanatory text.";

  const response = await callClaude({
    messages,
    system: enhancedSystem,
    maxTokens,
    temperature
  });

  // Clean and parse JSON
  let cleanResponse = response.trim();
  
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse.slice(7);
  }
  if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.slice(3);
  }
  if (cleanResponse.endsWith("```")) {
    cleanResponse = cleanResponse.slice(0, -3);
  }
  
  cleanResponse = cleanResponse.trim();

  try {
    return JSON.parse(cleanResponse) as T;
  } catch (error) {
    console.error("JSON parse error:", error);
    console.error("Raw response length:", response.length);
    throw new Error("Failed to parse response as JSON");
  }
}

/**
 * Analyze an image with Claude Vision.
 * Provide either imageUrl (Cloudinary URL) or imageBase64 + mediaType.
 * model defaults to claude-opus-4-7; callers that need a faster/cheaper model
 * (e.g. moderation, suitability) should pass an explicit model.
 * signal is an optional AbortSignal that cancels the underlying HTTP request.
 */
export async function analyzeImage({
  imageUrl,
  imageBase64,
  mediaType = "image/jpeg",
  prompt,
  system,
  model = "claude-opus-4-7",
  signal,
  _fetch = fetch,
}: {
  imageUrl?: string;
  imageBase64?: string;
  mediaType?: string;
  prompt: string;
  system?: string;
  model?: string;
  signal?: AbortSignal;
  /** Test-only override for the fetch implementation. Defaults to global fetch. */
  _fetch?: typeof fetch;
}): Promise<string> {
  if (!imageUrl && !imageBase64) {
    throw new Error("analyzeImage requires imageUrl or imageBase64");
  }

  const imageContent = imageUrl
    ? { type: "image", source: { type: "url", url: imageUrl } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64! } };

  // Combine the caller's own cancellation signal (if any) with a default
  // request timeout, so neither capability is lost: a caller that passes
  // its own signal keeps the ability to cancel early, and every call —
  // signal or not — is still bounded so a hung connection can't block the
  // request forever.
  const timeoutSignal = AbortSignal.timeout(CLAUDE_REQUEST_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const response = await _fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: system || undefined,
      messages: [{
        role: "user",
        content: [
          imageContent,
          { type: "text", text: prompt }
        ]
      }]
    }),
    signal: combinedSignal,
  });

  const data = await response.json();
  if (!response.ok) {
    // Previously logged the full raw response body here (`data`), which
    // could include provider-echoed request content. Now logs only the
    // classified httpStatus/errorType, matching the no-raw-provider-data
    // logging discipline used elsewhere in this codebase (e.g.
    // styleme-result.server.ts's categorizeModelError).
    captureFailure("claude:vision", "PROVIDER_REJECTED", { httpStatus: response.status, errorType: data?.error?.type });
    throw new Error(data.error?.message || "Claude Vision API failed");
  }
  return data.content[0]?.text || "";
}

/**
 * Analyze a closet item image to extract details
 */
export async function analyzeClosetItem(imageBase64: string): Promise<{
  category: string;
  colors: string[];
  pattern: string | null;
  material: string | null;
  styleTags: string[];
  seasons: string[];
  occasions: string[];
  description: string;
}> {
  throw new Error("Image analysis not yet implemented with Claude");
}
