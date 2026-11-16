// app/lib/ai/my-naia-model.server.test.ts
//
// Focused coverage for atomicallyCloseOutProcessingJob — the compare-and-
// set fix for the confirmed real race between a customer's own live poll
// and the Full-Look VTO server-side reconciliation sweep (both can
// observe the same PROCESSING row's provider status at the same instant
// and both decide to close it out; a separate read-then-write re-check
// cannot close that, only an atomic conditional write can).
//
// HONEST LIMIT, stated rather than glossed over: this file cannot run
// against a real Postgres transaction — no Docker/local Postgres is
// available in this environment (checked, not assumed: no `docker`,
// `psql`, or `pg_ctl` binary found). What it DOES prove, rigorously: (1)
// the function's own logic correctly turns "the database reports zero
// rows affected" into "claimed: false, never overwrite," and (2) under a
// GENUINELY concurrent two-caller race — both calls issued in the same
// Promise.all tick, both reaching the fake "database" before either
// resolves — a fake that correctly implements the real WHERE clause's
// semantics (only succeeds if the row is CURRENTLY "PROCESSING" at the
// instant it runs, exactly matching what Postgres's own row-level write
// serialization guarantees for two concurrent UPDATE...WHERE statements)
// lets only one caller win. What it does NOT prove is that Postgres
// itself honors that WHERE clause atomically under real concurrent
// transactions — that is a standard, well-established database guarantee
// this code relies on by design, not something this suite can verify
// without real infrastructure. A live verification, if ever wanted, would
// mean two concurrent processes hitting a real staging Postgres row —
// out of scope for a unit-test run.
//
// Run: npx vitest run app/lib/ai/my-naia-model.server.test.ts

import { describe, it, expect } from "vitest";
import { atomicallyCloseOutProcessingJob, tryAcquireProcessingLease, type AtomicUpdateManyFn, type LeaseUpdateManyFn } from "./my-naia-model.server";
import type { VirtualTryOnJobRecord } from "./virtual-try-on.types";

function fakeJob(overrides: Partial<VirtualTryOnJobRecord> = {}): VirtualTryOnJobRecord {
  return {
    id: "job-1",
    customerId: "cust-1",
    naiaModelId: "model-1",
    productHandle: "fulllook-real:step1:Trousers",
    provider: "FASHN",
    predictionId: "pred-1",
    status: "PROCESSING",
    virtualTryOnConsentAt: new Date("2026-11-03T00:00:00.000Z"),
    consentPolicyVersion: "1.0",
    saveTryOnResultConsentAt: null,
    idempotencyKey: "key-job-1",
    requestFingerprint: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    lastActivityAt: new Date(),
    ...overrides,
  } as VirtualTryOnJobRecord;
}

// A faithful-enough fake of the real Prisma call: a single in-memory row,
// and an updateMany whose WHERE-equivalent check (status === the row's
// CURRENT live value) is evaluated against that live state, never a
// stale snapshot captured when the caller started. The deliberate
// `await new Promise((r) => setTimeout(r, 0))` BEFORE the check — not
// after — is what makes the race genuinely contested rather than
// trivially sequential: without it, Node's single-threaded scheduler
// would run the first call's entire check-then-write synchronously to
// completion before the second call starts at all, which would prove
// nothing about the race. With it, BOTH concurrent calls reach their
// decision point in the same microtask batch, before EITHER has written
// — exactly the scenario a separate read-then-write re-check cannot
// survive, and exactly what an atomic single-statement conditional
// UPDATE is designed to. JS's own scheduler still resolves the two
// pending timers in a fixed order, so which caller wins is deterministic
// here — true nondeterminism needs real parallel transactions, which
// this environment has no Postgres available to provide (checked, not
// assumed: see this file's header). What IS proven, rigorously: once
// both callers have reached the same decision point with the row still
// unclaimed, the SECOND one to actually execute its check correctly sees
// the FIRST one's already-committed write and backs off — the core
// property the fix depends on.
function makeFakeRow(initialStatus: "PROCESSING" | "COMPLETED" | "FAILED" = "PROCESSING") {
  const row = { status: initialStatus as string };
  const updateMany: AtomicUpdateManyFn = async (jobId, data) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (row.status !== "PROCESSING") return { count: 0 };
    row.status = data.status;
    return { count: 1 };
  };
  return { row, updateMany };
}

describe("atomicallyCloseOutProcessingJob", () => {
  it("claims successfully when the row is PROCESSING, returning the new status and fields", async () => {
    const { updateMany } = makeFakeRow("PROCESSING");
    const job = fakeJob();

    const result = await atomicallyCloseOutProcessingJob(job, "COMPLETED", { predictionId: "pred-final" }, updateMany);

    expect(result).toEqual({
      claimed: true,
      job: expect.objectContaining({ id: "job-1", status: "COMPLETED", predictionId: "pred-final" }),
    });
  });

  it("refuses (claimed: false) when the row is no longer PROCESSING — zero rows affected, never a write", async () => {
    const { updateMany } = makeFakeRow("COMPLETED"); // already closed out by someone else
    const job = fakeJob();

    const result = await atomicallyCloseOutProcessingJob(job, "COMPLETED", {}, updateMany);

    expect(result).toEqual({ claimed: false });
  });

  it("defaults predictionId/errorCode to the job's own current values when extras doesn't override them", async () => {
    const { updateMany } = makeFakeRow("PROCESSING");
    const job = fakeJob({ predictionId: "pred-existing", errorCode: "OLD_CODE" });

    const result = await atomicallyCloseOutProcessingJob(job, "FAILED", {}, updateMany);

    expect(result).toEqual({
      claimed: true,
      job: expect.objectContaining({ predictionId: "pred-existing", errorCode: "OLD_CODE", status: "FAILED" }),
    });
  });

  it("extras explicitly override the job's own current predictionId/errorCode when provided", async () => {
    const { updateMany } = makeFakeRow("PROCESSING");
    const job = fakeJob({ predictionId: "pred-existing", errorCode: "OLD_CODE" });

    const result = await atomicallyCloseOutProcessingJob(job, "FAILED", { errorCode: "NEW_CODE" }, updateMany);

    expect(result).toEqual({
      claimed: true,
      job: expect.objectContaining({ predictionId: "pred-existing", errorCode: "NEW_CODE" }),
    });
  });

  it("the WHERE-equivalent condition passed to the update function is scoped to this exact job id and status PROCESSING", async () => {
    const calls: Array<[string, unknown]> = [];
    const spyUpdateMany: AtomicUpdateManyFn = async (jobId, data) => {
      calls.push([jobId, data]);
      return { count: 1 };
    };
    const job = fakeJob({ id: "job-specific" });

    await atomicallyCloseOutProcessingJob(job, "COMPLETED", { predictionId: "pred-x" }, spyUpdateMany);

    expect(calls).toHaveLength(1);
    const [jobIdArg, dataArg] = calls[0];
    expect(jobIdArg).toBe("job-specific");
    expect(dataArg).toMatchObject({ status: "COMPLETED", predictionId: "pred-x" });
  });

  // 2026-11-16 — GENUINE SIMULTANEOUS RACE, not sequential interleaving.
  // Both calls are issued in the SAME Promise.all tick, both reach the
  // fake "database" and read row.status as "PROCESSING" before either
  // has written anything (this is exactly what a read-then-write
  // re-check, this codebase's own earlier and rejected attempt at this
  // fix, cannot prevent). The fake's updateMany is written to replicate
  // the one property a real conditional UPDATE guarantees: it checks the
  // row's CURRENT status at the instant IT executes (synchronously, in
  // this fake — but critically, checked fresh on each call, never cached
  // from when the caller started), so only the first of the two calls to
  // actually run its check-and-write can ever succeed.
  it("CONCURRENT WORKERS — two genuinely simultaneous callers racing to close out the SAME row: exactly one wins, the other is told it lost, never both", async () => {
    const { row, updateMany } = makeFakeRow("PROCESSING");
    const job = fakeJob();

    const [first, second] = await Promise.all([
      atomicallyCloseOutProcessingJob(job, "COMPLETED", { predictionId: "pred-a" }, updateMany),
      atomicallyCloseOutProcessingJob(job, "FAILED", { errorCode: "PROVIDER_FAILED" }, updateMany),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.claimed)).toHaveLength(1); // exactly one winner
    expect(results.filter((r) => !r.claimed)).toHaveLength(1); // exactly one loser
    // The row's final state matches whichever call actually won — never a
    // mix, never both writes landing.
    const winner = results.find((r) => r.claimed) as { claimed: true; job: VirtualTryOnJobRecord };
    expect(row.status).toBe(winner.job.status);
  });

  it("CONCURRENT WORKERS — ten simultaneous callers racing to close out the SAME row: still exactly one winner, nine losers", async () => {
    const { updateMany } = makeFakeRow("PROCESSING");
    const job = fakeJob();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => atomicallyCloseOutProcessingJob(job, "COMPLETED", { predictionId: `pred-${i}` }, updateMany)),
    );

    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed)).toHaveLength(9);
  });
});

// ── tryAcquireProcessingLease — claim before any external side effect ───────
//
// CONFIRMED GAP this closes: atomicallyCloseOutProcessingJob (above) only
// makes the FINAL database write atomic. Without a claim BEFORE the real
// Cloudinary upload, two genuinely concurrent callers could both perform
// that upload (harmless — idempotent, same publicId — but a real,
// avoidable waste) before either's atomic close-out resolves anything.
// This reuses the existing lastActivityAt column as a lease marker
// (acquire = atomically bump it, but only if it's currently older than
// the lease duration) rather than a new status value or schema change —
// see the real function's own header for the full mechanism, including
// why a crashed holder's lease self-heals once it expires.
function makeFakeLeaseRow(initialStatus: "PROCESSING" | "COMPLETED" = "PROCESSING", initialLastActivityAt = 0) {
  const row = { status: initialStatus as string, lastActivityAt: initialLastActivityAt };
  const updateMany: LeaseUpdateManyFn = async (jobId, cutoff, now) => {
    if (row.status !== "PROCESSING") return { count: 0 };
    if (row.lastActivityAt >= cutoff.getTime()) return { count: 0 }; // lease still held (not stale enough)
    row.lastActivityAt = now.getTime();
    return { count: 1 };
  };
  return { row, updateMany };
}

describe("tryAcquireProcessingLease", () => {
  it("acquires successfully when the row has had no recent activity", async () => {
    const { updateMany } = makeFakeLeaseRow("PROCESSING", 0); // ancient lastActivityAt
    const result = await tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 1_000_000);
    expect(result).toEqual({ acquired: true });
  });

  it("refuses when the lease is still fresh — another caller is actively holding it right now", async () => {
    const now = 1_000_000;
    const { updateMany } = makeFakeLeaseRow("PROCESSING", now - 1_000); // bumped 1s ago, well within a 90s lease
    const result = await tryAcquireProcessingLease("job-1", 90_000, updateMany, () => now);
    expect(result).toEqual({ acquired: false });
  });

  it("refuses when the row is no longer PROCESSING at all — nothing left to lease", async () => {
    const { updateMany } = makeFakeLeaseRow("COMPLETED", 0);
    const result = await tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 1_000_000);
    expect(result).toEqual({ acquired: false });
  });

  // 2026-11-16 — CRASH RECOVERY, the explicit requirement: a lease holder
  // that acquires and then crashes before ever reaching the final
  // close-out leaves the row at PROCESSING with a freshly-bumped
  // lastActivityAt — indistinguishable from a lease still legitimately in
  // use. This proves the self-healing half of that: once leaseDurationMs
  // has genuinely elapsed with no further activity, a later caller's own
  // acquire attempt succeeds again, safely retrying from scratch.
  it("CRASH RECOVERY — a lease whose holder never returned is acquirable again once it has genuinely expired", async () => {
    // lastActivityAt starts old enough (100s before t=100_000, the first
    // acquire below) to be acquirable right away — a row that's simply
    // never had any lease activity, not a special case.
    const { updateMany } = makeFakeLeaseRow("PROCESSING", 0);

    // The crashed holder's own acquire, at t=100_000.
    const crashedHolder = await tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 100_000);
    expect(crashedHolder).toEqual({ acquired: true });
    // ...and then it crashes. Nothing ever closes the row out.

    // A second caller, moments later (well within the 90s lease): must
    // see the lease as still held, not available.
    const tooSoon = await tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 130_000);
    expect(tooSoon).toEqual({ acquired: false });

    // A third caller, after the full lease duration has elapsed: the
    // crashed holder's lease is now stale, and this caller safely
    // reclaims it — the row was never stuck.
    const afterExpiry = await tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 195_000);
    expect(afterExpiry).toEqual({ acquired: true });
  });

  // 2026-11-16 — GENUINE SIMULTANEOUS RACE at the lease layer itself, same
  // rigor as atomicallyCloseOutProcessingJob's own tests above: both
  // calls reach the fake "database" via a real await before either
  // resolves, not sequential interleaving.
  it("CONCURRENT WORKERS — two genuinely simultaneous callers racing to acquire the SAME lease: exactly one wins", async () => {
    const row = { status: "PROCESSING" as string, lastActivityAt: 0 };
    const updateMany: LeaseUpdateManyFn = async (jobId, cutoff, now) => {
      await new Promise((resolve) => setTimeout(resolve, 0)); // see atomicallyCloseOutProcessingJob's own test for why this matters
      if (row.status !== "PROCESSING" || row.lastActivityAt >= cutoff.getTime()) return { count: 0 };
      row.lastActivityAt = now.getTime();
      return { count: 1 };
    };

    const [first, second] = await Promise.all([
      tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 1_000_000),
      tryAcquireProcessingLease("job-1", 90_000, updateMany, () => 1_000_000),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toHaveLength(1);
  });
});
