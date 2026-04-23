export async function action({ request }) {
  const body = await request.json();
  const { query, reportType = "seasonal" } = body;

  if (!query) {
    return Response.json({ error: "Query required" }, { status: 400 });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    const prompts = {
      seasonal: `You are a fashion intelligence analyst. Create an authoritative trend report on: ${query}

Structure:
- Overview: What's happening this season
- Key Colors: Specific color stories and palettes
- Silhouettes: Dominant shapes and proportions
- Standout Moments: Noteworthy runway shows or designer moves
- New Brands to Watch: Emerging designers worth tracking
- Category Deep Dive: Pick one (bags, shoes, outerwear, etc.) and analyze current direction
- Who This Suits: Style personalities and body types that align
- Predicted Longevity: Investment-worthy vs. fleeting

Write with authority. Cite specific collections, designers, shows. This is editorial, not shopping content.`,
      
      runway: `Create a fashion week review for: ${query}
Cover: standout shows, key themes, color stories, silhouette shifts, designers to watch, commercial viability.`,
      
      category: `Analyze the current state of ${query} (bags/shoes/denim/etc.)
Cover: trending styles, price points, brands leading the category, what's new, what's fading, investment pieces.`,
      
      color: `Create a color trend report for: ${query}
Cover: color families, mood, pairings, who wears it well, longevity, cultural context.`,
      
      brand: `Profile this brand/collection: ${query}
Cover: brand DNA, recent shifts, standout pieces, target customer, styling direction, value proposition.`
    };

    const prompt = prompts[reportType] || prompts.seasonal;
    
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a fashion intelligence analyst writing for industry professionals and informed consumers. Authoritative, specific, insightful." },
          { role: "user", content: prompt }
        ],
      }),
    });

    const data = await openAiResponse.json();
    const report = data.choices[0].message.content;

    return Response.json({ report, reportType });
  } catch (error) {
    console.error("Trend report error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}