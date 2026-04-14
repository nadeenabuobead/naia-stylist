// app/routes/onboarding/complete.tsx
import { Link, useLoaderData } from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { getSession, commitSession } from "~/lib/session.server";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";
import type { OnboardingAnswers } from "~/lib/onboarding/quiz-data";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const answers = session.get("onboardingAnswers") as OnboardingAnswers | undefined;

  if (!answers || !answers["style-personality"]) {
    return redirect("/onboarding/step/1");
  }

  const customerId = await getCustomerId(request);

  // Save to database if logged in
  if (customerId) {
    await prisma.onboardingProfile.upsert({
      where: { customerId },
      create: {
        customerId,
        stylePersonality: answers["style-personality"],
        lifestyle: answers.lifestyle,
        moodFeelings: answers["mood-feelings"] || [],
        styleStruggles: answers.struggles || [],
        colorPreferences: answers.colors || [],
        avoidColors: answers["avoid-colors"] || [],
        fitPreferences: answers["fit-preferences"] || [],
        budget: answers.budget,
        helpWanted: answers["help-wanted"] || [],
        additionalNotes: answers["final-thoughts"],
      },
      update: {
        stylePersonality: answers["style-personality"],
        lifestyle: answers.lifestyle,
        moodFeelings: answers["mood-feelings"] || [],
        styleStruggles: answers.struggles || [],
        colorPreferences: answers.colors || [],
        avoidColors: answers["avoid-colors"] || [],
        fitPreferences: answers["fit-preferences"] || [],
        budget: answers.budget,
        helpWanted: answers["help-wanted"] || [],
        additionalNotes: answers["final-thoughts"],
      },
    });
  }

  // Clear onboarding answers from session
  session.unset("onboardingAnswers");

  // Generate style summary
  const styleSummary = generateStyleSummary(answers);

  return json(
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
  const personality = answers["style-personality"];

  const summaries: Record<string, { title: string; description: string }> = {
    classic: {
      title: "The Timeless Elegant",
      description: "You appreciate quality over quantity and gravitate towards pieces that never go out of style. Your wardrobe is built on a foundation of well-tailored basics.",
    },
    bohemian: {
      title: "The Free Spirit",
      description: "You express yourself through artistic, flowy pieces that tell a story. Comfort and creativity are your style priorities.",
    },
    minimalist: {
      title: "The Modern Curator",
      description: "You believe in the power of simplicity. Every piece in your wardrobe is intentional, and you master the art of looking effortlessly chic.",
    },
    romantic: {
      title: "The Soft Dreamer",
      description: "You're drawn to feminine details, soft textures, and delicate touches. Your style is graceful and inherently elegant.",
    },
    edgy: {
      title: "The Bold Statement",
      description: "You're not afraid to stand out. Your style pushes boundaries and makes a statement without saying a word.",
    },
    trendy: {
      title: "The Fashion Forward",
      description: "You love being ahead of the curve. Experimenting with new trends and styles is your creative outlet.",
    },
  };

  const summary = summaries[personality || "classic"] || summaries.classic;

  // Build traits from answers
  const traits: string[] = [];

  if (answers["mood-feelings"]) {
    traits.push(...answers["mood-feelings"].slice(0, 2).map((f) => f.charAt(0).toUpperCase() + f.slice(1)));
  }

  if (answers.lifestyle) {
    const lifestyleTraits: Record<string, string> = {
      office: "Professional polish",
      creative: "Creative flair",
      wfh: "Comfortable chic",
      active: "On-the-go ready",
      social: "Event-ready",
      mom: "Practical elegance",
    };
    if (lifestyleTraits[answers.lifestyle]) {
      traits.push(lifestyleTraits[answers.lifestyle]);
    }
  }

  return { ...summary, traits };
}

export default function OnboardingComplete() {
  const { styleSummary } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Celebration Header */}
      <div className="bg-gradient-to-br from-[var(--naia-rose)] to-[var(--naia-rose-dark)] text-white px-4 py-12 text-center">
        <div className="max-w-lg mx-auto">
          <div className="w-20 h-20 mx-auto mb-6 bg-white/20 rounded-full flex items-center justify-center">
            <span className="text-4xl">✨</span>
          </div>
          <h1 className="font-display text-3xl font-medium mb-2">
            Welcome to nAia!
          </h1>
          <p className="text-white/80">
            I've got to know your style. Let's create some magic together.
          </p>
        </div>
      </div>

      {/* Style Summary Card */}
      <main className="px-4 py-8 max-w-lg mx-auto -mt-6">
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <div className="text-center mb-6">
            <p className="text-sm text-[var(--naia-text-muted)] mb-1">Your style personality</p>
            <h2 className="font-display text-2xl font-medium text-[var(--naia-charcoal)]">
              {styleSummary.title}
            </h2>
          </div>

          <p className="text-[var(--naia-text-muted)] text-center mb-6">
            {styleSummary.description}
          </p>

          {/* Style Traits */}
          {styleSummary.traits.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {styleSummary.traits.map((trait) => (
                <span
                  key={trait}
                  className="px-3 py-1 bg-[var(--naia-rose)]/10 text-[var(--naia-rose)] rounded-full text-sm font-medium"
                >
                  {trait}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <h3 className="font-display text-lg font-medium text-[var(--naia-charcoal)] text-center">
            What would you like to do first?
          </h3>

          <Link
            to="/style-me"
            className="flex items-center gap-4 p-4 bg-white rounded-xl hover:shadow-md transition-shadow"
          >
            <div className="w-12 h-12 bg-[var(--naia-rose)]/10 rounded-full flex items-center justify-center">
              <span className="text-2xl">👗</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--naia-charcoal)]">Style Me</p>
              <p className="text-sm text-[var(--naia-text-muted)]">Get outfit ideas based on your mood</p>
            </div>
            <span className="text-[var(--naia-text-muted)]">→</span>
          </Link>

          <Link
            to="/closet/upload"
            className="flex items-center gap-4 p-4 bg-white rounded-xl hover:shadow-md transition-shadow"
          >
            <div className="w-12 h-12 bg-[var(--naia-rose)]/10 rounded-full flex items-center justify-center">
              <span className="text-2xl">📸</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--naia-charcoal)]">Add to Closet</p>
              <p className="text-sm text-[var(--naia-text-muted)]">Upload your wardrobe for personalized styling</p>
            </div>
            <span className="text-[var(--naia-text-muted)]">→</span>
          </Link>

          <Link
            to="/"
            className="flex items-center gap-4 p-4 bg-white rounded-xl hover:shadow-md transition-shadow"
          >
            <div className="w-12 h-12 bg-[var(--naia-rose)]/10 rounded-full flex items-center justify-center">
              <span className="text-2xl">🏠</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--naia-charcoal)]">Explore nAia</p>
              <p className="text-sm text-[var(--naia-text-muted)]">Browse all features</p>
            </div>
            <span className="text-[var(--naia-text-muted)]">→</span>
          </Link>
        </div>

        {/* Bottom message */}
        <p className="text-center text-sm text-[var(--naia-text-muted)] mt-8">
          You can update your style profile anytime in settings 💕
        </p>
      </main>
    </div>
  );
}
