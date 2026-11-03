import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import { clearStyleMeSession } from "~/lib/session.server";
import { getCurrentNaiaCustomer, requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import { writeSourceEvidence } from "~/lib/ai/taste-reconcile.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import { occasionDisplayFor } from "~/lib/styleme/occasion-display";
import {
  resolveSavedSuggestions,
  selectExtraSavedSuggestions,
  buildUnifiedHistory,
  buildDisplayedSuggestionMap,
  type SessionRecord,
  type HistorySessionInput,
  type ExtraSuggestionInput,
} from "~/lib/styleme/history-saved-durability";
import { getCloudinaryConfig } from "~/lib/cloudinary-admin.server";
import { resolveCollageImages } from "~/lib/styleme/look-image-resolution.server";
import { LookCollage } from "~/components/styleme/LookCollage";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "StyleMe | nAia" }];
}

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
        select: {
          customerId: true,
          suggestions: { select: { id: true, outcome: { select: { id: true } } } },
          review: { select: { id: true } },
        },
      });
      if (!session || session.customerId !== customer.id) {
        return data({ error: "Not found" }, { status: 404 });
      }

      // Capture evidence source-record ids before the cascade removes them —
      // they're needed afterward to clear their derived TasteEvidence.
      const styleMeOutcomeIds = session.suggestions
        .map((s) => s.outcome?.id)
        .filter((id): id is string => Boolean(id));
      const postOutfitReviewId = session.review?.id ?? null;

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

      // The cascade above removed StyleMeOutcome/PostOutfitReview rows, but their
      // derived TasteEvidence has no FK and would otherwise survive orphaned.
      try {
        for (const outcomeId of styleMeOutcomeIds) {
          await writeSourceEvidence(customer.id, "STYLEME_OUTCOME", outcomeId, []);
        }
        if (postOutfitReviewId) {
          await writeSourceEvidence(customer.id, "POST_OUTFIT_REVIEW", postOutfitReviewId, []);
        }
      } catch (err) {
        console.error("taste-evidence: failed to clean up evidence after session delete", err);
      }

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

  const cloudinaryConfig = getCloudinaryConfig();
  const itemImageSelect = {
    itemType: true, closetItemId: true, productTitle: true, productImageUrl: true,
    closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true, category: true } },
  } as const;

  const [profile, closetCount, recentRaw] = await Promise.all([
    prisma.onboardingProfile.findUnique({
      where: { customerId },
      select: { stylePersonalities: true },
    }),
    prisma.closetItem.count({ where: { customerId } }),
    prisma.stylingSession.findMany({
      // "Your StyleMe Looks" means completed looks, not every StylingSession
      // row — a session with no suggestion (or a suggestion with no items)
      // never finished generating a look and has nothing to show. Filtering
      // here lets Prisma naturally reach further back to fill the 20-card
      // window with real results, same fix as Overview's Latest StyleMe.
      where: { customerId, suggestions: { some: { items: { some: {} } } } },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        suggestions: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { id: true, outfitName: true, createdAt: true, items: { take: 5, select: itemImageSelect } },
        },
      },
    }),
  ]);

  // Resolve each displayed suggestion's real collage imagery server-side —
  // the same resolver Overview's Latest StyleMe uses, so both surfaces
  // render identically. A suggestion whose items.length is 0 here (the
  // `take: 1 / orderBy: desc` sub-query can still land on an incomplete
  // reroll even though the where clause found a different, completed,
  // suggestion in the same session) is marked with itemCount: 0 so
  // buildUnifiedHistory excludes it rather than show an empty card.
  const recentWithImages: HistorySessionInput[] = recentRaw.map((s) => ({
    id: s.id,
    occasion: s.occasion,
    createdAt: s.createdAt,
    suggestions: s.suggestions.map((sg) => {
      const { resolvedImages, extraCount } = resolveCollageImages(sg.items, { customerId, cloudinaryConfig });
      return {
        id: sg.id,
        outfitName: sg.outfitName,
        createdAt: sg.createdAt,
        itemCount: sg.items.length,
        resolvedImages,
        extraCount,
      };
    }),
  }));

  // Card identity is per-SUGGESTION, not per-session: a saved suggestion that
  // isn't the latest one in its session must get its own correctly-badged,
  // reachable card — never a false badge on whichever suggestion a recent
  // card happens to display. SavedLook.fromSuggestionId has no FK cascade: a
  // stale/deleted suggestion simply finds no match below, failing safe (no
  // crash, no phantom card).
  const savedLooks = await prisma.savedLook.findMany({
    where: { customerId, fromSuggestionId: { not: null } },
    select: { fromSuggestionId: true },
  });
  const rawSavedSuggestionIds = [...new Set(savedLooks.map((l) => l.fromSuggestionId!))];
  const resolvedSuggestions = rawSavedSuggestionIds.length > 0
    ? await prisma.outfitSuggestion.findMany({
        where: { id: { in: rawSavedSuggestionIds } },
        select: { id: true, sessionId: true },
      })
    : [];
  const savedSuggestions = resolveSavedSuggestions(savedLooks, resolvedSuggestions);
  const savedSuggestionIds = new Set(savedSuggestions.map((s) => s.suggestionId));

  const displayedSuggestionBySession = buildDisplayedSuggestionMap(recentWithImages);
  const extraSavedSuggestions = selectExtraSavedSuggestions(savedSuggestions, displayedSuggestionBySession);
  const extraSuggestionIds = extraSavedSuggestions.map((s) => s.suggestionId);
  const extraSuggestionRows = extraSuggestionIds.length > 0
    ? await prisma.outfitSuggestion.findMany({
        where: { id: { in: extraSuggestionIds }, session: { customerId } },
        select: {
          id: true,
          outfitName: true,
          createdAt: true,
          sessionId: true,
          session: { select: { occasion: true } },
          items: { take: 5, select: itemImageSelect },
        },
      })
    : [];
  const extraSuggestionInputs: ExtraSuggestionInput[] = extraSuggestionRows.map((s) => {
    const { resolvedImages, extraCount } = resolveCollageImages(s.items, { customerId, cloudinaryConfig });
    return {
      suggestionId: s.id,
      outfitName: s.outfitName,
      suggestionCreatedAt: s.createdAt,
      sessionId: s.sessionId,
      sessionOccasion: s.session.occasion,
      itemCount: s.items.length,
      resolvedImages,
      extraCount,
    };
  });

  const recentSessions: SessionRecord[] = buildUnifiedHistory(recentWithImages, extraSuggestionInputs, savedSuggestionIds);

  return data({
    hasProfile: !!profile,
    stylePersonalities: profile?.stylePersonalities ?? [],
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions,
  });
}

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

      {/* Your StyleMe Looks — id is the direct-navigation anchor target for the save
          confirmation's own banner link on the result page (result.tsx), so a save lands
          here without scrolling past Start a New Session / Recent Feedback above. Route
          "/my-naia/saved" exists and genuinely queries SavedLook, but its own loader
          unconditionally redirects here (return redirect before ever reaching that
          query — a deliberate dead end, not an oversight), so this section, not that
          route, is the real destination. */}
      <section className="bos-section" id="your-styleme-looks">
        <div className="sml-section-label">Your StyleMe Looks</div>

        {recentSessions.length > 0 ? (
          <ul className="sml-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {recentSessions.map((session) => (
              <li key={session.suggestionId ?? session.id}>
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

  const occasionLabel = session.occasion ? occasionDisplayFor(null, session.occasion) : null;

  function handleDelete(e: React.FormEvent) {
    if (
      !window.confirm(
        "Delete this look?\n\nThis will remove the look from your StyleMe history. Your Closet will not be affected.",
      )
    ) {
      e.preventDefault();
    }
  }

  // suggestionId pins the link to the EXACT suggestion this card represents —
  // required when a session has multiple suggestions and this card is not
  // the latest one (e.g. an older saved suggestion). Harmless and
  // equivalent to today's behavior when suggestionId is the session's
  // latest suggestion anyway.
  const resultHref = session.suggestionId
    ? `/style-me/result?sessionId=${session.id}&suggestionId=${session.suggestionId}`
    : `/style-me/result?sessionId=${session.id}`;

  return (
    <article className="sml-card">
      <Link
        to={resultHref}
        style={{
          display: "block", aspectRatio: "4/5", border: "1px solid var(--naia-border)",
          background: "var(--naia-surface)", overflow: "hidden", marginBottom: "12px",
        }}
        aria-label={`View look — ${session.outfitName ?? "nAia Look"}`}
      >
        <LookCollage
          images={session.resolvedImages}
          extraCount={session.extraCount}
          alt={session.outfitName ?? ""}
        />
      </Link>
      <div className="sml-card-date">
        {formattedDate}
        {session.saved && <span className="sml-card-saved-badge">SAVED</span>}
      </div>
      <Link
        to={resultHref}
        className="sml-card-title"
      >
        {session.outfitName || (occasionLabel ? `${occasionLabel} look` : "Styled look")}
      </Link>
      {occasionLabel && <p className="sml-card-occasion">{occasionLabel}</p>}
      <div className="sv-card-actions">
        <Link
          to={resultHref}
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
