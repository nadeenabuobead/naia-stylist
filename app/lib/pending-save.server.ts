import { createCookieSessionStorage } from "react-router";

const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error("[pending-save] SESSION_SECRET environment variable is required");
}

const PENDING_SAVE_TTL_MS = 30 * 60 * 1000;

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "__naia_pending_save",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
    secrets: [secret],
  },
});

export type PendingSaveRead =
  | { status: "none" }
  | { status: "valid"; sid: string; iat: number }
  | { status: "invalid_or_expired" };

export async function readPendingSave(request: Request): Promise<PendingSaveRead> {
  const rawCookies = request.headers.get("Cookie") ?? "";
  const cookieWasPresent = rawCookies
    .split(";")
    .some((part) => part.trimStart().startsWith("__naia_pending_save="));

  const session = await getSession(request.headers.get("Cookie"));
  const sid = session.get("sid");
  const iat = session.get("iat");
  // No __naia_pending_save cookie present → none. Cookie present but getSession produced no usable
  // sid (tampered, malformed, or signature failure) → invalid_or_expired so callers clear it.
  if (typeof sid !== "string" || !sid) {
    return cookieWasPresent ? { status: "invalid_or_expired" } : { status: "none" };
  }
  // Cookie present but iat is malformed, in the future, or the 30-minute window has elapsed.
  const now = Date.now();
  if (typeof iat !== "number" || iat > now || now - iat > PENDING_SAVE_TTL_MS) {
    return { status: "invalid_or_expired" };
  }
  return { status: "valid", sid, iat };
}

export async function writePendingSave(sid: string): Promise<string> {
  const session = await getSession(null);
  session.set("sid", sid);
  session.set("iat", Date.now());
  return commitSession(session);
}

export async function clearPendingSave(request: Request): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  return destroySession(session);
}
