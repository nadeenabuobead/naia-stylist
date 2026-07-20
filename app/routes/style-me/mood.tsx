import { Form, Link } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LinksFunction } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const moodOptions = [
  { id: "confident", label: "I feel confident" },
  { id: "tired", label: "Tired or low-energy" },
  { id: "overwhelmed", label: "I feel overwhelmed" },
  { id: "playful", label: "I feel playful" },
  { id: "romantic", label: "I feel romantic" },
  { id: "powerful", label: "I feel powerful" },
  { id: "need-reset", label: "I need a reset" },
  { id: "feel-good", label: "I feel good — just need styling" },
];

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const mood = formData.get("mood") as string;

  if (!mood) {
    return data({ error: "Please select how you're feeling" }, { status: 400 });
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeMood", mood);

  return redirect("/style-me/feeling", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StyleMeMood() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <SmPage backTo="/" step={1}>
      <p className="sm-step-label">Your Mood</p>
      <h1 className="sm-heading">How are you feeling today?</h1>
      <p className="sm-sub">Choose the one that feels closest.</p>

      <Form method="post">
        <div className="sm-pills">
          {moodOptions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(selected === m.id ? null : m.id)}
              className={`sm-pill${selected === m.id ? " sm-pill--on" : ""}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <input type="hidden" name="mood" value={selected || ""} />
        <div className="sm-step-buttons">
          <Link to="/" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!selected} />
        </div>
      </Form>
    </SmPage>
  );
}
