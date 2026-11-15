// app/routes/api.export-zip-sweep.test.ts
//
// Fully mocked — sweepExpiredExportJobs itself (and therefore any real
// DB/Cloudinary access) is mocked here; its own real behavior has an
// extensive, independent test suite in customer-export-zip-large.server.test.ts.
// This file only verifies the route's own wiring: the two header-only auth
// mechanisms, and that — unlike api.staging-full-look-vto-sweep.ts — it is
// NOT gated to staging, since this is a real V1 feature.
//
// Run: npx vitest run app/routes/api.export-zip-sweep.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/customer-export-zip-large.server", () => ({
  sweepExpiredExportJobs: vi.fn(),
}));

import { sweepExpiredExportJobs } from "~/lib/customer-export-zip-large.server";
import { loader } from "./api.export-zip-sweep";

const mockSweep = () => sweepExpiredExportJobs as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.EXPORT_ZIP_SWEEP_SECRET;
  mockSweep().mockResolvedValue({ checked: 0, deleted: 0, failed: 0, more: false });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api.export-zip-sweep — not staging-gated", () => {
  it("runs the same regardless of NAIA_PROJECT_VARIANT — this is a real V1 feature, not a staging-only tool", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.EXPORT_ZIP_SWEEP_SECRET = "s3cr3t";
    const res = await loader({ request: req({ "x-export-zip-sweep-secret": "s3cr3t" }) } as never);
    expect(res.data.ok).toBe(true);
    expect(mockSweep()).toHaveBeenCalledTimes(1);
  });
});

describe("api.export-zip-sweep — authorization", () => {
  it("401s with no auth header at all, never calls the sweep", async () => {
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(res.init?.status ?? 401).toBe(401);
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("401s with a wrong x-export-zip-sweep-secret", async () => {
    process.env.EXPORT_ZIP_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req({ "x-export-zip-sweep-secret": "wrong" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("succeeds with a correct x-export-zip-sweep-secret matching EXPORT_ZIP_SWEEP_SECRET, and returns the sweep's own result shape verbatim", async () => {
    process.env.EXPORT_ZIP_SWEEP_SECRET = "correct-secret";
    mockSweep().mockResolvedValue({ checked: 3, deleted: 2, failed: 1, more: true });
    const res = await loader({ request: req({ "x-export-zip-sweep-secret": "correct-secret" }) } as never);
    expect(res.data).toEqual({ ok: true, checked: 3, deleted: 2, failed: 1, more: true });
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

  it("does not accept another route's dedicated secret (FULL_LOOK_VTO_SWEEP_SECRET) on this route's header", async () => {
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "other-routes-secret";
    const res = await loader({
      request: req({ "x-export-zip-sweep-secret": "other-routes-secret" }),
    } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
  });

  it("never reads a secret from a query string — only headers are consulted", async () => {
    process.env.EXPORT_ZIP_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
  });
});
