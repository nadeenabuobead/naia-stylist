// Loader-level resilience tests for buyskip.$id.tsx — the exact call site
// implicated in the 2026-11-14 Buy-or-Skip "Something went wrong"
// incident. Verifies the lookup now survives one transient connection-pool
// error (same pattern already proven for session resolution) and still
// propagates a non-transient error or a genuine not-found redirect
// unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: { buyOrSkipAnalysis: { findUnique: vi.fn() } },
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
  validatePublicIdOwnership: vi.fn(() => ({ ok: false })),
  validateImageUrlOwnership: vi.fn(() => true),
  buildPrivateDownloadUrl: vi.fn(() => null),
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(async () => null),
  computeModelReadinessFromRecord: vi.fn(() => ({ ready: false })),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, redirect: (url: string) => ({ __redirect: url }) };
});

// Pre-existing local environment gap (confirmed unrelated to this change):
// @clerk/react-router is not resolvable in this sandbox's node_modules, so
// anything importing MyNaiaLayout/VtoExperience transitively fails to even
// load. Mocked purely so this loader-only test can import the route module
// at all — no behavioral assertion depends on either mock's shape.
vi.mock("~/components/my-naia/MyNaiaLayout", () => ({ default: () => null }));
vi.mock("~/components/VtoExperience", () => ({ VtoExperience: () => null }));
vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "" }));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { loader } from "./buyskip.$id";

function prismaError(code: string) {
  const err = new Error("boom") as Error & { code: string };
  err.code = code;
  return err;
}

const BASE_ANALYSIS = {
  id: "analysis-1",
  customerId: "cust-1",
  createdAt: new Date(0),
  imageUrl: null,
  imagePublicId: null,
  imageFormat: null,
  verdict: "BUY",
  reasoning: "test",
  confidence: 80,
  category: "Top",
  colors: [],
  forOccasion: null,
  whatLike: null,
  unsureAbout: null,
  colorNote: null,
  itemSize: null,
  fullAnalysis: null,
  outcome: null,
};

describe("buyskip.$id loader — transient DB retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers from one transient connection-pool error and still returns the analysis", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(prisma.buyOrSkipAnalysis.findUnique)
      .mockRejectedValueOnce(prismaError("P2024"))
      .mockResolvedValueOnce(BASE_ANALYSIS as any);

    const result: any = await loader({
      request: new Request("http://localhost/buyskip/analysis-1"),
      params: { id: "analysis-1" },
    } as any);

    // loader() returns react-router's data() wrapper, not the raw payload.
    expect(result.data.verdict).toBe("BUY");
    expect(prisma.buyOrSkipAnalysis.findUnique).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("a non-transient error is not retried and propagates immediately", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    const realError = new Error("unexpected schema error");
    vi.mocked(prisma.buyOrSkipAnalysis.findUnique).mockRejectedValueOnce(realError);

    await expect(
      loader({ request: new Request("http://localhost/buyskip/analysis-1"), params: { id: "analysis-1" } } as any),
    ).rejects.toBe(realError);
    expect(prisma.buyOrSkipAnalysis.findUnique).toHaveBeenCalledTimes(1);
  });

  it("a genuine not-found result (no transient error at all) still redirects normally — retry logic never masks a real 'no row'", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(prisma.buyOrSkipAnalysis.findUnique).mockResolvedValueOnce(null);

    const result: any = await loader({
      request: new Request("http://localhost/buyskip/analysis-1"),
      params: { id: "analysis-1" },
    } as any);

    expect(result).toEqual({ __redirect: "/my-naia/buying-decisions" });
    expect(prisma.buyOrSkipAnalysis.findUnique).toHaveBeenCalledTimes(1);
  });
});
