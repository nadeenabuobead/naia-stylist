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
