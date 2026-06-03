// app/routes/style-me/result.tsx - REDESIGNED WITH PROPER AESTHETICS
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
          desiredFeeling: session.desiredFeeling,
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
      { isLoading: true, sessionId: stylingSession.id, mood, currentMood: mood, desiredFeeling: feelings?.[0] || null, occasion, suggestion: null, error: null },
      { headers: { "Set-Cookie": await commitSession(cookieSession) } }
    );
  } catch (err: any) {
    console.error("Result loader error:", err);
    return data({ isLoading: false, sessionId: null, mood: null, currentMood: null, desiredFeeling: null, occasion: null, suggestion: null, error: err?.message || "Something went wrong" });
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
            content: `You are styling for nAia, a womenswear brand. The customer is feeling "${session.currentMood}" and wants to feel "${session.desiredFeeling}" for "${session.occasion}".

Here are the available nAia pieces to choose from:
1. Sculptural Hybrid Coat - outerwear
2. Art Blouse - top
3. Art Panel Tailored Blazer - outerwear
4. Textured Art Maxi Skirt - bottom
5. Wrap Cropped Top - top
6. Printed Wrap Kimono Jacket - outerwear
7. Art Collar Shirt - top
8. Leather Midi Dress - dress
9. Asymmetrical Waist Pants - bottom
10. Printed Straight Pants - bottom

Create a complete outfit using 2-3 of these pieces. Return JSON with: outfitName, whyThisWorks, confidenceBoost, perfumeRec, hairstyleRec, makeupVibeRec, songRec, and items array where each item has: itemType (one of: TOP, BOTTOM, DRESS, OUTERWEAR, SHOES, BAG, ACCESSORY, JEWELRY), productTitle (must be exact name from the list above), stylingNotes, shopifyProductId (the numeric ID from this mapping: Sculptural Hybrid Coat=7822708867114, Art Blouse=7822708310058, Art Panel Tailored Blazer=7822708113450, Textured Art Maxi Skirt=7822708047914, Wrap Cropped Top=7822707949610, Printed Wrap Kimono Jacket=7822707589162, Art Collar Shirt=7822707392554, Leather Midi Dress=7822707130410, Asymmetrical Waist Pants=7822706475050, Printed Straight Pants=7822706016298), productImageUrl (from this mapping: Sculptural Hybrid Coat=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png, Art Blouse=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32674461-cac7-4699-aff1-74c435289333.png, Art Panel Tailored Blazer=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/a7b908bb-3079-4f39-93b8-e1a89435249a.png, Textured Art Maxi Skirt=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/6992350d-5695-4f28-8674-7747dfd1e680.png, Wrap Cropped Top=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3614927b-4685-4df3-aeff-b3d5a950cbd2.png, Printed Wrap Kimono Jacket=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/77d61b97-37da-4e57-8297-aa5207b35d07.png, Art Collar Shirt=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/32fe2afb-b8ef-46d2-ae2c-b1adc81a1b0f.png, Leather Midi Dress=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/8a855f15-e5e9-4ef5-a7db-a7253e83a542.png, Asymmetrical Waist Pants=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png, Printed Straight Pants=https://cdn.shopify.com/s/files/1/0705/6962/3594/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png).`,
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
        shopifyProductId: item.shopifyProductId || null,
        productImageUrl: item.productImageUrl || null,
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

    if (intent === "review") {
      const overallReaction = parseInt(formData.get("overallReaction") as string);
      const feltLikeMe = formData.get("feltLikeMe") === "true";
      const createdFeeling = formData.get("createdFeeling") === "true";
      const wouldWear = formData.get("wouldWear") === "true";
      const physicalComfort = parseInt(formData.get("physicalComfort") as string);
      const whatWorked = (formData.get("whatWorked") as string || "").split(",").filter(Boolean);
      const whatDidnt = (formData.get("whatDidnt") as string || "").split(",").filter(Boolean);

      const session = await prisma.stylingSession.findUnique({
        where: { id: sessionId },
        include: { suggestions: true }
      });

      if (!session || !session.suggestions[0]) {
        return data({ error: "Session not found" }, { status: 404 });
      }

      await prisma.postOutfitReview.create({
        data: {
          suggestionId: session.suggestions[0].id,
          overallReaction,
          feltLikeMe,
          createdTheFeeling: createdFeeling,
          wouldWearThis: wouldWear,
          physicalComfort,
          whatWorked,
          whatDidnt,
        }
      });

      return data({ reviewSaved: true, error: null });
    }

    }

    return data({ error: "Invalid intent" }, { status: 400 });
  } catch (err: any) {
    console.error("Result action error:", err);
    return data({ error: err?.message || "Something went wrong" }, { status: 500 });
  }
}

const loadingMessages = ["Reading the runways...", "Consulting your mood...", "Matching textures and fabrics...", "Finalizing your look..."];

export default function StyleMeResult() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ suggestion?: any; error?: string; saved?: boolean }>();
  const [msgIndex, setMsgIndex] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const reviewFetcher = useFetcher();
  const [reviewData, setReviewData] = useState({
    overallReaction: 0,
    feltLikeMe: null as boolean | null,
    createdFeeling: null as boolean | null,
    wouldWear: null as boolean | null,
    physicalComfort: 0,
    whatWorked: [] as string[],
    whatDidnt: [] as string[]
  });

  const whatWorkedOptions = ["Silhouette", "Color palette", "Styling approach", "Accessories", "Hair suggestion", "Makeup suggestion", "Perfume", "Song", "Confidence boost", "Overall vibe"];
  const whatDidntOptions = ["Too formal", "Too casual", "Wrong colors", "Uncomfortable silhouette", "Doesn't match my style", "Too bold", "Too safe", "Wrong occasion", "Accessories felt off", "Hair/makeup didn't resonate", "Not my vibe"];

  const submitReview = () => {
    if (!reviewData.overallReaction || reviewData.feltLikeMe === null || reviewData.createdFeeling === null || reviewData.wouldWear === null || !reviewData.physicalComfort) {
      alert("Please answer all required questions");
      return;
    }
    
    const formData = new FormData();
    formData.append("intent", "review");
    formData.append("sessionId", loaderData.sessionId || "");
    formData.append("overallReaction", reviewData.overallReaction.toString());
    formData.append("feltLikeMe", reviewData.feltLikeMe.toString());
    formData.append("createdFeeling", reviewData.createdFeeling.toString());
    formData.append("wouldWear", reviewData.wouldWear.toString());
    formData.append("physicalComfort", reviewData.physicalComfort.toString());
    formData.append("whatWorked", reviewData.whatWorked.join(","));
    formData.append("whatDidnt", reviewData.whatDidnt.join(","));
    
    reviewFetcher.submit(formData, { method: "post" });
  setShowReviewModal(false);
setReviewSaved(true);
setTimeout(() => setReviewSaved(false), 3000);
  };










  const toggleWorkedTag = (tag: string) => {
    setReviewData({
      ...reviewData,
      whatWorked: reviewData.whatWorked.includes(tag) ? reviewData.whatWorked.filter(t => t !== tag) : [...reviewData.whatWorked, tag]
    });
  };

  const toggleDidntTag = (tag: string) => {
    setReviewData({
      ...reviewData,
      whatDidnt: reviewData.whatDidnt.includes(tag) ? reviewData.whatDidnt.filter(t => t !== tag) : [...reviewData.whatDidnt, tag]
    });
  };

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
      <div style={{ minHeight: "100vh", background: "#f4f4f1", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&family=Caveat:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center", maxWidth: "700px", padding: "40px" }}>
          <h2 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "32px", fontWeight: 900, fontStyle: "italic", color: "#221516", marginBottom: "16px" }}>nAia is styling you...</h2>
          <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "40px" }}>Building your look based on mood, occasion, and wardrobe.</p>
          <div style={{ width: "200px", height: "3px", background: "#e1dbd7", margin: "0 auto", overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", left: "-60%", width: "60%", height: "100%", background: "#8b2035", animation: "loadSlide 1.5s ease infinite" }} />
          </div>
          <div style={{ fontFamily: "'Caveat',cursive", fontSize: "18px", color: "#8b2035", opacity: 0.5, marginTop: "24px" }}>{loadingMessages[msgIndex]}</div>
        </div>
        <style>{`@keyframes loadSlide{0%{left:-60%}100%{left:100%}}`}</style>
      </div>
    );
  }

  if (error || !suggestion) {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f4f1", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center", maxWidth: "500px" }}>
          <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "32px", fontWeight: 900, color: "#221516", marginBottom: "16px" }}>Something went wrong</h1>
          <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "32px" }}>{error || "Couldn't create your outfit. Let's try again"}</p>
          <button onClick={() => fetcher.submit({ intent: "regenerate", sessionId: loaderData.sessionId }, { method: "post" })} style={{ display: "inline-block", padding: "14px 32px", background: "#221516", color: "#f4f4f1", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", border: "none", cursor: "pointer" }}>New Look, Same Vibe</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ content: '', position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, opacity: 0.03, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", backgroundSize: '200px' }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
        <Link to="/quick-style" style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", textDecoration: "none" }}>Back</Link>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "22px", fontStyle: "italic", letterSpacing: "3px", color: "#221516" }}>nAia</div>
        <button onClick={() => fetcher.submit({ intent: "save", suggestionId: suggestion.id }, { method: "post" })} disabled={isSaved} style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: isSaved ? "#8b2035" : "#7a6f6a", background: "none", border: "none", cursor: "pointer" }}>{isSaved ? "Saved" : "Save"}</button>
      </div>
      <main style={{ maxWidth: "800px", margin: "0 auto", padding: "48px 40px 80px" }}>
        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Your Styling</div>
          <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, color: "#221516", letterSpacing: "-1px", marginBottom: "8px" }}>{suggestion.outfitName}</h1>
          <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a" }}>Styled around your mood, your wardrobe, and the way you want to feel.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px", padding: "20px 0", borderTop: "1px solid rgba(59,5,16,0.06)", borderBottom: "1px solid rgba(59,5,16,0.06)", marginBottom: "40px" }}>
          <div><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "4px" }}>You're Feeling</div><div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "20px", fontStyle: "italic", color: "#221516" }}>{loaderData.currentMood}</div></div>
          <div><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "4px" }}>You Want to Feel</div><div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "20px", fontStyle: "italic", color: "#221516" }}>{loaderData.desiredFeeling}</div></div>
          <div><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "4px" }}>Dressing For</div><div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "20px", fontStyle: "italic", color: "#221516" }}>{loaderData.occasion}</div></div>
        </div>
        <div style={{ marginBottom: "36px" }}>
          <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid rgba(139,32,53,0.1)" }}>Your Outfit Direction</div>
          {suggestion.items?.map((item: any) => (<div key={item.id} style={{ padding: "14px 0", borderLeft: "3px solid #8b2035", paddingLeft: "20px", marginBottom: "12px" }}>{item.productImageUrl && <img src={item.productImageUrl} alt={item.productTitle} style={{ width: "140px", height: "180px", objectFit: "contain", marginBottom: "12px" }} />}<div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "17px", lineHeight: 1.6, color: "#221516" }}>{item.stylingNotes || item.productTitle}</div>{item.shopifyProductId && <a href={`https://naiabynadine.com/products/${item.shopifyProductId}`} style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none", display: "inline-block", marginTop: "8px" }}>View in store →</a>}</div>))}
        </div>
        {suggestion.whyThisWorks && <div style={{ background: "rgba(59,5,16,0.02)", padding: "28px", marginBottom: "36px" }}><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Why This Works</div><p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", lineHeight: 1.8, color: "#7a6f6a" }}>{suggestion.whyThisWorks}</p></div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px", marginBottom: "36px" }}>
          {suggestion.perfumeRec && <div style={{ background: "#f0e8e4", padding: "20px" }}><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>Perfume</div><div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", color: "#221516" }}>{suggestion.perfumeRec}</div></div>}
          {suggestion.songRec && <div style={{ background: "#f0e8e4", padding: "20px" }}><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>Song</div><div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", color: "#221516" }}>{suggestion.songRec}</div></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "36px" }}>
          {suggestion.hairstyleRec && <div style={{ background: "#f0e8e4", padding: "20px" }}><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>Hair</div><div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", color: "#221516" }}>{suggestion.hairstyleRec}</div></div>}
          {suggestion.makeupVibeRec && <div style={{ background: "#f0e8e4", padding: "20px" }}><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>Makeup</div><div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", color: "#221516" }}>{suggestion.makeupVibeRec}</div></div>}
        </div>
        {suggestion.confidenceBoost && <div style={{ padding: "28px 0", borderTop: "1px solid rgba(59,5,16,0.06)", borderBottom: "1px solid rgba(59,5,16,0.06)", marginBottom: "36px" }}><div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>The Shift</div><div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "22px", fontWeight: 400, fontStyle: "italic", lineHeight: 1.5, color: "#221516" }}>{suggestion.confidenceBoost}</div></div>}
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "40px", paddingTop: "28px", borderTop: "1px solid rgba(59,5,16,0.06)" }}>

      {showReviewModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: "20px" }} onClick={() => setShowReviewModal(false)}>
          <div style={{ background: "#f4f4f1", maxWidth: "600px", width: "100%", padding: "40px", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "32px", fontWeight: 900, fontStyle: "italic", marginBottom: "32px" }}>How was this look?</h2>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Overall Reaction *</div>
              <div style={{ display: "flex", gap: "12px" }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setReviewData({...reviewData, overallReaction: n})} style={{ width: "50px", height: "50px", border: reviewData.overallReaction === n ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.overallReaction === n ? "#8b2035" : "transparent", color: reviewData.overallReaction === n ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "18px", cursor: "pointer", transition: "all 0.3s" }}>{"★"}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Did it feel like you? *</div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={() => setReviewData({...reviewData, feltLikeMe: true})} style={{ padding: "12px 24px", border: reviewData.feltLikeMe === true ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.feltLikeMe === true ? "#8b2035" : "transparent", color: reviewData.feltLikeMe === true ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>Yes</button>
                <button onClick={() => setReviewData({...reviewData, feltLikeMe: false})} style={{ padding: "12px 24px", border: reviewData.feltLikeMe === false ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.feltLikeMe === false ? "#8b2035" : "transparent", color: reviewData.feltLikeMe === false ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>No</button>
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Created the feeling you wanted? *</div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={() => setReviewData({...reviewData, createdFeeling: true})} style={{ padding: "12px 24px", border: reviewData.createdFeeling === true ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.createdFeeling === true ? "#8b2035" : "transparent", color: reviewData.createdFeeling === true ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>Yes</button>
                <button onClick={() => setReviewData({...reviewData, createdFeeling: false})} style={{ padding: "12px 24px", border: reviewData.createdFeeling === false ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.createdFeeling === false ? "#8b2035" : "transparent", color: reviewData.createdFeeling === false ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>No</button>
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Would you wear this? *</div>
              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={() => setReviewData({...reviewData, wouldWear: true})} style={{ padding: "12px 24px", border: reviewData.wouldWear === true ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.wouldWear === true ? "#8b2035" : "transparent", color: reviewData.wouldWear === true ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>Yes</button>
                <button onClick={() => setReviewData({...reviewData, wouldWear: false})} style={{ padding: "12px 24px", border: reviewData.wouldWear === false ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.wouldWear === false ? "#8b2035" : "transparent", color: reviewData.wouldWear === false ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}>No</button>
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Physical Comfort *</div>
              <div style={{ display: "flex", gap: "12px" }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setReviewData({...reviewData, physicalComfort: n})} style={{ width: "50px", height: "50px", border: reviewData.physicalComfort === n ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.physicalComfort === n ? "#8b2035" : "transparent", color: reviewData.physicalComfort === n ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "14px", cursor: "pointer" }}>{n}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>What Worked?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {whatWorkedOptions.map(tag => (
                  <button key={tag} onClick={() => toggleWorkedTag(tag)} style={{ padding: "10px 18px", border: reviewData.whatWorked.includes(tag) ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.whatWorked.includes(tag) ? "#8b2035" : "transparent", color: reviewData.whatWorked.includes(tag) ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", cursor: "pointer" }}>{tag}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>What Didn't Work?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {whatDidntOptions.map(tag => (
                  <button key={tag} onClick={() => toggleDidntTag(tag)} style={{ padding: "10px 18px", border: reviewData.whatDidnt.includes(tag) ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.12)", background: reviewData.whatDidnt.includes(tag) ? "#8b2035" : "transparent", color: reviewData.whatDidnt.includes(tag) ? "#f4f4f1" : "#221516", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", cursor: "pointer" }}>{tag}</button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "32px" }}>
              <button onClick={() => setShowReviewModal(false)} style={{ flex: 1, padding: "14px 32px", border: "1px solid rgba(59,5,16,0.12)", background: "transparent", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", cursor: "pointer" }}>Cancel</button>
              <button onClick={submitReview} style={{ flex: 1, padding: "14px 32px", border: "none", background: "#221516", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", cursor: "pointer" }}>Submit Review</button>
            </div>
          </div>
        </div>
      )}
          <Link to="/apps/naia-stylist/quick-style" style={{ padding: "14px 32px", background: "transparent", color: "#221516", border: "1px solid rgba(59,5,16,0.12)", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", textDecoration: "none" }}>Start Over</Link>
          <button onClick={() => fetcher.submit({ intent: "regenerate", sessionId: loaderData.sessionId }, { method: "post" })} style={{ padding: "14px 32px", background: "#221516", color: "#f4f4f1", border: "none", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", cursor: "pointer" }}>New Look, Same Vibe</button>
          <button onClick={() => setShowReviewModal(true)} style={{ padding: "14px 32px", background: "transparent", color: "#221516", border: "1px solid rgba(59,5,16,0.12)", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", cursor: "pointer" }}>Rate This Look</button>
          <a href="https://naiabynadine.com" style={{ padding: "14px 32px", background: "transparent", color: "#221516", border: "1px solid rgba(59,5,16,0.12)", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", textDecoration: "none" }}>Shop nAia</a>
        </div>
        {reviewSaved && (
  <div style={{
    position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
    background: "#221516", color: "#f4f4f1", padding: "14px 32px",
    fontFamily: "'Space Mono',monospace", fontSize: "10px",
    letterSpacing: "3px", textTransform: "uppercase", zIndex: 99999,
  }}>
    Review saved — thank you
  </div>
)}
      </main>
    </div>
  );
}
