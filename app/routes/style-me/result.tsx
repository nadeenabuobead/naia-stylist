// app/routes/style-me/result.tsx
import { Form, Link, useLoaderData, useFetcher } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type ActionFunctionArgs, type ShouldRevalidateFunctionArgs, type LinksFunction } from "react-router";
import { useState, useEffect, useRef } from "react";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  STYLEME_STATE_LABELS,
  STYLEME_INTENTION_LABELS,
  translateIntentionsToEngineSignals,
} from "~/lib/styleme/session-vocabulary";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
} from "~/lib/cloudinary-admin.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { prisma } from "~/lib/prisma.server";
import { getSession, commitSession, clearStyleMeSession, parseClosetCompanionIds } from "~/lib/session.server";
import { CANONICAL_STYLEME_ENTRY } from "~/lib/styleme/handoff";
import { readPendingSave, writePendingSave, clearPendingSave } from "~/lib/pending-save.server";
import {
  buildEngineInput,
  buildProfileSignals,
  computeStyleMeResult,
  buildDbPayload,
  styleSourceToSessionSource,
  resolveRegenCompanionIds,
} from "~/lib/ai/styleme-result.server";
import { autoSelectClosetAnchor, resolveActionAnchor, resolveClosetAnchor, loadAllClosetItemsForEngine } from "~/lib/ai/styleme-anchor.server";
import { parseSuggestionMetadata } from "~/lib/ai/styleme-result.types";
import { resolveItemImage } from "~/lib/styleme/look-image-resolution.server";
import { resolveStyleMeMode } from "~/lib/styleme/mode-resolution";
import { occasionDisplayFor } from "~/lib/styleme/occasion-display";
import { resolveResultSuggestionSelector } from "~/lib/styleme/history-saved-durability";
import {
  NO_NADINE_HERO_NOTE,
  shouldExplainNoNadineHero,
} from "~/lib/styleme/nadine-fallback-note";
import {
  resolveCommerceCtaHref,
  resolveCommerceCtaLabel,
} from "~/lib/styleme/commerce-cta";
import { issueImageToken } from "~/lib/dev-tryon-image-tokens.server";
import { isTryOnEligible } from "~/lib/ai/tryon-product-eligibility";
import { TryOnPanel } from "~/components/TryOnPanel";
import { VtoExperience } from "~/components/VtoExperience";
import { RecommendationFeedbackWidget } from "~/components/RecommendationFeedbackWidget";
import { loadSessionFeedback } from "~/lib/ai/feedback-persistence.server";
import { loadOutcomeForSuggestion } from "~/lib/ai/outcome-persistence.server";
import type { Prisma } from "@prisma/client";
import { reserveStyleMeSlot } from "~/lib/plan/entitlement.server";
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
  const isStagingProject = process.env.NAIA_PROJECT_VARIANT === "staging";
  // Deliberately NOT the same flag as isStagingProject: staging now also hosts live
  // customer-facing acceptance checks (2026-10-21), so "is this staging" no longer implies
  // "is this an internal QA session" the way it used to. A dedicated, explicit, server-
  // gated flag (same pattern as devTryOnEnabled/vtoEnabled above) — never a client-side
  // toggle, and off by default everywhere, including on the staging deployment, unless
  // someone with the ability to set environment variables there turns it on deliberately.
  const qaExportEnabled = process.env.STYLEME_QA_EXPORT_ENABLED === "true";
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    // Optional: pins the load to one specific historical suggestion within the
    // session (e.g. an older saved look that isn't the session's latest
    // suggestion). Absent -> existing behavior, unchanged: latest suggestion.
    const requestedSuggestionId = url.searchParams.get("suggestionId");

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
            isStagingProject,
            qaExportEnabled,
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
        include: {
          suggestions: {
            include: {
              items: {
                include: {
                  // Closet item fields needed for fresh signed-URL resolution on historical loads.
                  // productImageUrl stored at generation time may be an expired signed URL.
                  closetItem: { select: { imageUrl: true, imagePublicId: true, imageFormat: true } },
                },
              },
            },
            // resolveResultSuggestionSelector nests under this session's own
            // `suggestions` relation (never a standalone top-level suggestion
            // lookup), so requestedSuggestionId can only ever match a suggestion
            // that belongs to this exact session — already ownership-checked
            // below against sessionId. A foreign-session or foreign-customer id,
            // or a nonexistent/stale one, simply matches nothing here and falls
            // through to the existing empty-suggestions shape, same as any miss.
            ...resolveResultSuggestionSelector(requestedSuggestionId),
          },
        },
      });
      if (!session || session.customerId !== naiaCustomer.id) {
        return data(
          {
            isLoading: false,
            isAuthenticated: true,
            naiaModelIsReady: false,
            devTryOnEnabled,
            vtoEnabled,
            isStagingProject,
            qaExportEnabled,
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

      // Hydrate closet item images with fresh signed URLs for historical loads.
      // productImageUrl stored at generation time can be an expired Cloudinary signed URL.
      // Priority: 1) fresh private signed URL (imagePublicId+imageFormat), 2) legacy imageUrl, 3) persisted productImageUrl.
      const cloudinaryConfig = getCloudinaryConfig();
      const rawSuggestion = session.suggestions[0] ?? null;

      // The anchor-piece image is a separate case from the items above: it's
      // not a DB column on OutfitSuggestionItem, it's baked into the
      // moodDescription metadata JSON at generation time as anchorImageUrl —
      // a Cloudinary private signed URL (buildPrivateDownloadUrl, 10-minute
      // expiry). Any session viewed after that window shows a broken <img>
      // for a closet-type anchor otherwise. Re-resolve it fresh from the
      // closet item's current image fields (metadata.anchor.id is already
      // persisted alongside the stale URL for exactly this) using the same
      // priority as the items above; null — not the stale URL — if the item
      // or its image no longer exists, so the page's existing
      // `{anchorImageUrl && <img>}` guard omits the image instead of
      // rendering a broken one. A "nadine" anchor has no closetItemId and
      // is untouched — its image is a stable catalog URL, not a signed one.
      let hydratedMoodDescription = rawSuggestion?.moodDescription ?? null;
      if (rawSuggestion) {
        const anchorMeta = parseSuggestionMetadata(rawSuggestion.moodDescription);
        if (anchorMeta?.anchor?.type === "closet" && anchorMeta.anchor.id) {
          const anchorItem = await prisma.closetItem.findUnique({
            where: { id: anchorMeta.anchor.id, customerId: session.customerId },
            select: { imageUrl: true, imagePublicId: true, imageFormat: true },
          });
          // Same canonical resolver Overview/StyleMe-history use for every
          // other garment image (resolveItemImage) — not a second,
          // hand-rolled copy of the ownership+signed-URL logic.
          const freshAnchorImageUrl = resolveItemImage(
            { closetItemId: anchorMeta.anchor.id, productImageUrl: null, closetItem: anchorItem },
            { customerId: session.customerId, cloudinaryConfig },
          );
          if (freshAnchorImageUrl !== anchorMeta.anchorImageUrl) {
            hydratedMoodDescription = JSON.stringify({ ...anchorMeta, anchorImageUrl: freshAnchorImageUrl });
          }
        }
      }

      const hydratedSuggestion = rawSuggestion
        ? {
            ...rawSuggestion,
            moodDescription: hydratedMoodDescription,
            items: rawSuggestion.items.map((item) => {
              if (item.closetItemId && item.closetItem) {
                const ci = item.closetItem;
                if (ci.imagePublicId && ci.imageFormat && cloudinaryConfig) {
                  const ownership = validatePublicIdOwnership(ci.imagePublicId, session.customerId);
                  if (ownership.ok) {
                    return {
                      ...item,
                      productImageUrl: buildPrivateDownloadUrl(
                        cloudinaryConfig, ci.imagePublicId, ci.imageFormat, "private",
                      ),
                    };
                  }
                }
                if (ci.imageUrl) return { ...item, productImageUrl: ci.imageUrl };
              }
              return item;
            }),
          }
        : null;

      return data({
        isLoading: false,
        isAuthenticated: !!naiaCustomer,
        naiaModelIsReady,
        devTryOnEnabled,
        vtoEnabled,
        isStagingProject,
        qaExportEnabled,
        tryOnFixtureTokens,
        sessionId: session.id,
        mood: session.currentMood,
        currentMood: session.currentMood,
        occasion: session.occasion,
        desiredFeeling: session.desiredFeeling,
        rev3State: session.state ?? null,
        rev3Intentions: session.intentions ?? [],
        suggestion: hydratedSuggestion,
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
        isStagingProject,
        qaExportEnabled,
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
    // Who chose the anchor. source.tsx records this at both write sites, because
    // styleMeAnchorMode is unset immediately after a manual pick and by this point the two
    // flows would otherwise be indistinguishable. Anything unrecognised is treated as
    // MANUAL — see the regenerate branch.
    const rawProvenance = cookieSession.get("styleMeAnchorProvenance") as string | undefined;
    const anchorProvenance: "AUTO" | "MANUAL" | null =
      rawProvenance === "AUTO" ? "AUTO" : rawProvenance === "MANUAL" ? "MANUAL" : null;

    const isRev3Session = !!rev3State;

    if (isRev3Session) {
      // Rev 3 path: need bodyNeeds + occasion + source (moods/feelings derived from intentions)
      if (!bodyNeeds || !bodyNeeds.length || !occasion || !source) {
        return redirect("/style-me/state");
      }
    } else {
      // Legacy path
      if (!mood || !mood.length || !feelings || !feelings.length || !bodyNeeds || !bodyNeeds.length || !occasion || !source) {
        // Incomplete legacy session — restart at the canonical Rev 3 entry.
        return redirect(CANONICAL_STYLEME_ENTRY);
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

    // The old non-atomic guard here (checkEntitlement, gated on `naiaCustomer`
    // truthy) is superseded below by reserveStyleMeSlot — same quota rule,
    // but atomic AND guest-inclusive (see that block's own comment for why
    // the old `isEnforced && naiaCustomer` gate let a guest through
    // unlimited). Removed rather than kept alongside, to avoid two
    // independent StyleMe-quota code paths disagreeing with each other.

    // If this session was started via Adjust Vibe, the source session ID was stored
    // in the cookie by the adjust-vibe action. We link it here so the new session
    // is marked as a continuation and excluded from StyleMe quota counts.
    const adjustVibeSourceId = (cookieSession.get("styleMeAdjustVibeSourceId") as string | undefined) ?? null;
    if (adjustVibeSourceId) cookieSession.unset("styleMeAdjustVibeSourceId");

    // Adjust Vibe skips the source step, which is the only place that stamps the product
    // context — so a continuation inherits it from the session it continues rather than
    // relying on the cookie having survived.
    const parentMode = adjustVibeSourceId
      ? (await prisma.stylingSession.findUnique({
          where: { id: adjustVibeSourceId },
          select: { styleMeMode: true },
        }))?.styleMeMode ?? null
      : null;
    const sessionStyleMeMode = resolveStyleMeMode(parentMode, cookieSession.get("styleMeMode"));

    const moodFirst = mood ?? null;
    // Built as a variable (not inline in the create() call) so the SAME
    // data shape can also be passed into reserveStyleMeSlot's atomic
    // count-and-create transaction below. Includes every field HEAD's own
    // inline create() was writing (anchorProvenance, styleMeMode) — the
    // atomic-reservation commit this was merged from predates those two
    // fields, so its own sessionData needed both added, not just the
    // subset it originally had.
    const sessionData: Prisma.StylingSessionUncheckedCreateInput = {
      customerId: resolvedCustomerId,
      currentMood: moodFirst,
      desiredFeeling: feelings?.[0] || null,
      occasion,
      bodyNeeds: bodyNeeds ?? [],
      formalityConditional,
      practicalIds,
      styleFrom: source === "my-closet" ? "CLOSET" : source === "naia-piece" ? "NAIA" : "BOTH",
      closetAnchorId: (source === "my-closet" || source === "both") ? (closetAnchorId ?? null) : null,
      anchorProvenance: (source === "my-closet" || source === "both") ? anchorProvenance : null,
      parentSessionId: adjustVibeSourceId,
      styleMeMode: sessionStyleMeMode,
      // Rev 3 — Psychology-First (Group 5). Wording context only; zero product scoring.
      ...(isRev3Session && {
        state: rev3State,
        intentions: rev3Intentions,
      }),
    };

    // Quota guard — behind ENTITLEMENT_ENFORCEMENT flag; disabled in production until
    // billing and upgrade flow exist. Applies to guests too: an unauthenticated
    // visitor is treated as membershipStatus NONE (0 allowance), the same tier a
    // real signed-up non-member gets — previously this guard only ran `&& naiaCustomer`,
    // so a guest fell straight through to the create below with no limit at all,
    // the one path in this codebase where the shared guest row was allowed to
    // consume a paid-feature write unlimited times. Atomic: the count re-check and
    // the create happen inside one Serializable transaction (reserveStyleMeSlot),
    // so two concurrent requests from the same customer can't both pass the count
    // before either commits — mirrors VTO's existing createOrFindTryOnJob.
    const isEnforced = process.env.ENTITLEMENT_ENFORCEMENT === "true";
    let stylingSession;
    if (isEnforced) {
      const membershipStatusForCheck = naiaCustomer?.membershipStatus ?? "NONE";
      const reservation = await reserveStyleMeSlot(resolvedCustomerId, membershipStatusForCheck, sessionData);
      if (!reservation.allowed) {
        return data(
          { isLoading: false, isAuthenticated: !!naiaCustomer, naiaModelIsReady, devTryOnEnabled, vtoEnabled,
            isStagingProject,
            qaExportEnabled,
            tryOnFixtureTokens: {} as Record<string, string>, sessionId: null, mood: null,
            currentMood: null, desiredFeeling: null, occasion: null, suggestion: null,
            pendingState: null as "needs_passport" | "ready_to_save" | null,
            existingOutfitFeedback: null, existingOutcome: null,
            error: naiaCustomer
              ? "You've used all your StyleMe sessions for this month."
              : "Sign in or join nAia to start styling." },
          { status: 429 },
        );
      }
      stylingSession = reservation.record;
    } else {
      stylingSession = await prisma.stylingSession.create({ data: sessionData });
    }

    return data(
      {
        isLoading: true,
        isAuthenticated: !!naiaCustomer,
        naiaModelIsReady,
        isStagingProject,
        qaExportEnabled,
        sessionId: stylingSession.id,
        mood: moodFirst,
        currentMood: moodFirst,
        moods: mood ? [mood] : [],
        desiredFeelings: feelings ?? [],
        desiredFeeling: feelings?.[0] || null,
        occasion,
        // Presentation only — the wording she read at the occasion step, so the result can
        // echo her own phrasing instead of a label written against the canonical ID. Absent
        // on reload and on a saved look (StylingSession has no column for it), where
        // occasionDisplayFor falls back to the questionnaire label for the canonical answer.
        occasionDisplayLabel: (cookieSession.get("styleMeOccasionDisplayLabel") as string | undefined) ?? null,
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
    return data({ isLoading: false, isAuthenticated: false, naiaModelIsReady: false, devTryOnEnabled, vtoEnabled, isStagingProject, qaExportEnabled, tryOnFixtureTokens: {} as Record<string, string>, sessionId: null, mood: null, currentMood: null, desiredFeeling: null, occasion: null, suggestion: null, pendingState: null as "needs_passport" | "ready_to_save" | null, existingOutfitFeedback: null, existingOutcome: null, error: err?.message || "Something went wrong" });
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
      // styleMeAdjustVibeSourceId carries the originating session ID so the new
      // StylingSession created on return is linked via parentSessionId (quota continuations).
      const cookieSession = await getSession(request.headers.get("Cookie"));
      cookieSession.set("styleMeAdjustVibe", "true");
      if (sessionId) cookieSession.set("styleMeAdjustVibeSourceId", sessionId);
      // Adjust Vibe always re-asks through the canonical Rev 3 questionnaire,
      // including for a legacy session — the old questionnaire is retired.
      return redirect(CANONICAL_STYLEME_ENTRY, {
        headers: { "Set-Cookie": await commitSession(cookieSession) },
      });
    }

    if (intent === "generate") {
      const session = await prisma.stylingSession.findUnique({ where: { id: sessionId } });
      if (!session) return data({ error: "Session not found" }, { status: 404 });
      // Ownership (2026-10-21) — StylingSession.customerId is a required field
      // (every session has a real owner, never anonymous), so this must always
      // match the authenticated customer. Without this, a client-supplied
      // sessionId could generate a new OutfitSuggestion against ANOTHER
      // customer's session — same class of bug as the review/regenerate fixes
      // below. "Not found" (not 403) matches this route's existing convention
      // elsewhere so a mismatched ID doesn't confirm the session exists.
      if (!naiaCustomer || session.customerId !== naiaCustomer.id) {
        return data({ error: "Session not found" }, { status: 404 });
      }

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

      // Translate intention IDs to canonical engine signals.
      // The engine never sees a raw intention ID — only canonical DFM/SMCM/PSM tokens.
      // The mapping itself lives in app/lib/styleme/session-vocabulary.ts so that
      // "New Look, Same Vibe" can apply the identical translation; see the regenerate
      // branch below. It used to be inline here and regeneration silently lost it.
      const translated = translateIntentionsToEngineSignals(rev3IntentionsAction);
      const translatedDesiredFeelings = translated.desiredFeelings;
      const translatedSmcmIds = translated.bodyNeeds;
      const translatedPracticalIds = translated.practicalIds;
      const translatedMoods = translated.moods;

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
      // Record first, cookie second. The StylingSession was stamped at creation, so a
      // generation on an expired cookie keeps the context it started in.
      const styleMeMode = resolveStyleMeMode(session.styleMeMode, cookieSession.get("styleMeMode"));
      const occasionDisplayLabel = (cookieSession.get("styleMeOccasionDisplayLabel") as string | undefined) ?? null;
      // See StyleMeEngineInput.closetCompanionIds. Read directly from the cookie, same as
      // styleMeMode/occasionDisplayLabel above — companions are fixed at the WI handoff and
      // never change mid-questionnaire, so no form-field roundtrip is needed. A malformed
      // value fails closed to an empty list rather than ever throwing mid-generation.
      const closetCompanionIds = parseClosetCompanionIds(cookieSession.get("styleMeClosetCompanionIds"));

      const engineInput = buildEngineInput({
        moods,
        desiredFeelings,
        bodyNeeds: effectiveBodyNeeds,
        coverageConditional: null,
        occasion: session.occasion ?? "everyday",
        occasionDisplayLabel,
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
        // Finishing/presentation context only — zero engine scoring.
        gender: naiaCustomer?.onboardingProfile?.gender ?? null,
        closetCompanionIds,
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
      const dbPayload = buildDbPayload(styleResult, session.occasion ?? "everyday");

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
      // Ownership (2026-10-21, tightened): the previous `naiaCustomer &&` guard
      // skipped this check entirely for an UNAUTHENTICATED request, since
      // StylingSession.customerId is a required field (no genuine anonymous
      // session exists) — an unauthenticated caller could regenerate another
      // customer's session. Now requires naiaCustomer to be present too.
      if (!naiaCustomer || session.customerId !== naiaCustomer.id) {
        return data({ error: "Not found" }, { status: 404 });
      }

      const sessionSource = styleSourceToSessionSource(session.styleFrom);
      const anchorResult = await resolveActionAnchor(sessionSource, session.customerId, null, session.closetAnchorId ?? null);
      if (!anchorResult.ok) {
        return data({ error: anchorResult.message }, { status: anchorResult.status });
      }
      // The reroll anchor is resolved further down, once the previous outfit is known —
      // see "New Look needs a fresh structural centre". This call stays so an invalid or
      // inaccessible session anchor still fails here, exactly as before.
      let regenAnchor = anchorResult.anchor;

      let journeyCtx = null;
      if (naiaCustomer) {
        try { journeyCtx = await buildCustomerJourneyContext(naiaCustomer.id); } catch { /* graceful */ }
      }

      const regenCookieSession = await getSession(request.headers.get("Cookie"));
      // New Look must not change product context. The session record is authoritative; the
      // cookie is only a fallback for sessions written before the column existed.
      const regenMode = resolveStyleMeMode(session.styleMeMode, regenCookieSession.get("styleMeMode"));
      const regenOccasionDisplayLabel = (regenCookieSession.get("styleMeOccasionDisplayLabel") as string | undefined) ?? null;
      // Collect handles from the most-recent suggestion so the engine applies a
      // diversity penalty and avoids returning the exact same outfit.
      const prevSuggestion = await prisma.outfitSuggestion.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: {
          moodDescription: true,
          items: { select: { closetItemId: true, itemType: true } },
        },
      });
      const prevMeta = prevSuggestion ? parseSuggestionMetadata(prevSuggestion.moodDescription) : null;

      // ── Required WI companions: recover from the DURABLE record, not the cookie ──
      //
      // Unlike the anchor (session.closetAnchorId, a real DB column read above, so New Look
      // already survives an expired cookie or a different device for the anchor), companions
      // had no persisted column — a regenerate on an expired/cleared cookie, or a different
      // device, resolved the correct anchor from the DB but silently styled around it alone,
      // dropping the companions the customer originally selected.
      //
      // Fix: StyleMeMetadata.companionIds (see styleme-result.types.ts) is a versioned JSON
      // field already stored in moodDescription for every OTHER piece of regeneration
      // context (resultDirections, sameCombination, mode) — no schema change. Every
      // suggestion generated FROM NOW ON carries an explicit companionIds (even "[]"), so
      // prevMeta.companionIds is the durable, cross-device-safe source of truth once it
      // exists. undefined (the key itself absent) means this suggestion predates the fix —
      // the one case with no durable record — and falls back to the cookie exactly as
      // before, which is the correct, non-regressive default for the overwhelmingly common
      // case of a suggestion that genuinely never had companions.
      //
      // Deliberately NOT inferred from prevSuggestion.items: that list also contains
      // auto-recommended pieces chosen by selectAdditionalClosetGarments, indistinguishable
      // by shape from a required companion — exactly the ambiguity this field exists to avoid.
      // Ownership re-verification is the only DB-dependent step (resolveClosetAnchor); the
      // decision itself is pure — see resolveRegenCompanionIds' own unit tests for the direct,
      // database-free proof of this exact branching, including the multi-id fail-closed case.
      const ownershipResults = prevMeta?.companionIds !== undefined
        ? await Promise.all(prevMeta.companionIds.map((id) => resolveClosetAnchor(session.customerId, id)))
        : [];
      const companionRecovery = resolveRegenCompanionIds(
        prevMeta?.companionIds,
        ownershipResults.map((r) => r !== null),
        parseClosetCompanionIds(regenCookieSession.get("styleMeClosetCompanionIds")),
      );

      if (companionRecovery.blocked) {
        return data({
          companionRecoveryBlocked: true,
          companionRecoveryMessage:
            "One or more pieces from your original combination are no longer in your Closet, so New Look can't recreate it completely. Your current look is unchanged — go to Wardrobe Intelligence to choose a combination again, or pick a piece manually.",
        });
      }
      const regenClosetCompanionIds = companionRecovery.companionIds;

      // NADINE mode: penalise previously shown product handles so the engine picks a different primary.
      const recentlyShownHandles: string[] = [];
      if (prevMeta?.primaryHandle) recentlyShownHandles.push(prevMeta.primaryHandle);
      if (prevMeta?.alternatives) {
        for (const alt of prevMeta.alternatives) {
          if (alt.handle && !recentlyShownHandles.includes(alt.handle)) {
            recentlyShownHandles.push(alt.handle);
          }
        }
      }

      // nAia mode: collect closet item IDs from the actual persisted outfit items of the previous
      // suggestion so selectAdditionalClosetGarments prefers items the customer has not yet seen.
      // Previously this read from resultDirections[0].outfitPieces, which may differ from the
      // displayed outfit — fixed to use the authoritative persisted items.
      const recentlyShownClosetIds: string[] = [];
      if (prevSuggestion?.items) {
        for (const item of prevSuggestion.items) {
          if (item.closetItemId) recentlyShownClosetIds.push(item.closetItemId);
        }
      }
      // Gap 3: full closet-ID set from previous persisted outfit for exact combination comparison.
      // Includes the anchor; used by computeStyleMeResult to detect duplicate New Look results.
      const prevOutfitClosetIds = recentlyShownClosetIds.length > 0 ? recentlyShownClosetIds : undefined;

      // ── Same Vibe means the same request ──────────────────────────────────
      // Regeneration rebuilds engine input from the StylingSession row. In a Rev 3
      // session currentMood and desiredFeeling are stored as null — there is no mood
      // or feeling step — and the intention translation was never persisted, so this
      // branch used to pass moods: [] and desiredFeelings: [] and drop the SMCM and
      // practical tokens too. The customer pressed "New Look, Same Vibe" and received
      // a look built from a materially different brief.
      //
      // The translation is pure, and StylingSession.intentions IS stored, so it is
      // recomputed here through the same function the generate branch uses. Occasion,
      // formality, body needs, practical IDs and the anchor already came from the row.
      const regenTranslated = translateIntentionsToEngineSignals(session.intentions ?? []);
      const regenIsRev3 = !!session.state;

      const regenMoods = regenIsRev3
        ? regenTranslated.moods
        : (session.currentMood ? [session.currentMood] : []);
      const regenDesiredFeelings = regenIsRev3
        ? regenTranslated.desiredFeelings
        : (session.desiredFeeling ? [session.desiredFeeling] : []);
      const regenBodyNeeds = regenIsRev3
        ? [...(session.bodyNeeds ?? []), ...regenTranslated.bodyNeeds]
        : (session.bodyNeeds ?? []);
      const regenPracticalIds = regenIsRev3
        ? [...(session.practicalIds ?? []), ...regenTranslated.practicalIds]
        : (session.practicalIds ?? []);

      // ── New Look needs a fresh structural centre ──────────────────────────
      //
      // The anchor was chosen once at the source step and persisted as
      // StylingSession.closetAnchorId, so every reroll rebuilt on the SAME garment. The
      // anchor appears in every candidate, so the core could barely move and a reroll could
      // only vary finishing pieces — the dominant cause of "New Look" returning the same
      // look.
      //
      // For regenerate only, automatic selection runs again with the previous outfit's ids
      // as a fail-open diversity preference. Fail-open end to end: if no equally-correct
      // alternative anchor exists, autoSelectClosetAnchor returns the same garment and
      // behaviour is unchanged; if it returns nothing at all, the session anchor is kept.
      //
      // StylingSession.closetAnchorId is NOT written here. The persisted brief — occasion,
      // formality, intentions, body needs, anchor — stays exactly as the customer submitted
      // it; the fresher anchor applies to THIS generated result only.
      //
      // PROVENANCE GATE. Only a garment nAia chose may be moved. When the customer picked it
      // — Style This Piece, or a manual closet selection — that garment is part of the
      // brief, not a starting point, and New Look varies the outfit AROUND it instead.
      // null means a session created before provenance was recorded, and is read as MANUAL:
      // keeping a garment that did not need keeping is a far smaller failure than silently
      // replacing one the customer asked to style.
      const anchorIsAuto = session.anchorProvenance === "AUTO";
      if (anchorIsAuto && sessionSource !== "naia-piece" && naiaCustomer && recentlyShownClosetIds.length > 0) {
        try {
          const rerollAnchor = await autoSelectClosetAnchor(naiaCustomer.id, {
            occasion: session.occasion ?? "everyday",
            moods: regenMoods,
            desiredFeelings: regenDesiredFeelings,
            formalityConditional: session.formalityConditional ?? null,
            intentions: session.intentions ?? [],
            bodyNeeds: regenBodyNeeds,
            dressingPreferences: naiaCustomer.onboardingProfile?.dressingPreferences ?? [],
            previousOutfitClosetIds: recentlyShownClosetIds,
          });
          if (rerollAnchor) {
            const resolved = await resolveActionAnchor(
              sessionSource, session.customerId, null, rerollAnchor.id,
            );
            if (resolved.ok && resolved.anchor) regenAnchor = resolved.anchor;
          }
        } catch {
          /* graceful: keep the session anchor */
        }
      }

      const engineInput = buildEngineInput({
        moods: regenMoods,
        desiredFeelings: regenDesiredFeelings,
        bodyNeeds: regenBodyNeeds,
        coverageConditional: null,
        occasion: session.occasion ?? "everyday",
        occasionDisplayLabel: regenOccasionDisplayLabel,
        formalityConditional: session.formalityConditional,
        todayColours: { preferred: [], avoid: [] },
        practicalIds: regenPracticalIds,
        source: sessionSource,
        profile: buildEphemeralContextSignals(buildProfileSignals(naiaCustomer?.onboardingProfile), journeyCtx),
        mode: regenMode,
        anchor: regenAnchor,
        recentlyShownHandles,
        ...(recentlyShownClosetIds.length > 0 && { recentlyShownClosetIds }),
        // Plain property, not a conditional spread: excess-property checking must stay live
        // here. The spread is what let this field be dropped silently for the life of the
        // feature. undefined is correct for a first generation — it skips the dedupe.
        prevOutfitClosetIds,
        // Rev 3 wording context — stored on session, never affects scoring
        ...(session.state && {
          state: session.state,
          intentions: session.intentions ?? [],
        }),
        // Finishing/presentation context only — zero engine scoring.
        gender: naiaCustomer?.onboardingProfile?.gender ?? null,
        closetCompanionIds: regenClosetCompanionIds,
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

      // No new combination available — keep the previous suggestion visible.
      if (styleResult.sameCombination) {
        return data({ sameCombination: true });
      }

      const dbPayload = buildDbPayload(styleResult, session.occasion ?? "everyday");

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
                productImageUrl: item.productImageUrl || null,
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
      // Ownership (2026-10-21) — without this, a client-supplied sessionId
      // could silently overwrite another customer's existing PostOutfitReview
      // (upsert below is keyed only on the unique sessionId), or create a new
      // review row attributed to the victim's customerId with attacker-chosen
      // field values. StylingSession.customerId is always a real owner.
      if (!naiaCustomer || reviewSession.customerId !== naiaCustomer.id) {
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
              productImageUrl: item.productImageUrl || null,
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

// Session-summary labels come from the questionnaire vocabulary so the result
// page can never show wording the customer did not actually read on the screens.
const REV3_STATE_LABELS = STYLEME_STATE_LABELS;
const REV3_INTENTION_LABELS = STYLEME_INTENTION_LABELS;
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
// Complete the Look type labels. This was a two-way ternary on `=== "top"`, so every slot
// that was not a top rendered as "Bottom" — which is how a generated evening-bag
// recommendation ended up labelled "Bottom". Keyed explicitly so a new slot shows a
// neutral fallback rather than silently borrowing another slot's name.
const COMPLETION_SLOT_LABELS: Record<string, string> = {
  top: "Top",
  bottom: "Bottom",
  dress: "Dress",
  set: "Set",
  shoe: "Shoes",
  bag: "Bag",
  outerwear: "Layer",
  accessory: "Accessory",
  jewelry: "Jewellery",
};

// Complete the Look and Finishing Layer can describe the same gap twice. The engine always
// emits a SHOES / BAG / ACCESSORY entry in suggestion.items; when an owned piece filled the
// slot it carries closetItemId, and when nothing did it is generic guidance with
// closetItemId null. Once the suitability rule began leaving a slot deliberately unfilled,
// that generic entry and the Complete the Look suggestion became two cards for one missing
// shoe. Owned pieces are never affected — they always have a closetItemId.
const COMPLETION_SLOT_TO_ITEM_TYPE: Record<string, string> = {
  shoe: "SHOES",
  bag: "BAG",
  accessory: "ACCESSORY",
  jewelry: "ACCESSORY",
};

function isDuplicateOfCompletionSuggestion(
  item: { itemType?: string; closetItemId?: string | null },
  completionLayer: unknown,
): boolean {
  if (item.closetItemId) return false; // an owned piece always renders
  const layer = Array.isArray(completionLayer)
    ? (completionLayer as Array<{ slot?: string }>)
    : [];
  return layer.some((p) => COMPLETION_SLOT_TO_ITEM_TYPE[p.slot ?? ""] === item.itemType);
}


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
  const generateFetcher = useFetcher<{ suggestion?: any; error?: string; sameCombination?: boolean; companionRecoveryBlocked?: boolean; companionRecoveryMessage?: string }>();
  const saveFetcher = useFetcher<{ saved?: boolean; error?: string; code?: string; pending?: boolean; next?: string; cleared?: boolean; alreadySaved?: boolean }>();
  const [msgIndex, setMsgIndex] = useState(0);
  // ── Staging QA: full-look VTO trigger ────────────────────────────────────
  type FullLookQAState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; outputDataUrl: string; items: Array<{ itemType: string; label: string }>; skipped: string[]; prompt: string }
    | { status: "error"; message: string };
  const [fullLookQA, setFullLookQA] = useState<FullLookQAState>({ status: "idle" });
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
  const generationSettled =
    !!generateFetcher.data?.suggestion || !!generateFetcher.data?.error || !!generateFetcher.data?.sameCombination;
  const isLoading =
    isInitialGeneration && (!generationSettled || !minDelayPassed);
  const suggestion = generateFetcher.data?.suggestion || loaderData.suggestion;
  const error = generateFetcher.data?.error || loaderData.error;

  // ── New Look, Same Vibe: scroll to the new result once it actually arrives ────
  //
  // generateFetcher is shared with the initial-generation auto-submit above, so the
  // ref — armed only by the New Look button's own click handler — is what tells this
  // effect "this settle is a reroll", never the first-load generation. ScrollRestoration
  // never applies here regardless: a fetcher submission creates no navigation entry, so
  // there is nothing restoring or fighting the scroll position — the page just never
  // asked to move at all, which is the actual bug. No defer-past-ScrollRestoration trick
  // (cf. passport.selfie.tsx) is needed for the same reason.
  //
  // Scrolls only on a genuine new outfit (data.suggestion present) — an error or a
  // sameCombination response leaves the old outfit on screen, so scrolling would imply
  // something changed when nothing did. The ref is cleared on every settle regardless
  // of outcome, so a failed reroll can never leave it armed for a later, unrelated
  // fetcher transition to misfire against.
  const isRerollingRef = useRef(false);
  useEffect(() => {
    if (generateFetcher.state !== "idle" || !isRerollingRef.current) return;
    if (generateFetcher.data?.suggestion) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    isRerollingRef.current = false;
  }, [generateFetcher.state, generateFetcher.data]);

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

  // ── No alternative found ─────────────────────────────────────────
  //
  // A reroll whose candidates are all core-equivalent to the current look returns
  // { sameCombination: true } with no suggestion. That is a valid settled outcome, not a
  // failure, and the engine deliberately skips the model call and persists nothing.
  //
  // This must be checked BEFORE the error guard below. That guard treats a falsy
  // `suggestion` as failure, and when this page was reached through the generation flow
  // loaderData.suggestion is null — so a correct no-alternative response rendered
  // "Something went wrong". The guard's own condition is left exactly as it was.
  //
  // Scoped with `!suggestion` on purpose: when a previous look IS on screen, `suggestion`
  // is truthy, the error guard never fires, and the inline message beside the New Look
  // button already handles it. This covers only the case where there is nothing to show.
  if (generateFetcher.data?.sameCombination && !suggestion) {
    return (
      <div className="sm-loading-wrap">
        <div style={{ textAlign: "center", maxWidth: "500px", padding: "40px" }}>
          <h1 style={{ fontFamily: "var(--naia-ff-display)", fontSize: "32px", fontWeight: 900, color: "var(--naia-ink)", marginBottom: "16px" }}>
            No other look today
          </h1>
          <p className="sm-same-combination-msg" style={{ fontFamily: "var(--naia-ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--naia-muted)", marginBottom: "32px" }}>
            nAia couldn&rsquo;t find a different combination with your available pieces.
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
        <span style={{ width: "42px" }} />
      </div>

      {/* ── Saved confirmation banner ── */}
      {/* "View Saved Looks" goes to /style-me (StyleMeIndex, "Your StyleMe Looks" section)
          — the real, existing place a saved look appears, badged SAVED, inside the StyleMe
          area itself. Not /my-naia/saved: that route exists and genuinely queries
          SavedLook, but nothing in the app links to it (confirmed: no Link anywhere
          targets "/my-naia/saved"), so it is not "the existing Saved Looks section within
          StyleMe" a customer could already be expected to reach. */}
      {isSaved && (
        <div className="sm-banner sm-banner-saved">
          <p className="sm-banner-text">Look saved to My Looks!</p>
          <div className="sm-banner-actions">
            <Link to="/style-me#your-styleme-looks" className="sm-banner-cta">View Saved Looks →</Link>
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
                  <p className="sm-result-context-value">{occasionDisplayFor((loaderData as { occasionDisplayLabel?: string | null }).occasionDisplayLabel, loaderData.occasion)}</p>
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
                  <p className="sm-result-context-value">{occasionDisplayFor((loaderData as { occasionDisplayLabel?: string | null }).occasionDisplayLabel, loaderData.occasion)}</p>
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
              <div className="sm-outfit-grid">
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
              </div>
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

        {/* She asked for NADINE + My Closet and nothing in the live collection qualified.
            Closet-only was the decision, not a shortfall — so the page says so instead of
            looking identical to having chosen My Closet. Guard and copy both live in
            ~/lib/styleme/nadine-fallback-note; this renders, it does not decide. */}
        {shouldExplainNoNadineHero(suggestionMeta) && (
          <p
            className="sm-anchor-note"
            style={{
              fontFamily: "var(--naia-ff-body)",
              fontSize: "15px",
              fontStyle: "italic",
              color: "var(--naia-muted)",
              margin: "0 0 32px",
              maxWidth: "46em",
            }}
          >
            {NO_NADINE_HERO_NOTE}
          </p>
        )}

        {/* Complete the Look — generic wardrobe guidance for missing clothing and finishing slots */}
        {suggestionMeta?.completionLayer && suggestionMeta.completionLayer.length > 0 && (
          <div className="sm-result-section">
            <p className="sm-result-section-head">Complete the Look</p>
            <div className="sm-complete-grid">
            {(suggestionMeta.completionLayer as Array<{ slot: string; description: string }>).map((piece, i) => (
              <div key={i} className="sm-item-card sm-item-card--secondary">
                <p className="sm-item-type-label">{COMPLETION_SLOT_LABELS[piece.slot] ?? "Piece"}</p>
                <p className="sm-item-notes--secondary">{piece.description}</p>
              </div>
            ))}
            </div>
          </div>
        )}

        {/* Finishing layer — suppresses items in the same slot as the anchor */}
        <div className="sm-result-section">
          <p className="sm-result-section-head">Finishing Layer</p>
          <div className="sm-finishing-grid">
          {suggestion.items?.filter((item: any) => {
            if (!["SHOES", "ACCESSORY", "BAG"].includes(item.itemType)) return false;
            // Already described under Complete the Look — do not say it twice.
            if (isDuplicateOfCompletionSuggestion(item, suggestionMeta?.completionLayer)) return false;
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
          {suggestionMeta?.colourDirection && (
            <div className="sm-item-card sm-item-card--secondary">
              <p className="sm-item-type-label">Colour Direction</p>
              <p className="sm-item-notes--secondary">{suggestionMeta.colourDirection}</p>
            </div>
          )}
          </div>
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

        {/* Why this works */}
        {suggestion.whyThisWorks && !isNoMatch && (
          <div className="sm-why-block">
            <p className="sm-result-section-head" style={{ borderBottom: "none", marginBottom: "12px" }}>Why This Works</p>
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "16px", lineHeight: 1.8, color: "var(--naia-muted)" }}>
              {suggestion.whyThisWorks}
            </p>
          </div>
        )}

        {/* Sensory layer: hair / makeup / perfume / song */}
        <div className="sm-sensory-grid">
          {suggestion.hairstyleRec && (
            <div className="sm-sensory-card">
              <p className="sm-sensory-label">Hair</p>
              <p className="sm-sensory-value">{suggestion.hairstyleRec}</p>
            </div>
          )}
          {suggestion.makeupVibeRec && (
            <div className="sm-sensory-card">
              <p className="sm-sensory-label">Makeup</p>
              <p className="sm-sensory-value">{suggestion.makeupVibeRec}</p>
            </div>
          )}
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
        </div>

        {/* Stylist's Note (internal field: confidenceBoost — semantics changed per Constitution V1) */}
        {suggestion.confidenceBoost && (
          <div className="sm-confidence-block">
            <p className="sm-confidence-label">STYLIST'S NOTE</p>
            <p className="sm-confidence-quote">{suggestion.confidenceBoost}</p>
          </div>
        )}

        {/* ── Virtual Try-On ── */}
        {loaderData.isStagingProject && suggestion?.id && (
          <div className="sm-vto-section" aria-live="polite">
            <p className="sm-vto-eyebrow">VIRTUAL TRY-ON</p>

            {fullLookQA.status === "idle" && !loaderData.naiaModelIsReady && (
              <>
                <h2 className="sm-vto-heading">See this look on you.</h2>
                <p className="sm-vto-body">Create your nAia Model to try this look on.</p>
                <Link to="/my-naia-model" className="sm-result-action-btn sm-result-action-btn--primary sm-vto-cta">
                  Create Your nAia Model
                </Link>
              </>
            )}

            {fullLookQA.status === "idle" && loaderData.naiaModelIsReady && (
              <>
                <h2 className="sm-vto-heading">See this look on you.</h2>
                <p className="sm-vto-body">Preview the complete outfit on your nAia Model.</p>
                <button
                  type="button"
                  className="sm-result-action-btn sm-result-action-btn--primary sm-vto-cta"
                  onClick={async () => {
                    setFullLookQA({ status: "loading" });
                    try {
                      const res = await fetch("/api/staging-full-look-vto", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          suggestionId: suggestion!.id,
                          virtualTryOnConsentAt: new Date().toISOString(),
                        }),
                      });
                      const json = await res.json();
                      if (json.ok) {
                        setFullLookQA({
                          status: "done",
                          outputDataUrl: json.outputDataUrl,
                          items: json.items ?? [],
                          skipped: json.skipped ?? [],
                          prompt: json.prompt ?? "",
                        });
                      } else {
                        setFullLookQA({ status: "error", message: json.code ?? "unknown" });
                      }
                    } catch {
                      setFullLookQA({ status: "error", message: "network" });
                    }
                  }}
                >
                  TRY THIS LOOK ON
                </button>
              </>
            )}

            {fullLookQA.status === "loading" && (
              <>
                <h2 className="sm-vto-heading">Creating your try-on…</h2>
                <p className="sm-vto-body">This can take a moment.</p>
              </>
            )}

            {fullLookQA.status === "done" && (
              <>
                <h2 className="sm-vto-heading">Your look, on you.</h2>
                <img
                  src={fullLookQA.outputDataUrl}
                  alt="Your StyleMe outfit on your nAia Model"
                  className="sm-vto-image"
                />
                <button
                  type="button"
                  className="sm-result-action-btn sm-vto-cta"
                  onClick={() => setFullLookQA({ status: "idle" })}
                >
                  Try Again
                </button>
              </>
            )}

            {fullLookQA.status === "error" && (
              <>
                <h2 className="sm-vto-heading">See this look on you.</h2>
                <p className="sm-vto-body">We couldn't create your try-on this time.</p>
                <p className="sm-vto-body-note">Your StyleMe look is still saved here.</p>
                <button
                  type="button"
                  className="sm-result-action-btn sm-vto-cta"
                  onClick={() => setFullLookQA({ status: "idle" })}
                >
                  Try Again
                </button>
              </>
            )}
          </div>
        )}

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

        {/* Actions — moved back to the bottom (2026-10-24), after the explanations,
            finishing advice and Virtual Try-On above: desktop/mobile testing found that
            surfacing the actions mid-page (right after Finishing Layer, ahead of Also
            Works / Why This Works / VTO) meant the customer committed to Save Look /
            New Look before seeing the full styling rationale. The compact garment grid
            above keeps this page short enough that the extra scroll is minor. */}
        <div className="sm-result-actions">
          {/* PRIMARY — Save Look (hidden when pending-save banner is already handling save) */}
          {!showPendingBanner && (
            <button
              type="button"
              disabled={isSaved || saveFetcher.state !== "idle"}
              onClick={() => {
                if (!isSaved) {
                  saveFetcher.submit({ intent: "save", suggestionId: suggestion.id }, { method: "post" });
                }
              }}
              className={`sm-result-action-btn${isSaved ? " sm-result-action-btn--accent" : " sm-result-action-btn--primary"}`}
            >
              {saveFetcher.state !== "idle" && !isSaved ? "Saving…" : isSaved ? "Saved" : "Save Look"}
            </button>
          )}
          {/* SECONDARY */}
          <button
            type="button"
            disabled={generateFetcher.state !== "idle"}
            onClick={() => {
              const sid = (suggestion as any)?.sessionId ?? loaderData.sessionId;
              if (!sid) return;
              isRerollingRef.current = true;
              generateFetcher.submit({ intent: "regenerate", sessionId: sid }, { method: "post" });
            }}
            className="sm-result-action-btn"
          >
            {generateFetcher.state !== "idle" ? "Finding your look…" : "New Look, Same Vibe"}
          </button>
          <Form method="post">
            <input type="hidden" name="intent" value="adjust-vibe" />
            <button type="submit" className="sm-result-action-btn">Adjust Vibe</button>
          </Form>
          {/* TERTIARY */}
          <Form method="post">
            <input type="hidden" name="intent" value="start-over" />
            <button type="submit" className="sm-result-action-btn">Start Over</button>
          </Form>
          {generateFetcher.data?.sameCombination && (
            <p className="sm-same-combination-msg">
              nAia couldn&rsquo;t find a different combination with your available pieces.
            </p>
          )}
          {/* Fail-closed recovery: New Look refused rather than silently dropping a required
              companion it could not re-verify. The current look above is untouched — this is
              a sibling message to sameCombination, not an error-page takeover (the action
              deliberately returns a distinct field, never `error`, so the error-state branch
              above is never triggered and the existing suggestion stays on screen). */}
          {generateFetcher.data?.companionRecoveryBlocked && (
            <p className="sm-same-combination-msg" role="alert">
              {generateFetcher.data.companionRecoveryMessage}{" "}
              <Link to="/closet/intelligence">Go to Wardrobe Intelligence →</Link>
            </p>
          )}
          {suggestionMeta?.outcome !== "closet-led" && (
            // nAia is the stylist; NADINE is the brand being bought. Both the label and the
            // destination are derived, because a NADINE hero used to be offered as
            // "Shop nAia" — and, when a closet piece came first in the look, linked to the
            // storefront instead of the piece she had just been shown.
            <a
              href={resolveCommerceCtaHref({
                outcome: suggestionMeta?.outcome,
                mode: suggestionMeta?.mode,
                items: suggestion.items,
              })}
              className="sm-result-action-btn"
            >
              {resolveCommerceCtaLabel({
                outcome: suggestionMeta?.outcome,
                mode: suggestionMeta?.mode,
                items: suggestion.items,
              })}
            </a>
          )}
        </div>

        {loaderData.qaExportEnabled && (
          <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const pad = (n: number) => String(n).padStart(2, "0");
                const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
                const html = document.documentElement.outerHTML;
                const blob = new Blob([html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `styleme-qa-${stamp}.html`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              style={{ fontSize: "0.7rem", opacity: 0.45, padding: "0.25rem 0.75rem", border: "1px dashed currentColor", background: "transparent", cursor: "pointer", letterSpacing: "0.08em", borderRadius: "3px" }}
            >
              SAVE QA PAGE
            </button>
          </div>
        )}

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
