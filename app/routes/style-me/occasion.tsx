import { Form, Link } from "react-router";
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

const occasions = [
  { id: "everyday", label: "Everyday or casual plans" },
  { id: "work", label: "Work or meetings" },
  { id: "dinner", label: "Dinner" },
  { id: "date-night", label: "Date night" },
  { id: "girls-night", label: "Girls' night" },
  { id: "family", label: "Family gathering" },
  { id: "special-event", label: "Special event" },
  { id: "travel", label: "Travel day" },
  { id: "not-sure", label: "I'm not sure yet" },
];

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
  const mood = session.get("styleMeMood");
  const feelings = session.get("styleMeFeelings");
  const bodyNeeds = session.get("styleMeBodyNeeds");

  if (!mood || !feelings || !bodyNeeds) {
    return redirect("/style-me/mood");
  }

  return data({ mood, feelings, bodyNeeds });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const occasion = formData.get("occasion") as string;
  const formalityRaw = formData.get("formalityConditional") as string | null;

  if (!occasion || !VALID_OCCASION_IDS.has(occasion)) {
    return data({ error: "Please select an occasion" }, { status: 400 });
  }

  // Server-side defense: only honor a formality answer for an occasion that
  // actually shows the micro-question — ignores any stale/tampered value from
  // a previous occasion selection.
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
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedFormality, setSelectedFormality] = useState<string | null>(null);

  const showFormality = !!selected && FORMALITY_OCCASIONS.has(selected);

  const selectOccasion = (id: string) => {
    setSelected(id);
    if (!FORMALITY_OCCASIONS.has(id)) setSelectedFormality(null);
  };

  return (
    <SmPage backTo="/style-me/comfort" step={4}>
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
          <Link to="/style-me/comfort" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!selected} />
        </div>
      </Form>
    </SmPage>
  );
}
