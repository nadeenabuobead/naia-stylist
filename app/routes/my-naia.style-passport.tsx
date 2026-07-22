import { useMemo, useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type SectionKey = "personalities" | "lifestyle" | "fit" | "coverage" | "colour" | "explicit";

type Section = {
  key: SectionKey;
  label: string;
  question: string;
  helper: string;
  options: string[];
  multi?: boolean;
};

const SECTIONS: Section[] = [
  {
    key: "personalities",
    label: "Style Personalities",
    question: "Which style personalities feel closest to you right now?",
    helper: "Select up to two. nAia blends them into your recommendations.",
    options: ["Editorial Minimalist","Sculptural Romantic","Quiet Luxury","Neo-Classic","Modern Bohemian","Avant-Garde"],
    multi: true,
  },
  {
    key: "lifestyle",
    label: "Lifestyle",
    question: "Where does your wardrobe need to show up most often?",
    helper: "Choose the settings you dress for on a normal week.",
    options: ["Studio","Office","Evening","Travel","Weekend","Occasion"],
    multi: true,
  },
  {
    key: "fit",
    label: "Fit Preferences",
    question: "How do you like your pieces to sit on the body?",
    helper: "This shapes how nAia interprets tailoring and volume.",
    options: ["Relaxed at shoulder · Tailored at waist","Fully tailored","Fluid and draped","Soft oversized"],
  },
  {
    key: "coverage",
    label: "Coverage Preferences",
    question: "What coverage feels most like you?",
    helper: "nAia respects this across every recommendation.",
    options: ["Modest neckline · Fluid hemline","Modest throughout","Balanced","Open and expressive"],
  },
  {
    key: "colour",
    label: "Colour Direction",
    question: "Which palette should nAia lean into for you?",
    helper: "Pick the tones you want to see returning across looks.",
    options: ["Ivory · Chocolate · Mocha · Lipstick","Ivory · Black · Silver","Warm neutrals only","Deep saturated tones","Soft pastels"],
  },
  {
    key: "explicit",
    label: "Explicit Preferences",
    question: "Anything nAia should always avoid?",
    helper: "Fabrics, silhouettes or details you never want suggested.",
    options: ["No sheer fabrics","No mini lengths","No sleeveless","No bold prints","No fur or feathers","No restrictions"],
    multi: true,
  },
];

const INITIAL_ANSWERS: Record<SectionKey, string[]> = {
  personalities: ["Editorial Minimalist","Sculptural Romantic"],
  lifestyle: ["Studio","Evening","Travel"],
  fit: ["Relaxed at shoulder · Tailored at waist"],
  coverage: ["Modest neckline · Fluid hemline"],
  colour: ["Ivory · Chocolate · Mocha · Lipstick"],
  explicit: [],
};

type Mode =
  | { kind: "overview" }
  | { kind: "flow"; queue: SectionKey[]; index: number; done?: boolean }
  | { kind: "picker" };

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  return { firstName: customer.firstName ?? null };
}

export default function StylePassportPage() {
  useLoaderData<typeof loader>();
  const [answers, setAnswers] = useState<Record<SectionKey, string[]>>(INITIAL_ANSWERS);
  const [mode, setMode] = useState<Mode>({ kind: "overview" });
  const [draft, setDraft] = useState<string[]>([]);

  const missing = useMemo(
    () => SECTIONS.filter((s) => answers[s.key].length === 0).map((s) => s.key),
    [answers],
  );
  const isComplete = missing.length === 0;

  function startContinue() {
    if (missing.length === 0) return;
    setDraft(answers[missing[0]]);
    setMode({ kind: "flow", queue: missing, index: 0 });
  }

  function startUpdate() {
    setMode({ kind: "picker" });
  }

  function editSection(key: SectionKey) {
    setDraft(answers[key]);
    setMode({ kind: "flow", queue: [key], index: 0 });
  }

  function toggleDraft(option: string, multi?: boolean) {
    if (multi) {
      setDraft((d) => (d.includes(option) ? d.filter((v) => v !== option) : [...d, option]));
    } else {
      setDraft([option]);
    }
  }

  function saveAndExit(currentKey: SectionKey) {
    setAnswers((a) => ({ ...a, [currentKey]: draft }));
    setMode({ kind: "overview" });
  }

  function goBack(flow: Extract<Mode, { kind: "flow" }>) {
    if (flow.index === 0) { setMode({ kind: "overview" }); return; }
    const prevKey = flow.queue[flow.index - 1];
    setAnswers((a) => ({ ...a, [flow.queue[flow.index]]: draft }));
    setDraft(answers[prevKey]);
    setMode({ ...flow, index: flow.index - 1 });
  }

  function goContinue(flow: Extract<Mode, { kind: "flow" }>) {
    const currentKey = flow.queue[flow.index];
    const nextAnswers = { ...answers, [currentKey]: draft };
    setAnswers(nextAnswers);
    if (flow.index + 1 >= flow.queue.length) {
      setMode({ kind: "flow", queue: flow.queue, index: flow.index, done: true });
      return;
    }
    setDraft(nextAnswers[flow.queue[flow.index + 1]]);
    setMode({ ...flow, index: flow.index + 1 });
  }

  /* ---------- Completion ---------- */
  if (mode.kind === "flow" && mode.done) {
    return (
      <MyNaiaLayout>
        <div className="mn-page-sections">
          <Link to="/my-naia" className="mn-back-link"><span aria-hidden="true">←</span> Back to Overview</Link>
          <section>
            <div className="mn-eyebrow">Style Passport</div>
            <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(1.875rem,5vw,2.5rem)", lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Your Style Passport is up to date
            </h1>
            <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              nAia has your latest preferences. You can revisit any answer at any time.
            </p>
          </section>
          <div>
            <button type="button" className="mn-btn-primary" onClick={() => setMode({ kind: "overview" })}>
              Return to Passport
            </button>
          </div>
        </div>
      </MyNaiaLayout>
    );
  }

  /* ---------- Flow ---------- */
  if (mode.kind === "flow") {
    const currentKey = mode.queue[mode.index];
    const section = SECTIONS.find((s) => s.key === currentKey)!;
    const stepNum = mode.index + 1;
    const stepTotal = mode.queue.length;
    const canContinue = draft.length > 0;

    return (
      <MyNaiaLayout>
        <div className="mn-page-sections">
          <button
            type="button"
            onClick={() => saveAndExit(currentKey)}
            style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", background: "none", border: "none", cursor: "pointer", color: "var(--fg-70)", textDecoration: "underline", textUnderlineOffset: "3px" }}
          >
            ← Save and exit
          </button>

          <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "1.5rem" }}>
            <div className="mn-eyebrow">
              Step {stepNum} of {stepTotal} · {section.label}
            </div>
            <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1rem", fontSize: "clamp(1.875rem,5vw,2.5rem)", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase" }}>
              {section.question}
            </h2>
            <p style={{ marginTop: "0.75rem", maxWidth: "36rem", fontSize: "0.85rem", lineHeight: 1.625, color: "var(--fg-70)" }}>
              {section.helper}
            </p>
          </section>

          <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))" }}>
            {section.options.map((opt) => {
              const active = draft.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleDraft(opt, section.multi)}
                  style={{
                    border: `1px solid ${active ? "var(--lipstick)" : "var(--fg-15)"}`,
                    background: active ? "oklch(0.36 0.11 18 / 0.05)" : "transparent",
                    padding: "0.75rem 1rem",
                    textAlign: "left",
                    fontSize: "0.85rem",
                    lineHeight: 1.5,
                    color: "var(--fg-85)",
                    cursor: "pointer",
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
            <button type="button" className="mn-btn-outline" onClick={() => goBack(mode)}>Back</button>
            <button
              type="button"
              className="mn-btn-primary"
              disabled={!canContinue}
              style={{ opacity: canContinue ? 1 : 0.5, cursor: canContinue ? "pointer" : "not-allowed" }}
              onClick={() => canContinue && goContinue(mode)}
            >
              {mode.index + 1 === mode.queue.length ? "Finish" : "Continue"}
            </button>
            <button
              type="button"
              onClick={() => saveAndExit(currentKey)}
              style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.28em", background: "none", border: "none", cursor: "pointer", color: "var(--fg-70)", textDecoration: "underline", textUnderlineOffset: "3px" }}
            >
              Save and exit
            </button>
          </div>
        </div>
      </MyNaiaLayout>
    );
  }

  /* ---------- Picker ---------- */
  if (mode.kind === "picker") {
    return (
      <MyNaiaLayout>
        <div className="mn-page-sections">
          <button
            type="button"
            onClick={() => setMode({ kind: "overview" })}
            style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", background: "none", border: "none", cursor: "pointer", color: "var(--fg-70)", textDecoration: "underline", textUnderlineOffset: "3px" }}
          >
            ← Back to Passport
          </button>

          <section>
            <div className="mn-eyebrow">Update Answers</div>
            <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(1.875rem,5vw,2.5rem)", lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>
              Which section would you like to edit?
            </h1>
            <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              Choose any section below. All other answers stay exactly as they are.
            </p>
          </section>

          <ul style={{ listStyle: "none", padding: 0 }}>
            {SECTIONS.map((s) => {
              const value = answers[s.key];
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => editSection(s.key)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem",
                      width: "100%",
                      padding: "1rem 0",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--fg-10)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{s.label}</span>
                    <span style={{ fontSize: "0.9rem", color: value.length > 0 ? "var(--fg-85)" : "var(--lipstick)" }}>
                      {value.length > 0 ? value.join(" · ") : "Not yet answered"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </MyNaiaLayout>
    );
  }

  /* ---------- Overview ---------- */
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link"><span aria-hidden="true">←</span> Back to Overview</Link>

        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div className="mn-eyebrow">Style Passport</div>
              <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(1.875rem,5vw,2.5rem)", lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                Your Style Passport
              </h1>
            </div>
            <span className="mn-sample-badge">Sample</span>
          </div>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Your Style Passport guides every StyleMe recommendation. Update it whenever your
            preferences evolve — changes flow through the rest of nAia immediately.
          </p>
        </section>

        <div style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "1.5rem" }}>
          <div className="mn-eyebrow">Status</div>
          <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", color: "var(--fg-85)" }}>
            {isComplete ? "Your Style Passport is up to date." : "A few details are still missing."}
          </p>
          <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
            Last updated · 12 March 2026
          </div>
        </div>

        <ul style={{ listStyle: "none", padding: 0 }}>
          {SECTIONS.map((s) => {
            const value = answers[s.key];
            return (
              <li
                key={s.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                  borderBottom: "1px solid var(--fg-10)",
                  padding: "0.75rem 0",
                }}
              >
                <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{s.label}</span>
                <span style={{ fontSize: "0.9rem", color: value.length > 0 ? "var(--fg-85)" : "var(--lipstick)" }}>
                  {value.length > 0 ? value.join(" · ") : "Missing — please complete"}
                </span>
              </li>
            );
          })}
        </ul>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
          {!isComplete && (
            <button type="button" className="mn-btn-primary" onClick={startContinue}>
              Continue Passport
            </button>
          )}
          <button type="button" className="mn-btn-outline" onClick={startUpdate}>
            Update Answers
          </button>
        </div>

        {!isComplete && (
          <p className="mn-state-note">
            You&#8217;ll resume at <strong>{SECTIONS.find((s) => s.key === missing[0])!.label}</strong>. All previous answers are preserved.
          </p>
        )}
      </div>
    </MyNaiaLayout>
  );
}
