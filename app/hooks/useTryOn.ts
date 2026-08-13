// app/hooks/useTryOn.ts
// Client-side VTO state machine: trigger → submit → poll → completed | failed.
//
// Security contract:
//   - All server communication goes through /api/trigger-tryon (POST) and
//     /api/tryon-status/:jobId (GET) — both session-cookie-authenticated on the server.
//   - customerId is never passed from the client; the server resolves it from the session.
//   - resultUrl comes only from the server polling endpoint; it is never constructed client-side.
//   - The idempotency key is a fresh random hex string per trigger() call.
//   - No body shape or fit information is sent or received.
//   - Garment image URLs are NEVER sent from the client; the server resolves them from DB records.
//
// Timeout: 40 polls × 3 s = 120 s ceiling before showing a timeout error.

import { useState, useCallback, useEffect, useRef } from "react";

export type VtoSource =
  | { source: "nadine"; productHandle: string }
  | { source: "closet"; closetItemId: string }
  | { source: "buyskip"; analysisId: string };

export type VtoState =
  | { tag: "idle" }
  | { tag: "submitting" }
  | { tag: "polling"; jobId: string }
  | { tag: "completed"; resultUrl: string }
  | { tag: "failed"; message: string };

function randomKey(): string {
  // 32-char hex — satisfies IDEMPOTENCY_KEY_RE: /^[A-Za-z0-9_-]{10,80}$/
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useTryOn(vtoSource: VtoSource) {
  const [state, setState] = useState<VtoState>({ tag: "idle" });
  const cancelRef = useRef(false);

  // Stable primitive deps — avoids recreating trigger on every render if the caller
  // passes a new object literal but the semantic values haven't changed.
  const source = vtoSource.source;
  const sourceId =
    vtoSource.source === "nadine"
      ? vtoSource.productHandle
      : vtoSource.source === "closet"
      ? vtoSource.closetItemId
      : vtoSource.analysisId;

  const trigger = useCallback(async () => {
    cancelRef.current = false;
    setState({ tag: "submitting" });

    const virtualTryOnConsentAt = new Date().toISOString();
    const idempotencyKey = randomKey();

    // Build source-specific payload — garment URLs are NEVER sent from the client.
    const body: Record<string, unknown> = {
      source,
      virtualTryOnConsentAt,
      idempotencyKey,
      saveTryOnResultConsent: true,
    };
    if (source === "nadine") {
      body.productHandle = sourceId;
    } else if (source === "closet") {
      body.closetItemId = sourceId;
    } else {
      body.analysisId = sourceId;
    }

    try {
      const res = await fetch("/api/trigger-tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (cancelRef.current) return;

      let resBody: Record<string, unknown>;
      try {
        resBody = await res.json();
      } catch {
        setState({ tag: "failed", message: "Something went wrong. Please try again." });
        return;
      }

      if (cancelRef.current) return;

      if (!resBody.ok || typeof resBody.jobId !== "string") {
        const message =
          typeof resBody.message === "string" && resBody.message.length > 0
            ? resBody.message
            : "Something went wrong. Please try again.";
        setState({ tag: "failed", message });
        return;
      }

      setState({ tag: "polling", jobId: resBody.jobId });
    } catch {
      if (!cancelRef.current) {
        setState({ tag: "failed", message: "Something went wrong. Please try again." });
      }
    }
  }, [source, sourceId]);

  // Polling effect — starts when state.tag === "polling", stops on cancel or terminal state
  const pollingJobId = state.tag === "polling" ? state.jobId : null;

  useEffect(() => {
    if (!pollingJobId) return;

    cancelRef.current = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 40;

    const poll = async () => {
      if (cancelRef.current) return;

      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        if (!cancelRef.current) {
          setState({
            tag: "failed",
            message: "Your preview is taking longer than expected. Please try again.",
          });
        }
        return;
      }

      try {
        const res = await fetch(`/api/tryon-status/${pollingJobId}`);
        if (cancelRef.current) return;

        let resBody: Record<string, unknown>;
        try {
          resBody = await res.json();
        } catch {
          if (!cancelRef.current) {
            setState({ tag: "failed", message: "Something went wrong. Please try again." });
          }
          return;
        }

        if (cancelRef.current) return;

        if (resBody.status === "COMPLETED" && typeof resBody.resultUrl === "string") {
          setState({ tag: "completed", resultUrl: resBody.resultUrl });
        } else if (resBody.status === "FAILED" || res.status >= 400) {
          setState({
            tag: "failed",
            message: "Your preview could not be completed. Please try again.",
          });
        } else {
          // PROCESSING — schedule next poll
          setTimeout(poll, 3000);
        }
      } catch {
        if (!cancelRef.current) {
          setState({ tag: "failed", message: "Something went wrong. Please try again." });
        }
      }
    };

    poll();

    return () => {
      cancelRef.current = true;
    };
  }, [pollingJobId]);

  const reset = useCallback(() => {
    cancelRef.current = true;
    setState({ tag: "idle" });
  }, []);

  return { state, trigger, reset };
}
