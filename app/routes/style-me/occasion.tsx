import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "What's the occasion? | nAia Style Me" }];
}
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { SESSION_QUESTIONS, SQ } from "~/lib/ai/signal-contract";
import { CANONICAL_STYLEME_ENTRY } from "~/lib/styleme/handoff";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { evaluateAnchorEligibility } from "~/lib/ai/styleme-profile-gate";
import type { ClosetAnchorInput } from "~/lib/ai/styleme-recommendation.types";
import prisma from "~/db.server";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";
import {
  STYLEME_OCCASION_OPTIONS,
  STYLEME_OCCASION_REV3_TO_CANONICAL,
  STYLEME_FORMALITY_OPTIONS,
  isLongOptionLabel,
} from "~/lib/styleme/session-vocabulary";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

// Rev 3 UI — exactly 8 approved customer-facing IDs.
// Canonical IDs (date-night, special-event) are internal only; girls-night/not-sure/other removed from UI.
// Single source of truth: app/lib/styleme/session-vocabulary.ts (also read by
// the Customer 360 admin StyleMe detail view, so the two can never drift).
const occasions = STYLEME_OCCASION_OPTIONS;

// Rev 3 UI IDs → canonical engine IDs (applied at action time, before session storage).
// "other" → "not-sure" kept for internal/legacy session compatibility even though "other" is
// no longer a visible UI option — historical sessions or manually crafted requests must not
// produce an unrecognized canonical value.
const REV3_OCCASION_MAP = STYLEME_OCCASION_REV3_TO_CANONICAL;

// Reverse map: canonical engine ID → Rev 3 UI ID (for session hydration on Back navigation).
// "everyday" is intentionally omitted — it maps to itself, no ambiguity needed.
const OCCASION_REVERSE_MAP: Record<string, string> = {
  "date-night": "date",
  "special-event": "event",
  "active": "active-busy-day",
};

const formalityOptions = STYLEME_FORMALITY_OPTIONS;

const VALID_OCCASION_IDS = new Set(occasions.map((o) => o.id));
const VALID_FORMALITY_IDS = new Set(formalityOptions.map((f) => f.id));

// Single source of truth — reuses the existing conditional-occasion list from
// the signal contract rather than duplicating it here.
const FORMALITY_QUESTION = SESSION_QUESTIONS.find((q) => q.id === SQ.FORMALITY_CONDITIONAL);
const FORMALITY_OCCASIONS = new Set(FORMALITY_QUESTION?.showForOccasions ?? []);

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  // Accept both Rev 3 path (styleMeState) and legacy path (styleMeMood + styleMeFeelings)
  const isRev3 = !!session.get("styleMeState");
  const isLegacy = !!(session.get("styleMeMood") && session.get("styleMeFeelings"));
  const bodyNeeds = session.get("styleMeBodyNeeds");

  if (!isRev3 && !isLegacy) {
    return redirect(CANONICAL_STYLEME_ENTRY);
  }
  if (!bodyNeeds) {
    return redirect(isRev3 ? "/style-me/physical-need" : CANONICAL_STYLEME_ENTRY);
  }

  // Hydrate previously selected occasion and formality for Back navigation.
  const storedOccasion = session.get("styleMeOccasion") as string | undefined;
  const prevOccasion = storedOccasion
    ? (OCCASION_REVERSE_MAP[storedOccasion] ?? storedOccasion)
    : null;
  const prevFormality = (session.get("styleMeFormalityConditional") as string | undefined) ?? null;

  return data({ isRev3, prevOccasion, prevFormality });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const rawOccasion = formData.get("occasion") as string;
  const formalityRaw = formData.get("formalityConditional") as string | null;

  if (!rawOccasion || !VALID_OCCASION_IDS.has(rawOccasion)) {
    return data({ error: "Please select an occasion" }, { status: 400 });
  }

  // Normalize Rev 3 UI IDs to canonical engine IDs
  const occasion = REV3_OCCASION_MAP[rawOccasion] ?? rawOccasion;

  // Server-side defense: only honor a formality answer for an occasion that
  // actually shows the micro-question — uses the normalized ID to match FORMALITY_OCCASIONS.
  const formalityConditional =
    FORMALITY_OCCASIONS.has(occasion) && formalityRaw && VALID_FORMALITY_IDS.has(formalityRaw)
      ? formalityRaw
      : null;

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeOccasion", occasion);
  // Store human-readable label (not the raw option ID) for Claude wording and result display.
  const displayLabel = occasions.find((o) => o.id === rawOccasion)?.label ?? rawOccasion;
  session.set("styleMeOccasionDisplayLabel", displayLabel);
  if (formalityConditional) {
    session.set("styleMeFormalityConditional", formalityConditional);
  } else {
    session.unset("styleMeFormalityConditional");
  }

  // Whenever a new occasion is submitted and a closet anchor is already chosen —
  // locked via Wardrobe Intelligence, picked earlier through the manual picker, or
  // auto-selected — that anchor has to be revalidated against THIS occasion before
  // any destination is allowed to proceed. It may never have been checked against
  // an occasion at all (a WI handoff locks it before the questionnaire runs), or it
  // may have been checked against a DIFFERENT occasion the customer has since
  // changed via Back-navigation or Adjust Vibe.
  //
  // This is the single write site for styleMeOccasion, so it is the only place that
  // can catch every route to generation — a fresh forward pass, Adjust Vibe's
  // skip-source shortcut, and a Back-and-resubmit regenerate alike — rather than
  // duplicating this check once per shortcut.
  //
  // occasion.tsx decides exactly one thing: eligible or not. It does not decide
  // AUTO-vs-MANUAL recovery — stamping the lock and falling through to
  // /style-me/source hands that decision to its own anchorLocked branch, the one
  // place that owns provenance.
  const checkEligibility = async (closetItemId: string): Promise<boolean> => {
    const naiaCustomer = await getCurrentNaiaCustomer(request);
    if (!naiaCustomer) return true;
    const profileRow = await prisma.closetItem.findFirst({
      where: { id: closetItemId, customerId: naiaCustomer.id },
      select: { hemLength: true, topLength: true, styleMeProfile: true },
    });
    const approvedProfile =
      profileRow?.styleMeProfile?.profileStatus === "approved"
        ? { occasionFit: (profileRow.styleMeProfile.occasionFit as Record<string, string> | null) ?? null }
        : null;
    return evaluateAnchorEligibility(
      {
        hemLength: profileRow?.hemLength ?? null,
        topLength: profileRow?.topLength ?? null,
        approvedProfile,
      } as unknown as ClosetAnchorInput,
      occasion,
      naiaCustomer.onboardingProfile?.dressingPreferences ?? [],
    ).eligible;
  };

  const closetAnchorId = session.get("styleMeClosetAnchorId") as string | undefined;
  let anchorStillEligible = true;
  if (closetAnchorId) {
    anchorStillEligible = await checkEligibility(closetAnchorId);
  }

  // A manual pick rejected earlier in this same flow (set-anchor's own eligibility
  // check, unmodified) — remembered under styleMePendingClosetAnchorId rather than
  // styleMeClosetAnchorId because it never passed eligibility. Only relevant when
  // there is no real anchor yet; a real anchor always takes precedence. Always
  // MANUAL by construction, so promoting it on success never needs an AUTO path.
  const pendingClosetAnchorId = !closetAnchorId
    ? (session.get("styleMePendingClosetAnchorId") as string | undefined)
    : undefined;
  let pendingNowEligible = false;
  if (pendingClosetAnchorId) {
    pendingNowEligible = await checkEligibility(pendingClosetAnchorId);
    if (pendingNowEligible) {
      session.set("styleMeClosetAnchorId", pendingClosetAnchorId);
      session.set("styleMeAnchorProvenance", "MANUAL");
      session.unset("styleMePendingClosetAnchorId");
      // Defensive: this branch only runs when !closetAnchorId (no real anchor yet),
      // so companions should already be absent — cleared anyway so a newly-eligible
      // manual pick can never inherit stale companions from an unrelated WI combination.
      session.unset("styleMeClosetCompanionIds");
    }
  }

  // When the customer used "Adjust Vibe" from the result page, source and focal
  // item are already in the cookie — skip the source step and go straight to
  // result, but only once the anchor above is confirmed eligible for this occasion.
  const adjustVibe = session.get("styleMeAdjustVibe") as string | undefined;
  if (adjustVibe) session.unset("styleMeAdjustVibe");

  if (pendingClosetAnchorId && !pendingNowEligible) {
    // Still ineligible — leave it pending (do not clear, do not promote) and route
    // through /style-me/source, whose loader shows the same anchor-incompatible
    // screen for this same piece.
    return redirect("/style-me/source", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (pendingClosetAnchorId && pendingNowEligible) {
    // Promoted above — proceed exactly as a fresh successful manual pick would.
    return redirect("/style-me/result", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (!anchorStillEligible) {
    // Force the anchorLocked branch to run on arrival, regardless of how this
    // anchor was originally chosen — that branch, not this one, decides AUTO
    // (clear and recover) vs MANUAL/null (show anchor-incompatible, never swap).
    session.set("styleMeAnchorLocked", "1");
    return redirect("/style-me/source", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (adjustVibe) {
    return redirect("/style-me/result", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  return redirect("/style-me/source", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StyleMeOccasion() {
  const { isRev3, prevOccasion, prevFormality } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string | null>(prevOccasion);
  const [selectedFormality, setSelectedFormality] = useState<string | null>(prevFormality);

  // Normalize Rev 3 UI ID before checking formality occasions (which use canonical IDs).
  const normalizedForFormality = selected ? (REV3_OCCASION_MAP[selected] ?? selected) : null;
  const showFormality = !!normalizedForFormality && FORMALITY_OCCASIONS.has(normalizedForFormality);
  // Back always targets the canonical Fit/Comfort step. /style-me/comfort is a
  // compatibility redirect now and must never be offered as a destination.
  const backTo = "/style-me/physical-need";

  const selectOccasion = (id: string) => {
    setSelected(id);
    if (!FORMALITY_OCCASIONS.has(REV3_OCCASION_MAP[id] ?? id)) setSelectedFormality(null);
  };

  return (
    <SmPage backTo={backTo} step={4}>
      <p className="sm-step-label">Occasion</p>
      <h1 className="sm-heading">What does the outfit need to work for?</h1>
      <p className="sm-sub">Choose your occasion.</p>

      <Form method="post">
        <div className="sm-pills">
          {occasions.map((occ) => (
            <button
              key={occ.id}
              type="button"
              onClick={() => selectOccasion(occ.id)}
              className={`sm-pill${selected === occ.id ? " sm-pill--on" : ""}${isLongOptionLabel(occ.label) ? " sm-pill--wide" : ""}`}
            >
              {occ.label}
            </button>
          ))}
        </div>

        {showFormality && (
          <>
            <p
              style={{
                fontFamily: "var(--naia-ff-ui)",
                fontSize: "10px",
                letterSpacing: "3px",
                textTransform: "uppercase",
                color: "rgba(40, 21, 12, 0.5)",
                marginTop: "20px",
                marginBottom: "10px",
              }}
            >
              How dressed-up does this need to be?
            </p>
            <div className="sm-pills">
              {formalityOptions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedFormality(f.id)}
                  className={`sm-pill${selectedFormality === f.id ? " sm-pill--on" : ""}${isLongOptionLabel(f.label) ? " sm-pill--wide" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}

        <input type="hidden" name="occasion" value={selected || ""} />
        <input
          type="hidden"
          name="formalityConditional"
          value={showFormality ? selectedFormality ?? "" : ""}
        />
        <div className="sm-step-buttons">
          <Link to={backTo} className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!selected} />
        </div>
      </Form>
    </SmPage>
  );
}
