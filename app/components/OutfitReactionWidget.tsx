// app/components/OutfitReactionWidget.tsx
// Quick Feedback widget for the complete StyleMe outfit (target = "complete-suggestion").
// Idempotency: if existingFeedbackId is supplied (server pre-loaded), the widget starts
// in "submitted" state and uses "update" intent on change instead of creating a duplicate.
// Never passes shopifyProductId or closetItemId — those belong to individual item feedback.

import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { FeedbackRating, FeedbackReason } from "~/lib/ai/feedback-contract";
import { FEEDBACK_REASONS } from "~/lib/ai/feedback-contract";

const RATING_LABELS: Record<FeedbackRating, string> = {
  love: "Love it",
  okay: "It's okay",
  "not-for-me": "Not for me",
};

const REASON_LABELS: Record<FeedbackReason, string> = {
  "not-my-style":         "Not my style",
  "colour-not-for-me":    "Colour not for me",
  "fit-shape-not-for-me": "Fit or shape",
  "too-revealing":        "Too revealing",
  "too-covered":          "Too covered",
  "too-formal":           "Too formal",
  "too-casual":           "Too casual",
  "not-practical":        "Not practical",
  "already-own-similar":  "Already have something similar",
  "too-expensive":        "Too expensive",
  "other":                "Something else",
};

const MONO = "'Space Mono','Courier New',monospace";
const SERIF = "'Cormorant Garamond',Garamond,serif";

const s = {
  root: {
    marginTop: "28px",
    paddingTop: "20px",
    borderTop: "1px solid rgba(59,5,16,0.10)",
  } as React.CSSProperties,
  prompt: {
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    color: "#7a6f6a",
    marginBottom: "10px",
  },
  ratingRow: { display: "flex", gap: "8px", flexWrap: "wrap" as const },
  chip: (active: boolean, rating?: FeedbackRating): React.CSSProperties => ({
    padding: "5px 12px",
    border: active ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.15)",
    background: active
      ? rating === "love" ? "rgba(139,32,53,0.08)" : "#8b2035"
      : "transparent",
    color: active ? (rating === "love" ? "#8b2035" : "#f4f4f1") : "#7a6f6a",
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  reasonGrid: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px",
    marginTop: "10px",
    marginBottom: "10px",
  },
  reasonChip: (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    border: active ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.12)",
    background: active ? "rgba(139,32,53,0.08)" : "transparent",
    color: active ? "#8b2035" : "#7a6f6a",
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "1px",
    cursor: "pointer",
  }),
  textarea: {
    width: "100%",
    marginTop: "8px",
    padding: "8px 10px",
    border: "1px solid rgba(59,5,16,0.12)",
    background: "transparent",
    fontFamily: SERIF,
    fontSize: "14px",
    color: "#221516",
    resize: "vertical" as const,
    minHeight: "56px",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  actionRow: {
    display: "flex",
    gap: "8px",
    marginTop: "10px",
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  submitBtn: {
    padding: "6px 16px",
    background: "#221516",
    color: "#f4f4f1",
    border: "none",
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    cursor: "pointer",
  } as React.CSSProperties,
  cancelBtn: {
    padding: "6px 12px",
    background: "transparent",
    color: "#7a6f6a",
    border: "none",
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    cursor: "pointer",
  } as React.CSSProperties,
  savedLine: {
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    color: "#8b2035",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  editLink: {
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "1px",
    color: "#7a6f6a",
    background: "none",
    border: "none",
    cursor: "pointer",
    textDecoration: "underline",
  } as React.CSSProperties,
  errorMsg: { fontFamily: MONO, fontSize: "7px", letterSpacing: "1px", color: "#8b2035", marginTop: "6px" } as React.CSSProperties,
  deletedMsg: {
    fontFamily: MONO,
    fontSize: "7px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    color: "#c5bdb9",
  } as React.CSSProperties,
};

export interface OutfitReactionWidgetProps {
  sessionId: string;
  suggestionId: string;
  existingFeedbackId?: string | null;
  existingRating?: FeedbackRating | null;
  existingReasonCodes?: FeedbackReason[];
}

type Phase = "idle" | "rating-open" | "submitted" | "editing" | "deleted";

export function OutfitReactionWidget({
  sessionId,
  suggestionId,
  existingFeedbackId = null,
  existingRating = null,
  existingReasonCodes = [],
}: OutfitReactionWidgetProps) {
  const hasExisting = !!existingFeedbackId && !!existingRating;

  const [phase, setPhase] = useState<Phase>(hasExisting ? "submitted" : "idle");
  const [selectedRating, setSelectedRating] = useState<FeedbackRating | null>(existingRating ?? null);
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>(existingReasonCodes);
  const [note, setNote] = useState("");
  const [feedbackId, setFeedbackId] = useState<string | null>(existingFeedbackId);
  const [apiError, setApiError] = useState<string | null>(null);
  const intentRef = useRef<"create" | "update" | "delete" | null>(null);

  const fetcher = useFetcher<{ ok?: boolean; feedback?: { id: string; rating: string }; error?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  const callApi = (body: Record<string, unknown>, intent: "create" | "update" | "delete") => {
    intentRef.current = intent;
    setApiError(null);
    fetcher.submit(body, { method: "post", action: "/api/recommendation-feedback", encType: "application/json" });
  };

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    const intent = intentRef.current;
    intentRef.current = null;

    if (d.error) { setApiError("Couldn't save — please try again"); return; }
    if (!d.ok) return;

    if (intent === "delete") {
      setPhase("deleted");
    } else {
      if (d.feedback?.id) setFeedbackId(d.feedback.id);
      setPhase("submitted");
    }
  }, [fetcher.data]);

  const pickRating = (r: FeedbackRating) => {
    setSelectedRating(r);
    if (r === "love") setSelectedReasons([]);
  };

  const toggleReason = (code: FeedbackReason) =>
    setSelectedReasons((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);

  const handleSubmit = () => {
    if (!selectedRating || isSubmitting) return;
    const useExisting = !!feedbackId;
    callApi(
      useExisting
        ? { _intent: "update", id: feedbackId, rating: selectedRating, reasonCodes: selectedReasons, vtoAspects: [], note: note.trim() || null }
        : { _intent: "create", sessionId, suggestionId, target: "complete-suggestion", shopifyProductId: null, closetItemId: null, rating: selectedRating, reasonCodes: selectedReasons, vtoAspects: [], note: note.trim() || null },
      useExisting ? "update" : "create",
    );
  };

  const handleDelete = () => {
    if (!feedbackId || isSubmitting) return;
    callApi({ _intent: "delete", id: feedbackId }, "delete");
  };

  const startEdit = () => {
    setSelectedReasons(existingReasonCodes);
    setNote("");
    setPhase("editing");
  };

  const cancelEdit = () => setPhase("submitted");

  if (phase === "deleted") {
    return <div style={s.root}><span style={s.deletedMsg}>Feedback removed</span></div>;
  }

  if (phase === "submitted") {
    return (
      <div style={s.root}>
        <div style={s.savedLine}>
          <span>{RATING_LABELS[selectedRating ?? "okay"]}</span>
          <button style={s.editLink} onClick={startEdit}>Edit</button>
          <button style={s.editLink} onClick={handleDelete} disabled={isSubmitting}>Remove</button>
        </div>
        {apiError && <div style={s.errorMsg}>{apiError}</div>}
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <div style={s.root}>
        <div style={s.prompt}>How does this look feel?</div>
        <div style={s.ratingRow}>
          {(["love", "okay", "not-for-me"] as FeedbackRating[]).map((r) => (
            <button
              key={r}
              style={s.chip(false)}
              onClick={() => { setSelectedRating(r); setSelectedReasons([]); setNote(""); setPhase("rating-open"); }}
            >
              {RATING_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // rating-open or editing
  const isEditing = phase === "editing";
  const showReasons = selectedRating === "okay" || selectedRating === "not-for-me";

  return (
    <div style={s.root}>
      <div style={s.prompt}>{isEditing ? "Edit your feedback" : "How does this look feel?"}</div>
      <div style={s.ratingRow}>
        {(["love", "okay", "not-for-me"] as FeedbackRating[]).map((r) => (
          <button key={r} style={s.chip(selectedRating === r, r)} onClick={() => pickRating(r)}>
            {RATING_LABELS[r]}
          </button>
        ))}
      </div>
      {showReasons && (
        <div style={s.reasonGrid}>
          {FEEDBACK_REASONS.map((code) => (
            <button key={code} style={s.reasonChip(selectedReasons.includes(code))} onClick={() => toggleReason(code)}>
              {REASON_LABELS[code]}
            </button>
          ))}
        </div>
      )}
      {selectedRating && (
        <textarea
          style={s.textarea}
          placeholder="Optional note (max 500 characters)…"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      )}
      {apiError && <div style={s.errorMsg}>{apiError}</div>}
      {selectedRating && (
        <div style={s.actionRow}>
          <button style={s.submitBtn} onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEditing ? "Update" : "Save"}
          </button>
          <button style={s.cancelBtn} onClick={isEditing ? cancelEdit : () => setPhase("idle")} disabled={isSubmitting}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
