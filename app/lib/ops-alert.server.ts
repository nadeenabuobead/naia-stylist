// app/lib/ops-alert.server.ts
//
// Minimal external alerting sink — the implementation of the design
// proposed in docs/runbooks/minimal-alerting-design.md (previously design
// only, nothing built). Built as part of the 2026-11-17 Operations
// follow-up to give two previously-silent events an actual signal:
// a new EU withdrawal-request submission, and a newly-opened Stripe
// dispute (see withdrawal-request route action and
// billing/webhook-handler.server.ts's charge.dispute.created branch).
//
// OFF BY DEFAULT, by construction: if OPS_ALERT_WEBHOOK_URL is unset (it
// is not set anywhere in this repo's config, and this file does not set
// it), sendOpsAlert never makes a network call — behavior is byte-
// identical to not calling it at all. This file creates no webhook, no
// account, no secret. Activating real delivery requires a human to
// provision a destination URL and set that one env var — a separate,
// explicitly founder-gated decision (see
// docs/ops/dispute-alerting-and-staff-role.md), not performed here.
//
// Fire-and-forget discipline, matching journey-events.server.ts's own
// established convention: this function itself awaits its fetch (so
// tests can observe the outcome), but every call site in this codebase
// is expected to call it without awaiting on a request's hot path, and
// it never throws — a flaky webhook endpoint must never turn one real
// event into two failures.
//
// Volume guard: at most one alert per distinct `context` value per
// cooldown window (default 5 minutes, matching the design doc's own
// proposal) — an incident producing many identical events in a short
// window produces one alert, not hundreds.

export interface OpsAlertMeta {
  [key: string]: string | number | boolean | undefined;
}

export interface OpsAlertPayload {
  context: string;
  message: string;
  occurredAt: string;
  meta?: OpsAlertMeta;
}

export interface OpsAlertDeps {
  _fetch?: typeof fetch;
  _webhookUrl?: string;
  _now?: () => number;
  _cooldownMs?: number;
}

export type OpsAlertResult =
  | { sent: true }
  | { sent: false; reason: "no_webhook_configured" | "cooldown_active" };

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

// Module-scoped, in-memory, per-process only — intentionally not
// persisted/distributed (see minimal-alerting-design.md §3: "a cheap
// first line, not a precise dedup system"). Exported reset is for tests
// only, so cooldown state from one test can't leak into the next.
const lastSentAtByContext = new Map<string, number>();

export function resetOpsAlertCooldowns(): void {
  lastSentAtByContext.clear();
}

export async function sendOpsAlert(
  context: string,
  message: string,
  meta?: OpsAlertMeta,
  deps: OpsAlertDeps = {},
): Promise<OpsAlertResult> {
  const webhookUrl = deps._webhookUrl ?? process.env.OPS_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, reason: "no_webhook_configured" };

  const now = deps._now ?? (() => Date.now());
  const cooldownMs = deps._cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const nowMs = now();
  const last = lastSentAtByContext.get(context);
  if (last !== undefined && nowMs - last < cooldownMs) {
    return { sent: false, reason: "cooldown_active" };
  }
  lastSentAtByContext.set(context, nowMs);

  const payload: OpsAlertPayload = {
    context,
    message: message.slice(0, 500),
    occurredAt: new Date(nowMs).toISOString(),
    meta,
  };
  const doFetch = deps._fetch ?? fetch;
  try {
    await doFetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Swallow — a down/misconfigured webhook endpoint must never surface
    // as a second failure on top of whatever this alert was reporting.
  }
  return { sent: true };
}
