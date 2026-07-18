import { Form, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const desiredFeelings = [
  { id: "more-confident", label: "Make me feel more confident", emoji: "💪" },
  { id: "more-put-together", label: "Make me feel more put together", emoji: "✨" },
  { id: "softer", label: "Make me feel softer", emoji: "🌸" },
  { id: "more-powerful", label: "Make me feel more powerful", emoji: "👑" },
  { id: "more-feminine", label: "Make me feel more feminine", emoji: "💐" },
  { id: "more-effortless", label: "Make me feel more effortless", emoji: "🌊" },
  { id: "more-elevated", label: "Make me feel more elevated", emoji: "🎯" },
  { id: "more-attractive", label: "Make me feel more attractive", emoji: "💫" },
  { id: "like-myself", label: "Make me feel like myself again", emoji: "🌟" },
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
    <SmPage backTo="/style-me/mood">
      <h1 className="sm-heading">How do you want to feel?</h1>
      <p className="sm-sub">Select up to two — or just one</p>
      <p className="sm-count">{selected.length > 0 ? `${selected.length} selected` : ""}</p>

      <Form method="post">
        <div className="sm-grid">
          {desiredFeelings.map((feeling) => {
            const isSelected = selected.includes(feeling.id);
            const isDisabled = !isSelected && atMax;
            return (
              <button
                key={feeling.id}
                type="button"
                onClick={() => toggle(feeling.id)}
                className={`sm-chip${isSelected ? " sm-chip--on" : ""}${isDisabled ? " sm-chip--off" : ""}`}
              >
                <span className="sm-chip-emoji">{feeling.emoji}</span>
                <span>{feeling.label}</span>
              </button>
            );
          })}
        </div>

        <input type="hidden" name="feelings" value={JSON.stringify(selected)} />
        <SmContinue disabled={!canSubmit} />
      </Form>
    </SmPage>
  );
}
