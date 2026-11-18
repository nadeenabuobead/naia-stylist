// Loader-level resilience tests for my-naia.buying-decisions.tsx — the My
// Decisions list, the other plausible GET path for the 2026-11-14
// "Something went wrong" incident. Same contract as
// buyskip.$id.loader-resilience.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: { buyOrSkipAnalysis: { findMany: vi.fn() } },
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
  validatePublicIdOwnership: vi.fn(() => ({ ok: false })),
  validateImageUrlOwnership: vi.fn(() => true),
  buildPrivateDownloadUrl: vi.fn(() => null),
}));

vi.mock("~/lib/buy-or-skip-privacy.server", () => ({
  deleteOneBosDecision: vi.fn(),
}));

vi.mock("~/components/my-naia/MyNaiaLayout", () => ({ default: () => null }));
vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "" }));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { loader } from "./my-naia.buying-decisions";

function prismaError(code: string) {
  const err = new Error("boom") as Error & { code: string };
  err.code = code;
  return err;
}

describe("my-naia.buying-decisions loader — transient DB retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers from one transient connection-pool error and still returns the list", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(prisma.buyOrSkipAnalysis.findMany)
      .mockRejectedValueOnce(prismaError("P2024"))
      .mockResolvedValueOnce([
        {
          id: "a1",
          createdAt: new Date(0),
          imageUrl: null,
          imagePublicId: null,
          imageFormat: null,
          verdict: "BUY",
          confidence: 80,
          category: "Top",
          reasoning: "test",
          outcome: null,
        },
      ] as any);

    const result: any = await loader({ request: new Request("http://localhost/my-naia/buying-decisions") } as any);

    expect(result.data.decisions).toHaveLength(1);
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("a non-transient error is not retried and propagates immediately", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    const realError = new Error("unexpected schema error");
    vi.mocked(prisma.buyOrSkipAnalysis.findMany).mockRejectedValueOnce(realError);

    await expect(
      loader({ request: new Request("http://localhost/my-naia/buying-decisions") } as any),
    ).rejects.toBe(realError);
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledTimes(1);
  });

  it("a genuine empty list (no transient error at all) is returned as-is — retry logic never fabricates rows", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(prisma.buyOrSkipAnalysis.findMany).mockResolvedValueOnce([] as any);

    const result: any = await loader({ request: new Request("http://localhost/my-naia/buying-decisions") } as any);

    expect(result.data.decisions).toEqual([]);
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledTimes(1);
  });
});
