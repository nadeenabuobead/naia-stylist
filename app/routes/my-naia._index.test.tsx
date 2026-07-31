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

vi.mock("react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({
      to,
      children,
      className,
      onClick,
      "aria-current": ariaCurrent,
    }: {
      to: string;
      children: unknown;
      className?: string;
      onClick?: () => void;
      "aria-current"?: string;
    }) =>
      createElement("a", { href: to, className, onClick, "aria-current": ariaCurrent }, children as any),
    useLoaderData: vi.fn(() => ({ isDev: false })),
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

  it("renders all expected action section labels", () => {
    const html = render();
    const labels = [
      "StyleMe", "Style Passport", "Personal Styling Analysis", "My nAia Model",
      "Digital Closet", "Buy or Skip", "My Trend Edits",
      "Saved", "Orders", "Settings &amp; Privacy",  // HTML-encoded by React
    ];
    for (const label of labels) {
      expect(html, `expected action label "${label}" in output`).toContain(label);
    }
  });

  it("inactive nav items (Saved, Orders, Settings & Privacy) render as static spans, not links", () => {
    const html = render();
    // Nav is rendered twice (sidebar + mobile overlay), so 3 static items × 2 = 6
    const staticCount = (html.match(/mn-nav-static/g) ?? []).length;
    expect(staticCount).toBe(6);
  });

  it("inactive action items (Saved, Orders, Settings & Privacy) render as div.mn-action--inactive, not anchor", () => {
    const html = render();
    const inactiveCount = (html.match(/mn-action--inactive/g) ?? []).length;
    expect(inactiveCount).toBe(3);
  });

  it("active navigation item (/my-naia — OVERVIEW) carries aria-current='page'", () => {
    const html = render();
    // The OVERVIEW link should be the one with both href="/my-naia" and aria-current="page"
    expect(html).toMatch(
      /aria-current="page"[^>]*href="\/my-naia"|href="\/my-naia"[^>]*aria-current="page"/
    );
  });

  it("dev fixture notice appears when isDev is true", () => {
    const html = render(true);
    expect(html).toContain("Development build");
  });

  it("dev fixture notice is absent when isDev is false", () => {
    const html = render(false);
    expect(html).not.toContain("Development build");
  });

  it("working action items are anchor elements with valid href paths", () => {
    const html = render();
    // Working routes that should have href attributes in action area
    const workingPaths = [
      "/style-me",
      "/full-style-profile",
      "/passport/selfie",
      "/my-naia-model",
      "/closet",
      "/buyskip",
      "/trends",
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
