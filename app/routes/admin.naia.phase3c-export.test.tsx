// app/routes/admin.naia.phase3c-export.test.tsx
//
// "Application Error" on /admin/naia/phase3c-export.
//
// Staging runtime log, dpl_5dYUwm2ptYwe2C14fpGDykxoWY7G:
//
//   GET /admin/naia/phase3c-export  500
//   TypeError: Cannot read properties of undefined (reading 'email')
//       at Phase3CQAExportPage (build/server/.../index.js:95006:46)
//
// The component renders `Signed in as {identity.email}` from useLoaderData, and the
// loader's identity comes from `session.get("identity")` in requireAdminSession — which is
// undefined for an authenticated admin session that carries no identity entry. Auth has
// already succeeded by then, so this is not an access failure: a legitimately signed-in
// admin gets a 500 page instead of the export UI, which is why it looked intermittent
// (it depends on what the session holds, not on who you are).
//
// Rendered rather than source-matched, because the defect is a runtime dereference and a
// source assertion would pass against any syntactically similar rewrite.

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

const state = vi.hoisted(() => ({ loader: {} as unknown }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useLoaderData: () => state.loader, UNSAFE_withComponentProps: (C: unknown) => C };
});
vi.mock("~/lib/internal-auth.server", () => ({ requireAdminSession: vi.fn() }));
vi.mock("~/lib/admin/phase3c-qa-export.server", () => ({ generatePhase3CQAExport: vi.fn() }));

import Phase3CQAExportPage from "./admin.naia.phase3c-export";

describe("P3C — the export page survives a session with no identity", () => {
  it("P3C.1 renders when identity is undefined (the observed 500)", () => {
    state.loader = {};
    expect(() => renderToString(<Phase3CQAExportPage />)).not.toThrow();
  });

  it("P3C.2 renders when identity has no email", () => {
    state.loader = { identity: {} };
    expect(() => renderToString(<Phase3CQAExportPage />)).not.toThrow();
  });

  it("P3C.3 still shows the signed-in email when it IS present", () => {
    state.loader = { identity: { email: "nadeena@example.com" } };
    const html = renderToString(<Phase3CQAExportPage />);
    expect(html).toContain("nadeena@example.com");
    expect(html).toContain("Signed in as");
  });

  it("P3C.4 degrades to a neutral label rather than printing undefined", () => {
    state.loader = {};
    const html = renderToString(<Phase3CQAExportPage />);
    expect(html).not.toContain("undefined");
    expect(html).toContain("Signed in as");
  });

  it("P3C.5 the page itself still renders its purpose", () => {
    state.loader = {};
    const html = renderToString(<Phase3CQAExportPage />);
    expect(html).toContain("QA Export");
  });
});
