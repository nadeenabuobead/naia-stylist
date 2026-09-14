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

// ── Session management ────────────────────────────────────────────────────────

/** Create and commit a new admin session cookie.
 *  Identity is sourced from server env vars only — never from form input.
 *  Call ONLY after verifyAdminSecret returns true. */
export async function createAdminSession(): Promise<string> {
  const { commitSession, getSession } = getStorage();

  const identity: AdminIdentity = {
    id: "owner",
    email: process.env.INTERNAL_ADMIN_IDENTITY_EMAIL ?? "admin",
    role: "owner",
  };

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
