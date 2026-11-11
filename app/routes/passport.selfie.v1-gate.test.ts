// app/routes/passport.selfie.v1-gate.test.ts
//
// Locks in the EXISTING isSelfieFeatureEnabledForV1() gate's behavior — this
// gate already exists in passport.selfie.tsx (hardcoded `return false`,
// checked first in both loader() and action(), before any auth resolution).
// This file does not change that gate; it adds the test coverage that was
// previously missing, so a future accidental change can't silently reopen
// the route without a test failing.
//
// No real DB, no real Cloudinary, no real Anthropic — every dependency is
// mocked; the whole point is to prove these are never even CALLED while
// the feature is off.
//
// Run: npx vitest run app/routes/passport.selfie.v1-gate.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/lib/ai/selfie-analysis.server", () => ({ analyseSelfie: vi.fn() }));
vi.mock("~/lib/ai/selfie-upload.server", () => ({
  validateSelfieFile: vi.fn(),
  uploadSelfieToCloudinary: vi.fn(),
  buildSelfieAnalysisUrl: vi.fn(),
  buildSelfiePreviewUrl: vi.fn(),
}));
vi.mock("~/lib/ai/selfie-persistence.server", () => ({
  beginSelfieAnalysis: vi.fn(),
  CURRENT_SELFIE_CONSENT_VERSION: "v1",
  completeSelfieAnalysis: vi.fn(),
  failSelfieAnalysis: vi.fn(),
  deleteSelfiePhoto: vi.fn(),
  deleteAnalysisResult: vi.fn(),
  deleteBoth: vi.fn(),
  loadSelfieForDisplay: vi.fn(),
  getSelfieForModeration: vi.fn(),
  clearSelfiePhotoOwnership: vi.fn(),
}));
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
}));
vi.mock("~/lib/cloudinary-admin.server", () => ({
  buildModelPreviewUrl: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { analyseSelfie } from "~/lib/ai/selfie-analysis.server";
import { uploadSelfieToCloudinary, validateSelfieFile } from "~/lib/ai/selfie-upload.server";
import {
  beginSelfieAnalysis,
  completeSelfieAnalysis,
  failSelfieAnalysis,
  loadSelfieForDisplay,
  deleteSelfiePhoto,
} from "~/lib/ai/selfie-persistence.server";
import { loader, action } from "./passport.selfie.tsx";

beforeEach(() => vi.clearAllMocks());

async function expectRedirectToPassport(fn: () => Promise<any>) {
  try {
    await fn();
    throw new Error("expected a thrown redirect, got a normal return");
  } catch (e: any) {
    expect(e).toBeInstanceOf(Response);
    expect(e.status).toBeGreaterThanOrEqual(300);
    expect(e.status).toBeLessThan(400);
    expect(e.headers.get("Location")).toBe("/passport");
  }
}

describe("direct URL access to the selfie page (loader) while disabled", () => {
  it("redirects to /passport, even with no auth attempted at all", async () => {
    await expectRedirectToPassport(() => loader({ request: new Request("http://localhost/passport/selfie") } as any));
    expect(getCurrentNaiaCustomer).not.toHaveBeenCalled();
    expect(loadSelfieForDisplay).not.toHaveBeenCalled();
  });

  it("redirects the same way even if getCurrentNaiaCustomer would have resolved a real customer", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_real" });
    await expectRedirectToPassport(() => loader({ request: new Request("http://localhost/passport/selfie") } as any));
    expect(getCurrentNaiaCustomer).not.toHaveBeenCalled(); // gate runs first; auth is never even reached
  });
});

describe("direct POST requests to selfie actions while disabled, including authenticated ones", () => {
  const intents = ["analyse", "replace", "retry-moderation", "reanalyse-selfie", "analyse-model-selfie", "delete-both", "save-selfie-only"];

  for (const intent of intents) {
    it(`redirects for intent="${intent}" without reaching auth, upload, or analysis`, async () => {
      (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_real" });
      const body = new FormData();
      body.set("_intent", intent);
      const request = new Request("http://localhost/passport/selfie", { method: "POST", body });

      await expectRedirectToPassport(() => action({ request } as any));

      expect(getCurrentNaiaCustomer).not.toHaveBeenCalled();
      expect(uploadSelfieToCloudinary).not.toHaveBeenCalled();
      expect(validateSelfieFile).not.toHaveBeenCalled();
      expect(analyseSelfie).not.toHaveBeenCalled();
      expect(beginSelfieAnalysis).not.toHaveBeenCalled();
      expect(completeSelfieAnalysis).not.toHaveBeenCalled();
      expect(failSelfieAnalysis).not.toHaveBeenCalled();
      expect(deleteSelfiePhoto).not.toHaveBeenCalled();
    });
  }
});

describe("absence of any upload or provider call while disabled — explicit, not inferred", () => {
  it("not a single mocked dependency is invoked across a realistic sequence of loader + action calls", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_real" });

    await expectRedirectToPassport(() => loader({ request: new Request("http://localhost/passport/selfie") } as any));
    const body = new FormData();
    body.set("_intent", "analyse");
    await expectRedirectToPassport(() => action({ request: new Request("http://localhost/passport/selfie", { method: "POST", body }) } as any));

    const allMocks = [getCurrentNaiaCustomer, analyseSelfie, uploadSelfieToCloudinary, validateSelfieFile, beginSelfieAnalysis, completeSelfieAnalysis, failSelfieAnalysis, loadSelfieForDisplay, deleteSelfiePhoto];
    for (const m of allMocks) expect(m).not.toHaveBeenCalled();
  });
});
