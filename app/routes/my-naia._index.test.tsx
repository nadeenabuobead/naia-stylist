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
  // <Form> needs a real router context (unstable_useTransitions) that plain
  // renderToString never provides — stub it as a plain <form>, same technique
  // as the Link mock above, so these tests can render the component at all.
  const mockForm = ({
    method,
    action,
    style,
    children,
  }: {
    method?: string;
    action?: string;
    style?: object;
    children: unknown;
  }) => createElement("form", { method, action, style }, children as any);
  const mockUseLoaderData = vi.fn(() => ({
    firstName: null as string | null,
    profile: null as unknown,
    sessions: [] as unknown[],
    trendReport: null as { slug: string; title: string; season: string; summary: string; visual?: { treatment: string } | null } | null,
    buyOrSkipHistory: [] as Array<{ id: string; displayName: string | null; verdict: string; createdAt: string; itemImageUrl?: string | null; category?: string | null }>,
    reviewCount: 0,
    closetCount: 0,
    passportState: "start" as const,
    strongestTendency: null as unknown,
    hasCandidates: false,
    entitlement: {
      plan: "FREE",
      styleMe: { monthlyLimit: 1, monthlyUsed: 0, welcomeAvailable: false },
      buySkip: { introAvailable: true, monthlyLimit: null, monthlyUsed: null },
      vto: { monthlyLimit: 0, monthlyCompleted: 0, monthlyInFlight: 0 },
      closet: { limit: 10, currentCount: 0 },
      personalisedTrend: { monthlyLimit: 0 },
    } as unknown,
  }));
  return {
    ...actual,
    Link: mockLink,
    Form: mockForm,
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
    styleTendency:  { count: vi.fn().mockResolvedValue(0) },
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

vi.mock("~/lib/ai/taste-reconcile.server", () => ({
  loadStrongestConfirmedTendency: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/plan/entitlement.server", () => ({
  getEntitlementSummary: vi.fn().mockResolvedValue({
    plan: "FREE",
    styleMe: { monthlyLimit: 1, monthlyUsed: 0, welcomeAvailable: false },
    buySkip: { introAvailable: true, monthlyLimit: null, monthlyUsed: null },
    vto: { monthlyLimit: 0, monthlyCompleted: 0, monthlyInFlight: 0 },
    closet: { limit: 10, currentCount: 0 },
    personalisedTrend: { monthlyLimit: 0 },
  }),
}));

vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "/styles.css" }));

// ── Imports after mocks ────────────────────────────────────────────────────────

import { useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { getCloudinaryConfig, validatePublicIdOwnership, buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";
import { reportVisual } from "~/lib/report-visual";
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

// ── Loader — Latest StyleMe card imagery (Task 1) ──────────────────────────────
// The card must represent the real pieces from that exact result, not one
// arbitrarily-chosen "representative" garment, and must degrade gracefully
// when a result has few or no resolvable images.

describe("my-naia loader — StyleMe card imagery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValue({
      id: "c1", firstName: "Alia", onboardingProfile: null,
    } as any);
    vi.mocked(getCloudinaryConfig).mockReturnValue(null);
  });

  function sessionWith(items: Array<{ itemType?: string; closetItemId?: string | null; productImageUrl?: string | null; closetItem?: { imageUrl?: string | null; imagePublicId?: string | null; imageFormat?: string | null } | null }>) {
    return {
      id: "s1", createdAt: new Date("2026-09-01"), currentMood: null, desiredFeeling: null, occasion: null, styleFrom: null,
      suggestions: [{ id: "sg1", outfitName: "Look", items: items.map((i) => ({ itemType: "TOP", closetItemId: null, productTitle: null, productImageUrl: null, closetItem: null, ...i })) }],
      review: null,
    };
  }

  it("multi-item result: every resolvable item image is carried through, not just one", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([
        { productImageUrl: "https://nadine.example.com/blazer.jpg" },
        { productImageUrl: "https://nadine.example.com/trousers.jpg" },
        { productImageUrl: "https://nadine.example.com/shoes.jpg" },
        { productImageUrl: "https://nadine.example.com/bag.jpg" },
      ]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    const session = (result as any).sessions[0];
    expect(session.resolvedImages).toEqual([
      "https://nadine.example.com/blazer.jpg",
      "https://nadine.example.com/trousers.jpg",
      "https://nadine.example.com/shoes.jpg",
      "https://nadine.example.com/bag.jpg",
    ]);
    expect(session.extraCount).toBe(0);
  });

  it("caps the collage at 4 images and reports the rest via extraCount", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([
        { productImageUrl: "https://nadine.example.com/1.jpg" },
        { productImageUrl: "https://nadine.example.com/2.jpg" },
        { productImageUrl: "https://nadine.example.com/3.jpg" },
        { productImageUrl: "https://nadine.example.com/4.jpg" },
        { productImageUrl: "https://nadine.example.com/5.jpg" },
      ]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    const session = (result as any).sessions[0];
    expect(session.resolvedImages).toHaveLength(4);
    expect(session.extraCount).toBe(1);
  });

  it("one-image legacy result: resolves exactly the one usable image", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([
        { closetItemId: "ci1", closetItem: { imageUrl: "https://legacy.example.com/dress.jpg", imagePublicId: null, imageFormat: null } },
      ]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    const session = (result as any).sessions[0];
    expect(session.resolvedImages).toEqual(["https://legacy.example.com/dress.jpg"]);
    expect(session.extraCount).toBe(0);
  });

  it("no-image legacy result: resolves no images, leaving the fallback to the UI", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([
        { closetItemId: "ci1", closetItem: { imageUrl: null, imagePublicId: null, imageFormat: null } },
        { closetItemId: "ci2", closetItem: { imageUrl: null, imagePublicId: null, imageFormat: null } },
      ]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    const session = (result as any).sessions[0];
    expect(session.resolvedImages).toEqual([]);
    expect(session.extraCount).toBe(2);
  });

  it("prefers a private signed Cloudinary URL over a legacy imageUrl when ownership validates", async () => {
    vi.mocked(getCloudinaryConfig).mockReturnValue({ cloudName: "naia" } as any);
    vi.mocked(validatePublicIdOwnership).mockReturnValue({ ok: true } as any);
    vi.mocked(buildPrivateDownloadUrl).mockReturnValue("https://signed.example.com/private.jpg");
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([
        { closetItemId: "ci1", closetItem: { imageUrl: "https://legacy.example.com/stale.jpg", imagePublicId: "naia-wardrobe/c1/ci1", imageFormat: "jpg" } },
      ]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    const session = (result as any).sessions[0];
    expect(session.resolvedImages).toEqual(["https://signed.example.com/private.jpg"]);
  });

  // "Latest StyleMe" means the latest *completed* looks — a StylingSession with
  // no OutfitSuggestion, or a suggestion with no items, never finished
  // generating a look and must not occupy a card slot.

  it("queries only completed results: where clause requires a suggestion that has items", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([]);
    await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    const callArgs = vi.mocked(prisma.stylingSession.findMany).mock.calls[0][0] as any;
    expect(callArgs.where).toEqual({
      customerId: "c1",
      suggestions: { some: { items: { some: {} } } },
    });
  });

  it("a completed result is included and still renders its real multi-piece collage", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([
        { productImageUrl: "https://nadine.example.com/dress.jpg" },
        { productImageUrl: "https://nadine.example.com/shoes.jpg" },
      ]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    expect((result as any).sessions).toHaveLength(1);
    expect((result as any).sessions[0].resolvedImages).toEqual([
      "https://nadine.example.com/dress.jpg",
      "https://nadine.example.com/shoes.jpg",
    ]);
  });

  it("incomplete recent sessions do not prevent older completed results from being returned — the loader trusts the query's own history reach-back", async () => {
    // The where clause (asserted above) is what makes Prisma skip incomplete
    // rows and reach further back in history; this proves the loader doesn't
    // then re-filter or drop any of what the query already returned.
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      { ...sessionWith([{ productImageUrl: "https://nadine.example.com/newer.jpg" }]), id: "s-newer-completed" },
      { ...sessionWith([{ productImageUrl: "https://nadine.example.com/older.jpg" }]), id: "s-older-completed" },
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    expect((result as any).sessions.map((s: any) => s.id)).toEqual(["s-newer-completed", "s-older-completed"]);
  });

  it("fewer than 3 completed results in history renders fewer than 3 cards — no fake padding", async () => {
    vi.mocked(prisma.stylingSession.findMany).mockResolvedValueOnce([
      sessionWith([{ productImageUrl: "https://nadine.example.com/only.jpg" }]),
    ] as any);
    const result = await loader({ request: new Request("http://localhost/my-naia"), params: {}, context: {} } as any);
    expect((result as any).sessions).toHaveLength(1);
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
  strongestTendency?: unknown;
  hasCandidates?: boolean;
  entitlement?: unknown;
};

describe("my-naia component — static structure", () => {
  beforeEach(() => vi.clearAllMocks());

  const defaultEntitlement = {
    plan: "FREE",
    styleMe: { monthlyLimit: 1, monthlyUsed: 0, welcomeAvailable: false },
    buySkip: { introAvailable: true, monthlyLimit: null, monthlyUsed: null },
    vto: { monthlyLimit: 0, monthlyCompleted: 0, monthlyInFlight: 0 },
    closet: { limit: 10, currentCount: 0 },
    personalisedTrend: { monthlyLimit: 0 },
  };

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
      strongestTendency: null,
      hasCandidates: false,
      entitlement: defaultEntitlement,
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
    expect(html).toContain("Settings &amp; Privacy");
    expect(html).toContain("My nAia Model");
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

  it("welcome back eyebrow is absent (removed — greeting stands alone)", () => {
    const html = render();
    expect(html).not.toContain("Welcome back");
  });

  it("renders 'Welcome,' in the display font and the name in the italic editorial accent", () => {
    const html = render({ firstName: "Alia" });
    expect(html).toContain("Welcome,");
    expect(html).toMatch(/<span[^>]*font-style:\s*italic[^>]*>\s*Alia\.\s*<\/span>/);
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

  function baseSession(overrides: Record<string, unknown> = {}) {
    return {
      id: "s1", createdAt: "2026-09-01T00:00:00.000Z", currentMood: null, desiredFeeling: null, occasion: null, styleFrom: null,
      suggestions: [{ id: "sg1", outfitName: "nAia Look", items: [] }],
      review: null,
      resolvedImages: [] as string[],
      extraCount: 0,
      ...overrides,
    };
  }

  it("multi-item StyleMe result renders every real result image, not one arbitrary piece", () => {
    const html = render({
      sessions: [baseSession({ resolvedImages: ["https://a.example/1.jpg", "https://a.example/2.jpg", "https://a.example/3.jpg"], extraCount: 0 })],
    });
    expect(html).toContain('src="https://a.example/1.jpg"');
    expect(html).toContain('src="https://a.example/2.jpg"');
    expect(html).toContain('src="https://a.example/3.jpg"');
  });

  it("multi-item result beyond the collage cap shows a +N indicator", () => {
    const html = render({
      sessions: [baseSession({ resolvedImages: ["https://a.example/1.jpg", "https://a.example/2.jpg", "https://a.example/3.jpg", "https://a.example/4.jpg"], extraCount: 1 })],
    });
    expect(html).toContain("+1");
  });

  it("one-image legacy result renders exactly one image", () => {
    const html = render({
      sessions: [baseSession({ resolvedImages: ["https://legacy.example/dress.jpg"], extraCount: 0 })],
    });
    const imgMatches = html.match(/<img[^>]*src="https:\/\/legacy\.example\/dress\.jpg"/g) ?? [];
    expect(imgMatches).toHaveLength(1);
  });

  it("no-image legacy result shows the intentional fallback, never a broken image tag", () => {
    const html = render({
      sessions: [baseSession({ resolvedImages: [], extraCount: 1 })],
    });
    // The card for this look renders no <img> at all — only the neutral SVG placeholder.
    expect(html).not.toMatch(/<img[^>]*src="[^"]*"/);
  });

  it("a CLOSET-sourced session with no persisted OutfitSuggestion labels its source 'My Closet', not 'NADINE'", () => {
    const html = render({
      sessions: [baseSession({ styleFrom: "CLOSET", suggestions: [] })],
    });
    expect(html).toMatch(/letter-spacing:0\.28em;color:var\(--fg-55\)">My Closet</);
    expect(html).not.toMatch(/letter-spacing:0\.28em;color:var\(--fg-55\)">NADINE</);
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

  it("Plan & Usage section shows closet count from entitlement", () => {
    const html = render({
      entitlement: {
        plan: "FREE",
        styleMe: { monthlyLimit: 1, monthlyUsed: 0, welcomeAvailable: false },
        buySkip: { introAvailable: true, monthlyLimit: null, monthlyUsed: null },
        vto: { monthlyLimit: 0, monthlyCompleted: 0, monthlyInFlight: 0 },
        closet: { limit: 100, currentCount: 12 },
        personalisedTrend: { monthlyLimit: 0 },
      },
    });
    expect(html).toContain("12 of 100 items");
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

  it("renders the visual box when the report has a visual treatment", () => {
    vi.mocked(reportVisual).mockReturnValueOnce(<div data-testid="trend-visual-mark">MARK</div> as any);
    const html = render({
      trendReport: { slug: "spring-2026", title: "Spring 2026", season: "Spring 2026", summary: "An edit.", visual: { treatment: "soft-structure" } },
    });
    expect(html).toContain("trend-visual-mark");
    expect(html).toContain('class="mn-trend-grid"');
  });

  it("omits the empty visual box entirely when visual.treatment is unset, instead of a blank image", () => {
    const html = render({
      trendReport: { slug: "spring-2026", title: "Spring 2026", season: "Spring 2026", summary: "An edit.", visual: null },
    });
    // No two-column grid class is applied — the text column takes the full row
    // instead of leaving an empty image box beside it. (The media-query <style>
    // text always mentions the selector name, so check the actual class attribute.)
    expect(html).not.toContain('class="mn-trend-grid"');
    expect(html).toContain("Spring 2026");
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

  const defaultEntitlement = {
    plan: "FREE",
    styleMe: { monthlyLimit: 1, monthlyUsed: 0, welcomeAvailable: false },
    buySkip: { introAvailable: true, monthlyLimit: null, monthlyUsed: null },
    vto: { monthlyLimit: 0, monthlyCompleted: 0, monthlyInFlight: 0 },
    closet: { limit: 10, currentCount: 0 },
    personalisedTrend: { monthlyLimit: 0 },
  };

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
      strongestTendency: null,
      hasCandidates: false,
      entitlement: defaultEntitlement,
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
