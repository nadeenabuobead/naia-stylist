// app/routes/my-naia-model-vto-cascade.behavioral.test.ts
//
// Behavioral coverage for my-naia-model.tsx's action — specifically the
// "delete-photo" and "withdraw-consent" intents, which must route body-slot
// deletions through the VTO-result-cascading wrappers
// (deleteNaiaModelBodyPhotoAndVtoResults / withdrawSaveModelConsentAndVtoResults)
// while leaving face-slot deletion completely untouched (VTO results are
// never derived from the face photo — see fashn-tryon-service.server.ts).
// No prior test file in this repo exercised this route's action at all.
//
// Run: npx vitest run app/routes/my-naia-model-vto-cascade.behavioral.test.ts

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
  buildModelPreviewUrl: vi.fn(() => null),
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
import { deleteNaiaModelPhoto } from "~/lib/ai/my-naia-model.server";
import {
  deleteNaiaModelBodyPhotoAndVtoResults,
  withdrawSaveModelConsentAndVtoResults,
} from "~/lib/ai/fashn-tryon-service.server";
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

function args(fields: Record<string, string>) {
  return { request: formRequest(fields), params: {}, context: {} } as any;
}

describe("delete-photo, slot=body — routes through the VTO-cascading wrapper", () => {
  it("calls deleteNaiaModelBodyPhotoAndVtoResults, never the raw deleteNaiaModelPhoto", async () => {
    (deleteNaiaModelBodyPhotoAndVtoResults as any).mockResolvedValue({
      ok: true,
      cloudinaryOk: true,
      dbCleared: true,
      staleReference: false,
      vtoResultsCleanupAttempted: true,
      vtoResultsDeletedCount: 2,
      vtoResultsPendingCleanup: [],
    });

    const res: any = await action(args({ intent: "delete-photo", slot: "body" }));

    expect(deleteNaiaModelBodyPhotoAndVtoResults).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(deleteNaiaModelPhoto).not.toHaveBeenCalled();
    expect(res.data.ok).toBe(true);
  });

  it("surfaces vtoResultsPendingCleanup rather than reporting unconditional success", async () => {
    (deleteNaiaModelBodyPhotoAndVtoResults as any).mockResolvedValue({
      ok: true,
      cloudinaryOk: true,
      dbCleared: true,
      staleReference: false,
      vtoResultsCleanupAttempted: true,
      vtoResultsDeletedCount: 1,
      vtoResultsPendingCleanup: ["naia-tryon/cust_001/job-1"],
    });

    const res: any = await action(args({ intent: "delete-photo", slot: "body" }));

    expect(res.data.ok).toBe(true);
    expect(res.data.vtoResultsPendingCleanup).toBe(true);
  });

  it("returns 500 when the photo deletion itself genuinely fails (not a staleReference)", async () => {
    (deleteNaiaModelBodyPhotoAndVtoResults as any).mockResolvedValue({
      ok: false,
      cloudinaryOk: false,
      dbCleared: false,
      staleReference: false,
      vtoResultsCleanupAttempted: false,
      vtoResultsDeletedCount: 0,
      vtoResultsPendingCleanup: [],
    });

    const res: any = await action(args({ intent: "delete-photo", slot: "body" }));

    expect(res.init.status).toBe(500);
    expect(res.data.ok).toBe(false);
  });

  it("returns ok:true on a staleReference outcome (Cloudinary succeeded, DB clear failed) — same tolerance as before this fix", async () => {
    (deleteNaiaModelBodyPhotoAndVtoResults as any).mockResolvedValue({
      ok: false,
      cloudinaryOk: true,
      dbCleared: false,
      staleReference: true,
      vtoResultsCleanupAttempted: true,
      vtoResultsDeletedCount: 0,
      vtoResultsPendingCleanup: [],
    });

    const res: any = await action(args({ intent: "delete-photo", slot: "body" }));

    expect(res.data.ok).toBe(true);
  });
});

describe("delete-photo, slot=face — unchanged, no VTO cascade", () => {
  it("calls the raw deleteNaiaModelPhoto directly, never the body-cascading wrapper", async () => {
    (deleteNaiaModelPhoto as any).mockResolvedValue({
      ok: true,
      cloudinaryOk: true,
      dbCleared: true,
      staleReference: false,
    });

    const res: any = await action(args({ intent: "delete-photo", slot: "face" }));

    expect(deleteNaiaModelPhoto).toHaveBeenCalledWith(CUSTOMER_ID, "face");
    expect(deleteNaiaModelBodyPhotoAndVtoResults).not.toHaveBeenCalled();
    expect(res.data.ok).toBe(true);
  });
});

describe("withdraw-consent — unconditional VTO cascade", () => {
  it("calls withdrawSaveModelConsentAndVtoResults, never the raw withdrawSaveModelConsent", async () => {
    (withdrawSaveModelConsentAndVtoResults as any).mockResolvedValue({
      ok: true,
      deletedAssets: [],
      failedAssets: [],
      vtoResultsDeletedCount: 3,
      vtoResultsPendingCleanup: [],
    });

    const res: any = await action(args({ intent: "withdraw-consent" }));

    expect(withdrawSaveModelConsentAndVtoResults).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(res.data.ok).toBe(true);
  });

  it("surfaces vtoResultsPendingCleanup here too, not just on delete-photo", async () => {
    (withdrawSaveModelConsentAndVtoResults as any).mockResolvedValue({
      ok: true,
      deletedAssets: [],
      failedAssets: [],
      vtoResultsDeletedCount: 0,
      vtoResultsPendingCleanup: ["naia-tryon/cust_001/job-2"],
    });

    const res: any = await action(args({ intent: "withdraw-consent" }));

    expect(res.data.vtoResultsPendingCleanup).toBe(true);
  });
});
