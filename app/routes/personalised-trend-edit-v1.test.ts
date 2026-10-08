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

describe("§TREND-EDIT-V1 — ownership and lane boundaries", () => {
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
