// app/routes/style-me/state.tsx
// Rev 3 Screen 1 — "How are you arriving today?"
// Single select, 10 IDs. Writes styleMeState to session cookie.
// ZERO product scoring: state is wording context only (never maps to emotion/body/product field).

import { Form, Link, redirect, useNavigation } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { SESSION_QUESTIONS, SESSION_QUESTION_IDS as SQ } from "~/lib/ai/signal-contract.js";

const STATE_QUESTION = SESSION_QUESTIONS.find((q) => q.id === SQ.STATE)!;

const STATE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "feel-good",                label: "I feel good" },
  { id: "stressed-overloaded",      label: "Stressed / overloaded" },
  { id: "low-energy",               label: "Low-energy" },
  { id: "not-feeling-like-myself",  label: "I don't really feel like myself" },
  { id: "physically-uncomfortable", label: "Physically uncomfortable" },
  { id: "self-conscious",           label: "Self-conscious" },
  { id: "going-through-change",     label: "I'm going through a change / something" },
  { id: "want-reset",               label: "I want a reset" },
  { id: "nothing-in-particular",    label: "Nothing in particular" },
  { id: "other",                    label: "Something else" },
];

const VALID_STATE_IDS = new Set(STATE_OPTIONS.map((o) => o.id));

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return redirect("/auth/login");

  const formData = await request.formData();
  const selected = formData.get("state");

  if (typeof selected !== "string" || !VALID_STATE_IDS.has(selected)) {
    return { error: "Please select how you're arriving today." };
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set(STATE_QUESTION.storageKey, selected);

  return redirect("/style-me/intention", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StatePage() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="sp-page">
      <div className="sp-header">
        <Link to="/style-me" className="sp-back">← Back</Link>
        <p className="sp-step">Step 1 of 5</p>
      </div>

      <div className="sp-content">
        <h1 className="sp-heading">How are you arriving today?</h1>
        <p className="sp-subheading">No right answer — just honest.</p>

        <Form method="post" className="sp-form">
          <div className="sp-options sp-options--state" role="radiogroup" aria-label="How are you arriving today?">
            {STATE_OPTIONS.map((option) => (
              <label key={option.id} className="sp-option sp-option--state">
                <input
                  type="radio"
                  name="state"
                  value={option.id}
                  className="sp-option__radio"
                />
                <span className="sp-option__label">{option.label}</span>
              </label>
            ))}
          </div>

          <button
            type="submit"
            className="sp-btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving…" : "Next"}
          </button>
        </Form>
      </div>
    </div>
  );
}
