// app/routes/staging.full-look-vto-real.test.ts
//
// Fully mocked — zero real DB, zero real FASHN/Cloudinary network call. The
// gate/Work-combination-resolution/quota-policy functions imported from
// staging.full-look-vto-test.tsx are mocked here (that file's own test suite
// already covers their real behavior exhaustively); this file only verifies
// staging.full-look-vto-real.tsx's OWN wiring: auth, consent, the extra
// real-run confirmation, pre-flight checks, and correct delegation to
// full-look-tryon-real.server.ts (also mocked — see that module's own
// extensive, independent test file for its real behavior).
//
// Run: npx vitest run app/routes/staging.full-look-vto-real.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
  computeModelReadinessFromRecord: vi.fn(),
}));
vi.mock("~/lib/ai/closet-eligibility", () => ({
  isVtoCategoryAllowed: vi.fn(),
}));
vi.mock("~/lib/ai/styleme-anchor.server", () => ({
  resolveClosetAnchor: vi.fn(),
}));
vi.mock("~/lib/image-suitability.server", () => ({
  screenGarmentSuitability: vi.fn(),
}));
vi.mock("./staging.full-look-vto-test", () => ({
  isAuthorizedStagingTestAccount: vi.fn(),
}));
vi.mock("~/lib/ai/full-look-work-combination.server", () => ({
  resolveExpectedWorkCombination: vi.fn(),
  hasQuotaRoomForFullLookChain: vi.fn(),
  sortForDisplay: vi.fn((g: unknown[]) => g),
  MAX_CONSENT_AGE_MS: 15 * 60 * 1000,
  FINAL_STEP_VISUAL_PROMPT: "MOCK_FINAL_STEP_PROMPT",
  FINAL_STEP_GENERATION_MODE: "quality",
}));
vi.mock("~/lib/ai/full-look-tryon-real.server", () => ({
  startOrResumeFullLookChain: vi.fn(),
  advanceFullLookChain: vi.fn(),
  continueToFinalStep: vi.fn(),
  isCompatibleModelPhotoFormat: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { isAuthorizedStagingTestAccount } from "./staging.full-look-vto-test";
import {
  resolveExpectedWorkCombination,
  hasQuotaRoomForFullLookChain,
} from "~/lib/ai/full-look-work-combination.server";
import {
  startOrResumeFullLookChain,
  advanceFullLookChain,
  continueToFinalStep,
  isCompatibleModelPhotoFormat,
} from "~/lib/ai/full-look-tryon-real.server";
import { loader, action } from "./staging.full-look-vto-real";

const mockCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockLoadModel = () => loadNaiaModel as ReturnType<typeof vi.fn>;
const mockReadiness = () => computeModelReadinessFromRecord as ReturnType<typeof vi.fn>;
const mockCategoryAllowed = () => isVtoCategoryAllowed as ReturnType<typeof vi.fn>;
const mockResolveAnchor = () => resolveClosetAnchor as ReturnType<typeof vi.fn>;
const mockScreenSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;
const mockGate = () => isAuthorizedStagingTestAccount as ReturnType<typeof vi.fn>;
const mockResolveWork = () => resolveExpectedWorkCombination as ReturnType<typeof vi.fn>;
const mockQuota = () => hasQuotaRoomForFullLookChain as ReturnType<typeof vi.fn>;
const mockStartChain = () => startOrResumeFullLookChain as ReturnType<typeof vi.fn>;
const mockAdvanceChain = () => advanceFullLookChain as ReturnType<typeof vi.fn>;
const mockContinueChain = () => continueToFinalStep as ReturnType<typeof vi.fn>;
const mockCompatibleFormat = () => isCompatibleModelPhotoFormat as ReturnType<typeof vi.fn>;

const SARA = { id: "sara-cust-1", shopifyCustomerId: "sara-shop-1", membershipStatus: "MEMBER" };
const READY_MODEL = { id: "model-1", bodyPublicId: "body-1", bodyFormat: "jpg", deliveryType: "private", bodyModerationStatus: "APPROVED" };

const RESOLVED_GARMENTS = [
  { closetItemId: "g-trousers", name: "Beige Tailored Trousers", category: "BOTTOMS", subcategory: null, slot: "bottom" },
  { closetItemId: "g-shirt", name: "Blue Chambray Button-Up Shirt", category: "TOPS", subcategory: null, slot: "top" },
  { closetItemId: "g-blazer", name: "Beige Tailored Blazer", category: "OUTERWEAR", subcategory: null, slot: "outerwear" },
];

function formRequest(fields: Record<string, string> = {}) {
  const fd = new FormData();
  const withDefaults = {
    consent: "yes",
    virtualTryOnConsentAt: new Date().toISOString(),
    confirmReal: "yes-real-fashn-calls",
    ...fields,
  };
  for (const [k, v] of Object.entries(withDefaults)) fd.set(k, v);
  return { formData: () => Promise.resolve(fd) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGate().mockReturnValue(true);
  mockCustomer().mockResolvedValue(SARA);
  mockLoadModel().mockResolvedValue(READY_MODEL);
  mockReadiness().mockReturnValue({ hasFullBodyPhoto: true, isReadyForTryOn: true });
  mockCompatibleFormat().mockReturnValue(true);
  mockCategoryAllowed().mockReturnValue(true);
  mockQuota().mockResolvedValue(true);
  mockResolveWork().mockResolvedValue({ ok: true, reason: "A work look", garments: RESOLVED_GARMENTS });
  mockResolveAnchor().mockImplementation((_cust: string, closetItemId: string) =>
    Promise.resolve({ imageUrl: `https://closet.example/${closetItemId}.jpg` }),
  );
  mockScreenSuitability().mockResolvedValue({ status: "PASS" });
});

// ── Auth gate ─────────────────────────────────────────────────────────────────

describe("auth gate — reused unmodified from the mock route", () => {
  it("RT.1 — loader 404s when not authenticated", async () => {
    mockCustomer().mockResolvedValue(null);
    await expect(loader({ request: {} as Request } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("RT.2 — loader 404s when not on the allowlist", async () => {
    mockGate().mockReturnValue(false);
    await expect(loader({ request: {} as Request } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("RT.3 — action 404s when not authenticated", async () => {
    mockCustomer().mockResolvedValue(null);
    await expect(action({ request: formRequest() } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("RT.4 — action 404s when not on the allowlist", async () => {
    mockGate().mockReturnValue(false);
    await expect(action({ request: formRequest() } as never)).rejects.toMatchObject({ status: 404 });
  });
});

// ── Action — pre-flight gates before anything real is ever submitted ────────

describe("action — pre-flight gates", () => {
  it("RT.5 — requires the consent checkbox", async () => {
    const res = await action({ request: formRequest({ consent: "no" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "consent_required" });
    expect(mockStartChain()).not.toHaveBeenCalled();
  });

  it("RT.6 — rejects an expired consent timestamp", async () => {
    const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const res = await action({ request: formRequest({ virtualTryOnConsentAt: stale }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "consent_expired" });
    expect(mockStartChain()).not.toHaveBeenCalled();
  });

  it("RT.7 — requires the SEPARATE real-run confirmation, distinct from the mock route's checkbox", async () => {
    const res = await action({ request: formRequest({ confirmReal: "yes" } ) } as never); // wrong value
    expect(res.data).toEqual({ ok: false, reason: "real_confirmation_required" });
    expect(mockStartChain()).not.toHaveBeenCalled();

    const res2 = await action({ request: formRequest({ confirmReal: "" }) } as never);
    expect(res2.data).toEqual({ ok: false, reason: "real_confirmation_required" });
  });

  it("RT.8 — fails closed when the expected Work combination isn't found", async () => {
    mockResolveWork().mockResolvedValue({ ok: false, reason: "expected_combination_not_found" });
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "expected_combination_not_found" });
    expect(mockStartChain()).not.toHaveBeenCalled();
  });

  it("RT.9 — requires model readiness", async () => {
    mockReadiness().mockReturnValue({ hasFullBodyPhoto: false, isReadyForTryOn: false });
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "model_not_ready" });
  });

  it("RT.10 — requires body photo moderation APPROVED", async () => {
    mockLoadModel().mockResolvedValue({ ...READY_MODEL, bodyModerationStatus: "PENDING" });
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "model_not_moderated" });
  });

  it("RT.11 — rejects an incompatible model photo format (e.g. HEIC) before any FASHN call", async () => {
    mockCompatibleFormat().mockReturnValue(false);
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "model_photo_format_unsupported" });
    expect(mockStartChain()).not.toHaveBeenCalled();
    expect(mockResolveAnchor()).not.toHaveBeenCalled(); // fails before even resolving garment images
  });

  it("RT.12 — rejects an ineligible garment category", async () => {
    mockCategoryAllowed().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "garment_not_eligible" });
  });

  it("RT.13 — enforces the quota pre-check before resolving any garment image", async () => {
    mockQuota().mockResolvedValue(false);
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
    expect(mockResolveAnchor()).not.toHaveBeenCalled();
  });

  it("RT.14 — fails closed when a garment's real Closet image can't be resolved", async () => {
    mockResolveAnchor().mockResolvedValueOnce(null);
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "garment_image_unavailable" });
    expect(mockStartChain()).not.toHaveBeenCalled();
  });

  it("RT.15 — fails closed when the real AI suitability screen does not PASS", async () => {
    mockScreenSuitability().mockResolvedValueOnce({ status: "RETRY_IMAGE", subCode: "assessment_failed" });
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "garment_not_suitable" });
    expect(mockStartChain()).not.toHaveBeenCalled();
  });

  it("RT.16 — on success, starts the chain with the 3 real resolved garment URLs in body-outward order", async () => {
    mockStartChain().mockResolvedValue({ ok: true, stepIndex: 0 });
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: true, stepIndex: 0 });

    expect(mockStartChain()).toHaveBeenCalledTimes(1);
    const ctx = mockStartChain().mock.calls[0][0];
    expect(ctx.customerId).toBe("sara-cust-1");
    expect(ctx.garments).toEqual([
      { label: "Beige Tailored Trousers", productImageUrl: "https://closet.example/g-trousers.jpg" },
      { label: "Blue Chambray Button-Up Shirt", productImageUrl: "https://closet.example/g-shirt.jpg" },
      { label: "Beige Tailored Blazer", productImageUrl: "https://closet.example/g-blazer.jpg" },
    ]);
  });

  it("RT.17 — surfaces a chain-start failure (e.g. an already-claimed permanent reservation) without crashing", async () => {
    mockStartChain().mockResolvedValue({ ok: false, reason: "full_look_test_already_attempted" });
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toEqual({ ok: false, reason: "full_look_test_already_attempted" });
  });
});

// ── Loader — poll only, never submits step 0, secure result access only ─────

describe("loader — poll only", () => {
  it("RT.18 — reports NOT_STARTED when no nAia Model exists yet", async () => {
    mockLoadModel().mockResolvedValue(null);
    const res = await loader({ request: {} as Request } as never);
    expect(res.data).toEqual({ ok: true, modelReady: false, chain: { status: "NOT_STARTED" } });
    expect(mockAdvanceChain()).not.toHaveBeenCalled();
  });

  it("RT.19 — fails closed when a garment's real Closet image can't be re-resolved on poll", async () => {
    mockResolveAnchor().mockResolvedValueOnce(null);
    const res = await loader({ request: {} as Request } as never);
    expect(res.data).toEqual({ ok: false, reason: "garment_image_unavailable" });
    expect(mockAdvanceChain()).not.toHaveBeenCalled();
  });

  it("RT.20 — in-progress chain returns the step index, never a raw data URL", async () => {
    mockAdvanceChain().mockResolvedValue({ status: "PROCESSING", stepIndex: 1 });
    const res = await loader({ request: {} as Request } as never);
    expect(res.data).toEqual({ ok: true, modelReady: true, chain: { status: "PROCESSING", stepIndex: 1 } });
  });

  it("RT.21 — a completed chain returns only the signed result URL (secure, ownership-scoped access)", async () => {
    mockAdvanceChain().mockResolvedValue({ status: "COMPLETED", resultUrl: "https://signed.example/final.png" });
    const res = await loader({ request: {} as Request } as never);
    expect(res.data).toEqual({ ok: true, modelReady: true, chain: { status: "COMPLETED", resultUrl: "https://signed.example/final.png" } });
    const body = JSON.stringify(res.data);
    expect(body).not.toContain("data:image"); // never a raw inline payload
  });

  it("RT.22 — a failed step is reported with its step index and never silently retried by the loader", async () => {
    mockAdvanceChain().mockResolvedValue({ status: "FAILED", failedStepIndex: 1, errorCode: "PROVIDER_FAILED" });
    const res = await loader({ request: {} as Request } as never);
    expect(res.data).toEqual({ ok: true, modelReady: true, chain: { status: "FAILED", failedStepIndex: 1, errorCode: "PROVIDER_FAILED" } });
  });

  it("RT.23 — passes real, ownership-verified garment URLs (not placeholders) to advanceFullLookChain", async () => {
    mockAdvanceChain().mockResolvedValue({ status: "PROCESSING", stepIndex: 0 });
    await loader({ request: {} as Request } as never);
    const ctx = mockAdvanceChain().mock.calls[0][0];
    expect(ctx.garments.every((g: { productImageUrl: string }) => g.productImageUrl.startsWith("https://closet.example/"))).toBe(true);
  });

  it("RT.24 — the QA pause checkpoint (AWAITING_CONTINUE) and its intermediate previews pass through verbatim", async () => {
    const intermediates = [
      { stepIndex: 0, label: "Beige Tailored Trousers", url: "https://signed.example/step1.png" },
      { stepIndex: 1, label: "Blue Chambray Button-Up Shirt", url: "https://signed.example/step2.png" },
    ];
    mockAdvanceChain().mockResolvedValue({ status: "AWAITING_CONTINUE", intermediates });
    const res = await loader({ request: {} as Request } as never);
    expect(res.data).toEqual({ ok: true, modelReady: true, chain: { status: "AWAITING_CONTINUE", intermediates } });
  });
});

// ── Action — "continue" intent (the QA pause checkpoint's only exit) ────────

describe("action — intent=continue", () => {
  it("RT.25 — requires its own fresh consent checkbox, independent of the start form", async () => {
    const res = await action({ request: formRequest({ intent: "continue", consent: "no" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "consent_required" });
    expect(mockContinueChain()).not.toHaveBeenCalled();
    expect(mockStartChain()).not.toHaveBeenCalled();
  });

  it("RT.26 — requires its own fresh real-confirmation checkbox", async () => {
    const res = await action({ request: formRequest({ intent: "continue", confirmReal: "no" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "real_confirmation_required" });
    expect(mockContinueChain()).not.toHaveBeenCalled();
  });

  it("RT.27 — rejects an expired consent timestamp exactly like the start form", async () => {
    const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const res = await action({ request: formRequest({ intent: "continue", virtualTryOnConsentAt: stale }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "consent_expired" });
    expect(mockContinueChain()).not.toHaveBeenCalled();
  });

  it("RT.28 — never re-runs the quota pre-check or AI suitability screen (already passed at chain start)", async () => {
    mockContinueChain().mockResolvedValue({ ok: true });
    await action({ request: formRequest({ intent: "continue" }) } as never);
    expect(mockQuota()).not.toHaveBeenCalled();
    expect(mockScreenSuitability()).not.toHaveBeenCalled();
    expect(mockCategoryAllowed()).not.toHaveBeenCalled();
  });

  it("RT.29 — still re-verifies garment ownership (resolveClosetAnchor) and fails closed if it can't", async () => {
    mockResolveAnchor().mockResolvedValueOnce(null);
    const res = await action({ request: formRequest({ intent: "continue" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "garment_image_unavailable" });
    expect(mockContinueChain()).not.toHaveBeenCalled();
  });

  it("RT.30 — on success, delegates to continueToFinalStep with the real resolved garments and never touches startOrResumeFullLookChain", async () => {
    mockContinueChain().mockResolvedValue({ ok: true });
    const res = await action({ request: formRequest({ intent: "continue" }) } as never);
    expect(res.data).toEqual({ ok: true });
    expect(mockContinueChain()).toHaveBeenCalledTimes(1);
    expect(mockStartChain()).not.toHaveBeenCalled();
    const ctx = mockContinueChain().mock.calls[0][0];
    expect(ctx.garments).toEqual([
      { label: "Beige Tailored Trousers", productImageUrl: "https://closet.example/g-trousers.jpg" },
      { label: "Blue Chambray Button-Up Shirt", productImageUrl: "https://closet.example/g-shirt.jpg" },
      { label: "Beige Tailored Blazer", productImageUrl: "https://closet.example/g-blazer.jpg" },
    ]);
  });

  it("RT.31 — surfaces continueToFinalStep's own rejection reason (e.g. called at the wrong time) without crashing", async () => {
    mockContinueChain().mockResolvedValue({ ok: false, reason: "not_awaiting_continue" });
    const res = await action({ request: formRequest({ intent: "continue" }) } as never);
    expect(res.data).toEqual({ ok: false, reason: "not_awaiting_continue" });
  });

  it("RT.32 — a plain start request (no intent, or intent!=\"continue\") is completely unaffected — still calls startOrResumeFullLookChain", async () => {
    mockStartChain().mockResolvedValue({ ok: true, stepIndex: 0 });
    const res = await action({ request: formRequest() } as never); // no intent field at all
    expect(res.data).toEqual({ ok: true, stepIndex: 0 });
    expect(mockContinueChain()).not.toHaveBeenCalled();
  });
});
