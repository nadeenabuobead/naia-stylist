// app/routes/personalised-trend-edit-v1.test.ts
//
// Personalised Trend Edit V1 closeout. The feature already existed, live,
// before this lane (trends.my-edits.tsx + trends.my-edits.$slug.tsx +
// trend-evidence.server.ts) — the real gap this lane closes is membership
// enforcement (previously ANY authenticated customer, MEMBER or NONE, could
// open a full personalised edit) and an honest, non-fabricated usage-
// completion signal. See app/lib/trend-evidence.explicit-truth.test.ts for
// the explicit-Passport-truth-precedence tests (3, 4, 5, 6) that exercise
// the real, unmocked buildShopperEdit() against real report content.
//
// This file covers the remaining required scenarios: membership gating (1,
// 2), the usage-event completion signal (11, 12), ownership/boundary
// guarantees (13), the no-fabrication / fail-safe paths (9, 10), the taste-
// evidence non-coupling boundary (7), canonical content-source reuse (8),
// and the public/free-unmetered boundary (14).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function route(rel: string): string {
  return readFileSync(join(__dirname, rel), "utf8");
}

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/editorial-reports.server", () => ({
  getEditorialReportBySlug: vi.fn(),
  getPublishedEditorialReports: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/trend-evidence.server", () => ({
  getShopperEvidence: vi.fn(),
  buildShopperEdit: vi.fn(),
}));

vi.mock("~/lib/trend-product-recommendation.server", () => ({
  matchNadineProduct: vi.fn(() => null),
}));

vi.mock("~/lib/plan/entitlement.server", () => ({
  checkEntitlement: vi.fn(),
}));

vi.mock("~/lib/plan/personalised-trend-edit-usage.server", () => ({
  recordPersonalisedTrendEditUsage: vi.fn().mockResolvedValue(undefined),
  getTrendEditUsageState: vi.fn().mockResolvedValue({ status: "none" }),
}));

vi.mock("~/lib/plan/usage-window.server", () => ({
  getUsageWindow: vi.fn(() => ({
    start: new Date("2026-10-01T00:00:00.000Z"),
    end: new Date("2026-11-01T00:00:00.000Z"),
    label: "October 2026",
    periodKey: "2026-10",
  })),
}));

vi.mock("~/lib/ai/journey-events.server", () => ({
  emitTrendEditGenerated: vi.fn((p: any) => ({ type: "trend_edit_generated", payload: p })),
  recordJourneyEventAwaited: vi.fn().mockResolvedValue({ created: true }),
  hashCustomerId: vi.fn((id: string) => `hash-${id}`),
}));

vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "/styles.css" }));

vi.mock("~/components/my-naia/MyNaiaLayout", () => ({
  default: ({ children }: { children: unknown }) => children,
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getEditorialReportBySlug, getPublishedEditorialReports } from "~/lib/editorial-reports.server";
import { getShopperEvidence, buildShopperEdit } from "~/lib/trend-evidence.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { recordPersonalisedTrendEditUsage, getTrendEditUsageState } from "~/lib/plan/personalised-trend-edit-usage.server";
import { recordJourneyEventAwaited } from "~/lib/ai/journey-events.server";
import { loader } from "./trends.my-edits.$slug";

const REPORT = {
  slug: "spring-2026-soft-structure",
  title: "Spring 2026 Soft Structure",
  season: "Spring 2026",
  summary: "A nAia edit on softened tailoring.",
  published: true,
  publishedAt: "2026-06-30",
};

const MOCK_EDIT = { subTitle: "Your read", yourVersion: "...", evidenceClosetItems: [] };

function makeCustomer(membershipStatus: "NONE" | "MEMBER" = "MEMBER") {
  return { id: "cust-1", membershipStatus } as any;
}

function callLoader(slug = "spring-2026-soft-structure") {
  return loader({
    request: new Request(`http://localhost/trends/my-edits/${slug}`),
    params: { slug },
    context: {},
  } as any);
}

describe("§TREND-EDIT-V1 — membership gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
  });
  afterEach(() => {
    delete process.env.ENTITLEMENT_ENFORCEMENT;
  });

  it("1. an authenticated MEMBER sees the personalised edit when enforcement is on and entitled", async () => {
    process.env.ENTITLEMENT_ENFORCEMENT = "true";
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer("MEMBER"));
    vi.mocked(checkEntitlement).mockResolvedValue({ allowed: true });
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);

    const result: any = await callLoader();
    expect(result.membershipRequired).toBe(false);
    expect(result.edit).toEqual(MOCK_EDIT);
    expect(checkEntitlement).toHaveBeenCalledWith("cust-1", "MEMBER", "personalisedTrend");
  });

  it("2a. an unauthenticated (anonymous) request never reaches a personalised result — requireCurrentNaiaCustomer gate", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    vi.mocked(requireCurrentNaiaCustomer).mockRejectedValue(redirect);
    await expect(callLoader()).rejects.toBe(redirect);
    expect(getShopperEvidence).not.toHaveBeenCalled();
  });

  it("2b. an authenticated NONE (non-member) customer cannot access the member-only result when enforcement is on", async () => {
    process.env.ENTITLEMENT_ENFORCEMENT = "true";
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer("NONE"));
    vi.mocked(checkEntitlement).mockResolvedValue({ allowed: false, reason: "quota_exceeded" });

    const result: any = await callLoader();
    expect(result.membershipRequired).toBe(true);
    expect(result.edit).toBeNull();
    // 10. no fabricated personalization for a blocked customer — Closet/Passport
    // are never even read, so nothing could be fabricated from them either.
    expect(getShopperEvidence).not.toHaveBeenCalled();
  });

  it("enforcement flag off (default/production today) preserves exact legacy behavior — no gate at all", async () => {
    // ENTITLEMENT_ENFORCEMENT intentionally left unset.
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer("NONE"));
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);

    const result: any = await callLoader();
    expect(checkEntitlement).not.toHaveBeenCalled();
    expect(result.membershipRequired).toBe(false);
    expect(result.edit).toEqual(MOCK_EDIT);
  });
});

describe("§TREND-EDIT-V1 — no fabricated personalization / fail-safe paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
  });

  it("9. missing/unknown slug fails safely — 404, no crash", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(null);
    await expect(callLoader("does-not-exist")).rejects.toMatchObject({ status: 404 });
  });

  it("10. incomplete Passport never fabricates a verdict — edit stays null, not a synthesized stand-in", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: false, closetItems: [] } as any);

    const result: any = await callLoader();
    expect(result.edit).toBeNull();
    expect(buildShopperEdit).not.toHaveBeenCalled();
  });
});

describe("§TREND-EDIT-V1 — usage completion signal (analytics only, never quota math)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
  });

  it("11a. a genuine completed edit records the usage-completion event", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);

    await callLoader();
    expect(recordJourneyEventAwaited).toHaveBeenCalledTimes(1);
  });

  it("11b. a locked (no-profile) state never records a usage-completion event — nothing genuine happened", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: false, closetItems: [] } as any);
    await callLoader();
    expect(recordJourneyEventAwaited).not.toHaveBeenCalled();
  });

  it("11c. a failed generation never records a usage-completion event", async () => {
    vi.mocked(getShopperEvidence).mockRejectedValue(new Error("db error"));
    await callLoader();
    expect(recordJourneyEventAwaited).not.toHaveBeenCalled();
  });

  it("12. refresh/reload cannot double-count — the idempotency key is identical across repeated genuine completions for the same customer+report+month", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);

    await callLoader();
    await callLoader();

    expect(recordJourneyEventAwaited).toHaveBeenCalledTimes(2);
    const key1 = vi.mocked(recordJourneyEventAwaited).mock.calls[0][1];
    const key2 = vi.mocked(recordJourneyEventAwaited).mock.calls[1][1];
    expect(key1).toBe(key2);
    // The unique-constraint enforcement itself (P2002 -> created:false) is
    // exercised by recordJourneyEventAwaited's own tests; this test proves
    // the necessary precondition — a stable, deterministic key — holds here.
  });

  it("the idempotency key varies by report slug — two different genuine edits for the same customer never collide", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    const otherReport = { ...REPORT, slug: "modern-tailoring-spring-2026" };

    await callLoader("spring-2026-soft-structure");
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(otherReport as any);
    await callLoader("modern-tailoring-spring-2026");

    const key1 = vi.mocked(recordJourneyEventAwaited).mock.calls[0][1];
    const key2 = vi.mocked(recordJourneyEventAwaited).mock.calls[1][1];
    expect(key1).not.toBe(key2);
  });
});

describe("§TREND-EDIT-V1 — canonical usage recording (PersonalisedTrendEditUsage, the entitlement/Plan&Usage source of truth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
  });

  it("1. a genuine completed edit records exactly one usage row", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    await callLoader();
    expect(recordPersonalisedTrendEditUsage).toHaveBeenCalledTimes(1);
    // Third arg is the Trend Edit snapshot (see §C360.13 in customer-360.test.ts
    // for the admin-side read path) — asserted loosely here since this test's
    // focus is the usage-recording call itself, not the snapshot's shape.
    expect(recordPersonalisedTrendEditUsage).toHaveBeenCalledWith("cust-1", REPORT.slug, expect.objectContaining({ reportSlug: REPORT.slug }));
  });

  it("the recorded snapshot captures the exact generated edit, report title/slug, and nadineRecommendation", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    await callLoader();
    const [, , snapshot] = vi.mocked(recordPersonalisedTrendEditUsage).mock.calls[0];
    expect(snapshot).toMatchObject({
      schemaVersion: "trend-edit-snapshot-v1",
      reportSlug: REPORT.slug,
      reportTitle: REPORT.title,
      edit: MOCK_EDIT,
      nadineRecommendation: null,
    });
    expect(typeof snapshot!.generatedAt).toBe("string");
  });

  it("6. a public Trend Report view never calls the usage writer — it is only ever invoked from this (member) loader", () => {
    const publicSrc = route("trends.jsx");
    const publicDetailSrc = route("trends.$slug.tsx");
    expect(publicSrc).not.toMatch(/recordPersonalisedTrendEditUsage/);
    expect(publicDetailSrc).not.toMatch(/recordPersonalisedTrendEditUsage/);
  });

  it("7. generation failure records no usage", async () => {
    vi.mocked(getShopperEvidence).mockRejectedValue(new Error("db error"));
    await callLoader();
    expect(recordPersonalisedTrendEditUsage).not.toHaveBeenCalled();
  });

  it("8. a missing/incomplete profile records no usage", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: false, closetItems: [] } as any);
    await callLoader();
    expect(recordPersonalisedTrendEditUsage).not.toHaveBeenCalled();
  });

  it("9. a membership-blocked path records no usage", async () => {
    process.env.ENTITLEMENT_ENFORCEMENT = "true";
    vi.mocked(checkEntitlement).mockResolvedValue({ allowed: false, reason: "quota_exceeded" });
    await callLoader();
    expect(recordPersonalisedTrendEditUsage).not.toHaveBeenCalled();
    delete process.env.ENTITLEMENT_ENFORCEMENT;
  });

  it("10. an unpublished/missing report (404) records no usage", async () => {
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(null);
    await expect(callLoader("does-not-exist")).rejects.toMatchObject({ status: 404 });
    expect(recordPersonalisedTrendEditUsage).not.toHaveBeenCalled();
  });

});

describe("§TREND-EDIT-V1 — frozen-at-first-generation (repeat-view immutability)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "none" });
  });

  const FIRST_SNAPSHOT = {
    schemaVersion: "trend-edit-snapshot-v1" as const,
    reportSlug: REPORT.slug,
    reportTitle: REPORT.title,
    generatedAt: "2026-10-01T00:00:00.000Z",
    edit: MOCK_EDIT as any,
    nadineRecommendation: null,
  };

  it("first generation in the period persists the exact generated snapshot and renders it", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    const result = await callLoader();
    expect(result.edit).toEqual(MOCK_EDIT);
    expect(recordPersonalisedTrendEditUsage).toHaveBeenCalledWith(
      "cust-1", REPORT.slug, expect.objectContaining({ edit: MOCK_EDIT }),
    );
  });

  it("a repeat same-period view with a stored snapshot renders that stored snapshot, not a fresh one", async () => {
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "snapshotted", snapshot: FIRST_SNAPSHOT });
    const result = await callLoader();
    expect(result.edit).toEqual(FIRST_SNAPSHOT.edit);
    expect(result.hasProfile).toBe(true);
    expect(result.membershipRequired).toBe(false);
    expect(result.historicalUnavailable).toBe(false);
  });

  it("the generator (getShopperEvidence/buildShopperEdit) is never called on a repeat view with a stored snapshot", async () => {
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "snapshotted", snapshot: FIRST_SNAPSHOT });
    await callLoader();
    expect(getShopperEvidence).not.toHaveBeenCalled();
    expect(buildShopperEdit).not.toHaveBeenCalled();
  });

  it("the usage writer is never called again on a repeat view with a stored snapshot — no second generation, no second quota consumption", async () => {
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "snapshotted", snapshot: FIRST_SNAPSHOT });
    await callLoader();
    expect(recordPersonalisedTrendEditUsage).not.toHaveBeenCalled();
  });

  it("a changed Passport/Closet (different buildShopperEdit output) after first generation does not mutate what the repeat view renders", async () => {
    // Simulates: Closet/Passport changed between visits. If the loader ever
    // regenerated on repeat view, this mock would be what the customer saw —
    // it must not be, since getTrendEditUsageState already found a stored snapshot.
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [{ name: "New Item" }] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue({ subTitle: "Changed", yourVersion: "A completely different edit." } as any);
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "snapshotted", snapshot: FIRST_SNAPSHOT });

    const result = await callLoader();
    expect(result.edit).toEqual(FIRST_SNAPSHOT.edit);
    expect(result.edit).not.toEqual({ subTitle: "Changed", yourVersion: "A completely different edit." });
  });
});

describe("§TREND-EDIT-V1 — a legacy pre-snapshot row (status: legacy_no_snapshot) is NEVER regenerated or backfilled", () => {
  // This is the exact 08 Oct 2026 scenario: a generation happened this
  // calendar period before snapshot persistence existed. A collapsed
  // null-means-no-row check would treat this identically to "nothing
  // generated yet" and quietly regenerate from today's Passport/Closet,
  // fabricating history under the original row's createdAt. The required
  // behavior is the opposite: never call the generator, never call the
  // writer, and show an honest historical-unavailable state.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "legacy_no_snapshot" });
  });

  it("the generator (getShopperEvidence/buildShopperEdit) is never called", async () => {
    await callLoader();
    expect(getShopperEvidence).not.toHaveBeenCalled();
    expect(buildShopperEdit).not.toHaveBeenCalled();
  });

  it("the usage writer is never called — the row is never touched again", async () => {
    await callLoader();
    expect(recordPersonalisedTrendEditUsage).not.toHaveBeenCalled();
  });

  it("the loader returns historicalUnavailable:true with edit:null — not a regenerated edit", async () => {
    const result = await callLoader();
    expect(result.historicalUnavailable).toBe(true);
    expect(result.edit).toBeNull();
    expect(result.generationFailed).toBe(false);
    expect(result.membershipRequired).toBe(false);
  });

  it("even if evidence/builder mocks are set up to return content, nothing is generated — proves this isn't just an unset-mock accident", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    const result = await callLoader();
    expect(result.edit).toBeNull();
    expect(result.historicalUnavailable).toBe(true);
    expect(getShopperEvidence).not.toHaveBeenCalled();
  });

  it("repeated visits to the same legacy row all return the identical historical-unavailable result — it never flips to a generated edit", async () => {
    const first = await callLoader();
    const second = await callLoader();
    expect(first).toEqual(second);
    expect(first.historicalUnavailable).toBe(true);
  });
});

describe("§TREND-EDIT-V1 — a genuinely new generation (status: none) is unaffected by the legacy-row fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
    vi.mocked(getTrendEditUsageState).mockResolvedValue({ status: "none" });
  });

  it("no usage row at all still generates once and persists a real snapshot", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    const result = await callLoader();
    expect(result.edit).toEqual(MOCK_EDIT);
    expect(result.historicalUnavailable).toBe(false);
    expect(recordPersonalisedTrendEditUsage).toHaveBeenCalledTimes(1);
  });
});

describe("§TREND-EDIT-V1 — write verification (diagnosis for the 14 Oct 2026 null-snapshot report)", () => {
  // No code path was found that can produce a row existing with
  // snapshot:null for a genuine new generation — recordPersonalisedTrendEditUsage's
  // upsert always includes the snapshot in its create branch, and it is the
  // only writer in the codebase (see personalised-trend-edit-usage.test.ts's
  // repo-wide search). What WAS missing is any way to ever find out if this
  // happens again: the write call was wrapped in a bare try/catch with zero
  // logging. These tests prove the loader now verifies its own write and
  // logs loudly — in both directions, so the diagnostic itself is trustworthy.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEditorialReportBySlug).mockResolvedValue(REPORT as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValue([REPORT] as any);
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue(makeCustomer());
    vi.mocked(getShopperEvidence).mockResolvedValue({ hasProfile: true, closetItems: [] } as any);
    vi.mocked(buildShopperEdit).mockReturnValue(MOCK_EDIT as any);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("a write that verifiably persisted (read-after-write finds the snapshot) logs no error", async () => {
    vi.mocked(getTrendEditUsageState)
      .mockResolvedValueOnce({ status: "none" }) // initial read
      .mockResolvedValueOnce({ // post-write verification read
        status: "snapshotted",
        snapshot: {
          schemaVersion: "trend-edit-snapshot-v1",
          reportSlug: REPORT.slug,
          reportTitle: REPORT.title,
          generatedAt: "2026-10-14T10:47:00.000Z",
          edit: MOCK_EDIT as any,
          nadineRecommendation: null,
        },
      });
    await callLoader();
    const unverifiedLogs = consoleErrorSpy.mock.calls.filter((c) => String(c[0]).includes("trend_edit_snapshot_write_unverified"));
    expect(unverifiedLogs).toEqual([]);
  });

  it("a write that the upsert call itself throws on is logged with context — no silent swallow", async () => {
    vi.mocked(getTrendEditUsageState).mockResolvedValueOnce({ status: "none" });
    vi.mocked(recordPersonalisedTrendEditUsage).mockRejectedValueOnce(new Error("db unreachable"));
    await callLoader();
    const failedLogs = consoleErrorSpy.mock.calls.filter((c) => String(c[0]).includes("trend_edit_snapshot_write_failed"));
    expect(failedLogs.length).toBe(1);
    expect(String(failedLogs[0][0])).toContain(REPORT.slug);
  });

  it("a write the upsert call reports as successful, but a verification read still finds no snapshot, is logged loudly instead of silently accepted", async () => {
    // This is the exact shape the 14 Oct row would have produced had it
    // happened under this code: the write 'succeeds' (no thrown error) but
    // somehow the row still isn't snapshotted. Before this fix there was no
    // way to ever see that. After it, this is impossible to miss.
    vi.mocked(getTrendEditUsageState)
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValueOnce({ status: "legacy_no_snapshot" });
    await callLoader();
    const unverifiedLogs = consoleErrorSpy.mock.calls.filter((c) => String(c[0]).includes("trend_edit_snapshot_write_unverified"));
    expect(unverifiedLogs.length).toBe(1);
    expect(String(unverifiedLogs[0][0])).toContain(REPORT.slug);
    expect(String(unverifiedLogs[0][0])).toContain("status=legacy_no_snapshot");
  });

  it("the verification read never blocks or alters the response the customer sees — the generated edit still renders even if verification itself finds a problem", async () => {
    vi.mocked(getTrendEditUsageState)
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValueOnce({ status: "none" });
    const result = await callLoader();
    expect(result.edit).toEqual(MOCK_EDIT);
    expect(result.generationFailed).toBe(false);
  });
});

describe("§TREND-EDIT-V1 — ownership and lane boundaries", () => {
  it("19. the entitlement service never reads JourneyEvent for Plan & Usage or quota — only PersonalisedTrendEditUsage", () => {
    const entSrc = route("../lib/plan/entitlement.server.ts");
    // Comments are free to name JourneyEvent to explain the boundary; what
    // must never appear is an actual query against it or an import of the
    // journey-events module.
    expect(entSrc).not.toMatch(/prisma\.journeyEvent/);
    expect(entSrc).not.toMatch(/from ["']~\/lib\/ai\/journey-events/);
    expect(entSrc).toMatch(/prisma\.personalisedTrendEditUsage\.count/);
  });

  it("20. public Trend Report routes do not import the usage writer, the entitlement service, or the customer session — unmetered by construction", () => {
    const publicIndexSrc = route("trends.jsx");
    const publicDetailSrc = route("trends.$slug.tsx");
    for (const src of [publicIndexSrc, publicDetailSrc]) {
      expect(src).not.toMatch(/recordPersonalisedTrendEditUsage|checkEntitlement|requireCurrentNaiaCustomer/);
    }
  });

  it("13. the loader scopes every customer-evidence read to the authenticated session only — never to a route param or query string", () => {
    const src = route("trends.my-edits.$slug.tsx");
    // params is destructured for slug only; the only identifier ever passed
    // to getShopperEvidence/checkEntitlement is customer.id from the session.
    expect(src).toMatch(/getShopperEvidence\(customer\.id\)/);
    expect(src).not.toMatch(/getShopperEvidence\(params\./);
    expect(src).not.toMatch(/checkEntitlement\(params\./);
  });

  it("7. the personalisation path never imports Taste & Evidence / confirmed-tendency inference — V1 uses only explicit Passport + Closet truth", () => {
    const editSrc = route("../lib/trend-evidence.server.ts");
    const detailRouteSrc = route("trends.my-edits.$slug.tsx");
    const indexRouteSrc = route("trends.my-edits.tsx");
    for (const src of [editSrc, detailRouteSrc, indexRouteSrc]) {
      expect(src).not.toMatch(/taste-reconcile|taste-evidence|StyleTendency|loadConfirmedTendencies|loadStrongestConfirmedTendency/);
    }
  });

  it("8. both My Trend Edits routes read content through the canonical editorial accessors — never a second/forked content source", () => {
    const indexSrc = route("trends.my-edits.tsx");
    const detailSrc = route("trends.my-edits.$slug.tsx");
    expect(indexSrc).toMatch(/getPublishedEditorialReports/);
    expect(detailSrc).toMatch(/getEditorialReportBySlug/);
    expect(detailSrc).toMatch(/getPublishedEditorialReports/);
    // Neither route defines its own trend-content array/object.
    expect(indexSrc).not.toMatch(/const\s+trendReports\s*=/);
    expect(detailSrc).not.toMatch(/const\s+trendReports\s*=/);
  });

  it("14. the public Trend Report routes remain free, anonymous, and unmetered — no membership/entitlement/session coupling", () => {
    const publicIndexSrc = route("trends.jsx");
    const publicDetailSrc = route("trends.$slug.tsx");
    for (const src of [publicIndexSrc, publicDetailSrc]) {
      expect(src).not.toMatch(/requireCurrentNaiaCustomer|checkEntitlement|getShopperEvidence|membershipStatus/);
    }
  });
});
