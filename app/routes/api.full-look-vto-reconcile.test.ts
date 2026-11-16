// app/routes/api.full-look-vto-reconcile.test.ts
//
// Fully mocked — reconcilePendingFullLookPredictions's real implementation
// (and therefore no real DB/FASHN/Cloudinary access) has its own extensive,
// independent test suite in full-look-tryon-real.server.test.ts. This file
// only verifies the route's own wiring: both header-only auth mechanisms,
// that GET and POST both work identically, and that the response never
// leaks job/customer identifiers.
//
// Run: npx vitest run app/routes/api.full-look-vto-reconcile.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/ai/full-look-tryon-real.server", () => ({
  reconcilePendingFullLookPredictions: vi.fn(),
}));

import { reconcilePendingFullLookPredictions } from "~/lib/ai/full-look-tryon-real.server";
import { loader, action } from "./api.full-look-vto-reconcile";

const mockReconcile = () => reconcilePendingFullLookPredictions as ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };

function req(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.FULL_LOOK_VTO_RECONCILE_SECRET;
  delete process.env.FULL_LOOK_VTO_SWEEP_SECRET;
  mockReconcile().mockResolvedValue({ scanned: 0, recoveredCompleted: 0, recoveredFailed: 0, stillProcessing: 0, statusCheckFailed: 0 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api.full-look-vto-reconcile — authorization", () => {
  it("401s with no auth header at all, never calls the reconciliation sweep", async () => {
    const res = await loader({ request: req() } as never);
    expect(res.data).toEqual({ ok: false, code: "unauthorized" });
    expect(mockReconcile()).not.toHaveBeenCalled();
  });

  it("401s with a wrong CRON_SECRET", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const res = await loader({ request: req({ authorization: "Bearer wrong" }) } as never);
    expect(res.data).toEqual({ ok: false, code: "unauthorized" });
    expect(mockReconcile()).not.toHaveBeenCalled();
  });

  it("401s with a wrong x-full-look-reconcile-secret", async () => {
    process.env.FULL_LOOK_VTO_RECONCILE_SECRET = "correct-secret";
    const res = await loader({ request: req({ "x-full-look-reconcile-secret": "wrong" }) } as never);
    expect(res.data).toEqual({ ok: false, code: "unauthorized" });
    expect(mockReconcile()).not.toHaveBeenCalled();
  });

  it("succeeds with the correct Authorization: Bearer <CRON_SECRET> — Vercel's own documented cron-invocation header", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const res = await loader({ request: req({ authorization: "Bearer correct-secret" }) } as never);
    expect((res.data as any).ok).toBe(true);
    expect(mockReconcile()).toHaveBeenCalledTimes(1);
  });

  it("succeeds with the correct dedicated x-full-look-reconcile-secret — an independent credential, usable without Vercel's own CRON_SECRET", async () => {
    process.env.FULL_LOOK_VTO_RECONCILE_SECRET = "correct-secret";
    const res = await loader({ request: req({ "x-full-look-reconcile-secret": "correct-secret" }) } as never);
    expect((res.data as any).ok).toBe(true);
    expect(mockReconcile()).toHaveBeenCalledTimes(1);
  });

  it("the staging sweep's own dedicated secret (FULL_LOOK_VTO_SWEEP_SECRET) is NOT accepted here — this endpoint has its own, separately-scoped credential", async () => {
    process.env.FULL_LOOK_VTO_SWEEP_SECRET = "a-different-endpoint-entirely";
    const res = await loader({ request: req({ "x-full-look-reconcile-secret": "a-different-endpoint-entirely" }) } as never);
    expect(res.data).toEqual({ ok: false, code: "unauthorized" });
    expect(mockReconcile()).not.toHaveBeenCalled();
  });

  it("fails closed when neither secret is configured at all, even with headers present", async () => {
    const res = await loader({ request: req({ authorization: "Bearer anything", "x-full-look-reconcile-secret": "anything" }) } as never);
    expect(res.data).toEqual({ ok: false, code: "unauthorized" });
  });
});

describe("api.full-look-vto-reconcile — GET and POST behave identically", () => {
  beforeEach(() => {
    process.env.FULL_LOOK_VTO_RECONCILE_SECRET = "s3cr3t";
  });

  it("GET (the real Vercel Cron invocation method) runs the sweep and returns its result", async () => {
    mockReconcile().mockResolvedValueOnce({ scanned: 5, recoveredCompleted: 2, recoveredFailed: 1, stillProcessing: 2, statusCheckFailed: 0 });
    const res = await loader({ request: req({ "x-full-look-reconcile-secret": "s3cr3t" }) } as never);
    expect(res.data).toEqual({ ok: true, scanned: 5, recoveredCompleted: 2, recoveredFailed: 1, stillProcessing: 2, statusCheckFailed: 0 });
  });

  it("POST (manual/ops trigger) runs the exact same authorized sweep", async () => {
    mockReconcile().mockResolvedValueOnce({ scanned: 3, recoveredCompleted: 1, recoveredFailed: 0, stillProcessing: 2, statusCheckFailed: 0 });
    const res = await action({ request: req({ "x-full-look-reconcile-secret": "s3cr3t" }) } as never);
    expect(res.data).toEqual({ ok: true, scanned: 3, recoveredCompleted: 1, recoveredFailed: 0, stillProcessing: 2, statusCheckFailed: 0 });
  });
});

describe("api.full-look-vto-reconcile — response never leaks job or customer identifiers", () => {
  it("the response body contains only the aggregate counts reconcilePendingFullLookPredictions returns — nothing else", async () => {
    process.env.FULL_LOOK_VTO_RECONCILE_SECRET = "s3cr3t";
    mockReconcile().mockResolvedValueOnce({ scanned: 1, recoveredCompleted: 1, recoveredFailed: 0, stillProcessing: 0, statusCheckFailed: 0 });
    const res = await loader({ request: req({ "x-full-look-reconcile-secret": "s3cr3t" }) } as never);
    expect(Object.keys(res.data as object).sort()).toEqual(
      ["ok", "scanned", "recoveredCompleted", "recoveredFailed", "stillProcessing", "statusCheckFailed"].sort(),
    );
  });
});
