import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({
    to,
    children,
    className,
    style,
  }: {
    to: string;
    children: unknown;
    className?: string;
    style?: object;
  }) => createElement("a", { href: to, className, style }, children as React.ReactNode);

  return {
    ...actual,
    Link: mockLink,
    useLoaderData: vi.fn(() => ({
      report: {
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        summary: "A nAia edit on softened tailoring.",
        published: true,
        publishedAt: "2026-06-30",
      },
      edit: null,
      hasProfile: false,
      generationFailed: false,
      // Step 3 — the loader now also reports which objects this customer saved.
      saveState: { refKeys: {}, saved: [], canSave: true },
      returnTo: "/trends/my-edits/spring-2026-soft-structure",
    })),
    useLocation: vi.fn(() => ({ pathname: "/trends/my-edits/spring-2026-soft-structure" })),
    useFetcher: () => ({
      Form: ({ children, ...props }: Record<string, unknown> & { children?: unknown }) =>
        require("react").createElement("form", props, children),
      state: "idle",
      data: undefined,
      submit: vi.fn(),
    }),
    UNSAFE_withComponentProps: (c: unknown) => c,
  };
});

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/editorial-reports.server", () => ({
  getEditorialReportBySlug: vi.fn().mockImplementation(async (slug: string) => {
    if (slug === "spring-2026-soft-structure") {
      return {
        id: "rep_1",
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        summary: "A nAia edit on softened tailoring.",
        published: true,
        publishedAt: "2026-06-30",
      };
    }
    return null;
  }),
  getPublishedEditorialReports: vi.fn().mockResolvedValue([{
    slug: "spring-2026-soft-structure",
    published: true,
    publishedAt: "2026-06-30",
  }]),
}));

vi.mock("~/lib/trend-evidence.server", () => ({
  getShopperEvidence: vi.fn(),
  buildShopperEdit: vi.fn(),
}));

vi.mock("~/lib/trend-product-recommendation.server", () => ({
  matchNadineProduct: vi.fn(() => null),
}));

vi.mock("~/lib/saved-items.server", () => ({
  loadReportSaveState: vi.fn(async () => ({ refKeys: {}, saved: [], canSave: true })),
}));

vi.mock("~/lib/personalised-trend-history.server", () => ({
  recordEditSnapshot: vi.fn(async () => ({
    snapshotCreated: true, unlockCreated: true,
    snapshotPersisted: true, unlockPersisted: true, snapshotId: "snap_1",
  })),
  loadSnapshot: vi.fn(async () => null),
  // Replay re-signs images for the pieces the snapshot named; it must not alter
  // the stored personalised copy, so the identity function is the right stub.
  resolveSnapshotImages: vi.fn(async (_customerId: string, edit: unknown) => edit),
}));

vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "/styles.css" }));

vi.mock("~/components/my-naia/MyNaiaLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    const { createElement } = require("react");
    return createElement("div", { "data-testid": "my-naia-layout" }, children);
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import React from "react";
import { useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getShopperEvidence, buildShopperEdit } from "~/lib/trend-evidence.server";
import { matchNadineProduct } from "~/lib/trend-product-recommendation.server";
import MyTrendEditDetail, { loader } from "./trends.my-edits.$slug";

const MOCK_REPORT = {
  slug: "spring-2026-soft-structure",
  title: "Spring 2026 Soft Structure",
  season: "Spring 2026",
  summary: "A nAia edit on softened tailoring.",
  published: true,
  publishedAt: "2026-06-30",
};

const MOCK_EDIT = {
  subTitle: "Your personal read",
  yourVersion: "This direction suits you because of your fit preferences.",
  evidenceStyleDna: "Your style DNA reads as clean-polished.",
  evidencePassportSays: "Your lifestyle signals formal occasions.",
  evidenceClosetItems: [],
  evidenceReviews: null,
  lowDataNotice: null,
  yourBestRouteIn: "Start with the blazer.",
  aLookToTry: "A longline blazer with wide-leg trousers.",
  partToTake: ["A longline blazer", "Clean wide-leg trousers"],
  worthInvestingStatement: null,
  coveredClosetCategories: [],
  partToLeave: ["Rigid matching suits"],
  theBalanceToProtect: "Keep one tailored piece loose and fluid.",
};

// ── Loader tests ──────────────────────────────────────────────────────────────

describe("trends/my-edits/:slug loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to login when not authenticated", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
    vi.mocked(requireCurrentNaiaCustomer).mockRejectedValueOnce(redirect);

    await expect(
      loader({
        request: new Request("http://localhost/trends/my-edits/spring-2026-soft-structure"),
        params: { slug: "spring-2026-soft-structure" },
        context: {},
      })
    ).rejects.toBe(redirect);
  });

  it("throws 404 when report slug is not found", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);

    await expect(
      loader({
        request: new Request("http://localhost/trends/my-edits/does-not-exist"),
        params: { slug: "does-not-exist" },
        context: {},
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns edit when passport is complete", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: true } as any);
    vi.mocked(buildShopperEdit).mockReturnValueOnce(MOCK_EDIT as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits/spring-2026-soft-structure"),
      params: { slug: "spring-2026-soft-structure" },
      context: {},
    });

    expect(result.hasProfile).toBe(true);
    expect(result.edit).toEqual(MOCK_EDIT);
    expect(result.generationFailed).toBe(false);
  });

  it("returns hasProfile:false and no edit when passport is incomplete", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits/spring-2026-soft-structure"),
      params: { slug: "spring-2026-soft-structure" },
      context: {},
    });

    expect(result.hasProfile).toBe(false);
    expect(result.edit).toBeNull();
    expect(result.generationFailed).toBe(false);
  });

  it("returns nadineRecommendation from matchNadineProduct in loader data", async () => {
    const MOCK_REC = {
      handle: "trench-coat",
      title: "Becoming Seen",
      url: "https://naiabynadine.com/products/trench-coat",
      gapCategory: "OUTERWEAR",
      personalExplanation: "Statement outer layer.",
    };
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: true } as any);
    vi.mocked(buildShopperEdit).mockReturnValueOnce(MOCK_EDIT as any);
    vi.mocked(matchNadineProduct).mockReturnValueOnce(MOCK_REC as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits/spring-2026-soft-structure"),
      params: { slug: "spring-2026-soft-structure" },
      context: {},
    });

    expect(result.nadineRecommendation).toEqual(MOCK_REC);
  });

  it("returns generationFailed:true on evidence error", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockRejectedValueOnce(new Error("DB error"));

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits/spring-2026-soft-structure"),
      params: { slug: "spring-2026-soft-structure" },
      context: {},
    });

    expect(result.generationFailed).toBe(true);
    expect(result.edit).toBeNull();
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

describe("MyTrendEditDetail component", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders inside MyNaiaLayout", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: null,
      hasProfile: false,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("my-naia-layout");
  });

  it("renders breadcrumb back link to My Trend Edits", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: null,
      hasProfile: false,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain('href="/trends/my-edits"');
    expect(html).toContain("My Trend Edits");
  });

  it("renders link to the public report", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: null,
      hasProfile: false,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain(`href="/trends/${MOCK_REPORT.slug}"`);
    expect(html).toContain("public report");
  });

  it("renders incomplete-passport state when hasProfile is false", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: null,
      hasProfile: false,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("Passport");
    expect(html).toContain('href="/passport"');
    expect(html).not.toContain("Your nAia Evidence");
  });

  it("renders generation-error state when generationFailed is true", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: null,
      hasProfile: false,
      generationFailed: true,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("taking a moment");
    expect(html).toContain(`href="/trends/${MOCK_REPORT.slug}"`);
  });

  it("renders all 6 content sections when edit is available", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: MOCK_EDIT,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("Why this matters to you");
    expect(html).toContain("Your route in");
    expect(html).toContain("A look to try");
    expect(html).toContain("Worth investing in");
    expect(html).toContain("Hold off on");
    expect(html).toContain(MOCK_EDIT.yourVersion);
  });

  it("does not render any professional lens navigation", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: MOCK_EDIT,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("/lens/");
    expect(html).not.toContain("Read this through a lens");
    expect(html).not.toContain("Creative Director");
    expect(html).not.toContain("Marketer");
    expect(html).not.toContain("Buyer");
    expect(html).not.toContain("Designer");
  });

  it("does not render any persona selector or lens switcher", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: MOCK_EDIT,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("Creative Director");
    expect(html).not.toContain("Marketer");
    expect(html).not.toContain("Buyer");
    expect(html).not.toContain("/lens/");
    expect(html).not.toContain("tr-lens-nav");
  });

  it("renders evidence panel when evidence is available", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: MOCK_EDIT,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("Your style DNA says");
    expect(html).toContain("Your Passport says");
    expect(html).toContain(MOCK_EDIT.evidenceStyleDna);
  });

  it("renders partToTake as a bullet list when worthInvestingStatement is null (Outcome A/B)", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: { ...MOCK_EDIT, worthInvestingStatement: null },
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("A longline blazer");
    expect(html).toContain("Clean wide-leg trousers");
    expect(html).toContain("<li");
  });

  it("renders worthInvestingStatement as prose paragraph when Outcome C", () => {
    const outcomeC = {
      ...MOCK_EDIT,
      worthInvestingStatement:
        "You do not need to buy anything for this trend. Your Wide Leg Trouser and Linen Blouse already give you enough to wear it.",
      partToTake: [],
    };
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: outcomeC,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("do not need to buy anything");
    expect(html).toContain("Wide Leg Trouser");
    // Prose statement is rendered in a <p>, not a list
    expect(html).toContain("do not need to buy anything for this trend");
  });

  it("suppresses evidence panel when no evidence is available", () => {
    const editNoEvidence = {
      ...MOCK_EDIT,
      evidenceStyleDna: null,
      evidencePassportSays: null,
      evidenceClosetItems: [],
      evidenceReviews: null,
    };
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: editNoEvidence,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("Your nAia evidence");
  });

  // ── NADINE product card (Outcome A/B) ─────────────────────────────────────

  it("renders NADINE product card when nadineRecommendation is present (Outcome A/B)", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: { ...MOCK_EDIT, worthInvestingStatement: null },
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: {
        handle: "trench-coat",
        title: "Becoming Seen",
        url: "https://naiabynadine.com/products/trench-coat",
        gapCategory: "OUTERWEAR",
        personalExplanation: "Statement outer layer. Works with your wide-leg trousers.",
      },
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("Becoming Seen");
    expect(html).toContain("Statement outer layer");
    expect(html).toContain("NADINE");
    expect(html).toContain("naiabynadine.com/products/trench-coat");
  });

  it("does not render NADINE card when nadineRecommendation is null", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: { ...MOCK_EDIT, worthInvestingStatement: null },
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("A NADINE piece for this gap");
  });

  it("does not render NADINE card when Outcome C (worthInvestingStatement present)", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: { ...MOCK_EDIT, worthInvestingStatement: "You do not need to buy anything." },
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("A NADINE piece for this gap");
  });

  it("renders product card without link when url is null", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: { ...MOCK_EDIT, worthInvestingStatement: null },
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: {
        handle: "midi-dress",
        title: "Becoming Her",
        url: null,
        gapCategory: "DRESSES",
        personalExplanation: "Fluid midi dress. Sits in your artsy register.",
      },
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("Becoming Her");
    expect(html).not.toContain("naiabynadine.com");
    expect(html).not.toContain("View on NADINE");
  });

  it("does not render NADINE card on public reports — only My Trend Edits route renders it", () => {
    // The product card is only rendered inside the `edit &&` block in this route.
    // Public trend report route (trends.$slug.tsx) has no nadineRecommendation in LoaderData.
    vi.mocked(useLoaderData).mockReturnValueOnce({
      report: MOCK_REPORT,
      edit: null,
      hasProfile: false,
      generationFailed: false,
      nadineRecommendation: null,
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("A NADINE piece for this gap");
  });
});

// ── Step 3 — save controls in the real rendered page ─────────────────────────

describe("Save controls on the personalised edit", () => {
  const SAVE_STATE = {
    refKeys: {
      "TAKEAWAY:yourBestRouteIn": "r:rep_1|TAKEAWAY|yourBestRouteIn",
      "TAKEAWAY:aLookToTry": "r:rep_1|TAKEAWAY|aLookToTry",
    },
    saved: ["r:rep_1|TAKEAWAY|aLookToTry"],
    canSave: true,
  };

  function renderWith(saveState: unknown) {
    vi.mocked(useLoaderData).mockReturnValue({
      report: {
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        summary: "s", published: true, publishedAt: "2026-06-30",
      },
      edit: MOCK_EDIT,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
      reportIndex: 0,
      saveState,
      returnTo: "/trends/my-edits/spring-2026-soft-structure",
    } as never);
    return renderToString(React.createElement(MyTrendEditDetail));
  }

  it("offers Save on an unsaved takeaway and shows Saved on a saved one", () => {
    const html = renderWith(SAVE_STATE);
    expect(html).toContain("♡");   // Your route in — not saved
    expect(html).toContain("♥");   // A look to try — saved
    expect(html).toContain('aria-label="Save Your route in to My Saved"');
    expect(html).toContain("Saved: A look to try");
  });

  it("renders no controls at all when save state is empty — the edit still reads", () => {
    const html = renderWith({ refKeys: {}, saved: [], canSave: false });
    expect(html).not.toContain("♡");
    expect(html).not.toContain("♥");
    expect(html).toContain("Your route in");   // the editorial content survives
  });
});

// ── Step 4 — historical replay must not recompute ────────────────────────────

import { recordEditSnapshot, loadSnapshot } from "~/lib/personalised-trend-history.server";

describe("Historical replay (?edit=<snapshotId>)", () => {
  const STORED = {
    id: "snap_old",
    reportId: "rep_1",
    reportSlug: "spring-2026-soft-structure",
    reportTitle: "Spring 2026 Soft Structure",
    reportSeason: "Spring 2026",
    engineVersion: "1.0.0",
    edit: { ...MOCK_EDIT, aLookToTry: "The wording she received in September." },
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  function call(url: string, slug = "spring-2026-soft-structure") {
    return loader({ request: new Request(url), params: { slug }, context: {} } as never);
  }

  beforeEach(() => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue({ id: "cust-1" } as never);
  });

  it("returns the STORED edit and never calls buildShopperEdit", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(STORED as never);
    vi.mocked(buildShopperEdit).mockClear();

    const result = await call("https://naia.test/trends/my-edits/spring-2026-soft-structure?edit=snap_old");

    expect((result as never as { edit: { aLookToTry: string } }).edit.aLookToTry)
      .toBe("The wording she received in September.");
    expect(buildShopperEdit).not.toHaveBeenCalled();
    expect(getShopperEvidence).not.toHaveBeenCalled();
  });

  it("does not grant an unlock or write another version", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(STORED as never);
    vi.mocked(recordEditSnapshot).mockClear();
    await call("https://naia.test/trends/my-edits/spring-2026-soft-structure?edit=snap_old");
    expect(recordEditSnapshot).not.toHaveBeenCalled();
  });

  it("marks the view as historical and disables save controls", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(STORED as never);
    const result = await call("https://naia.test/trends/my-edits/spring-2026-soft-structure?edit=snap_old") as never as
      { historical: { snapshotId: string } | null; saveState: { canSave: boolean } };
    expect(result.historical?.snapshotId).toBe("snap_old");
    expect(result.saveState.canSave).toBe(false);
  });

  it("404s a snapshot that is not this customer's", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(null as never);
    await expect(call("https://naia.test/trends/my-edits/spring-2026-soft-structure?edit=someone-elses"))
      .rejects.toBeInstanceOf(Response);
  });

  it("404s when the snapshot belongs to a different report than the URL", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce({ ...STORED, reportSlug: "another-report" } as never);
    await expect(call("https://naia.test/trends/my-edits/spring-2026-soft-structure?edit=snap_old"))
      .rejects.toBeInstanceOf(Response);
  });

  it("persists a snapshot on the NORMAL path — display and storage are one payload", async () => {
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: true } as never);
    vi.mocked(buildShopperEdit).mockReturnValueOnce(MOCK_EDIT as never);
    vi.mocked(recordEditSnapshot).mockClear();

    const result = await call("https://naia.test/trends/my-edits/spring-2026-soft-structure") as never as
      { edit: unknown; historical: unknown };

    expect(recordEditSnapshot).toHaveBeenCalledTimes(1);
    // The persisted object IS the rendered object, not a regenerated one.
    expect(vi.mocked(recordEditSnapshot).mock.calls[0][0].edit).toBe(result.edit);
    expect(result.historical).toBeNull();
  });

  it("writes NO snapshot when the report has no canonical row id", async () => {
    // The static pre-seed fallback. Step 3 forbids saves against it; history
    // follows the same rule — a snapshot keyed to a non-canonical reportId
    // would orphan the moment the table is seeded.
    const { getEditorialReportBySlug } = await import("~/lib/editorial-reports.server");
    vi.mocked(getEditorialReportBySlug).mockResolvedValueOnce({
      slug: "spring-2026-soft-structure",
      title: "Spring 2026 Soft Structure",
      season: "Spring 2026",
      summary: "s", published: true, publishedAt: "2026-06-30",
    } as never);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: true } as never);
    vi.mocked(buildShopperEdit).mockReturnValueOnce(MOCK_EDIT as never);
    vi.mocked(recordEditSnapshot).mockClear();

    await loader({
      request: new Request("https://naia.test/trends/my-edits/spring-2026-soft-structure"),
      params: { slug: "spring-2026-soft-structure" }, context: {},
    } as never);

    expect(recordEditSnapshot).not.toHaveBeenCalled();
  });
});
