export async function action({ request }) {
  const body = await request.json();
  const { query } = body;

  if (!query) {
    return Response.json({ error: "Query required" }, { status: 400 });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    // Step 1: Search for fashion trend sources
    const searchResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a fashion intelligence analyst. When given a trend query, you search fashion sources (Vogue, WWD, fashion shows, designers) and create a comprehensive trend report.
            
Your reports should include:
- Current trend overview
- Key colors, silhouettes, styling details
- Which designers/brands are leading this
- How to wear/style this trend
- Who this trend suits (style personalities, body types)
- Predicted longevity

Write in an editorial voice - intelligent, refined, insightful. Cite specific collections, designers, or fashion moments where relevant.`
          },
          {
            role: "user",
            content: `Create a comprehensive trend report on: ${query}`
          }
        ],
      }),
    });

    const searchData = await searchResponse.json();
    const report = searchData.choices[0].message.content;

    return Response.json({ report });
  } catch (error) {
    console.error("Trend report error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}