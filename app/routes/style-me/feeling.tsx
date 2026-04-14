// app/routes/style-me/feeling.tsx
import { Form, Link, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

// Feelings - how user wants to FEEL in their outfit
const feelings = [
  { id: "elegant", label: "Elegant", emoji: "💎", color: "bg-purple-100 text-purple-700" },
  { id: "cozy", label: "Cozy", emoji: "🧸", color: "bg-amber-100 text-amber-700" },
  { id: "bold", label: "Bold", emoji: "🔥", color: "bg-red-100 text-red-700" },
  { id: "effortless", label: "Effortless", emoji: "🌊", color: "bg-blue-100 text-blue-700" },
  { id: "feminine", label: "Feminine", emoji: "🌸", color: "bg-pink-100 text-pink-700" },
  { id: "edgy", label: "Edgy", emoji: "⚡", color: "bg-slate-200 text-slate-700" },
  { id: "classic", label: "Classic", emoji: "🎩", color: "bg-gray-100 text-gray-700" },
  { id: "trendy", label: "Trendy", emoji: "✨", color: "bg-fuchsia-100 text-fuchsia-700" },
  { id: "minimalist", label: "Minimalist", emoji: "○", color: "bg-stone-100 text-stone-700" },
  { id: "glamorous", label: "Glamorous", emoji: "💄", color: "bg-rose-100 text-rose-700" },
  { id: "bohemian", label: "Bohemian", emoji: "🌻", color: "bg-orange-100 text-orange-700" },
  { id: "professional", label: "Professional", emoji: "💼", color: "bg-indigo-100 text-indigo-700" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  
  // Redirect back if no mood selected
  if (!mood) {
    return redirect("/style-me/mood");
  }
  
  return json({ mood });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const feelingsRaw = formData.get("feelings") as string;
  
  if (!feelingsRaw) {
    return json({ error: "Please select at least one feeling" }, { status: 400 });
  }
  
  const selectedFeelings = feelingsRaw.split(",").filter(Boolean);
  
  if (selectedFeelings.length === 0) {
    return json({ error: "Please select at least one feeling" }, { status: 400 });
  }
  
  // Store in session
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeFeelings", selectedFeelings);
  
  return redirect("/style-me/occasion", {
    headers: {
      "Set-Cookie": await commitSession(session)
    }
  });
}

export default function StyleMeFeeling() {
  const { mood } = useLoaderData<typeof loader>();
  const [selectedFeelings, setSelectedFeelings] = useState<string[]>([]);

  const toggleFeeling = (feelingId: string) => {
    setSelectedFeelings((prev) => {
      if (prev.includes(feelingId)) {
        return prev.filter((id) => id !== feelingId);
      }
      // Max 3 selections
      if (prev.length >= 3) {
        return prev;
      }
      return [...prev, feelingId];
    });
  };

  // Get mood emoji for display
  const moodEmoji: Record<string, string> = {
    confident: "💪",
    calm: "🌿",
    playful: "🎀",
    romantic: "🌹",
    powerful: "👑",
    mysterious: "🌙",
    joyful: "☀️",
    sophisticated: "✨",
  };

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link to="/style-me/mood" className="text-[var(--naia-text-muted)] text-sm">
            ← Back
          </Link>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`w-8 h-1 rounded-full ${
                  step <= 2 ? "bg-[var(--naia-rose)]" : "bg-[var(--naia-gray-200)]"
                }`}
              />
            ))}
          </div>
          <span className="text-sm text-[var(--naia-text-muted)]">2/4</span>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto">
        {/* Context from previous step */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="text-2xl">{moodEmoji[mood] || "✨"}</span>
          <span className="text-[var(--naia-text-muted)] capitalize">
            Feeling {mood}
          </span>
        </div>

        {/* Question */}
        <div className="text-center mb-8">
          <h1 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
            How do you want to look?
          </h1>
          <p className="text-[var(--naia-text-muted)]">
            Pick up to 3 vibes for your outfit
          </p>
        </div>

        {/* Feelings Grid */}
        <Form method="post">
          <input type="hidden" name="feelings" value={selectedFeelings.join(",")} />
          
          <div className="grid grid-cols-3 gap-3 mb-8">
            {feelings.map((feeling) => {
              const isSelected = selectedFeelings.includes(feeling.id);
              const isDisabled = !isSelected && selectedFeelings.length >= 3;
              
              return (
                <button
                  key={feeling.id}
                  type="button"
                  onClick={() => toggleFeeling(feeling.id)}
                  disabled={isDisabled}
                  className={`
                    relative p-4 rounded-xl text-center transition-all duration-200
                    ${isSelected 
                      ? "ring-2 ring-[var(--naia-rose)] ring-offset-2 scale-[1.02]" 
                      : isDisabled
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:scale-[1.02]"
                    }
                    ${feeling.color}
                  `}
                >
                  <span className="text-2xl block mb-1">{feeling.emoji}</span>
                  <span className="text-sm font-medium">{feeling.label}</span>
                  
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-[var(--naia-rose)] rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selection Counter */}
          <div className="flex justify-center gap-2 mb-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`
                  w-3 h-3 rounded-full transition-colors
                  ${i < selectedFeelings.length 
                    ? "bg-[var(--naia-rose)]" 
                    : "bg-[var(--naia-gray-200)]"
                  }
                `}
              />
            ))}
          </div>

          {/* Selected Pills */}
          {selectedFeelings.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {selectedFeelings.map((id) => {
                const feeling = feelings.find((f) => f.id === id);
                return feeling ? (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-[var(--naia-rose)]/10 text-[var(--naia-rose)] rounded-full text-sm font-medium"
                  >
                    {feeling.emoji} {feeling.label}
                    <button
                      type="button"
                      onClick={() => toggleFeeling(id)}
                      className="ml-1 hover:text-[var(--naia-rose-dark)]"
                    >
                      ×
                    </button>
                  </span>
                ) : null;
              })}
            </div>
          )}

          {/* Continue Button */}
          <button
            type="submit"
            disabled={selectedFeelings.length === 0}
            className={`
              w-full py-4 px-6 rounded-full font-medium text-center
              transition-all duration-200
              ${selectedFeelings.length > 0
                ? "bg-[var(--naia-rose)] text-white hover:bg-[var(--naia-rose-dark)] shadow-lg"
                : "bg-[var(--naia-gray-200)] text-[var(--naia-text-muted)] cursor-not-allowed"
              }
            `}
          >
            Continue →
          </button>
        </Form>

        {/* Tip */}
        <div className="mt-8 p-4 bg-white/60 rounded-xl">
          <p className="text-sm text-[var(--naia-text-muted)] text-center">
            💡 <span className="font-medium">Tip:</span> Mix different vibes 
            for a unique look — like "elegant + edgy" or "cozy + glamorous"
          </p>
        </div>
      </main>
    </div>
  );
}
