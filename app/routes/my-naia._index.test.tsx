// Focused tests for the /my-naia shell.
//
// Static structure and loader tests run in Vitest node environment using
// renderToString from react-dom/server (no DOM required).
//
// Interactive tests (mobile menu click / Escape / focus return) are marked
// it.todo — they require jsdom or happy-dom. Verify those behaviours manually
// via the dev-my-naia-fixture route at /dev-my-naia-fixture.

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
    onMouseOver,
    onMouseOut,
    "aria-current": ariaCurrent,
    "aria-label": ariaLabel,
  }: {
    to: string;
    children: unknown;
    className?: string;
    style?: object;
    onClick?: () => void;
    onMouseOver?: () => void;
    onMouseOut?: () => void;
    "aria-current"?: string;
    "aria-label"?: string;
  }) =>
    createElement("a", { href: to, className, style, onClick, onMouseOver, onMouseOut, "aria-current": ariaCurrent, "aria-label": ariaLabel }, children as any);
  const mockForm = ({ children, method: _m, action: _a, ...rest }: any) =>
    createElement("form", rest, children);
  const mockUseLoaderData = vi.fn(() => ({ isDev: false }));
  return {
    ...actual,
    Link: mockLink,
    Form: mockForm,
    useLoaderData: mockUseLoaderData,
    UNSAFE_withComponentProps: (Component: any) => Component,
  };
});

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
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

  it("returns isDev flag when session is valid", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "c1" } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {},
      context: {},
    } as any);
    expect(result).toHaveProperty("isDev");
    expect(typeof (result as any).isDev).toBe("boolean");
  });

  it("does not include customer name, email, or id in loader return value", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c-secret",
      shopifyCustomerId: "gid://1",
      email: "private@example.com",
      firstName: "SecretName",
    } as any);
    const result = await loader({
      request: new Request("http://localhost/my-naia"),
      params: {},
      context: {},
    } as any);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("c-secret");
    expect(serialised).not.toContain("private@example.com");
    expect(serialised).not.toContain("SecretName");
  });
});

// ── Component structure tests ─────────────────────────────────────────────────

describe("my-naia component — static structure", () => {
  beforeEach(() => vi.clearAllMocks());

  function render(isDev = false): string {
    vi.mocked(useLoaderData).mockReturnValue({ isDev });
    return renderToString(<MyNaiaOverview />);
  }

  it("renders all eleven navigation labels", () => {
    const html = render();
    const labels = [
      "OVERVIEW",
      "STYLE PASSPORT",
      "DIGITAL CLOSET",
      "STYLEME",
      "BUY OR SKIP",
      "MY nAia MODEL",
      "PERSONAL STYLING ANALYSIS",
      "MY TREND EDITS",
      "SAVED",
      "ORDERS",
      "SETTINGS &amp; PRIVACY",  // HTML-encoded by React
    ];
    for (const label of labels) {
      expect(html, `expected nav label "${label}" in output`).toContain(label);
    }
  });

  it("renders all expected page links in the Your nAia section", () => {
    const html = render();
    const labels = [
      "StyleMe", "Style Passport", "Personal Styling Analysis", "My nAia Model",
      "Digital Closet", "Buy or Skip", "My Trend Edits",
      "Saved", "Orders", "Settings &amp; Privacy",  // HTML-encoded by React
    ];
    for (const label of labels) {
      expect(html, `expected label "${label}" in output`).toContain(label);
    }
  });

  it("inactive nav items (Orders only) render as static spans, not links", () => {
    const html = render();
    // Nav is rendered twice (sidebar + mobile overlay): 1 static item (ORDERS) × 2 = 2
    const staticCount = (html.match(/mn-nav-static/g) ?? []).length;
    expect(staticCount).toBe(2);
  });

  it("Orders in the Your nAia list renders as a span with shopify badge, not an anchor", () => {
    const html = render();
    // The Orders item in the link list should NOT have an href
    // — it's a <span> with a shopify badge
    expect(html).toContain("shopify");
    // Verify no href="/orders" or href for orders
    expect(html).not.toContain('href="/orders"');
  });

  it("active navigation item (/my-naia — OVERVIEW) carries aria-current='page'", () => {
    const html = render();
    expect(html).toMatch(
      /aria-current="page"[^>]*href="\/my-naia"|href="\/my-naia"[^>]*aria-current="page"/
    );
  });

  it("StyleMe hero card links to /style-me", () => {
    const html = render();
    expect(html).toContain('href="/style-me"');
    expect(html).toContain("Start StyleMe");
  });

  it("Quick Tools section contains links to StyleMe, Closet, and Buy or Skip", () => {
    const html = render();
    expect(html).toContain("Quick Tools");
    expect(html).toContain("Open My Closet");
    expect(html).toContain("Buy or Skip");
  });

  it("editorial MY nAia. heading is in the layout", () => {
    const html = render();
    expect(html).toContain("mn-editorial-title");
    expect(html).toContain("nAia.");
  });

  it("daily quote section is present", () => {
    const html = render();
    expect(html).toContain("Today&#x27;s Note");
  });

  it("dev fixture notice appears when isDev is true", () => {
    const html = render(true);
    expect(html).toContain("Development build");
  });

  it("dev fixture notice is absent when isDev is false", () => {
    const html = render(false);
    expect(html).not.toContain("Development build");
  });

  it("working page links have valid href paths", () => {
    const html = render();
    const workingPaths = [
      "/style-me",
      "/passport",
      "/passport/selfie",
      "/my-naia-model",
      "/closet",
      "/buyskip",
      "/trends",
      "/my-naia/saved",
      "/settings",
    ];
    for (const path of workingPaths) {
      expect(html, `expected href="${path}" in output`).toContain(`href="${path}"`);
    }
  });
});

// ── Interactive behaviour — requires DOM environment ──────────────────────────
// These tests need jsdom or happy-dom.
// Verify manually at: GET /dev-my-naia-fixture

describe("my-naia component — interactive behaviour (dom required)", () => {
  it.todo("hamburger button has aria-expanded=false initially");
  it.todo("clicking hamburger opens the mobile overlay (aria-expanded=true, mn-overlay--open class)");
  it.todo("clicking the overlay close button closes the menu");
  it.todo("pressing Escape while the overlay is open closes the menu");
  it.todo("focus returns to the hamburger button after the overlay closes");
  it.todo("sidebar navigation is visible without a menu button on desktop viewport (≥768px)");
  it.todo("hamburger is hidden on desktop viewport (≥768px)");
});
