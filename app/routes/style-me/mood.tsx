// app/routes/style-me/mood.tsx
import { Form, Link } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

// Mood options with gradients matching the design system
const moods = [
  {
    id: "confident",
    label: "Confident",
    emoji: "💪",
    gradient: "from-rose-400 to-pink-500",
    description: "Ready to own the room"
  },
  {
    id: "calm",
    label: "Calm",
    emoji: "🌿",
    gradient: "from-teal-400 to-cyan-500",
    description: "Peaceful and centered"
  },
  {
    id: "playful",
    label: "Playful",
    emoji: "🎀",
    gradient: "from-pink-400 to-purple-500",
    description: "Fun and carefree"
  },
  {
    id: "romantic",
    label: "Romantic",
    emoji: "🌹",
    gradient: "from-rose-300 to-red-400",
    description: "Soft and dreamy"
  },
  {
    id: "powerful",
    label: "Powerful",
    emoji: "👑",
    gradient: "from-amber-400 to-orange-500",
    description: "Strong and in charge"
  },
  {
    id: "mysterious",
    label: "Mysterious",
    emoji: "🌙",
    gradient: "from-slate-600 to-purple-700",
    description: "Intriguing and alluring"
  },
  {
    id: "joyful",
    label: "Joyful",
    emoji: "☀️",
    gradient: "from-yellow-400 to-orange-400",
    description: "Bright and happy"
  },
  {
    id: "sophisticated",
    label: "Sophisticated",
    emoji: "✨",
    gradient: "from-slate-400 to-gray-600",
    description: "Elegant and refined"
  },
];

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const mood = formData.get("mood") as string;
  
  if (!mood) {
    return json({ error: "Please select a mood" }, { status: 400 });
  }
  
  // Store in session for the flow
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeMood", mood);
  
  return redirect("/style-me/feeling", {
    headers: {
      "Set-Cookie": await commitSession(session)
    }
  });
}

export default function StyleMeMood() {
  const [selectedMood, setSelectedMood] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link to="/style-me" className="text-[var(--naia-text-muted)] text-sm">
            ← Back
          </Link>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`w-8 h-1 rounded-full ${
                  step === 1 ? "bg-[var(--naia-rose)]" : "bg-[var(--naia-gray-200)]"
                }`}
              />
            ))}
          </div>
          <span className="text-sm text-[var(--naia-text-muted)]">1/4</span>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto">
        {/* Question */}
        <div className="text-center mb-8">
          <h1 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
            How are you feeling today?
          </h1>
          <p className="text-[var(--naia-text-muted)]">
            Your mood guides everything — let's start here
          </p>
        </div>

        {/* Mood Grid */}
        <Form method="post">
          <input type="hidden" name="mood" value={selectedMood || ""} />
          
          <div className="grid grid-cols-2 gap-4 mb-8">
            {moods.map((mood) => (
              <button
                key={mood.id}
                type="button"
                onClick={() => setSelectedMood(mood.id)}
                className={`
                  relative p-5 rounded-2xl text-left transition-all duration-200
                  ${selectedMood === mood.id 
                    ? "ring-2 ring-[var(--naia-rose)] ring-offset-2 scale-[1.02]" 
                    : "hover:scale-[1.02]"
                  }
                `}
              >
                {/* Gradient background */}
                <div className={`
                  absolute inset-0 rounded-2xl bg-gradient-to-br ${mood.gradient}
                `} />
                
                {/* Content */}
                <div className="relative z-10">
                  <span className="text-3xl mb-2 block">{mood.emoji}</span>
                  <p className="font-medium text-white text-lg">{mood.label}</p>
                  <p className="text-white/80 text-sm">{mood.description}</p>
                </div>

                {/* Selection indicator */}
                {selectedMood === mood.id && (
                  <div className="absolute top-3 right-3 w-6 h-6 bg-white rounded-full flex items-center justify-center z-10">
                    <svg className="w-4 h-4 text-[var(--naia-rose)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Continue Button */}
          <button
            type="submit"
            disabled={!selectedMood}
            className={`
              w-full py-4 px-6 rounded-full font-medium text-center
              transition-all duration-200
              ${selectedMood
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
            💡 <span className="font-medium">Tip:</span> There's no wrong answer — 
            your outfit will match however you're feeling right now.
          </p>
        </div>
      </main>
    </div>
  );
}
