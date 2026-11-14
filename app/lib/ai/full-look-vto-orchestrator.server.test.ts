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
} from "./full-look-tryon-real.server.js";
import {
  selectFullLookGarments,
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
  it("first-ever attempt: both resolve to attempt 0 when no step1 row exists yet", async () => {
    mockCount().mockResolvedValue(0);
    expect(await resolveCurrentAttemptScope("cust-1", "sugg-1")).toBe("sugg-1:a0");
    expect(await startNewAttemptScope("cust-1", "sugg-1")).toBe("sugg-1:a0");
  });

  it("after one attempt exists: resume reuses it (a0); retry gets a genuinely new one (a1), never colliding", async () => {
    mockCount().mockResolvedValue(1);
    expect(await resolveCurrentAttemptScope("cust-1", "sugg-1")).toBe("sugg-1:a0");
    expect(await startNewAttemptScope("cust-1", "sugg-1")).toBe("sugg-1:a1");
  });

  it("after two attempts exist (first failed, retried once more): resume reuses the latest (a1), a further retry would get a2", async () => {
    mockCount().mockResolvedValue(2);
    expect(await resolveCurrentAttemptScope("cust-1", "sugg-1")).toBe("sugg-1:a1");
    expect(await startNewAttemptScope("cust-1", "sugg-1")).toBe("sugg-1:a2");
  });

  it("counts step1 rows scoped to both this customer and this exact suggestion — never a different customer's or suggestion's attempts", async () => {
    await resolveCurrentAttemptScope("cust-1", "sugg-1");
    expect(mockCount()).toHaveBeenCalledWith({
      where: { customerId: "cust-1", outfitSuggestionId: "sugg-1", productHandle: { startsWith: "fulllook-real:step1:" } },
    });
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

describe("startFullLookOutfit / pollFullLookOutfit — auto-advance past the human-review pause", () => {
  beforeEach(() => {
    mockCount().mockResolvedValue(0);
  });

  it("AWAITING_CONTINUE is resolved automatically — continueToFinalStep is called in the same request, never surfaced to the caller", async () => {
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 1 });
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "AWAITING_CONTINUE", intermediates: [] } as any);
    vi.mocked(continueToFinalStep).mockResolvedValueOnce({ ok: true });

    const result = await startFullLookOutfit(BASE_CTX);

    expect(continueToFinalStep).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "PROCESSING", stepIndex: 2, totalSteps: 3 });
  });

  it("a continueToFinalStep failure surfaces as ERROR, not silently swallowed", async () => {
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 1 });
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "AWAITING_CONTINUE", intermediates: [] } as any);
    vi.mocked(continueToFinalStep).mockResolvedValueOnce({ ok: false, reason: "continue_window_expired" });

    const result = await pollFullLookOutfit(BASE_CTX);
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
    const result = await pollFullLookOutfit(fiveGarmentCtx);
    expect(result).toEqual({ status: "PROCESSING", stepIndex: 1, totalSteps: 5 });
  });

  it("COMPLETED passes through with the real resultUrl", async () => {
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "COMPLETED", resultUrl: "https://signed/result.png" } as any);
    const result = await pollFullLookOutfit(BASE_CTX);
    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed/result.png" });
  });

  it("FAILED passes through with the errorCode — no credit was charged (proven separately by the entitlement exclusion tests)", async () => {
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "FAILED", failedStepIndex: 1, errorCode: "PROVIDER_ERROR" } as any);
    const result = await pollFullLookOutfit(BASE_CTX);
    expect(result).toEqual({ status: "FAILED", errorCode: "PROVIDER_ERROR" });
  });

  it("a failed start (e.g. cooldown) surfaces as ERROR before ever calling advance", async () => {
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: false, reason: "cooldown_active" });
    const result = await startFullLookOutfit(BASE_CTX);
    expect(result).toEqual({ status: "ERROR", reason: "cooldown_active" });
    expect(advanceFullLookChain).not.toHaveBeenCalled();
  });

  it("forceNewAttempt uses startNewAttemptScope, not resolveCurrentAttemptScope — retry never resumes the dead failed chain", async () => {
    mockCount().mockResolvedValue(1); // one prior (failed) attempt exists
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: true, stepIndex: 0 });
    vi.mocked(advanceFullLookChain).mockResolvedValueOnce({ status: "PROCESSING", stepIndex: 0 } as any);

    await startFullLookOutfit(BASE_CTX, { forceNewAttempt: true });

    const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
    expect(ctxPassed.reservationScope).toBe("sugg-1:a1"); // new attempt, not a0 (the dead one)
  });

  // 2026-11-15 — concurrency / credit-limit bypass review: a retry request
  // computes a genuinely NEW reservationScope regardless of whether the
  // customer's current attempt is still active, so this orchestration layer
  // relies entirely on startOrResumeFullLookChain's own customer-wide
  // active-job check (checkCustomerCooldown -> createOrFindTryOnJob's
  // Serializable-transaction single-flight guarantee, shared unmodified
  // with single-item VTO) to reject a new scope's step 0 while an older
  // scope is still PROCESSING. This test proves THIS layer propagates that
  // rejection as a hard ERROR rather than treating a new scope as license to
  // proceed — no new job, no new credit-eligible chain, even though the
  // scope itself computed successfully.
  it("retrying while the current attempt is still ACTIVE (not yet failed) is rejected, not silently allowed to start a second concurrent chain", async () => {
    mockCount().mockResolvedValue(1); // attempt a0 exists and is still PROCESSING — not yet failed
    vi.mocked(startOrResumeFullLookChain).mockResolvedValueOnce({ ok: false, reason: "ACTIVE_JOB" });

    const result = await startFullLookOutfit(BASE_CTX, { forceNewAttempt: true });

    expect(result).toEqual({ status: "ERROR", reason: "ACTIVE_JOB" });
    expect(advanceFullLookChain).not.toHaveBeenCalled();
    // The new scope was computed (a1), but startOrResumeFullLookChain's own
    // atomic guard — not this layer — is what actually blocked it.
    const ctxPassed = vi.mocked(startOrResumeFullLookChain).mock.calls[0][0];
    expect(ctxPassed.reservationScope).toBe("sugg-1:a1");
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
      startFullLookOutfit(BASE_CTX),
      startFullLookOutfit(BASE_CTX),
    ]);

    expect(a).toEqual({ status: "PROCESSING", stepIndex: 0, totalSteps: 3 });
    expect(b).toEqual({ status: "PROCESSING", stepIndex: 0, totalSteps: 3 });
    const scopes = vi.mocked(startOrResumeFullLookChain).mock.calls.map((c) => c[0].reservationScope);
    expect(scopes).toEqual(["sugg-1:a0", "sugg-1:a0"]); // both requests converge on the same attempt, never two
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
