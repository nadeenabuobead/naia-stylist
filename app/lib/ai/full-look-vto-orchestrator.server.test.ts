// app/lib/ai/full-look-vto-orchestrator.server.test.ts
//
// Fully mocked — no real DB, no real network. This file never duplicates
// full-look-tryon-real.server.ts's own extensive coverage of the chain's
// actual mechanics (submit/poll/retry-safety at the FASHN level) — it
// mocks that module's high-level entry points and proves only what this
// orchestration layer itself adds: garment selection, retry-safe attempt
// scoping, auto-continuing past the human-review pause, and the
// existing-result lookup.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./full-look-tryon-real.server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./full-look-tryon-real.server.js")>();
  return {
    ...actual,
    startOrResumeFullLookChain: vi.fn(),
    advanceFullLookChain: vi.fn(),
    continueToFinalStep: vi.fn(),
    walkFullLookChainJobs: vi.fn(),
  };
});

vi.mock("./fashn-tryon-service.server.js", () => ({
  buildTryOnResultUrl: vi.fn(),
}));

vi.mock("../../db.server.js", () => ({
  default: {
    virtualTryOnJob: { count: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/styleme/look-image-resolution.server", () => ({
  resolveItemImage: vi.fn(),
}));

import prisma from "../../db.server.js";
import { resolveItemImage } from "~/lib/styleme/look-image-resolution.server";
import { buildTryOnResultUrl } from "./fashn-tryon-service.server.js";
import {
  startOrResumeFullLookChain,
  advanceFullLookChain,
  continueToFinalStep,
  walkFullLookChainJobs,
} from "./full-look-tryon-real.server.js";
import {
  selectFullLookGarments,
  computeGarmentFingerprint,
  resolveCurrentAttemptScope,
  startNewAttemptScope,
  startFullLookOutfit,
  pollFullLookOutfit,
  findCompletedFullLookForSuggestion,
  type SelectableOutfitItem,
} from "./full-look-vto-orchestrator.server";

const mockCount = () => (prisma as any).virtualTryOnJob.count as ReturnType<typeof vi.fn>;
const mockFindFirst = () => (prisma as any).virtualTryOnJob.findFirst as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // mockReset (not just clearAllMocks) — a queued mockResolvedValueOnce
  // from one test must never leak into the next; reset clears both call
  // history and any queued one-time implementations.
  vi.mocked(startOrResumeFullLookChain).mockReset();
  vi.mocked(advanceFullLookChain).mockReset();
  vi.mocked(continueToFinalStep).mockReset();
  vi.mocked(resolveItemImage).mockReset();
  vi.mocked(buildTryOnResultUrl).mockReset();
  mockCount().mockReset();
  mockFindFirst().mockReset();
  // Default: no existing jobs at whatever scope startFullLookOutfit's own
  // terminal-state check looks up — most tests don't care about this and
  // just need the normal (no-escalation) path; tests that DO care override
  // this explicitly.
  vi.mocked(walkFullLookChainJobs).mockReset();
  vi.mocked(walkFullLookChainJobs).mockResolvedValue([]);
});

// ── Garment selection ─────────────────────────────────────────────────────────

describe("selectFullLookGarments", () => {
  function item(itemType: SelectableOutfitItem["itemType"], label: string): SelectableOutfitItem {
    return { itemType, productTitle: label, productImageUrl: `https://example.com/${label}.jpg` };
  }

  beforeEach(() => {
    vi.mocked(resolveItemImage).mockImplementation((i: any) => i.productImageUrl ?? null);
  });

  // ── 3-item outfits ───────────────────────────────────────────────────────

  it("3-item outfit: selects BOTTOM, TOP, OUTERWEAR when nothing else is present — nothing omitted", () => {
    const items = [item("TOP", "shirt"), item("BOTTOM", "trousers"), item("OUTERWEAR", "blazer")];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["shirt", "trousers", "blazer"]);
    expect(result?.omittedLabels).toEqual([]);
  });

  it("a DRESS replaces TOP+BOTTOM outright — selects dress+outerwear+shoes, never a top or bottom alongside the dress", () => {
    const items = [
      item("DRESS", "dress"),
      item("TOP", "shirt"),
      item("BOTTOM", "trousers"),
      item("OUTERWEAR", "blazer"),
      item("SHOES", "boots"),
    ];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["dress", "blazer", "boots"]);
    expect(result?.omittedLabels).toEqual([]);
  });

  it("fewer than 3 resolvable items (category match) returns null — Full-Look VTO not offered", () => {
    const items = [item("TOP", "shirt"), item("BOTTOM", "trousers")];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result).toBeNull();
  });

  it("an item whose image can't be resolved makes the whole selection decline, not submit a broken chain", () => {
    vi.mocked(resolveItemImage).mockImplementation((i: any) => (i.productTitle === "trousers" ? null : (i.productImageUrl ?? null)));
    const items = [item("TOP", "shirt"), item("BOTTOM", "trousers"), item("OUTERWEAR", "blazer")];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result).toBeNull();
  });

  // ── 4-item outfits ───────────────────────────────────────────────────────

  it("4-item outfit: TOP+BOTTOM+OUTERWEAR+SHOES all included — nothing omitted", () => {
    const items = [item("TOP", "sweater"), item("BOTTOM", "jeans"), item("OUTERWEAR", "jacket"), item("SHOES", "boots")];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["sweater", "jeans", "jacket", "boots"]);
    expect(result?.omittedLabels).toEqual([]);
  });

  // ── 5-item outfits — the exact founder QA case ──────────────────────────

  it("5-item outfit (black sweater, jeans, wool jacket, brown Chelsea boots, baseball cap): ALL FIVE pieces are included, nothing omitted", () => {
    const items = [
      item("TOP", "Black Sweater"),
      item("BOTTOM", "Black Jeans"),
      item("OUTERWEAR", "Black Wool Shirt Jacket"),
      item("SHOES", "Brown Chelsea Boots"),
      item("ACCESSORY", "Black Baseball Cap"),
    ];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual([
      "Black Sweater", "Black Jeans", "Black Wool Shirt Jacket", "Brown Chelsea Boots", "Black Baseball Cap",
    ]);
    expect(result?.omittedLabels).toEqual([]);
  });

  it("5-item outfit order follows CATEGORY_PRIORITY, not input order — SHOES before ACCESSORY regardless of list position", () => {
    const items = [
      item("ACCESSORY", "cap"), // listed first, but lower priority than shoes
      item("SHOES", "boots"),
      item("TOP", "sweater"),
      item("BOTTOM", "jeans"),
      item("OUTERWEAR", "jacket"),
    ];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["sweater", "jeans", "jacket", "boots", "cap"]);
  });

  // ── Beyond 5 — the disclosure requirement ───────────────────────────────

  it("an outfit with MORE than 5 eligible categories is capped at 5, and the dropped piece(s) are reported in omittedLabels — never silently", () => {
    // No TOP/BOTTOM (dress excludes them) — 6 real categories: DRESS, OUTERWEAR,
    // SHOES, ACCESSORY, BAG, JEWELRY. Priority keeps the top 5, drops JEWELRY (last).
    const items = [
      item("DRESS", "dress"),
      item("OUTERWEAR", "coat"),
      item("SHOES", "boots"),
      item("ACCESSORY", "cap"),
      item("BAG", "tote"),
      item("JEWELRY", "necklace"),
    ];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["dress", "coat", "boots", "cap", "tote"]);
    expect(result?.omittedLabels).toEqual(["necklace"]);
  });

  it("omittedLabels falls back to the item type when neither productTitle nor a closet name is available", () => {
    const items = [
      item("DRESS", "dress"), item("OUTERWEAR", "coat"), item("SHOES", "boots"),
      item("ACCESSORY", "cap"), item("BAG", "tote"),
      { itemType: "JEWELRY", productTitle: null, productImageUrl: "https://example.com/j.jpg" } as SelectableOutfitItem,
    ];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.omittedLabels).toEqual(["JEWELRY"]);
  });

  // ── Shoes and accessories specifically ──────────────────────────────────

  it("BAG/ACCESSORY/JEWELRY alone (no clothing) CAN now reach the 3-item floor and be selected — no longer structurally excluded", () => {
    const items = [item("BAG", "tote"), item("JEWELRY", "necklace"), item("ACCESSORY", "scarf")];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["scarf", "tote", "necklace"]);
  });

  it("a single extra accessory on top of a complete 3-item clothing outfit is included as the 4th piece, not dropped", () => {
    const items = [item("TOP", "shirt"), item("BOTTOM", "trousers"), item("OUTERWEAR", "blazer"), item("ACCESSORY", "scarf")];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result?.garments.map((g) => g.label)).toEqual(["shirt", "trousers", "blazer", "scarf"]);
    expect(result?.omittedLabels).toEqual([]);
  });

  it("an unresolvable image among 5 eligible categories still declines the whole chain, even though fewer than 5 would otherwise be needed", () => {
    vi.mocked(resolveItemImage).mockImplementation((i: any) => (i.productTitle === "boots" ? null : (i.productImageUrl ?? null)));
    const items = [
      item("TOP", "sweater"), item("BOTTOM", "jeans"), item("OUTERWEAR", "jacket"),
      item("SHOES", "boots"), item("ACCESSORY", "cap"),
    ];
    const result = selectFullLookGarments(items, { customerId: "cust-1", cloudinaryConfig: null });
    expect(result).toBeNull();
  });
});

// ── Attempt scope ────────────────────────────────────────────────────────────

describe("resolveCurrentAttemptScope / startNewAttemptScope — retry-safe idempotency", () => {
  const FP = "fingerprintABC";

  function step0Row(index: number, fingerprint: string = FP, customerId = "cust-1", suggestionId = "sugg-1") {
    return { idempotencyKey: `fulllook-real-reservation:${customerId}:${suggestionId}:a${index}:${fingerprint}` };
  }

  it("first-ever attempt: both resolve to attempt 0 when no step1 row exists yet", async () => {
    mockFindFirst().mockResolvedValue(null);
    mockCount().mockResolvedValue(0);
    expect(await resolveCurrentAttemptScope("cust-1", "sugg-1", FP)).toBe(`sugg-1:a0:${FP}`);
    expect(await startNewAttemptScope("cust-1", "sugg-1", FP)).toBe(`sugg-1:a0:${FP}`);
  });

  it("after one attempt exists: resume reuses it (a0); retry gets a genuinely new one (a1), never colliding", async () => {
    mockFindFirst().mockResolvedValue(step0Row(0));
    mockCount().mockResolvedValue(1);
    expect(await resolveCurrentAttemptScope("cust-1", "sugg-1", FP)).toBe(`sugg-1:a0:${FP}`);
    expect(await startNewAttemptScope("cust-1", "sugg-1", FP)).toBe(`sugg-1:a1:${FP}`);
  });

  it("after two attempts exist (first failed, retried once more): resume reuses the latest (a1), a further retry would get a2", async () => {
    mockFindFirst().mockResolvedValue(step0Row(1));
    mockCount().mockResolvedValue(2);
    expect(await resolveCurrentAttemptScope("cust-1", "sugg-1", FP)).toBe(`sugg-1:a1:${FP}`);
    expect(await startNewAttemptScope("cust-1", "sugg-1", FP)).toBe(`sugg-1:a2:${FP}`);
  });

  it("resolveCurrentAttemptScope reads the most-recently-created step1 row directly, scoped to this customer+suggestion, ordered by createdAt desc", async () => {
    mockFindFirst().mockResolvedValue(null);
    await resolveCurrentAttemptScope("cust-1", "sugg-1", FP);
    expect(mockFindFirst()).toHaveBeenCalledWith({
      where: { customerId: "cust-1", outfitSuggestionId: "sugg-1", productHandle: { startsWith: "fulllook-real:step1:" } },
      orderBy: [{ createdAt: "desc" }],
      select: { idempotencyKey: true },
    });
  });

  it("startNewAttemptScope still counts step1 rows (unchanged) — a genuinely new index must never collide with any existing one", async () => {
    mockCount().mockResolvedValue(3);
    await startNewAttemptScope("cust-1", "sugg-1", FP);
    expect(mockCount()).toHaveBeenCalledWith({
      where: { customerId: "cust-1", outfitSuggestionId: "sugg-1", productHandle: { startsWith: "fulllook-real:step1:" } },
    });
  });

  // 2026-11-15 — THE CONFIRMED LIVE BUG. The old count-based formula
  // (latestIndex = count - 1) breaks the instant the attempt you're
  // trying to resume has ALREADY incremented that count by existing.
  // Reproduced exactly: a single attempt (a1) exists; a plain count of
  // step1 rows for this customer+suggestion is 3 (two OLDER, unrelated
  // dead attempts plus this one) — the old formula would compute
  // latestIndex = 3-1 = 2, a scope nothing has ever used, making this
  // customer's own genuinely in-progress attempt unreachable by their own
  // next refresh. The fix must resolve to the row's OWN index (1),
  // regardless of what the total count happens to be.
  it("REGRESSION — resolves to the latest attempt's OWN index, not count-1, even when prior dead attempts have pushed the count ahead of it", async () => {
    mockFindFirst().mockResolvedValue(step0Row(1)); // the row actually in progress
    mockCount().mockResolvedValue(3); // old formula would have computed index 2 here — wrong
    const scope = await resolveCurrentAttemptScope("cust-1", "sugg-1", FP);
    expect(scope).toBe(`sugg-1:a1:${FP}`); // NOT a2
  });

  // The exact legacy format found live in production data: a step1 row
  // created before fingerprint-embedding existed has NO trailing
  // fingerprint segment at all ("sugg-1:a0", not "sugg-1:a0:fp"). Parsing
  // must still recover its index correctly rather than silently falling
  // back to 0 for the wrong reason.
  it("parses the attempt index correctly from a legacy (pre-fingerprint-embedding) step1 row with no trailing fingerprint segment", async () => {
    mockFindFirst().mockResolvedValue({ idempotencyKey: "fulllook-real-reservation:cust-1:sugg-1:a0" });
    const scope = await resolveCurrentAttemptScope("cust-1", "sugg-1", FP);
    expect(scope).toBe(`sugg-1:a0:${FP}`);
  });

  it("a malformed/unrecognized idempotencyKey fails closed to index 0 rather than throwing", async () => {
    mockFindFirst().mockResolvedValue({ idempotencyKey: "something-unexpected" });
    const scope = await resolveCurrentAttemptScope("cust-1", "sugg-1", FP);
    expect(scope).toBe(`sugg-1:a0:${FP}`);
  });

  // 2026-11-15 — the actual QA bug fix: a different garment set (different
  // fingerprint) must never produce the same scope as an older, now-
  // incompatible attempt, even at the exact same numeric index.
  it("the SAME numeric index with a DIFFERENT fingerprint never collides with an older attempt's scope", async () => {
    mockFindFirst().mockResolvedValue(null);
    const oldThreeItemScope = await resolveCurrentAttemptScope("cust-1", "sugg-1", "fp-3-items");
    const newFiveItemScope = await resolveCurrentAttemptScope("cust-1", "sugg-1", "fp-5-items");
    expect(oldThreeItemScope).not.toBe(newFiveItemScope);
  });

  it("the SAME fingerprint always produces the SAME scope for the same attempt index — resumption still works", async () => {
    mockFindFirst().mockResolvedValue(step0Row(1));
    const first = await resolveCurrentAttemptScope("cust-1", "sugg-1", FP);
    const second = await resolveCurrentAttemptScope("cust-1", "sugg-1", FP);
    expect(first).toBe(second);
  });
});

describe("computeGarmentFingerprint", () => {
  function fpItem(overrides: Partial<SelectableOutfitItem> & { itemType: SelectableOutfitItem["itemType"] }): SelectableOutfitItem {
    return { productTitle: null, productImageUrl: "https://example.com/x.jpg", ...overrides } as SelectableOutfitItem;
  }

  it("the same chosen items (by stable closet id) produce the same fingerprint, regardless of label text", () => {
    const a = [fpItem({ itemType: "TOP", closetItemId: "closet-1", productTitle: "Sweater" })];
    const b = [fpItem({ itemType: "TOP", closetItemId: "closet-1", productTitle: "A different label entirely" })];
    expect(computeGarmentFingerprint(a)).toBe(computeGarmentFingerprint(b));
  });

  it("a different closet item (different stable id) produces a different fingerprint, even with an identical label", () => {
    const a = [fpItem({ itemType: "TOP", closetItemId: "closet-1", productTitle: "Sweater" })];
    const b = [fpItem({ itemType: "TOP", closetItemId: "closet-2", productTitle: "Sweater" })];
    expect(computeGarmentFingerprint(a)).not.toBe(computeGarmentFingerprint(b));
  });

  it("a 3-item set and the same items plus 2 more (3→5 transition) produce different fingerprints", () => {
    const three = [
      fpItem({ itemType: "TOP", closetItemId: "c1" }),
      fpItem({ itemType: "BOTTOM", closetItemId: "c2" }),
      fpItem({ itemType: "OUTERWEAR", closetItemId: "c3" }),
    ];
    const five = [
      ...three,
      fpItem({ itemType: "SHOES", closetItemId: "c4" }),
      fpItem({ itemType: "ACCESSORY", closetItemId: "c5" }),
    ];
    expect(computeGarmentFingerprint(three)).not.toBe(computeGarmentFingerprint(five));
  });

  it("falls back to the image URL when no closet/catalog id is present — a replaced photo (new URL) changes the fingerprint", () => {
    const original = [fpItem({ itemType: "TOP", productImageUrl: "https://example.com/v1.jpg" })];
    const replaced = [fpItem({ itemType: "TOP", productImageUrl: "https://example.com/v2.jpg" })];
    expect(computeGarmentFingerprint(original)).not.toBe(computeGarmentFingerprint(replaced));
  });

  it("order matters — selectFullLookGarments always produces a stable priority order, so this is a non-issue in practice, but the fingerprint itself is order-sensitive", () => {
    const a = [fpItem({ itemType: "TOP", closetItemId: "c1" }), fpItem({ itemType: "BOTTOM", closetItemId: "c2" })];
    const b = [fpItem({ itemType: "BOTTOM", closetItemId: "c2" }), fpItem({ itemType: "TOP", closetItemId: "c1" })];
    expect(computeGarmentFingerprint(a)).not.toBe(computeGarmentFingerprint(b));
  });
});

// ── Auto-advance ──────────────────────────────────────────────────────────────

// 3 garments — totalSteps assertions below (3) assume this exact length.
const BASE_CTX = {
  customerId: "cust-1",
  naiaModelId: "model-1",
  bodyPublicId: "body-1",
  bodyFormat: "jpg",
  deliveryType: "private",
  garments: [
    { label: "a", productImageUrl: "https://x/a.jpg" },
    { label: "b", productImageUrl: "https://x/b.jpg" },
    { label: "c", productImageUrl: "https://x/c.jpg" },
  ],
  consent: { virtualTryOnConsent: true, policyVersion: "1.0", consentedAt: "2026-11-14T00:00:00.000Z" },
  outfitSuggestionId: "sugg-1",
} as any;

const BASE_FP = "fp-abc";

describe("startFullLookOutfit / pollFullLookOutfit — auto-advance past the human-review pause", () => {
  beforeEach(() => {
    mockCount().mockResolvedValue(0);
  });

  it("AWAITING_CONTINUE is resolved automatically — continueToFinalStep is called in the same request, never surfaced to the caller", async () => {
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 1 });
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "AWAITING_CONTINUE", intermediates: [] } as any);
    vi.mocked(continueToFinalStep).mockResolvedValueOnce({ ok: true });

    const result = await startFullLookOutfit(BASE_CTX, BASE_FP);

    expect(continueToFinalStep).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "PROCESSING", stepIndex: 2, totalSteps: 3 });
  });


  it("a continueToFinalStep failure surfaces as ERROR, not silently swallowed", async () => {
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 1 });
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "AWAITING_CONTINUE", intermediates: [] } as any);
    vi.mocked(continueToFinalStep).mockResolvedValueOnce({ ok: false, reason: "continue_window_expired" });

    const result = await pollFullLookOutfit(BASE_CTX, BASE_FP);
    expect(result).toEqual({ status: "ERROR", reason: "continue_window_expired" });
  });

  it("totalSteps reflects THIS chain's own real garment count (5), not a fixed global — genuine progress, never simulated", async () => {
    const fiveGarmentCtx = {
      ...BASE_CTX,
      garments: [
        { label: "sweater", productImageUrl: "https://x/1.jpg" },
        { label: "jeans", productImageUrl: "https://x/2.jpg" },
        { label: "jacket", productImageUrl: "https://x/3.jpg" },
        { label: "boots", productImageUrl: "https://x/4.jpg" },
        { label: "cap", productImageUrl: "https://x/5.jpg" },
      ],
    };
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 1 } as any);
    const result = await pollFullLookOutfit(fiveGarmentCtx, BASE_FP);
    expect(result).toEqual({ status: "PROCESSING", stepIndex: 1, totalSteps: 5 });
  });

  it("COMPLETED passes through with the real resultUrl", async () => {
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "COMPLETED", resultUrl: "https://signed/result.png" } as any);
    const result = await pollFullLookOutfit(BASE_CTX, BASE_FP);
    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed/result.png" });
  });

  it("FAILED passes through with the errorCode — no credit was charged (proven separately by the entitlement exclusion tests)", async () => {
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "FAILED", failedStepIndex: 1, errorCode: "PROVIDER_ERROR" } as any);
    const result = await pollFullLookOutfit(BASE_CTX, BASE_FP);
    expect(result).toEqual({ status: "FAILED", errorCode: "PROVIDER_ERROR" });
  });

  it("a failed start (e.g. cooldown) surfaces as ERROR before ever calling advance", async () => {
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: false, reason: "cooldown_active" });
    const result = await startFullLookOutfit(BASE_CTX, BASE_FP);
    expect(result).toEqual({ status: "ERROR", reason: "cooldown_active" });
    expect(advanceFullLookChain).not.toHaveBeenCalled();
  });

  it("forceNewAttempt uses startNewAttemptScope, not resolveCurrentAttemptScope — retry never resumes the dead failed chain", async () => {
    mockCount().mockResolvedValue(1); // one prior (failed) attempt exists
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

    await startFullLookOutfit(BASE_CTX, BASE_FP, { forceNewAttempt: true });

    const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
    expect(ctxPassed.reservationScope).toBe(`sugg-1:a1:${BASE_FP}`); // new attempt, not a0 (the dead one)
  });

  // 2026-11-15 REGRESSION FIX — the actual QA bug: a plain (non-retry)
  // explicit start used to unconditionally resume whatever the latest
  // attempt was, even if it had already reached a dead terminal state —
  // silently replaying an old failure instead of giving this click a real
  // attempt. These prove the fix at the orchestrator layer directly.
  describe("a plain (non-retry) start never silently replays an already-dead attempt", () => {
    it("FAILED last job on the resolved scope: escalates to a fresh attempt automatically, without needing forceNewAttempt", async () => {
      mockCount().mockResolvedValue(1); // one prior attempt exists (a0)
      vi.mocked(walkFullLookChainJobs).mockResolvedValueOnce([{ status: "FAILED" } as any]); // a0's own last job
      vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
      vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

      await startFullLookOutfit(BASE_CTX, BASE_FP); // plain start — no retry flag at all

      const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
      expect(ctxPassed.reservationScope).toBe(`sugg-1:a1:${BASE_FP}`); // escalated past a0, same as an explicit retry would
    });

    it("CANCELED and TIMED_OUT last jobs are treated the same as FAILED", async () => {
      for (const deadStatus of ["CANCELED", "TIMED_OUT"]) {
        vi.mocked(startOrResumeFullLookChain).mockReset();
        vi.mocked(walkFullLookChainJobs).mockReset();
        mockCount().mockResolvedValue(1);
        vi.mocked(walkFullLookChainJobs).mockResolvedValueOnce([{ status: deadStatus } as any]);
        vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
        vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

        await startFullLookOutfit(BASE_CTX, BASE_FP);

        const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
        expect(ctxPassed.reservationScope).toBe(`sugg-1:a1:${BASE_FP}`);
      }
    });

    it("a still-ACTIVE (PROCESSING) last job on the resolved scope resumes normally — no escalation, no second chain", async () => {
      mockCount().mockResolvedValue(1);
      vi.mocked(walkFullLookChainJobs).mockResolvedValueOnce([{ status: "PROCESSING" } as any]);
      vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
      vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

      await startFullLookOutfit(BASE_CTX, BASE_FP);

      const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
      expect(ctxPassed.reservationScope).toBe(`sugg-1:a0:${BASE_FP}`); // resumed a0, not escalated
    });

    it("a COMPLETED last job is left alone by this check — advanceFullLookChain's own COMPLETED detection handles it, not an escalation", async () => {
      mockCount().mockResolvedValue(1);
      vi.mocked(walkFullLookChainJobs).mockResolvedValueOnce([{ status: "COMPLETED" } as any]);
      vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
      vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "COMPLETED", resultUrl: "https://signed/r.png" } as any);

      const result = await startFullLookOutfit(BASE_CTX, BASE_FP);

      const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
      expect(ctxPassed.reservationScope).toBe(`sugg-1:a0:${BASE_FP}`);
      expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed/r.png" });
    });

    it("no existing jobs at all (brand-new attempt): the terminal check has nothing to escalate from, proceeds as a normal first start", async () => {
      mockCount().mockResolvedValue(0);
      vi.mocked(walkFullLookChainJobs).mockResolvedValueOnce([]); // nothing exists yet
      vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
      vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

      await startFullLookOutfit(BASE_CTX, BASE_FP);

      const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
      expect(ctxPassed.reservationScope).toBe(`sugg-1:a0:${BASE_FP}`);
    });

    it("a passive poll (pollFullLookOutfit) NEVER auto-escalates — a dead attempt is still reported as FAILED, not silently retried behind the customer's back", async () => {
      mockCount().mockResolvedValue(1);
      vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "FAILED", failedStepIndex: 0, errorCode: "PROVIDER_ERROR" } as any);

      const result = await pollFullLookOutfit(BASE_CTX, BASE_FP);

      expect(result).toEqual({ status: "FAILED", errorCode: "PROVIDER_ERROR" });
      expect(walkFullLookChainJobs).not.toHaveBeenCalled(); // this check is exclusive to startFullLookOutfit
      expect(startOrResumeFullLookChain).not.toHaveBeenCalled(); // poll never calls this at all
    });

    it("forceNewAttempt skips this check entirely — it already computes a genuinely new scope unconditionally", async () => {
      mockCount().mockResolvedValue(1);
      vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
      vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

      await startFullLookOutfit(BASE_CTX, BASE_FP, { forceNewAttempt: true });

      expect(walkFullLookChainJobs).not.toHaveBeenCalled();
    });
  });

  // 2026-11-15 — concurrency / credit-limit bypass review: a retry request
  // computes a genuinely NEW reservationScope regardless of whether the
  // customer's current attempt is still active, so this orchestration layer
  // relies entirely on startOrResumeFullLookChain's own customer-wide
  // active-job check (checkCustomerCooldown -> createOrFindTryOnJob's
  // Serializable-transaction single-flight guarantee, shared unmodified
  // with single-item VTO) to reject a new scope's step 0 while an older
  // scope is still PROCESSING. This test proves THIS layer propagates that
  // rejection as a controlled BUSY status (2026-11-15 — previously a hard
  // ERROR; checkCustomerCooldown's ACTIVE_JOB/COOLDOWN reasons are an
  // expected business condition, not a server failure, so the route no
  // longer maps them to a 500) rather than treating a new scope as license
  // to proceed — no new job, no new credit-eligible chain, even though the
  // scope itself computed successfully.
  it("retrying while the current attempt is still ACTIVE (not yet failed) is rejected as BUSY, not silently allowed to start a second concurrent chain", async () => {
    mockCount().mockResolvedValue(1); // attempt a0 exists and is still PROCESSING — not yet failed
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: false, reason: "ACTIVE_JOB" });

    const result = await startFullLookOutfit(BASE_CTX, BASE_FP, { forceNewAttempt: true });

    expect(result).toEqual({ status: "BUSY", reason: "ACTIVE_JOB" });
    expect(advanceFullLookChain).not.toHaveBeenCalled();
    // The new scope was computed (a1), but startOrResumeFullLookChain's own
    // atomic guard — not this layer — is what actually blocked it.
    const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
    expect(ctxPassed.reservationScope).toBe(`sugg-1:a1:${BASE_FP}`);
  });

  it("two concurrent calls racing to the SAME computed scope rely on the shared idempotency key, not a lock in this layer — both receive a coherent result, never a duplicate chain", async () => {
    // Simulates createOrFindTryOnJob's own DB-unique-constraint outcome one
    // level up: the winner gets a fresh PROCESSING chain, the loser's
    // startOrResumeFullLookChain call resolves against the SAME row the
    // winner just created (ok:true, same stepIndex) — never a second,
    // independently-chargeable chain.
    mockCount().mockResolvedValue(0);
    vi.mocked(startOrResumeFullLookChain)
      .mockResolvedValueOnce({ ok: true, stepIndex: 0 })
      .mockResolvedValueOnce({ ok: true, stepIndex: 0 });
    vi.mocked(advanceFullLookChain).mockResolvedValue({ status: "PROCESSING", stepIndex: 0 } as any);

    const [a, b] = await Promise.all([
      startFullLookOutfit(BASE_CTX, BASE_FP),
      startFullLookOutfit(BASE_CTX, BASE_FP),
    ]);

    expect(a).toEqual({ status: "PROCESSING", stepIndex: 0, totalSteps: 3 });
    expect(b).toEqual({ status: "PROCESSING", stepIndex: 0, totalSteps: 3 });
    const scopes = vi.mocked(startOrResumeFullLookChain).mock.calls.map((c) => c[0].reservationScope);
    expect(scopes).toEqual([`sugg-1:a0:${BASE_FP}`, `sugg-1:a0:${BASE_FP}`]); // both requests converge on the same attempt, never two
  });
});

// ── Existing-result lookup ───────────────────────────────────────────────────

describe("findCompletedFullLookForSuggestion — never regenerate on revisit", () => {
  it("finds the final (role-tagged, not position-tagged) COMPLETED job for this suggestion and returns its signed result URL", async () => {
    mockFindFirst().mockResolvedValueOnce({ id: "job-final", completedAt: new Date("2026-11-14T00:00:00.000Z") });
    vi.mocked(buildTryOnResultUrl).mockReturnValueOnce("https://signed/final.png");

    const result = await findCompletedFullLookForSuggestion("cust-1", "sugg-1");

    expect(mockFindFirst()).toHaveBeenCalledWith({
      where: {
        customerId: "cust-1",
        outfitSuggestionId: "sugg-1",
        productHandle: { startsWith: "fulllook-real:final:" },
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual({ jobId: "job-final", resultUrl: "https://signed/final.png", completedAt: new Date("2026-11-14T00:00:00.000Z") });
  });

  it("returns null when no completed final step exists yet — never fabricates a result", async () => {
    mockFindFirst().mockResolvedValueOnce(null);
    const result = await findCompletedFullLookForSuggestion("cust-1", "sugg-1");
    expect(result).toBeNull();
    expect(buildTryOnResultUrl).not.toHaveBeenCalled();
  });

  it("returns null (not a broken URL) when Cloudinary isn't configured", async () => {
    mockFindFirst().mockResolvedValueOnce({ id: "job-final", completedAt: null });
    vi.mocked(buildTryOnResultUrl).mockReturnValueOnce(null);
    const result = await findCompletedFullLookForSuggestion("cust-1", "sugg-1");
    expect(result).toBeNull();
  });
});
