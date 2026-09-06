import { Form, Link, useLoaderData, useSearchParams } from "react-router";
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

  if (intent === "save-look") {
    const customer = await requireCurrentNaiaCustomer(request);
    const suggestionId = formData.get("suggestionId") as string;
    if (!suggestionId) return data({ error: "Missing suggestionId" }, { status: 400 });

    const suggestion = await prisma.outfitSuggestion.findUnique({
      where: { id: suggestionId },
      include: { session: true, items: true },
    });
    if (!suggestion || suggestion.session.customerId !== customer.id) {
      return data({ error: "Not found" }, { status: 404 });
    }

    // Idempotent — return existing if already saved
    const existing = await prisma.savedLook.findFirst({
      where: { fromSuggestionId: suggestionId, customerId: customer.id },
      select: { id: true },
    });
    if (existing) return data({ ok: true, savedLookId: existing.id });

    const savedLook = await prisma.savedLook.create({
      data: {
        customerId: customer.id,
        name: suggestion.outfitName,
        fromSuggestionId: suggestion.id,
        items: {
          create: suggestion.items.map((item) => ({
            itemType: item.itemType,
            closetItemId: item.closetItemId || null,
            shopifyProductId: item.shopifyProductId || null,
            productImageUrl: item.productImageUrl || null,
          })),
        },
      },
    });
    return data({ ok: true, savedLookId: savedLook.id });
  }

  if (intent === "remove-from-saved") {
    const customer = await requireCurrentNaiaCustomer(request);
    const savedLookId = formData.get("savedLookId") as string;
    if (!savedLookId) return data({ error: "Missing savedLookId" }, { status: 400 });
    // Scoped to customer — cannot remove another customer's look
    await prisma.savedLook.deleteMany({
      where: { id: savedLookId, customerId: customer.id },
    });
    return data({ ok: true });
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

  const [profile, closetCount, sessions, savedLooks] = await Promise.all([
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
          select: { id: true, heroImageUrl: true, outfitName: true },
        },
      },
    }),
    prisma.savedLook.findMany({
      where: { customerId },
      select: { id: true, fromSuggestionId: true },
    }),
  ]);

  // Map: suggestionId → savedLookId
  const savedMap = new Map<string, string>();
  for (const sl of savedLooks) {
    if (sl.fromSuggestionId) savedMap.set(sl.fromSuggestionId, sl.id);
  }

  return data({
    hasProfile: !!profile,
    stylePersonalities: profile?.stylePersonalities ?? [],
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions: sessions.map((s) => {
      const sugg = s.suggestions[0] ?? null;
      const suggestionId = sugg?.id ?? null;
      const savedLookId = suggestionId ? (savedMap.get(suggestionId) ?? null) : null;
      return {
        id: s.id,
        mood: s.mood,
        occasion: s.occasion,
        createdAt: s.createdAt.toISOString(),
        outfitName: sugg?.outfitName ?? null,
        suggestionId,
        isSaved: savedLookId !== null,
        savedLookId,
      } satisfies SessionRecord;
    }),
  });
}

type SessionRecord = {
  id: string;
  mood: string | null;
  occasion: string | null;
  createdAt: string;
  outfitName: string | null;
  suggestionId: string | null;
  isSaved: boolean;
  savedLookId: string | null;
};

export default function StyleMeIndex() {
  const { recentSessions } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("filter") === "saved" ? "saved" : "all";

  const displayed = filter === "saved"
    ? recentSessions.filter((s) => s.isSaved)
    : recentSessions;

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
        <div className="sml-header">
          <div className="sml-section-label" style={{ marginBottom: 0 }}>Your StyleMe Looks</div>
          <div className="sml-header-links">
            <button
              type="button"
              className={filter === "all" ? "sml-header-link sml-header-link--active" : "sml-header-link"}
              onClick={() => setSearchParams({})}
              aria-pressed={filter === "all"}
            >
              All Looks
            </button>
            <button
              type="button"
              className={filter === "saved" ? "sml-header-link sml-header-link--active" : "sml-header-link"}
              onClick={() => setSearchParams({ filter: "saved" })}
              aria-pressed={filter === "saved"}
            >
              Saved
            </button>
          </div>
        </div>

        {displayed.length > 0 ? (
          <ul className="sml-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {displayed.map((session) => (
              <li key={session.id}>
                <SessionCard session={session} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="sml-empty">
            {filter === "saved" ? (
              <p className="sml-empty-text">
                No saved looks yet. After a StyleMe session, save a look to find it here.
              </p>
            ) : (
              <p className="sml-empty-text">Your first StyleMe session begins with a single occasion.</p>
            )}
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
        {session.suggestionId && (
          session.isSaved ? (
            <Form method="post" style={{ display: "contents" }}>
              <input type="hidden" name="intent" value="remove-from-saved" />
              <input type="hidden" name="savedLookId" value={session.savedLookId!} />
              <button type="submit" className="sv-card-action">Remove from Saved</button>
            </Form>
          ) : (
            <Form method="post" style={{ display: "contents" }}>
              <input type="hidden" name="intent" value="save-look" />
              <input type="hidden" name="suggestionId" value={session.suggestionId} />
              <button type="submit" className="sv-card-action">Save</button>
            </Form>
          )
        )}
      </div>
    </article>
  );
}
