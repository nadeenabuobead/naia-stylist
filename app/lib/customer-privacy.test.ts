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
  const customerUpdate = vi.fn().mockResolvedValue({});
  const journeyEventDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const subscriptionCount = vi.fn().mockResolvedValue(0);
  const billingTransactionCount = vi.fn().mockResolvedValue(0);
  // $transaction here is the interactive-callback form (same convention as
  // entitlement.server.ts's _runReservationTransaction) — just hand the
  // callback the same mocked client, no real transaction semantics needed.
  const transaction = vi.fn(async (fn: any) => fn({
    onboardingProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    closetItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    stylingSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    buyOrSkipAnalysis: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    wardrobeInsight: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    savedLook: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    postOutfitReview: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    confidenceScore: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    trendReportView: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    stylingEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    naiaSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    naiaModel: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    virtualTryOnJob: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    recommendationFeedback: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    selfieAnalysis: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    naiaObservationFeedback: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    styleMeOutcome: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tasteEvidence: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    styleTendency: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    wardrobeSnapshot: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    personalisedTrendEditUsage: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    identityLinkRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    customer: { update: customerUpdate },
  }));
  const pendingCloudinaryDeletionUpsert = vi.fn().mockResolvedValue({});
  return {
    default: {
      customer: { findUnique: customerFindUnique, delete: customerDelete, update: customerUpdate },
      journeyEvent: { deleteMany: journeyEventDeleteMany },
      subscription: { count: subscriptionCount },
      billingTransaction: { count: billingTransactionCount },
      pendingCloudinaryDeletion: { upsert: pendingCloudinaryDeletionUpsert, findUnique: vi.fn().mockResolvedValue(null) },
      selfieAnalysis: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction,
    },
  };
});

vi.mock("./customer-erasure-failures.server", () => ({
  recordPendingCustomerErasureFailure: vi.fn().mockResolvedValue("pending-failure-id"),
}));

// Every existing test below predates the abandoned-upload sweep and was
// written to test the four pre-existing feature helpers in isolation — this
// default keeps that scope intact (zero abandoned uploads found, nothing to
// record) for every test that doesn't override it via deps.sweepCustomerForErasure.
// The sweep-specific tests further down override it directly.
vi.mock("./cloudinary-orphan-sweep.server", () => ({
  sweepCustomerForErasure: vi.fn().mockResolvedValue({ checked: 0, deleted: 0, skippedRecent: 0, skippedReferenced: 0, failedAssets: [], rateLimited: false }),
}));

import prisma from "~/db.server";
import { eraseCustomerData, compileCustomerExport } from "./customer-privacy.server";
import { recordPendingCustomerErasureFailure } from "./customer-erasure-failures.server";
import { sweepCustomerForErasure } from "./cloudinary-orphan-sweep.server";

const mockFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockDelete = () => (prisma as any).customer.delete as ReturnType<typeof vi.fn>;
const mockCustomerUpdate = () => (prisma as any).customer.update as ReturnType<typeof vi.fn>;
const mockJourneyDeleteMany = () => (prisma as any).journeyEvent.deleteMany as ReturnType<typeof vi.fn>;
const mockSubscriptionCount = () => (prisma as any).subscription.count as ReturnType<typeof vi.fn>;
const mockBillingTransactionCount = () => (prisma as any).billingTransaction.count as ReturnType<typeof vi.fn>;
const mockRecordPendingFailure = () => recordPendingCustomerErasureFailure as ReturnType<typeof vi.fn>;

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

describe("eraseCustomerData — identity-agnostic: behaves the same regardless of which identity the customer has", () => {
  // eraseCustomerData keys everything by the internal Customer.id — it never
  // branches on shopifyCustomerId/clerkUserId. Scoping which customers are
  // even CANDIDATES for a given caller (e.g. shop/redact excluding
  // Clerk-linked rows) happens one layer up, in the webhook route's own
  // query — see webhooks-privacy.test.ts §D. These two scenarios confirm
  // eraseCustomerData itself erases correctly either way, once called.

  it("13 — scenario: a Clerk-only customer (no Shopify identity at all) is erased the same as any other", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps(), "customers/redact");

    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: SYNTHETIC_CUSTOMER_ID } });
    expect(result.ok).toBe(true);
  });

  it("14 — scenario: an existing Shopify-linked customer (no Clerk identity) is erased the same as any other", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps(), "shop/redact");

    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: SYNTHETIC_CUSTOMER_ID } });
    expect(result.ok).toBe(true);
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

function cloudinaryOkDeps() {
  return {
    deleteAllClosetPhotos: vi.fn(async () => okResult()),
    deleteCustomerBosImages: vi.fn(async () => okResult()),
    // DeleteVtoResultsResult has its own shape (skippedCount, not
    // clearedCount) — distinct from okResult()'s shape, which is only
    // correct for the closet/BOS helpers.
    deleteCustomerVtoResults: vi.fn(async () => ({ deletedCount: 1, skippedCount: 0, failedAssets: [] })),
    withdrawSaveModelConsent: vi.fn(async () => ({ ok: true, deletedAssets: [], failedAssets: [] })),
    // DeletePhotoResult is a discriminated union on `ok` — `as const`
    // keeps the literal `true`, not the widened `boolean` a bare object
    // literal would infer here.
    deleteSelfieBoth: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("eraseCustomerData — scenario: customer with subscription/billing history", () => {
  it("8 — a customer with a Subscription row is anonymized in place, not deleted — Subscription/BillingTransaction must survive", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(1);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps());

    expect(mockDelete()).not.toHaveBeenCalled(); // never a hard delete — would throw on the Restrict FK
    expect(mockCustomerUpdate()).toHaveBeenCalledWith({
      where: { id: SYNTHETIC_CUSTOMER_ID },
      data: expect.objectContaining({
        shopifyCustomerId: null,
        clerkUserId: null,
        email: null,
        firstName: null,
        lastName: null,
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.anonymized).toBe(true);
    expect(result.alreadyErased).toBe(false);
  });

  it("9 — a customer with a BillingTransaction row (but no Subscription) is also anonymized, not deleted", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(1);

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps());

    expect(mockDelete()).not.toHaveBeenCalled();
    expect(result.anonymized).toBe(true);
  });

  it("10 — a customer with NO billing history still goes through the ordinary hard delete, unchanged", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps());

    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: SYNTHETIC_CUSTOMER_ID } });
    expect(mockCustomerUpdate()).not.toHaveBeenCalled();
    expect(result.anonymized).toBe(false);
  });
});

describe("eraseCustomerData — scenario: a genuinely unexpected failure during erasure", () => {
  it("11 — an unexpected DB error is durably recorded, not thrown — the caller gets a result back, not an exception", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);
    mockDelete().mockRejectedValueOnce(new Error("connection reset"));

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps(), "shop/redact");

    expect(mockRecordPendingFailure()).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID, "shop/redact", expect.any(Error));
    expect(result.ok).toBe(false);
    expect(result.pendingFailureId).toBe("pending-failure-id");
  });

  it("12 — the context passed in is forwarded to the durable record so an operator can tell which caller failed", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);
    mockDelete().mockRejectedValueOnce(new Error("connection reset"));

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps(), "customers/redact");

    expect(mockRecordPendingFailure()).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID, "customers/redact", expect.any(Error));
  });
});

describe("billing safety — tripwire for a currently-nonexistent risk", () => {
  // UPDATE (2026-11-05): the risk this test was written to flag is no
  // longer hypothetical — Subscription/BillingTransaction now exist in
  // schema.prisma (Stripe test-mode planning phase) with a deliberate
  // onDelete: Restrict against Customer, and eraseCustomerData's
  // billing-aware anonymize path (see hasBillingHistory/
  // anonymizeBilledCustomer below) is exactly the handling this test's
  // original comment asked for. What this test still correctly checks is
  // narrower than that: Customer ITSELF carries no external provider
  // identifier (stripeCustomerId etc.) directly on its own row — provider
  // ids live on Subscription/BillingTransaction instead, confirmed by
  // billing/schema's own comment on why. If that ever changes, THIS test
  // is the signal that eraseCustomerData/anonymizeBilledCustomer must be
  // updated to scrub whatever new field was added.
  it("Customer carries no external billing/subscription identifier directly on its own row", async () => {
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

describe("eraseCustomerData — abandoned-upload sweep integration", () => {
  it("calls sweepCustomerForErasure for this exact customer, not scoped to any age threshold the caller controls", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps());
    expect(sweepCustomerForErasure).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
  });

  it("folds the sweep's own failures into cloudinaryFailures and result.ok, without re-recording them (the sweep already recorded its own)", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    (sweepCustomerForErasure as any).mockResolvedValueOnce({
      checked: 1, deleted: 0, skippedRecent: 0, skippedReferenced: 0,
      failedAssets: ["naia-wardrobe/synthetic-privacy-test-customer/abandoned-1"],
      rateLimited: false,
    });

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, cloudinaryOkDeps());

    expect(result.ok).toBe(false);
    expect(result.cloudinaryFailures).toContain("naia-wardrobe/synthetic-privacy-test-customer/abandoned-1");
    // The sweep's own failure is tracked by the sweep itself (see
    // cloudinary-orphan-sweep.server.test.ts) — eraseCustomerData must not
    // write a second, duplicate PendingCloudinaryDeletion row for it.
    const upsertCalls = (prisma as any).pendingCloudinaryDeletion.upsert.mock.calls;
    expect(upsertCalls.some((c: any) => c[0].where.publicId === "naia-wardrobe/synthetic-privacy-test-customer/abandoned-1")).toBe(false);
  });

  it("durably records a PRE-EXISTING feature helper's Cloudinary failure in PendingCloudinaryDeletion (closing the original silently-dropped-failure gap)", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    const deps = {
      ...cloudinaryOkDeps(),
      deleteAllClosetPhotos: vi.fn(async () => okResult(["naia-wardrobe/synthetic-privacy-test-customer/stuck-closet-item"])),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicId: "naia-wardrobe/synthetic-privacy-test-customer/stuck-closet-item" },
      create: expect.objectContaining({ customerId: SYNTHETIC_CUSTOMER_ID, context: "account-erasure", deliveryType: "private" }),
    }));
  });

  it("propagates withdrawSaveModelConsent's REAL verified deliveryType into PendingCloudinaryDeletion — never hardcodes 'private' for a VTO model photo failure", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    const deps = {
      ...cloudinaryOkDeps(),
      withdrawSaveModelConsent: vi.fn(async () => ({
        ok: false,
        deletedAssets: [],
        failedAssets: [{ publicId: "naia-wardrobe/synthetic-privacy-test-customer/body", deliveryType: "authenticated", errorCode: "PROVIDER_ERROR" }],
      })),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicId: "naia-wardrobe/synthetic-privacy-test-customer/body" },
      create: expect.objectContaining({ deliveryType: "authenticated" }),
    }));
  });

  it("a model asset whose deliveryType could not be established (sentinel 'unknown') is recorded with a distinct, honest error — not silently folded into an ordinary failure", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    const deps = {
      ...cloudinaryOkDeps(),
      withdrawSaveModelConsent: vi.fn(async () => ({
        ok: false,
        deletedAssets: [],
        failedAssets: [{ publicId: "naia-wardrobe/synthetic-privacy-test-customer/face", deliveryType: "unknown", errorCode: "DELIVERY_TYPE_UNKNOWN" }],
      })),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicId: "naia-wardrobe/synthetic-privacy-test-customer/face" },
      create: expect.objectContaining({
        deliveryType: "unknown",
        lastError: expect.stringContaining("could not be established"),
      }),
    }));
  });

  it("a failure to PERSIST the pending-deletion record escalates to pendingFailureId/ok:false — never a silently-successful erasure", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    (prisma as any).pendingCloudinaryDeletion.upsert.mockRejectedValueOnce(new Error("DB write failed"));
    const deps = {
      ...cloudinaryOkDeps(),
      deleteAllClosetPhotos: vi.fn(async () => okResult(["naia-wardrobe/synthetic-privacy-test-customer/stuck"])),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(result.ok).toBe(false);
    expect(result.pendingFailureId).toBe("pending-failure-id");
    expect(mockRecordPendingFailure()).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID, "unspecified", expect.any(Error));
    // Critically: the Customer row must NOT have been deleted/anonymized —
    // recordPendingCustomerErasureFailure fires from inside the same try
    // block, before hasBillingHistory/anonymize/delete ever run.
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(mockCustomerUpdate()).not.toHaveBeenCalled();
  });
});

describe("eraseCustomerData — full synthetic end-to-end: a saved Closet image AND an abandoned upload", () => {
  it("removes both the saved ClosetItem's image and the abandoned upload, and genuinely hard-deletes the Customer row (no billing history)", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const closetDeleteCalls: string[] = [];
    (sweepCustomerForErasure as any).mockResolvedValueOnce({
      checked: 1, deleted: 1, skippedRecent: 0, skippedReferenced: 0, failedAssets: [], rateLimited: false,
    });
    const deps = {
      ...cloudinaryOkDeps(),
      deleteAllClosetPhotos: vi.fn(async () => {
        closetDeleteCalls.push("naia-wardrobe/synthetic-privacy-test-customer/saved-item");
        return okResult();
      }),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(closetDeleteCalls).toEqual(["naia-wardrobe/synthetic-privacy-test-customer/saved-item"]); // the real, saved image
    expect(sweepCustomerForErasure).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID); // the abandoned upload
    expect(result.ok).toBe(true);
    expect(result.cloudinaryFailures).toEqual([]);
    expect(mockDelete()).toHaveBeenCalledWith({ where: { id: SYNTHETIC_CUSTOMER_ID } }); // real hard delete, not anonymize
    expect(result.anonymized).toBe(false);
  });
});

describe("PendingCloudinaryDeletion — survives customer removal", () => {
  it("has no Prisma relation to Customer — a hard delete or Cascade cannot structurally reach it, by schema design, not by code discipline alone", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");

    const block = schema.slice(
      schema.indexOf("\nmodel PendingCloudinaryDeletion {"),
      schema.indexOf("\n}", schema.indexOf("\nmodel PendingCloudinaryDeletion {")),
    );
    expect(block).not.toContain("Customer");
    expect(block).not.toContain("@relation");
    expect(block).not.toContain("onDelete");
  });

  it("eraseCustomerData's own code never calls delete/deleteMany on pendingCloudinaryDeletion — only upsert, matching the schema's no-FK design", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(__dirname, "customer-privacy.server.ts"), "utf8");
    expect(source).not.toMatch(/pendingCloudinaryDeletion\.(delete|deleteMany)\(/);
  });

  it("a pending-deletion row written during erasure is still readable afterward (upsert, never followed by any delete call in this run)", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    const deps = {
      ...cloudinaryOkDeps(),
      deleteAllClosetPhotos: vi.fn(async () => okResult(["naia-wardrobe/synthetic-privacy-test-customer/orphan"])),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect((prisma as any).pendingCloudinaryDeletion.upsert).toHaveBeenCalled();
    expect(mockDelete()).toHaveBeenCalled(); // the Customer row IS removed...
    // ...but nothing about that call is a deleteMany/delete against
    // pendingCloudinaryDeletion (confirmed structurally in the two tests
    // above) — the row the upsert above wrote is unaffected by it.
  });
});
