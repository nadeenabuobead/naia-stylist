// app/lib/email/resend-email.server.ts
//
// Resend integration for nAia's OWN transactional email — the
// identity-linking verification code (identity-linking.server.ts), and
// nothing else. This is deliberately separate from Clerk's native auth
// emails (sign-up verification, password reset): those are sent by Clerk
// itself on the free/default plan, with no custom code or provider
// involved at all. Clerk CAN be configured to route its own emails through
// a provider like this one for white-labeling (via its "Delivered by
// Clerk" toggle + email.created webhook, Clerk Pro only) — that is a
// separate, optional decision this file does not make or depend on.
//
// No live RESEND_API_KEY is configured anywhere in this worktree — calling
// sendVerificationEmailViaResend in any real environment without one fails
// loudly (see defaultResendClient below), same fail-closed discipline
// identity-linking.server.ts's old stub already had. Every test here
// injects a fake client; none make a real network call.

import { Resend } from "resend";

// Resend's own documented default: 10 requests/second per team. This file
// sends at most one email per identity-link attempt (itself rate-limited
// upstream by identity-linking.server.ts's per-customer lockout), so this
// is a defensive ceiling, not a load-bearing assumption about real traffic.
const RATE_LIMIT_RETRY_AFTER_MS = 1000;

export class EmailDeliveryError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

/** Thrown specifically on a rate_limit_exceeded response — a distinct type
 *  so a caller that wants to retry-after-backoff can catch just this case
 *  without having to parse the generic EmailDeliveryError's code string. */
export class EmailRateLimitError extends EmailDeliveryError {
  readonly retryAfterMs: number;
  constructor(message: string) {
    super(message, "rate_limit_exceeded");
    this.name = "EmailRateLimitError";
    this.retryAfterMs = RATE_LIMIT_RETRY_AFTER_MS;
  }
}

let _defaultClient: Resend | null = null;
function defaultResendClient(): Pick<Resend, "emails"> {
  if (!_defaultClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // Fails loudly, not silently — same discipline as the stub this
      // replaces. A misconfigured deploy must never look like "emails are
      // being sent" when they aren't.
      throw new Error(
        "resend-email.server: RESEND_API_KEY is not set. No transactional " +
        "email provider is configured in this environment.",
      );
    }
    _defaultClient = new Resend(apiKey);
  }
  return _defaultClient;
}

const FROM_ADDRESS = process.env.RESEND_VERIFICATION_FROM_ADDRESS ?? "nAia Stylist <verify@naiabynadine.com>";

function renderVerificationEmailHtml(code: string): string {
  // Plain, minimal HTML — this is a transactional code email, not a
  // marketing template; visual design is out of scope here same as the
  // customer-facing Clerk pages.
  return `<p>Your nAia verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>`;
}

function renderVerificationEmailText(code: string): string {
  return `Your nAia verification code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email.`;
}

export interface ResendEmailDeps {
  _resendClient?: Pick<Resend, "emails">;
}

/**
 * The real implementation behind identity-linking.server.ts's
 * _sendVerificationEmail injection point. Never logs the code itself —
 * only Resend's own response metadata (id) on success, or the error's
 * name/message on failure, so a verification failure is diagnosable
 * without a verification code ever appearing in application logs.
 */
export async function sendVerificationEmailViaResend(
  email: string,
  code: string,
  deps: ResendEmailDeps = {},
): Promise<void> {
  const client = deps._resendClient ?? defaultResendClient();

  const { data, error } = await client.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Your nAia verification code",
    html: renderVerificationEmailHtml(code),
    text: renderVerificationEmailText(code),
  });

  if (error) {
    if (error.name === "rate_limit_exceeded") {
      throw new EmailRateLimitError(`Resend rate limit exceeded: ${error.message}`);
    }
    // Every other Resend error (invalid_api_key, invalid_from_address,
    // validation_error, monthly_quota_exceeded, internal_server_error,
    // ...) — surfaced with Resend's own error name as the code, never the
    // raw error object (which could, in principle, echo request fields
    // back) and never the verification code.
    throw new EmailDeliveryError(`Resend delivery failed (${error.name}): ${error.message}`, error.name);
  }

  // data.id (Resend's own message id) is intentionally not returned to the
  // caller — identity-linking.server.ts's contract is "sent or threw,"
  // nothing more; logging it here would be the only place a correlation
  // between a customerId and a specific outbound email id could leak into
  // logs unnecessarily. Success is silence.
  void data;
}
