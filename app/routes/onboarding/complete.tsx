import { Link, useLoaderData, redirect, data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { getCustomer } from "~/lib/auth.server";
import type { OnboardingAnswers } from "~/lib/onboarding/quiz-data";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const answers = session.get("onboardingAnswers") as OnboardingAnswers | undefined;

  if (!answers || !answers["style-personalities"]) {
    return redirect("/onboarding/step/1");
  }

  let customer = await getCustomer(request);
  
  if (!customer) {
    customer = await prisma.customer.findFirst({
      where: { shopifyCustomerId: "guest" }
    });
  }

  if (customer) {
    await prisma.onboardingProfile.upsert({
      where: { customerId: customer.id },
      create: {
        customerId: customer.id,
        completed: true,
        stylePersonalities: answers["style-personalities"] || [],
        styleIcons: [],
        favoriteColors: answers["favorite-colors"] || [],
        avoidColors: answers["avoid-colors"] || [],
        lifestyle: Array.isArray(answers.lifestyle) ? answers.lifestyle[0] : answers.lifestyle || null,
        dressesFor: Array.isArray(answers.lifestyle) ? answers.lifestyle : [],
        typicalDay: null,
        currentMood: null,
        desiredFeeling: answers["desired-feelings"]?.[0] || null,
        confidenceBlockers: answers.struggles || [],
        styleStruggles: answers.struggles || [],
        comfortLevel: null,
        budgetRange: null,
        shoppingHabits: null,
        helpWantedMost: answers["help-wanted"]?.[0] || null,
      },
      update: {
        completed: true,
        stylePersonalities: answers["style-personalities"] || [],
        favoriteColors: answers["favorite-colors"] || [],
        avoidColors: answers["avoid-colors"] || [],
        dressesFor: Array.isArray(answers.lifestyle) ? answers.lifestyle : [],
        desiredFeeling: answers["desired-feelings"]?.[0] || null,
        confidenceBlockers: answers.struggles || [],
        styleStruggles: answers.struggles || [],
        helpWantedMost: answers["help-wanted"]?.[0] || null,
      },
    });
  }

  session.unset("onboardingAnswers");

  const styleSummary = generateStyleSummary(answers);

  return data(
    { answers, styleSummary },
    {
      headers: {
        "Set-Cookie": await commitSession(session),
      },
    }
  );
}

function generateStyleSummary(answers: OnboardingAnswers): {
  title: string;
  description: string;
  traits: string[];
} {
  const personalities = answers["style-personalities"] || [];
  const primaryStyle = personalities[0] || "effortlessly-chic";

  const summaries: Record<string, { title: string; description: string }> = {
    "old-money": {
      title: "The Timeless Classic",
      description: "You appreciate quality, heritage, and understated elegance.",
    },
    "artsy": {
      title: "The Creative Spirit",
      description: "You express yourself through unique pieces and artistic flair.",
    },
    "edgy": {
      title: "The Bold Rebel",
      description: "You're not afraid to make a statement and push boundaries.",
    },
    "feminine": {
      title: "The Soft Romantic",
      description: "You're drawn to delicate details and graceful silhouettes.",
    },
    "corporate-chic": {
      title: "The Polished Professional",
      description: "You blend sophistication with modern elegance.",
    },
    "effortlessly-chic": {
      title: "The Natural Stylist",
      description: "You make looking put-together seem completely effortless.",
    },
    "minimal": {
      title: "The Modern Minimalist",
      description: "You believe in the power of simplicity and intentional pieces.",
    },
    "trendy": {
      title: "The Fashion Forward",
      description: "You love staying ahead of the curve and experimenting with new styles.",
    },
    "romantic": {
      title: "The Dreamer",
      description: "You're drawn to soft, feminine pieces that tell a story.",
    },
    "casual-cool": {
      title: "The Relaxed Stylist",
      description: "You master the art of looking good without trying too hard.",
    },
  };

  const summary = summaries[primaryStyle] || summaries["effortlessly-chic"];

  // Build traits from ALL desired feelings (not just one)
  const traits: string[] = [];
  if (answers["desired-feelings"] && answers["desired-feelings"].length > 0) {
    traits.push(...answers["desired-feelings"].map((f) => f.charAt(0).toUpperCase() + f.slice(1)));
  }

  return { ...summary, traits };
}

export default function OnboardingComplete() {
  const { styleSummary } = useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      {/* Header */}
      <div style={{ background: "#221516", color: "#f4f4f1", padding: "80px 40px", textAlign: "center" }}>
        <div style={{ maxWidth: "600px", margin: "0 auto" }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "72px", marginBottom: "24px", opacity: 0.2 }}>◇</div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(36px,5vw,56px)", fontWeight: 900, marginBottom: "16px" }}>
            Welcome to nAia
          </h1>
          <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", opacity: 0.9 }}>
            I've got to know your style. Let's create some magic together.
          </p>
        </div>
      </div>

      {/* Style Summary */}
      <main style={{ maxWidth: "800px", margin: "-40px auto 0", padding: "0 40px 80px" }}>
        <div style={{ background: "rgba(255,255,255,0.95)", padding: "48px", border: "1px solid rgba(59,5,16,0.06)", boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>YOUR STYLE PERSONALITY</div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "36px", fontWeight: 700, color: "#221516", marginBottom: "16px" }}>
              {styleSummary.title}
            </h2>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a", lineHeight: 1.6 }}>
              {styleSummary.description}
            </p>
          </div>

          {/* Traits - Show ALL desired feelings */}
          {styleSummary.traits.length > 0 && (
            <div style={{ marginBottom: "40px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "16px", textAlign: "center" }}>
                YOU WANT TO FEEL
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px" }}>
                {styleSummary.traits.map((trait) => (
                  <span
                    key={trait}
                    style={{ padding: "8px 16px", background: "rgba(139,32,53,0.08)", color: "#8b2035", fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", border: "1px solid rgba(139,32,53,0.1)" }}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "20px", textAlign: "center" }}>
            WHAT WOULD YOU LIKE TO DO FIRST?
          </div>

          <div style={{ display: "grid", gap: "16px" }}>
            <Link
              to="/quick-style"
              style={{ display: "flex", alignItems: "center", gap: "20px", padding: "24px", background: "rgba(255,255,255,0.5)", border: "1px solid rgba(59,5,16,0.06)", textDecoration: "none", transition: "all 0.2s" }}
            >
              <div style={{ width: "48px", height: "48px", background: "rgba(139,32,53,0.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Playfair Display',serif", fontSize: "24px", color: "#8b2035" }}>◇</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "20px", fontWeight: 600, color: "#221516", marginBottom: "4px" }}>Style Me</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Get outfit ideas based on your mood</div>
              </div>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "12px", color: "#8b2035" }}>→</span>
            </Link>

            <Link
              to="/closet"
              style={{ display: "flex", alignItems: "center", gap: "20px", padding: "24px", background: "rgba(255,255,255,0.5)", border: "1px solid rgba(59,5,16,0.06)", textDecoration: "none", transition: "all 0.2s" }}
            >
              <div style={{ width: "48px", height: "48px", background: "rgba(139,32,53,0.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Playfair Display',serif", fontSize: "24px", color: "#8b2035" }}>◼</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "20px", fontWeight: 600, color: "#221516", marginBottom: "4px" }}>Digital Wardrobe</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Upload your pieces for personalized styling</div>
              </div>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "12px", color: "#8b2035" }}>→</span>
            </Link>

            <Link
              to="/"
              style={{ display: "flex", alignItems: "center", gap: "20px", padding: "24px", background: "rgba(255,255,255,0.5)", border: "1px solid rgba(59,5,16,0.06)", textDecoration: "none", transition: "all 0.2s" }}
            >
              <div style={{ width: "48px", height: "48px", background: "rgba(139,32,53,0.08)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Playfair Display',serif", fontSize: "24px", color: "#8b2035" }}>★</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "20px", fontWeight: 600, color: "#221516", marginBottom: "4px" }}>View Dashboard</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Explore all features</div>
              </div>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "12px", color: "#8b2035" }}>→</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
