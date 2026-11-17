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
    useLoaderData: vi.fn(() => ({ cards: [], hasProfile: false })),
    useLocation: vi.fn(() => ({ pathname: "/trends/my-edits" })),
    UNSAFE_withComponentProps: (c: unknown) => c,
  };
});

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/editorial-reports.server", () => {
  const getPublishedEditorialReports = vi.fn().mockResolvedValue([
    {
      slug: "spring-2026-soft-structure",
      title: "Spring 2026 Soft Structure",
      season: "Spring 2026",
      publishedAt: "2026-06-30",
      summary: "A nAia edit on softened tailoring.",
      published: true,
    },
    {
      slug: "modern-tailoring-spring-2026",
      title: "Modern Tailoring",
      season: "Spring 2026",
      publishedAt: "2026-06-29",
      summary: "Tailoring becomes more fluid.",
      published: true,
    },
  ]);
  return {
    getPublishedEditorialReports,
    // trends.my-edits.tsx calls the QA-preview wrapper, not the plain
    // getter directly (see #23's customer-restricted fixture design in
    // editorial-reports.server.ts). Every test in this file drives the
    // result via getPublishedEditorialReports's own mock, so this just
    // delegates to the same mock rather than needing its own.
    getPublishedEditorialReportsForQaPreview: (..._args: unknown[]) =>
      getPublishedEditorialReports(),
  };
});

vi.mock("~/lib/trend-evidence.server", () => ({
  getShopperEvidence: vi.fn(),
  buildShopperEdit: vi.fn(),
}));

// Fixed "now" so isCurrentPeriod assertions never depend on the real wall clock.
vi.mock("~/lib/plan/usage-window.server", () => ({
  getUsageWindow: vi.fn(() => ({ periodKey: "2026-11" })),
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
import { useLoaderData, RouterContextProvider } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getPublishedEditorialReports } from "~/lib/editorial-reports.server";
import { getShopperEvidence, buildShopperEdit } from "~/lib/trend-evidence.server";
import MyTrendEdits, { loader } from "./trends.my-edits";

// ── Loader tests ──────────────────────────────────────────────────────────────

describe("trends/my-edits loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to login when not authenticated", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/auth/login" },
    });
    vi.mocked(requireCurrentNaiaCustomer).mockRejectedValueOnce(redirect);

    await expect(
      loader({ request: new Request("http://localhost/trends/my-edits"), params: {}, context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits") })
    ).rejects.toBe(redirect);
  });

  it("calls getShopperEvidence once with the customer id", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(getShopperEvidence).toHaveBeenCalledOnce();
    expect(getShopperEvidence).toHaveBeenCalledWith("cust-1");
  });

  it("returns only published reports when profile is incomplete, grouped by month", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    // Both fixture reports are dated 2026-06 — one group, two cards.
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].cards).toHaveLength(2);
    expect(result.hasProfile).toBe(false);
    expect(result.groups[0].cards.every((c) => c.subTitle === null)).toBe(true);
  });

  // 2026-11-14 edition-month correction: three reports that would ALL fall
  // under the same publishedAt month (the authoring-date artifact that
  // caused the original bug) must still split into three genuinely
  // different editions once each has its own real editionMonth — proving
  // the loader groups/sorts by the effective edition period, not the raw
  // publishedAt date.
  it("groups three reports with the same publishedAt but different editionMonths into three separate editions, newest edition first", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      {
        slug: "spring-2026-soft-structure", title: "Soft Structure", season: "Spring 2026",
        publishedAt: "2026-06-30", editionMonth: "2026-04", summary: "s", published: true,
      },
      {
        slug: "modern-tailoring-spring-2026", title: "Modern Tailoring", season: "Spring 2026",
        publishedAt: "2026-06-30", editionMonth: "2026-05", summary: "s", published: true,
      },
      {
        slug: "spring-2026-colour-direction", title: "Colour Direction", season: "Spring 2026",
        publishedAt: "2026-06-30", editionMonth: "2026-06", summary: "s", published: true,
      },
    ] as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((g) => g.periodKey)).toEqual(["2026-06", "2026-05", "2026-04"]);
    expect(result.groups[0].cards).toEqual([expect.objectContaining({ slug: "spring-2026-colour-direction" })]);
    expect(result.groups[1].cards).toEqual([expect.objectContaining({ slug: "modern-tailoring-spring-2026" })]);
    expect(result.groups[2].cards).toEqual([expect.objectContaining({ slug: "spring-2026-soft-structure" })]);
  });

  it("groups two reports sharing one editionMonth as same-edition siblings, even with different publishedAt values", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      {
        slug: "june-primary", title: "June Primary", season: "Summer 2026",
        publishedAt: "2026-01-01", editionMonth: "2026-06", summary: "s", published: true,
      },
      {
        slug: "june-supporting", title: "June Supporting", season: "Summer 2026",
        publishedAt: "2026-09-15", editionMonth: "2026-06", summary: "s", published: true,
      },
    ] as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].periodKey).toBe("2026-06");
    expect(result.groups[0].cards.map((c) => c.slug)).toEqual(["june-primary", "june-supporting"]);
  });

  it("falls back to publishedAt's own month for a report with no editionMonth (a pre-existing DB row)", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      {
        slug: "legacy-row", title: "Legacy Row", season: "Spring 2026",
        publishedAt: "2026-03-15", summary: "s", published: true,
      },
    ] as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].periodKey).toBe("2026-03");
    expect(result.groups[0].monthLabel).toBe("March 2026");
  });

  it("calls buildShopperEdit for each published report when profile is complete", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: true } as any);
    vi.mocked(buildShopperEdit)
      .mockReturnValueOnce({ subTitle: "Your clean read of this direction." } as any)
      .mockReturnValueOnce({ subTitle: "Tailoring reads differently for your register." } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(buildShopperEdit).toHaveBeenCalledTimes(2);
    expect(result.hasProfile).toBe(true);
    expect(result.groups[0].cards[0].subTitle).toBe("Your clean read of this direction.");
    expect(result.groups[0].cards[1].subTitle).toBe("Tailoring reads differently for your register.");
  });

  it("does NOT call buildShopperEdit when profile is incomplete", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(buildShopperEdit).not.toHaveBeenCalled();
  });

  it("falls back to null subTitle if buildShopperEdit throws for a report", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: true } as any);
    vi.mocked(buildShopperEdit)
      .mockImplementationOnce(() => { throw new Error("unexpected"); })
      .mockReturnValueOnce({ subTitle: "Tailoring reads differently." } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups[0].cards[0].subTitle).toBeNull();
    expect(result.groups[0].cards[1].subTitle).toBe("Tailoring reads differently.");
  });

  it("derives an accurate month/year label from each report's own publishedAt", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    // Both fixture reports are dated in 2026-06 — the label must reflect
    // their REAL publishedAt, never the "Spring 2026" season string.
    expect(result.groups[0].monthLabel).toBe("June 2026");
    expect(result.groups[0].cards[0].monthLabel).toBe("June 2026");
    expect(result.groups[0].cards[1].monthLabel).toBe("June 2026");
  });

  it("marks a group as isCurrentPeriod only when its month matches the real current period", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    // getUsageWindow is mocked to periodKey "2026-11"; both fixtures are "2026-06" — not current.
    expect(result.groups[0].isCurrentPeriod).toBe(false);
  });

  it("marks a group isCurrentPeriod=true when its month genuinely matches the mocked current month", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      {
        slug: "november-2026-edit",
        title: "November Edit",
        season: "Autumn/Winter 2026",
        publishedAt: "2026-11-03",
        summary: "A new monthly edit.",
        published: true,
      } as any,
    ]);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups[0].monthLabel).toBe("November 2026");
    expect(result.groups[0].isCurrentPeriod).toBe(true);
  });

  it("falls back to the raw string for a malformed publishedAt instead of throwing", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      {
        slug: "undated-edit",
        title: "Undated Edit",
        season: "Unknown",
        publishedAt: "",
        summary: "No date set.",
        published: true,
      } as any,
    ]);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups[0].monthLabel).toBe("Undated");
    expect(result.groups[0].isCurrentPeriod).toBe(false);
  });

  it("puts three reports from three DIFFERENT months in three separate groups", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      { slug: "nov-edit", title: "Nov", season: "Winter", publishedAt: "2026-11-05", summary: "", published: true } as any,
      { slug: "oct-edit", title: "Oct", season: "Autumn", publishedAt: "2026-10-05", summary: "", published: true } as any,
      { slug: "sep-edit", title: "Sep", season: "Summer", publishedAt: "2026-09-05", summary: "", published: true } as any,
    ]);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((g) => g.cards.length)).toEqual([1, 1, 1]);
    expect(result.groups.map((g) => g.monthLabel)).toEqual(["November 2026", "October 2026", "September 2026"]);
  });

  it("puts two reports from the SAME month in one group, not two separate groups", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      { slug: "june-a", title: "June A", season: "Spring", publishedAt: "2026-06-30", summary: "", published: true } as any,
      { slug: "june-b", title: "June B", season: "Spring", publishedAt: "2026-06-29", summary: "", published: true } as any,
    ]);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].cards.map((c) => c.slug)).toEqual(["june-a", "june-b"]);
  });

  it("a month with a report sandwiched between two other months still gets its own group (date order is the only grouping key, never just the month label)", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([
      { slug: "nov-edit", title: "Nov", season: "Winter", publishedAt: "2026-11-05", summary: "", published: true } as any,
      { slug: "oct-edit", title: "Oct", season: "Autumn", publishedAt: "2026-10-05", summary: "", published: true } as any,
      { slug: "sep-edit", title: "Sep", season: "Summer", publishedAt: "2026-09-05", summary: "", published: true } as any,
    ]);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL("http://localhost/trends/my-edits"),
    });

    // Newest-first order preserved, each distinct month its own group —
    // months in a date-sorted list are necessarily contiguous, so this also
    // confirms grouping never looks ahead/behind past a different month.
    expect(result.groups.map((g) => g.cards.map((c) => c.slug))).toEqual([["nov-edit"], ["oct-edit"], ["sep-edit"]]);
  });
});

// ── Component tests — complete profile ───────────────────────────────────────

describe("MyTrendEdits component — complete profile", () => {
  const COMPLETE_DATA = {
    hasProfile: true,
    groups: [
      {
        periodKey: "2026-06",
        monthLabel: "June 2026",
        isCurrentPeriod: false,
        cards: [
          {
            slug: "spring-2026-soft-structure",
            title: "Spring 2026 Soft Structure",
            season: "Spring 2026",
            subTitle: "Your clean-polished register makes this a strong direction for you.",
            monthLabel: "June 2026",
            isCurrentPeriod: false,
          },
          {
            slug: "modern-tailoring-spring-2026",
            title: "Modern Tailoring",
            season: "Spring 2026",
            subTitle: "Tailoring reads differently for your wardrobe register.",
            monthLabel: "June 2026",
            isCurrentPeriod: false,
          },
        ],
      },
    ],
  };

  beforeEach(() => vi.clearAllMocks());

  it("renders inside MyNaiaLayout", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("my-naia-layout");
  });

  it("shows personalised subTitle for each card, not the public summary", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("Your clean-polished register makes this a strong direction for you.");
    expect(html).toContain("Tailoring reads differently for your wardrobe register.");
    // Public summaries must not appear
    expect(html).not.toContain("A nAia edit on softened tailoring.");
    expect(html).not.toContain("Tailoring becomes more fluid.");
  });

  it("links each card to /trends/my-edits/:slug", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain('href="/trends/my-edits/spring-2026-soft-structure"');
    expect(html).toContain('href="/trends/my-edits/modern-tailoring-spring-2026"');
  });

  it("shows 'Open My Edit' CTA when subTitle is available", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("Open My Edit");
  });

  it("does not show the passport banner when profile is complete", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).not.toContain("style passport incomplete");
    expect(html).not.toContain("Complete My Passport");
  });

  it("does not show the locked state copy when subTitle is present", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).not.toContain("Complete your Style Passport to unlock your edit.");
  });

  it("does not render any professional lens navigation", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(COMPLETE_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).not.toContain("/lens/");
    expect(html).not.toContain("Creative Director");
    expect(html).not.toContain("Marketer");
    expect(html).not.toContain("Buyer");
  });
});

// ── Component tests — incomplete profile ─────────────────────────────────────

describe("MyTrendEdits component — incomplete profile", () => {
  const LOCKED_DATA = {
    hasProfile: false,
    groups: [
      {
        periodKey: "2026-06",
        monthLabel: "June 2026",
        isCurrentPeriod: false,
        cards: [
          {
            slug: "spring-2026-soft-structure",
            title: "Spring 2026 Soft Structure",
            season: "Spring 2026",
            subTitle: null,
            monthLabel: "June 2026",
            isCurrentPeriod: false,
          },
          {
            slug: "modern-tailoring-spring-2026",
            title: "Modern Tailoring",
            season: "Spring 2026",
            subTitle: null,
            monthLabel: "June 2026",
            isCurrentPeriod: false,
          },
        ],
      },
    ],
  };

  beforeEach(() => vi.clearAllMocks());

  it("shows the passport banner", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(LOCKED_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("style passport incomplete");
    expect(html).toContain('href="/passport"');
  });

  it("shows the locked state copy on each card", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(LOCKED_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("Complete your Style Passport to unlock your edit.");
  });

  it("does not show any personalised subTitle", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(LOCKED_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).not.toContain("Your clean-polished register");
    expect(html).not.toContain("Open My Edit");
  });

  it("does not show public report summaries as if they were personalised", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(LOCKED_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    // Public summary text must not appear — cards show only locked copy
    expect(html).not.toContain("A nAia edit on softened tailoring.");
    expect(html).not.toContain("Tailoring becomes more fluid.");
  });

  it("cards still link to the detail page (which handles the incomplete state)", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(LOCKED_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain('href="/trends/my-edits/spring-2026-soft-structure"');
    expect(html).toContain('href="/trends/my-edits/modern-tailoring-spring-2026"');
  });
});

// ── Component tests — QA fix (2026-11-13): current-month featured + archive ──

// Extracts the <a ...> tag whose href matches, regardless of attribute
// order (React renders href before class), and returns its class value.
function classOfLinkTo(html: string, href: string): string | null {
  const escaped = href.replace(/\//g, "\\/");
  const tagMatch = html.match(new RegExp(`<a [^>]*href="${escaped}"[^>]*>`));
  if (!tagMatch) return null;
  return tagMatch[0].match(/class="([^"]*)"/)?.[1] ?? null;
}

describe("MyTrendEdits component — current-month-featured / previous-editions split", () => {
  const THREE_CARDS_DATA = {
    hasProfile: true,
    // Three DIFFERENT months — each its own group of one card. isCurrentPeriod:true
    // only on the newest group, matching a real on-schedule month.
    groups: [
      { periodKey: "2026-11", monthLabel: "November 2026", isCurrentPeriod: true, cards: [
        { slug: "newest-edit", title: "Newest Edit", season: "Winter 2026", subTitle: "Your newest read.", monthLabel: "November 2026", isCurrentPeriod: true },
      ] },
      { periodKey: "2026-10", monthLabel: "October 2026", isCurrentPeriod: false, cards: [
        { slug: "mid-edit", title: "Mid Edit", season: "Autumn 2026", subTitle: "Your mid read.", monthLabel: "October 2026", isCurrentPeriod: false },
      ] },
      { periodKey: "2026-09", monthLabel: "September 2026", isCurrentPeriod: false, cards: [
        { slug: "oldest-edit", title: "Oldest Edit", season: "Summer 2026", subTitle: "Your oldest read.", monthLabel: "September 2026", isCurrentPeriod: false },
      ] },
    ],
  };

  beforeEach(() => vi.clearAllMocks());

  it("the newest (first) card renders as the featured block — distinct styling from the archive grid", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(THREE_CARDS_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(classOfLinkTo(html, "/trends/my-edits/newest-edit")).toBe("tme-card tme-featured");
  });

  it("the remaining cards render in the archive grid, not as featured", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(THREE_CARDS_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(classOfLinkTo(html, "/trends/my-edits/mid-edit")).toBe("tme-card");
    expect(classOfLinkTo(html, "/trends/my-edits/oldest-edit")).toBe("tme-card");
  });

  it("shows a 'Previous editions' section label when an archive exists", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(THREE_CARDS_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("Previous editions");
  });

  it("labels the featured card 'This month's edit' with its real month when isCurrentPeriod is true", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(THREE_CARDS_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("This month&#x27;s edit — November 2026");
  });

  it("never claims 'this month' for a featured card whose own month has already passed", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      ...THREE_CARDS_DATA,
      groups: THREE_CARDS_DATA.groups.map((g) => ({ ...g, isCurrentPeriod: false, cards: g.cards.map((c) => ({ ...c, isCurrentPeriod: false })) })),
    });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).not.toContain("This month&#x27;s edit");
    expect(html).toContain("Latest edit — November 2026");
  });

  it("shows each card's own accurate month/year label, not the season string, in its eyebrow", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(THREE_CARDS_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("November 2026");
    expect(html).toContain("October 2026");
    expect(html).toContain("September 2026");
  });

  it("every card's own content (title, subtitle, CTA) is still correct regardless of featured/archive position", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce(THREE_CARDS_DATA);
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("Your newest read.");
    expect(html).toContain("Your mid read.");
    expect(html).toContain("Your oldest read.");
  });

  it("exactly one card — renders featured only, no 'Previous editions' section at all", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      hasProfile: true,
      groups: [{ periodKey: "2026-11", monthLabel: "November 2026", isCurrentPeriod: true, cards: [
        { slug: "only-edit", title: "Only Edit", season: "Winter 2026", subTitle: "Your only read.", monthLabel: "November 2026", isCurrentPeriod: true },
      ] }],
    });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(classOfLinkTo(html, "/trends/my-edits/only-edit")).toBe("tme-card tme-featured");
    expect(html).not.toContain("Previous editions");
  });

  it("locked (incomplete-profile) state still applies correctly to both the featured card and the archive", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      hasProfile: false,
      groups: [
        { periodKey: "2026-11", monthLabel: "November 2026", isCurrentPeriod: true, cards: [
          { slug: "newest-edit", title: "Newest Edit", season: "Winter 2026", subTitle: null, monthLabel: "November 2026", isCurrentPeriod: true },
        ] },
        { periodKey: "2026-10", monthLabel: "October 2026", isCurrentPeriod: false, cards: [
          { slug: "mid-edit", title: "Mid Edit", season: "Autumn 2026", subTitle: null, monthLabel: "October 2026", isCurrentPeriod: false },
        ] },
      ],
    });
    const html = renderToString(React.createElement(MyTrendEdits));
    // Both the featured card and the archive card show the same locked copy.
    expect(html.match(/Complete your Style Passport to unlock your edit\./g)?.length).toBe(2);
  });

  // ── QA fix (2026-11-14): same-month siblings, not fake separate editions ────

  it("two reports from the SAME month: one featured, the other shown as a sibling — never as a separate 'previous edition'", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      hasProfile: true,
      groups: [
        { periodKey: "2026-06", monthLabel: "June 2026", isCurrentPeriod: false, cards: [
          { slug: "june-a", title: "June A", season: "Spring 2026", subTitle: "Read A.", monthLabel: "June 2026", isCurrentPeriod: false },
          { slug: "june-b", title: "June B", season: "Spring 2026", subTitle: "Read B.", monthLabel: "June 2026", isCurrentPeriod: false },
        ] },
      ],
    });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(classOfLinkTo(html, "/trends/my-edits/june-a")).toBe("tme-card tme-featured");
    expect(classOfLinkTo(html, "/trends/my-edits/june-b")).toBe("tme-card");
    expect(html).toContain("Also published in");
    expect(html).toContain("June 2026");
    expect(html).not.toContain("Previous editions");
  });

  it("three reports from the SAME month and nothing older: no 'Previous editions' section exists at all", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      hasProfile: true,
      groups: [
        { periodKey: "2026-06", monthLabel: "June 2026", isCurrentPeriod: false, cards: [
          { slug: "june-a", title: "June A", season: "Spring 2026", subTitle: "Read A.", monthLabel: "June 2026", isCurrentPeriod: false },
          { slug: "june-b", title: "June B", season: "Spring 2026", subTitle: "Read B.", monthLabel: "June 2026", isCurrentPeriod: false },
          { slug: "june-c", title: "June C", season: "Spring 2026", subTitle: "Read C.", monthLabel: "June 2026", isCurrentPeriod: false },
        ] },
      ],
    });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).not.toContain("Previous editions");
    expect(html).toContain("Also published in");
    expect(html).toContain("June 2026");
    // Both siblings present, not just the first.
    expect(html).toContain("Read B.");
    expect(html).toContain("Read C.");
  });

  it("a genuinely older month still appears as a real archive entry, labelled with its own month — once there IS newer content", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({
      hasProfile: true,
      groups: [
        { periodKey: "2026-11", monthLabel: "November 2026", isCurrentPeriod: true, cards: [
          { slug: "nov-edit", title: "November Edit", season: "Winter 2026", subTitle: "New month.", monthLabel: "November 2026", isCurrentPeriod: true },
        ] },
        { periodKey: "2026-06", monthLabel: "June 2026", isCurrentPeriod: false, cards: [
          { slug: "june-a", title: "June A", season: "Spring 2026", subTitle: "Read A.", monthLabel: "June 2026", isCurrentPeriod: false },
          { slug: "june-b", title: "June B", season: "Spring 2026", subTitle: "Read B.", monthLabel: "June 2026", isCurrentPeriod: false },
        ] },
      ],
    });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("Previous editions");
    expect(classOfLinkTo(html, "/trends/my-edits/june-a")).toBe("tme-card");
    expect(classOfLinkTo(html, "/trends/my-edits/june-b")).toBe("tme-card");
    // The archived month's own two reports are both still grouped under one June 2026 label.
    expect(html.match(/June 2026/g)?.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Component tests — no reports ─────────────────────────────────────────────

describe("MyTrendEdits component — no published reports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders editorial empty state", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({ groups: [], hasProfile: false });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("your trend edits");
    expect(html).toContain("are on their way.");
    expect(html).toContain('href="/passport"');
  });
});
