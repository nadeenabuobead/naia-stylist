// app/routes/style-me/physical-need.tsx
// Rev 3 Screen 3 — "Any physical comfort needs right now?"
// Max 2 selections. "nothing-specific" is exclusive (clears other selections).
// Normalizes Rev 3 IDs via BODY_NEED_NORMALIZATION_MAP before storing in styleMeBodyNeeds.
// Context-only IDs (softer-easier-fabrics, still-want-shape) pass through unchanged.
// Canonical pass-through IDs (more-coverage, waist-definition) pass through as engine IDs.

import { Form, Link, redirect, useNavigation } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { BODY_NEED_NORMALIZATION_MAP } from "~/lib/ai/signal-contract.js";

const MAX_SELECTIONS = 2;

const PHYSICAL_NEED_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "nothing-tight-waist",   label: "Nothing tight around my waist" },
  { id: "less-body-conscious",   label: "Less body-conscious" },
  { id: "more-coverage",         label: "More coverage" },
  { id: "softer-easier-fabrics", label: "Softer / easier fabrics" },
  { id: "loose-comfortable",     label: "Loose and comfortable" },
  { id: "still-want-shape",      label: "I still want shape" },
  { id: "waist-definition",      label: "I want waist definition" },
  { id: "nothing-specific",      label: "Nothing specific" },
];

const VALID_IDS = new Set(PHYSICAL_NEED_OPTIONS.map((o) => o.id));
const EXCLUSIVE_ID = "nothing-specific";

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return redirect("/auth/login");

  const formData = await request.formData();
  const raw = formData
    .getAll("physicalNeeds")
    .filter((v): v is string => typeof v === "string" && VALID_IDS.has(v));

  // nothing-specific is exclusive
  const selected = raw.includes(EXCLUSIVE_ID) ? [EXCLUSIVE_ID] : raw;

  if (selected.length > MAX_SELECTIONS) {
    return { error: `Please choose up to ${MAX_SELECTIONS} physical needs.` };
  }

  // Normalize Rev 3 IDs to canonical engine signals
  const normalized = selected.map((id) => BODY_NEED_NORMALIZATION_MAP[id] ?? id);

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeBodyNeeds", JSON.stringify(normalized));

  return redirect("/style-me/occasion", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function PhysicalNeedPage() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="sp-page">
      <div className="sp-header">
        <Link to="/style-me/intention" className="sp-back">← Back</Link>
        <p className="sp-step">Step 3 of 5</p>
      </div>

      <div className="sp-content">
        <h1 className="sp-heading">Any physical comfort needs right now?</h1>
        <p className="sp-subheading">Choose up to {MAX_SELECTIONS}, or skip.</p>

        <Form method="post" className="sp-form">
          <div className="sp-options sp-options--physical-need" role="group" aria-label="Physical comfort needs">
            {PHYSICAL_NEED_OPTIONS.map((option) => (
              <label key={option.id} className="sp-option sp-option--chip">
                <input
                  type="checkbox"
                  name="physicalNeeds"
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
