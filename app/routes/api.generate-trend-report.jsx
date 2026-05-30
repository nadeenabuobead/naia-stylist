export async function action({ request }) {
  const body = await request.json();
  const { query, reportType = "seasonal" } = body;

  if (!query) {
    return Response.json({ error: "Query required" }, { status: 400 });
  }

  try {
    const prompt = `You are nAia's fashion intelligence analyst. Write an editorial trend report on: "${query}"

This is not a generic AI fashion summary. This is a premium, emotionally intelligent trend report that connects fashion to how women want to feel.

Return ONLY valid JSON with this exact structure, no markdown, no explanation:
{
  "title": "nAia Trend Notes: [topic] [year]",
  "editorialIntro": "2-3 sentence mood-setting intro. Editorial, not corporate.",
  "keyTrends": [
    { "name": "Trend name", "description": "2-3 sentences. Specific. Cite real designers." },
    { "name": "Trend name", "description": "..." },
    { "name": "Trend name", "description": "..." },
    { "name": "Trend name", "description": "..." }
  ],
  "rising": ["specific thing rising", "specific thing rising", "specific thing rising"],
  "fading": ["specific thing fading", "specific thing fading", "specific thing fading"],
  "brandsToWatch": [
    { "name": "Brand name", "why": "One sentence on why they matter right now." },
    { "name": "Brand name", "why": "..." },
    { "name": "Brand name", "why": "..." }
  ],
  "investmentNotes": "2-3 sentences on what is worth spending on vs what to skip.",
  "naiaInterpretation": "3-4 sentences explaining what this trend means EMOTIONALLY. Connect it to how women want to feel: powerful, effortless, polished, romantic, magnetic, artistic, soft, confident.",
  "howToWear": [
    { "feeling": "Polished", "direction": "Specific styling advice" },
    { "feeling": "Magnetic", "direction": "Specific styling advice" },
    { "feeling": "Effortless", "direction": "Specific styling advice" },
    { "feeling": "Powerful", "direction": "Specific styling advice" }
  ],
  "wardrobeNote": "2-3 sentences on what this means for her wardrobe."
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Claude API error");
    }

    const text = data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const report = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    return Response.json({ report });
  } catch (error) {
    console.error("Trend report error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
