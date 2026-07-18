import { Form } from "react-router";
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
  { id: "confident", label: "I feel confident", emoji: "💪" },
  { id: "tired", label: "I feel tired", emoji: "😴" },
  { id: "bloated", label: "I feel bloated", emoji: "🌊" },
  { id: "low-energy", label: "I feel low-energy", emoji: "🔋" },
  { id: "playful", label: "I feel playful", emoji: "🎀" },
  { id: "romantic", label: "I feel romantic", emoji: "🌹" },
  { id: "powerful", label: "I feel powerful", emoji: "👑" },
  { id: "need-reset", label: "I feel like I need a reset", emoji: "🔄" },
  { id: "feel-good", label: "I feel good, I just need styling", emoji: "✨" },
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
    <SmPage backTo="/" backLabel="← Back to Dashboard">
      <h1 className="sm-heading">How are you feeling?</h1>
      <p className="sm-sub">Choose one</p>

      <Form method="post">
        <div className="sm-grid">
          {moodOptions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(selected === m.id ? null : m.id)}
              className={`sm-chip${selected === m.id ? " sm-chip--on" : ""}`}
            >
              <span className="sm-chip-emoji">{m.emoji}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <input type="hidden" name="mood" value={selected || ""} />
        <SmContinue disabled={!selected} />
      </Form>
    </SmPage>
  );
}
