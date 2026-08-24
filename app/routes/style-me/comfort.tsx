import { Form, Link } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "What you need today | nAia Style Me" }];
}
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
  { id: "waist-definition", label: "Define my waist" },
  { id: "soft-and-forgiving-around-waist", label: "Feel easy around my waist" },
  { id: "more-coverage", label: "Give me more coverage" },
  { id: "nothing-clingy", label: "Nothing clingy today" },
  { id: "structured", label: "Give me some structure" },
  { id: "elongates", label: "Create a longer line" },
  { id: "balances", label: "Balance my proportions" },
  { id: "comfortable-elevated", label: "Comfortable but still polished" },
  { id: "nothing-specific", label: "Nothing specific" },
];

const practicalOptions = [
  { id: "movement-friendly", label: "Easy to move in" },
  { id: "quick-to-style", label: "Quick to style" },
  { id: "long-day", label: "Works all day" },
  { id: "practical-footwear", label: "Shoes I can actually walk in" },
  { id: "day-to-night", label: "Day-to-night" },
];

const VALID_BODY_NEED_IDS = new Set(bodyNeedOptions.map((n) => n.id));
const VALID_PRACTICAL_IDS = new Set(practicalOptions.map((n) => n.id));
const BODY_NEEDS_MAX = 2;
const PRACTICAL_MAX = 2;

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
  const practicalRaw = formData.get("practical") as string;

  let bodyNeeds: string[] = [];
  try { bodyNeeds = JSON.parse(bodyNeedsRaw || "[]"); } catch { /* invalid JSON */ }

  let practical: string[] = [];
  try { practical = JSON.parse(practicalRaw || "[]"); } catch { /* invalid JSON */ }

  const validBodyNeeds = bodyNeeds.filter((id) => VALID_BODY_NEED_IDS.has(id)).slice(0, BODY_NEEDS_MAX);
  if (!validBodyNeeds.length) {
    return data({ error: "Please select at least one option" }, { status: 400 });
  }

  const validPractical = practical.filter((id) => VALID_PRACTICAL_IDS.has(id)).slice(0, PRACTICAL_MAX);

  const normalized = validBodyNeeds.map((id) => BODY_NEED_NORMALIZATION_MAP[id] ?? id);

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeBodyNeeds", normalized);
  session.set("styleMePractical", validPractical);

  return redirect("/style-me/occasion", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function StyleMeComfort() {
  const [selected, setSelected] = useState<string[]>([]);
  const [practicalSelected, setPracticalSelected] = useState<string[]>([]);

  // "Nothing specific" is mutually exclusive with every other Fit & Feel option —
  // picking it clears the rest; picking anything else clears it.
  const toggle = (id: string) => {
    setSelected((prev) => {
      if (id === "nothing-specific") {
        return prev.includes("nothing-specific") ? [] : ["nothing-specific"];
      }
      const withoutNothingSpecific = prev.filter((s) => s !== "nothing-specific");
      if (withoutNothingSpecific.includes(id)) {
        return withoutNothingSpecific.filter((s) => s !== id);
      }
      if (withoutNothingSpecific.length >= BODY_NEEDS_MAX) return withoutNothingSpecific;
      return [...withoutNothingSpecific, id];
    });
  };

  const togglePractical = (id: string) => {
    setPracticalSelected((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      if (prev.length >= PRACTICAL_MAX) return prev;
      return [...prev, id];
    });
  };

  const canSubmit = selected.length > 0;
  const atMax = selected.length >= BODY_NEEDS_MAX && !selected.includes("nothing-specific");
  const practicalAtMax = practicalSelected.length >= PRACTICAL_MAX;

  const groupLabelStyle: React.CSSProperties = {
    fontFamily: "var(--naia-ff-ui)",
    fontSize: "10px",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    color: "var(--naia-accent)",
    marginBottom: "10px",
    marginTop: "20px",
  };

  return (
    <SmPage backTo="/style-me/feeling" step={3}>
      <p className="sm-step-label">What You Need Today</p>
      <h1 className="sm-heading">What should the outfit do for you today?</h1>
      <p className="sm-sub">Choose what matters most today.</p>

      <Form method="post">
        <p style={{ ...groupLabelStyle, marginTop: 0 }}>
          Fit &amp; Feel
          <span style={{ color: "var(--naia-muted)", textTransform: "none", letterSpacing: 0 }}>
            {" "}— choose up to two
          </span>
        </p>
        <div className="sm-pills">
          {bodyNeedOptions.map((opt) => {
            const isSelected = selected.includes(opt.id);
            const isDisabled = !isSelected && atMax && opt.id !== "nothing-specific";
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggle(opt.id)}
                className={`sm-pill${isSelected ? " sm-pill--on" : ""}${isDisabled ? " sm-pill--off" : ""}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <p style={groupLabelStyle}>
          Practical Today
          <span style={{ color: "var(--naia-muted)", textTransform: "none", letterSpacing: 0 }}>
            {" "}— optional · choose up to two
          </span>
        </p>
        <div className="sm-pills">
          {practicalOptions.map((opt) => {
            const isSelected = practicalSelected.includes(opt.id);
            const isDisabled = !isSelected && practicalAtMax;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => togglePractical(opt.id)}
                className={`sm-pill${isSelected ? " sm-pill--on" : ""}${isDisabled ? " sm-pill--off" : ""}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <input type="hidden" name="bodyNeeds" value={JSON.stringify(selected)} />
        <input type="hidden" name="practical" value={JSON.stringify(practicalSelected)} />
        <div className="sm-step-buttons">
          <Link to="/style-me/feeling" className="sm-btn-back">← Back</Link>
          <SmContinue disabled={!canSubmit} />
        </div>
      </Form>
    </SmPage>
  );
}
