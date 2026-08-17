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
    })),
    useLocation: vi.fn(() => ({ pathname: "/trends/my-edits/spring-2026-soft-structure" })),
    UNSAFE_withComponentProps: (c: unknown) => c,
  };
});

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/trend-reports", () => ({
  trendReports: [
    {
      slug: "spring-2026-soft-structure",
      title: "Spring 2026 Soft Structure",
      season: "Spring 2026",
      summary: "A nAia edit on softened tailoring.",
      published: true,
      publishedAt: "2026-06-30",
    },
  ],
}));

vi.mock("~/lib/trend-evidence.server", () => ({
  getShopperEvidence: vi.fn(),
  buildShopperEdit: vi.fn(),
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
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).toContain("Your style DNA says");
    expect(html).toContain("Your Passport says");
    expect(html).toContain(MOCK_EDIT.evidenceStyleDna);
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
    });
    const html = renderToString(React.createElement(MyTrendEditDetail));
    expect(html).not.toContain("Your nAia evidence");
  });
});
