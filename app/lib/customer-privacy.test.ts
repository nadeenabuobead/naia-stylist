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
  return {
    default: {
      customer: { findUnique: customerFindUnique, delete: customerDelete, update: customerUpdate },
      journeyEvent: { deleteMany: journeyEventDeleteMany },
      subscription: { count: subscriptionCount },
      billingTransaction: { count: billingTransactionCount },
      $transaction: transaction,
    },
  };
});

vi.mock("./customer-erasure-failures.server", () => ({
  recordPendingCustomerErasureFailure: vi.fn().mockResolvedValue("pending-failure-id"),
}));

import prisma from "~/db.server";
import { eraseCustomerData, compileCustomerExport } from "./customer-privacy.server";
import { recordPendingCustomerErasureFailure } from "./customer-erasure-failures.server";

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
    // fix/stripe-clerk-phase1-security (2026-11-12): only reached in the
    // billed branch (hasBillingHistory true) — default to a clean success so
    // every existing test here keeps exercising the anonymize path
    // unchanged. The billing-cancellation-specific tests below override this.
    cancelActiveBillingForErasure: vi.fn(async () => ({ ok: true, canceledCount: 0, failures: [] })),
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

describe("eraseCustomerData — Stripe billing cancellation before anonymization (fix/stripe-clerk-phase1-security)", () => {
  it("13 — a billed customer's active subscription is cancelled via Stripe BEFORE anonymizeBilledCustomer writes anything", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(1);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const callOrder: string[] = [];
    const deps = {
      ...cloudinaryOkDeps(),
      cancelActiveBillingForErasure: vi.fn(async () => {
        callOrder.push("cancel-billing");
        return { ok: true, canceledCount: 1, failures: [] };
      }),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(deps.cancelActiveBillingForErasure).toHaveBeenCalledWith(SYNTHETIC_CUSTOMER_ID);
    expect(callOrder).toEqual(["cancel-billing"]);
    // customer.update (the anonymization write) must happen AFTER — proven
    // by it having actually run (test 8 already proves the call shape);
    // here the focus is purely on cancellation happening first.
    expect(mockCustomerUpdate()).toHaveBeenCalled();
    const cancelOrder = (deps.cancelActiveBillingForErasure as any).mock.invocationCallOrder[0];
    const updateOrder = mockCustomerUpdate().mock.invocationCallOrder[mockCustomerUpdate().mock.invocationCallOrder.length - 1];
    expect(cancelOrder).toBeLessThan(updateOrder);
    expect(result.ok).toBe(true);
    expect(result.anonymized).toBe(true);
  });

  it("14 — a billing-cancellation FAILURE blocks anonymization entirely — the Customer row is NOT updated", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(1);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const deps = {
      ...cloudinaryOkDeps(),
      cancelActiveBillingForErasure: vi.fn(async () => ({
        ok: false,
        canceledCount: 0,
        failures: [{ subscriptionId: "sub-row-1", providerSubscriptionId: "sub_stripe_1", error: "Stripe API error (status 500)" }],
      })),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(mockCustomerUpdate()).not.toHaveBeenCalled();
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.anonymized).toBe(false);
  });

  it("15 — a billing-cancellation failure is durably recorded via recordPendingCustomerErasureFailure, same mechanism as any other unexpected erasure failure — this IS the retry path", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(1);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const deps = {
      ...cloudinaryOkDeps(),
      cancelActiveBillingForErasure: vi.fn(async () => ({
        ok: false,
        canceledCount: 0,
        failures: [{ subscriptionId: "sub-row-1", providerSubscriptionId: "sub_stripe_1", error: "network timeout" }],
      })),
    };

    const result = await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps, "settings-self-service");

    expect(mockRecordPendingFailure()).toHaveBeenCalledWith(
      SYNTHETIC_CUSTOMER_ID,
      "settings-self-service",
      expect.objectContaining({ message: expect.stringContaining("sub-row-1") }),
    );
    expect(result.pendingFailureId).toBe("pending-failure-id");
    // An operator resolving this via /admin/maintenance re-runs
    // eraseCustomerData from scratch — the SAME retry mechanism every other
    // pending erasure failure already uses. A subsequent successful
    // cancellation then proceeds exactly as test 13 proves.
  });

  it("16 — a MULTI-subscription failure reports every failed subscription's id, not just the first", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(1);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const deps = {
      ...cloudinaryOkDeps(),
      cancelActiveBillingForErasure: vi.fn(async () => ({
        ok: false,
        canceledCount: 1,
        failures: [
          { subscriptionId: "sub-row-A", providerSubscriptionId: "sub_stripe_A", error: "rate limited" },
          { subscriptionId: "sub-row-B", providerSubscriptionId: "sub_stripe_B", error: "network timeout" },
        ],
      })),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    const recordedError = mockRecordPendingFailure().mock.calls[0][2];
    expect(recordedError.message).toContain("sub-row-A");
    expect(recordedError.message).toContain("sub-row-B");
  });

  it("17 — a customer with NO billing history never calls cancelActiveBillingForErasure at all — nothing to cancel", async () => {
    mockFindUnique().mockResolvedValueOnce({ id: SYNTHETIC_CUSTOMER_ID });
    mockSubscriptionCount().mockResolvedValueOnce(0);
    mockBillingTransactionCount().mockResolvedValueOnce(0);

    const deps = {
      ...cloudinaryOkDeps(),
      cancelActiveBillingForErasure: vi.fn(async () => ({ ok: true, canceledCount: 0, failures: [] })),
    };

    await eraseCustomerData(SYNTHETIC_CUSTOMER_ID, deps);

    expect(deps.cancelActiveBillingForErasure).not.toHaveBeenCalled();
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
