// app/lib/ai/claude.server.ts
// Using OpenAI instead of Claude
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface CallAIParams {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call OpenAI API with messages
 */
export async function callClaude({
  messages,
  system,
  maxTokens = 4096,
  temperature = 0.7
}: CallAIParams): Promise<string> {
  try {
    const allMessages: Message[] = [];
    
    if (system) {
      allMessages.push({ role: "system", content: system });
    }
    
    allMessages.push(...messages);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: maxTokens,
      temperature,
      messages: allMessages
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("OpenAI API error:", error);
    throw error;
  }
}

/**
 * Call OpenAI with JSON output parsing
 */
export async function callClaudeJSON<T>({
  messages,
  system,
  maxTokens = 4096,
  temperature = 0.5
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
 * Analyze an image with OpenAI Vision
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
  mediaType?: string;
  prompt: string;
  system?: string;
}): Promise<string> {
  if (!imageUrl && !imageBase64) {
    throw new Error("Either imageUrl or imageBase64 must be provided");
  }

  const imageContent = imageUrl
    ? { type: "image_url" as const, image_url: { url: imageUrl } }
    : { type: "image_url" as const, image_url: { url: `data:${mediaType};base64,${imageBase64}` } };

  const messages: any[] = [];
  
  if (system) {
    messages.push({ role: "system", content: system });
  }
  
  messages.push({
    role: "user",
    content: [
      imageContent,
      { type: "text", text: prompt }
    ]
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    messages
  });

  return response.choices[0]?.message?.content || "";
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
