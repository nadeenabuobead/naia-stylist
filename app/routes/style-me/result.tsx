// app/routes/style-me/result.tsx
import { Form, Link, useLoaderData, useFetcher } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type ActionFunctionArgs, type ShouldRevalidateFunctionArgs, type LinksFunction } from "react-router";
import { useState, useEffect, type Dispatch, type SetStateAction, type CSSProperties } from "react";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { prisma } from "~/lib/prisma.server";
import { getSession, commitSession, clearStyleMeSession } from "~/lib/session.server";
import { readPendingSave, writePendingSave, clearPendingSave } from "~/lib/pending-save.server";
import {
  buildEngineInput,
  buildProfileSignals,
  computeStyleMeResult,
  buildDbPayload,
  styleSourceToSessionSource,
} from "~/lib/ai/styleme-result.server";
import { resolveActionAnchor, loadAllClosetItemsForEngine } from "~/lib/ai/styleme-anchor.server";
import { parseSuggestionMetadata } from "~/lib/ai/styleme-result.types";
import { issueImageToken } from "~/lib/dev-tryon-image-tokens.server";
import { isTryOnEligible } from "~/lib/ai/tryon-product-eligibility";
import { TryOnPanel } from "~/components/TryOnPanel";
import { VtoExperience } from "~/components/VtoExperience";
import { RecommendationFeedbackWidget } from "~/components/RecommendationFeedbackWidget";
import { loadSessionFeedback } from "~/lib/ai/feedback-persistence.server";
import { loadOutcomeForSuggestion } from "~/lib/ai/outcome-persistence.server";
import { buildCustomerJourneyContext, buildEphemeralContextSignals } from "~/lib/ai/journey-context.server";
import { emitSessionStarted, emitRecommendationServed, emitLookSaved, emitInSessionReviewSubmitted, recordJourneyEvent, recordJourneyEventAwaited } from "~/lib/ai/journey-events.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "Your Styling | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const devTryOnEnabled = process.env.DEV_TRYON_UI_ENABLED === 'true';
  const vtoEnabled = process.env.VTO_UI_ENABLED === "true";
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    // Resolve the optional nAia session once — used by both the direct-load and cookie paths.
    const naiaCustomer = await getCurrentNaiaCustomer(request);

    // Load model readiness for the authenticated customer — used by the try-on CTA.
    // CTA is still hidden in V8 (all product images null), but readiness is real from DB.
    const naiaModel = naiaCustomer ? await loadNaiaModel(naiaCustomer.id) : null;
    const naiaModelIsReady = computeModelReadinessFromRecord(naiaModel).isReadyForTryOn;

    const tryOnFixtureTokens: Record<string, string> = {};
    if (devTryOnEnabled) {
      for (const handle of ["asymmetrical-pants", "suede-skirt"] as const) {
        const slug = handle.replace(/\//g, "-");
        const token = issueImageToken(slug);
        tryOnFixtureTokens[handle] = `/app/dev-tryon-img/${slug}?t=${encodeURIComponent(token)}`;
      }
    }

    if (sessionId) {
      // Only the owning authenticated customer may view a session by direct ID.
      // Return the same generic response whether the session is missing or belongs to someone
      // else — do not reveal whether a supplied sessionId exists.
      if (!naiaCustomer) {
        return data(
          {
            isLoading: false,
            isAuthenticated: false,
            naiaModelIsReady: false,
            devTryOnEnabled,
            vtoEnabled,
            tryOnFixtureTokens,
            sessionId: null,
            mood: null,
            currentMood: null,
            desiredFeeling: null,
            occasion: null,
            suggestion: null,
            pendingState: null as "needs_passport" | "ready_to_save" | null,
            existingOutfitFeedback: null,
            existingOutcome: null,
            error: "Not found",
          },
          { status: 404 },
        );
      }
      const session = await prisma.stylingSession.findUnique({
        where: { id: sessionId },
        include: { suggestions: { include: { items: true }, orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!session || session.customerId !== naiaCustomer.id) {
        return data(
          {
            isLoading: false,
            isAuthenticated: true,
            naiaModelIsReady: false,
            devTryOnEnabled,
            vtoEnabled,
            tryOnFixtureTokens,
            sessionId: null,
            mood: null,
            currentMood: null,
            desiredFeeling: null,
            occasion: null,
            suggestion: null,
            pendingState: null as "needs_passport" | "ready_to_save" | null,
            existingOutfitFeedback: null,
            existingOutcome: null,
            error: "Not found",
          },
          { status: 404 },
        );
      }
      const sessionFeedback = await loadSessionFeedback(session.id, naiaCustomer.id);
      const currentSuggestionId = session.suggestions[0]?.id ?? null;
      const existingOutfitFeedback = sessionFeedback.find(
        (f) => f.target === "complete-suggestion" && f.suggestionId === currentSuggestionId,
      ) ?? null;
      const existingOutcome = currentSuggestionId
        ? await loadOutcomeForSuggestion(currentSuggestionId, naiaCustomer.id)
        : null;
      return data({
        isLoading: false,
        isAuthenticated: !!naiaCustomer,
        naiaModelIsReady,
        devTryOnEnabled,
        vtoEnabled,
        tryOnFixtureTokens,
        sessionId: session.id,
        mood: session.currentMood,
        currentMood: session.currentMood,
        occasion: session.occasion,
        desiredFeeling: session.desiredFeeling,
        rev3State: session.state ?? null,
        rev3Intentions: session.intentions ?? [],
        suggestion: session.suggestions[0] || null,
        pendingState: null as "needs_passport" | "ready_to_save" | null,
        existingOutfitFeedback: existingOutfitFeedback ? { id: existingOutfitFeedback.id, rating: existingOutfitFeedback.rating, reasonCodes: existingOutfitFeedback.reasonCodes } : null,
        existingOutcome,
        error: null,
      });
    }

    // Check pending-save cookie before the Quick Style cookie path that creates a new
    // StylingSession. A valid pending look is shown directly without triggering a new generation.
    const pendingResult = await readPendingSave(request);

    if (pendingResult.status === "invalid_or_expired") {
      // Expired or malformed — clear the stale cookie and continue to the normal flow.
      return redirect("/style-me/result", {
        headers: { "Set-Cookie": await clearPendingSave(request) },
      });
    }

    if (pendingResult.status === "valid" && naiaCustomer) {
      const pendingSuggestion = await prisma.outfitSuggestion.findUnique({
        where: { id: pendingResult.sid },
        include: { session: { include: { customer: true } }, items: true },
      });
      const isOwned = pendingSuggestion?.session?.customerId === naiaCustomer.id;
      const isGuestClaimable =
        pendingSuggestion?.session?.customer?.shopifyCustomerId === "guest";

      if (!pendingSuggestion || (!isOwned && !isGuestClaimable)) {
        // Missing suggestion or invalid ownership — clear cookie and restart the normal flow.
        return redirect("/style-me/result", {
          headers: { "Set-Cookie": await clearPendingSave(request) },
        });
      }

      const pendingState: "needs_passport" | "ready_to_save" =
        naiaCustomer.onboardingProfile?.completed ? "ready_to_save" : "needs_passport";

      const pendingSessionFeedback = await loadSessionFeedback(pendingSuggestion.sessionId, naiaCustomer.id);
      const pendingOutfitFeedback = pendingSessionFeedback.find(
        (f) => f.target === "complete-suggestion" && f.suggestionId === pendingSuggestion.id,
      ) ?? null;
      const pendingExistingOutcome = await loadOutcomeForSuggestion(pendingSuggestion.id, naiaCustomer.id);
      return data({
        isLoading: false,
        isAuthenticated: !!naiaCustomer,
        naiaModelIsReady,
        devTryOnEnabled,
        vtoEnabled,
        tryOnFixtureTokens,
        sessionId: pendingSuggestion.sessionId,
        mood: pendingSuggestion.session.currentMood,
        currentMood: pendingSuggestion.session.currentMood,
        desiredFeeling: pendingSuggestion.session.desiredFeeling,
        occasion: pendingSuggestion.session.occasion,
        rev3State: pendingSuggestion.session.state ?? null,
        rev3Intentions: pendingSuggestion.session.intentions ?? [],
        suggestion: pendingSuggestion,
        pendingState,
        existingOutfitFeedback: pendingOutfitFeedback ? { id: pendingOutfitFeedback.id, rating: pendingOutfitFeedback.rating, reasonCodes: pendingOutfitFeedback.reasonCodes } : null,
        existingOutcome: pendingExistingOutcome,
        error: null,
      });
    }

    const cookieSession = await getSession(request.headers.get("Cookie"));

    // Rev 3 — Psychology-First. Read new keys first; fall back to legacy.
    const rev3State = (cookieSession.get("styleMeState") as string | undefined) ?? null;
    const rev3StateOtherText = rev3State === "other"
      ? ((cookieSession.get("styleMeStateOtherText") as string | undefined) ?? null)
      : null;
    const rev3IntentionsRaw = cookieSession.get("styleMeIntentions") as string | undefined;
    const rev3Intentions: string[] = rev3IntentionsRaw
      ? (Array.isArray(rev3IntentionsRaw) ? rev3IntentionsRaw : (() => { try { return JSON.parse(rev3IntentionsRaw); } catch { return []; } })())
      : [];

    const mood = cookieSession.get("styleMeMood") as string | undefined;
    const feelings = cookieSession.get("styleMeFeelings") as string[] | undefined;
    // styleMeBodyNeeds is stored as JSON.stringify(array) — parse it back to a real string[].
    // The Array.isArray guard handles any session that stored the value directly.
    const _bodyNeedsStored = cookieSession.get("styleMeBodyNeeds") as string | string[] | undefined;
    const bodyNeeds: string[] | undefined = _bodyNeedsStored == null ? undefined
      : Array.isArray(_bodyNeedsStored) ? _bodyNeedsStored
      : (() => { try { return JSON.parse(_bodyNeedsStored) as string[]; } catch { return undefined; } })();
    const practicalIds = (cookieSession.get("styleMePractical") as string[] | undefined) ?? [];
    const occasion = cookieSession.get("styleMeOccasion") as string | undefined;
    const formalityConditional = (cookieSession.get("styleMeFormalityConditional") as string | undefined) ?? null;
    const source = cookieSession.get("styleMeSource");
    const nadineAnchorHandle = (cookieSession.get("styleMeNadineAnchorHandle") as string | undefined) ?? null;
    const closetAnchorId = (cookieSession.get("styleMeClosetAnchorId") as string | undefined) ?? null;

    const isRev3Session = !!rev3State;

    if (isRev3Session) {
      // Rev 3 path: need bodyNeeds + occasion + source (moods/feelings derived from intentions)
      if (!bodyNeeds || !bodyNeeds.length || !occasion || !source) {
        return redirect("/style-me/state");
      }
    } else {
      // Legacy path
      if (!mood || !mood.length || !feelings || !feelings.length || !bodyNeeds || !bodyNeeds.length || !occasion || !source) {
        return redirect("/style-me/mood");
      }
    }

    // Authenticated customers use their real ID; unauthenticated visitors fall back to the
    // shared guest row so the anonymous flow continues unchanged.
    let resolvedCustomerId = naiaCustomer?.id ?? null;
    if (!resolvedCustomerId) {
      const guest = await prisma.customer.upsert({
        where: { shopifyCustomerId: "guest" },
        create: { shopifyCustomerId: "guest", email: "guest@naia.app" },
        update: {},
      });
      resolvedCustomerId = guest.id;
    }

    const moodFirst = mood ?? null;
    const stylingSession = await prisma.stylingSession.create({
      data: {
        customerId: resolvedCustomerId,
        currentMood: moodFirst,
        desiredFeeling: feelings?.[0] || null,
        occasion,
        bodyNeeds: bodyNeeds ?? [],
        formalityConditional,
        practicalIds,
        styleFrom: source === "my-closet" ? "CLOSET" : source === "naia-piece" ? "NAIA" : "BOTH",
        closetAnchorId: (source === "my-closet" || source === "both") ? (closetAnchorId ?? null) : null,
        // Rev 3 — Psychology-First (Group 5). Wording context only; zero product scoring.
        ...(isRev3Session && {
          state: rev3State,
          intentions: rev3Intentions,
        }),
      },
    });

    return data(
      {
        isLoading: true,
        isAuthenticated: !!naiaCustomer,
        naiaModelIsReady,
        sessionId: stylingSession.id,
        mood: moodFirst,
        currentMood: moodFirst,
        moods: mood ? [mood] : [],
        desiredFeelings: feelings ?? [],
        desiredFeeling: feelings?.[0] || null,
        occasion,
        bodyNeeds,
        formalityConditional,
        practicalIds,
        nadineAnchorHandle,
        closetAnchorId,
        devTryOnEnabled,
        vtoEnabled,
        tryOnFixtureTokens,
        suggestion: null,
        pendingState: null as "needs_passport" | "ready_to_save" | null,
        existingOutfitFeedback: null,
        existingOutcome: null,
        error: null,
        // Rev 3 — Psychology-First (Group 5)
        rev3State: rev3State ?? null,
        rev3StateOtherText: rev3StateOtherText ?? null,
        rev3Intentions,
      },
      { headers: { "Set-Cookie": await commitSession(cookieSession) } }
    );
  } catch (err: any) {
    console.error("Result loader error:", err);
    return data({ isLoading: false, isAuthenticated: false, naiaModelIsReady: false, devTryOnEnabled, vtoEnabled, tryOnFixtureTokens: {} as Record<string, string>, sessionId: null, mood: null, currentMood: null, desiredFeeling: null, occasion: null, suggestion: null, pendingState: null as "needs_passport" | "ready_to_save" | null, existingOutfitFeedback: null, existingOutcome: null, error: err?.message || "Something went wrong" });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;
    const sessionId = formData.get("sessionId") as string;
    const suggestionId = formData.get("suggestionId") as string;
    const naiaCustomer = await getCurrentNaiaCustomer(request);

    if (intent === "start-over") {
      const clearedCookie = await clearStyleMeSession(request);
      // return, not throw — throw inside this try/catch would be caught by the
      // outer catch block and silently become a 500 instead of a 302.
      return redirect("/style-me/state", {
        headers: { "Set-Cookie": clearedCookie },
      });
    }

    if (intent === "adjust-vibe") {
      // Return the customer to vibe-only questions with existing answers prefilled.
      // Source, focal item and Passport context are preserved in the cookie — only
      // state / intentions / physical-need / occasion are re-asked.
      // A flag tells occasion.tsx to skip the source step on the way back.
      const cookieSession = await getSession(request.headers.get("Cookie"));
      cookieSession.set("styleMeAdjustVibe", "true");
      const isRev3 = !!cookieSession.get("styleMeState");
      const entryPoint = isRev3 ? "/style-me/state" : "/style-me/mood";
      return redirect(entryPoint, {
        headers: { "Set-Cookie": await commitSession(cookieSession) },
      });
    }

    if (intent === "generate") {
      const session = await prisma.stylingSession.findUnique({ where: { id: sessionId } });
      if (!session) return data({ error: "Session not found" }, { status: 404 });

      const bodyNeedsRaw = formData.get("bodyNeeds") as string | null;
      const bodyNeeds: string[] = bodyNeedsRaw ? JSON.parse(bodyNeedsRaw) : [];
      const moodsRaw = formData.get("moods") as string | null;
      const desiredFeelingsRaw = formData.get("desiredFeelings") as string | null;
      const nadineAnchorHandle = (formData.get("nadineAnchorHandle") as string) || null;
      const closetAnchorId = (formData.get("closetAnchorId") as string) || null;
      const formalityConditional = (formData.get("formalityConditional") as string) || null;
      const practicalIdsRaw = formData.get("practicalIds") as string | null;
      const practicalIds: string[] = practicalIdsRaw ? JSON.parse(practicalIdsRaw) : [];

      // Rev 3 — Psychology-First (Group 5)
      const rev3StateAction = (formData.get("rev3State") as string) || null;
      const rev3StateOtherTextAction = (formData.get("rev3StateOtherText") as string) || null;
      const rev3IntentionsRawAction = formData.get("rev3Intentions") as string | null;
      const rev3IntentionsAction: string[] = rev3IntentionsRawAction
        ? (() => { try { return JSON.parse(rev3IntentionsRawAction); } catch { return []; } })()
        : (session.intentions ?? []);

      // Translate Rev 3 intention IDs to canonical engine signals.
      // The engine never sees raw Rev 3 intention IDs — only canonical DFM/SMCM/PSM IDs.
      // feel-like-myself / express-myself → PROFILE_AMPLIFY via "like-myself" mood.
      // ground-me / give-energy → NO_RECOMMENDATION_EFFECT (wording context only).
      const INTENTION_DFM_MAP: Record<string, string> = {
        confidence: "more-confident",
        "feel-put-together": "more-put-together",
        "feel-attractive": "more-attractive",
        "feel-softer": "softer",
      };
      const INTENTION_SMCM_MAP: Record<string, string> = {
        "give-structure": "structured",
        "feel-less-exposed": "more-coverage",
      };
      const INTENTION_PRACTICAL_MAP: Record<string, string> = {
        "make-it-easy": "quick-to-style",
      };
      const PROFILE_AMPLIFY_IDS = new Set(["feel-like-myself", "express-myself"]);

      const translatedDesiredFeelings: string[] = [];
      const translatedSmcmIds: string[] = [];
      const translatedPracticalIds: string[] = [];
      const translatedMoods: string[] = [];

      for (const intentionId of rev3IntentionsAction) {
        if (PROFILE_AMPLIFY_IDS.has(intentionId)) {
          translatedMoods.push("like-myself");
        } else if (INTENTION_DFM_MAP[intentionId]) {
          translatedDesiredFeelings.push(INTENTION_DFM_MAP[intentionId]);
        } else if (INTENTION_SMCM_MAP[intentionId]) {
          translatedSmcmIds.push(INTENTION_SMCM_MAP[intentionId]);
        } else if (INTENTION_PRACTICAL_MAP[intentionId]) {
          translatedPracticalIds.push(INTENTION_PRACTICAL_MAP[intentionId]);
        }
        // ground-me, give-energy → no engine signal
      }

      const isRev3Generate = !!(rev3StateAction ?? session.state);

      // For Rev 3: moods come from intention translation; state is NEVER passed to engine.
      // For legacy: moods/desiredFeelings come from form.
      const moods: string[] = isRev3Generate
        ? translatedMoods
        : (moodsRaw ? JSON.parse(moodsRaw) : [session.currentMood || "confident"]);

      const desiredFeelings: string[] = isRev3Generate
        ? translatedDesiredFeelings
        : (desiredFeelingsRaw
            ? JSON.parse(desiredFeelingsRaw)
            : session.desiredFeeling
            ? [session.desiredFeeling]
            : []);

      // SMCM and practical signals from intention translation merge with form values
      const effectivePracticalIds = isRev3Generate
        ? [...practicalIds, ...translatedPracticalIds]
        : practicalIds;

      // Resolve anchor input from session-stored selection.
      // For closet sources (my-closet, both) a missing or unowned ID is rejected here —
      // we never continue with anchor=null for those sources.
      const sessionSource = styleSourceToSessionSource(session.styleFrom);
      const anchorResult = await resolveActionAnchor(
        sessionSource,
        session.customerId,
        nadineAnchorHandle,
        closetAnchorId,
      );

      if (!anchorResult.ok) {
        // Clear the stale anchor keys from the cookie so the user can re-select
        const cookieSession = await getSession(request.headers.get("Cookie"));
        cookieSession.unset("styleMeClosetAnchorId");
        cookieSession.unset("styleMeNadineAnchorHandle");
        return data(
          { error: anchorResult.message },
          { status: anchorResult.status, headers: { "Set-Cookie": await commitSession(cookieSession) } },
        );
      }

      const anchor = anchorResult.anchor;

      // Build journey context for SOFT_RANK signal merging — never blocks StyleMe.
      // Failure (missing migration, no selfie, no feedback) returns null; explicit signals proceed unchanged.
      let journeyCtx = null;
      if (naiaCustomer) {
        try {
          journeyCtx = await buildCustomerJourneyContext(naiaCustomer.id);
        } catch { /* graceful degradation — StyleMe proceeds with explicit signals only */ }
      }

      // Fire-and-forget session-started event — captures feature context at generation time
      if (naiaCustomer) {
        try {
          const sessionStartedEv = emitSessionStarted({
            customerId: session.customerId,
            sessionId,
            occasion: session.occasion ?? "everyday",
            source: session.styleFrom === "CLOSET" ? "my-closet" : session.styleFrom === "NAIA" ? "naia-piece" : "both",
            hasSelfieGuidance: !!journeyCtx?.selfieSignals,
            closetItemCount: journeyCtx?.closetSummary.totalItems ?? 0,
            hasEligibleClosetItem: journeyCtx?.features.hasEligibleClosetItems ?? false,
            naiaModelIsReady: journeyCtx?.features.naiaModelIsReady ?? false,
          });
          recordJourneyEvent(sessionStartedEv);
        } catch { /* never let event emission block generation */ }
      }

      // For Rev 3: SMCM tokens from intention translation merge into bodyNeeds.
      const effectiveBodyNeeds = isRev3Generate
        ? [...bodyNeeds, ...translatedSmcmIds]
        : bodyNeeds;

      const cookieSession = await getSession(request.headers.get("Cookie"));
      const styleMeMode = (cookieSession.get("styleMeMode") as "naia" | "nadine" | undefined) ?? "naia";

      const engineInput = buildEngineInput({
        moods,
        desiredFeelings,
        bodyNeeds: effectiveBodyNeeds,
        coverageConditional: null,
        occasion: session.occasion ?? "everyday",
        formalityConditional,
        todayColours: { preferred: [], avoid: [] },
        practicalIds: isRev3Generate ? effectivePracticalIds : practicalIds,
        source: sessionSource,
        profile: buildEphemeralContextSignals(buildProfileSignals(naiaCustomer?.onboardingProfile), journeyCtx),
        mode: styleMeMode,
        // Rev 3 wording context — never affects engine scoring
        ...(isRev3Generate && {
          state: rev3StateAction ?? session.state ?? undefined,
          intentions: rev3IntentionsAction,
          // stateOtherText: only when state === "other"; context only, zero scoring
          ...((rev3StateAction ?? session.state) === "other" && rev3StateOtherTextAction
            ? { stateOtherText: rev3StateOtherTextAction }
            : {}),
        }),
        anchor,
      });

      const loadClosetItems = naiaCustomer
        ? () => loadAllClosetItemsForEngine(naiaCustomer.id)
        : undefined;

      const styleResult = await computeStyleMeResult(
        engineInput,
        undefined,
        undefined,
        undefined,
        loadClosetItems,
      );
      const dbPayload = buildDbPayload(styleResult);

      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId,
          // status left at @default("PENDING") — outcome lives in moodDescription metadata
          moodDescription: dbPayload.moodDescriptionJson,
          outfitName: dbPayload.outfitName,
          whyThisWorks: dbPayload.whyThisWorks,
          confidenceBoost: dbPayload.confidenceBoost,
          perfumeRec: dbPayload.perfumeRec,
          hairstyleRec: dbPayload.hairstyleRec,
          makeupVibeRec: dbPayload.makeupVibeRec,
          songRec: dbPayload.songRec,
          songArtist: dbPayload.songArtist,
          items: {
            create: dbPayload.items.map((item) => ({
              itemType: item.itemType,
              productTitle: item.productTitle,
              productImageUrl: item.productImageUrl,
              shopifyProductId: item.shopifyProductId,
              closetItemId: item.closetItemId ?? undefined,
              stylingNotes: item.stylingNotes,
              productUrl: item.productUrl ?? undefined,
            })),
          },
        },
        include: { items: true },
      });

      // Fire-and-forget event — never blocks the response
      try {
        const meta = parseSuggestionMetadata(dbPayload.moodDescriptionJson);
        const ev = emitRecommendationServed({
          customerId: session.customerId,
          sessionId,
          outcome: (meta?.outcome as "nadine-recommendation" | "closet-led" | "no-eligible-product") ?? "nadine-recommendation",
          primaryHandle: meta?.primaryHandle ?? null,
          alternativeCount: meta?.alternatives?.length ?? 0,
        });
        recordJourneyEvent(ev);
      } catch { /* never let event emission block the response */ }

      return data({ suggestion, error: null });
    }

    if (intent === "regenerate") {
      // New Look, Same Vibe — generates another OutfitSuggestion on the same StylingSession.
      // Reads all context from the session record so no extra form params are required.
      const session = await prisma.stylingSession.findUnique({ where: { id: sessionId } });
      if (!session) return data({ error: "Session not found" }, { status: 404 });
      if (naiaCustomer && session.customerId !== naiaCustomer.id) {
        return data({ error: "Not found" }, { status: 404 });
      }

      const sessionSource = styleSourceToSessionSource(session.styleFrom);
      const anchorResult = await resolveActionAnchor(sessionSource, session.customerId, null, session.closetAnchorId ?? null);
      if (!anchorResult.ok) {
        return data({ error: anchorResult.message }, { status: anchorResult.status });
      }

      let journeyCtx = null;
      if (naiaCustomer) {
        try { journeyCtx = await buildCustomerJourneyContext(naiaCustomer.id); } catch { /* graceful */ }
      }

      const regenCookieSession = await getSession(request.headers.get("Cookie"));
      const regenMode = (regenCookieSession.get("styleMeMode") as "naia" | "nadine" | undefined) ?? "naia";

      // Collect handles from the most-recent suggestion so the engine applies a
      // diversity penalty and avoids returning the exact same outfit.
      const prevSuggestion = await prisma.outfitSuggestion.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { moodDescription: true },
      });
      const prevMeta = prevSuggestion ? parseSuggestionMetadata(prevSuggestion.moodDescription) : null;
      const recentlyShownHandles: string[] = [];
      if (prevMeta?.primaryHandle) recentlyShownHandles.push(prevMeta.primaryHandle);
      if (prevMeta?.alternatives) {
        for (const alt of prevMeta.alternatives) {
          if (alt.handle && !recentlyShownHandles.includes(alt.handle)) {
            recentlyShownHandles.push(alt.handle);
          }
        }
      }

      const engineInput = buildEngineInput({
        moods: session.currentMood ? [session.currentMood] : [],
        desiredFeelings: session.desiredFeeling ? [session.desiredFeeling] : [],
        bodyNeeds: session.bodyNeeds ?? [],
        coverageConditional: null,
        occasion: session.occasion ?? "everyday",
        formalityConditional: session.formalityConditional,
        todayColours: { preferred: [], avoid: [] },
        practicalIds: session.practicalIds ?? [],
        source: sessionSource,
        profile: buildEphemeralContextSignals(buildProfileSignals(naiaCustomer?.onboardingProfile), journeyCtx),
        mode: regenMode,
        anchor: anchorResult.anchor,
        recentlyShownHandles,
        // Rev 3 wording context — stored on session, never affects scoring
        ...(session.state && {
          state: session.state,
          intentions: session.intentions ?? [],
        }),
      });

      const regenLoadClosetItems = naiaCustomer
        ? () => loadAllClosetItemsForEngine(naiaCustomer.id)
        : undefined;

      const styleResult = await computeStyleMeResult(
        engineInput,
        undefined,
        undefined,
        undefined,
        regenLoadClosetItems,
      );
      const dbPayload = buildDbPayload(styleResult);

      const suggestion = await prisma.outfitSuggestion.create({
        data: {
          sessionId,
          moodDescription: dbPayload.moodDescriptionJson,
          outfitName: dbPayload.outfitName,
          whyThisWorks: dbPayload.whyThisWorks,
          confidenceBoost: dbPayload.confidenceBoost,
          perfumeRec: dbPayload.perfumeRec,
          hairstyleRec: dbPayload.hairstyleRec,
          makeupVibeRec: dbPayload.makeupVibeRec,
          songRec: dbPayload.songRec,
          songArtist: dbPayload.songArtist,
          items: {
            create: dbPayload.items.map((item) => ({
              itemType: item.itemType,
              productTitle: item.productTitle,
              productImageUrl: item.productImageUrl,
              shopifyProductId: item.shopifyProductId,
              closetItemId: item.closetItemId ?? undefined,
              stylingNotes: item.stylingNotes,
              productUrl: item.productUrl ?? undefined,
            })),
          },
        },
        include: { items: true },
      });

      try {
        const meta = parseSuggestionMetadata(dbPayload.moodDescriptionJson);
        recordJourneyEvent(emitRecommendationServed({
          customerId: session.customerId,
          sessionId,
          outcome: (meta?.outcome as "nadine-recommendation" | "closet-led" | "no-eligible-product") ?? "nadine-recommendation",
          primaryHandle: meta?.primaryHandle ?? null,
          alternativeCount: meta?.alternatives?.length ?? 0,
        }));
      } catch { /* never block */ }

      return data({ suggestion, error: null });
    }

    if (intent === "save") {
      // Case 1: Completed-Passport customer — immediate save (C3.0 path preserved).
      if (naiaCustomer?.onboardingProfile?.completed) {
        const suggestion = await prisma.outfitSuggestion.findUnique({
          where: { id: suggestionId },
          include: { session: true, items: true },
        });
        if (!suggestion || suggestion.session.customerId !== naiaCustomer.id) {
          return data({ error: "Not found" }, { status: 404 });
        }
        const savedLook = await prisma.savedLook.create({
          data: {
            customerId: naiaCustomer.id,
            name: suggestion.outfitName,
            fromSuggestionId: suggestion.id,
            items: {
              create: suggestion.items.map((item) => ({
                itemType: item.itemType,
                closetItemId: item.closetItemId || null,
                shopifyProductId: item.shopifyProductId || null,
              })),
            },
          },
        });
        // Awaited with idempotency key — prevents duplicate events under SSR revalidation
        try {
          await recordJourneyEventAwaited(
            emitLookSaved({
              customerId: naiaCustomer.id,
              sessionId,
              savedLookId: savedLook.id,
              fromSuggestionId: suggestion.id,
              itemCount: suggestion.items.length,
              occasion: null,
            }),
            `look_saved:${savedLook.id}:v1`,
          );
        } catch { /* event emission never blocks the response */ }
        return data({ saved: true, error: null });
      }

      // Case 2: Authenticated, no completed Passport — write pending cookie.
      if (naiaCustomer) {
        const suggestion = await prisma.outfitSuggestion.findUnique({
          where: { id: suggestionId },
          include: { session: true },
        });
        if (!suggestion || suggestion.session.customerId !== naiaCustomer.id) {
          return data({ error: "Not found" }, { status: 404 });
        }
        const pendingHeader = await writePendingSave(suggestionId);
        return data(
          { pending: true, next: "create_passport" },
          { headers: { "Set-Cookie": pendingHeader } },
        );
      }

      // Case 3: Guest — verify guest ownership, write pending cookie.
      const guestCustomer = await prisma.customer.findUnique({
        where: { shopifyCustomerId: "guest" },
      });
      if (!guestCustomer) return data({ error: "Not found" }, { status: 404 });
      const guestSuggestion = await prisma.outfitSuggestion.findUnique({
        where: { id: suggestionId },
        include: { session: true },
      });
      if (!guestSuggestion || guestSuggestion.session.customerId !== guestCustomer.id) {
        return data({ error: "Not found" }, { status: 404 });
      }
      const pendingHeader = await writePendingSave(suggestionId);
      return data(
        { pending: true, next: "sign_in" },
        { headers: { "Set-Cookie": pendingHeader } },
      );

    }

    if (intent === "review") {
      const overallReaction = parseInt(formData.get("overallReaction") as string);
      const feltLikeMe = formData.get("feltLikeMe") === "true";
      const createdFeeling = formData.get("createdFeeling") === "true";
      const wouldWear = formData.get("wouldWear") === "true";
      const physicalComfort = parseInt(formData.get("physicalComfort") as string);
      const whatWorked = (formData.get("whatWorked") as string || "").split(",").filter(Boolean);
      const whatDidnt = (formData.get("whatDidnt") as string || "").split(",").filter(Boolean);

      const reviewSession = await prisma.stylingSession.findUnique({
        where: { id: sessionId },
        include: { suggestions: true },
      });

      if (!reviewSession || !reviewSession.suggestions[0]) {
        return data({ error: "Session not found" }, { status: 404 });
      }

      const reviewFields = {
        overallFeeling: overallReaction,
        feltLikeHer: feltLikeMe ? "Yes" : "No",
        desiredFeelingAchieved: createdFeeling ? "Yes" : "No",
        wouldWearAgain: wouldWear ? "Definitely" : "Probably not",
        physicallyComfortable: physicalComfort.toString(),
        workedTags: whatWorked.length > 0 ? JSON.stringify(whatWorked) : null,
        didntWorkTags: whatDidnt.length > 0 ? JSON.stringify(whatDidnt) : null,
      };
      await prisma.postOutfitReview.upsert({
        where: { sessionId },
        create: { customerId: reviewSession.customerId, sessionId, ...reviewFields },
        update: reviewFields,
      });

      // Awaited with idempotency key — one event per session review (upsert is idempotent)
      try {
        await recordJourneyEventAwaited(
          emitInSessionReviewSubmitted({
            customerId: reviewSession.customerId,
            sessionId,
            overallFeeling: isNaN(overallReaction) ? null : overallReaction,
            confidenceBefore: null,
            confidenceAfter: null,
            feltLikeHer: reviewFields.feltLikeHer,
            desiredFeelingAchieved: reviewFields.desiredFeelingAchieved,
            wouldWearAgain: reviewFields.wouldWearAgain,
          }),
          `in_session_review_submitted:${sessionId}:v1`,
        );
      } catch { /* event emission never blocks the response */ }

      return data({ reviewSaved: true, error: null });
    }

    // Read suggestion ID from pending cookie only — never from form data.
    if (intent === "save-pending") {
      if (!naiaCustomer) return data({ error: "Must be logged in" }, { status: 401 });
      if (!naiaCustomer.onboardingProfile?.completed) {
        return data({ error: "passport_required" }, { status: 403 });
      }
      const pendingRead = await readPendingSave(request);
      if (pendingRead.status === "invalid_or_expired") {
        const clearHeader = await clearPendingSave(request);
        return data({ error: "No pending save" }, { status: 400, headers: { "Set-Cookie": clearHeader } });
      }
      if (pendingRead.status === "none") {
        return data({ error: "No pending save" }, { status: 400 });
      }
      const { sid } = pendingRead;

      // Idempotent: already saved this look for this customer.
      const existing = await prisma.savedLook.findFirst({
        where: { customerId: naiaCustomer.id, fromSuggestionId: sid },
      });
      if (existing) {
        const clearHeader = await clearPendingSave(request);
        return data(
          { saved: true, alreadySaved: true },
          { headers: { "Set-Cookie": clearHeader } },
        );
      }

      const suggestion = await prisma.outfitSuggestion.findUnique({
        where: { id: sid },
        include: { session: { include: { customer: true } }, items: true },
      });
      const isOwned = suggestion?.session?.customerId === naiaCustomer.id;
      const isGuestClaimable =
        suggestion?.session?.customer?.shopifyCustomerId === "guest";
      if (!suggestion || (!isOwned && !isGuestClaimable)) {
        const clearHeader = await clearPendingSave(request);
        return data(
          { error: "Not found" },
          { status: 404, headers: { "Set-Cookie": clearHeader } },
        );
      }

      const savedLookPending = await prisma.savedLook.create({
        data: {
          customerId: naiaCustomer.id,
          name: suggestion.outfitName,
          fromSuggestionId: suggestion.id,
          items: {
            create: suggestion.items.map((item) => ({
              itemType: item.itemType,
              closetItemId: item.closetItemId || null,
              shopifyProductId: item.shopifyProductId || null,
            })),
          },
        },
      });
      try {
        await recordJourneyEventAwaited(
          emitLookSaved({
            customerId: naiaCustomer.id,
            sessionId: suggestion.session.id,
            savedLookId: savedLookPending.id,
            fromSuggestionId: suggestion.id,
            itemCount: suggestion.items.length,
            occasion: null,
          }),
          `look_saved:${savedLookPending.id}:v1`,
        );
      } catch { /* event emission never blocks the response */ }

      const clearHeader = await clearPendingSave(request);
      return data({ saved: true }, { headers: { "Set-Cookie": clearHeader } });
    }

    if (intent === "clear-pending") {
      const clearHeader = await clearPendingSave(request);
      return data({ cleared: true }, { headers: { "Set-Cookie": clearHeader } });
    }

    return data({ error: "Invalid intent" }, { status: 400 });
  } catch (err: any) {
    console.error("Result action error:", err);
    return data({ error: err?.message || "Something went wrong" }, { status: 500 });
  }
}

export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // save, save-pending, and clear-pending must not re-run the side-effecting loader:
  // the cookie-path loader creates a new StylingSession on every invocation and returns
  // isLoading:true, which would put the result page back into the loading/generate state.
  const intent = formData?.get("intent");
  if (intent === "generate" || intent === "regenerate" || intent === "save" || intent === "save-pending" || intent === "clear-pending" || intent === "review") return false;
  return defaultShouldRevalidate;
}

const MIN_LOADING_MS = 4800;
const loadingMessages = ["Reading the runways...", "Reading what you need from the outfit...", "Matching textures and fabrics...", "Finalizing your look..."];

const REV3_STATE_LABELS: Record<string, string> = {
  "feel-good": "I feel good",
  "stressed-overloaded": "Stressed / overloaded",
  "low-energy": "Low-energy",
  "not-feeling-like-myself": "I don't really feel like myself",
  "physically-uncomfortable": "Physically uncomfortable",
  "self-conscious": "Self-conscious",
  "going-through-change": "I'm going through a change / something",
  "want-reset": "I want a reset",
  "nothing-in-particular": "Nothing in particular",
  "other": "Something else",
};
const REV3_INTENTION_LABELS: Record<string, string> = {
  "feel-like-myself": "Help me feel like myself",
  "confidence": "Give me confidence",
  "ground-me": "Ground me",
  "give-structure": "Give me structure",
  "make-it-easy": "Make things feel easy",
  "feel-put-together": "Help me feel put together",
  "feel-attractive": "Make me feel attractive",
  "give-energy": "Give me energy",
  "feel-softer": "Help me feel softer",
  "feel-less-exposed": "Help me feel less exposed",
  "express-myself": "Let me express myself",
};
const MOOD_LABELS: Record<string, string> = {
  "confident": "Confident", "tired": "Low-energy", "overwhelmed": "Overwhelmed",
  "adventurous": "Adventurous", "romantic": "Romantic", "powerful": "Powerful",
  "need-reset": "Need a reset", "feel-good": "Feel good",
};
const FEELING_LABELS: Record<string, string> = {
  "more-confident": "More confident", "more-put-together": "More put together",
  "softer": "Softer", "more-powerful": "More powerful", "more-feminine": "More feminine",
  "more-effortless": "More effortless", "more-elevated": "More elevated",
  "more-attractive": "More attractive", "like-myself": "Like myself again",
};
const OCCASION_LABELS: Record<string, string> = {
  "everyday": "Everyday", "work": "Work", "dinner": "Dinner", "date-night": "Date night",
  "girls-night": "Evening out", "family": "Family gathering", "special-event": "Special event",
  "travel": "Travel", "not-sure": "Not sure yet",
};

// The loader has several return branches (direct sessionId load, pending-save,
// error, and the cookie-path fresh-generation branch); only the fresh-generation
// branch (isLoading: true) carries these fields. TypeScript can't narrow the
// inferred union on `loaderData.isLoading` alone, so the one call site that reads
// them (the generate-on-mount effect below, itself gated on `loaderData.isLoading`)
// asserts this known-present shape rather than widening every other branch.
interface StyleMeGenerationLoaderData {
  sessionId: string;
  bodyNeeds: string[];
  moods: string[];
  desiredFeelings: string[];
  formalityConditional: string | null;
  practicalIds: string[];
  nadineAnchorHandle: string | null;
  closetAnchorId: string | null;
  // Rev 3 — Psychology-First (Group 5)
  rev3State?: string | null;
  rev3StateOtherText?: string | null;
  rev3Intentions?: string[];
}

export default function StyleMeResult() {
  const loaderData = useLoaderData<typeof loader>();
  const generateFetcher = useFetcher<{ suggestion?: any; error?: string }>();
  const saveFetcher = useFetcher<{ saved?: boolean; error?: string; code?: string; pending?: boolean; next?: string; cleared?: boolean; alreadySaved?: boolean }>();
  const [msgIndex, setMsgIndex] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [pendingDismissed, setPendingDismissed] = useState(false);
  const [isInitialGeneration] = useState(() => loaderData.isLoading);
  const [minDelayPassed, setMinDelayPassed] = useState(
    () => !loaderData.isLoading,
  );
  const [tryOnPanel, setTryOnPanel] = useState<{
    handle: string;
    title: string;
    context: "single-piece" | "complete-look";
  } | null>(null);
  // ── Style Memory V1 — outcome capture state ───────────────────────────────
  const existingOutcome = (loaderData as any).existingOutcome as import("~/lib/ai/outcome-contract").StyleMeOutcomeSummary | null;
  const outcomeFetcher = useFetcher<{ ok?: boolean; outcome?: import("~/lib/ai/outcome-contract").StyleMeOutcomeSummary; error?: string }>();
  const [outcomeStatus, setOutcomeStatus] = useState<string | null>(existingOutcome?.outcomeStatus ?? null);
  const [selectedChangeTypes, setSelectedChangeTypes] = useState<string[]>(existingOutcome?.changeTypes ?? []);
  const [otherChangeNote, setOtherChangeNote] = useState<string>(existingOutcome?.otherChangeNote ?? "");
  const [goalOutcome, setGoalOutcome] = useState<string | null>(existingOutcome?.goalOutcome ?? null);
  const [whatWorked, setWhatWorked] = useState<string[]>(existingOutcome?.whatWorked ?? []);
  const [whatFeltOff, setWhatFeltOff] = useState<string[]>(existingOutcome?.whatFeltOff ?? []);
  const [didntWearReasons, setDidntWearReasons] = useState<string[]>(existingOutcome?.didntWearReasons ?? []);
  const [reasonOtherNote, setReasonOtherNote] = useState<string>(existingOutcome?.reasonOtherNote ?? "");
  const [outcomeSaved, setOutcomeSaved] = useState<boolean>(existingOutcome != null);
  const [isOutcomeEditing, setIsOutcomeEditing] = useState(false);
  const [selectedResultDirection, setSelectedResultDirection] = useState<string | null>(existingOutcome?.selectedDirection ?? null);

  useEffect(() => {
    if (outcomeFetcher.data?.ok) {
      setOutcomeSaved(true);
      setIsOutcomeEditing(false);
    }
  }, [outcomeFetcher.data]);

  const generationSettled =
    !!generateFetcher.data?.suggestion || !!generateFetcher.data?.error;
  const isLoading =
    isInitialGeneration && (!generationSettled || !minDelayPassed);
  const suggestion = generateFetcher.data?.suggestion || loaderData.suggestion;
  const error = generateFetcher.data?.error || loaderData.error;

  // Whether to show the pending-save banner (active pending state, not dismissed, not yet saved).
  const showPendingBanner = !!loaderData.pendingState && !pendingDismissed && !isSaved;

  useEffect(() => {
    if (loaderData.isLoading && loaderData.sessionId && generateFetcher.state === "idle" && !generateFetcher.data) {
      // Safe: the isLoading check above is the runtime proof we're in the
      // fresh-generation branch, which is the only one that sets these fields.
      const generationData = loaderData as typeof loaderData & StyleMeGenerationLoaderData;
      generateFetcher.submit(
        {
          intent: "generate",
          sessionId: generationData.sessionId,
          bodyNeeds: JSON.stringify(generationData.bodyNeeds || []),
          moods: JSON.stringify(generationData.moods || []),
          desiredFeelings: JSON.stringify(generationData.desiredFeelings || []),
          formalityConditional: generationData.formalityConditional ?? "",
          practicalIds: JSON.stringify(generationData.practicalIds || []),
          nadineAnchorHandle: generationData.nadineAnchorHandle ?? "",
          closetAnchorId: generationData.closetAnchorId ?? "",
          // Rev 3 — Psychology-First (Group 5). Empty string = legacy session.
          rev3State: (generationData as any).rev3State ?? "",
          rev3StateOtherText: (generationData as any).rev3StateOtherText ?? "",
          rev3Intentions: JSON.stringify((generationData as any).rev3Intentions ?? []),
        },
        { method: "post" },
      );
    }
  }, []);

  useEffect(() => {
    if (!isInitialGeneration) return;

    const timer = setTimeout(() => {
      setMinDelayPassed(true);
    }, MIN_LOADING_MS);

    return () => clearTimeout(timer);
  }, [isInitialGeneration]);

  useEffect(() => {
    if (!isLoading) return;
    const t = setInterval(() => setMsgIndex((i) => (i + 1) % loadingMessages.length), 1200);
    return () => clearInterval(t);
  }, [isLoading]);

  useEffect(() => {
    if (!saveFetcher.data) return;
    if (saveFetcher.data.saved) setIsSaved(true);
    if (saveFetcher.data.cleared) setPendingDismissed(true);
    if (saveFetcher.data.pending) {
      if (saveFetcher.data.next === "sign_in") {
        window.location.href = "/auth/shopify/login?return_to=/style-me/result";
      } else if (saveFetcher.data.next === "create_passport") {
        window.location.href = "/onboarding/step/1";
      }
    }
  }, [saveFetcher.data]);

  // ── Loading state ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="sm-loading-wrap">
        <div className="sm-loading-inner">
          <h2 style={{ fontSize: "36px", lineHeight: 1.1, marginBottom: "16px", fontFamily: "var(--ff-editorial)", fontStyle: "italic", fontWeight: 400, color: "var(--naia-ink)" }}>
            <span style={{ color: "var(--lipstick)" }}>nAia</span>
            {" is styling you..."}
          </h2>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--naia-muted)", marginBottom: "40px" }}>
            Building your look around what you need today, the occasion, and your wardrobe.
          </p>
          <div className="sm-loading-track">
            <div className="sm-loading-bar" />
          </div>
          <p className="sm-loading-msg">{loadingMessages[msgIndex]}</p>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────
  if (error || !suggestion) {
    return (
      <div className="sm-loading-wrap">
        <div style={{ textAlign: "center", maxWidth: "500px", padding: "40px" }}>
          <h1 style={{ fontFamily: "var(--naia-ff-display)", fontSize: "32px", fontWeight: 900, color: "var(--naia-ink)", marginBottom: "16px" }}>
            Something went wrong
          </h1>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--naia-muted)", marginBottom: "32px" }}>
            {error || "Couldn't create your styling. Let's try again"}
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="start-over" />
            <button type="submit" className="sm-result-action-btn sm-result-action-btn--primary">
              Start Again
            </button>
          </Form>
        </div>
      </div>
    );
  }

  const suggestionMeta = parseSuggestionMetadata(suggestion.moodDescription);

  // "See This Look On Me" — shown only when:
  //   1. customer is authenticated
  //   2. outcome is nadine-recommendation
  //   3. primary NADINE item has a verified product image URL in the DB
  //   4. VtoExperience is not already active for this handle (prevents duplicate VTO UI)
  const primaryNaiaItemWithImage = suggestion.items?.find(
    (item: any) =>
      !["SHOES", "ACCESSORY", "BAG"].includes(item.itemType) && item.productImageUrl,
  );
  const primaryNaiaItem = suggestion.items?.find(
    (item: any) => !["SHOES", "ACCESSORY", "BAG"].includes(item.itemType),
  );
  // True when the real production VtoExperience is rendering for this session.
  // When active, the "See This Look On Me" placeholder section is suppressed to avoid
  // simultaneously showing live VTO and a "coming in future update" message.
  const vtoIsActive =
    loaderData.vtoEnabled &&
    !!suggestionMeta?.primaryHandle &&
    isTryOnEligible(suggestionMeta.primaryHandle);
  // "See This Look On Me" section visibility:
  // Shown for authenticated NADINE results with a product image, when real VTO is not active.
  // When model is not ready, a setup-required state is shown instead of hiding the section.
  const showTryOnSection =
    !vtoIsActive &&
    loaderData.isAuthenticated &&
    suggestionMeta?.outcome === "nadine-recommendation" &&
    !!primaryNaiaItemWithImage;
  const tryOnModelReady = showTryOnSection && loaderData.naiaModelIsReady;

  const isNoMatch = suggestionMeta
    ? suggestionMeta.outcome === "no-eligible-product"
    : !suggestion.items?.some((item: any) => !["SHOES", "ACCESSORY", "BAG"].includes(item.itemType));

  // True when the anchor piece is already present as a first-class garment in suggestion.items.
  // Prevents the same garment from appearing both in The Look and the separate Anchor Piece card.
  const anchorAlreadyInItems = (() => {
    const anchor = suggestionMeta?.anchor;
    if (!anchor) return false;
    if (anchor.type === "closet") {
      const mainItems: any[] = (suggestion.items ?? []).filter(
        (i: any) => !["SHOES", "ACCESSORY", "BAG"].includes(i.itemType),
      );
      return mainItems.some((i: any) => i.closetItemId === anchor.id);
    }
    // NADINE anchor: hide only when the exact anchor handle matches the primary item in the look.
    // e.g. anchor "trench-coat" + primaryHandle "trench-coat" → true (hide).
    //      anchor "trench-coat" + primaryHandle "collar-shirt" → false (keep).
    return anchor.handle === suggestionMeta?.primaryHandle;
  })();

  return (
    <div style={{ minHeight: "100vh", background: "var(--naia-bg)" }}>

      {/* ── Top bar ── */}
      <div className="sm-result-bar">
        <Link to="/style-me" className="sm-result-btn">Back</Link>
        <span className="sm-result-wordmark">nAia</span>
        {isSaved ? (
          <span className="sm-result-btn sm-result-btn--accent">Saved</span>
        ) : showPendingBanner ? (
          <span style={{ width: "42px" }} />
        ) : (
          <button
            onClick={() => saveFetcher.submit({ intent: "save", suggestionId: suggestion.id }, { method: "post" })}
            className="sm-result-btn"
          >
            Save
          </button>
        )}
      </div>

      {/* ── Saved confirmation banner ── */}
      {isSaved && (
        <div className="sm-banner sm-banner-saved">
          <p className="sm-banner-text">Saved to your nAia Passport.</p>
          <div className="sm-banner-actions">
            <Link to="/my-naia" className="sm-banner-cta">← Overview</Link>
          </div>
        </div>
      )}

      {/* ── Pending: needs passport ── */}
      {showPendingBanner && loaderData.pendingState === "needs_passport" && (
        <div className="sm-banner">
          <p className="sm-banner-text">
            To save this look, create your nAia Passport. Your look will be waiting here.
          </p>
          <div className="sm-banner-actions">
            <a href="/onboarding/step/1" className="sm-banner-cta" style={{ background: "var(--naia-ink)" }}>
              Create Your Passport →
            </a>
            <button
              onClick={() => saveFetcher.submit({ intent: "clear-pending" }, { method: "post" })}
              className="sm-result-btn"
            >
              Not Now
            </button>
          </div>
        </div>
      )}

      {/* ── Pending: ready to save ── */}
      {showPendingBanner && loaderData.pendingState === "ready_to_save" && (
        <div className="sm-banner">
          <p className="sm-banner-text">Your look is ready to save to your nAia Passport.</p>
          <div className="sm-banner-actions">
            <button
              onClick={() => saveFetcher.submit({ intent: "save-pending" }, { method: "post" })}
              className="sm-banner-cta"
            >
              Save to My Passport
            </button>
            <button
              onClick={() => saveFetcher.submit({ intent: "clear-pending" }, { method: "post" })}
              className="sm-result-btn"
            >
              Not Now
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="sm-result-main">

        {/* Title + context grid */}
        <div className="sm-result-meta">
          <p className="sm-eyebrow" style={{ marginBottom: "12px" }}>Your Styling</p>
          <h1 style={{ fontFamily: "var(--naia-ff-display)", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, color: "var(--naia-ink)", letterSpacing: "-1px", marginBottom: "8px" }}>
            {suggestion.outfitName}
          </h1>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--naia-muted)" }}>
            Styled around your mood, your wardrobe, and the way you want to feel.
          </p>
        </div>

        <div className="sm-result-context-grid">
          {(loaderData as any).rev3State ? (
            <>
              <div>
                <p className="sm-result-context-label">Today</p>
                <p className="sm-result-context-value">{REV3_STATE_LABELS[(loaderData as any).rev3State] ?? (loaderData as any).rev3State}</p>
              </div>
              {((loaderData as any).rev3Intentions as string[]).length > 0 && (
                <div>
                  <p className="sm-result-context-label">What you want from the outfit</p>
                  <p className="sm-result-context-value">
                    {((loaderData as any).rev3Intentions as string[]).map((id: string) => REV3_INTENTION_LABELS[id] ?? id).join(" · ")}
                  </p>
                </div>
              )}
              {loaderData.occasion && (
                <div>
                  <p className="sm-result-context-label">Dressing for</p>
                  <p className="sm-result-context-value">{OCCASION_LABELS[loaderData.occasion] ?? loaderData.occasion}</p>
                </div>
              )}
            </>
          ) : (
            <>
              {loaderData.currentMood && (
                <div>
                  <p className="sm-result-context-label">You're Feeling</p>
                  <p className="sm-result-context-value">{MOOD_LABELS[loaderData.currentMood] ?? loaderData.currentMood}</p>
                </div>
              )}
              {loaderData.desiredFeeling && (
                <div>
                  <p className="sm-result-context-label">You Want to Feel</p>
                  <p className="sm-result-context-value">{FEELING_LABELS[loaderData.desiredFeeling] ?? loaderData.desiredFeeling}</p>
                </div>
              )}
              {loaderData.occasion && (
                <div>
                  <p className="sm-result-context-label">Dressing For</p>
                  <p className="sm-result-context-value">{OCCASION_LABELS[loaderData.occasion] ?? loaderData.occasion}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Outfit direction */}
        <div className="sm-result-section">
          <p className="sm-result-section-head">
            {isNoMatch ? "Your Styling Direction" : "Your Outfit Direction"}
          </p>
          {isNoMatch ? (
            <div className="sm-no-match-card">
              <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "17px", lineHeight: 1.7, color: "var(--naia-muted)", margin: 0 }}>
                {suggestion.whyThisWorks}
              </p>
            </div>
          ) : (
            <>
              {loaderData.devTryOnEnabled && suggestionMeta?.primaryHandle && isTryOnEligible(suggestionMeta.primaryHandle) && (
                <button
                  onClick={() => setTryOnPanel({ handle: suggestionMeta!.primaryHandle!, title: suggestion.outfitName || "the look", context: "complete-look" })}
                  className="sm-result-action-btn"
                  style={{ marginBottom: "16px", display: "block" }}
                >
                  Try the complete look
                </button>
              )}
              {suggestion.items?.filter((item: any) => item.itemType !== "SHOES" && item.itemType !== "ACCESSORY" && item.itemType !== "BAG").map((item: any, idx: number) => {
                const isPrimary = idx === 0 && !item.closetItemId;
                const shopUrl = item.productUrl || (item.liveUrl && item.liveUrl !== "https://naiabynadine.com/products/" ? item.liveUrl : null) || (!item.closetItemId ? "https://naiabynadine.com" : null);
                return (
                <div key={item.id} className={`sm-item-card${isPrimary ? " sm-item-card--primary" : ""}`}>
                  {item.closetItemId && (
                    <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--naia-accent)", marginBottom: "8px" }}>Already Yours</p>
                  )}
                  {item.productImageUrl ? (
                    <img src={item.productImageUrl} alt={item.productTitle} className="sm-item-img" />
                  ) : isPrimary ? (
                    <div className="sm-item-img" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", padding: "16px", textAlign: "center" }}>Image coming soon</p>
                    </div>
                  ) : null}
                  {item.productTitle && (
                    <p className="sm-item-product-label">{item.productTitle}</p>
                  )}
                  <p className="sm-item-notes">{item.stylingNotes || item.productTitle}</p>
                  {!item.closetItemId && shopUrl && (
                    <a
                      href={shopUrl}
                      className="sm-result-action-btn"
                      style={{ marginTop: "10px", fontSize: "8px", letterSpacing: "2px", padding: "8px 16px", display: "inline-block" }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Shop This Piece
                    </a>
                  )}
                  {loaderData.devTryOnEnabled && !item.closetItemId && suggestionMeta?.primaryHandle && isTryOnEligible(suggestionMeta.primaryHandle) && (
                    <button
                      onClick={() => setTryOnPanel({ handle: suggestionMeta!.primaryHandle!, title: item.productTitle ?? suggestionMeta!.primaryHandle!, context: "single-piece" })}
                      className="sm-result-action-btn sm-result-action-btn--accent"
                      style={{ marginTop: "10px", fontSize: "8px", letterSpacing: "2px", padding: "8px 16px" }}
                    >
                      Try this piece on
                    </button>
                  )}
                  {loaderData.isAuthenticated && suggestion?.id && loaderData.sessionId && item.shopifyProductId && !item.closetItemId && (
                    <RecommendationFeedbackWidget
                      sessionId={loaderData.sessionId}
                      suggestionId={suggestion.id}
                      target={item.closetItemId ? "closet-item" : "nadine-product"}
                      shopifyProductId={item.shopifyProductId ?? null}
                      closetItemId={item.closetItemId ?? null}
                    />
                  )}
                </div>
              ); })}
              {loaderData.vtoEnabled && suggestionMeta?.primaryHandle && isTryOnEligible(suggestionMeta.primaryHandle) && (
                <VtoExperience
                  source="nadine"
                  productHandle={suggestionMeta.primaryHandle}
                  garmentTitle={suggestion.outfitName || suggestionMeta.primaryHandle}
                  naiaModelIsReady={loaderData.naiaModelIsReady}
                  isAuthenticated={loaderData.isAuthenticated}
                />
              )}
            </>
          )}
        </div>

        {/* Anchor summary — suppressed when the anchor is already rendered in The Look */}
        {!isNoMatch && suggestionMeta?.anchorSummary && !anchorAlreadyInItems && (
          <div className="sm-anchor-card">
            <p className="sm-eyebrow sm-eyebrow--sm sm-eyebrow--muted" style={{ marginBottom: "6px" }}>Anchor Piece</p>
            {suggestionMeta.anchorImageUrl && (
              <img
                src={suggestionMeta.anchorImageUrl}
                alt={suggestionMeta.anchorSummary}
                style={{ width: "100%", maxWidth: "230px", height: "auto", objectFit: "contain", borderRadius: "4px", marginBottom: "10px", background: "var(--naia-warm)" }}
              />
            )}
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "16px", color: "var(--naia-ink)" }}>{suggestionMeta.anchorSummary}</p>
            {suggestionMeta.pairingNote && (
              <p className="sm-anchor-note">{suggestionMeta.pairingNote}</p>
            )}
          </div>
        )}

        {/* Complete the Look — generic wardrobe guidance for missing essential clothing slots */}
        {suggestionMeta?.completionLayer && suggestionMeta.completionLayer.length > 0 && (
          <div className="sm-result-section">
            <p className="sm-result-section-head">Complete the Look</p>
            {(suggestionMeta.completionLayer as Array<{ slot: string; description: string }>).map((piece, i) => (
              <div key={i} className="sm-item-card sm-item-card--secondary">
                <p className="sm-item-type-label">{piece.slot === "top" ? "Top" : "Bottom"}</p>
                <p className="sm-item-notes--secondary">{piece.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Finishing layer — suppresses items in the same slot as the anchor */}
        <div className="sm-result-section">
          <p className="sm-result-section-head">Finishing Layer</p>
          {suggestion.items?.filter((item: any) => {
            if (!["SHOES", "ACCESSORY", "BAG"].includes(item.itemType)) return false;
            const anchorSlot = suggestionMeta?.anchorSlot ?? null;
            if (anchorSlot) {
              const suppress: Record<string, string> = { shoe: "SHOES", bag: "BAG", accessory: "ACCESSORY", jewelry: "ACCESSORY" };
              if (suppress[anchorSlot] === item.itemType) return false;
            }
            return true;
          }).map((item: any) => (
            <div key={item.id} className={`sm-item-card${item.closetItemId ? "" : " sm-item-card--secondary"}`}>
              {item.closetItemId && (
                <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--naia-accent)", marginBottom: "8px" }}>Already Yours</p>
              )}
              {item.closetItemId && item.productImageUrl && (
                <img src={item.productImageUrl} alt={item.productTitle ?? undefined} className="sm-item-img" />
              )}
              <p className="sm-item-type-label">{item.itemType === "BAG" ? "Bag" : item.itemType === "SHOES" ? "Shoes" : "Accessories"}</p>
              {item.closetItemId && item.productTitle && (
                <p className="sm-item-product-label">{item.productTitle}</p>
              )}
              <p className={item.closetItemId ? "sm-item-notes" : "sm-item-notes--secondary"}>{item.stylingNotes}</p>
            </div>
          ))}
          {suggestion.hairstyleRec && (
            <div className="sm-item-card sm-item-card--secondary">
              <p className="sm-item-type-label">Hair</p>
              <p className="sm-item-notes--secondary">{suggestion.hairstyleRec}</p>
            </div>
          )}
          {suggestionMeta?.colourDirection && (
            <div className="sm-item-card sm-item-card--secondary">
              <p className="sm-item-type-label">Colour Direction</p>
              <p className="sm-item-notes--secondary">{suggestionMeta.colourDirection}</p>
            </div>
          )}
        </div>

        {/* Alternatives */}
        {!isNoMatch && suggestionMeta?.alternatives && suggestionMeta.alternatives.length > 0 && (
          <div className="sm-result-section">
            <p className="sm-result-section-head">Also Works</p>
            {suggestionMeta.alternatives.map((alt: any, i: number) => (
              <div key={i} className="sm-alt-card">
                {alt.productImageUrl && (
                  <img
                    src={alt.productImageUrl}
                    alt={alt.title}
                    className="sm-item-img"
                  />
                )}
                <div className="sm-alt-body">
                  <p className="sm-item-product-label">{alt.title}</p>
                  <p className="sm-item-notes--secondary">{alt.stylingNotes}</p>
                  {alt.liveUrl && (
                    <a
                      href={alt.liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sm-alt-shop-cta"
                    >
                      SHOP THIS PIECE
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Rev 3: Result Directions (MOST YOU / FRESH / PUSH ME) ── */}
        {/* Only rendered when computeResultDirections returned directions for this Rev 3 session. */}
        {/* Legacy sessions have no resultDirections in metadata; this section is silently absent. */}
        {suggestionMeta?.resultDirections && suggestionMeta.resultDirections.length > 0 && (
          <div className="sm-result-section">
            <p className="sm-result-section-head">Your Directions</p>
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginBottom: "16px" }}>
              Same session, different angles — choose the direction that fits today.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {suggestionMeta.resultDirections.map((dir) => (
                <div
                  key={dir.label}
                  className="sm-item-card"
                  style={{
                    borderLeft: selectedResultDirection === dir.label
                      ? "3px solid var(--naia-ink)"
                      : "3px solid var(--naia-accent)",
                    paddingLeft: "16px",
                    cursor: "pointer",
                    opacity: selectedResultDirection !== null && selectedResultDirection !== dir.label ? 0.55 : 1,
                  }}
                  role="button"
                  aria-pressed={selectedResultDirection === dir.label}
                  onClick={() => setSelectedResultDirection(prev => prev === dir.label ? null : dir.label)}
                >
                  <p style={{
                    fontFamily: "var(--naia-ff-ui)",
                    fontSize: "10px",
                    letterSpacing: "2px",
                    textTransform: "uppercase",
                    color: "var(--naia-accent)",
                    marginBottom: "4px",
                  }}>
                    {dir.displayLabel}
                  </p>
                  {dir.title && (
                    <p style={{ fontFamily: "var(--naia-ff-display)", fontSize: "18px", fontWeight: 700, color: "var(--naia-ink)", marginBottom: "4px" }}>
                      {dir.title}
                    </p>
                  )}
                  {dir.productImageUrl && (
                    <img
                      src={dir.productImageUrl}
                      alt={dir.title ?? dir.displayLabel}
                      style={{ width: "100%", maxWidth: "160px", height: "auto", objectFit: "contain", borderRadius: "4px", marginBottom: "8px", background: "var(--naia-warm)" }}
                    />
                  )}
                  {dir.outfitPieces && dir.outfitPieces.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                      {dir.outfitPieces.map((piece) => (
                        <div key={piece.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {piece.imageUrl && (
                            <img
                              src={piece.imageUrl}
                              alt={piece.label ?? piece.slot}
                              style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "4px", flexShrink: 0, background: "var(--naia-warm)" }}
                            />
                          )}
                          <span style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", color: "var(--naia-ink)" }}>
                            {piece.label ?? piece.slot}
                          </span>
                          <span style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "var(--naia-accent)", marginLeft: "auto" }}>
                            Already Yours
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginBottom: dir.productUrl ? "10px" : "0" }}>
                    {dir.directionalNote}
                  </p>
                  {dir.productUrl && (
                    <a
                      href={dir.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sm-result-action-btn"
                      style={{ fontSize: "8px", letterSpacing: "2px", padding: "8px 16px", display: "inline-block" }}
                    >
                      SHOP THIS DIRECTION
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Why this works */}
        {suggestion.whyThisWorks && !isNoMatch && (
          <div className="sm-why-block">
            <p className="sm-result-section-head" style={{ borderBottom: "none", marginBottom: "12px" }}>Why This Works</p>
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "16px", lineHeight: 1.8, color: "var(--naia-muted)" }}>
              {suggestion.whyThisWorks}
            </p>
          </div>
        )}

        {/* Sensory layer: perfume / song / makeup */}
        <div className="sm-sensory-grid">
          {suggestion.perfumeRec && (
            <div className="sm-sensory-card">
              <p className="sm-sensory-label">Perfume</p>
              <p className="sm-sensory-value">{suggestion.perfumeRec}</p>
            </div>
          )}
          {suggestion.songRec && (
            <div className="sm-sensory-card">
              <p className="sm-sensory-label">Song</p>
              <p className="sm-sensory-value">{suggestion.songRec}</p>
              {suggestionMeta?.songReason && (
                <p className="sm-sensory-note">{suggestionMeta.songReason}</p>
              )}
            </div>
          )}
          {suggestion.makeupVibeRec && (
            <div className="sm-sensory-card">
              <p className="sm-sensory-label">Makeup</p>
              <p className="sm-sensory-value">{suggestion.makeupVibeRec}</p>
            </div>
          )}
        </div>

        {/* Stylist's Note (internal field: confidenceBoost — semantics changed per Constitution V1) */}
        {suggestion.confidenceBoost && (
          <div className="sm-confidence-block">
            <p className="sm-confidence-label">STYLIST'S NOTE</p>
            <p className="sm-confidence-quote">{suggestion.confidenceBoost}</p>
          </div>
        )}

        {/* ── Style Memory V1 — After you wear this ────────────────────────── */}
        {/* Only shown for authenticated customers with a saved suggestion. No modal, no popup. */}
        {loaderData.isAuthenticated && suggestion.id && (() => {
          const currentSuggestionId = suggestion.id;

          const submitOutcome = () => {
            if (!outcomeStatus) return;
            outcomeFetcher.submit(
              JSON.stringify({
                suggestionId: currentSuggestionId,
                outcomeStatus,
                changeTypes: selectedChangeTypes,
                otherChangeNote: otherChangeNote.trim() || null,
                goalOutcome,
                selectedDirection: selectedResultDirection,
                whatWorked,
                whatFeltOff,
                didntWearReasons,
                reasonOtherNote: reasonOtherNote.trim() || null,
              }),
              { method: "post", action: "/api/styleme-outcome", encType: "application/json" },
            );
          };

          const toggleChangeType = (ct: string) => {
            setSelectedChangeTypes(prev =>
              prev.includes(ct) ? prev.filter(x => x !== ct) : prev.length < 5 ? [...prev, ct] : prev
            );
          };

          const toggleReason = (
            arr: string[],
            setter: Dispatch<SetStateAction<string[]>>,
            id: string,
            max: number,
          ) => {
            setter(prev =>
              prev.includes(id) ? prev.filter(x => x !== id) : prev.length < max ? [...prev, id] : prev
            );
          };

          // Section 0: all selected-button styles use --naia-bg for text (light on dark)
          const selBtnStyle = (active: boolean): CSSProperties => ({
            fontFamily: "var(--naia-ff-ui)",
            fontSize: "10px",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            padding: "8px 14px",
            border: "1px solid",
            borderColor: active ? "var(--naia-ink)" : "rgba(34,21,22,0.2)",
            background: active ? "var(--naia-ink)" : "transparent",
            color: active ? "var(--naia-bg)" : "var(--naia-ink)",
            cursor: "pointer",
            borderRadius: "2px",
          });

          const reasonBtnStyle = (active: boolean, capped: boolean): CSSProperties => ({
            fontFamily: "var(--naia-ff-ui)",
            fontSize: "10px",
            letterSpacing: "1px",
            padding: "6px 10px",
            border: "1px solid",
            borderColor: active ? "var(--naia-ink)" : "rgba(34,21,22,0.15)",
            background: active ? "var(--naia-ink)" : "transparent",
            color: active ? "var(--naia-bg)" : "var(--naia-ink)",
            cursor: "pointer",
            borderRadius: "2px",
            opacity: !active && capped ? 0.4 : 1,
          });

          const changeTypeLabels: Record<string, string> = {
            shoes: "Different shoes",
            top: "Different top",
            bottom: "Different bottom",
            layer: "Layer / outerwear",
            "more-coverage": "More coverage",
            "less-formal": "Dressed it down",
            "more-comfortable": "Made it comfier",
            "different-colour": "Different colour",
            "different-fit": "Different fit",
            other: "Other",
          };

          const whatWorkedLabels: Record<string, string> = {
            "felt-like-me":   "Felt like me",
            "felt-confident": "Felt confident",
            "comfortable":    "Comfortable",
            "got-compliments":"Got compliments",
            "occasion-right": "Right for the occasion",
            "other":          "Other",
          };

          const whatFeltOffLabels: Record<string, string> = {
            "didnt-feel-like-me": "Didn't feel like me",
            "uncomfortable":      "Uncomfortable",
            "fit-issue":          "Fit issue",
            "wrong-colour":       "Wrong colour",
            "too-formal":         "Too formal",
            "too-casual":         "Too casual",
            "other":              "Other",
          };

          const didntWearLabels: Record<string, string> = {
            "weather":            "Weather",
            "plans-changed":      "Plans changed",
            "comfort-concern":    "Comfort concern",
            "style-mood-changed": "Mood changed",
            "not-ready":          "Didn't feel ready",
            "other":              "Other",
          };

          const noteArea = (
            value: string,
            onChange: (v: string) => void,
          ) => (
            <textarea
              maxLength={280}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={2}
              style={{
                marginTop: "10px",
                width: "100%",
                boxSizing: "border-box",
                fontFamily: "var(--naia-ff-body)",
                fontSize: "13px",
                color: "var(--naia-ink)",
                background: "transparent",
                border: "1px solid rgba(34,21,22,0.2)",
                borderRadius: "2px",
                padding: "8px",
                resize: "vertical",
              }}
            />
          );

          const goalLabel = outcomeStatus === "changed-something"
            ? "Did the look give you what you wanted after the change?"
            : "Did the look give you what you wanted today?";

          const workedQuestion = outcomeStatus === "changed-something"
            ? "What worked after the change? (up to 3)"
            : "What worked? (up to 3)";

          const feltOffQuestion = outcomeStatus === "changed-something"
            ? "What still felt off? (up to 3)"
            : "What felt off? (up to 3)";

          const submitDisabled =
            outcomeFetcher.state === "submitting" ||
            !outcomeStatus ||
            (outcomeStatus === "changed-something" && selectedChangeTypes.length === 0) ||
            (outcomeStatus === "didnt-wear-it" && didntWearReasons.length === 0);

          if (outcomeSaved && outcomeFetcher.state === "idle" && !isOutcomeEditing) {
            return (
              <div style={{ borderTop: "1px solid rgba(34,21,22,0.08)", paddingTop: "20px", marginTop: "8px" }}>
                <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--naia-muted)", marginBottom: "4px" }}>
                  After you wear this
                </p>
                <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", color: "var(--naia-ink)", marginBottom: "6px" }}>
                  Noted.
                </p>
                <button
                  type="button"
                  onClick={() => setIsOutcomeEditing(true)}
                  style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", background: "none", border: "none", color: "var(--naia-muted)", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                >
                  Edit
                </button>
              </div>
            );
          }

          return (
            <div style={{ borderTop: "1px solid rgba(34,21,22,0.08)", paddingTop: "20px", marginTop: "8px" }}>
              <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--naia-muted)", marginBottom: "16px" }}>
                After you wear this
              </p>
              <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", color: "var(--naia-ink)", marginBottom: "12px" }}>
                What happened with this look?
              </p>

              {/* Section 1 — top-level status */}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
                {(["wore-it", "changed-something", "didnt-wear-it"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setOutcomeStatus(s);
                      // Clear incompatible stale fields
                      if (s === "wore-it") {
                        setSelectedChangeTypes([]);
                        setOtherChangeNote("");
                        setDidntWearReasons([]);
                        setReasonOtherNote("");
                      }
                      if (s === "changed-something") {
                        setDidntWearReasons([]);
                        setReasonOtherNote("");
                      }
                      if (s === "didnt-wear-it") {
                        setSelectedChangeTypes([]);
                        setOtherChangeNote("");
                        setGoalOutcome(null);
                        setWhatWorked([]);
                        setWhatFeltOff([]);
                        setReasonOtherNote("");
                      }
                    }}
                    style={selBtnStyle(outcomeStatus === s)}
                  >
                    {s === "wore-it" ? "Wore it" : s === "changed-something" ? "Changed something" : "Didn't wear it"}
                  </button>
                ))}
              </div>

              {/* Section 3 — CHANGED SOMETHING: change types */}
              {outcomeStatus === "changed-something" && (
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                    How did you change the look? (up to 5)
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {Object.entries(changeTypeLabels).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleChangeType(id)}
                        style={reasonBtnStyle(selectedChangeTypes.includes(id), !selectedChangeTypes.includes(id) && selectedChangeTypes.length >= 5)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {selectedChangeTypes.includes("other") && noteArea(otherChangeNote, setOtherChangeNote)}
                </div>
              )}

              {/* Section 4 — DIDN'T WEAR IT: what got in the way */}
              {outcomeStatus === "didnt-wear-it" && (
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                    What got in the way? (up to 3)
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {Object.entries(didntWearLabels).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleReason(didntWearReasons, setDidntWearReasons, id, 3)}
                        style={reasonBtnStyle(didntWearReasons.includes(id), !didntWearReasons.includes(id) && didntWearReasons.length >= 3)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {didntWearReasons.includes("other") && noteArea(reasonOtherNote, setReasonOtherNote)}
                </div>
              )}

              {/* Sections 2 & 3 — goalOutcome (wore-it or changed-something) */}
              {(outcomeStatus === "wore-it" || outcomeStatus === "changed-something") && (
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                    {goalLabel}
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {(["yes", "somewhat", "no"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          const next = goalOutcome === g ? null : g;
                          setGoalOutcome(next);
                          // Clear incompatible reason arrays
                          if (next === "yes") { setWhatFeltOff([]); setReasonOtherNote(""); }
                          if (next === "somewhat" || next === "no") { setWhatWorked([]); setReasonOtherNote(""); }
                          if (next === null) { setWhatWorked([]); setWhatFeltOff([]); setReasonOtherNote(""); }
                        }}
                        style={selBtnStyle(goalOutcome === g)}
                      >
                        {g === "yes" ? "Yes" : g === "somewhat" ? "Somewhat" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2 — whatWorked (goalOutcome === yes) */}
              {(outcomeStatus === "wore-it" || outcomeStatus === "changed-something") && goalOutcome === "yes" && (
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                    {workedQuestion}
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {Object.entries(whatWorkedLabels).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleReason(whatWorked, setWhatWorked, id, 3)}
                        style={reasonBtnStyle(whatWorked.includes(id), !whatWorked.includes(id) && whatWorked.length >= 3)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {whatWorked.includes("other") && noteArea(reasonOtherNote, setReasonOtherNote)}
                </div>
              )}

              {/* Section 2 — whatFeltOff (goalOutcome === somewhat or no) */}
              {(outcomeStatus === "wore-it" || outcomeStatus === "changed-something") && (goalOutcome === "somewhat" || goalOutcome === "no") && (
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                    {feltOffQuestion}
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {Object.entries(whatFeltOffLabels).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleReason(whatFeltOff, setWhatFeltOff, id, 3)}
                        style={reasonBtnStyle(whatFeltOff.includes(id), !whatFeltOff.includes(id) && whatFeltOff.length >= 3)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {whatFeltOff.includes("other") && noteArea(reasonOtherNote, setReasonOtherNote)}
                </div>
              )}

              {/* Submit / Cancel row */}
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {outcomeStatus && (
                  <button
                    type="button"
                    onClick={submitOutcome}
                    disabled={submitDisabled}
                    style={{
                      fontFamily: "var(--naia-ff-ui)",
                      fontSize: "10px",
                      letterSpacing: "2px",
                      textTransform: "uppercase",
                      padding: "10px 20px",
                      border: "1px solid var(--naia-ink)",
                      background: "transparent",
                      color: "var(--naia-ink)",
                      cursor: submitDisabled ? "not-allowed" : "pointer",
                      opacity: submitDisabled ? 0.4 : 1,
                      borderRadius: "2px",
                    }}
                  >
                    {outcomeFetcher.state === "submitting" ? "Saving…" : "Save"}
                  </button>
                )}
                {isOutcomeEditing && outcomeSaved && (
                  <button
                    type="button"
                    onClick={() => setIsOutcomeEditing(false)}
                    style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", background: "none", border: "none", color: "var(--naia-muted)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {outcomeFetcher.data?.error && (
                <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", color: "var(--naia-burg, #8b2035)", marginTop: "8px" }}>
                  Something went wrong. Please try again.
                </p>
              )}
            </div>
          );
        })()}

        {/* "See This Look On Me" section — always shown for eligible NADINE results */}
        {showTryOnSection && (
          <div className="sm-result-section" style={{ borderTop: "1px solid rgba(34,21,22,0.12)", paddingTop: "24px" }}>
            <p className="sm-result-section-head" style={{ borderBottom: "none", marginBottom: "12px" }}>See This Look On Me</p>
            {tryOnModelReady ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)" }}>
                  Your nAia Model is ready. Virtual try-on will be available in a future update.
                </p>
                <Link to="/my-naia-model" className="sm-result-action-btn" style={{ alignSelf: "flex-start" }}>
                  View My nAia Model
                </Link>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", color: "var(--naia-muted)" }}>
                  Set up your nAia Model to preview eligible NADINE pieces on your own silhouette. This is not a generated try-on — it requires uploading your own photograph first.
                </p>
                <Link to="/my-naia-model" className="sm-result-action-btn" style={{ alignSelf: "flex-start" }}>
                  Set Up nAia Model
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="sm-result-actions">
          <Form method="post">
            <input type="hidden" name="intent" value="start-over" />
            <button type="submit" className="sm-result-action-btn">Start Over</button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="adjust-vibe" />
            <button type="submit" className="sm-result-action-btn">Adjust Vibe</button>
          </Form>
          <button
            type="button"
            disabled={generateFetcher.state !== "idle"}
            onClick={() => {
              const sid = (suggestion as any)?.sessionId ?? loaderData.sessionId;
              if (!sid) return;
              generateFetcher.submit({ intent: "regenerate", sessionId: sid }, { method: "post" });
            }}
            className="sm-result-action-btn sm-result-action-btn--primary"
          >
            {generateFetcher.state !== "idle" ? "Finding your look…" : "New Look, Same Vibe"}
          </button>
          {suggestionMeta?.outcome !== "closet-led" && (
            <a href={primaryNaiaItem?.productUrl || "https://naiabynadine.com"} className="sm-result-action-btn">Shop nAia</a>
          )}
        </div>

      </main>

      {/* ── TryOn panel (dev only) ── */}
      {loaderData.devTryOnEnabled && (
        <TryOnPanel
          open={!!tryOnPanel}
          onClose={() => setTryOnPanel(null)}
          handle={tryOnPanel?.handle ?? null}
          garmentTitle={tryOnPanel?.title ?? null}
          context={tryOnPanel?.context ?? "single-piece"}
          naiaModelIsReady={loaderData.naiaModelIsReady}
          fixtureResults={loaderData.tryOnFixtureTokens}
          devMode={true}
          sessionId={loaderData.sessionId ?? null}
          suggestionId={suggestion?.id ?? null}
        />
      )}
    </div>
  );
}
