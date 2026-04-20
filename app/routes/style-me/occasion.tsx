// app/routes/style-me/occasion.tsx
import { Form, Link, useLoaderData } from "react-router";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

// Occasion options
const occasions = [
  {
    id: "everyday",
    label: "Everyday",
    emoji: "☕",
    description: "Running errands, casual day out",
  },
  {
    id: "work",
    label: "Work",
    emoji: "💼",
    description: "Office or professional setting",
  },
  {
    id: "datenight",
    label: "Date Night",
    emoji: "🌹",
    description: "Romantic dinner or evening",
  },
  {
    id: "girlsnight",
    label: "Girls' Night",
    emoji: "🥂",
    description: "Out with friends",
  },
  {
    id: "special",
    label: "Special Event",
    emoji: "✨",
    description: "Celebration or milestone",
  },
  {
    id: "travel",
    label: "Travel",
    emoji: "✈️",
    description: "Airport or sightseeing",
  },
  {
    id: "athome",
    label: "Cozy at Home",
    emoji: "🏠",
    description: "Comfortable but put-together",
  },
  {
    id: "fitness",
    label: "Active",
    emoji: "🧘",
    description: "Workout or athleisure",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  const feelings = session.get("styleMeFeelings") as string[] | undefined;
  
  if (!mood || !feelings) {
    return redirect("/style-me/mood");
  }
  
  return json({ mood, feelings });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const occasion = formData.get("occasion") as string;
  
  if (!occasion) {
    return json({ error: "Please select an occasion" }, { status: 400 });
  }
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeOccasion", occasion);
  
  return redirect("/style-me/source", {
    headers: {
      "Set-Cookie": await commitSession(session)
    }
  });
}

export default function StyleMeOccasion() {
  const { mood, feelings } = useLoaderData<typeof loader>();
  const [selectedOccasion, setSelectedOccasion] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link to="/style-me/feeling" className="text-[var(--naia-text-muted)] text-sm">
            ← Back
          </Link>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`w-8 h-1 rounded-full ${
                  step <= 3 ? "bg-[var(--naia-rose)]" : "bg-[var(--naia-gray-200)]"
                }`}
              />
            ))}
          </div>
          <span className="text-sm text-[var(--naia-text-muted)]">3/4</span>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto">
        {/* Context from previous steps */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <span className="text-sm text-[var(--naia-text-muted)] capitalize">
            {mood}
          </span>
          <span className="text-[var(--naia-gray-300)]">•</span>
          {feelings.slice(0, 3).map((feeling: string, i: number) => (
            <span key={feeling}>
              <span className="text-sm text-[var(--naia-text-muted)] capitalize">
                {feeling}
              </span>
              {i < feelings.length - 1 && i < 2 && (
                <span className="text-[var(--naia-gray-300)]"> + </span>
              )}
            </span>
          ))}
        </div>

        {/* Question */}
        <div className="text-center mb-8">
          <h1 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
            What's the occasion?
          </h1>
          <p className="text-[var(--naia-text-muted)]">
            Where are you headed?
          </p>
        </div>

        {/* Occasion Grid */}
        <Form method="post">
          <input type="hidden" name="occasion" value={selectedOccasion || ""} />
          
          <div className="space-y-3 mb-8">
            {occasions.map((occasion) => (
              <button
                key={occasion.id}
                type="button"
                onClick={() => setSelectedOccasion(occasion.id)}
                className={`
                  w-full p-4 rounded-xl text-left transition-all duration-200
                  flex items-center gap-4
                  ${selectedOccasion === occasion.id 
                    ? "bg-[var(--naia-rose)] text-white ring-2 ring-[var(--naia-rose)] ring-offset-2" 
                    : "bg-white hover:bg-[var(--naia-gray-50)]"
                  }
                `}
              >
                {/* Emoji */}
                <div className={`
                  w-12 h-12 rounded-full flex items-center justify-center text-2xl
                  ${selectedOccasion === occasion.id 
                    ? "bg-white/20" 
                    : "bg-[var(--naia-rose)]/10"
                  }
                `}>
                  {occasion.emoji}
                </div>
                
                {/* Content */}
                <div className="flex-1">
                  <p className={`
                    font-medium
                    ${selectedOccasion === occasion.id 
                      ? "text-white" 
                      : "text-[var(--naia-charcoal)]"
                    }
                  `}>
                    {occasion.label}
                  </p>
                  <p className={`
                    text-sm
                    ${selectedOccasion === occasion.id 
                      ? "text-white/80" 
                      : "text-[var(--naia-text-muted)]"
                    }
                  `}>
                    {occasion.description}
                  </p>
                </div>

                {/* Selection indicator */}
                {selectedOccasion === occasion.id && (
                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
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
            disabled={!selectedOccasion}
            className={`
              w-full py-4 px-6 rounded-full font-medium text-center
              transition-all duration-200
              ${selectedOccasion
                ? "bg-[var(--naia-rose)] text-white hover:bg-[var(--naia-rose-dark)] shadow-lg"
                : "bg-[var(--naia-gray-200)] text-[var(--naia-text-muted)] cursor-not-allowed"
              }
            `}
          >
            Continue →
          </button>
        </Form>
      </main>
    </div>
  );
}
