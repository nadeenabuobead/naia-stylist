// app/lib/session.server.ts
import { createCookieSessionStorage } from "react-router";

// Make sure to set SESSION_SECRET in your environment variables
const sessionSecret = process.env.SESSION_SECRET || "default-secret-change-me";

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "__naia_session",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
    sameSite: "lax",
    secrets: [sessionSecret],
    secure: process.env.NODE_ENV === "production",
  },
});

export { getSession, commitSession, destroySession };
