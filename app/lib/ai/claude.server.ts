// app/lib/ai/claude.server.ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
});

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CallClaudeParams {
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
  temperature = 0.7
}: CallClaudeParams): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      temperature,
      system,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    // Extract text content from response
    const textContent = response.content.find(block => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text content in response");
    }

    return textContent.text;
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
  temperature = 0.5
}: CallClaudeParams): Promise<T> {
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
  
  // Remove markdown code blocks if present
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
    throw new Error("Failed to parse Claude response as JSON");
  }
}

/**
 * Analyze an image with Claude's vision capabilities
 */
export async function analyzeImage({
  imageUrl,
  imageBase64,
  mediaType = "image/jpeg",
  prompt,
  system
}: {
  imageUrl?: string;
  imageBase64?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  prompt: string;
  system?: string;
}): Promise<string> {
  if (!imageUrl && !imageBase64) {
    throw new Error("Either imageUrl or imageBase64 must be provided");
  }

  const imageContent = imageUrl
    ? { type: "image" as const, source: { type: "url" as const, url: imageUrl } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mediaType, data: imageBase64! } };

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system,
    messages: [
      {
        role: "user",
        content: [
          imageContent,
          { type: "text", text: prompt }
        ]
      }
    ]
  });

  const textContent = response.content.find(block => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text content in response");
  }

  return textContent.text;
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
  const prompt = `Analyze this clothing item and provide details in JSON format:

{
  "category": "TOPS|BOTTOMS|DRESSES|OUTERWEAR|SHOES|BAGS|ACCESSORIES|JEWELRY|OTHER",
  "colors": ["array of hex color codes found in the item"],
  "pattern": "solid|striped|floral|plaid|geometric|animal|abstract|other|null",
  "material": "best guess of material (cotton, silk, denim, leather, etc.) or null",
  "styleTags": ["casual", "formal", "bohemian", "minimalist", "edgy", etc.],
  "seasons": ["spring", "summer", "fall", "winter"],
  "occasions": ["everyday", "work", "datenight", "special", etc.],
  "description": "Brief description of the item"
}

Respond ONLY with valid JSON.`;

  return callClaudeJSON({
    messages: [{ role: "user", content: prompt }],
    system: "You are a fashion expert analyzing clothing items. Be accurate and detailed in your analysis. Always respond with valid JSON only."
  });
}
