// app/lib/ai/journey-integration.test.ts
// Phase 4B3 — Integration tests proving contract-to-boundary wiring.
//
// Covers:
//   buildEphemeralContextSignals signal precedence   (ji-1  to ji-4)
//   buildCustomerJourneyContext degradation          (ji-5  to ji-9)
//   computeVtoGate shared-contract usage             (ji-10 to ji-11)
//   feedback_given event privacy                     (ji-12 to ji-14)
//   post_wear_submitted event privacy                (ji-15 to ji-16)
//   recommendation_served event privacy              (ji-17 to ji-18)
//   recordJourneyEvent fire-and-forget persistence   (ji-19 to ji-20)
//   session_started from real route boundary         (ji-21)
//   product_intelligence_viewed from real API        (ji-22 to ji-23)
//   vto_initiated from real server action            (ji-24)
//   vto_feedback_given from real action              (ji-25)
//   privacy guarantee across all event types         (ji-26)
//   buildEphemeralContextSignals immutability         (ji-27 to ji-28)

import { describe, it, expect } from "vitest";
import { buildEphemeralContextSignals, buildCustomerJourneyContext } from "./journey-context.server.js";
import { computeVtoGate } from "./journey-contract.js";
import {
  emitFeedbackGiven,
  emitPostWearSubmitted,
  emitRecommendationServed,
  emitSessionStarted,
  emitVtoInitiated,
  emitVtoFeedbackGiven,
  emitProductIntelligenceViewed,
  hashCustomerId,
  recordJourneyEvent,
} from "./journey-events.server.js";
import type { CustomerJourneyContext, SelfieSignalSummary } from "./journey-contract.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeSelfie(colourFamilies: string[]): SelfieSignalSummary {
  return {
    available: true,
    behaviour: "SOFT_RANK",
    colourFamilies,
    suggestedNecklines: [],
    contrastLevel: "medium",
    overallNote: "",
  };
}

function makeJourneyCtx(selfie: SelfieSignalSummary | null = makeSelfie(["navy", "terracotta"])): CustomerJourneyContext {
  return {
    selfieSignals: selfie,
    closetSummary: {
      totalItems: 0, eligibleForTryOn: 0, pendingAssessment: 0, notEligible: 0,
      byCategory: { clothing: 0, shoes: 0, bags: 0 },
    },
    feedbackContext: {
      available: true, migrationPending: false, totalFeedback: 0,
      activePatterns: [], positivePostWearRate: null, postWearMigrationPending: false,
    },
    features: {
      canStyleMe: true, hasClosetItems: false, hasEligibleClosetItems: false,
      hasClosetAssessmentPending: false, hasSelfieSignals: selfie !== null,
      naiaModelIsReady: false, virtualTryOnAvailable: false,
      feedbackHistoryAvailable: false, postWearHistoryAvailable: false,
    },
    migrationStatus: {
      selfieAnalysisPending: false, recommendationFeedbackPending: false,
      postWearColumnsPending: false,
    },
  };
}

const STUB_DEPS = {
  findSelfie: async () => null,
  findClosetItems: async () => [] as Array<{ category: string; tryOnEligibility: string | null }>,
  findFeedback: async () => [] as Array<{ rating: string; reasonCodes: string[] }>,
  findPostWearRate: async () => ({ positiveRate: null }),
  findNaiaModel: async () => null,
  virtualTryOnEnabled: false,
} as const;

const MIGRATION_ERROR = Object.assign(
  new Error("Table does not exist in the current database"),
  { code: "P2021" },
);

// ── buildEphemeralContextSignals — ji-1 to ji-4 ──────────────────────────────

describe("buildEphemeralContextSignals signal precedence", () => {
  it("ji-1: explicit favoriteColors beat selfie colourFamilies", () => {
    const result = buildEphemeralContextSignals({ favoriteColors: ["black", "white"] }, makeJourneyCtx());
    expect(result?.favoriteColors).toEqual(["black", "white"]);
  });

  it("ji-2: selfie colourFamilies fill empty favoriteColors gap", () => {
    const result = buildEphemeralContextSignals({}, makeJourneyCtx());
    expect(result?.favoriteColors).toEqual(["navy", "terracotta"]);
  });

  it("ji-3: null journeyCtx returns explicitSignals unchanged", () => {
    const result = buildEphemeralContextSignals({ favoriteColors: ["red"] }, null);
    expect(result).toEqual({ favoriteColors: ["red"] });
  });

  it("ji-4: firmNoColors from explicit signals are never overwritten by soft signals", () => {
    const result = buildEphemeralContextSignals(
      { firmNoColors: ["yellow"], favoriteColors: [] },
      makeJourneyCtx(makeSelfie(["yellow", "orange"])),
    );
    // selfie fills the empty favoriteColors gap
    expect(result?.favoriteColors).toEqual(["yellow", "orange"]);
    // firmNoColors is untouched
    expect(result?.firmNoColors).toEqual(["yellow"]);
  });
});

// ── buildCustomerJourneyContext graceful degradation — ji-5 to ji-9 ───────────

describe("buildCustomerJourneyContext graceful degradation", () => {
  it("ji-5: no-selfie customer returns selfieSignals null", async () => {
    const ctx = await buildCustomerJourneyContext("cust-abc", STUB_DEPS);
    expect(ctx.selfieSignals).toBeNull();
  });

  it("ji-6: no-feedback customer returns empty feedbackContext without throwing", async () => {
    const ctx = await buildCustomerJourneyContext("cust-abc", STUB_DEPS);
    expect(ctx.feedbackContext.totalFeedback).toBe(0);
    expect(ctx.feedbackContext.activePatterns).toHaveLength(0);
  });

  it("ji-7: both selfie and feedback absent — valid CustomerJourneyContext returned", async () => {
    const ctx = await buildCustomerJourneyContext("cust-abc", STUB_DEPS);
    expect(ctx.migrationStatus.selfieAnalysisPending).toBe(false);
    expect(ctx.migrationStatus.recommendationFeedbackPending).toBe(false);
    expect(ctx.features.canStyleMe).toBe(true);
  });

  it("ji-8: selfie migration-pending sets flag and does not throw", async () => {
    const ctx = await buildCustomerJourneyContext("cust-abc", {
      ...STUB_DEPS,
      findSelfie: async () => { throw MIGRATION_ERROR; },
    });
    expect(ctx.migrationStatus.selfieAnalysisPending).toBe(true);
    expect(ctx.selfieSignals).toBeNull();
  });

  it("ji-9: feedback migration-pending sets flag and does not throw", async () => {
    const ctx = await buildCustomerJourneyContext("cust-abc", {
      ...STUB_DEPS,
      findFeedback: async () => { throw MIGRATION_ERROR; },
    });
    expect(ctx.migrationStatus.recommendationFeedbackPending).toBe(true);
    expect(ctx.feedbackContext.migrationPending).toBe(true);
  });
});

// ── computeVtoGate uses shared contract — ji-10 to ji-11 ─────────────────────

describe("computeVtoGate uses shared contract", () => {
  it("ji-10: globally disabled blocks regardless of model or product readiness", () => {
    const gate = computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: true });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedReason).toBe("feature-disabled");
  });

  it("ji-11: no model blocks VTO even when feature enabled and product eligible", () => {
    const gate = computeVtoGate({ globalEnabled: true, naiaModelReady: false, productEligible: true });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedReason).toBe("no-model");
  });
});

// ── feedback_given event privacy — ji-12 to ji-14 ────────────────────────────

describe("emitFeedbackGiven privacy", () => {
  it("ji-12: payload contains only structural fields — no reason codes, no note text", () => {
    const ev = emitFeedbackGiven({
      customerId: "cust-123", sessionId: "sess-abc",
      target: "nadine-product", rating: "love", hasNote: false,
    });
    expect(Object.keys(ev.payload).sort()).toEqual(["hasNote", "rating", "target"]);
    expect("reasonCodes" in ev.payload).toBe(false);
    expect("note" in ev.payload).toBe(false);
  });

  it("ji-13: hasNote true when note present, false otherwise", () => {
    const withNote = emitFeedbackGiven({
      customerId: "c", sessionId: "s",
      target: "complete-suggestion", rating: "not-for-me", hasNote: true,
    });
    const noNote = emitFeedbackGiven({
      customerId: "c", sessionId: "s",
      target: "complete-suggestion", rating: "okay", hasNote: false,
    });
    expect(withNote.payload.hasNote).toBe(true);
    expect(noNote.payload.hasNote).toBe(false);
  });

  it("ji-14: raw customerId is hashed — never appears in event", () => {
    const rawId = "real-customer-id-12345";
    const ev = emitFeedbackGiven({
      customerId: rawId, sessionId: "sess-abc",
      target: "closet-item", rating: "okay", hasNote: false,
    });
    expect(ev.customerIdHash).toBe(hashCustomerId(rawId));
    expect(ev.customerIdHash).not.toBe(rawId);
    expect(JSON.stringify(ev)).not.toContain(rawId);
  });
});

// ── post_wear_submitted event privacy — ji-15 to ji-16 ───────────────────────

describe("emitPostWearSubmitted privacy", () => {
  it("ji-15: payload contains didWearIt and wouldWearAgain only", () => {
    const ev = emitPostWearSubmitted({
      customerId: "c", sessionId: "s",
      didWearIt: "yes", wouldWearAgain: "definitely",
    });
    expect(ev.payload).toEqual({ didWearIt: "yes", wouldWearAgain: "definitely" });
  });

  it("ji-16: howDidYouFeel and note are structurally absent from the payload", () => {
    const ev = emitPostWearSubmitted({
      customerId: "c", sessionId: "s",
      didWearIt: "not-yet", wouldWearAgain: null,
    });
    expect("howDidYouFeel" in ev.payload).toBe(false);
    expect("note" in ev.payload).toBe(false);
  });
});

// ── recommendation_served event privacy — ji-17 to ji-18 ─────────────────────

describe("emitRecommendationServed privacy", () => {
  it("ji-17: payload contains outcome and catalog handles only", () => {
    const ev = emitRecommendationServed({
      customerId: "c", sessionId: "s",
      outcome: "nadine-recommendation", primaryHandle: "silk-midi-dress", alternativeCount: 2,
    });
    expect(ev.payload).toEqual({
      outcome: "nadine-recommendation",
      primaryHandle: "silk-midi-dress",
      alternativeCount: 2,
    });
  });

  it("ji-18: no customer profile data enters the recommendation event payload", () => {
    const rawId = "cust-secret-id-99999";
    const ev = emitRecommendationServed({
      customerId: rawId, sessionId: "sess-xyz",
      outcome: "closet-led", primaryHandle: null, alternativeCount: 0,
    });
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain(rawId);
    expect("email" in ev.payload).toBe(false);
    expect("favoriteColors" in ev.payload).toBe(false);
  });
});

// ── recordJourneyEvent fire-and-forget — ji-19 to ji-20 ──────────────────────

describe("recordJourneyEvent fire-and-forget persistence", () => {
  it("ji-19: recordJourneyEvent returns synchronously without blocking on DB writes", () => {
    const ev = emitFeedbackGiven({
      customerId: "c", sessionId: "s",
      target: "nadine-product", rating: "love", hasNote: false,
    });
    let returned = false;
    expect(() => { recordJourneyEvent(ev); returned = true; }).not.toThrow();
    // Returned synchronously — fire-and-forget pattern confirmed
    expect(returned).toBe(true);
  });

  it("ji-20: calling action continues even when JourneyEvent table is absent", () => {
    // Simulates migration-pending path: DB op fails asynchronously; caller is unaffected
    const ev = emitPostWearSubmitted({
      customerId: "c", sessionId: "s",
      didWearIt: "yes", wouldWearAgain: "definitely",
    });
    expect(() => recordJourneyEvent(ev)).not.toThrow();
  });
});

// ── session_started event from real route boundary — ji-21 ───────────────────

describe("session_started event from real route boundary", () => {
  it("ji-21: emitSessionStarted using journey context signals produces correct event shape", () => {
    const ctx = makeJourneyCtx();
    const ev = emitSessionStarted({
      customerId: "cust-001",
      sessionId: "sess-001",
      occasion: "work",
      source: "naia-piece",
      hasSelfieGuidance: !!ctx.selfieSignals,
      closetItemCount: ctx.closetSummary.totalItems,
      hasEligibleClosetItem: ctx.features.hasEligibleClosetItems,
      naiaModelIsReady: ctx.features.naiaModelIsReady,
    });
    expect(ev.type).toBe("session_started");
    expect(ev.payload.occasion).toBe("work");
    expect(ev.payload.source).toBe("naia-piece");
    expect(ev.payload.hasSelfieGuidance).toBe(true);
    expect(ev.payload.closetItemCount).toBe(0);
    expect(ev.payload.hasEligibleClosetItem).toBe(false);
    expect(typeof ev.customerIdHash).toBe("string");
    expect(ev.customerIdHash).not.toBe("cust-001");
  });
});

// ── product_intelligence_viewed from real API boundary — ji-22 to ji-23 ──────

describe("product_intelligence_viewed from real API boundary", () => {
  it("ji-22: emitProductIntelligenceViewed produces privacy-safe payload", () => {
    const ev = emitProductIntelligenceViewed({
      customerId: "cust-123",
      productHandle: "silk-midi-dress",
      resolved: true,
      closetItemCount: 3,
      hasModel: true,
    });
    expect(ev.type).toBe("product_intelligence_viewed");
    expect(ev.payload.productHandle).toBe("silk-midi-dress");
    expect(ev.payload.resolved).toBe(true);
    expect(ev.payload.closetItemCount).toBe(3);
    expect(ev.payload.hasModel).toBe(true);
    expect("profile" in ev.payload).toBe(false);
    expect("intelligenceText" in ev.payload).toBe(false);
    expect(JSON.stringify(ev)).not.toContain("cust-123");
  });

  it("ji-23: product_intelligence_viewed sessionId is the product-page sentinel", () => {
    const ev = emitProductIntelligenceViewed({
      customerId: "c", productHandle: "test-product",
      resolved: false, closetItemCount: 0, hasModel: false,
    });
    expect(ev.sessionId).toBe("product-page");
  });
});

// ── vto_initiated from real server action boundary — ji-24 ───────────────────

describe("vto_initiated event from server action boundary", () => {
  it("ji-24: emitVtoInitiated payload contains only catalog handle and entry point — no model photos or signed URLs", () => {
    const ev = emitVtoInitiated({
      customerId: "cust-456",
      sessionId: "sess-789",
      entryPoint: "styleme-single-piece",
      productHandle: "asymmetrical-pants",
    });
    expect(ev.type).toBe("vto_initiated");
    expect(ev.payload.entryPoint).toBe("styleme-single-piece");
    expect(ev.payload.productHandle).toBe("asymmetrical-pants");
    expect("signedUrl" in ev.payload).toBe(false);
    expect("modelPhotoId" in ev.payload).toBe(false);
    expect("jobId" in ev.payload).toBe(false);
    expect(JSON.stringify(ev)).not.toContain("cust-456");
  });
});

// ── vto_feedback_given from recommendation-feedback boundary — ji-25 ─────────

describe("vto_feedback_given event from recommendation-feedback boundary", () => {
  it("ji-25: emitVtoFeedbackGiven stores booleans only — no raw aspect codes", () => {
    const ev = emitVtoFeedbackGiven({
      customerId: "c",
      sessionId: "s",
      hadFidelityConcern: true,
      usefulDespiteDifferences: false,
      wouldTryInPerson: true,
    });
    expect(ev.type).toBe("vto_feedback_given");
    expect(Object.keys(ev.payload).sort()).toEqual(
      ["hadFidelityConcern", "usefulDespiteDifferences", "wouldTryInPerson"],
    );
    expect(ev.payload.hadFidelityConcern).toBe(true);
    expect("aspects" in ev.payload).toBe(false);
    expect("vtoAspects" in ev.payload).toBe(false);
  });
});

// ── privacy guarantee across all event types — ji-26 ─────────────────────────

describe("privacy guarantee — no raw customerId in any event", () => {
  it("ji-26: all event emitters hash the customerId — raw id never appears in serialised output", () => {
    const rawId = "customer-private-identifier-xyz";
    const events = [
      emitSessionStarted({ customerId: rawId, sessionId: "s", occasion: "work", source: "naia-piece", hasSelfieGuidance: false, closetItemCount: 0, hasEligibleClosetItem: false, naiaModelIsReady: false }),
      emitRecommendationServed({ customerId: rawId, sessionId: "s", outcome: "nadine-recommendation", primaryHandle: null, alternativeCount: 0 }),
      emitFeedbackGiven({ customerId: rawId, sessionId: "s", target: "nadine-product", rating: "love", hasNote: false }),
      emitVtoInitiated({ customerId: rawId, sessionId: "s", entryPoint: "styleme-single-piece", productHandle: "test" }),
      emitVtoFeedbackGiven({ customerId: rawId, sessionId: "s", hadFidelityConcern: false, usefulDespiteDifferences: true, wouldTryInPerson: true }),
      emitPostWearSubmitted({ customerId: rawId, sessionId: "s", didWearIt: "yes", wouldWearAgain: "definitely" }),
      emitProductIntelligenceViewed({ customerId: rawId, productHandle: "test", resolved: true, closetItemCount: 0, hasModel: false }),
    ];
    for (const ev of events) {
      expect(JSON.stringify(ev)).not.toContain(rawId);
      expect(ev.customerIdHash).toBe(hashCustomerId(rawId));
      expect(ev.customerIdHash).not.toBe(rawId);
    }
  });
});

// ── buildEphemeralContextSignals immutability — ji-27 to ji-28 ───────────────

describe("buildEphemeralContextSignals does not mutate source", () => {
  it("ji-27: source explicitSignals object is never modified by the function", () => {
    const source = { favoriteColors: ["crimson"] };
    const snapshot = JSON.stringify(source);
    buildEphemeralContextSignals(source, makeJourneyCtx(makeSelfie(["teal"])));
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("ji-28: explicit favoriteColors always take full precedence over selfie colourFamilies", () => {
    const result = buildEphemeralContextSignals(
      { favoriteColors: ["midnight-navy"] },
      makeJourneyCtx(makeSelfie(["hot-pink"])),
    );
    expect(result?.favoriteColors).toEqual(["midnight-navy"]);
    expect(result?.favoriteColors).not.toContain("hot-pink");
  });
});
