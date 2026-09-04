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
    firstName: null as string | null,
    profile: null as unknown,
    sessions: [] as unknown[],
    trendReport: null as { slug: string; title: string; season: string; summary: string; visual?: { treatment: string } | null } | null,
    buyOrSkipHistory: [] as Array<{ id: string; displayName: string | null; verdict: string; createdAt: string; itemImageUrl?: string | null; category?: string | null }>,
    reviewCount: 0,
    closetCount: 0,
    passportState: "start" as const,
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
    buyOrSkipAnalysis: { findMany: vi.fn().mockResolvedValue([]) },
    postOutfitReview: { count: vi.fn().mockResolvedValue(0) },
    closetItem:     { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock("~/lib/editorial-reports.server", () => ({
  getPublishedEditorialReports: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn().mockReturnValue(null),
  validatePublicIdOwnership: vi.fn().mockReturnValue({ ok: false }),
  buildPrivateDownloadUrl: vi.fn().mockReturnValue("https://signed.example.com/image.jpg"),
}));

vi.mock("~/lib/report-visual", () => ({
  reportVisual: vi.fn().mockReturnValue(null),
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
  trendReport: { slug: string; title: string; season: string; summary: string; visual?: { treatment: string } | null } | null;
  buyOrSkipHistory: Array<{ id: string; displayName: string | null; verdict: string; createdAt: string; itemImageUrl?: string | null; category?: string | null }>;
  reviewCount: number;
  closetCount: number;
  passportState?: "start" | "continue" | "view";
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
      passportState: "start" as const,
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
    // Selfie Style Analysis removed from top-level nav; discovery is now through Style Passport → Visual Analysis
    expect(html).toContain("Style Passport");
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

  it("renders 'Welcome, Name.' greeting when firstName provided", () => {
    const html = render({ firstName: "Alia" });
    expect(html).toContain("Welcome, Alia.");
  });

  it("renders Welcome. when no first name", () => {
    const html = render({ firstName: null });
    expect(html).toContain("Welcome.");
  });

  it("does not render 'Welcome,' when firstName is null", () => {
    const html = render({ firstName: null });
    expect(html).not.toContain("Welcome, ");
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

  it("trend teaser 'Open My Trend Edit' links to /trends/my-edits/:slug", () => {
    const html = render({
      trendReport: {
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        summary: "A nAia edit.",
      },
    });
    expect(html).toContain('href="/trends/my-edits/spring-2026-soft-structure"');
    expect(html).toContain("Open My Trend Edit");
  });

  it("trend teaser shows season label when present", () => {
    const html = render({
      trendReport: {
        slug: "autumn-2026-quiet-luxury",
        title: "Autumn 2026 Quiet Luxury",
        season: "Autumn 2026",
        summary: "A nAia edit.",
      },
    });
    expect(html).toContain("Autumn 2026");
  });

  it("shows no trend edit when trendReport is null", () => {
    const html = render({ trendReport: null });
    expect(html).toContain("personalised trend edit will appear here");
  });

  it("passport snapshot renders style direction when profile has stylePersonalities", () => {
    const html = render({
      passportState: "view",
      profile: { stylePersonalities: ["classic-polished", "minimal-relaxed"], currentGoal: [], silhouette: [], favoriteColors: [], lifestyle: [], successfulOutfitGives: [] },
    });
    expect(html).toContain("Classic &amp; Polished");
    expect(html).toContain("Minimal &amp; Relaxed");
  });

  it("passport snapshot shows favourite colours", () => {
    const html = render({
      passportState: "view",
      profile: { stylePersonalities: [], currentGoal: [], silhouette: [], favoriteColors: ["Navy", "Cream", "Olive"], lifestyle: [], successfulOutfitGives: [] },
    });
    expect(html).toContain("Navy");
    expect(html).toContain("Cream");
  });

  it("passport snapshot is not rendered in start or continue states", () => {
    for (const state of ["start", "continue"] as const) {
      const html = render({
        passportState: state,
        profile: { stylePersonalities: ["classic-polished"], currentGoal: [], silhouette: [], favoriteColors: ["Navy"], lifestyle: [], successfulOutfitGives: [] },
      });
      expect(html, `state=${state}`).not.toContain("Style direction");
    }
  });

  it("buy or skip shows item image when itemImageUrl present", () => {
    const html = render({
      buyOrSkipHistory: [{
        id: "bos-1",
        displayName: "Tweed Maxi Skirt",
        verdict: "BUY",
        createdAt: "2026-09-04T10:00:00Z",
        itemImageUrl: "https://res.cloudinary.com/example/image/upload/v1/item.jpg",
        category: "Bottom",
      }],
    });
    expect(html).toContain("Tweed Maxi Skirt");
    expect(html).toContain("https://res.cloudinary.com/example/image/upload/v1/item.jpg");
    expect(html).toContain("BUY");
  });

  it("buy or skip falls back to category when displayName is null", () => {
    const html = render({
      buyOrSkipHistory: [{
        id: "bos-2",
        displayName: null,
        verdict: "SKIP",
        createdAt: "2026-09-04T09:00:00Z",
        itemImageUrl: null,
        category: "Dress",
      }],
    });
    expect(html).toContain("Dress");
    expect(html).not.toContain("Unnamed item");
  });

  it("buy or skip shows displayName over category when both present", () => {
    const html = render({
      buyOrSkipHistory: [{
        id: "bos-3",
        displayName: "Pearl Net Overlay Maxi Dress",
        verdict: "BUY",
        createdAt: "2026-09-04T08:00:00Z",
        itemImageUrl: null,
        category: "Dress",
      }],
    });
    expect(html).toContain("Pearl Net Overlay Maxi Dress");
  });

  it("trend teaser renders without error when visual.treatment is present", () => {
    expect(() => render({
      trendReport: {
        slug: "spring-2026-soft-structure",
        title: "Spring 2026 Soft Structure",
        season: "Spring 2026",
        summary: "A nAia edit.",
        visual: { treatment: "soft-structure" },
      },
    })).not.toThrow();
  });
});

// ── Loader tests: passportState derivation (Q–T) ─────────────────────────────

describe("my-naia loader — passportState derivation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Q: loader returns passportState field", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", firstName: null, onboardingProfile: null,
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {}, context: {},
    } as any);
    expect(result).toHaveProperty("passportState");
  });

  it("R: passportState is 'start' when onboardingProfile is null", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", firstName: null, onboardingProfile: null,
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {}, context: {},
    } as any);
    expect((result as any).passportState).toBe("start");
  });

  it("S: passportState is 'continue' when profile exists but completed=false", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", firstName: null,
      onboardingProfile: { completed: false },
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {}, context: {},
    } as any);
    expect((result as any).passportState).toBe("continue");
  });

  it("T: passportState is 'view' when profile.profileVersion===6", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", firstName: null,
      onboardingProfile: { completed: true, profileVersion: 6 },
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {}, context: {},
    } as any);
    expect((result as any).passportState).toBe("view");
  });

  it("T2: passportState is 'continue' (not view) for legacy completed=true + profileVersion=null", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", firstName: null,
      onboardingProfile: { completed: true, profileVersion: null },
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {}, context: {},
    } as any);
    expect((result as any).passportState).toBe("continue");
  });
});

// ── Component: Passport CTA states (U–W) ─────────────────────────────────────

describe("my-naia component — Passport CTA three states", () => {
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
      passportState: "start" as const,
      ...overrides,
    });
    return renderToString(<MyNaiaOverview />);
  }

  it("U: START state renders 'START YOUR STYLE PASSPORT' CTA linking to /passport", () => {
    const html = render({ passportState: "start" });
    expect(html).toContain("START YOUR STYLE PASSPORT");
    expect(html).toContain('href="/passport"');
  });

  it("V: CONTINUE state renders 'CONTINUE YOUR STYLE PASSPORT' CTA linking to /passport", () => {
    const html = render({ passportState: "continue" });
    expect(html).toContain("CONTINUE YOUR STYLE PASSPORT");
    expect(html).toContain('href="/passport"');
  });

  it("W: VIEW state renders 'VIEW STYLE PASSPORT' CTA linking to /passport", () => {
    const html = render({ passportState: "view" });
    expect(html).toContain("VIEW STYLE PASSPORT");
    expect(html).toContain('href="/passport"');
  });

  it("Passport section heading 'Your Style Passport' is always present", () => {
    for (const state of ["start", "continue", "view"] as const) {
      const html = render({ passportState: state });
      expect(html, `state=${state}`).toContain("Your Style Passport");
    }
  });

  it("only one state's content renders at a time", () => {
    const startHtml = render({ passportState: "start" });
    expect(startHtml).not.toContain("CONTINUE YOUR STYLE PASSPORT");
    expect(startHtml).not.toContain("VIEW STYLE PASSPORT");

    const continueHtml = render({ passportState: "continue" });
    expect(continueHtml).not.toContain("START YOUR STYLE PASSPORT");
    expect(continueHtml).not.toContain("VIEW STYLE PASSPORT");

    const viewHtml = render({ passportState: "view" });
    expect(viewHtml).not.toContain("START YOUR STYLE PASSPORT");
    expect(viewHtml).not.toContain("CONTINUE YOUR STYLE PASSPORT");
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
