// Focused tests for the /my-naia shell (Lovable verbatim port).
//
// Static structure and loader tests run in Vitest node environment using
// renderToString from react-dom/server (no DOM required).
//
// Interactive tests (mobile menu click / Escape / focus return) are marked
// it.todo — they require jsdom or happy-dom. Verify those behaviours manually
// at /dev-my-naia-fixture.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

// ── Module mocks — hoisted before imports ─────────────────────────────────────

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({
    to,
    children,
    className,
    style,
    onClick,
    "aria-current": ariaCurrent,
    "aria-label": ariaLabel,
  }: {
    to: string;
    children: unknown;
    className?: string;
    style?: object;
    onClick?: () => void;
    "aria-current"?: string;
    "aria-label"?: string;
  }) =>
    createElement("a", { href: to, className, style, onClick, "aria-current": ariaCurrent, "aria-label": ariaLabel }, children as any);
  const mockUseLoaderData = vi.fn(() => ({
    firstName: null,
    profile: null,
    sessions: [],
    trendReport: null,
    buyOrSkipHistory: [],
    reviewCount: 0,
    closetCount: 0,
  }));
  return {
    ...actual,
    Link: mockLink,
    useLoaderData: mockUseLoaderData,
    useLocation: vi.fn(() => ({ pathname: "/my-naia" })),
    UNSAFE_withComponentProps: (Component: any) => Component,
  };
});

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    stylingSession: { findMany: vi.fn().mockResolvedValue([]) },
    trendReport:    { findFirst: vi.fn().mockResolvedValue(null) },
    buyOrSkipAnalysis: { findMany: vi.fn().mockResolvedValue([]) },
    postOutfitReview: { count: vi.fn().mockResolvedValue(0) },
    closetItem:     { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "/styles.css" }));

// ── Imports after mocks ────────────────────────────────────────────────────────

import { useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaOverview, { loader } from "./my-naia._index";

// ── Loader tests ──────────────────────────────────────────────────────────────

describe("my-naia loader — authentication gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls requireCurrentNaiaCustomer for every request", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "c1" } as any);
    await loader({
      request: new Request("http://localhost/my-naia"),
      params: {},
      context: {},
    } as any);
    expect(requireCurrentNaiaCustomer).toHaveBeenCalledOnce();
  });

  it("propagates the redirect thrown when no session exists", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockImplementationOnce(() => {
      throw new Response(null, {
        status: 302,
        headers: { Location: "/auth/shopify/login?return_to=%2Fmy-naia" },
      });
    });
    await expect(
      loader({
        request: new Request("http://localhost/my-naia"),
        params: {},
        context: {},
      } as any)
    ).rejects.toBeInstanceOf(Response);
  });

  it("returns session data fields when authenticated", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", firstName: "Alia", onboardingProfile: null,
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {},
      context: {},
    } as any);
    expect(result).toHaveProperty("sessions");
    expect(result).toHaveProperty("closetCount");
    expect(result).toHaveProperty("reviewCount");
  });

  it("does not include customer email or raw id in loader return value", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c-secret",
      shopifyCustomerId: "gid://1",
      email: "private@example.com",
      firstName: "Alia",
      onboardingProfile: null,
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {},
      context: {},
    } as any);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("c-secret");
    expect(serialised).not.toContain("private@example.com");
  });
});

// ── Component structure tests ─────────────────────────────────────────────────

type LoaderShape = {
  firstName: string | null;
  profile: unknown;
  sessions: unknown[];
  trendReport: unknown;
  buyOrSkipHistory: unknown[];
  reviewCount: number;
  closetCount: number;
};

describe("my-naia component — static structure", () => {
  beforeEach(() => vi.clearAllMocks());

  function render(overrides: Partial<LoaderShape> = {}): string {
    vi.mocked(useLoaderData).mockReturnValue({
      firstName: null,
      profile: null,
      sessions: [],
      trendReport: null,
      buyOrSkipHistory: [],
      reviewCount: 0,
      closetCount: 0,
      ...overrides,
    });
    return renderToString(<MyNaiaOverview />);
  }

  it("renders the MY nAia. heading in the layout", () => {
    const html = render();
    expect(html).toContain("mn-page-head-title");
    expect(html).toContain("nAia.");
  });

  it("renders the mn-title-accent span for the italic nAia.", () => {
    const html = render();
    expect(html).toContain("mn-title-accent");
  });

  it("renders the NADINE brand wordmark", () => {
    const html = render();
    expect(html).toContain("NADINE");
  });

  it("renders sidebar navigation with Main section links", () => {
    const html = render();
    expect(html).toContain("Overview");
    expect(html).toContain("My Closet");
    expect(html).toContain("StyleMe");
    expect(html).toContain("Buy or Skip");
  });

  it("renders account navigation items", () => {
    const html = render();
    expect(html).toContain("Saved");
    expect(html).toContain("Settings &amp; Privacy");
    expect(html).toContain("My nAia Model");
    expect(html).toContain("Selfie Style Analysis");
  });

  it("StyleMe hero card is present with correct link", () => {
    const html = render();
    expect(html).toContain("mn-styleme-hero");
    expect(html).toContain("Start StyleMe");
    expect(html).toContain('href="/style-me"');
  });

  it("Quick Tools section contains links to StyleMe, Closet, and Buy or Skip", () => {
    const html = render();
    expect(html).toContain("Quick Tools");
    expect(html).toContain("Open My Closet");
    expect(html).toContain("Buy or Skip");
  });

  it("daily quote section is present", () => {
    const html = render();
    expect(html).toContain("mn-daily-quote");
    expect(html).toContain("Today");
    expect(html).toContain("Note");
  });

  it("welcome back eyebrow is present", () => {
    const html = render();
    expect(html).toContain("Welcome back");
  });

  it("renders first name when provided", () => {
    const html = render({ firstName: "Alia" });
    expect(html).toContain("Alia.");
  });

  it("renders Welcome. when no first name", () => {
    const html = render({ firstName: null });
    expect(html).toContain("Welcome.");
  });

  it("shows attention item when profile is null", () => {
    const html = render({ profile: null });
    expect(html).toContain("What Needs Your Attention");
    expect(html).toContain("Style Passport is incomplete");
  });

  it("shows empty closet attention when closetCount is 0 and profile is complete", () => {
    const html = render({ profile: { completed: true }, closetCount: 0 });
    expect(html).toContain("closet is empty");
  });

  it("renders empty state for Recent Looks when no sessions", () => {
    const html = render({ sessions: [] });
    expect(html).toContain("first StyleMe look will appear here");
  });

  it("renders empty state for Buy or Skip when no history", () => {
    const html = render({ buyOrSkipHistory: [] });
    expect(html).toContain("No decisions yet");
  });

  it("footer is rendered with NADINE brand bar", () => {
    const html = render();
    expect(html).toContain("mn-footer");
    expect(html).toContain("NADINE");
    expect(html).toContain("Fashion that reads you");
  });

  it("working page links have valid href paths", () => {
    const html = render();
    const workingPaths = ["/style-me", "/closet", "/buyskip", "/my-naia/saved"];
    for (const path of workingPaths) {
      expect(html, `expected href="${path}" in output`).toContain(`href="${path}"`);
    }
  });

  it("Plan & Usage section shows closet count", () => {
    const html = render({ closetCount: 12 });
    expect(html).toContain("12 of 100 spaces used");
  });
});

// ── Interactive behaviour — requires DOM environment ──────────────────────────
// Verify manually at: GET /dev-my-naia-fixture

describe("my-naia component — interactive behaviour (dom required)", () => {
  it.todo("hamburger button has aria-expanded=false initially");
  it.todo("clicking hamburger opens the mobile nav panel");
  it.todo("clicking a mobile nav link closes the menu");
  it.todo("sidebar navigation is visible on desktop viewport (≥1024px)");
  it.todo("mobile nav trigger is hidden on desktop viewport (≥1024px)");
  it.todo("footer accordion opens/closes on mobile");
});
