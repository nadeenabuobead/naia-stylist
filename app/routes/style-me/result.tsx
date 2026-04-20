// app/routes/style-me/result.tsx
import { Link, useLoaderData, useFetcher } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState, useEffect } from "react";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";
import { getSession, commitSession } from "~/lib/session.server";
import { callClaude } from "~/lib/ai/claude.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (sessionId) {
      const session = await prisma.stylingSession.findUnique({
        where: { id: sessionId },
        include: { suggestions: { include: { items: true } } },
      });
      if (session) {
        return data({
          isLoading: false,
          sessionId: session.id,
          mood: session.currentMood,
          occasion: session.occasion,
          suggestion: session.suggestions[0] || null,
          error: null,
        });
      }
    }

    const cookieSession = await getSession(request.headers.get("Cookie"));
    const mood = cookieSession.get("styleMeMood");
    const feelings = cookieSession.get("styleMeFeelings") as string[] | undefined;
    const occasion = cookieSession.get("styleMeOccasion");
    const source = cookieSession.get("styleMeSource");

    if (!mood || !feelings || !occasion || !source) {
      return redirect("/style-me/mood");
    }

    const customerId = await getCustomerId(request);

    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId) {
      const guest = await prisma.customer.upsert({
        where: { shopifyCustomerId: "guest" },
        create: { shopifyCustomerId: "guest", email: "guest@naia.app" },
        update: {},
      });
      resolvedCustomerId = guest.id;
    }

    const stylingSession = await prisma.stylingSession.create({
      data: {
        customerId: resolvedCustomerId,
        currentMood: mood,
        desiredFeeling: feelings?.[0] || null,
        occasion,
        styleFrom: source === "CLOSET" ? "CLOSET" : source === "NAIA" ? "NAIA" : "BOTH",
      },
    });


    return data(
      { isLoading: true, sessionId: stylingSession.id, mood, occasion, suggestion: null, error: null },
      { headers: { "Set-Cookie": await commitSession(cookieSession) } }
    );
  } catch (err: any) {
    console.error("Result loader error:", err);
    return data({ isLoading: false, sessionId: null, mood: null, occasion: null, suggestion: null, error: err?.message || "Something went wrong" });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;
    const sessionId = formData.get("sessionId") as string;
    const suggestionId = formData.get("suggestionId") as string;
    const customerId = await getCustomerId(request);

    if (intent === "generate") {
      const session = await prisma.stylingSession.findUnique({ where: { id: sessionId } });
      if (!session) return data({ error: "Session not found" }, { status: 404 });

      let aiResult: any = null;
      try {
        const aiResponse = await callClaude({
          system: "You are nAia, a warm and confident AI personal stylist. Respond ONLY with valid JSON, no extra text.",
          messages: [{
            role: "user",
            content: `Create a complete outfit for someone feeling "${session.currentMood}" who wants to feel "${session.desiredFeeling}" for "${session.occasion}". Return JSON with: outfitName, whyThisWorks, confidenceBoost, perfumeRec, hairstyleRec, makeupVibeRec, songRec, and items array where each item has: itemType (one of: TOP, BOTTOM, DRESS, OUTERWEAR, SHOES, BAG, ACCESSORY, JEWELRY), productTitle, stylingNotes.`,
          }],
          maxTokens: 1500,
        });
        const clean = aiResponse.replace(/```json|```/g, "").trim();
        aiResult = JSON.parse(clean);
      } catch (e) {
        console.error("AI generation failed:", e);
      }

      const defaultItems = [
        { itemType: "TOP", productTitle: "Silk Blouse", stylingNotes: "Tuck the front for a polished look" },
        { itemType: "BOTTOM", productTitle: "High-Waisted Trousers", stylingNotes: "Pair with heels to elongate" },
        { itemType: "SHOES", productTitle: "Pointed Toe Heels", stylingNotes: "Nude tones work with everything" },
      ];

      const items = (aiResult?.items || defaultItems).map((item: any) => ({
        itemType: item.itemType || "TOP",
        productTitle: item.productTitle || null,
        stylingNotes: item.stylingNotes || null,
      }));

      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId,
          outfitName: aiResult?.outfitName || `${session.occasion} Look`,
          whyThisWorks: aiResult?.whyThisWorks || "A beautiful outfit curated just for you.",
          confidenceBoost: aiResult?.confidenceBoost || "You're going to look amazing!",
          perfumeRec: aiResult?.perfumeRec || null,
          hairstyleRec: aiResult?.hairstyleRec || null,
          makeupVibeRec: aiResult?.makeupVibeRec || null,
          songRec: aiResult?.songRec || null,
          items: { create: items },
        },
        include: { items: true },
      });

      return data({ suggestion, error: null });
    }

    if (intent === "save") {
      if (!customerId) return data({ error: "Must be logged in to save looks" }, { status: 401 });

      const suggestion = await prisma.outfitSuggestion.findUnique({
        where: { id: suggestionId },
        include: { items: true },
      });
      if (!suggestion) return data({ error: "Suggestion not found" }, { status: 404 });

      await prisma.savedLook.create({
        data: {
          customerId,
          name: suggestion.outfitName,
          fromSuggestionId: suggestion.id,
          items: {
            create: suggestion.items.map((item) => ({
              itemType: item.itemType,
              closetItemId: item.closetItemId || null,
              shopifyProductId: item.shopifyProductId || null,
            })),
          },
        },
      });

      return data({ saved: true, error: null });
    }

    return data({ error: "Invalid intent" }, { status: 400 });
  } catch (err: any) {
    console.error("Result action error:", err);
    return data({ error: err?.message || "Something went wrong" }, { status: 500 });
  }
}

const loadingMessages = [
  "Reading your vibe... ✨",
  "Finding the perfect pieces... 💎",
  "Adding the finishing touches... 🎀",
  "Picking your confidence song... 🎵",
  "Almost ready... 💫",
];

export default function StyleMeResult() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ suggestion?: any; error?: string; saved?: boolean }>();
  const [msgIndex, setMsgIndex] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"outfit" | "vibe">("outfit");

  const isLoading = loaderData.isLoading && !fetcher.data?.suggestion;
  const suggestion = fetcher.data?.suggestion || loaderData.suggestion;
  const error = fetcher.data?.error || loaderData.error;

  useEffect(() => {
    if (loaderData.isLoading && loaderData.sessionId && fetcher.state === "idle" && !fetcher.data) {
      fetcher.submit({ intent: "generate", sessionId: loaderData.sessionId }, { method: "post" });
    }
  }, []);

  useEffect(() => {
    if (!isLoading) return;
    const t = setInterval(() => setMsgIndex((i) => (i + 1) % loadingMessages.length), 2500);
    return () => clearInterval(t);
  }, [isLoading]);

  useEffect(() => {
    if (fetcher.data?.saved) setIsSaved(true);
  }, [fetcher.data]);

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#faf9f7" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1.5rem" }}>✨</div>
          <p style={{ fontSize: "1.25rem", fontWeight: 500, marginBottom: "0.5rem" }}>Creating your look</p>
          <p style={{ color: "#888" }}>{loadingMessages[msgIndex]}</p>
        </div>
      </div>
    );
  }

  if (error || !suggestion) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😔</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#888", marginBottom: "1.5rem", fontSize: "0.875rem" }}>{error || "Couldn't create your outfit. Let's try again!"}</p>
          <Link to="/style-me/mood" style={{ padding: "0.75rem 1.5rem", background: "#c4a0a0", color: "white", borderRadius: "9999px", textDecoration: "none", fontWeight: 500 }}>
            Start Over
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf9f7" }}>
      <header style={{ padding: "1rem", background: "white", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: "32rem", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link to="/style-me" style={{ color: "#888", textDecoration: "none", fontSize: "0.875rem" }}>← Back</Link>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 500 }}>Your Look</h1>
          <button onClick={() => fetcher.submit({ intent: "save", suggestionId: suggestion.id }, { method: "post" })} disabled={isSaved} style={{ fontSize: "0.875rem", fontWeight: 500, color: isSaved ? "green" : "#c4a0a0", background: "none", border: "none", cursor: "pointer" }}>
            {isSaved ? "✓ Saved" : "Save"}
          </button>
        </div>
      </header>

      <main style={{ padding: "1.5rem 1rem", maxWidth: "32rem", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>{suggestion.outfitName}</h2>
          {suggestion.confidenceBoost && <p style={{ color: "#c4a0a0", fontStyle: "italic" }}>"{suggestion.confidenceBoost}"</p>}
        </div>

        <div style={{ display: "flex", background: "white", borderRadius: "9999px", padding: "0.25rem", marginBottom: "1.5rem" }}>
          {(["outfit", "vibe"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "0.5rem 1rem", borderRadius: "9999px", fontSize: "0.875rem", fontWeight: 500, border: "none", cursor: "pointer", background: activeTab === tab ? "#2d2d2d" : "transparent", color: activeTab === tab ? "white" : "#888" }}>
              {tab === "outfit" ? "👗 Outfit" : "✨ Complete Vibe"}
            </button>
          ))}
        </div>

        {activeTab === "outfit" ? (
          <>
            <h3 style={{ fontWeight: 500, marginBottom: "1rem" }}>The Pieces</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
              {suggestion.items?.map((item: any) => (
                <div key={item.id} style={{ display: "flex", gap: "1rem", padding: "1rem", background: "white", borderRadius: "0.75rem" }}>
                  <div style={{ width: "5rem", height: "5rem", borderRadius: "0.5rem", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem", flexShrink: 0 }}>
                    {item.productImageUrl ? <img src={item.productImageUrl} alt={item.productTitle} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "0.5rem" }} /> : "👗"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>{item.itemType}</span>
                    <p style={{ fontWeight: 500, margin: "0.25rem 0" }}>{item.productTitle || item.itemType}</p>
                    {item.stylingNotes && <p style={{ fontSize: "0.875rem", color: "#888" }}>💡 {item.stylingNotes}</p>}
                    {item.shopifyProductId && <a href={`https://naiabynadine.com/products/${item.shopifyProductId}`} style={{ fontSize: "0.75rem", color: "#c4a0a0" }}>View in store →</a>}
                  </div>
                </div>
              ))}
            </div>
            {suggestion.whyThisWorks && (
              <div style={{ padding: "1rem", background: "rgba(196,160,160,0.08)", borderRadius: "0.75rem", marginBottom: "1.5rem" }}>
                <h3 style={{ fontWeight: 500, marginBottom: "0.5rem" }}>✨ Why This Works</h3>
                <p style={{ color: "#888", fontSize: "0.875rem" }}>{suggestion.whyThisWorks}</p>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {suggestion.perfumeRec && <div style={{ padding: "1rem", background: "white", borderRadius: "0.75rem" }}><p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>🌸 Scent</p><p style={{ color: "#888" }}>{suggestion.perfumeRec}</p></div>}
            {suggestion.hairstyleRec && <div style={{ padding: "1rem", background: "white", borderRadius: "0.75rem" }}><p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>💇‍♀️ Hair</p><p style={{ color: "#888" }}>{suggestion.hairstyleRec}</p></div>}
            {suggestion.makeupVibeRec && <div style={{ padding: "1rem", background: "white", borderRadius: "0.75rem" }}><p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>💄 Makeup</p><p style={{ color: "#888" }}>{suggestion.makeupVibeRec}</p></div>}
            {suggestion.songRec && <div style={{ padding: "1rem", background: "white", borderRadius: "0.75rem" }}><p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>🎵 Your Confidence Song</p><p style={{ fontWeight: 500 }}>{suggestion.songRec}</p><p style={{ fontSize: "0.875rem", color: "#888", marginTop: "0.25rem" }}>Play this while getting ready ✨</p></div>}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "2rem" }}>
          <Link to="/style-me/mood" style={{ flex: 1, padding: "0.75rem 1rem", background: "white", color: "#2d2d2d", textAlign: "center", borderRadius: "9999px", fontWeight: 500, textDecoration: "none", border: "1px solid #e5e5e5" }}>New Look</Link>
          <a href="https://naiabynadine.com" style={{ flex: 1, padding: "0.75rem 1rem", background: "#c4a0a0", color: "white", textAlign: "center", borderRadius: "9999px", fontWeight: 500, textDecoration: "none" }}>Shop nAia ✨</a>
        </div>
      </main>
    </div>
  );
}
