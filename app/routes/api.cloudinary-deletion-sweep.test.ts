// app/routes/api.cloudinary-deletion-sweep.test.ts
//
// Fully mocked — sweepPendingCloudinaryDeletions itself (and therefore any
// real DB/Cloudinary access) is mocked here; its own real behavior is
// covered in cloudinary-deletion-claim.server.test.ts. This file only
// verifies the route's own wiring: the two header-only auth mechanisms,
// mirroring api.clerk-cleanup-sweep.test.ts's own reviewed shape exactly.
//
// Run: npx vitest run app/routes/api.cloudinary-deletion-sweep.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/cloudinary-deletion-claim.server", () => ({
  sweepPendingCloudinaryDeletions: vi.fn(),
}));

import { sweepPendingCloudinaryDeletions } from "~/lib/cloudinary-deletion-claim.server";
import { loader } from "./api.cloudinary-deletion-sweep";

const mockSweep = () => sweepPendingCloudinaryDeletions as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.CLOUDINARY_DELETION_SWEEP_SECRET;
  mockSweep().mockResolvedValue({ checked: 0, resolved: 0, failed: 0, more: false });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api.cloudinary-deletion-sweep — authorization", () => {
  it("401s with no auth header at all, never calls the sweep", async () => {
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(res.init?.status ?? 401).toBe(401);
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("401s with a wrong x-cloudinary-deletion-sweep-secret", async () => {
    process.env.CLOUDINARY_DELETION_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req({ "x-cloudinary-deletion-sweep-secret": "wrong" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("succeeds with a correct x-cloudinary-deletion-sweep-secret matching CLOUDINARY_DELETION_SWEEP_SECRET, and returns the sweep's own result shape verbatim", async () => {
    process.env.CLOUDINARY_DELETION_SWEEP_SECRET = "correct-secret";
    mockSweep().mockResolvedValue({ checked: 3, resolved: 2, failed: 1, more: true });
    const res = await loader({ request: req({ "x-cloudinary-deletion-sweep-secret": "correct-secret" }) } as never);
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

  it("does not accept another route's dedicated secret (CLERK_CLEANUP_SWEEP_SECRET) on this route's header", async () => {
    process.env.CLERK_CLEANUP_SWEEP_SECRET = "other-routes-secret";
    const res = await loader({
      request: req({ "x-cloudinary-deletion-sweep-secret": "other-routes-secret" }),
    } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("never reads a secret from a query string — only headers are consulted", async () => {
    process.env.CLOUDINARY_DELETION_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
  });
});
