// app/routes/style-me/physical-need.tsx
// Rev 3 Screen 3 — "Any fit or comfort preferences today?"
// Max 2 selections. "nothing-specific" is exclusive (clears other selections).
// Options (IDs + labels) live in ~/lib/styleme/session-vocabulary. Labels are
// display copy; the IDs below carry the QA-tested body-need semantics.
// Canonical Rev3 IDs are stored verbatim in styleMeBodyNeeds (no normalization).
// Legacy normalization happens only in comfort.tsx and quick-style for backward compat.

import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { getSession, commitSession } from "~/lib/session.server.js";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  STYLEME_FIT_COMFORT_OPTIONS,
  STYLEME_FIT_COMFORT_EXCLUSIVE_ID,
} from "~/lib/styleme/session-vocabulary";
import { SmPage } from "~/components/style-me/SmPage";
import { SmContinue } from "~/components/style-me/SmContinue";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const MAX_SELECTIONS = 2;

const PHYSICAL_NEED_OPTIONS = STYLEME_FIT_COMFORT_OPTIONS;

const VALID_IDS = new Set(PHYSICAL_NEED_OPTIONS.map((o) => o.id));
const EXCLUSIVE_ID = STYLEME_FIT_COMFORT_EXCLUSIVE_ID;

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
    return { error: "Please choose at least one fit or comfort preference, or choose 'No specific preference'." };
  }

  if (selected.length > MAX_SELECTIONS) {
    return { error: `Please choose up to ${MAX_SELECTIONS} fit or comfort preferences.` };
  }

  // Store raw canonical IDs for back-navigation hydration.
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeBodyNeedsRaw", JSON.stringify(selected));
  // Store canonical Rev3 IDs verbatim — engine reads them directly.
  session.set("styleMeBodyNeeds", JSON.stringify(selected));

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
      <p className="sm-step-label">Fit / Comfort</p>
      <h1 className="sm-heading">Any fit or comfort preferences today?</h1>
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
