import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "What's the occasion? | nAia Style Me" }];
}
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { SESSION_QUESTIONS, SQ } from "~/lib/ai/signal-contract";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

// Rev 3 UI — exactly 8 approved customer-facing IDs.
// Canonical IDs (date-night, special-event) are internal only; girls-night/not-sure/other removed from UI.
const occasions = [
  { id: "work",            label: "Work or meetings" },
  { id: "dinner",          label: "Dinner" },
  { id: "date",            label: "Date" },
  { id: "everyday",        label: "Everyday or casual plans" },
  { id: "event",           label: "Event or occasion" },
  { id: "family",          label: "Family gathering" },
  { id: "travel",          label: "Travel day" },
  { id: "active-busy-day", label: "Active / busy day" },
];

// Rev 3 UI IDs → canonical engine IDs (applied at action time, before session storage).
// "other" → "not-sure" kept for internal/legacy session compatibility even though "other" is
// no longer a visible UI option — historical sessions or manually crafted requests must not
// produce an unrecognized canonical value.
const REV3_OCCASION_MAP: Record<string, string> = {
  "date": "date-night",
  "event": "special-event",
  "active-busy-day": "everyday",
  "other": "not-sure",
};

// Reverse map: canonical engine ID → Rev 3 UI ID (for session hydration on Back navigation).
// "everyday" is intentionally omitted — it maps to itself AND to active-busy-day, so ambiguous.
const OCCASION_REVERSE_MAP: Record<string, string> = {
  "date-night": "date",
  "special-event": "event",
};

const formalityOptions = [
  { id: "formality-relaxed", label: "Keep it relaxed" },
  { id: "formality-smart", label: "Smart casual" },
  { id: "formality-polished", label: "Polished" },
  { id: "formality-occasion", label: "Dressy" },
];

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
    return redirect("/style-me/mood");
  }
  if (!bodyNeeds) {
    return redirect(isRev3 ? "/style-me/physical-need" : "/style-me/comfort");
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
  if (formalityConditional) {
    session.set("styleMeFormalityConditional", formalityConditional);
  } else {
    session.unset("styleMeFormalityConditional");
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
  const backTo = isRev3 ? "/style-me/physical-need" : "/style-me/comfort";

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
              className={`sm-pill${selected === occ.id ? " sm-pill--on" : ""}`}
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
                  className={`sm-pill${selectedFormality === f.id ? " sm-pill--on" : ""}`}
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
