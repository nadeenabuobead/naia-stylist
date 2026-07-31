// app/routes/post-wear-review.tsx
// Phase 4B1 — Customer-facing post-wear review page.
//
// Access: authenticated customers only. Unauthenticated → redirect to login.
// Ownership: the session must belong to the authenticated customer.
// Migration guard: if the Phase 4B1 DB migration has not been applied, the page
//   renders with migrationPending=true and shows a "not yet available" notice.
//   No data is lost; the page is safe to expose before the migration runs.

import { useState, useEffect } from "react";
import {
  useLoaderData,
  useFetcher,
  redirect,
  data,
  type LinksFunction,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import {
  upsertPostWearReview,
  loadPostWearReview,
  deletePostWearReview,
} from "~/lib/ai/feedback-persistence.server";
import type {
  PostWearAnswers,
  WoreItAnswer,
  FeelingAnswer,
  ComfortAnswer,
  WearAgainAnswer,
} from "~/lib/ai/feedback-contract";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

// ── Answer sets (must match feedback-contract types) ──────────────────────────

const WORE_IT_VALUES   = new Set<string>(["yes", "not-yet", "no"]);
const FEELING_VALUES   = new Set<string>(["great", "good", "okay", "not-great"]);
const COMFORT_VALUES   = new Set<string>(["yes", "mostly", "no"]);
const WEAR_AGAIN_VALUES = new Set<string>(["definitely", "maybe", "probably-not"]);

function pick<T>(val: unknown, allowed: Set<string>): T | null {
  return typeof val === "string" && allowed.has(val) ? (val as T) : null;
}

function parseAnswers(body: Record<string, unknown>): PostWearAnswers {
  return {
    didWearIt:      pick<WoreItAnswer>(body.didWearIt, WORE_IT_VALUES),
    howDidYouFeel:  pick<FeelingAnswer>(body.howDidYouFeel, FEELING_VALUES),
    wasComfortable: pick<ComfortAnswer>(body.wasComfortable, COMFORT_VALUES),
    fitRight:       pick<ComfortAnswer>(body.fitRight, COMFORT_VALUES),
    coverageRight:  pick<ComfortAnswer>(body.coverageRight, COMFORT_VALUES),
    colourRight:    pick<ComfortAnswer>(body.colourRight, COMFORT_VALUES),
    wouldWearAgain: pick<WearAgainAnswer>(body.wouldWearAgain, WEAR_AGAIN_VALUES),
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
}

// ── Session shape (public-safe subset) ───────────────────────────────────────

interface SessionSummary {
  id: string;
  outfitName: string | null;
  currentMood: string | null;
  occasion: string | null;
}

export function meta() {
  return [{ title: "Post-Wear Review | nAia" }];
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    const returnTo = encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search);
    throw redirect(`/auth/shopify/login?return_to=${returnTo}`);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return data({ error: "sessionId required", session: null, review: null, migrationPending: false });
  }

  // Load the session and verify ownership
  const stylingSession = await prisma.stylingSession.findUnique({
    where: { id: sessionId },
    include: { suggestions: { take: 1, orderBy: { createdAt: "asc" } } },
  }).catch(() => null);

  if (!stylingSession || stylingSession.customerId !== customer.id) {
    return data(
      { error: "Not found", session: null, review: null, migrationPending: false },
      { status: 404 },
    );
  }

  const session: SessionSummary = {
    id: stylingSession.id,
    outfitName: stylingSession.suggestions[0]?.outfitName ?? null,
    currentMood: stylingSession.currentMood,
    occasion: stylingSession.occasion,
  };

  // Try to load existing review — catch migration-not-applied error gracefully
  let review: PostWearAnswers | null = null;
  let migrationPending = false;
  try {
    review = await loadPostWearReview(sessionId, customer.id);
  } catch (err: any) {
    if (
      err?.code === "P2021" ||
      err?.code === "P2022" ||
      err?.message?.includes("column") ||
      err?.message?.includes("Unknown field")
    ) {
      migrationPending = true;
    } else {
      throw err;
    }
  }

  return data({ error: null, session, review, migrationPending });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return data({ error: "invalid-body" }, { status: 400 });
  }

  const { _intent, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string") {
    return data({ error: "sessionId required" }, { status: 400 });
  }

  // Verify session ownership before any write
  const session = await prisma.stylingSession.findUnique({ where: { id: sessionId } });
  if (!session || session.customerId !== customer.id) {
    return data({ error: "not-found" }, { status: 404 });
  }

  if (_intent === "delete") {
    try {
      const result = await deletePostWearReview(sessionId, customer.id);
      if (!result.ok) return data({ error: result.errorCode ?? "not-found" }, { status: 404 });
      return data({ ok: true });
    } catch {
      return data({ error: "failed-to-delete" }, { status: 500 });
    }
  }

  // submit (default)
  const answers = parseAnswers(body as Record<string, unknown>);
  try {
    const result = await upsertPostWearReview(sessionId, customer.id, answers);
    if (!result.ok) return data({ error: result.errorCode ?? "failed" }, { status: 500 });
    return data({ ok: true });
  } catch (err: any) {
    if (
      err?.code === "P2021" ||
      err?.code === "P2022" ||
      err?.message?.includes("Unknown field")
    ) {
      return data({ error: "migration-pending" }, { status: 503 });
    }
    return data({ error: "failed-to-submit" }, { status: 500 });
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO = "var(--naia-ff-mono, 'Courier New', monospace)";
const SERIF_DISPLAY = "var(--naia-ff-display, 'Playfair Display', Georgia, serif)";
const SERIF_BODY = "var(--naia-ff-body, 'Cormorant Garamond', Garamond, serif)";

// ── Component ─────────────────────────────────────────────────────────────────

type ReviewPhase = "form" | "submitted" | "editing" | "deleted";

export default function PostWearReviewPage() {
  const { error, session, review, migrationPending } = useLoaderData<typeof loader>();

  const [phase, setPhase] = useState<ReviewPhase>(() => review ? "submitted" : "form");
  const [didWearIt, setDidWearIt]       = useState<string | null>(review?.didWearIt ?? null);
  const [howFelt, setHowFelt]           = useState<string | null>(review?.howDidYouFeel ?? null);
  const [comfortable, setComfortable]   = useState<string | null>(review?.wasComfortable ?? null);
  const [fit, setFit]                   = useState<string | null>(review?.fitRight ?? null);
  const [coverage, setCoverage]         = useState<string | null>(review?.coverageRight ?? null);
  const [colour, setColour]             = useState<string | null>(review?.colourRight ?? null);
  const [wearAgain, setWearAgain]       = useState<string | null>(review?.wouldWearAgain ?? null);
  const [note, setNote]                 = useState(review?.note ?? "");
  const [apiError, setApiError]         = useState<string | null>(null);

  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    if (d.error === "migration-pending") {
      setApiError("This feature requires a database update that hasn't been applied yet.");
      return;
    }
    if (d.error) {
      setApiError("Something went wrong — please try again.");
      return;
    }
    if (d.ok) {
      if (phase === "editing" || phase === "form") setPhase("submitted");
      setApiError(null);
    }
  }, [fetcher.data, phase]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const buildSubmitBody = () => ({
    _intent: "submit",
    sessionId: session!.id,
    didWearIt,
    howDidYouFeel: howFelt,
    wasComfortable: comfortable,
    fitRight: fit,
    coverageRight: coverage,
    colourRight: colour,
    wouldWearAgain: wearAgain,
    note: note.trim() || null,
  });

  const handleSubmit = () => {
    if (!session || isSubmitting) return;
    setApiError(null);
    fetcher.submit(buildSubmitBody(), {
      method: "post",
      encType: "application/json",
    });
  };

  const handleDelete = () => {
    if (!session || isSubmitting) return;
    setApiError(null);
    fetcher.submit(
      { _intent: "delete", sessionId: session.id },
      { method: "post", encType: "application/json" },
    );
    setPhase("deleted");
  };

  // ── Layout helpers ────────────────────────────────────────────────────────

  const RadioRow = ({
    label, options, value, onChange,
  }: {
    label: string;
    options: { value: string; label: string }[];
    value: string | null;
    onChange: (v: string) => void;
  }) => (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--naia-accent, #8b2035)", marginBottom: "10px" }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: "8px 18px",
              border: value === o.value ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.12)",
              background: value === o.value ? "rgba(139,32,53,0.08)" : "transparent",
              color: value === o.value ? "var(--naia-accent, #8b2035)" : "var(--naia-ink, #221516)",
              fontFamily: SERIF_BODY,
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render: error / not-found ─────────────────────────────────────────────

  if (error || !session) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--naia-bg, #f4f4f1)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center", maxWidth: "480px" }}>
          <h1 style={{ fontFamily: SERIF_DISPLAY, fontSize: "28px", fontWeight: 900, color: "var(--naia-ink, #221516)", marginBottom: "12px" }}>Look not found</h1>
          <p style={{ fontFamily: SERIF_BODY, fontSize: "17px", fontStyle: "italic", color: "var(--naia-muted, #7a6f6a)" }}>
            {error === "sessionId required" ? "No styling session was provided." : "This look couldn't be found."}
          </p>
        </div>
      </div>
    );
  }

  // ── Render: migration pending ─────────────────────────────────────────────

  if (migrationPending) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--naia-bg, #f4f4f1)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center", maxWidth: "480px" }}>
          <h1 style={{ fontFamily: SERIF_DISPLAY, fontSize: "28px", fontWeight: 900, color: "var(--naia-ink, #221516)", marginBottom: "12px" }}>Coming soon</h1>
          <p style={{ fontFamily: SERIF_BODY, fontSize: "17px", fontStyle: "italic", color: "var(--naia-muted, #7a6f6a)" }}>
            Post-wear feedback will be available shortly. Come back after wearing your look.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: deleted ───────────────────────────────────────────────────────

  if (phase === "deleted") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--naia-bg, #f4f4f1)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center", maxWidth: "480px" }}>
          <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "3px", textTransform: "uppercase", color: "var(--naia-muted, #7a6f6a)", marginBottom: "16px" }}>Feedback removed</div>
          <p style={{ fontFamily: SERIF_BODY, fontSize: "17px", fontStyle: "italic", color: "var(--naia-muted, #7a6f6a)" }}>Your review has been deleted.</p>
        </div>
      </div>
    );
  }

  // ── Render: submitted (summary view) ─────────────────────────────────────

  if (phase === "submitted") {
    const labelOf = (val: string | null, opts: { value: string; label: string }[]) =>
      opts.find((o) => o.value === val)?.label ?? "—";
    const woreOpts = [{ value: "yes", label: "Yes" }, { value: "not-yet", label: "Not yet" }, { value: "no", label: "No" }];
    const feltOpts = [{ value: "great", label: "Great" }, { value: "good", label: "Good" }, { value: "okay", label: "Okay" }, { value: "not-great", label: "Not great" }];
    const comfortOpts = [{ value: "yes", label: "Yes" }, { value: "mostly", label: "Mostly" }, { value: "no", label: "No" }];
    const againOpts = [{ value: "definitely", label: "Definitely" }, { value: "maybe", label: "Maybe" }, { value: "probably-not", label: "Probably not" }];

    return (
      <div style={{ minHeight: "100vh", background: "var(--naia-bg, #f4f4f1)" }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "48px 40px 80px" }}>
          <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "3px", textTransform: "uppercase", color: "var(--naia-accent, #8b2035)", marginBottom: "12px" }}>Post-wear review</div>
          <h1 style={{ fontFamily: SERIF_DISPLAY, fontSize: "28px", fontWeight: 900, color: "var(--naia-ink, #221516)", marginBottom: "32px" }}>
            {session.outfitName ?? "Your look"}
          </h1>

          {[
            { label: "Did you wear it?",        val: labelOf(didWearIt, woreOpts) },
            { label: "How did you feel?",        val: labelOf(howFelt, feltOpts) },
            { label: "Was it comfortable?",      val: labelOf(comfortable, comfortOpts) },
            { label: "Did it fit right?",        val: labelOf(fit, comfortOpts) },
            { label: "Was the coverage right?",  val: labelOf(coverage, comfortOpts) },
            { label: "Was the colour right?",    val: labelOf(colour, comfortOpts) },
            { label: "Would you wear it again?", val: labelOf(wearAgain, againOpts) },
          ].map(({ label, val }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
              <span style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase", color: "var(--naia-muted, #7a6f6a)" }}>{label}</span>
              <span style={{ fontFamily: SERIF_BODY, fontSize: "16px", color: "var(--naia-ink, #221516)" }}>{val}</span>
            </div>
          ))}

          {note && (
            <div style={{ marginTop: "16px", padding: "14px 16px", background: "rgba(59,5,16,0.02)" }}>
              <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase", color: "var(--naia-muted, #7a6f6a)", marginBottom: "6px" }}>Note</div>
              <p style={{ fontFamily: SERIF_BODY, fontSize: "16px", color: "var(--naia-muted, #7a6f6a)", margin: 0 }}>{note}</p>
            </div>
          )}

          {apiError && (
            <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "1px", color: "var(--naia-accent, #8b2035)", marginTop: "16px" }}>{apiError}</div>
          )}

          <div style={{ display: "flex", gap: "12px", marginTop: "32px" }}>
            <button
              onClick={() => setPhase("editing")}
              style={{ padding: "10px 24px", border: "1px solid rgba(59,5,16,0.12)", background: "transparent", fontFamily: MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", color: "var(--naia-ink, #221516)" }}
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={isSubmitting}
              style={{ padding: "10px 24px", border: "none", background: "transparent", fontFamily: MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", color: "var(--naia-muted, #7a6f6a)" }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: form (new or editing) ─────────────────────────────────────────

  const woreOptions     = [{ value: "yes", label: "Yes" }, { value: "not-yet", label: "Not yet" }, { value: "no", label: "No" }];
  const feltOptions     = [{ value: "great", label: "Great" }, { value: "good", label: "Good" }, { value: "okay", label: "Okay" }, { value: "not-great", label: "Not great" }];
  const comfortOptions  = [{ value: "yes", label: "Yes" }, { value: "mostly", label: "Mostly" }, { value: "no", label: "No" }];
  const againOptions    = [{ value: "definitely", label: "Definitely" }, { value: "maybe", label: "Maybe" }, { value: "probably-not", label: "Probably not" }];

  return (
    <div style={{ minHeight: "100vh", background: "var(--naia-bg, #f4f4f1)" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "48px 40px 80px" }}>
        <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "3px", textTransform: "uppercase", color: "var(--naia-accent, #8b2035)", marginBottom: "12px" }}>Post-wear review</div>
        <h1 style={{ fontFamily: SERIF_DISPLAY, fontSize: "28px", fontWeight: 900, color: "var(--naia-ink, #221516)", marginBottom: "8px" }}>
          {session.outfitName ?? "Your look"}
        </h1>
        {session.currentMood && (
          <p style={{ fontFamily: SERIF_BODY, fontSize: "17px", fontStyle: "italic", color: "var(--naia-muted, #7a6f6a)", marginBottom: "36px" }}>
            {session.currentMood}{session.occasion ? ` · ${session.occasion}` : ""}
          </p>
        )}

        <RadioRow label="Did you wear it?"        options={woreOptions}    value={didWearIt}    onChange={setDidWearIt} />
        <RadioRow label="How did you feel?"       options={feltOptions}    value={howFelt}      onChange={setHowFelt} />
        <RadioRow label="Was it comfortable?"     options={comfortOptions} value={comfortable}  onChange={setComfortable} />
        <RadioRow label="Did it fit right?"       options={comfortOptions} value={fit}          onChange={setFit} />
        <RadioRow label="Was the coverage right?" options={comfortOptions} value={coverage}     onChange={setCoverage} />
        <RadioRow label="Was the colour right?"   options={comfortOptions} value={colour}       onChange={setColour} />
        <RadioRow label="Would you wear it again?" options={againOptions}  value={wearAgain}    onChange={setWearAgain} />

        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--naia-muted, #7a6f6a)", marginBottom: "10px" }}>
            Notes <span style={{ color: "#c5bdb9" }}>optional</span>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Anything else you'd like to share…"
            rows={3}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid rgba(59,5,16,0.12)", background: "transparent", fontFamily: SERIF_BODY, fontSize: "16px", color: "var(--naia-ink, #221516)", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        {apiError && (
          <div style={{ fontFamily: MONO, fontSize: "7px", letterSpacing: "1px", color: "var(--naia-accent, #8b2035)", marginBottom: "16px" }}>{apiError}</div>
        )}

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ padding: "12px 28px", background: "var(--naia-ink, #221516)", color: "var(--naia-bg, #f4f4f1)", border: "none", fontFamily: MONO, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", cursor: "pointer" }}
          >
            {isSubmitting ? "Saving…" : phase === "editing" ? "Update" : "Save review"}
          </button>
          {phase === "editing" && (
            <button
              onClick={() => setPhase("submitted")}
              style={{ padding: "12px 24px", background: "transparent", color: "var(--naia-muted, #7a6f6a)", border: "1px solid rgba(59,5,16,0.12)", fontFamily: MONO, fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
