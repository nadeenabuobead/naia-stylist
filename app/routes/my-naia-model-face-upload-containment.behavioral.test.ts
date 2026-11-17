// app/routes/my-naia-model-face-upload-containment.behavioral.test.ts
//
// 2026-11-17, launch-readiness audit (C6): before this, my-naia-model.tsx's
// loader and the NaiaModelPhotoUpload component both omitted the face slot
// from the customer-facing UI, but the action's own save-photo intent never
// enforced that — a direct POST with slot="face" (bypassing the UI entirely,
// which any authenticated customer can do) reached saveNaiaModelPhoto's
// face-quality-check path (checkSelfieQuality → Anthropic's vision API) with
// no server-side gate. This is the one confirmed-live reachability gap found
// while answering "is the selfie/face-to-Anthropic path actually reachable
// today" — passport.selfie.tsx's own face-analysis entry point already had an
// equivalent hard gate (isSelfieFeatureEnabledForV1); this route did not.
//
// This file proves the gap is closed: a direct slot="face" save-photo POST is
// rejected before saveNaiaModelPhoto (and therefore before any Anthropic
// call) is ever reached, while slot="body" and face-slot DELETION remain
// fully functional and untouched.
//
// Run: npx vitest run app/routes/my-naia-model-face-upload-containment.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
  saveNaiaModelPhoto: vi.fn(),
  deleteNaiaModelPhoto: vi.fn(),
  saveNaiaModelConsent: vi.fn(),
  withdrawPhotoAnalysisConsent: vi.fn(),
  computeModelReadinessFromRecord: vi.fn(() => ({ hasFacePhoto: false, hasFullBodyPhoto: false, isReadyForTryOn: false })),
  buildModelPreviewUrl: vi.fn(() => "https://res.cloudinary.com/signed-preview"),
  POLICY_VERSION: "1.0",
}));

vi.mock("~/lib/ai/fashn-tryon-service.server", () => ({
  listCustomerVtoPreviews: vi.fn().mockResolvedValue([]),
  deleteOneVtoResult: vi.fn(),
  deleteCustomerVtoResults: vi.fn(),
  deleteNaiaModelBodyPhotoAndVtoResults: vi.fn(),
  withdrawSaveModelConsentAndVtoResults: vi.fn(),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { saveNaiaModelPhoto, deleteNaiaModelPhoto } from "~/lib/ai/my-naia-model.server";
import { action } from "./my-naia-model";

const CUSTOMER_ID = "cust_001";

beforeEach(() => {
  vi.clearAllMocks();
  (requireCurrentNaiaCustomer as any).mockResolvedValue({ id: CUSTOMER_ID });
});

function formRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/my-naia-model", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("my-naia-model action — save-photo, slot=face — V1 containment", () => {
  it("rejects a direct slot=face save-photo POST with 403 and NEVER calls saveNaiaModelPhoto", async () => {
    const res: any = await action({
      request: formRequest({ intent: "save-photo", slot: "face", publicId: "naia-wardrobe/cust_001/sneaky-face" }),
    } as any);

    expect(res.init?.status ?? res.status).toBe(403);
    expect(res.data ?? res).toEqual(expect.objectContaining({ ok: false }));
    // The whole point: saveNaiaModelPhoto (and therefore checkSelfieQuality /
    // Anthropic) is never reached for a face-slot save, regardless of how the
    // request was constructed.
    expect(saveNaiaModelPhoto).not.toHaveBeenCalled();
  });

  it("still requires auth/missing-field validation to run FIRST — a request with no publicId still 400s before the slot check matters either way", async () => {
    const res: any = await action({
      request: formRequest({ intent: "save-photo", slot: "face" }), // no publicId
    } as any);

    expect(res.init?.status ?? res.status).toBe(400);
    expect(saveNaiaModelPhoto).not.toHaveBeenCalled();
  });
});

describe("my-naia-model action — save-photo, slot=body — unaffected by the face-slot containment", () => {
  it("still proceeds to saveNaiaModelPhoto exactly as before", async () => {
    (saveNaiaModelPhoto as any).mockResolvedValue({ ok: true, model: {} });

    const res: any = await action({
      request: formRequest({ intent: "save-photo", slot: "body", publicId: "naia-wardrobe/cust_001/body-1" }),
    } as any);

    expect(saveNaiaModelPhoto).toHaveBeenCalledWith(
      CUSTOMER_ID,
      "body",
      "naia-wardrobe/cust_001/body-1",
      null,
      null,
      "private",
    );
    const status = res.init?.status ?? res.status ?? 200;
    expect(status).toBeLessThan(400);
  });
});

describe("my-naia-model action — delete-photo, slot=face — withdrawal remains fully functional", () => {
  it("a customer withdrawing an existing face photo is NOT blocked by the save-path containment — deletion is a different intent entirely", async () => {
    (deleteNaiaModelPhoto as any).mockResolvedValue({ ok: true });

    const res: any = await action({
      request: formRequest({ intent: "delete-photo", slot: "face" }),
    } as any);

    expect(deleteNaiaModelPhoto).toHaveBeenCalledWith(CUSTOMER_ID, "face");
    const status = res.init?.status ?? res.status ?? 200;
    expect(status).toBeLessThan(400);
  });
});
