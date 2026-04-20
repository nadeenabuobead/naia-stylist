// app/routes/style-me/source.tsx
import { Form, Link, useLoaderData } from "react-router";
import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";
import { commitSession, getSession } from "~/lib/session.server";

type SourceType = "CLOSET" | "NAIA" | "BOTH";

const sourceOptions: Array<{
  id: SourceType;
  label: string;
  emoji: string;
  description: string;
  requiresCloset: boolean;
}> = [
  {
    id: "CLOSET",
    label: "My Closet Only",
    emoji: "👗",
    description: "Style me using only what I already own",
    requiresCloset: true,
  },
  {
    id: "NAIA",
    label: "nAia's Picks",
    emoji: "🛍️",
    description: "Show me new pieces from the store",
    requiresCloset: false,
  },
  {
    id: "BOTH",
    label: "Mix It Up",
    emoji: "✨",
    description: "Combine my closet with new suggestions",
    requiresCloset: false,
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  const feelings = session.get("styleMeFeelings") as string[] | undefined;
  const occasion = session.get("styleMeOccasion");
  
  if (!mood || !feelings || !occasion) {
    return redirect("/style-me/mood");
  }
  
  // Check if user has closet items
  const customerId = await getCustomerId(request);
  let closetCount = 0;
  
  if (customerId) {
    closetCount = await prisma.closetItem.count({ where: { customerId } });
  }
  
  return json({ mood, feelings, occasion, closetCount });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const source = formData.get("source") as SourceType;
  
  if (!source || !["CLOSET", "NAIA", "BOTH"].includes(source)) {
    return json({ error: "Please select a source" }, { status: 400 });
  }
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeSource", source);
  
  // All selections complete - redirect to result generation
  return redirect("/style-me/result", {
    headers: {
      "Set-Cookie": await commitSession(session)
    }
  });
}

export default function StyleMeSource() {
  const { mood, feelings, occasion, closetCount } = useLoaderData<typeof loader>();
  const [selectedSource, setSelectedSource] = useState<SourceType | null>(null);

  const occasionLabels: Record<string, string> = {
    everyday: "Everyday",
    work: "Work",
    datenight: "Date Night",
    girlsnight: "Girls' Night",
    special: "Special Event",
    travel: "Travel",
    athome: "Cozy at Home",
    fitness: "Active",
  };

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link to="/style-me/occasion" className="text-[var(--naia-text-muted)] text-sm">
            ← Back
          </Link>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className="w-8 h-1 rounded-full bg-[var(--naia-rose)]"
              />
            ))}
          </div>
          <span className="text-sm text-[var(--naia-text-muted)]">4/4</span>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto">
        {/* Summary */}
        <div className="bg-white rounded-2xl p-4 mb-8">
          <p className="text-sm text-[var(--naia-text-muted)] text-center mb-3">
            Creating your look for:
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="px-3 py-1 bg-[var(--naia-rose)]/10 text-[var(--naia-rose)] rounded-full text-sm font-medium capitalize">
              {mood}
            </span>
            {feelings.map((feeling: string) => (
              <span 
                key={feeling}
                className="px-3 py-1 bg-[var(--naia-gray-100)] text-[var(--naia-charcoal)] rounded-full text-sm capitalize"
              >
                {feeling}
              </span>
            ))}
            <span className="px-3 py-1 bg-[var(--naia-gold)]/20 text-[var(--naia-gold-dark)] rounded-full text-sm font-medium">
              {occasionLabels[occasion] || occasion}
            </span>
          </div>
        </div>

        {/* Question */}
        <div className="text-center mb-8">
          <h1 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
            Where should I look?
          </h1>
          <p className="text-[var(--naia-text-muted)]">
            Choose your outfit source
          </p>
        </div>

        {/* Source Options */}
        <Form method="post">
          <input type="hidden" name="source" value={selectedSource || ""} />
          
          <div className="space-y-4 mb-8">
            {sourceOptions.map((option) => {
              const isDisabled = option.requiresCloset && closetCount === 0;
              const isSelected = selectedSource === option.id;
              
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => !isDisabled && setSelectedSource(option.id)}
                  disabled={isDisabled}
                  className={`
                    w-full p-5 rounded-2xl text-left transition-all duration-200
                    ${isSelected 
                      ? "bg-gradient-to-r from-[var(--naia-rose)] to-[var(--naia-rose-dark)] text-white ring-2 ring-[var(--naia-rose)] ring-offset-2" 
                      : isDisabled
                        ? "bg-[var(--naia-gray-100)] opacity-50 cursor-not-allowed"
                        : "bg-white hover:shadow-md"
                    }
                  `}
                >
                  <div className="flex items-start gap-4">
                    {/* Emoji */}
                    <div className={`
                      w-14 h-14 rounded-xl flex items-center justify-center text-3xl
                      ${isSelected ? "bg-white/20" : "bg-[var(--naia-rose)]/10"}
                    `}>
                      {option.emoji}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1">
                      <p className={`
                        font-medium text-lg mb-1
                        ${isSelected ? "text-white" : "text-[var(--naia-charcoal)]"}
                      `}>
                        {option.label}
                      </p>
                      <p className={`
                        text-sm
                        ${isSelected ? "text-white/80" : "text-[var(--naia-text-muted)]"}
                      `}>
                        {option.description}
                      </p>
                      
                      {/* Closet count for relevant options */}
                      {option.id !== "NAIA" && (
                        <p className={`
                          text-xs mt-2
                          ${isSelected ? "text-white/60" : "text-[var(--naia-text-muted)]"}
                        `}>
                          {closetCount > 0 
                            ? `📦 ${closetCount} items in your closet`
                            : "📦 No items in closet yet"
                          }
                        </p>
                      )}
                    </div>

                    {/* Selection indicator */}
                    {isSelected && (
                      <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-[var(--naia-rose)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* No closet items notice */}
          {closetCount === 0 && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm text-amber-800">
                💡 Want to style from your wardrobe?{" "}
                <Link to="/closet/upload" className="font-medium underline">
                  Add items to your closet
                </Link>{" "}
                first.
              </p>
            </div>
          )}

          {/* Generate Button */}
          <button
            type="submit"
            disabled={!selectedSource}
            className={`
              w-full py-4 px-6 rounded-full font-medium text-center text-lg
              transition-all duration-200
              ${selectedSource
                ? "bg-[var(--naia-charcoal)] text-white hover:bg-black shadow-lg"
                : "bg-[var(--naia-gray-200)] text-[var(--naia-text-muted)] cursor-not-allowed"
              }
            `}
          >
            ✨ Create My Look
          </button>
        </Form>

        {/* Excitement builder */}
        <div className="mt-8 text-center">
          <p className="text-sm text-[var(--naia-text-muted)]">
            nAia will create a complete look including outfit, accessories, 
            makeup, hair, and even a vibe song 🎵
          </p>
        </div>
      </main>
    </div>
  );
}
