// app/routes/style-me/physical-need.tsx
// Rev 3 Screen 3 — "Any physical comfort needs right now?"
// Max 2 selections. "nothing-specific" is exclusive (clears other selections).
// Normalizes Rev 3 IDs via BODY_NEED_NORMALIZATION_MAP before storing in styleMeBodyNeeds.
// Context-only IDs (softer-easier-fabrics, still-want-shape) pass through unchanged.
// Canonical pass-through IDs (more-coverage, waist-definition) pass through as engine IDs.

import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { BODY_NEED_NORMALIZATION_MAP } from "~/lib/ai/signal-contract.js";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const MAX_SELECTIONS = 2;

const PHYSICAL_NEED_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "nothing-tight-waist",   label: "Nothing tight around my waist" },
  { id: "less-body-conscious",   label: "Nothing too body-hugging" },
  { id: "more-coverage",         label: "More coverage" },
  { id: "softer-easier-fabrics", label: "Softer / easier fabrics" },
  { id: "loose-comfortable",     label: "Loose and comfortable" },
  { id: "still-want-shape",      label: "I still want shape" },
  { id: "waist-definition",      label: "I want waist definition" },
  { id: "structured-shape",      label: "I want a sharper / more structured shape" },
  { id: "nothing-specific",      label: "Nothing specific" },
];

const VALID_IDS = new Set(PHYSICAL_NEED_OPTIONS.map((o) => o.id));
const EXCLUSIVE_ID = "nothing-specific";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  // Read the raw (pre-normalization) IDs stored for back-navigation hydration.
  // styleMeBodyNeeds holds the normalized engine IDs and is NOT used here because
  // 3 of the 8 Rev 3 UI IDs normalize to different canonical values:
  //   nothing-tight-waist → soft-and-forgiving-around-waist
  //   less-body-conscious  → relaxed
  //   loose-comfortable    → relaxed
  // Reading those canonical IDs back would fail to match any UI option.
  const raw = session.get("styleMeBodyNeedsRaw") as string | undefined;
  let stored: string[] = [];
  if (raw) {
    try { stored = JSON.parse(raw); } catch { stored = []; }
  }
  const selected = stored.filter((id) => VALID_IDS.has(id));
  return { selected };
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return redirect("/auth/login");

  const formData = await request.formData();
  const raw = formData
    .getAll("physicalNeeds")
    .filter((v): v is string => typeof v === "string" && VALID_IDS.has(v));

  // nothing-specific is exclusive
  const selected = raw.includes(EXCLUSIVE_ID) ? [EXCLUSIVE_ID] : raw;

  if (selected.length === 0) {
    return { error: "Please choose at least one physical need, or choose 'Nothing specific'." };
  }

  if (selected.length > MAX_SELECTIONS) {
    return { error: `Please choose up to ${MAX_SELECTIONS} physical needs.` };
  }

  // Store raw Rev 3 UI IDs for back-navigation hydration (before normalization).
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeBodyNeedsRaw", JSON.stringify(selected));

  // Normalize Rev 3 IDs to canonical engine signals (what the engine reads).
  const normalized = selected.map((id) => BODY_NEED_NORMALIZATION_MAP[id] ?? id);
  session.set("styleMeBodyNeeds", JSON.stringify(normalized));

  return redirect("/style-me/occasion", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function PhysicalNeedPage() {
  const { selected: initialSelected } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (id === EXCLUSIVE_ID) return prev.includes(EXCLUSIVE_ID) ? [] : [EXCLUSIVE_ID];
      const withoutExclusive = prev.filter((x) => x !== EXCLUSIVE_ID);
      if (withoutExclusive.includes(id)) return withoutExclusive.filter((x) => x !== id);
      if (withoutExclusive.length >= MAX_SELECTIONS) return withoutExclusive;
      return [...withoutExclusive, id];
    });
  };

  return (
    <SmPage step={3}>
      <p className="sm-step-label">Physical Comfort</p>
      <h1 className="sm-heading">Any fit or comfort needs right now?</h1>
      <p className="sm-sub">Choose up to {MAX_SELECTIONS}.</p>

      <Form method="post">
        <div className="sm-pills">
          {PHYSICAL_NEED_OPTIONS.map((option) => (
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
          <input key={id} type="hidden" name="physicalNeeds" value={id} />
        ))}
        <div className="sm-step-buttons">
          <Link to="/style-me/intention" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={selected.length === 0} />
        </div>
      </Form>
    </SmPage>
  );
}
