// app/lib/error-tracking.server.ts
//
// Phase 1 ops prep — a single, central seam for application error capture.
//
// routeErrorResponse handling (2026-11-21 — found investigating an
// unrelated PostgreSQL monitoring task): React Router throws its own
// internal route-error-response object — never an Error instance — for
// an unmatched route (no `routes.ts`/flat-route file matches the request
// path at all) or for a route's own `throw new Response(...)`/`data(...,
// {status})`. Confirmed live: three bot/scanner `curl` probes against
// nonexistent production paths (e.g. /staging/full-look-vto-real) each
// returned a correct 404 response, yet every one of them logged here as
// `name: "UnknownError", message: "Non-Error thrown"` — indistinguishable
// from a genuine unknown-shaped application crash. Not a security issue
// (the 404 is correct and nothing executes), but it degrades this exact
// log pipeline's signal quality — the same pipeline the 08P01 live
// monitor depends on to tell a real incident from noise.
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
import { isRouteErrorResponse } from "react-router";

const POSTGRES_SQLSTATE_PATTERN = /PostgresError\s*\{\s*code:\s*"([0-9A-Za-z]{5})"/;

function extractPostgresSqlState(message: string): string | undefined {
  return POSTGRES_SQLSTATE_PATTERN.exec(message)?.[1];
}

// postgresSeverity / postgresRoutine (2026-11-18 — founder-requested
// extension: the SQLSTATE alone doesn't distinguish competing root causes
// for the same code). Postgres's own wire-protocol error carries several
// more fields (confirmed via Postgres's own protocol-error-fields docs and
// Prisma's own ConnectorError Debug output, which prints exactly
// `PostgresError { code: "...", message: "...", severity: "...",
// detail: ..., column: ..., hint: ... }`, with `routine` further along):
//   - severity: always one of a small fixed set (ERROR/FATAL/PANIC/
//     WARNING/NOTICE/DEBUG/INFO/LOG, or a localized translation of one) —
//     no data, ever.
//   - routine: the Postgres C source function that raised the error, e.g.
//     "exec_bind_message" (a bind/prepared-statement-protocol failure) vs
//     "ProcessStartupPacket" (a connection/startup-negotiation failure) vs
//     "PostgresMain" (a generic top-level failure) — this is a source
//     identifier, never a value, and it is exactly the signal needed to
//     tell those root causes apart from one SQLSTATE code alone.
//
// Deliberately NOT extracted, even though Postgres exposes them: `detail`
// and `hint` — Postgres's own docs describe `detail` as routinely echoing
// the actual offending value (e.g. a duplicate-key detail message
// literally contains the duplicated value), and `hint` is unstructured
// advice text. Neither is a fixed, data-free field the way severity and
// routine are, so neither is safe to capture generically here. The
// Postgres-side `message` field (distinct from Prisma's own outer
// error.message, already handled above) is also deliberately skipped for
// the same reason: it is free text, not a bounded enum/identifier.
//
// Both patterns are independent of field order/position in the struct —
// each scans the full, untruncated message on its own, so either field
// surviving truncation never depends on how long any other field's value
// happened to be.
const POSTGRES_SEVERITY_PATTERN = /PostgresError\s*\{[^}]*?severity:\s*"([A-Za-z]{1,20})"/;
const POSTGRES_ROUTINE_PATTERN = /routine:\s*(?:Some\()?"([A-Za-z0-9_]{1,64})"/;

function extractPostgresSeverity(message: string): string | undefined {
  return POSTGRES_SEVERITY_PATTERN.exec(message)?.[1];
}

function extractPostgresRoutine(message: string): string | undefined {
  return POSTGRES_ROUTINE_PATTERN.exec(message)?.[1];
}

// redactPostgresDetailAndHint (2026-11-18 — found via this file's own new
// test suite, not assumed): Prisma's PrismaClientUnknownRequestError.message
// embeds the FULL Rust Debug-formatted PostgresError struct verbatim,
// including `detail` and `hint` — and Postgres's own protocol-error-fields
// documentation says `detail` routinely echoes the actual offending value
// (e.g. a duplicate-key violation's detail literally contains the
// duplicated value). The existing 200-char slice below does NOT reliably
// protect against this: it only helps when the sensitive content happens
// to fall past character 200, which depends on nothing more than how long
// the rest of the message happens to be. A short enough message — which a
// real query error can easily produce — would log the actual value today.
//
// Redacted here, unconditionally, BEFORE truncation, so the 200-char bound
// can never expose it regardless of where it would otherwise land. Scoped
// narrowly to exactly `detail: Some("...")` / `hint: Some("...")` — the
// `None` case (the common, harmless one) is left untouched, and nothing
// else in the message is modified.
const POSTGRES_DETAIL_OR_HINT_VALUE_PATTERN = /((?:detail|hint):\s*Some\()"(?:[^"\\]|\\.)*"(\))/g;

function redactPostgresDetailAndHint(message: string): string {
  return message.replace(POSTGRES_DETAIL_OR_HINT_VALUE_PATTERN, '$1"[redacted]"$2');
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
  postgresSeverity?: string;
  postgresRoutine?: string;
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
  // Checked first, and not folded into the isError branch below: a route
  // error response is never `instanceof Error`, so without this check it
  // falls into the generic "Non-Error thrown" / "UnknownError" shape —
  // indistinguishable from a real unknown-shaped crash. status/statusText
  // are a bounded, fixed-shape pair (an HTTP status code plus React
  // Router's own short reason phrase), never free-form error text, so
  // nothing here needs truncation or redaction the way a thrown Error's
  // message does.
  if (isRouteErrorResponse(error)) {
    const event: ErrorCaptureEvent = {
      context,
      message: `${error.status} ${error.statusText}`.trim(),
      name: "RouteErrorResponse",
      meta,
      occurredAt: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.error("[error-capture]", JSON.stringify(event));
    return event;
  }

  const isError = error instanceof Error;
  // Redact before anything else touches the message — both the logged
  // slice and every extractor below operate on this sanitized text, so a
  // detail/hint value can never reach the log via any path.
  const sanitizedMessage = isError ? redactPostgresDetailAndHint(error.message) : "";
  const event: ErrorCaptureEvent = {
    context,
    message: isError ? sanitizedMessage.slice(0, 200) : "Non-Error thrown",
    name: isError ? error.name : "UnknownError",
    ...(isError ? { prismaCode: extractPrismaCode(error) } : {}),
    ...(isError ? { postgresSqlState: extractPostgresSqlState(sanitizedMessage) } : {}),
    ...(isError ? { postgresSeverity: extractPostgresSeverity(sanitizedMessage) } : {}),
    ...(isError ? { postgresRoutine: extractPostgresRoutine(sanitizedMessage) } : {}),
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
