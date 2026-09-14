// app/routes/admin.login.tsx
//
// Public login page for the standalone nAia Internal Admin portal.
// This route is NOT nested under admin.tsx — it has no protected parent loader.
// See routes.ts for the explicit registration outside the protected layout.
//
// GET  /admin/login  → renders the login form
// POST /admin/login  → validates INTERNAL_ADMIN_SECRET, creates session, redirects to /admin

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData } from "react-router";
import { verifyAdminSecret, createAdminSession, requireAdminSession } from "~/lib/internal-auth.server";

// If already authenticated, send directly to the portal
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await requireAdminSession(request);
    return redirect("/admin");
  } catch {
    // Not authenticated — render the login form
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  const ok = verifyAdminSecret(password);

  if (!ok) {
    // Lightweight delay to slow brute-force attempts without external state
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
    return { error: "Incorrect password." };
  }

  const cookie = await createAdminSession();
  return redirect("/admin", { headers: { "Set-Cookie": cookie } });
}

export default function AdminLogin() {
  const actionData = useActionData<typeof action>();
  const error = actionData?.error;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <span style={styles.logo}>nAia</span>
          <span style={styles.badge}>Internal</span>
        </div>
        <p style={styles.subtitle}>Staff portal — authorised access only</p>

        <form method="post" style={styles.form}>
          <label style={styles.label} htmlFor="admin-password">
            Password
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            style={styles.input}
            aria-describedby={error ? "login-error" : undefined}
          />
          {error && (
            <p id="login-error" style={styles.error} role="alert">
              {error}
            </p>
          )}
          <button type="submit" style={styles.button}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "12px",
    padding: "2.5rem 2rem",
    width: "100%",
    maxWidth: "360px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    marginBottom: "0.4rem",
  },
  logo: {
    fontSize: "28px",
    fontWeight: 800,
    letterSpacing: "0.05em",
    color: "#d4a843",
  },
  badge: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    background: "#0f172a",
    color: "#64748b",
    padding: "0.2rem 0.5rem",
    borderRadius: "4px",
    border: "1px solid #334155",
  },
  subtitle: {
    fontSize: "13px",
    color: "#64748b",
    margin: "0 0 2rem",
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
  },
  label: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#94a3b8",
    letterSpacing: "0.04em",
  },
  input: {
    height: "42px",
    padding: "0 0.875rem",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#f1f5f9",
    fontSize: "14px",
    outline: "none",
  },
  error: {
    fontSize: "13px",
    color: "#f87171",
    margin: 0,
    padding: "0.5rem 0.75rem",
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.2)",
    borderRadius: "5px",
  },
  button: {
    height: "42px",
    background: "#d4a843",
    color: "#0f172a",
    border: "none",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    marginTop: "0.5rem",
    letterSpacing: "0.02em",
  },
} as const;
