import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import { clearStyleMeSession } from "~/lib/session.server";
import { getCurrentNaiaCustomer, requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
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
  "adventurous": "Adventurous", "romantic": "Romantic", "powerful": "Powerful",
  "need-reset": "Need a reset", "feel-good": "Feel good",
};
const OCCASION_LABELS: Record<string, string> = {
  "everyday": "Everyday", "work": "Work", "dinner": "Dinner", "date-night": "Date night",
  "girls-night": "Girls' night", "family": "Family gathering", "special-event": "Special event",
  "travel": "Travel", "not-sure": "Not sure yet",
};

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  if (intent === "delete-session") {
    try {
      const customer = await requireCurrentNaiaCustomer(request);
      const sessionId = formData.get("sessionId") as string;
      if (!sessionId) return data({ error: "Missing sessionId" }, { status: 400 });

      // Verify ownership before any delete
      const session = await prisma.stylingSession.findUnique({
        where: { id: sessionId },
        select: { customerId: true, suggestions: { select: { id: true } } },
      });
      if (!session || session.customerId !== customer.id) {
        return data({ error: "Not found" }, { status: 404 });
      }

      // SavedLook.fromSuggestionId is a plain string (no FK cascade) — must delete manually
      const suggestionIds = session.suggestions.map((s) => s.id);
      if (suggestionIds.length > 0) {
        await prisma.savedLook.deleteMany({
          where: {
            customerId: customer.id,
            fromSuggestionId: { in: suggestionIds },
          },
        });
      }

      // Delete the session — cascades to: OutfitSuggestion → OutfitItem + StyleMeOutcome,
      // PostOutfitReview, StylingEvent. RecommendationFeedback.sessionId is SetNull (stays).
      // ClosetItem records are not touched.
      await prisma.stylingSession.delete({ where: { id: sessionId } });

      return data({ ok: true });
    } catch (e) {
      console.error("delete-session action error:", e);
      return data({ error: "Failed to delete session" }, { status: 500 });
    }
  }

  // Default: start a new StyleMe session
  const clearedCookie = await clearStyleMeSession(request);
  return redirect("/style-me/state", {
    headers: { "Set-Cookie": clearedCookie },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  const customerId = customer?.id ?? null;

  if (!customerId) {
    return data({ hasProfile: false, hasClosetItems: false, recentSessions: [] as SessionRecord[] });
  }

  const [profile, closetCount, recentRaw] = await Promise.all([
    prisma.onboardingProfile.findUnique({
      where: { customerId },
      select: { stylePersonalities: true },
    }),
    prisma.closetItem.count({ where: { customerId } }),
    prisma.stylingSession.findMany({
      where: { customerId },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        suggestions: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { id: true, outfitName: true },
        },
      },
    }),
  ]);

  const recentSessions: SessionRecord[] = recentRaw.map((s) => {
    const sugg = s.suggestions[0] ?? null;
    return {
      id: s.id,
      mood: s.currentMood,
      occasion: s.occasion,
      createdAt: s.createdAt.toISOString(),
      outfitName: sugg?.outfitName ?? null,
      suggestionId: sugg?.id ?? null,
    };
  });

  return data({
    hasProfile: !!profile,
    stylePersonalities: profile?.stylePersonalities ?? [],
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions,
  });
}

type SessionRecord = {
  id: string;
  mood: string | null;
  occasion: string | null;
  createdAt: string;
  outfitName: string | null;
  suggestionId: string | null;
};

export default function StyleMeIndex() {
  const { recentSessions } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <h1 className="sp-shell-title">STYLE <span className="sp-shell-accent">me.</span></h1>
        <p className="sp-shell-desc">
          Tell nAia what you need today and receive a considered look built from your own Closet.
          Answer a few questions and let nAia do the rest.
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
            <Form method="post">
              <button type="submit" className="sp-btn-primary">Start StyleMe</button>
            </Form>
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

      {/* Your StyleMe Looks */}
      <section className="bos-section">
        <div className="sml-section-label">Your StyleMe Looks</div>

        {recentSessions.length > 0 ? (
          <ul className="sml-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {recentSessions.map((session) => (
              <li key={session.id}>
                <SessionCard session={session} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="sml-empty">
            <p className="sml-empty-text">Your first StyleMe session begins with a single occasion.</p>
          </div>
        )}
      </section>
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

  function handleDelete(e: React.FormEvent) {
    if (
      !window.confirm(
        "Delete this look?\n\nThis will remove the look from your StyleMe history. Your Closet will not be affected.",
      )
    ) {
      e.preventDefault();
    }
  }

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
        <Link
          to={`/style-me/result?sessionId=${session.id}`}
          className="sv-card-action"
        >
          View Look
        </Link>
        <Form method="post" style={{ display: "contents" }} onSubmit={handleDelete}>
          <input type="hidden" name="intent" value="delete-session" />
          <input type="hidden" name="sessionId" value={session.id} />
          <button type="submit" className="sv-card-action">Delete</button>
        </Form>
      </div>
    </article>
  );
}
