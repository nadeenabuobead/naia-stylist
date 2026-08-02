import { Form, Link } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "How do you want to feel? | nAia Style Me" }];
}
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const desiredFeelings = [
  { id: "more-confident", label: "More confident" },
  { id: "more-put-together", label: "More put together" },
  { id: "softer", label: "Softer" },
  { id: "more-powerful", label: "More powerful" },
  { id: "more-feminine", label: "More feminine" },
  { id: "more-effortless", label: "More effortless" },
  { id: "more-elevated", label: "More elevated" },
  { id: "more-attractive", label: "More attractive" },
  { id: "like-myself", label: "Like myself again" },
];

const VALID_FEELING_IDS = new Set(desiredFeelings.map((f) => f.id));

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");

  if (!mood) {
    return redirect("/style-me/mood");
  }

  return data({ mood });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const feelingsRaw = formData.get("feelings") as string;

  let feelings: string[] = [];
  try { feelings = JSON.parse(feelingsRaw || "[]"); } catch { /* invalid JSON */ }

  const valid = feelings.filter((id) => VALID_FEELING_IDS.has(id)).slice(0, 2);
  if (!valid.length) {
    return data({ error: "Please select how you want to feel" }, { status: 400 });
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeFeelings", valid);

  return redirect("/style-me/comfort", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StyleMeFeeling() {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      if (prev.length < 2) return [...prev, id];
      return prev;
    });
  };

  const canSubmit = selected.length > 0;
  const atMax = selected.length === 2;

  return (
    <SmPage backTo="/style-me/mood" step={2}>
      <p className="sm-step-label">Desired Feeling</p>
      <h1 className="sm-heading">How do you want to feel?</h1>
      <p className="sm-sub">Choose up to two — or just one.</p>

      <Form method="post">
        <div className="sm-pills">
          {desiredFeelings.map((feeling) => {
            const isSelected = selected.includes(feeling.id);
            const isDisabled = !isSelected && atMax;
            return (
              <button
                key={feeling.id}
                type="button"
                onClick={() => toggle(feeling.id)}
                className={`sm-pill${isSelected ? " sm-pill--on" : ""}${isDisabled ? " sm-pill--off" : ""}`}
              >
                {feeling.label}
              </button>
            );
          })}
        </div>

        <input type="hidden" name="feelings" value={JSON.stringify(selected)} />
        <div className="sm-step-buttons">
          <Link to="/style-me/mood" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!canSubmit} />
        </div>
      </Form>
    </SmPage>
  );
}
