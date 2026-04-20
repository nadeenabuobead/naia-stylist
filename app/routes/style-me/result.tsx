// app/routes/style-me/result.tsx
import { Link, useLoaderData, useFetcher } from "react-router";
import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState, useEffect } from "react";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";
import { getSession, commitSession } from "~/lib/session.server";
import { callClaude } from "~/lib/ai/claude.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  
  // If sessionId provided, load existing session
  if (sessionId) {
    const session = await prisma.stylingSession.findUnique({
      where: { id: sessionId },
      include: {
        suggestions: {
          include: {
            items: true
          }
        }
      }
    });
    
    if (session) {
      return json({
        isLoading: false,
        session,
        suggestion: session.suggestions[0] || null
      });
    }
  }
  
  // Otherwise, get from session cookie
  const cookieSession = await getSession(request.headers.get("Cookie"));
  const mood = cookieSession.get("styleMeMood");
  const feelings = cookieSession.get("styleMeFeelings") as string[] | undefined;
  const occasion = cookieSession.get("styleMeOccasion");
  const source = cookieSession.get("styleMeSource");
  
  if (!mood || !feelings || !occasion || !source) {
    return redirect("/style-me/mood");
  }
  
  const customerId = await getCustomerId(request);
  
  // Create the styling session
  const stylingSession = await prisma.stylingSession.create({
    data: {
      customerId: customerId || undefined,
      currentMood: mood,
      desiredFeeling: feelings?.[0] || null,
      occasion,
      styleFrom: source === "CLOSET" ? "CLOSET" : source === "NAIA" ? "NAIA" : "BOTH",
      status: "PENDING"
    }
  });
  
  // Clear the session data
  cookieSession.unset("styleMeMood");
  cookieSession.unset("styleMeFeelings");
  cookieSession.unset("styleMeOccasion");
  cookieSession.unset("styleMeSource");
  
  return json(
    {
      isLoading: true,
      sessionId: stylingSession.id,
      mood,
      feelings,
      occasion,
      source,
      suggestion: null
    },
    {
      headers: {
        "Set-Cookie": await commitSession(cookieSession)
      }
    }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const sessionId = formData.get("sessionId") as string;
  const suggestionId = formData.get("suggestionId") as string;
  
  const customerId = await getCustomerId(request);
  
  switch (intent) {
    case "generate": {
      // In real app, this would call the AI service
      // For now, create a mock suggestion
      const session = await prisma.stylingSession.findUnique({
        where: { id: sessionId }
      });
      
      if (!session) {
        return json({ error: "Session not found" }, { status: 404 });
      }
      
      // Update session status
      await prisma.stylingSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED" }
      });
      
      // Create mock suggestion
     // Call the AI for real outfit suggestions
      let aiResult: any = null;
      try {
        const aiResponse = await callClaude({
          system: "You are nAia, a warm and confident AI personal stylist. Respond ONLY with valid JSON, no extra text.",
          messages: [{
            role: "user",
            content: `Create a complete outfit for someone feeling "${session.currentMood}" who wants to feel "${session.desiredFeeling}" for "${session.occasion}". Return JSON with: outfitName, styleNotes, confidenceBoost, perfumeSuggestion, hairSuggestion, makeupSuggestion, songSuggestion, and items array where each item has: type (TOP/BOTTOM/DRESS/SHOES/BAG/ACCESSORY), name, description, stylingTip.`
          }],
          maxTokens: 1500
        });
        const clean = aiResponse.replace(/```json|```/g, "").trim();
        aiResult = JSON.parse(clean);
      } catch (e) {
        console.error("AI generation failed:", e);
      }

      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId,
          outfitName: aiResult?.outfitName || `${session.occasion} Look`,
          styleNotes: aiResult?.styleNotes || "A beautiful outfit curated just for you.",
          confidenceBoost: aiResult?.confidenceBoost || "You're going to look amazing!",
          perfumeSuggestion: aiResult?.perfumeSuggestion || null,
          hairSuggestion: aiResult?.hairSuggestion || null,
          makeupSuggestion: aiResult?.makeupSuggestion || null,
          songSuggestion: aiResult?.songSuggestion || null,
          items: {
            create: (aiResult?.items || [
              { type: "TOP", name: "Silk Blouse", description: "Elegant and versatile", stylingTip: "Tuck the front for a polished look", order: 0 },
              { type: "BOTTOM", name: "High-Waisted Trousers", description: "Flattering and comfortable", stylingTip: "Pair with heels to elongate", order: 1 },
              { type: "SHOES", name: "Pointed Toe Heels", description: "Classic and chic", stylingTip: "Nude tones work with everything", order: 2 },
            ]).map((item: any, i: number) => ({
              type: item.type,
              name: item.name,
              description: item.description,
              stylingTip: item.stylingTip,
              order: i
            }))
          }
        },
        include: { items: true }
      });
      
      return json({ suggestion });
    }
    
    case "save": {
      if (!customerId) {
        return json({ error: "Must be logged in to save looks" }, { status: 401 });
      }
      
      const suggestion = await prisma.outfitSuggestion.findUnique({
        where: { id: suggestionId },
        include: { items: true }
      });
      
      if (!suggestion) {
        return json({ error: "Suggestion not found" }, { status: 404 });
      }
      
      await prisma.savedLook.create({
        data: {
          customerId,
          suggestionId,
          name: suggestion.outfitName,
          items: {
            create: suggestion.items.map((item) => ({
              type: item.type,
              name: item.name,
              imageUrl: item.imageUrl,
              closetItemId: item.closetItemId,
              shopifyProductId: item.shopifyProductId
            }))
          }
        }
      });
      
      return json({ saved: true });
    }
    
    default:
      return json({ error: "Invalid intent" }, { status: 400 });
  }
}

// Loading animation messages
const loadingMessages = [
  "Reading your vibe... ✨",
  "Browsing your closet... 👗",
  "Finding the perfect pieces... 💎",
  "Adding the finishing touches... 🎀",
  "Picking your confidence song... 🎵",
  "Almost ready... 💫"
];

export default function StyleMeResult() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ suggestion?: any; error?: string; saved?: boolean }>();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"outfit" | "vibe">("outfit");
  
  const isLoading = loaderData.isLoading && !fetcher.data?.suggestion;
  const suggestion = fetcher.data?.suggestion || loaderData.suggestion;
  
  // Trigger generation on mount if loading
  useEffect(() => {
    if (loaderData.isLoading && !fetcher.data && fetcher.state === "idle") {
      fetcher.submit(
        { intent: "generate", sessionId: loaderData.sessionId },
        { method: "post" }
      );
    }
  }, [loaderData.isLoading]);
  
  // Rotate loading messages
  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setLoadingMessageIndex((i) => (i + 1) % loadingMessages.length);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [isLoading]);
  
  // Handle save response
  useEffect(() => {
    if (fetcher.data?.saved) {
      setIsSaved(true);
    }
  }, [fetcher.data?.saved]);
  
  const handleSave = () => {
    if (suggestion) {
      fetcher.submit(
        { intent: "save", suggestionId: suggestion.id },
        { method: "post" }
      );
    }
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--naia-cream)] flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[var(--naia-rose)] to-[var(--naia-rose-dark)] animate-pulse" />
            <div className="absolute inset-4 rounded-full bg-[var(--naia-cream)] flex items-center justify-center">
              <span className="text-5xl animate-bounce">✨</span>
            </div>
          </div>
          
          <p className="font-display text-xl text-[var(--naia-charcoal)] mb-2">
            Creating your look
          </p>
          <p className="text-[var(--naia-text-muted)] animate-pulse">
            {loadingMessages[loadingMessageIndex]}
          </p>
          
          <div className="flex justify-center gap-2 mt-8">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[var(--naia-rose)] animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error State
  if (fetcher.data?.error || !suggestion) {
    return (
      <div className="min-h-screen bg-[var(--naia-cream)] flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-4xl">😔</span>
          </div>
          <h1 className="font-display text-2xl text-[var(--naia-charcoal)] mb-2">
            Oops, something went wrong
          </h1>
          <p className="text-[var(--naia-text-muted)] mb-6">
            {fetcher.data?.error || "Couldn't create your outfit. Let's try again!"}
          </p>
          <Link
            to="/style-me/mood"
            className="inline-block px-6 py-3 bg-[var(--naia-rose)] text-white rounded-full font-medium"
          >
            Start Over
          </Link>
        </div>
      </div>
    );
  }

  // Success State
  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link to="/style-me" className="text-[var(--naia-text-muted)] text-sm">
            ← Back
          </Link>
          <h1 className="font-display text-lg font-medium text-[var(--naia-charcoal)]">
            Your Look
          </h1>
          <button
            onClick={handleSave}
            disabled={isSaved}
            className={`text-sm font-medium ${
              isSaved ? "text-green-600" : "text-[var(--naia-rose)]"
            }`}
          >
            {isSaved ? "✓ Saved" : "Save"}
          </button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto">
        {/* Outfit Name & Confidence Boost */}
        <div className="text-center mb-6">
          <h2 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
            {suggestion.outfitName}
          </h2>
          {suggestion.confidenceBoost && (
            <p className="text-[var(--naia-rose)] italic">
              "{suggestion.confidenceBoost}"
            </p>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-white rounded-full p-1 mb-6">
          <button
            onClick={() => setActiveTab("outfit")}
            className={`flex-1 py-2 px-4 rounded-full text-sm font-medium transition-colors ${
              activeTab === "outfit"
                ? "bg-[var(--naia-charcoal)] text-white"
                : "text-[var(--naia-text-muted)]"
            }`}
          >
            👗 Outfit
          </button>
          <button
            onClick={() => setActiveTab("vibe")}
            className={`flex-1 py-2 px-4 rounded-full text-sm font-medium transition-colors ${
              activeTab === "vibe"
                ? "bg-[var(--naia-charcoal)] text-white"
                : "text-[var(--naia-text-muted)]"
            }`}
          >
            ✨ Complete Vibe
          </button>
        </div>

        {activeTab === "outfit" ? (
          <>
            {/* Outfit Items */}
            <div className="space-y-4 mb-8">
              <h3 className="font-medium text-[var(--naia-charcoal)]">
                The Pieces
              </h3>
              {suggestion.items?.map((item: any) => (
                <div
                  key={item.id}
                  className="flex gap-4 p-4 bg-white rounded-xl"
                >
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-[var(--naia-gray-100)] flex-shrink-0">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl">
                        👗
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs text-[var(--naia-text-muted)] uppercase">
                          {item.type}
                        </span>
                        <p className="font-medium text-[var(--naia-charcoal)]">
                          {item.name}
                        </p>
                      </div>
                      {item.price && (
                        <span className="text-sm font-medium text-[var(--naia-charcoal)]">
                          ${item.price}
                        </span>
                      )}
                    </div>
                    
                    {item.stylingTip && (
                      <p className="text-sm text-[var(--naia-text-muted)] mt-1">
                        💡 {item.stylingTip}
                      </p>
                    )}
                    
                    <div className="flex gap-2 mt-2">
                      {item.closetItemId && (
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                          From your closet
                        </span>
                      )}
                      {item.shopifyProductId && (
                        <Link
                          to={`/products/${item.shopifyProductId}`}
                          className="text-xs px-2 py-1 bg-[var(--naia-rose)]/10 text-[var(--naia-rose)] rounded-full"
                        >
                          View in store →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Style Notes */}
            {suggestion.styleNotes && (
              <div className="p-4 bg-[var(--naia-rose)]/5 rounded-xl mb-6">
                <h3 className="font-medium text-[var(--naia-charcoal)] mb-2">
                  ✨ Styling Notes
                </h3>
                <p className="text-[var(--naia-text-muted)] text-sm">
                  {suggestion.styleNotes}
                </p>
              </div>
            )}
          </>
        ) : (
          /* Vibe Tab */
          <div className="space-y-4">
            {suggestion.perfumeSuggestion && (
              <div className="p-4 bg-white rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🌸</span>
                  <h3 className="font-medium text-[var(--naia-charcoal)]">
                    Scent
                  </h3>
                </div>
                <p className="text-[var(--naia-text-muted)]">
                  {suggestion.perfumeSuggestion}
                </p>
              </div>
            )}
            
            {suggestion.hairSuggestion && (
              <div className="p-4 bg-white rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">💇‍♀️</span>
                  <h3 className="font-medium text-[var(--naia-charcoal)]">
                    Hair
                  </h3>
                </div>
                <p className="text-[var(--naia-text-muted)]">
                  {suggestion.hairSuggestion}
                </p>
              </div>
            )}
            
            {suggestion.makeupSuggestion && (
              <div className="p-4 bg-white rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">💄</span>
                  <h3 className="font-medium text-[var(--naia-charcoal)]">
                    Makeup
                  </h3>
                </div>
                <p className="text-[var(--naia-text-muted)]">
                  {suggestion.makeupSuggestion}
                </p>
              </div>
            )}
            
            {suggestion.songSuggestion && (
              <div className="p-4 bg-gradient-to-br from-[var(--naia-rose)]/10 to-purple-100 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🎵</span>
                  <h3 className="font-medium text-[var(--naia-charcoal)]">
                    Your Confidence Song
                  </h3>
                </div>
                <p className="text-[var(--naia-charcoal)] font-medium">
                  {suggestion.songSuggestion}
                </p>
                <p className="text-sm text-[var(--naia-text-muted)] mt-1">
                  Play this while getting ready ✨
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 mt-8">
          <Link
            to="/style-me/mood"
            className="flex-1 py-3 px-4 bg-white text-[var(--naia-charcoal)] text-center rounded-full font-medium border border-[var(--naia-gray-200)]"
          >
            New Look
          </Link>
          <Link
            to="/try-on"
            className="flex-1 py-3 px-4 bg-[var(--naia-rose)] text-white text-center rounded-full font-medium"
          >
            Try It On ✨
          </Link>
        </div>
      </main>
    </div>
  );
}
