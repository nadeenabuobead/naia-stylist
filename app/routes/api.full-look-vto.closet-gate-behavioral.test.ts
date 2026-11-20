// app/routes/api.full-look-vto.closet-gate-behavioral.test.ts
//
// 2026-11-21 — route-level proof that the pre-FASHN closet eligibility gate
// is wired into POST /api/full-look-vto: handed to startFullLookOutfit, fed
// the SAME chosen pieces the chain will submit, mapped to a 400 not_eligible
// when refused, and never bypassing the earlier checks or the completed-result
// short-circuit. Fully mocked: no FASHN, no DB, no network.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({ default: { outfitSuggestion: { findUnique: vi.fn() } } }));
vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/lib/ai/my-naia-model.server", () => ({ loadNaiaModel: vi.fn(), computeModelReadinessFromRecord: vi.fn() }));
vi.mock("~/lib/plan/entitlement.server", () => ({ checkEntitlement: vi.fn() }));
vi.mock("~/lib/cloudinary-admin.server", () => ({ getCloudinaryConfig: vi.fn(() => ({ cloudName: "c", apiKey: "k", apiSecret: "s" })) }));
vi.mock("~/lib/ai/full-look-vto-orchestrator.server", () => ({
  selectFullLookGarments: vi.fn(),
  startFullLookOutfit: vi.fn(),
  pollFullLookOutfit: vi.fn(),
  recoverFullLookStep: vi.fn(),
  findCompletedFullLookForSuggestion: vi.fn(),
}));
vi.mock("~/lib/ai/full-look-closet-gate.server", () => ({ gateFullLookClosetGarments: vi.fn() }));

import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { selectFullLookGarments, startFullLookOutfit, findCompletedFullLookForSuggestion } from "~/lib/ai/full-look-vto-orchestrator.server";
import { gateFullLookClosetGarments } from "~/lib/ai/full-look-closet-gate.server";
import { action } from "./api.full-look-vto";

const CUSTOMER_ID = "cust_001";
const SUGGESTION_ID = "sugg_001";
const CHOSEN = [{ itemType: "TOP", closetItemId: "ci-1" }, { itemType: "SHOES", closetItemId: "ci-2" }];

const post = (extra: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/full-look-vto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outfitSuggestionId: SUGGESTION_ID, virtualTryOnConsentAt: new Date().toISOString(), ...extra }),
  });
const call = (extra?: Record<string, unknown>) => action({ request: post(extra), params: {}, context: {} } as any) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentNaiaCustomer as any).mockResolvedValue({ id: CUSTOMER_ID, membershipStatus: "MEMBER" });
  (prisma.outfitSuggestion.findUnique as any).mockResolvedValue({ id: SUGGESTION_ID, session: { customerId: CUSTOMER_ID }, items: [] });
  (selectFullLookGarments as any).mockReturnValue({ garments: [{ label: "a", productImageUrl: "u" }], chosenItems: CHOSEN, omittedLabels: [], fingerprint: "fp" });
  (findCompletedFullLookForSuggestion as any).mockResolvedValue(null);
  (loadNaiaModel as any).mockResolvedValue({ id: "m1", bodyPublicId: "b", bodyFormat: "jpg", deliveryType: "private" });
  (computeModelReadinessFromRecord as any).mockReturnValue({ hasFullBodyPhoto: true, isReadyForTryOn: true });
  (checkEntitlement as any).mockResolvedValue({ allowed: true });
  (startFullLookOutfit as any).mockResolvedValue({ status: "PROCESSING", stepIndex: 0, totalSteps: 5 });
  (gateFullLookClosetGarments as any).mockResolvedValue({ ok: true, screened: 2 });
});

describe("POST /api/full-look-vto — closet eligibility gate wiring", () => {
  it("passes a gate callback to startFullLookOutfit as its 4th argument, and that callback screens the SAME chosen pieces with this customer + Cloudinary config", async () => {
    await call();
    const args = (startFullLookOutfit as any).mock.calls[0];
    expect(typeof args[3]).toBe("function");
    expect(args[2]).toEqual({ forceNewAttempt: false });
    const refusal = await args[3]();
    expect(refusal).toBeNull();
    expect(gateFullLookClosetGarments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      chosenItems: CHOSEN,
      cloudinaryConfig: { cloudName: "c", apiKey: "k", apiSecret: "s" },
    });
  });

  it("the callback converts a gate refusal into the {reason,label} the orchestrator turns into NOT_ELIGIBLE", async () => {
    (gateFullLookClosetGarments as any).mockResolvedValue({ ok: false, reason: "photo_flagged", label: "Scarf" });
    await call();
    expect(await (startFullLookOutfit as any).mock.calls[0][3]()).toEqual({ reason: "photo_flagged", label: "Scarf" });
  });

  it("a NOT_ELIGIBLE orchestrator result is returned as HTTP 400 code not_eligible with the reason and piece label, never ok:true", async () => {
    (startFullLookOutfit as any).mockResolvedValue({ status: "NOT_ELIGIBLE", reason: "unsuitable_image", label: "Loafers" });
    const res = await call();
    expect(res.init.status).toBe(400);
    expect(res.data).toMatchObject({ ok: false, code: "not_eligible", reason: "unsuitable_image", label: "Loafers" });
  });

  it("an explicit retry still passes the gate callback (a retry is a new-attempt start)", async () => {
    await call({ retry: true });
    const args = (startFullLookOutfit as any).mock.calls[0];
    expect(args[2]).toEqual({ forceNewAttempt: true });
    expect(typeof args[3]).toBe("function");
  });

  it("an already-completed look short-circuits BEFORE the gate or the orchestrator start — the saved render is untouched", async () => {
    (findCompletedFullLookForSuggestion as any).mockResolvedValue({ resultUrl: "https://signed/result.png" });
    const res = await call();
    expect(res.data).toMatchObject({ ok: true, status: "COMPLETED" });
    expect(startFullLookOutfit).not.toHaveBeenCalled();
    expect(gateFullLookClosetGarments).not.toHaveBeenCalled();
  });

  it("the earlier checks still run first: an unready model or exhausted entitlement means neither the gate nor FASHN is reached", async () => {
    (computeModelReadinessFromRecord as any).mockReturnValue({ hasFullBodyPhoto: false, isReadyForTryOn: false });
    expect((await call()).init.status).toBe(400);
    (computeModelReadinessFromRecord as any).mockReturnValue({ hasFullBodyPhoto: true, isReadyForTryOn: true });
    (checkEntitlement as any).mockResolvedValue({ allowed: false });
    expect((await call()).init.status).toBe(429);
    expect(startFullLookOutfit).not.toHaveBeenCalled();
    expect(gateFullLookClosetGarments).not.toHaveBeenCalled();
  });
});
