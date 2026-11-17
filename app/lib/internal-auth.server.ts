// app/lib/internal-auth.server.ts
//
// Standalone admin portal authentication — replaceable auth layer.
//
// Staging credential model: one shared secret compared via timing-safe digest.
// The session payload is identity-shaped so a future per-user system can drop in
// without changing any route that calls requireAdminSession.
//
// Required env vars:
//   INTERNAL_ADMIN_COOKIE_SECRET   — signs the __naia_admin cookie (min 16 chars)
//   INTERNAL_ADMIN_SECRET          — the login password
//   INTERNAL_ADMIN_IDENTITY_EMAIL  — email stamped on owner sessions (optional)
//
// Fails closed: missing or short cookie secret → redirect to /admin/login.
// Never logs either secret value.
//
// Session storage is initialised lazily (on first use) so that env vars set
// before the first call are reflected — this matters in tests where env vars
// are assigned before importing the module via ESM hoisting.

import { createCookieSessionStorage, redirect } from "react-router";
import { createHash, timingSafeEqual } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdminRole = "owner" | "staff";

export type AdminIdentity = {
  /** Stable opaque identifier for this admin. On staging: "owner". */
  id: string;
  email: string;
  role: AdminRole;
};

export type AdminSession = {
  authenticated: true;
  identity: AdminIdentity;
};

// ── Lazy session storage ──────────────────────────────────────────────────────
// Initialised on first call rather than at module load. This ensures that env
// vars set by test harnesses (before the first function call) are picked up
// correctly even when ES module imports are hoisted.

type AdminSessionData = {
  authenticated: boolean;
  identity: AdminIdentity;
};

type CookieStorage = ReturnType<typeof createCookieSessionStorage<AdminSessionData>>;
let _storage: CookieStorage | null = null;
let _storageSecret = "";

function getStorage(): CookieStorage {
  const secret = process.env.INTERNAL_ADMIN_COOKIE_SECRET ?? "";
  if (secret.length < 16) {
    throw new Error("INTERNAL_ADMIN_COOKIE_SECRET not configured or too short (min 16 chars)");
  }
  if (_storage && _storageSecret === secret) return _storage;
  _storageSecret = secret;
  _storage = createCookieSessionStorage<AdminSessionData>({
    cookie: {
      name: "__naia_admin",
      httpOnly: true,
      secure: process.env.NODE_ENV !== "test",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 8, // 8 hours
      path: "/",
      secrets: [secret],
    },
  });
  return _storage;
}

// ── Secret verification ───────────────────────────────────────────────────────

/** Compare submitted password against INTERNAL_ADMIN_SECRET using a timing-safe
 *  digest comparison. Hashes both sides to fixed-length SHA-256 buffers before
 *  calling timingSafeEqual — this is required because timingSafeEqual demands
 *  equal-length inputs and short-circuits on length mismatch otherwise.
 *
 *  Returns false on any error, including missing or empty INTERNAL_ADMIN_SECRET. */
export function verifyAdminSecret(submitted: string): boolean {
  const expected = process.env.INTERNAL_ADMIN_SECRET;
  if (!expected || expected.length === 0) return false; // fail closed
  if (typeof submitted !== "string" || submitted.length === 0) return false;
  try {
    const ha = createHash("sha256").update(submitted, "utf8").digest();
    const hb = createHash("sha256").update(expected, "utf8").digest();
    return timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}

/**
 * 2026-11-17 Operations follow-up: the "staff" half of AdminRole has
 * existed in the type since this file was written, but nothing ever
 * issued it — createAdminSession hardcoded every session to "owner", so
 * there was no way to give a second person narrower access than the
 * founder's own without handing them the SAME secret and therefore the
 * SAME full access.
 *
 * This is the staff-side equivalent of verifyAdminSecret, deliberately a
 * SEPARATE secret (INTERNAL_STAFF_SECRET) from INTERNAL_ADMIN_SECRET —
 * least privilege means a compromised/revoked staff credential never
 * doubles as the owner credential, and vice versa. Fails closed exactly
 * like verifyAdminSecret: INTERNAL_STAFF_SECRET is not set anywhere in
 * this repo's config (checked — grep -rn "INTERNAL_STAFF_SECRET" finds
 * only this file, internal-auth.test.ts's negative-path tests, and
 * .env.example's documentation line), so this returns false
 * unconditionally until a human with real deploy access provisions it —
 * see docs/ops/staff-role-and-dispute-alerting.md for exactly what that
 * requires and the approval it's gated behind.
 */
export function verifyStaffSecret(submitted: string): boolean {
  const expected = process.env.INTERNAL_STAFF_SECRET;
  if (!expected || expected.length === 0) return false; // fail closed — unset by design today
  if (typeof submitted !== "string" || submitted.length === 0) return false;
  try {
    const ha = createHash("sha256").update(submitted, "utf8").digest();
    const hb = createHash("sha256").update(expected, "utf8").digest();
    return timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}

// ── Session management ────────────────────────────────────────────────────────

/** Create and commit a new admin session cookie.
 *  Identity is sourced from server env vars only — never from form input.
 *  Call ONLY after verifyAdminSecret (role "owner") or verifyStaffSecret
 *  (role "staff") returns true for the matching role.
 *
 *  Defaults to "owner" so every existing call site (admin.login.tsx
 *  called this with no arguments before 2026-11-17) is unaffected. */
export async function createAdminSession(role: AdminRole = "owner"): Promise<string> {
  const { commitSession, getSession } = getStorage();

  const identity: AdminIdentity =
    role === "owner"
      ? { id: "owner", email: process.env.INTERNAL_ADMIN_IDENTITY_EMAIL ?? "admin", role: "owner" }
      : { id: "staff", email: process.env.INTERNAL_STAFF_IDENTITY_EMAIL ?? "staff", role: "staff" };

  const session = await getSession();
  session.set("authenticated", true);
  session.set("identity", identity);
  return commitSession(session);
}

/** Require a valid admin session. Redirects to /admin/login if:
 *  - the cookie secret env var is missing or too short (portal not configured)
 *  - no session cookie is present
 *  - the session is expired or the cookie signature is invalid
 *  - the session payload is missing required fields
 *
 *  Returns the AdminSession on success. */
export async function requireAdminSession(request: Request): Promise<AdminSession> {
  let storage: CookieStorage;
  try {
    storage = getStorage();
  } catch {
    throw redirect("/admin/login");
  }

  const { getSession } = storage;
  const session = await getSession(request.headers.get("Cookie"));
  const authenticated = session.get("authenticated");
  const identity = session.get("identity");

  if (!authenticated || !identity?.id || !identity?.role) {
    throw redirect("/admin/login");
  }

  return { authenticated: true, identity };
}

/**
 * Least-privilege role gate, built once and shared, rather than each admin
 * route hand-rolling its own `identity.role !== "owner"` check (as
 * admin.billing-overrides.tsx and admin.maintenance.tsx both already do,
 * independently). Throws a 403 Response — same shape those routes already
 * throw — if the authenticated identity's role isn't in `allowed`.
 *
 * 2026-11-17: this file does NOT change admin.billing-overrides.tsx's or
 * admin.maintenance.tsx's existing owner-only checks — both are left
 * exactly as they were, so no existing route's real permission model
 * changes. This helper exists so a NEW route (today:
 * admin.withdrawal-requests.tsx) can be built as owner-or-staff from the
 * start, and so extending an EXISTING route to staff later is a one-line,
 * explicitly-reviewed change rather than copy-pasted auth logic.
 */
export async function requireRole(request: Request, allowed: AdminRole[]): Promise<AdminSession> {
  const session = await requireAdminSession(request);
  if (!allowed.includes(session.identity.role)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return session;
}

/** Destroy the admin session. Returns the Set-Cookie header value that clears
 *  the __naia_admin cookie. Pass as Set-Cookie response header. */
export async function destroyAdminSession(request: Request): Promise<string> {
  let storage: CookieStorage;
  try {
    storage = getStorage();
  } catch {
    // If the portal isn't configured, there's nothing to destroy.
    // Return an empty string — the caller should still redirect to login.
    return "";
  }
  const { getSession, destroySession } = storage;
  const session = await getSession(request.headers.get("Cookie"));
  return destroySession(session);
}
