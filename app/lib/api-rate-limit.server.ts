// app/lib/api-rate-limit.server.ts
//
// Phase 1 shared rate-limiting module. A velocity check layered ON TOP OF —
// never a replacement for — the existing atomic membership-entitlement
// reservations (entitlement.server.ts). Entitlement answers "do they have
// allowance left"; this answers "are they calling this too fast, right now,
// regardless of remaining allowance." Both matter; neither substitutes for
// the other.
//
// Why a raw atomic upsert instead of entitlement.server.ts's Serializable
// $transaction pattern: that pattern is correct for a low-frequency,
// high-stakes "reserve one slot" decision. A rate-limit check runs far more
// often per customer, so a single `INSERT ... ON CONFLICT ... DO UPDATE SET
// count = count + 1` — one round trip, no transaction-retry overhead — is
// the appropriate tool here. Both are atomic; they're atomic by different
// mechanisms because they're solving different-shaped problems.
//
// Windowing reuses the fixed-bucket pattern already established in
// api.wishlist.jsx's idempotency key (`Math.floor(epoch / windowSeconds)`),
// not a new convention.
//
// Never logs: raw customerId, email, auth tokens, photos, or prompts. Only a
// SHA-256 customerIdHash (same convention as journey-events.server.ts) and
// the routeKey ever appear in a log line.

import { createHash } from "node:crypto";
import prisma from "../db.server";

export type RateLimitMode = "shadow" | "enforce";

export interface RateLimitConfig {
  routeKey: string;
  limit: number;
  windowSeconds: number;
  mode: RateLimitMode;
}

export interface RateLimitResult {
  /** Always true in shadow mode — shadow mode never blocks a real request. */
  allowed: boolean;
  /** True when the limit was exceeded, independent of whether it was enforced. */
  overLimit: boolean;
  mode: RateLimitMode;
  count: number;
  limit: number;
  retryAfterSeconds: number;
  /** True only when a DB error caused this check to fail open. */
  failedOpen?: boolean;
}

export type RateLimitQueryFn = (
  customerId: string,
  routeKey: string,
  windowStart: Date,
) => Promise<{ count: number }>;

function hashCustomerId(customerId: string): string {
  return createHash("sha256").update(customerId).digest("hex").slice(0, 12);
}

/** Real implementation — a single atomic upsert-with-increment. Exposed so
 *  tests can inject a fake and exercise the decision logic without a DB. */
export async function _incrementCounter(
  customerId: string,
  routeKey: string,
  windowStart: Date,
): Promise<{ count: number }> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "ApiRateLimitCounter" ("id", "customerId", "routeKey", "windowStart", "count", "updatedAt")
    VALUES (gen_random_uuid()::text, ${customerId}, ${routeKey}, ${windowStart}, 1, now())
    ON CONFLICT ("customerId", "routeKey", "windowStart")
    DO UPDATE SET "count" = "ApiRateLimitCounter"."count" + 1, "updatedAt" = now()
    RETURNING "count"
  `;
  return { count: Number(rows[0].count) };
}

export async function checkRateLimit(
  customerId: string,
  config: RateLimitConfig,
  _incrementFn: RateLimitQueryFn = _incrementCounter,
): Promise<RateLimitResult> {
  const windowMs = config.windowSeconds * 1000;
  const bucketStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(bucketStartMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucketStartMs + windowMs - Date.now()) / 1000));

  let count: number;
  try {
    const result = await _incrementFn(customerId, config.routeKey, windowStart);
    count = result.count;
  } catch (e) {
    // Fail OPEN, not closed: a rate-limiter outage must never take down a
    // feature that the separate, already-atomic entitlement system still
    // independently caps. Log without any customer-identifying value.
    console.error("[rate-limit] DB error, failing open", {
      routeKey: config.routeKey,
      customerIdHash: hashCustomerId(customerId),
    });
    return {
      allowed: true,
      overLimit: false,
      mode: config.mode,
      count: 0,
      limit: config.limit,
      retryAfterSeconds: 0,
      failedOpen: true,
    };
  }

  const overLimit = count > config.limit;
  const allowed = config.mode === "shadow" ? true : !overLimit;

  if (overLimit) {
    console.log("[rate-limit]", config.mode === "shadow" ? "would-block" : "blocked", {
      routeKey: config.routeKey,
      customerIdHash: hashCustomerId(customerId),
      count,
      limit: config.limit,
    });
  }

  return { allowed, overLimit, mode: config.mode, count, limit: config.limit, retryAfterSeconds };
}

/** Builds the standard 429 response. Route code only calls this when
 *  checkRateLimit returned allowed: false — never on its own. */
export function rateLimitResponse(result: RateLimitResult) {
  return Response.json(
    { error: "Too many requests. Please try again shortly." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
