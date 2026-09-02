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
    useFetcher: vi.fn(() => ({ state: "idle", data: undefined, submit: vi.fn() })),
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
  itemImageUrl: null,
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
  vtoEnabled: false,
  vtoSupported: false,
  naiaModelIsReady: false,
  outcome: null,
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

// ── Outcome UX regression tests (Phase B) ────────────────────────────────────

function renderWithOutcome(outcome: Record<string, string | null> | null) {
  (useLoaderData as ReturnType<typeof vi.fn>).mockReturnValue({
    ...baseLoader,
    verdict: "SKIP",
    fullAnalysis: { verdict: "SKIP", confidence: 60, finalThought: "Mismatch." },
    outcome,
  });
  return renderToString(React.createElement(BuyOrSkipResult));
}

describe("BuyOrSkipResult — Outcome UX (Phase B)", () => {
  it("A: no saved outcome → WHAT HAPPENED? section renders with option buttons", () => {
    const html = renderWithOutcome(null);
    expect(html).toContain("WHAT HAPPENED");
    // Form is shown — all three option buttons present
    expect(html).toContain("I BOUGHT IT");
    expect(html).toContain("I DIDN'T BUY IT");
    expect(html).toContain("STILL DECIDING");
    // Summary is NOT shown — no decision text at summary level
    expect(html).not.toContain('data-testid="bos-outcome-summary"');
  });

  it("G+H: loader outcome hydrates and renders summary with decision and post-purchase text", () => {
    const html = renderWithOutcome({ decision: "BOUGHT_IT", postPurchaseOutcome: "LOVE_IT" });
    // Summary section is present
    expect(html).toContain('data-testid="bos-outcome-summary"');
    // Decision label
    expect(html).toContain("I BOUGHT IT");
    // Post-purchase label
    expect(html).toContain("LOVE IT");
    // EDIT button is present
    expect(html).toContain("EDIT");
    // Form buttons are NOT shown (isEditing = false)
    expect(html).not.toContain('data-testid="bos-outcome-form"');
  });

  it("G+H: didnt-buy-it outcome hydrates and shows summary without post-purchase text", () => {
    const html = renderWithOutcome({ decision: "DIDNT_BUY_IT", postPurchaseOutcome: null });
    expect(html).toContain("I DIDN'T BUY IT");
    // No post-purchase row
    expect(html).not.toContain("LOVE IT");
    expect(html).not.toContain("IT'S OKAY");
    expect(html).not.toContain("RETURNED IT");
    expect(html).toContain("EDIT");
  });

  it("H: still-deciding outcome shows summary label, no post-purchase", () => {
    const html = renderWithOutcome({ decision: "STILL_DECIDING", postPurchaseOutcome: null });
    expect(html).toContain("STILL DECIDING");
    expect(html).not.toContain("AND HOW DID IT WORK OUT");
  });

  it("I: with no saved outcome, Edit button is absent (form is already open)", () => {
    // When no outcome, form shows directly — no EDIT button needed
    const html = renderWithOutcome(null);
    expect(html).not.toContain('data-testid="bos-outcome-edit"');
  });

  it("M: verdict (BUY/SKIP) does not affect outcome section content", () => {
    // BUY verdict with no outcome — still shows the neutral questionnaire, not an assumed outcome
    (useLoaderData as ReturnType<typeof vi.fn>).mockReturnValue({
      ...baseLoader,
      verdict: "BUY",
      fullAnalysis: { verdict: "BUY", confidence: 85, finalThought: "Good match." },
      outcome: null,
    });
    const html = renderToString(React.createElement(BuyOrSkipResult));
    // No assumed outcome from verdict
    expect(html).not.toContain('data-testid="bos-outcome-summary"');
    // Questionnaire is shown neutrally regardless of verdict
    expect(html).toContain("WHAT HAPPENED");
  });
});
