// Component-level regression tests for the BuyOrSkipResult verdict heading.
//
// Renders the actual result page component with controlled fullAnalysis data and
// asserts the section heading reflects the verdict — not a hardcoded fallback.
// Uses renderToString (node environment, no jsdom required).

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

// ── Module mocks — hoisted before imports ────────────────────────────────────

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({ to, children, className }: { to: string; children: unknown; className?: string }) =>
    createElement("a", { href: to, className }, children as any);
  return {
    ...actual,
    Link: mockLink,
    useLoaderData: vi.fn(),
    useLocation: vi.fn(() => ({ pathname: "/buyskip" })),
    // Bypass the router HOC that enforces router context — component receives props directly
    UNSAFE_withComponentProps: (Component: any) => Component,
    data: (val: unknown) => val,
    redirect: (url: string) => url,
  };
});

vi.mock("~/lib/naia-session.server", () => ({ requireCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/db.server", () => ({ default: {} }));
vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "" }));
vi.mock("~/components/my-naia/MyNaiaLayout", () => {
  const { createElement } = require("react");
  return { default: ({ children }: { children: unknown }) => createElement("div", { "data-testid": "layout" }, children as any) };
});

import { useLoaderData } from "react-router";
import BuyOrSkipResult from "./buyskip.$id";
import React from "react";

// ── Shared fixture ────────────────────────────────────────────────────────────

const baseLoader = {
  id: "test-id",
  createdAt: new Date(0).toISOString(),
  imageUrl: null,
  verdict: "SKIP",
  reasoning: "Base reasoning",
  confidence: 68,
  category: "Bottom",
  colors: [],
  forOccasion: "brunch",
  whatLike: null,
  unsureAbout: null,
  colorNote: null,
  itemSize: null,
};

function render(fullAnalysis: Record<string, unknown> | null) {
  (useLoaderData as ReturnType<typeof vi.fn>).mockReturnValue({
    ...baseLoader,
    verdict: fullAnalysis?.verdict === "BUY" ? "BUY" : "SKIP",
    fullAnalysis,
  });
  return renderToString(React.createElement(BuyOrSkipResult));
}

// ── Heading regression tests ─────────────────────────────────────────────────

describe("BuyOrSkipResult — verdict-aware heading", () => {
  it('fullAnalysis.verdict "SKIP FOR NOW" → heading contains "Why It May Not Work Yet"', () => {
    const html = render({ verdict: "SKIP FOR NOW", confidence: 68, finalThought: "Conditional skip." });
    expect(html).toContain("Why It May Not Work Yet");
    expect(html).not.toContain("Why It Works");
  });

  it('fullAnalysis.verdict "BUY" → heading contains "Why It Works"', () => {
    const html = render({ verdict: "BUY", confidence: 85, finalThought: "Strong match." });
    expect(html).toContain("Why It Works");
    expect(html).not.toContain("Why It May Not Work Yet");
    expect(html).not.toContain("Why It Doesn");
  });

  it('fullAnalysis.verdict "SKIP" → heading contains "Why It Doesn\'t Work"', () => {
    const html = render({ verdict: "SKIP", confidence: 30, finalThought: "Clear mismatch." });
    expect(html).toContain("Why It Doesn");
    expect(html).not.toContain("Why It Works");
    expect(html).not.toContain("Why It May Not Work Yet");
  });

  it('badge and heading both derived from displayVerdict — cannot diverge', () => {
    const html = render({ verdict: "SKIP FOR NOW", confidence: 68, finalThought: "Blocker present." });
    // Badge must show the normalised verdict
    expect(html).toContain("SKIP FOR NOW");
    // Heading must match — "Why It Works" must not appear alongside a SKIP FOR NOW badge
    expect(html).not.toContain("Why It Works");
    expect(html).toContain("Why It May Not Work Yet");
  });

  it("null fullAnalysis falls back to DB verdict SKIP → Why It Doesn't Work", () => {
    const html = render(null);
    expect(html).toContain("Why It Doesn");
    expect(html).not.toContain("Why It Works");
  });

  it('normalises whitespace in verdict — "SKIP  FOR  NOW" → Why It May Not Work Yet', () => {
    const html = render({ verdict: "SKIP  FOR  NOW", confidence: 55, finalThought: "Whitespace test." });
    expect(html).toContain("Why It May Not Work Yet");
    expect(html).not.toContain("Why It Works");
  });
});
