// app/lib/customer-privacy.test.ts
// Priority 4 — customer data export/deletion.
//
// Real behavioral tests against eraseCustomerData/compileCustomerExport, using
// a synthetic customer, a fully mocked database (no live connection), and
// mocked per-feature deletion helpers passed via dependency injection (no
// live Cloudinary call of any kind — not even a mocked network request).
//
// Run: npx vitest run app/lib/customer-privacy.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => {
  const customerFindUnique = vi.fn();
  const customerDelete = vi.fn().mockResolvedValue({});
  const journeyEventDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  return {
    default: {
      customer: { findUnique: customerFindUnique, delete: customerDelete },
      journeyEvent: { deleteMany: journeyEventDeleteMany },
    },
  };
});

import prisma from "~/db.server";
import { eraseCustomerData, compileCustomerExport } from "./customer-privacy.server";

const mockFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockDelete = () => (prisma as any).customer.delete as ReturnType<typeof vi.fn>;
const mockJourneyDeleteMany = () => (prisma as any).journeyEvent.deleteMany as ReturnType<typeof vi.fn>;

const SYNTHETIC_CUSTOMER_ID = "synthetic-privacy-test-customer";

function okResult(failedAssets: string[] = []) {
  return { deletedCount: 1, clearedCount: 1, failedAssets };
}

beforeEach(() => vi.clearAllMocks());

describe("eraseCustomerData — synthetic customer, mocked DB and mocked providers", () => {
  it("1 — calls every feature's deletion helper exactly once, in Cloudinary-before-DB order", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockJourneyDeleteMany().mockResolvedValueOnce({ count: 3 });

    const callOrder: string[] = [];
    const deps = {
      deleteAllClosetPhotos: vi.fn(async () => { callOrder.push("closet"); return okResult(); }),
      deleteCustomerBosImages: vi.fn(async () => { callOrder.push("bos"); return okResult(); }),
      deleteCustomerVtoResults: vi.fn(async () => { callOrder.push("vto"); return okResult(); }),
      withdrawSaveModelConsent: vi.fn(async () => { callOrder.push("model"); return { ok: true, deletedAssets: [], failedAssets: [] }; }),
      deleteSelfieBoth: vi.fn(async () => { callOrder.push("selfie"); return { ok: true }; }),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(deps.deleteAllClosetPhotos).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(deps.deleteCustomerBosImages).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(deps.deleteCustomerVtoResults).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(deps.withdrawSaveModelConsent).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(deps.deleteSelfieBoth).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(callOrder).toHaveLength(5); // every feature touched exactly once

    // The Customer row delete must happen AFTER every Cloudinary deletion —
    // the cascade has no mechanism to reach external storage, so ordering
    // here is the actual security property, not a style preference.
    const customerDeleteCallTime = mockDelete().mock.invocationCallOrder[0];
    for (const fn of Object.values(deps)) {
      expect((fn as any).mock.invocationCallOrder[0]).toBeLessThan(customerDeleteCallTime);
    }

    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: SYNTHETIC_CUSTOMER_ID } });
    expect(result.ok).toBe(true);
    expect(result.alreadyErased).toBe(false);
    expect(result.journeyEventsPurged).toBe(3);
  });

  it("2 — purges JourneyEvent by the SAME hash derivation journey-events.server.ts uses, not a re-implementation", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    const deps = {
      deleteAllClosetPhotos: vi.fn(async () => okResult()),
      deleteCustomerBosImages: vi.fn(async () => okResult()),
      deleteCustomerVtoResults: vi.fn(async () => okResult()),
      withdrawSaveModelConsent: vi.fn(async () => ({ ok: true, deletedAssets: [], failedAssets: [] })),
      deleteSelfieBoth: vi.fn(async () => ({ ok: true })),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    const { hashCustomerId } = await import("./ai/journey-events.server");
    expect(mockJourneyDeleteMany()).toHaveBeenCalledWith({
      where: { customerIdHash: hashCustomerId(SYNTHETIC_CUSTOMER_ID) },
    });
  });

  it("3 — duplicate webhook delivery is safe: erasing an already-erased customer is a success, not an error", async () => {
    // Customer not found — exactly what a redelivered customers/redact or
    // shop/redact looks like the second time it arrives.
    mockFindUnique().mockResolvedValueOnce(null);

    const deps = {
      deleteAllClosetPhotos: vi.fn(),
      deleteCustomerBosImages: vi.fn(),
      deleteCustomerVtoResults: vi.fn(),
      withdrawSaveModelConsent: vi.fn(),
      deleteSelfieBoth: vi.fn(),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(result.ok).toBe(true);
    expect(result.alreadyErased).toBe(true);
    // None of the deletion helpers should fire for a customer that's already gone.
    expect(deps.deleteAllClosetPhotos).not.toHaveBeenCalled();
    expect(mockDelete()).not.toHaveBeenCalled();
  });

  it("4 — a Cloudinary deletion failure is surfaced, not swallowed, but does not block the rest of erasure", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    const deps = {
      deleteAllClosetPhotos: vi.fn(async () => okResult(["naia-wardrobe/stuck-asset"])),
      deleteCustomerBosImages: vi.fn(async () => okResult()),
      deleteCustomerVtoResults: vi.fn(async () => okResult()),
      withdrawSaveModelConsent: vi.fn(async () => ({ ok: true, deletedAssets: [], failedAssets: [] })),
      deleteSelfieBoth: vi.fn(async () => ({ ok: true })),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(result.ok).toBe(false); // honestly reports partial failure
    expect(result.cloudinaryFailures).toContain("naia-wardrobe/stuck-asset");
    // The Customer row (and therefore every DB record) is still deleted —
    // a stuck Cloudinary asset must not block the rest of erasure, matching
    // the same tradeoff the existing per-feature helpers already make.
    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: SYNTHETIC_CUSTOMER_ID } });
  });

  it("5 — a different synthetic customer's deletion call never touches this one's id", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: "synthetic-customer-B" });
    const deps = {
      deleteAllClosetPhotos: vi.fn(async () => okResult()),
      deleteCustomerBosImages: vi.fn(async () => okResult()),
      deleteCustomerVtoResults: vi.fn(async () => okResult()),
      withdrawSaveModelConsent: vi.fn(async () => ({ ok: true, deletedAssets: [], failedAssets: [] })),
      deleteSelfieBoth: vi.fn(async () => ({ ok: true })),
    };

    await eraseCustomerData("synthetic-customer-B", deps);

    expect(deps.deleteAllClosetPhotos).toHaveBeenCalledWith("synthetic-customer-B");
    expect(deps.deleteAllClosetPhotos).not.toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: "synthetic-customer-B" } });
  });
});

describe("compileCustomerExport — synthetic customer, mocked DB", () => {
  it("6 — returns null for a customer that does not exist, rather than throwing", async () => {
    mockFindUnique().mockResolvedValueOnce(null);
    const result = await compileCustomerExport("does-not-exist");
    expect(result).toBeNull();
  });

  it("7 — includes every data category, and separates customer fields from relation data", async () => {
    mockFindUnique().mockResolvedValueOnce({
      id: SYNTHETIC_CUSTOMER_ID,
      email: "synthetic@test.invalid",
      shopifyCustomerId: "synthetic-shopify-id",
      onboardingProfile: { completed: true },
      closetItems: [{ id: "item-1", name: "Synthetic Jacket" }],
      wardrobeSnapshots: [],
      stylingSessions: [],
      buyOrSkipAnalyses: [],
      wardrobeInsights: [],
      savedLooks: [],
      postOutfitReviews: [],
      confidenceScores: [],
      trendReportViews: [],
      stylingEvents: [],
      naiaModel: null,
      tryOnJobs: [],
      recommendationFeedback: [],
      selfieAnalysis: null,
      naiaObservationFeedback: [],
      styleMemoryOutcomes: [],
      tasteEvidence: [],
      styleTendencies: [],
      personalisedTrendEditUsage: [],
    });

    const result = await compileCustomerExport(SYNTHETIC_CUSTOMER_ID);

    expect(result).not.toBeNull();
    expect(result!.customer.email).toBe("synthetic@test.invalid");
    expect((result!.customer as any).closetItems).toBeUndefined(); // relation data moved out, not duplicated
    expect(result!.closet).toEqual([{ id: "item-1", name: "Synthetic Jacket" }]);
    expect(result!.stylePassport).toEqual({ completed: true });
    expect(result!.note).toMatch(/FASHN|Anthropic|Bodygram/); // honest about what this export does NOT cover
  });
});

describe("billing safety — tripwire for a currently-nonexistent risk", () => {
  // There is no live payment processor wired into this app today (Clerk +
  // Stripe is approved for PLANNING only — see the frozen v4 auth/billing
  // spec — not implemented). membershipStatus is an internal-only enum
  // (NONE | MEMBER, prisma/schema.prisma) with no external subscription id,
  // so deleting the Customer row cannot leave a live subscription billing a
  // deleted customer: there is nothing external to orphan yet.
  //
  // This test is a tripwire, not a feature test: the moment a real billing
  // integration adds a field like stripeCustomerId/stripeSubscriptionId to
  // Customer, this test starts failing — which is the intended signal that
  // eraseCustomerData must be updated to cancel/handle that subscription
  // BEFORE deleting the row, not an oversight to silently work around.
  it("Customer has no external billing/subscription identifier for eraseCustomerData to account for yet", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");

    const customerBlock = schema.slice(
      schema.indexOf("\nmodel Customer {"),
      schema.indexOf("\n}", schema.indexOf("\nmodel Customer {")),
    );

    for (const billingField of ["stripeCustomerId", "stripeSubscriptionId", "paymentMethodId", "billingProviderId"]) {
      expect(customerBlock).not.toContain(billingField);
    }
  });
});
