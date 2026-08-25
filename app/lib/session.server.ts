import { createCookieSessionStorage } from "react-router";

const sessionSecret = process.env.SESSION_SECRET || "default-secret-change-me";

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "__naia_session",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "none",
    secrets: [sessionSecret],
    secure: true,
  },
});

export { getSession, commitSession, destroySession };

const STYLEME_SESSION_KEYS = [
  "styleMeMood",
  "styleMeFeelings",
  "styleMeBodyNeeds",
  "styleMePractical",
  "styleMeOccasion",
  "styleMeFormalityConditional",
  "styleMeSource",
  "styleMeNadineAnchorHandle",
  "styleMeClosetAnchorId",
] as const;

export async function clearStyleMeSession(request: Request): Promise<string> {
  const session = await getSession(request.headers.get("Cookie"));
  for (const key of STYLEME_SESSION_KEYS) {
    session.unset(key);
  }
  return commitSession(session);
}
