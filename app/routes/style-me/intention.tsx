// app/routes/style-me/intention.tsx
// Rev 3 Screen 2 — "What do you want your clothes to do today?"
// Max 2 selections. Writes styleMeIntentions to session cookie.
// SCORING NOTE: translated in result.tsx to canonical engine signals before engine input.

import { Form, Link, redirect, useNavigation } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { SESSION_QUESTIONS, SESSION_QUESTION_IDS as SQ } from "~/lib/ai/signal-contract.js";

const INTENTION_QUESTION = SESSION_QUESTIONS.find((q) => q.id === SQ.INTENTIONS)!;
const MAX_SELECTIONS = INTENTION_QUESTION.maxSelections ?? 2;

const INTENTION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "feel-like-myself",   label: "Help me feel like myself" },
  { id: "confidence",         label: "Give me confidence" },
  { id: "ground-me",          label: "Ground me" },
  { id: "give-structure",     label: "Give me structure" },
  { id: "make-it-easy",       label: "Make things feel easy" },
  { id: "feel-put-together",  label: "Help me feel put together" },
  { id: "feel-attractive",    label: "Make me feel attractive" },
  { id: "give-energy",        label: "Give me energy" },
  { id: "feel-softer",        label: "Help me feel softer" },
  { id: "feel-less-exposed",  label: "Help me feel less exposed" },
  { id: "express-myself",     label: "Let me express myself" },
];

const VALID_INTENTION_IDS = new Set(INTENTION_OPTIONS.map((o) => o.id));

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
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="sp-page">
      <div className="sp-header">
        <Link to="/style-me/state" className="sp-back">← Back</Link>
        <p className="sp-step">Step 2 of 5</p>
      </div>

      <div className="sp-content">
        <h1 className="sp-heading">What do you want your clothes to do today?</h1>
        <p className="sp-subheading">Choose up to {MAX_SELECTIONS}.</p>

        <Form method="post" className="sp-form">
          <div className="sp-options sp-options--intention" role="group" aria-label="What do you want your clothes to do today?">
            {INTENTION_OPTIONS.map((option) => (
              <label key={option.id} className="sp-option sp-option--chip">
                <input
                  type="checkbox"
                  name="intentions"
                  value={option.id}
                  className="sp-option__checkbox"
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
