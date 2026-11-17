// app/routes/api.clerk-cleanup-sweep.test.ts
//
// Fully mocked — sweepPendingClerkCleanups itself (and therefore any real
// DB/Clerk access) is mocked here; its own real behavior is covered in
// clerk-cleanup.test.ts. This file only verifies the route's own wiring:
// the two header-only auth mechanisms, mirroring api.export-zip-sweep.ts's
// own already-reviewed test shape exactly.
//
// Run: npx vitest run app/routes/api.clerk-cleanup-sweep.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/clerk-cleanup.server", () => ({
  sweepPendingClerkCleanups: vi.fn(),
}));

import { sweepPendingClerkCleanups } from "~/lib/clerk-cleanup.server";
import { loader } from "./api.clerk-cleanup-sweep";

const mockSweep = () => sweepPendingClerkCleanups as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.CLERK_CLEANUP_SWEEP_SECRET;
  mockSweep().mockResolvedValue({ checked: 0, resolved: 0, failed: 0, more: false });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api.clerk-cleanup-sweep — authorization", () => {
  it("401s with no auth header at all, never calls the sweep", async () => {
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(res.init?.status ?? 401).toBe(401);
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("401s with a wrong x-clerk-cleanup-sweep-secret", async () => {
    process.env.CLERK_CLEANUP_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req({ "x-clerk-cleanup-sweep-secret": "wrong" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("succeeds with a correct x-clerk-cleanup-sweep-secret matching CLERK_CLEANUP_SWEEP_SECRET, and returns the sweep's own result shape verbatim", async () => {
    process.env.CLERK_CLEANUP_SWEEP_SECRET = "correct-secret";
    mockSweep().mockResolvedValue({ checked: 3, resolved: 2, failed: 1, more: true });
    const res = await loader({ request: req({ "x-clerk-cleanup-sweep-secret": "correct-secret" }) } as never);
    expect(res.data).toEqual({ ok: true, checked: 3, resolved: 2, failed: 1, more: true });
    expect(mockSweep()).toHaveBeenCalledTimes(1);
  });

  it("succeeds with Vercel Cron's own Authorization: Bearer <CRON_SECRET> convention", async () => {
    process.env.CRON_SECRET = "cron-secret-value";
    const res = await loader({ request: req({ authorization: "Bearer cron-secret-value" }) } as never);
    expect(res.data.ok).toBe(true);
    expect(mockSweep()).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched Authorization header even when CRON_SECRET is configured", async () => {
    process.env.CRON_SECRET = "cron-secret-value";
    const res = await loader({ request: req({ authorization: "Bearer wrong-value" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("does not accept another route's dedicated secret (EXPORT_ZIP_SWEEP_SECRET) on this route's header", async () => {
    process.env.EXPORT_ZIP_SWEEP_SECRET = "other-routes-secret";
    const res = await loader({
      request: req({ "x-clerk-cleanup-sweep-secret": "other-routes-secret" }),
    } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("never reads a secret from a query string — only headers are consulted", async () => {
    process.env.CLERK_CLEANUP_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
  });
});
