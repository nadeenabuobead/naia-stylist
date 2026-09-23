// app/components/SaveControl.tsx
//
// The quiet ♡ that appears beside saveable content in a Trend Report.
//
// Design constraints this honours:
//   - the editorial story stays primary, so this is a small text control at the
//     edge of a block, never a button bar
//   - saving must not navigate away, so it posts through a fetcher
//   - state must survive a refresh, so `initiallySaved` comes from the loader
//     reading the customer's real SavedItem rows, not from client memory
//   - repeated clicks are idempotent server-side; the control simply reflects
//     whatever the server last confirmed

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { SavedItemActionResult } from "~/routes/api.saved-items";

export interface SaveControlProps {
  contentType: "TREND" | "SIGNAL" | "REFERENCE" | "PRODUCT" | "TAKEAWAY";
  contentId: string;
  reportSlug?: string | null;
  /** The trend a nested object (a product, say) was discovered under. */
  sourceContentId?: string | null;
  /** Personalised-edit sections pass their generated sentence for the snapshot. */
  takeawayText?: string | null;
  /** refKey computed server-side — the canonical identity used to unsave. */
  refKey: string;
  /** True when the loader found this refKey among the customer's saves. */
  initiallySaved: boolean;
  /** Path to come back to after signing in. */
  returnTo: string;
  /** What this control saves, for the accessible name: "Suede Textures". */
  label: string;
  className?: string;
}

export default function SaveControl({
  contentType,
  contentId,
  reportSlug,
  sourceContentId,
  takeawayText,
  refKey,
  initiallySaved,
  returnTo,
  label,
  className,
}: SaveControlProps) {
  const fetcher = useFetcher<SavedItemActionResult>();
  const [saved, setSaved] = useState(initiallySaved);
  const [signInPath, setSignInPath] = useState<string | null>(null);

  // The loader is the source of truth. If the page revalidates — after a refresh,
  // or after another save on the same page — take its answer over local state.
  useEffect(() => { setSaved(initiallySaved); }, [initiallySaved]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.ok) {
      setSaved(result.saved);
      setSignInPath(null);
    } else if (result.error === "unauthenticated") {
      setSignInPath(result.signInPath);
    }
  }, [fetcher.data]);

  // Optimistic only while the request is in flight; the server's answer wins.
  const pending = fetcher.state !== "idle";
  const intent = saved ? "unsave" : "save";
  const showSaved = pending ? intent === "save" : saved;

  if (signInPath) {
    return (
      <a href={signInPath} className={`svc svc--signin${className ? ` ${className}` : ""}`}>
        Sign in to save
      </a>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/saved-items" className="svc-form">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="refKey" value={refKey} />
      <input type="hidden" name="contentType" value={contentType} />
      <input type="hidden" name="contentId" value={contentId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {reportSlug && <input type="hidden" name="reportSlug" value={reportSlug} />}
      {sourceContentId && <input type="hidden" name="sourceContentId" value={sourceContentId} />}
      {takeawayText && <input type="hidden" name="takeawayText" value={takeawayText} />}

      <button
        type="submit"
        className={`svc${showSaved ? " svc--on" : ""}${className ? ` ${className}` : ""}`}
        aria-pressed={showSaved}
        aria-label={showSaved ? `Saved: ${label}. Select to remove from My Saved.` : `Save ${label} to My Saved`}
        disabled={pending}
      >
        <span className="svc-glyph" aria-hidden="true">{showSaved ? "♥" : "♡"}</span>
        <span className="svc-text">{showSaved ? "Saved" : "Save"}</span>
      </button>

      {/* Announced to assistive tech without moving anything on screen. */}
      <span className="svc-sr" role="status" aria-live="polite">
        {fetcher.state === "idle" && fetcher.data?.ok
          ? `${label} ${fetcher.data.saved ? "saved" : "removed from My Saved"}`
          : ""}
      </span>
    </fetcher.Form>
  );
}

/** Shared styles — injected once per page by the routes that use the control. */
export const saveControlCss = `
  .svc-form { display: inline; }
  .svc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    padding: 2px 0;
    cursor: pointer;
    font-family: 'Space Mono', var(--naia-ff-ui, monospace);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
    text-decoration: none;
    transition: color 0.15s;
  }
  .svc:hover:not(:disabled) { color: #7a1e28; }
  .svc:disabled { opacity: 0.55; cursor: progress; }
  .svc--on { color: #7a1e28; }
  .svc--signin { color: rgba(26,17,9,0.45); text-decoration: underline; text-underline-offset: 3px; }
  .svc--signin:hover { color: #7a1e28; }
  .svc-glyph { font-size: 12px; line-height: 1; }
  .svc:focus-visible { outline: 2px solid #7a1e28; outline-offset: 3px; }
  .svc--nfm { margin-left: 18px; }
  .svc-sr {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
`;


// ── Not for me ────────────────────────────────────────────────────────────────

export interface NotForMeControlProps {
  contentType: "TREND" | "SIGNAL" | "REFERENCE" | "PRODUCT" | "TAKEAWAY";
  contentId: string;
  reportSlug: string;
  /** True when the loader found a persisted dismissal for this content. */
  initiallyDismissed: boolean;
  returnTo: string;
  label: string;
}

/**
 * The quiet counterpart to Save. Reversible, and the state comes from the
 * loader reading real rows — a refresh shows what was actually persisted.
 *
 * Posts the intended STATE rather than a toggle, so a double-click settles
 * rather than flipping back and forth.
 */
export function NotForMeControl({
  contentType, contentId, reportSlug, initiallyDismissed, returnTo, label,
}: NotForMeControlProps) {
  const fetcher = useFetcher<{ ok: boolean; notForMe?: boolean; signInPath?: string }>();
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  const [signInPath, setSignInPath] = useState<string | null>(null);

  useEffect(() => { setDismissed(initiallyDismissed); }, [initiallyDismissed]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (result.ok && typeof result.notForMe === "boolean") {
      setDismissed(result.notForMe);
      setSignInPath(null);
    } else if (result.signInPath) {
      setSignInPath(result.signInPath);
    }
  }, [fetcher.data]);

  const pending = fetcher.state !== "idle";
  const showDismissed = pending ? !dismissed : dismissed;

  if (signInPath) {
    return <a href={signInPath} className="svc svc--signin">Sign in to give feedback</a>;
  }

  return (
    <fetcher.Form method="post" action="/api/trend-feedback" className="svc-form">
      <input type="hidden" name="contentType" value={contentType} />
      <input type="hidden" name="contentId" value={contentId} />
      <input type="hidden" name="reportSlug" value={reportSlug} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="active" value={dismissed ? "false" : "true"} />
      <button
        type="submit"
        className={`svc svc--nfm${showDismissed ? " svc--on" : ""}`}
        aria-pressed={showDismissed}
        aria-label={showDismissed
          ? `Marked not for you: ${label}. Select to undo.`
          : `Mark ${label} as not for you`}
        disabled={pending}
      >
        <span className="svc-glyph" aria-hidden="true">{showDismissed ? "✓" : ""}</span>
        <span className="svc-text">{showDismissed ? "Not for me" : "Not for me"}</span>
      </button>
      <span className="svc-sr" role="status" aria-live="polite">
        {fetcher.state === "idle" && fetcher.data?.ok
          ? `${label} ${fetcher.data.notForMe ? "marked not for you" : "restored"}`
          : ""}
      </span>
    </fetcher.Form>
  );
}
