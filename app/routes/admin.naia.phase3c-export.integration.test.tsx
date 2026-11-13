// app/routes/admin.naia.phase3c-export.integration.test.tsx
//
// Integration coverage for the bulk-export disable, exercising React
// Router's ACTUAL nested route handling (createStaticHandler), not just
// the loader function in isolation. A plain unit test calling loader()
// directly never runs route matching + rendering, so it can't catch a
// loader that *returns* its 404 instead of throwing it — the route's own
// component (Download buttons included) would still render underneath a
// returned Response for a real authenticated admin session.
//
// Mounts the real admin.tsx -> admin.naia.tsx -> admin.naia.phase3c-export.tsx
// chain (the exact same route modules the app ships), with
// requireAdminSession mocked to simulate a genuinely authenticated session.
//
// createStaticHandler().query()'s result is always a StaticHandlerContext
// object here, never a raw Response — context.statusCode is not a
// reliable signal (it reads 404 either way, since it inspects the
// Response's own .status regardless of throw-vs-return). The real tell is
// context.errors: a thrown Response lands there and the route gets NO
// entry in context.loaderData at all; a returned Response has its body
// unwrapped into context.loaderData as ordinary data instead.
//
// Run: npx vitest run app/routes/admin.naia.phase3c-export.integration.test.tsx

import { describe, it, expect, vi } from "vitest";
import { createStaticHandler, isRouteErrorResponse } from "react-router";

const { requireAdminSession, generatePhase3CQAExport } = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  generatePhase3CQAExport: vi.fn(),
}));

vi.mock("~/lib/internal-auth.server", () => ({ requireAdminSession }));
vi.mock("~/lib/admin/phase3c-qa-export.server", () => ({ generatePhase3CQAExport }));

import AdminLayout, { loader as adminLoader } from "./admin";
import NaiaAdminWorkspace from "./admin.naia";
import Phase3CQAExportPage, { loader as exportLoader } from "./admin.naia.phase3c-export";

const AUTHENTICATED_IDENTITY = { id: "owner", email: "nadine@naiabynadine.com", role: "owner" as const };

const routes = [
  {
    path: "/admin",
    Component: AdminLayout,
    loader: adminLoader,
    children: [
      {
        path: "naia",
        Component: NaiaAdminWorkspace,
        children: [
          {
            path: "phase3c-export",
            Component: Phase3CQAExportPage,
            loader: exportLoader,
          },
        ],
      },
    ],
  },
];

async function queryAsAuthenticatedAdmin(path: string) {
  requireAdminSession.mockResolvedValue({ authenticated: true, identity: AUTHENTICATED_IDENTITY });
  const { query } = createStaticHandler(routes);
  return query(new Request(`https://example.com${path}`));
}

describe("admin.naia.phase3c-export — real route-tree integration (authenticated session)", () => {
  it("an authenticated administrator's request is captured as an error for this route, not rendered as the page", async () => {
    const result: any = await queryAsAuthenticatedAdmin("/admin/naia/phase3c-export");

    expect(result.errors, "a thrown Response must be captured in context.errors").toBeTruthy();
    const matchedError = Object.values(result.errors)[0];
    // React Router wraps a thrown Response in its own ErrorResponse type
    // (what an ErrorBoundary's useRouteError() would receive) — not a raw
    // Response instance. isRouteErrorResponse is the framework's own type
    // guard for exactly this.
    expect(isRouteErrorResponse(matchedError)).toBe(true);
    expect((matchedError as any).status).toBe(404);

    // The historical defect's exact signature — a raw "Not found" string
    // standing in as this route's loaderData — must not be present.
    expect(JSON.stringify(result.loaderData)).not.toContain("Not found");
  });

  it("the export generator is never reached, even though the session is genuinely authenticated, and this holds for every intent", async () => {
    await queryAsAuthenticatedAdmin("/admin/naia/phase3c-export");
    expect(generatePhase3CQAExport).not.toHaveBeenCalled();

    await queryAsAuthenticatedAdmin("/admin/naia/phase3c-export?intent=html");
    expect(generatePhase3CQAExport).not.toHaveBeenCalled();

    await queryAsAuthenticatedAdmin("/admin/naia/phase3c-export?intent=json");
    expect(generatePhase3CQAExport).not.toHaveBeenCalled();
  });

  it("requireAdminSession IS reached this time (parent layout runs first) but does not help the export route", async () => {
    await queryAsAuthenticatedAdmin("/admin/naia/phase3c-export");
    // admin.tsx's own loader calls this — unlike the disabled route's own
    // loader, which never calls it (confirmed in the unit tests).
    expect(requireAdminSession).toHaveBeenCalled();
  });

  it("an UNAUTHENTICATED request is also blocked, and still never reaches the export route's own logic", async () => {
    requireAdminSession.mockRejectedValue(new Response(null, { status: 302, headers: { Location: "/admin/login" } }));
    const { query } = createStaticHandler(routes);
    const result: any = await query(new Request("https://example.com/admin/naia/phase3c-export"));

    // The parent layout's own auth redirect fires before the child route's
    // disabled loader is even relevant — either way, no export data exists
    // anywhere in the result.
    expect(JSON.stringify(result.loaderData ?? {})).not.toContain("Not found");
    expect(generatePhase3CQAExport).not.toHaveBeenCalled();
  });

  it("control case: a normal successful authenticated request to a sibling route has no errors — the harness can tell the two outcomes apart", async () => {
    requireAdminSession.mockResolvedValue({ authenticated: true, identity: AUTHENTICATED_IDENTITY });
    const { query } = createStaticHandler([
      {
        path: "/admin",
        Component: AdminLayout,
        loader: adminLoader,
        children: [{ path: "naia", Component: NaiaAdminWorkspace }],
      },
    ]);
    const result: any = await query(new Request("https://example.com/admin/naia"));
    expect(result.errors).toBeFalsy();
  });
});
