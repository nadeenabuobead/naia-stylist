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
//
// prismaCode / postgresSqlState (2026-11-18 — added investigating a live
// 08P01 incident on /style-me): the 200-char message slice above has a
// real diagnostic gap — a Prisma error's useful identifying detail (its
// own `.code`, or a wrapped Postgres SQLSTATE) can land anywhere in the
// message text, so truncation can silently cut it off depending on
// nothing more than how long the preceding text happens to be. The
// 08P01 incident's own log line only preserved "08P01" by luck of where
// it fell in the first 200 characters.
//
// Both new fields are deliberately narrow, structured, and extracted
// BEFORE truncation so they survive it:
//   - prismaCode comes straight from Prisma's own `.code` property
//     (PrismaClientKnownRequestError etc.) — always a short fixed enum
//     string ("P2024", "P2002", ...), never free-form data, bounded
//     defensively anyway.
//   - postgresSqlState is extracted via a narrow regex matching ONLY
//     Prisma's own `PostgresError { code: "XXXXX"` wrapper shape and
//     capturing just the 5-character SQLSTATE — never anything else
//     from the surrounding message (no SQL text, no bind parameters, no
//     connection string: those never appear inside this specific
//     capture group even when present elsewhere in the full message).
// Neither field is ever populated from unbounded/free-form error text.
const POSTGRES_SQLSTATE_PATTERN = /PostgresError\s*\{\s*code:\s*"([0-9A-Za-z]{5})"/;

function extractPostgresSqlState(message: string): string | undefined {
  return POSTGRES_SQLSTATE_PATTERN.exec(message)?.[1];
}

function extractPrismaCode(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 && code.length <= 10 ? code : undefined;
}

export interface ErrorCaptureMeta {
  [key: string]: string | number | boolean | undefined;
}

export interface ErrorCaptureEvent {
  context: string;
  message: string;
  name: string;
  prismaCode?: string;
  postgresSqlState?: string;
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
    ...(isError ? { prismaCode: extractPrismaCode(error) } : {}),
    ...(isError ? { postgresSqlState: extractPostgresSqlState(error.message) } : {}),
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
