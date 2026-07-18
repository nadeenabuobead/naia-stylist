import { Form, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";
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
  { id: "waist-definition", label: "Waist definition", emoji: "⏳" },
  { id: "soft-and-forgiving-around-waist", label: "Soft and forgiving around my waist today", emoji: "🌸" },
  { id: "more-coverage", label: "More coverage", emoji: "🧥" },
  { id: "relaxed", label: "Something relaxed", emoji: "☁️" },
  { id: "structured", label: "Something structured", emoji: "📐" },
  { id: "elongates", label: "Something that elongates me", emoji: "👠" },
  { id: "balances", label: "Something that balances my shape", emoji: "⚖️" },
  { id: "comfortable-elevated", label: "Something comfortable but still elevated", emoji: "✨" },
  { id: "nothing-specific", label: "Nothing specific", emoji: "💫" },
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
    <SmPage backTo="/style-me/feeling">
      <h1 className="sm-heading">Any body needs today?</h1>
      <p className="sm-sub">Select all that apply</p>
      <p className="sm-count">{selected.length > 0 ? `${selected.length} selected` : ""}</p>

      <Form method="post">
        <div className="sm-grid">
          {bodyNeedOptions.map((opt) => {
            const isSelected = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggle(opt.id)}
                className={`sm-chip${isSelected ? " sm-chip--on" : ""}`}
              >
                <span className="sm-chip-emoji">{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <input type="hidden" name="bodyNeeds" value={JSON.stringify(selected)} />
        <SmContinue disabled={!canSubmit} />
      </Form>
    </SmPage>
  );
}
