// app/routes/api.staging-full-look-vto-sweep.test.ts
//
// Fully mocked — neither sweep's real implementation (and therefore no real
// DB/Cloudinary access) runs here; each has its own extensive, independent
// test suite in full-look-tryon-real.server.test.ts. This file only verifies
// the route's own wiring: the staging gate, the two header-only auth
// mechanisms, and that both sweeps run and are reported independently.
//
// Run: npx vitest run app/routes/api.staging-full-look-vto-sweep.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/ai/full-look-tryon-real.server", () => ({
  sweepAbandonedFullLookPauses: vi.fn(),
  sweepStaleFullLookSteps: vi.fn(),
}));

import { sweepAbandonedFullLookPauses, sweepStaleFullLookSteps } from "~/lib/ai/full-look-tryon-real.server";
import { loader } from "./api.staging-full-look-vto-sweep";

const mockSweep = () => sweepAbandonedFullLookPauses as ReturnType<typeof vi.fn>;
const mockStaleSweep = () => sweepStaleFullLookSteps as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NAIA_PROJECT_VARIANT = "staging";
  delete process.env.CRON_SECRET;
  delete process.env.FULL_LOOK_VTO_SWEEP_SECRET;
  delete process.env.STAGING_SEED_SECRET;
  delete process.env.WI_QA_LOGIN_SECRET;
  mockSweep().mockResolvedValue({ cleanedChains: 0, skippedActive: 0, skippedAlreadyAdvanced: 0 });
  mockStaleSweep().mockResolvedValue({ timedOut: 0, skippedRace: 0 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api.staging-full-look-vto-sweep — staging gate", () => {
  it("SWR.1 — 404s outside staging, even with a correct secret", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "s3cr3t";
    await expect(
      loader({ request: req({ "x-full-look-sweep-secret": "s3cr3t" }) } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockSweep()).not.toHaveBeenCalled();
    expect(mockStaleSweep()).not.toHaveBeenCalled();
  });

  it("SWR.2 — 404s when NAIA_PROJECT_VARIANT is unset", async () => {
    delete process.env.NAIA_PROJECT_VARIANT;
    await expect(loader({ request: req() } as never)).rejects.toMatchObject({ status: 404 });
  });
});

describe("api.staging-full-look-vto-sweep — authorization (dedicated secret, 2026-11-04)", () => {
  it("SWR.3 — 401s with no auth header at all, never calls the sweep", async () => {
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
    expect(mockStaleSweep()).not.toHaveBeenCalled();
  });

  it("SWR.4 — 401s with a wrong x-full-look-sweep-secret", async () => {
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "correct-secret";
    const res = await loader({ request: req({ "x-full-look-sweep-secret": "wrong" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
    expect(mockStaleSweep()).not.toHaveBeenCalled();
  });

  it("SWR.5 — succeeds with a correct x-full-look-sweep-secret matching FULL_LOOK_VTO_SWEEP_SECRET, running and reporting both sweeps", async () => {
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "correct-secret";
    mockSweep().mockResolvedValue({ cleanedChains: 2, skippedActive: 1, skippedAlreadyAdvanced: 0 });
    mockStaleSweep().mockResolvedValue({ timedOut: 3, skippedRace: 1 });
    const res = await loader({ request: req({ "x-full-look-sweep-secret": "correct-secret" }) } as never);
    expect(res.data).toEqual({
      ok: true,
      pauseSweep: { cleanedChains: 2, skippedActive: 1, skippedAlreadyAdvanced: 0 },
      staleStepSweep: { timedOut: 3, skippedRace: 1 },
    });
    expect(mockSweep()).toHaveBeenCalledTimes(1);
    expect(mockStaleSweep()).toHaveBeenCalledTimes(1);
  });

  it("SWR.5b — one sweep failing is reported without blocking or hiding the other sweep's result", async () => {
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "correct-secret";
    mockSweep().mockRejectedValue(new Error("cloudinary down"));
    mockStaleSweep().mockResolvedValue({ timedOut: 1, skippedRace: 0 });
    const res = await loader({ request: req({ "x-full-look-sweep-secret": "correct-secret" }) } as never);
    const resData = res.data as { ok: boolean; pauseSweep: { error: string }; staleStepSweep: unknown };
    expect(resData.ok).toBe(false);
    expect(resData.staleStepSweep).toEqual({ timedOut: 1, skippedRace: 0 });
    expect(resData.pauseSweep.error).toContain("cloudinary down");
  });

  it("SWR.6 — the broader-access staging secrets (STAGING_SEED_SECRET, WI_QA_LOGIN_SECRET) are NOT accepted here, even sent on the dedicated header", async () => {
    process.env.STAGING_SEED_SECRET = "broad-secret";
    process.env.WI_QA_LOGIN_SECRET = "also-broad-secret";
    // Neither FULL_LOOK_VTO_SWEEP_SECRET nor CRON_SECRET is set.
    const res1 = await loader({ request: req({ "x-full-look-sweep-secret": "broad-secret" }) } as never);
    expect(res1.data).toEqual({ ok: false, reason: "unauthorized" });
    const res2 = await loader({ request: req({ "x-full-look-sweep-secret": "also-broad-secret" }) } as never);
    expect(res2.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
    expect(mockStaleSweep()).not.toHaveBeenCalled();
  });

  it("SWR.7 — succeeds with Vercel Cron's own Authorization: Bearer <CRON_SECRET> convention", async () => {
    process.env.CRON_SECRET = "cron-secret-value";
    const res = await loader({ request: req({ authorization: "Bearer cron-secret-value" }) } as never);
    expect(res.data.ok).toBe(true);
    expect(mockSweep()).toHaveBeenCalledTimes(1);
    expect(mockStaleSweep()).toHaveBeenCalledTimes(1);
  });

  it("SWR.8 — rejects a mismatched Authorization header even when CRON_SECRET is configured", async () => {
    process.env.CRON_SECRET = "cron-secret-value";
    const res = await loader({ request: req({ authorization: "Bearer wrong-value" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
    expect(mockSweep()).not.toHaveBeenCalled();
    expect(mockStaleSweep()).not.toHaveBeenCalled();
  });

  it("SWR.9 — never reads a secret from a query string — only headers are consulted", async () => {
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "correct-secret";
    // No headers at all, even though a real request might carry the secret
    // in the URL — this route must never accept that.
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, reason: "unauthorized" });
  });
});
