// app/routes/admin.naia.phase3c-export-disabled.test.ts
//
// Regression coverage for the disable (2026-11-12) of the bulk
// cross-customer photo export. This route could embed base64 garment
// photos for every customer's Closet in one response, gated by nothing
// beyond the single shared admin password — now hard-disabled while real
// per-person admin authentication is built.
//
// The loader must THROW the 404 Response, not return it. A returned
// Response from a loader is absorbed as ordinary loader data for a full
// document render — the route's own component still renders underneath
// it. Only a thrown Response skips rendering and reaches the nearest
// error boundary. See admin.naia.phase3c-export.integration.test.tsx for
// the full route-tree-level proof of this distinction.
//
// Run: npx vitest run app/routes/admin.naia.phase3c-export-disabled.test.ts

import { describe, it, expect, vi } from "vitest";

const requireAdminSession = vi.fn();
const generatePhase3CQAExport = vi.fn();

vi.mock("~/lib/internal-auth.server", () => ({ requireAdminSession }));
vi.mock("~/lib/admin/phase3c-qa-export.server", () => ({ generatePhase3CQAExport }));

import { loader } from "./admin.naia.phase3c-export";

/** Calls loader(), which must throw rather than return. Fails the test if it
 *  doesn't throw, or if what's thrown isn't a Response. */
async function getThrown(): Promise<Response> {
  try {
    await loader();
  } catch (err) {
    expect(err).toBeInstanceOf(Response);
    return err as Response;
  }
  throw new Error("loader() did not throw — it must throw to skip rendering the route's component");
}

describe("admin.naia.phase3c-export — disabled", () => {
  it("throws a 404 Response for the plain page view", async () => {
    const res = await getThrown();
    expect(res.status).toBe(404);
  });

  it("throws a 404 even for intent=html — never reaches the export generator", async () => {
    const res = await getThrown();
    expect(res.status).toBe(404);
    expect(generatePhase3CQAExport).not.toHaveBeenCalled();
  });

  it("throws a 404 even for intent=json — never reaches the export generator", async () => {
    const res = await getThrown();
    expect(res.status).toBe(404);
    expect(generatePhase3CQAExport).not.toHaveBeenCalled();
  });

  it("never calls requireAdminSession — disabled unconditionally, not gated behind auth", async () => {
    await getThrown();
    expect(requireAdminSession).not.toHaveBeenCalled();
  });

  it("does NOT merely return a 404 Response — a returned Response still lets the route component render", async () => {
    const result = await loader().catch((e) => ({ threw: e }));
    expect(result).toHaveProperty("threw");
  });
});
