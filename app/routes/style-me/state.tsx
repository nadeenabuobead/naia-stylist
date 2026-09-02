// app/routes/style-me/state.tsx
// Rev 3 Screen 1 — "How are you feeling today?"
// Single select, 10 IDs. Writes styleMeState to session cookie.
// ZERO product scoring: state is wording context only (never maps to emotion/body/product field).

import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { SESSION_QUESTIONS, SESSION_QUESTION_IDS as SQ } from "~/lib/ai/signal-contract.js";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const STATE_QUESTION = SESSION_QUESTIONS.find((q) => q.id === SQ.STATE)!;

const STATE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "feel-good",                label: "I feel good" },
  { id: "stressed-overloaded",      label: "Stressed / overloaded" },
  { id: "low-energy",               label: "Low-energy" },
  { id: "not-feeling-like-myself",  label: "I don't really feel like myself" },
  { id: "physically-uncomfortable", label: "Physically uncomfortable" },
  { id: "self-conscious",           label: "Self-conscious" },
  { id: "going-through-change",     label: "I'm going through something" },
  { id: "want-reset",               label: "I want a reset" },
  { id: "nothing-in-particular",    label: "Nothing in particular" },
  { id: "other",                    label: "Other" },
];

const VALID_STATE_IDS = new Set(STATE_OPTIONS.map((o) => o.id));

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const selected = session.get(STATE_QUESTION.storageKey) as string | undefined;
  return { selected: selected ?? null };
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return redirect("/auth/login");

  const formData = await request.formData();
  const selected = formData.get("state");

  if (typeof selected !== "string" || !VALID_STATE_IDS.has(selected)) {
    return { error: "Please select how you're feeling today." };
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set(STATE_QUESTION.storageKey, selected);

  return redirect("/style-me/intention", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StatePage() {
  const { selected: initialSelected } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string | null>(initialSelected);

  return (
    <SmPage step={1}>
      <p className="sm-step-label">Your State</p>
      <h1 className="sm-heading">How are you feeling today?</h1>
      <p className="sm-sub">No right answer — just honest.</p>

      <Form method="post">
        <div className="sm-pills">
          {STATE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              className={`sm-pill${selected === option.id ? " sm-pill--on" : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input type="hidden" name="state" value={selected ?? ""} />
        <div className="sm-step-buttons">
          <Link to="/style-me" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!selected} />
        </div>
      </Form>
    </SmPage>
  );
}
