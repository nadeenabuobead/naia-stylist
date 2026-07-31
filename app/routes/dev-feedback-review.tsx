// app/routes/dev-feedback-review.tsx
// Phase 4B1 — Dev review screen for feedback and post-wear UI states.
// Returns 404 unless DEV_TRYON_UI_ENABLED=true.
//
// Shows all feedback UI states: immediate rating, post-wear review,
// confirmation, edit, delete, empty, and failure — no provider calls.

import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { data } from "react-router";
import type { FeedbackRating, FeedbackReason, FeedbackTarget } from "~/lib/ai/feedback-contract";
import { FEEDBACK_REASONS } from "~/lib/ai/feedback-contract";

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request: _ }: LoaderFunctionArgs) {
  const devEnabled = process.env.DEV_TRYON_UI_ENABLED === "true";
  if (!devEnabled) throw new Response("Not Found", { status: 404 });
  return data({});
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: "'Space Mono', monospace" };
const SERIF: React.CSSProperties = { fontFamily: "'Playfair Display', Georgia, serif" };
const BG = "#f4f4f1";
const DEEP = "#221516";
const MUTED = "#7a6f6a";
const ACCENT = "#8b2035";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(59,5,16,0.1)",
  padding: "28px 24px",
  marginBottom: "32px",
};

const sectionLabel: React.CSSProperties = {
  ...MONO, fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase",
  color: ACCENT, marginBottom: "10px",
};

const stateTag: React.CSSProperties = {
  ...MONO, fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase",
  color: MUTED, background: "rgba(59,5,16,0.04)",
  border: "1px solid rgba(59,5,16,0.08)", padding: "3px 8px", display: "inline-block",
  marginBottom: "16px",
};

// ── Immediate Feedback Widget ─────────────────────────────────────────────────

type FeedbackState =
  | { phase: "idle" }
  | { phase: "rating" }
  | { phase: "reasons"; rating: FeedbackRating }
  | { phase: "submitted"; rating: FeedbackRating; reasons: FeedbackReason[]; note: string }
  | { phase: "editing"; rating: FeedbackRating; reasons: FeedbackReason[]; note: string }
  | { phase: "deleted" }
  | { phase: "error" };

const RATING_LABELS: Record<FeedbackRating, string> = {
  love: "Love it",
  okay: "It's okay",
  "not-for-me": "Not for me",
};

const REASON_LABELS: Record<FeedbackReason, string> = {
  "not-my-style":        "Not my style",
  "colour-not-for-me":   "Colour is not for me",
  "fit-shape-not-for-me": "Fit or shape is not for me",
  "too-revealing":       "Too revealing",
  "too-covered":         "Too covered",
  "too-formal":          "Too formal",
  "too-casual":          "Too casual",
  "not-practical":       "Not practical",
  "already-own-similar": "I already own something similar",
  "too-expensive":       "Too expensive",
  "other":               "Other",
};

function ImmediateFeedbackWidget({
  label,
  target,
  initialState,
}: {
  label: string;
  target: FeedbackTarget;
  initialState: FeedbackState;
}) {
  const [state, setState] = useState<FeedbackState>(initialState);
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>([]);
  const [note, setNote] = useState("");

  const toggleReason = (r: FeedbackReason) =>
    setSelectedReasons(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  if (state.phase === "idle") {
    return (
      <div>
        <button
          onClick={() => setState({ phase: "rating" })}
          style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
            padding: "8px 16px", background: "none", border: "1px solid rgba(59,5,16,0.2)",
            color: MUTED, cursor: "pointer" }}
        >
          Share your thoughts
        </button>
      </div>
    );
  }

  if (state.phase === "rating") {
    return (
      <div>
        <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          color: MUTED, marginBottom: "12px" }}>
          What did you think of this {target.replace("-", " ")}?
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {(["love", "okay", "not-for-me"] as FeedbackRating[]).map(r => (
            <button
              key={r}
              onClick={() => {
                if (r === "love") {
                  setState({ phase: "submitted", rating: r, reasons: [], note: "" });
                } else {
                  setState({ phase: "reasons", rating: r });
                }
              }}
              style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
                padding: "10px 16px", background: "none", cursor: "pointer",
                border: r === "love" ? "1px solid rgba(59,5,16,0.3)" : "1px solid rgba(139,32,53,0.3)",
                color: r === "love" ? DEEP : ACCENT }}
            >
              {RATING_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (state.phase === "reasons") {
    return (
      <div>
        <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          color: MUTED, marginBottom: "12px" }}>
          What didn&apos;t feel right? (optional)
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
          {FEEDBACK_REASONS.map(r => (
            <button
              key={r}
              onClick={() => toggleReason(r)}
              style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
                padding: "6px 12px", background: selectedReasons.includes(r) ? ACCENT : "none",
                border: `1px solid ${selectedReasons.includes(r) ? ACCENT : "rgba(59,5,16,0.2)"}`,
                color: selectedReasons.includes(r) ? "#f4f4f1" : MUTED, cursor: "pointer" }}
            >
              {REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Anything else? (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          style={{ width: "100%", border: "1px solid rgba(59,5,16,0.15)", padding: "10px",
            fontFamily: "inherit", fontSize: "13px", color: DEEP, background: "none",
            resize: "vertical", marginBottom: "12px", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setState({ phase: "submitted", rating: state.rating, reasons: selectedReasons, note })}
            style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
              padding: "10px 20px", background: DEEP, color: BG, border: "none", cursor: "pointer" }}
          >
            Done
          </button>
          <button
            onClick={() => setState({ phase: "rating" })}
            style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
              padding: "10px 16px", background: "none", border: "1px solid rgba(59,5,16,0.15)",
              color: MUTED, cursor: "pointer" }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "submitted") {
    return (
      <div>
        <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          color: MUTED, marginBottom: "4px" }}>
          You said: <span style={{ color: ACCENT }}>{RATING_LABELS[state.rating]}</span>
        </div>
        {state.reasons.length > 0 && (
          <div style={{ fontSize: "12px", color: MUTED, marginBottom: "8px" }}>
            {state.reasons.map(r => REASON_LABELS[r]).join(" · ")}
          </div>
        )}
        {state.note && (
          <div style={{ fontSize: "12px", fontStyle: "italic", color: MUTED, marginBottom: "8px" }}>
            &ldquo;{state.note}&rdquo;
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            onClick={() => setState({ phase: "editing", rating: state.rating, reasons: state.reasons, note: state.note })}
            style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
              padding: "6px 12px", background: "none", border: "1px solid rgba(59,5,16,0.15)",
              color: MUTED, cursor: "pointer" }}
          >
            Edit
          </button>
          <button
            onClick={() => setState({ phase: "deleted" })}
            style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
              padding: "6px 12px", background: "none", border: "1px solid rgba(139,32,53,0.3)",
              color: ACCENT, cursor: "pointer" }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "editing") {
    return (
      <div>
        <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          color: MUTED, marginBottom: "12px" }}>
          Update your thoughts
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          {(["love", "okay", "not-for-me"] as FeedbackRating[]).map(r => (
            <button
              key={r}
              onClick={() => setState({ ...state, rating: r })}
              style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
                padding: "8px 14px", cursor: "pointer",
                background: state.rating === r ? DEEP : "none",
                border: `1px solid ${state.rating === r ? DEEP : "rgba(59,5,16,0.2)"}`,
                color: state.rating === r ? BG : MUTED }}
            >
              {RATING_LABELS[r]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setState({ phase: "submitted", rating: state.rating, reasons: state.reasons, note: state.note })}
          style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
            padding: "10px 20px", background: DEEP, color: BG, border: "none", cursor: "pointer" }}
        >
          Save changes
        </button>
      </div>
    );
  }

  if (state.phase === "deleted") {
    return (
      <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED }}>
        Feedback removed.{" "}
        <button onClick={() => setState({ phase: "idle" })}
          style={{ background: "none", border: "none", ...MONO, fontSize: "8px", color: ACCENT, cursor: "pointer", letterSpacing: "2px", textTransform: "uppercase" }}>
          Add again
        </button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div style={{ fontSize: "13px", color: ACCENT }}>
        Something went wrong saving your feedback. Please try again.
      </div>
    );
  }

  return null;
}

// ── Post-wear Review ──────────────────────────────────────────────────────────

type PostWearState = "empty" | "form" | "submitted" | "deleted";

const POST_WEAR_QUESTIONS = [
  { key: "didWearIt",      label: "Did you wear it?",          options: [["yes","Yes"],["not-yet","Not yet"],["no","No"]] },
  { key: "howDidYouFeel",  label: "How did you feel?",         options: [["great","Great"],["good","Good"],["okay","Okay"],["not-great","Not quite right"]] },
  { key: "wasComfortable", label: "Was it comfortable?",       options: [["yes","Yes"],["mostly","Mostly"],["no","No"]] },
  { key: "fitRight",       label: "Did the fit feel right?",   options: [["yes","Yes"],["mostly","Mostly"],["no","No"]] },
  { key: "coverageRight",  label: "Was the coverage right?",   options: [["yes","Yes"],["mostly","Mostly"],["no","No"]] },
  { key: "colourRight",    label: "Did the colour feel right?",options: [["yes","Yes"],["mostly","Mostly"],["no","No"]] },
  { key: "wouldWearAgain", label: "Would you wear it again?",  options: [["definitely","Definitely"],["maybe","Maybe"],["probably-not","Probably not"]] },
] as const;

function PostWearWidget({ initialState }: { initialState: PostWearState }) {
  const [state, setState] = useState<PostWearState>(initialState);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  if (state === "empty") {
    return (
      <button
        onClick={() => setState("form")}
        style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          padding: "8px 16px", background: "none", border: "1px solid rgba(59,5,16,0.2)",
          color: MUTED, cursor: "pointer" }}
      >
        Review this outfit
      </button>
    );
  }

  if (state === "form") {
    return (
      <div>
        {POST_WEAR_QUESTIONS.map(q => (
          <div key={q.key} style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "14px", color: DEEP, marginBottom: "8px" }}>{q.label}</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {q.options.map(([val, text]) => (
                <button
                  key={val}
                  onClick={() => setAnswers(prev => ({ ...prev, [q.key]: val }))}
                  style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
                    padding: "6px 14px", cursor: "pointer",
                    background: answers[q.key] === val ? DEEP : "none",
                    border: `1px solid ${answers[q.key] === val ? DEEP : "rgba(59,5,16,0.2)"}`,
                    color: answers[q.key] === val ? BG : MUTED }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ))}
        <textarea
          placeholder="Anything else? (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          style={{ width: "100%", border: "1px solid rgba(59,5,16,0.15)", padding: "10px",
            fontFamily: "inherit", fontSize: "13px", color: DEEP, background: "none",
            resize: "vertical", marginBottom: "12px", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setState("submitted")}
            style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
              padding: "10px 20px", background: DEEP, color: BG, border: "none", cursor: "pointer" }}
          >
            Submit
          </button>
          <button
            onClick={() => setState("empty")}
            style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
              padding: "10px 16px", background: "none", border: "1px solid rgba(59,5,16,0.15)",
              color: MUTED, cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (state === "submitted") {
    const answeredCount = Object.values(answers).filter(Boolean).length;
    return (
      <div>
        <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          color: MUTED, marginBottom: "8px" }}>
          Review saved — {answeredCount}/{POST_WEAR_QUESTIONS.length} questions answered
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            onClick={() => setState("form")}
            style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
              padding: "6px 12px", background: "none", border: "1px solid rgba(59,5,16,0.15)",
              color: MUTED, cursor: "pointer" }}
          >
            Edit review
          </button>
          <button
            onClick={() => setState("deleted")}
            style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
              padding: "6px 12px", background: "none", border: "1px solid rgba(139,32,53,0.3)",
              color: ACCENT, cursor: "pointer" }}
          >
            Delete review
          </button>
        </div>
      </div>
    );
  }

  if (state === "deleted") {
    return (
      <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED }}>
        Review removed.{" "}
        <button onClick={() => setState("empty")}
          style={{ background: "none", border: "none", ...MONO, fontSize: "8px", color: ACCENT, cursor: "pointer", letterSpacing: "2px", textTransform: "uppercase" }}>
          Add again
        </button>
      </div>
    );
  }

  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DevFeedbackReview() {
  useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'Cormorant Garamond', Garamond, serif", color: DEEP }}>
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "48px 24px 80px" }}>

        <div style={{ marginBottom: "48px" }}>
          <div style={sectionLabel}>Phase 4B1 · Dev Preview</div>
          <h1 style={{ ...SERIF, fontSize: "clamp(24px,4vw,36px)", fontWeight: 900,
            letterSpacing: "-0.5px", marginBottom: "8px" }}>
            Feedback & Learning — UI States
          </h1>
          <p style={{ fontSize: "15px", color: MUTED, fontStyle: "italic", lineHeight: 1.6 }}>
            All states are fixture-only. No network calls or DB writes occur here.
          </p>
        </div>

        {/* ── Section 1: Immediate feedback ─── */}
        <h2 style={{ ...SERIF, fontSize: "22px", fontWeight: 700, marginBottom: "4px" }}>
          Immediate recommendation feedback
        </h2>
        <p style={{ fontSize: "14px", color: MUTED, marginBottom: "28px" }}>
          Appears beneath each StyleMe suggestion or product.
        </p>

        <div style={card}>
          <div style={stateTag}>State: idle — not yet given feedback</div>
          <div style={{ fontSize: "15px", fontStyle: "italic", color: MUTED, marginBottom: "16px" }}>
            Silk Midi Dress — NADINE product
          </div>
          <ImmediateFeedbackWidget
            label="Silk Midi Dress"
            target="nadine-product"
            initialState={{ phase: "idle" }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: rating — showing three options</div>
          <div style={{ fontSize: "15px", fontStyle: "italic", color: MUTED, marginBottom: "16px" }}>
            Complete outfit suggestion
          </div>
          <ImmediateFeedbackWidget
            label="Complete outfit"
            target="complete-suggestion"
            initialState={{ phase: "rating" }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: reasons — not for me, with reason codes</div>
          <div style={{ fontSize: "15px", fontStyle: "italic", color: MUTED, marginBottom: "16px" }}>
            Linen Blazer — closet item
          </div>
          <ImmediateFeedbackWidget
            label="Linen Blazer"
            target="closet-item"
            initialState={{ phase: "reasons", rating: "not-for-me" }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: submitted — love it</div>
          <ImmediateFeedbackWidget
            label="Complete outfit"
            target="complete-suggestion"
            initialState={{ phase: "submitted", rating: "love", reasons: [], note: "" }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: submitted — not for me, with reasons and note</div>
          <ImmediateFeedbackWidget
            label="Silk top"
            target="nadine-product"
            initialState={{
              phase: "submitted",
              rating: "not-for-me",
              reasons: ["too-formal", "colour-not-for-me"],
              note: "I prefer something more relaxed for weekends.",
            }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: editing — updating existing feedback</div>
          <ImmediateFeedbackWidget
            label="Trench coat"
            target="closet-item"
            initialState={{ phase: "editing", rating: "okay", reasons: [], note: "" }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: deleted — feedback removed</div>
          <ImmediateFeedbackWidget
            label="Dress"
            target="nadine-product"
            initialState={{ phase: "deleted" }}
          />
        </div>

        <div style={card}>
          <div style={stateTag}>State: error — save failed</div>
          <ImmediateFeedbackWidget
            label="Dress"
            target="nadine-product"
            initialState={{ phase: "error" }}
          />
        </div>

        {/* ── Section 2: VTO feedback ─── */}
        <h2 style={{ ...SERIF, fontSize: "22px", fontWeight: 700, marginBottom: "4px", marginTop: "48px" }}>
          Virtual try-on feedback
        </h2>
        <p style={{ fontSize: "14px", color: MUTED, marginBottom: "28px" }}>
          Covers preview usefulness and garment fidelity — not physical fit accuracy.
        </p>

        <div style={card}>
          <div style={stateTag}>State: VTO — rating the preview</div>
          <VtoFeedbackWidget />
        </div>

        {/* ── Section 3: Post-wear review ─── */}
        <h2 style={{ ...SERIF, fontSize: "22px", fontWeight: 700, marginBottom: "4px", marginTop: "48px" }}>
          Post-wear review
        </h2>
        <p style={{ fontSize: "14px", color: MUTED, marginBottom: "28px" }}>
          Offered after a customer has had time to wear the outfit.
        </p>

        <div style={card}>
          <div style={stateTag}>State: empty — no review yet</div>
          <PostWearWidget initialState="empty" />
        </div>

        <div style={card}>
          <div style={stateTag}>State: form — answering questions</div>
          <PostWearWidget initialState="form" />
        </div>

        <div style={card}>
          <div style={stateTag}>State: submitted — review saved</div>
          <PostWearWidget initialState="submitted" />
        </div>

        <div style={card}>
          <div style={stateTag}>State: deleted — review removed</div>
          <PostWearWidget initialState="deleted" />
        </div>

        {/* ── Footer ─── */}
        <div style={{ paddingTop: "32px", borderTop: "1px solid rgba(59,5,16,0.07)" }}>
          <div style={{ ...MONO, fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED }}>
            Phase 4B1 — dev only · {new Date().toISOString().slice(0, 10)}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── VTO Feedback Widget ───────────────────────────────────────────────────────

function VtoFeedbackWidget() {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const VTO_OPTIONS = [
    { val: "preview-useful",            label: "The preview was useful" },
    { val: "preview-not-useful",        label: "The preview wasn't helpful" },
    { val: "garment-looks-accurate",    label: "The garment looked as expected" },
    { val: "garment-looks-inaccurate",  label: "The garment looked different than expected" },
    { val: "would-try-in-person",       label: "I'd try this on in person" },
    { val: "would-not-try-in-person",   label: "I wouldn't try it in person" },
  ];

  const toggle = (v: string) =>
    setSelected(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);

  if (submitted) {
    return (
      <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED }}>
        Thanks — your preview feedback helps us improve.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: "14px", color: DEEP, marginBottom: "12px" }}>
        How was the try-on preview?
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        {VTO_OPTIONS.map(o => (
          <button
            key={o.val}
            onClick={() => toggle(o.val)}
            style={{ ...MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase",
              padding: "6px 12px", cursor: "pointer",
              background: selected.includes(o.val) ? ACCENT : "none",
              border: `1px solid ${selected.includes(o.val) ? ACCENT : "rgba(59,5,16,0.2)"}`,
              color: selected.includes(o.val) ? "#f4f4f1" : MUTED }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => setSubmitted(true)}
        style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase",
          padding: "10px 20px", background: DEEP, color: BG, border: "none", cursor: "pointer" }}
      >
        Submit
      </button>
    </div>
  );
}
