import { Form, Link } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "What's the occasion? | nAia Style Me" }];
}
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
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

const VALID_OCCASION_IDS = new Set(occasions.map((o) => o.id));

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

  if (!occasion || !VALID_OCCASION_IDS.has(occasion)) {
    return data({ error: "Please select an occasion" }, { status: 400 });
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeOccasion", occasion);

  return redirect("/style-me/source", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StyleMeOccasion() {
  const [selected, setSelected] = useState<string | null>(null);

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
              onClick={() => setSelected(occ.id)}
              className={`sm-pill${selected === occ.id ? " sm-pill--on" : ""}`}
            >
              {occ.label}
            </button>
          ))}
        </div>

        <input type="hidden" name="occasion" value={selected || ""} />
        <div className="sm-step-buttons">
          <Link to="/style-me/comfort" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!selected} />
        </div>
      </Form>
    </SmPage>
  );
}
