// app/routes/api.health.tsx
//
// Phase 1 ops — minimal liveness check for external uptime monitors.
//
// Deliberately minimal and unauthenticated (an uptime monitor must be able
// to reach it without credentials). It proves only that this process is up
// and can respond to a request — nothing more. It does NOT:
//   - touch the database or any external provider (a slow/degraded DB or
//     AI provider must never make this endpoint report unhealthy — that is
//     a separate, future readiness-check concern, not liveness)
//   - return any environment variable, config value, internal hostname,
//     git SHA, dependency version, or stack trace
//   - require auth (so it carries no session/customer data to leak)
//
// GET only. No action() — this endpoint has no state-changing behavior.

import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request: _request }: LoaderFunctionArgs) {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
