import { Link, useLoaderData } from "react-router";
import { data, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "StyleMe | nAia" }];
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
    return data({ hasProfile: false, hasClosetItems: false, recentSessions: [] as SessionRecord[] });
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
          select: { heroImageUrl: true, outfitName: true }
        }
      }
    })
  ]);

  return data({
    hasProfile: !!profile,
    stylePersonalities: profile?.stylePersonalities ?? [],
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      mood: s.mood,
      occasion: s.occasion,
      createdAt: s.createdAt.toISOString(),
      outfitName: s.suggestions[0]?.outfitName ?? null,
    })),
  });
}

type SessionRecord = {
  id: string;
  mood: string | null;
  occasion: string | null;
  createdAt: string;
  outfitName: string | null;
};

export default function StyleMeIndex() {
  const { recentSessions } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">StyleMe</div>
        <h1 className="sp-shell-title">Style Me</h1>
        <p className="sp-shell-desc">
          Tell nAia about the occasion and receive a considered look built from NADINE pieces and
          your own Closet. Answer a few questions and let nAia do the rest.
        </p>
      </div>

      {/* Start a New Session */}
      <section className="bos-section">
        <div className="sml-section-label">Start a New Session</div>
        <div className="sml-start-card">
          <p className="sml-start-desc">
            Answer a few questions about how you feel, what you need and where you're going.
            nAia will build a complete look for you.
          </p>
          <div className="sml-start-actions">
            <Link to="/style-me/mood" className="sp-btn-primary">Start StyleMe</Link>
          </div>
        </div>
      </section>

      {/* Recent Feedback */}
      <section className="bos-section">
        <div className="sml-section-label">Recent Feedback</div>
        <p className="sml-status-note">
          Your notes and feedback after each session shape future recommendations. The more you
          tell nAia, the more considered each look becomes.
        </p>
      </section>

      {/* Previous StyleMe Looks */}
      {recentSessions.length > 0 ? (
        <section className="bos-section">
          <div className="sml-header">
            <div className="sml-section-label" style={{ marginBottom: 0 }}>Previous StyleMe Looks</div>
            <div className="sml-header-links">
              <Link to="/my-naia/saved" className="sml-header-link">View Saved</Link>
            </div>
          </div>
          <ul className="sml-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {recentSessions.map((session) => (
              <li key={session.id}>
                <SessionCard session={session} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="bos-section">
          <div className="sml-section-label">Previous StyleMe Looks</div>
          <div className="sml-empty">
            <p className="sml-empty-text">Your first StyleMe session begins with a single occasion.</p>
          </div>
        </section>
      )}
    </MyNaiaLayout>
  );
}

function SessionCard({ session }: { session: SessionRecord }) {
  const formattedDate = new Date(session.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const occasionLabel = session.occasion ? (OCCASION_LABELS[session.occasion] ?? session.occasion) : null;
  const moodLabel = session.mood ? (MOOD_LABELS[session.mood] ?? session.mood) : null;

  return (
    <article className="sml-card">
      <div className="sml-card-date">{formattedDate}</div>
      <Link
        to={`/style-me/result?sessionId=${session.id}`}
        className="sml-card-title"
      >
        {session.outfitName || (occasionLabel ? `${occasionLabel} look` : "Styled look")}
      </Link>
      {occasionLabel && <p className="sml-card-occasion">{occasionLabel}</p>}
      {moodLabel && (
        <div className="sml-card-tags">
          <span className="sml-card-tag">{moodLabel}</span>
        </div>
      )}
      <div className="sv-card-actions">
        <Link to={`/style-me/result?sessionId=${session.id}`} className="sv-card-action">
          View Look
        </Link>
        <span className="sv-card-action sv-card-action--disabled">Refine</span>
        <span className="sv-card-action sv-card-action--disabled">Try the look</span>
      </div>
    </article>
  );
}
