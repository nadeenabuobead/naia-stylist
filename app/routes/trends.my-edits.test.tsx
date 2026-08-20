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

vi.mock("~/lib/trend-reports", () => ({
  trendReports: [
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
    {
      slug: "unpublished-draft",
      title: "Draft Report",
      season: "Autumn 2026",
      publishedAt: "2026-09-01",
      summary: "Not yet live.",
      published: false,
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
      loader({ request: new Request("http://localhost/trends/my-edits"), params: {}, context: {} })
    ).rejects.toBe(redirect);
  });

  it("calls getShopperEvidence once with the customer id", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: {},
    });

    expect(getShopperEvidence).toHaveBeenCalledOnce();
    expect(getShopperEvidence).toHaveBeenCalledWith("cust-1");
  });

  it("returns only published reports when profile is incomplete", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    const result = await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: {},
    });

    expect(result.cards).toHaveLength(2);
    expect(result.hasProfile).toBe(false);
    expect(result.cards.every((c: { subTitle: string | null }) => c.subTitle === null)).toBe(true);
    expect(result.cards.find((c: { slug: string }) => c.slug === "unpublished-draft")).toBeUndefined();
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
      context: {},
    });

    expect(buildShopperEdit).toHaveBeenCalledTimes(2);
    expect(result.hasProfile).toBe(true);
    expect(result.cards[0].subTitle).toBe("Your clean read of this direction.");
    expect(result.cards[1].subTitle).toBe("Tailoring reads differently for your register.");
  });

  it("does NOT call buildShopperEdit when profile is incomplete", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(getShopperEvidence).mockResolvedValueOnce({ hasProfile: false } as any);

    await loader({
      request: new Request("http://localhost/trends/my-edits"),
      params: {},
      context: {},
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
      context: {},
    });

    expect(result.cards[0].subTitle).toBeNull();
    expect(result.cards[1].subTitle).toBe("Tailoring reads differently.");
  });
});

// ── Component tests — complete profile ───────────────────────────────────────

describe("MyTrendEdits component — complete profile", () => {
  const COMPLETE_DATA = {
    hasProfile: true,
    cards: [
      {
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        subTitle: "Your clean-polished register makes this a strong direction for you.",
      },
      {
        slug: "modern-tailoring-spring-2026",
        title: "Modern Tailoring",
        season: "Spring 2026",
        subTitle: "Tailoring reads differently for your wardrobe register.",
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
    cards: [
      {
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        subTitle: null,
      },
      {
        slug: "modern-tailoring-spring-2026",
        title: "Modern Tailoring",
        season: "Spring 2026",
        subTitle: null,
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

// ── Component tests — no reports ─────────────────────────────────────────────

describe("MyTrendEdits component — no published reports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders editorial empty state", () => {
    vi.mocked(useLoaderData).mockReturnValueOnce({ cards: [], hasProfile: false });
    const html = renderToString(React.createElement(MyTrendEdits));
    expect(html).toContain("your trend edits");
    expect(html).toContain("are on their way.");
    expect(html).toContain('href="/passport"');
  });
});
