// app/routes/style-me/intention.tsx
// Rev 3 Screen 2 — "What do you want your clothes to do today?"
// Max 2 selections. Writes styleMeIntentions to session cookie.
// Options (IDs + labels) live in ~/lib/styleme/session-vocabulary — the 12 IDs are
// the approved garment taxonomy; labels are display copy only.
// SCORING NOTE: translated in result.tsx to canonical engine signals before engine input.

import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { SESSION_QUESTIONS, SESSION_QUESTION_IDS as SQ } from "~/lib/ai/signal-contract.js";
import { STYLEME_ACTIVE_INTENTION_OPTIONS } from "~/lib/styleme/session-vocabulary";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const INTENTION_QUESTION = SESSION_QUESTIONS.find((q) => q.id === SQ.INTENTIONS)!;
const MAX_SELECTIONS = INTENTION_QUESTION.maxSelections ?? 2;

// The ACTIVE set, not the full taxonomy: the four 2026-09 intentions stay defined
// but unoffered until the Wardrobe Intelligence consumer fix lands. See the
// STYLEME_TAXONOMY_16_ACTIVE note in session-vocabulary.ts.
const INTENTION_OPTIONS = STYLEME_ACTIVE_INTENTION_OPTIONS;

const VALID_INTENTION_IDS = new Set(INTENTION_OPTIONS.map((o) => o.id));

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const raw = session.get(INTENTION_QUESTION.storageKey) as string | undefined;
  let selected: string[] = [];
  if (raw) {
    try { selected = JSON.parse(raw); } catch { selected = []; }
  }
  return { selected };
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return redirect("/auth/login");

  const formData = await request.formData();
  const selected = formData.getAll("intentions").filter(
    (v): v is string => typeof v === "string" && VALID_INTENTION_IDS.has(v),
  );

  if (selected.length === 0 || selected.length > MAX_SELECTIONS) {
    return {
      error: `Please choose up to ${MAX_SELECTIONS} ${MAX_SELECTIONS === 1 ? "intention" : "intentions"}.`,
    };
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set(INTENTION_QUESTION.storageKey, JSON.stringify(selected));

  return redirect("/style-me/physical-need", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function IntentionPage() {
  const { selected: initialSelected } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, id];
    });
  };

  return (
    <SmPage step={2}>
      <p className="sm-step-label">Your Intention</p>
      <h1 className="sm-heading">What do you want your clothes to do today?</h1>
      <p className="sm-sub">Choose up to {MAX_SELECTIONS}.</p>

      <Form method="post">
        <div className="sm-pills">
          {INTENTION_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              className={`sm-pill${selected.includes(option.id) ? " sm-pill--on" : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {selected.map((id) => (
          <input key={id} type="hidden" name="intentions" value={id} />
        ))}
        <div className="sm-step-buttons">
          <Link to="/style-me/state" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={selected.length === 0} />
        </div>
      </Form>
    </SmPage>
  );
}
