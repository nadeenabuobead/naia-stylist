// app/routes/style-me/_index.tsx
import { Link, useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const customerId = await getCustomerId(request);
  
  if (!customerId) {
    return json({ hasProfile: false, hasClosetItems: false, recentSessions: [] });
  }
  
  const [profile, closetCount, recentSessions] = await Promise.all([
    prisma.onboardingProfile.findUnique({
      where: { customerId },
      select: { stylePersonality: true }
    }),
    prisma.closetItem.count({ where: { customerId } }),
    prisma.stylingSession.findMany({
      where: { customerId },
      take: 3,
      orderBy: { createdAt: "desc" },
      include: {
        suggestions: {
          take: 1,
          select: {
            heroImageUrl: true,
            outfitName: true
          }
        }
      }
    })
  ]);
  
  return json({
    hasProfile: !!profile,
    stylePersonality: profile?.stylePersonality,
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions
  });
}

export default function StyleMeIndex() {
  const { hasProfile, stylePersonality, hasClosetItems, closetCount, recentSessions } = 
    useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <Link to="/" className="text-[var(--naia-text-muted)] text-sm">
            ← Back
          </Link>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto">
        {/* Welcome Section */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--naia-rose)] to-[var(--naia-rose-dark)] flex items-center justify-center">
            <span className="text-4xl">✨</span>
          </div>
          <h1 className="font-display text-3xl font-medium text-[var(--naia-charcoal)] mb-2">
            Style Me, nAia
          </h1>
          <p className="text-[var(--naia-text-muted)]">
            Tell me how you're feeling and I'll create the perfect look for you
          </p>
        </div>

        {/* Status Cards */}
        <div className="space-y-3 mb-8">
          {/* Profile Status */}
          <div className={`
            p-4 rounded-xl flex items-center gap-4
            ${hasProfile 
              ? "bg-green-50 border border-green-200" 
              : "bg-amber-50 border border-amber-200"
            }
          `}>
            <div className={`
              w-10 h-10 rounded-full flex items-center justify-center
              ${hasProfile ? "bg-green-100" : "bg-amber-100"}
            `}>
              <span>{hasProfile ? "✓" : "!"}</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--naia-charcoal)]">
                {hasProfile ? "Style Profile Complete" : "Complete Your Style Profile"}
              </p>
              <p className="text-sm text-[var(--naia-text-muted)]">
                {hasProfile 
                  ? `Your style: ${stylePersonality || "Discovering..."}`
                  : "Help nAia understand your style better"
                }
              </p>
            </div>
            {!hasProfile && (
              <Link 
                to="/onboarding/step/1"
                className="text-sm text-[var(--naia-rose)] font-medium"
              >
                Start →
              </Link>
            )}
          </div>

          {/* Closet Status */}
          <div className={`
            p-4 rounded-xl flex items-center gap-4
            ${hasClosetItems 
              ? "bg-green-50 border border-green-200" 
              : "bg-amber-50 border border-amber-200"
            }
          `}>
            <div className={`
              w-10 h-10 rounded-full flex items-center justify-center
              ${hasClosetItems ? "bg-green-100" : "bg-amber-100"}
            `}>
              <span>{hasClosetItems ? "👗" : "📸"}</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--naia-charcoal)]">
                {hasClosetItems ? `${closetCount} items in closet` : "Add Your Wardrobe"}
              </p>
              <p className="text-sm text-[var(--naia-text-muted)]">
                {hasClosetItems 
                  ? "Ready to create outfits from your pieces"
                  : "Upload items to style from your own closet"
                }
              </p>
            </div>
            <Link 
              to="/closet/upload"
              className="text-sm text-[var(--naia-rose)] font-medium"
            >
              {hasClosetItems ? "Add more →" : "Upload →"}
            </Link>
          </div>
        </div>

        {/* Start Styling Button */}
        <Link
          to="/style-me/mood"
          className="block w-full py-4 px-6 bg-[var(--naia-rose)] text-white text-center font-medium rounded-full shadow-lg hover:bg-[var(--naia-rose-dark)] transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
        >
          Let's Create Your Look ✨
        </Link>

        <p className="text-center text-sm text-[var(--naia-text-muted)] mt-4">
          Works best with your closet items, but I can also suggest new pieces!
        </p>

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <div className="mt-12">
            <h2 className="font-display text-xl font-medium text-[var(--naia-charcoal)] mb-4">
              Recent Looks
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  to={`/style-me/result?sessionId=${session.id}`}
                  className="group"
                >
                  <div className="aspect-[3/4] rounded-xl overflow-hidden bg-[var(--naia-gray-100)]">
                    {session.suggestions[0]?.heroImageUrl ? (
                      <img
                        src={session.suggestions[0].heroImageUrl}
                        alt={session.suggestions[0].outfitName || "Recent outfit"}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-2xl">👗</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-[var(--naia-charcoal)] line-clamp-1">
                    {session.mood} • {session.occasion}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="mt-12 p-6 bg-white rounded-2xl">
          <h2 className="font-display text-lg font-medium text-[var(--naia-charcoal)] mb-4">
            How It Works
          </h2>
          <div className="space-y-4">
            {[
              { step: "1", emoji: "🌸", text: "Tell me your mood" },
              { step: "2", emoji: "💭", text: "Share how you want to feel" },
              { step: "3", emoji: "🎯", text: "Pick the occasion" },
              { step: "4", emoji: "👗", text: "Choose your source (closet, nAia, or both)" },
              { step: "5", emoji: "✨", text: "Get your complete look with styling tips" },
            ].map(({ step, emoji, text }) => (
              <div key={step} className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-[var(--naia-rose)]/10 flex items-center justify-center text-sm font-medium text-[var(--naia-rose)]">
                  {step}
                </div>
                <span className="text-xl">{emoji}</span>
                <p className="text-[var(--naia-charcoal)]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
