// app/lib/admin-login-rate-limit.server.ts
//
// Priority 5 (2026-10-19) — durable brute-force protection for the internal
// admin portal (app/routes/admin.login.tsx). The portal is a single shared
// static password (see internal-auth.server.ts); the only prior protection
// was a fixed 350ms in-process delay, which has no effect across serverless
// cold starts or concurrent instances and nothing stops an attacker who is
// willing to wait or parallelize.
//
// DB-backed (AdminLoginAttempt) so lockout is real regardless of which
// serverless instance handles the next request. Keyed by a SHA-256 hash of
// the client IP — never the raw address, matching the customerIdHash
// pattern already used for JourneyEvent.

import prisma from "../db.server";
import { createHash } from "node:crypto";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip, "utf8").digest("hex");
}

/** Best-effort client IP extraction. Vercel sets x-forwarded-for; falls
 *  back to a constant bucket if absent (e.g. local dev) rather than
 *  throwing — a missing IP must degrade to "one shared bucket", not to
 *  skipping rate limiting entirely. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export interface LockoutStatus {
  locked: boolean;
  /** Only meaningful when locked. */
  retryAfterSeconds: number;
}

/** Checks whether this IP has reached MAX_FAILED_ATTEMPTS failed logins
 *  within the last WINDOW_MS. Does not record anything — call
 *  recordAdminLoginAttempt separately once the password check has run. */
export async function checkAdminLoginLockout(ip: string): Promise<LockoutStatus> {
  const ipHash = hashIp(ip);
  const since = new Date(Date.now() - WINDOW_MS);

  const failedCount = await prisma.adminLoginAttempt.count({
    where: { ipHash, succeeded: false, createdAt: { gte: since } },
  });

  if (failedCount < MAX_FAILED_ATTEMPTS) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  // Locked until the oldest failed attempt in the window ages out.
  const oldest = await prisma.adminLoginAttempt.findFirst({
    where: { ipHash, succeeded: false, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const unlockAt = (oldest?.createdAt.getTime() ?? Date.now()) + WINDOW_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));

  return { locked: true, retryAfterSeconds };
}

/** Records a login attempt (success or failure) and opportunistically
 *  prunes rows older than the window — there is no separate retention job
 *  for this table, so every write is also a chance to keep it small. */
export async function recordAdminLoginAttempt(ip: string, succeeded: boolean): Promise<void> {
  const ipHash = hashIp(ip);
  await prisma.adminLoginAttempt.create({ data: { ipHash, succeeded } });

  const cutoff = new Date(Date.now() - WINDOW_MS);
  await prisma.adminLoginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {
    // Pruning is best-effort; a failure here must never block login.
  });
}
