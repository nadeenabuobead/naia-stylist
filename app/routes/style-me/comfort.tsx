import { Form, Link } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "Body needs today | nAia Style Me" }];
}
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { BODY_NEED_NORMALIZATION_MAP } from "~/lib/ai/signal-contract";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const bodyNeedOptions = [
  { id: "waist-definition", label: "Define my waist" },
  { id: "soft-and-forgiving-around-waist", label: "Feel easy around my waist" },
  { id: "more-coverage", label: "Give me more coverage" },
  { id: "relaxed", label: "Feel relaxed" },
  { id: "structured", label: "Feel structured" },
  { id: "elongates", label: "Create a longer line" },
  { id: "balances", label: "Balance my proportions" },
  { id: "comfortable-elevated", label: "Comfortable but still polished" },
  { id: "nothing-clingy", label: "Nothing clingy today" },
  { id: "nothing-specific", label: "Nothing specific" },
];

const VALID_BODY_NEED_IDS = new Set(bodyNeedOptions.map((n) => n.id));

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  const feelings = session.get("styleMeFeelings");

  if (!mood || !feelings) {
    return redirect("/style-me/mood");
  }

  return data({ mood, feelings });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const bodyNeedsRaw = formData.get("bodyNeeds") as string;

  let bodyNeeds: string[] = [];
  try { bodyNeeds = JSON.parse(bodyNeedsRaw || "[]"); } catch { /* invalid JSON */ }

  const valid = bodyNeeds.filter((id) => VALID_BODY_NEED_IDS.has(id));
  if (!valid.length) {
    return data({ error: "Please select at least one option" }, { status: 400 });
  }

  const normalized = valid.map((id) => BODY_NEED_NORMALIZATION_MAP[id] ?? id);

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeBodyNeeds", normalized);

  return redirect("/style-me/occasion", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StyleMeComfort() {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const canSubmit = selected.length > 0;

  return (
    <SmPage backTo="/style-me/feeling" step={3}>
      <p className="sm-step-label">Body Needs</p>
      <h1 className="sm-heading">What should the outfit do for you today?</h1>
      <p className="sm-sub">Choose anything that matters.</p>

      <Form method="post">
        <div className="sm-pills">
          {bodyNeedOptions.map((opt) => {
            const isSelected = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggle(opt.id)}
                className={`sm-pill${isSelected ? " sm-pill--on" : ""}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <input type="hidden" name="bodyNeeds" value={JSON.stringify(selected)} />
        <div className="sm-step-buttons">
          <Link to="/style-me/feeling" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!canSubmit} />
        </div>
      </Form>
    </SmPage>
  );
}
