// app/routes/style-me/transient-retry-20261120.test.ts
//
// prog-1 (PostgreSQL 08P01) release-readiness follow-up: this route's loader
// — the exact page the original 08P01 incident was reported on — had 7
// direct Prisma reads with zero transient-database retry protection, even
// though getCurrentNaiaCustomer on the same page already is (see
// app/lib/prisma-transient-retry.server.ts). Each read is now wrapped in
// withTransientRetry. withTransientRetry's own generic retry/exhaustion/
// recovery mechanics are already exhaustively covered by
// prisma-transient-retry.server.test.ts (23/23) — this file does not
// re-test that logic in isolation. It proves the WIRING through the real
// loader: one representative query from the Promise.all block
// (onboardingProfile, which runs concurrently with two others) and one
// representative sequential conditional query (savedLook), each exercised
// through transient-failure-then-recovery, persistent-failure-then-
// exhaustion, and the clean happy path — using the real ~200ms retry delay
// (no `deps`/`_sleep` injection point exists on a React Router loader export
// itself — the framework only ever calls it with one argument — matching
// the existing convention for every other route loader in this app).
//
// Run: npx vitest run app/routes/style-me/transient-retry-20261120.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  requireCurrentNaiaCustomer,
  getCurrentNaiaCustomer,
  onboardingProfileFindUnique,
  closetItemCount,
  stylingSessionFindMany,
  savedLookFindMany,
  outfitSuggestionFindMany,
  virtualTryOnJobFindMany,
} = vi.hoisted(() => ({
  requireCurrentNaiaCustomer: vi.fn(),
  getCurrentNaiaCustomer: vi.fn(),
  onboardingProfileFindUnique: vi.fn(),
  closetItemCount: vi.fn(),
  stylingSessionFindMany: vi.fn(),
  savedLookFindMany: vi.fn(),
  outfitSuggestionFindMany: vi.fn(),
  virtualTryOnJobFindMany: vi.fn(),
}));

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer,
  getCurrentNaiaCustomer,
}));

vi.mock("~/db.server", () => ({
  default: {
    onboardingProfile: { findUnique: onboardingProfileFindUnique },
    closetItem: { count: closetItemCount },
    stylingSession: { findMany: stylingSessionFindMany },
    savedLook: { findMany: savedLookFindMany },
    outfitSuggestion: { findMany: outfitSuggestionFindMany },
    virtualTryOnJob: { findMany: virtualTryOnJobFindMany },
  },
}));

vi.mock("~/lib/ai/taste-reconcile.server", () => ({ writeSourceEvidence: vi.fn() }));
vi.mock("~/lib/session.server", () => ({ clearStyleMeSession: vi.fn() }));
vi.mock("~/lib/cloudinary-admin.server", () => ({ getCloudinaryConfig: vi.fn().mockReturnValue(null) }));
vi.mock("~/lib/styleme/look-image-resolution.server", () => ({
  resolveCollageImages: vi.fn().mockReturnValue({ resolvedImages: [], extraCount: 0 }),
}));

import { loader } from "./_index";

const CUSTOMER = { id: "customer-A" };

// Prisma's real embedded-struct message shape for 08P01 (see
// error-tracking.server.test.ts / prisma-transient-retry.server.test.ts for
// the same realistic fixture text) — the exact error class this fix exists
// to retry.
function transient08P01Error() {
  const err = new Error(
    'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "08P01", message: "protocol violation", routine: Some("exec_bind_message") }) })',
  );
  err.name = "PrismaClientUnknownRequestError";
  return err;
}

function baseArgs() {
  return { request: new Request("https://naia-stylist.vercel.app/style-me") } as any;
}

function resetAllMocksToHappyDefaults() {
  vi.clearAllMocks();
  getCurrentNaiaCustomer.mockResolvedValue(CUSTOMER);
  onboardingProfileFindUnique.mockResolvedValue({ stylePersonalities: [] });
  closetItemCount.mockResolvedValue(0);
  stylingSessionFindMany.mockResolvedValue([]);
  savedLookFindMany.mockResolvedValue([]);
  outfitSuggestionFindMany.mockResolvedValue([]);
  virtualTryOnJobFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  resetAllMocksToHappyDefaults();
});

describe("style-me/_index loader — transient-retry wiring (prog-1 follow-up)", () => {
  it("the clean happy path is completely unaffected — every query called exactly once", async () => {
    const result = (await loader(baseArgs())) as any;
    const body = result?.data ?? result;
    expect(body.hasProfile).toBe(true);
    expect(onboardingProfileFindUnique).toHaveBeenCalledTimes(1);
    expect(closetItemCount).toHaveBeenCalledTimes(1);
    expect(stylingSessionFindMany).toHaveBeenCalledTimes(1);
    expect(savedLookFindMany).toHaveBeenCalledTimes(1);
    // outfitSuggestion/virtualTryOnJob are conditionally skipped entirely
    // when there is nothing to look up — savedLookFindMany resolving to
    // [] means that's genuinely correct here, not a bug this test should
    // paper over.
    expect(outfitSuggestionFindMany).not.toHaveBeenCalled();
    expect(virtualTryOnJobFindMany).not.toHaveBeenCalled();
  });

  describe("Promise.all-block query (onboardingProfile) — concurrency-preserving retry", () => {
    it("recovers from one transient 08P01 failure, then succeeds — exactly 2 attempts", async () => {
      onboardingProfileFindUnique
        .mockRejectedValueOnce(transient08P01Error())
        .mockResolvedValueOnce({ stylePersonalities: ["Classic"] });

      const result = (await loader(baseArgs())) as any;
      const body = result?.data ?? result;

      expect(body.hasProfile).toBe(true);
      expect(body.stylePersonalities).toEqual(["Classic"]);
      expect(onboardingProfileFindUnique).toHaveBeenCalledTimes(2);
      // The other two Promise.all members ran concurrently and were never
      // touched by this query's own retry — proving concurrency, not
      // sequencing, is preserved.
      expect(closetItemCount).toHaveBeenCalledTimes(1);
      expect(stylingSessionFindMany).toHaveBeenCalledTimes(1);
    });

    it("exhausts its bounded retry and the loader call rejects with DatabaseUnavailableError — never a silent null/empty profile", async () => {
      onboardingProfileFindUnique.mockRejectedValue(transient08P01Error());

      await expect(loader(baseArgs())).rejects.toMatchObject({ name: "DatabaseUnavailableError" });
      // Exactly 2 attempts, never a 3rd — the same bound every other
      // withTransientRetry call site in this app already guarantees.
      expect(onboardingProfileFindUnique).toHaveBeenCalledTimes(2);
    });

    it("a non-transient error (e.g. a genuine schema/query bug) is rethrown immediately, never retried, never confused with a connectivity failure", async () => {
      const bug = new Error("Unknown argument `doesNotExist`");
      onboardingProfileFindUnique.mockRejectedValue(bug);

      await expect(loader(baseArgs())).rejects.toBe(bug);
      expect(onboardingProfileFindUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("sequential conditional query (savedLook) — the same protection outside Promise.all", () => {
    it("recovers from one transient 08P01 failure, then succeeds", async () => {
      savedLookFindMany
        .mockRejectedValueOnce(transient08P01Error())
        .mockResolvedValueOnce([]);

      const result = (await loader(baseArgs())) as any;
      const body = result?.data ?? result;
      expect(body.hasProfile).toBe(true);
      expect(savedLookFindMany).toHaveBeenCalledTimes(2);
    });

    it("exhausts its bounded retry and the loader call rejects with DatabaseUnavailableError", async () => {
      savedLookFindMany.mockRejectedValue(transient08P01Error());

      await expect(loader(baseArgs())).rejects.toMatchObject({ name: "DatabaseUnavailableError" });
      expect(savedLookFindMany).toHaveBeenCalledTimes(2);
    });
  });

  it("recovering from a transient failure never duplicates a read, let alone a write — this route's loader performs zero writes of any kind", async () => {
    onboardingProfileFindUnique
      .mockRejectedValueOnce(transient08P01Error())
      .mockResolvedValueOnce({ stylePersonalities: [] });
    savedLookFindMany
      .mockRejectedValueOnce(transient08P01Error())
      .mockResolvedValueOnce([]);

    await loader(baseArgs());

    // Every mock in this suite is a `find*`/`count` read — asserting the
    // retried ones landed at exactly 2 calls (not 3+, not an unbounded
    // loop) is the complete side-effect-safety story for a read-only
    // loader: there is no write call anywhere in this file to assert
    // "never duplicated" against, because the loader itself never issues
    // one (confirmed by reading app/routes/style-me/_index.tsx directly —
    // all 7 wrapped calls are findUnique/findMany/count).
    expect(onboardingProfileFindUnique).toHaveBeenCalledTimes(2);
    expect(savedLookFindMany).toHaveBeenCalledTimes(2);
  });
});
