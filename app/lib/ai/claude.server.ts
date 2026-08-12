// app/lib/ai/claude.server.ts
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CallAIParams {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call Claude API with messages
 */
export async function callClaude({
  messages,
  system,
  maxTokens = 4096,
  temperature = 1
}: CallAIParams): Promise<string> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("Claude API Error:", data);
      throw new Error(data.error?.message || "Claude API failed");
    }

    return data.content[0]?.text || "";
  } catch (error) {
    console.error("Claude API error:", error);
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
    console.error("Raw response:", response);
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
}: {
  imageUrl?: string;
  imageBase64?: string;
  mediaType?: string;
  prompt: string;
  system?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (!imageUrl && !imageBase64) {
    throw new Error("analyzeImage requires imageUrl or imageBase64");
  }

  const imageContent = imageUrl
    ? { type: "image", source: { type: "url", url: imageUrl } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64! } };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: system || undefined,
      messages: [{
        role: "user",
        content: [
          imageContent,
          { type: "text", text: prompt }
        ]
      }]
    }),
    signal,
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Claude Vision API Error:", data);
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
