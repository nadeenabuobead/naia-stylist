// app/routes/style-me/_index.tsx
import { Link, useLoaderData } from "react-router";
import { data, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "Style Me | nAia" }];
}

const MOOD_LABELS: Record<string, string> = {
  "confident": "Confident", "tired": "Low-energy", "overwhelmed": "Overwhelmed",
  "playful": "Playful", "romantic": "Romantic", "powerful": "Powerful",
  "need-reset": "Need a reset", "feel-good": "Feel good",
};
const OCCASION_LABELS: Record<string, string> = {
  "everyday": "Everyday", "work": "Work", "dinner": "Dinner", "date-night": "Date night",
  "girls-night": "Girls' night", "family": "Family", "special-event": "Special event",
  "travel": "Travel", "not-sure": "Not sure yet",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  const customerId = customer?.id ?? null;

  if (!customerId) {
    return data({ hasProfile: false, hasClosetItems: false, recentSessions: [] });
  }

  const [profile, closetCount, recentSessions] = await Promise.all([
    prisma.onboardingProfile.findUnique({
      where: { customerId },
      select: { stylePersonalities: true }
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

  return data({
    hasProfile: !!profile,
    stylePersonalities: profile?.stylePersonalities ?? [],
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions
  });
}

export default function StyleMeIndex() {
  const { hasProfile, stylePersonalities, hasClosetItems, closetCount, recentSessions } =
    useLoaderData<typeof loader>();

  return (
    <div className="sm-page">
      <div className="sm-inner">

        <div style={{ marginBottom: "40px" }}>
          <p className="sm-eyebrow" style={{ marginBottom: "12px" }}>Style Me, nAia</p>
          <h1 className="sm-heading">What are you wearing today?</h1>
          <p className="sm-sub" style={{ marginBottom: "0" }}>Tell me how you're feeling and I'll create the perfect look for you.</p>
        </div>

        <div style={{ marginBottom: "32px" }}>
          <div className="sm-status-card">
            <div className={`sm-status-icon${hasProfile ? " sm-status-icon--ok" : ""}`}>
              {hasProfile ? "✓" : "!"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="sm-status-label">
                {hasProfile ? "Style Profile Complete" : "Style Profile Incomplete"}
              </p>
              <p className="sm-status-desc">
                {hasProfile
                  ? `Your style: ${stylePersonalities.length > 0 ? stylePersonalities.join(", ") : "Discovering..."}`
                  : "Help nAia understand your style better"}
              </p>
            </div>
            {!hasProfile && (
              <Link to="/onboarding/step/1" className="sm-status-link">
                Start →
              </Link>
            )}
          </div>

          <div className="sm-status-card">
            <div className={`sm-status-icon${hasClosetItems ? " sm-status-icon--ok" : ""}`}>
              {hasClosetItems ? "👗" : "📸"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="sm-status-label">
                {hasClosetItems ? `${closetCount} items in closet` : "Wardrobe empty"}
              </p>
              <p className="sm-status-desc">
                {hasClosetItems
                  ? "Ready to create outfits from your pieces"
                  : "Upload items to style from your own closet"}
              </p>
            </div>
            <Link to="/closet" className="sm-status-link">
              {hasClosetItems ? "Add more →" : "Upload →"}
            </Link>
          </div>
        </div>

        <Link to="/style-me/mood" className="sm-cta">
          Let's Create Your Look
        </Link>
        <p className="sm-cta-note">Works best with your closet, but I can also suggest new pieces.</p>

        {recentSessions.length > 0 && (
          <div style={{ marginTop: "48px" }}>
            <p className="sm-eyebrow" style={{ marginBottom: "16px" }}>Recent Looks</p>
            <div className="sm-recent-grid">
              {recentSessions.map((session: any) => (
                <div key={session.id}>
                  <Link
                    to={`/style-me/result?sessionId=${session.id}`}
                    className="sm-recent-card"
                  >
                    {session.suggestions[0]?.heroImageUrl ? (
                      <img
                        src={session.suggestions[0].heroImageUrl}
                        alt={session.suggestions[0].outfitName || "Recent outfit"}
                      />
                    ) : (
                      <span style={{ fontSize: "28px" }}>👗</span>
                    )}
                  </Link>
                  <p className="sm-recent-label">
                    {MOOD_LABELS[session.mood] ?? session.mood} · {OCCASION_LABELS[session.occasion] ?? session.occasion}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sm-how-it-works">
          <p className="sm-eyebrow" style={{ marginBottom: "20px" }}>How It Works</p>
          {[
            { step: "1", emoji: "🌸", text: "Tell me your mood" },
            { step: "2", emoji: "💭", text: "Share how you want to feel" },
            { step: "3", emoji: "🎯", text: "Pick the occasion" },
            { step: "4", emoji: "👗", text: "Choose your source — closet, nAia, or both" },
            { step: "5", emoji: "✨", text: "Get your complete look with styling tips" },
          ].map(({ step, emoji, text }) => (
            <div key={step} className="sm-how-step">
              <div className="sm-how-step-num">{step}</div>
              <span style={{ fontSize: "20px" }}>{emoji}</span>
              <span className="sm-how-step-text">{text}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
