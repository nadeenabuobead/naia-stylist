// app/lib/error-tracking.server.ts
//
// Phase 1 ops prep — a single, central seam for application error capture.
//
// Today this only writes a structured line to stdout via console.error, so
// existing Vercel log retention is the only place these events land. It
// exists so that wiring in a real provider (Sentry or similar) later is a
// one-file change — every call site below funnels through here instead of
// a bare console.error.
//
// Do NOT treat this as "centralized monitoring is live" — no error leaves
// this process. See docs/runbooks/error-tracking-provider-setup.md for what
// a real provider integration needs and why it isn't done here.
//
// Callers are responsible for pre-sanitizing `meta`: never pass raw
// customer PII, photos, prompts, tokens, or full provider response bodies.
// This module does not attempt to redact anything itself.

export interface ErrorCaptureMeta {
  [key: string]: string | number | boolean | undefined;
}

export interface ErrorCaptureEvent {
  context: string;
  message: string;
  name: string;
  meta?: ErrorCaptureMeta;
  occurredAt: string;
}

/**
 * Capture an application error with a short `context` tag (e.g.
 * "ssr-render", "fashn:submit"). `meta` must already be sanitized by the
 * caller — this function logs it as-is.
 */
export function captureError(
  context: string,
  error: unknown,
  meta?: ErrorCaptureMeta,
): ErrorCaptureEvent {
  const isError = error instanceof Error;
  const event: ErrorCaptureEvent = {
    context,
    message: isError ? error.message.slice(0, 200) : "Non-Error thrown",
    name: isError ? error.name : "UnknownError",
    meta,
    occurredAt: new Date().toISOString(),
  };
  // eslint-disable-next-line no-console
  console.error("[error-capture]", JSON.stringify(event));
  return event;
}

/**
 * Capture a failure that isn't a thrown Error (e.g. a non-ok HTTP response
 * or a classified provider failure code). Same sanitization contract as
 * captureError: `meta` must already be safe to log.
 */
export function captureFailure(
  context: string,
  message: string,
  meta?: ErrorCaptureMeta,
): ErrorCaptureEvent {
  const event: ErrorCaptureEvent = {
    context,
    message: message.slice(0, 200),
    name: "Failure",
    meta,
    occurredAt: new Date().toISOString(),
  };
  // eslint-disable-next-line no-console
  console.error("[error-capture]", JSON.stringify(event));
  return event;
}
