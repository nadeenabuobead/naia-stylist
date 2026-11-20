// app/routes/api.full-look-vto.intermediate-preview.behavioral.test.ts
//
// 2026-11-20 — Full-Look VTO intermediate-step visibility. A real
// five-garment acceptance test found shoes successfully predicted by FASHN
// at the chain's own "one before final" pause (AWAITING_CONTINUE), but
// there was previously no API surface by which anyone — QA or a real
// customer's own client — could see that step's own output image before
// cleanupIntermediateStepResults deletes it at chain completion.
// full-look-vto-orchestrator.server.test.ts already proves, at the
// orchestrator-function level, that pollFullLookOutfit now surfaces
// result.intermediates as intermediatePreviewUrls on AWAITING_AUTHORIZATION
// (and only for that exact pause, never for the ordinary per-step pause).
// This file closes the remaining gap: it invokes the REAL loader
// (api.full-look-vto.tsx) with a mocked, same-customer-owned suggestion and
// a mocked pollFullLookOutfit resolution, and asserts the field actually
// reaches the HTTP JSON response body — not just the lower-level function
// in isolation. Mirrors api.full-look-vto.ownership-behavioral.test.ts's
// own invoke-the-real-loader convention. No real FASHN/Cloudinary call, no
// live DB, no live session.
//
// Run: npx vitest run app/routes/api.full-look-vto.intermediate-preview.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    outfitSuggestion: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
  computeModelReadinessFromRecord: vi.fn(),
}));

vi.mock("~/lib/plan/entitlement.server", () => ({
  checkEntitlement: vi.fn(),
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => ({})),
}));

vi.mock("~/lib/ai/full-look-vto-orchestrator.server", () => ({
  selectFullLookGarments: vi.fn(),
  startFullLookOutfit: vi.fn(),
  pollFullLookOutfit: vi.fn(),
  recoverFullLookStep: vi.fn(),
  findCompletedFullLookForSuggestion: vi.fn(),
}));

import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel } from "~/lib/ai/my-naia-model.server";
import {
  selectFullLookGarments,
  pollFullLookOutfit,
  findCompletedFullLookForSuggestion,
} from "~/lib/ai/full-look-vto-orchestrator.server";
import { loader } from "./api.full-look-vto";

const CUSTOMER_ID = "cust_001";
const SUGGESTION_ID = "sugg_001";

function mockOwnSuggestion() {
  return {
    id: SUGGESTION_ID,
    session: { customerId: CUSTOMER_ID },
    items: [{ closetItem: { name: "Blazer", imageUrl: null, imagePublicId: "p", imageFormat: "jpg", category: "TOPS" } }],
  };
}

function getReq() {
  return new Request(`http://localhost/api/full-look-vto?suggestionId=${SUGGESTION_ID}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentNaiaCustomer as any).mockResolvedValue({ id: CUSTOMER_ID });
  (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockOwnSuggestion());
  (selectFullLookGarments as any).mockReturnValue({
    garments: [{ label: "shirt", productImageUrl: "https://x/shirt.jpg" }],
    omittedLabels: [],
    fingerprint: "fp-abc",
  });
  (findCompletedFullLookForSuggestion as any).mockResolvedValue(null);
  (loadNaiaModel as any).mockResolvedValue({
    id: "model-1",
    bodyPublicId: "body-1",
    bodyFormat: "jpg",
    deliveryType: "private",
  });
});

describe("GET /api/full-look-vto — intermediatePreviewUrls reaches the real HTTP response", () => {
  it("includes intermediatePreviewUrls in the JSON body when the chain is at the pre-final AWAITING_CONTINUE pause", async () => {
    const intermediates = [
      { stepIndex: 0, label: "shirt", url: "https://signed/shirt.png" },
      { stepIndex: 1, label: "pants", url: "https://signed/pants.png" },
      { stepIndex: 2, label: "shoes", url: "https://signed/shoes.png" },
    ];
    (pollFullLookOutfit as any).mockResolvedValue({
      status: "AWAITING_AUTHORIZATION",
      stepIndex: 3,
      totalSteps: 5,
      intermediatePreviewUrls: intermediates,
    });

    const res: any = await loader({ request: getReq(), params: {}, context: {} } as any);

    expect(res.data.ok).toBe(true);
    expect(res.data.status).toBe("AWAITING_AUTHORIZATION");
    expect(res.data.intermediatePreviewUrls).toEqual(intermediates);
    // Including the shoes step specifically — the exact gap the real
    // five-garment acceptance test found: no way to see this image.
    expect(res.data.intermediatePreviewUrls).toContainEqual(
      expect.objectContaining({ label: "shoes", url: "https://signed/shoes.png" }),
    );
  });

  it("omits intermediatePreviewUrls entirely from the JSON body for an ordinary per-step pause (not pre-final)", async () => {
    (pollFullLookOutfit as any).mockResolvedValue({
      status: "AWAITING_AUTHORIZATION",
      stepIndex: 0,
      totalSteps: 5,
    });

    const res: any = await loader({ request: getReq(), params: {}, context: {} } as any);

    expect(res.data.ok).toBe(true);
    expect(res.data.status).toBe("AWAITING_AUTHORIZATION");
    expect(res.data).not.toHaveProperty("intermediatePreviewUrls");
  });
});
