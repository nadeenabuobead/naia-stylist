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
    // Pre-existing gap (predates B2b3, confirmed failing at frozen HEAD f36ef4e
    // before this fix): the component's "What Happened?" outcome UX added
    // useFetcher after this mock block was last updated, with no mock entry —
    // every test in this file was failing on a data-router invariant. Minimal
    // static mock, no behavioural assertions depend on its return shape.
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

// ── B2b3 — deterministic colour-preference caution ──────────────────────────
//
// Trigger is exactly `!skipResult && fullAnalysis.decisionEvidence
// ?.colourPreferenceEvidence?.status === "conflict"`. No string matching, no
// prose inspection, no re-derivation of the match — the component only ever
// reads the already-computed B2b2 status. See app/routes/buyskip.$id.tsx.

const CAUTION_LABEL = "Worth Keeping in Mind";
const CAUTION_TEXT = "This item includes a colour you usually avoid.";

function conflictEvidence(overrides: Record<string, unknown> = {}) {
  return {
    status: "conflict",
    determinedBy: "customer-declared",
    avoidColours: ["Pink", "Orange", "Yellow", "Green"],
    avoidFamilies: ["pink", "orange", "yellow", "green"],
    declaredColours: ["Pink", "Red", "Beige"],
    declaredFamilies: ["pink", "red-burgundy", "beige-brown"],
    detectedColour: "BEIGE / BURGUNDY / MULTI-PRINT",
    detectedFamilies: ["beige-brown", "red-burgundy"],
    observationConfidence: "high",
    visionUsable: true,
    disagreement: false,
    reason: "declared colour Pink matches avoided family pink",
    ...overrides,
  };
}

describe("BuyOrSkipResult — B2b3 colour-preference caution", () => {
  // A — BUY + conflict
  it("BUY + conflict → caution renders exactly once, BUY verdict and existing colour row unchanged", () => {
    const html = render({
      verdict: "BUY",
      confidence: 88,
      finalThought: "Strong match overall.",
      detailedAnalysis: { color: "Beige and burgundy align with your favourites." },
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence() },
    });
    expect(html).toContain("Why It Works");
    expect(html).toContain("BUY");
    expect(html).toContain("Beige and burgundy align with your favourites.");
    const occurrences = html.split(CAUTION_TEXT).length - 1;
    expect(occurrences).toBe(1);
    expect(html).toContain(CAUTION_LABEL);
  });

  // B — BUY + clear
  it("BUY + clear → no caution", () => {
    const html = render({
      verdict: "BUY",
      confidence: 90,
      finalThought: "Great fit.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence({ status: "clear" }) },
    });
    expect(html).not.toContain(CAUTION_TEXT);
  });

  // C — BUY + unknown
  it("BUY + unknown → no caution", () => {
    const html = render({
      verdict: "BUY",
      confidence: 80,
      finalThought: "Solid pick.",
      decisionEvidence: {
        colourPreferenceEvidence: conflictEvidence({
          status: "unknown",
          determinedBy: "none",
          avoidColours: [],
          declaredColours: [],
        }),
      },
    });
    expect(html).not.toContain(CAUTION_TEXT);
  });

  // D — BUY + no decisionEvidence at all
  it("BUY + no decisionEvidence → no caution, page renders normally", () => {
    const html = render({ verdict: "BUY", confidence: 75, finalThought: "Good choice." });
    expect(html).not.toContain(CAUTION_TEXT);
    expect(html).toContain("Why It Works");
  });

  // E — SKIP + conflict (critical: must never render)
  it("SKIP + conflict → no caution (never shown on SKIP, even with a real conflict)", () => {
    const html = render({
      verdict: "SKIP",
      confidence: 40,
      finalThought: "Fit concerns dominate.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence() },
    });
    expect(html).toContain("Why It Doesn");
    expect(html).not.toContain(CAUTION_TEXT);
  });

  // F — SKIP + clear/unknown
  it("SKIP + clear → no caution", () => {
    const html = render({
      verdict: "SKIP FOR NOW",
      confidence: 55,
      finalThought: "Pause for now.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence({ status: "clear" }) },
    });
    expect(html).not.toContain(CAUTION_TEXT);
  });

  it("SKIP + unknown → no caution", () => {
    const html = render({
      verdict: "SKIP",
      confidence: 45,
      finalThought: "Not quite right.",
      decisionEvidence: {
        colourPreferenceEvidence: conflictEvidence({ status: "unknown", avoidColours: [], declaredColours: [] }),
      },
    });
    expect(html).not.toContain(CAUTION_TEXT);
  });

  // G — multi-colour conflict: wording stays generic, never names a specific colour
  it("BUY + multi-colour conflict (Pink/Red/Beige declared, Pink implicated) → generic wording, no colour named", () => {
    const html = render({
      verdict: "BUY",
      confidence: 70,
      finalThought: "Worth a look.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence() },
    });
    expect(html).toContain(CAUTION_TEXT);
    expect(html).not.toContain("includes Pink");
    expect(html).not.toContain("the colour Pink");
  });

  // H — metallics: UI does no independent colour matching, only reads status
  it("Passport avoid=metallics, candidate Gold, B2b2 status non-conflict → no caution (UI performs no re-matching)", () => {
    const html = render({
      verdict: "BUY",
      confidence: 65,
      finalThought: "Interesting piece.",
      decisionEvidence: {
        colourPreferenceEvidence: conflictEvidence({
          status: "clear",
          avoidColours: ["metallics"],
          avoidFamilies: [],
          declaredColours: ["Gold"],
          declaredFamilies: [],
          reason: "metallics is not a resolvable hue family — no fabricated match",
        }),
      },
    });
    expect(html).not.toContain(CAUTION_TEXT);
  });

  // I — backward compatibility: no / older evidence shape
  it("older decisionEvidence shape with no colourPreferenceEvidence field → renders safely, no caution", () => {
    const html = render({
      verdict: "BUY",
      confidence: 60,
      finalThought: "Backward-compat check.",
      decisionEvidence: { constraintEvidence: { hasHardViolation: false, checks: [] } },
    });
    expect(html).not.toContain(CAUTION_TEXT);
    expect(html).toContain("Why It Works");
  });

  it("fullAnalysis null → renders safely, no caution, no exception", () => {
    const html = render(null);
    expect(html).not.toContain(CAUTION_TEXT);
  });

  // No customer-visible provenance leakage
  it("conflict evidence's internal provenance fields never appear in rendered HTML", () => {
    const html = render({
      verdict: "BUY",
      confidence: 70,
      finalThought: "Worth a look.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence() },
    });
    expect(html).not.toContain("customer-declared");
    expect(html).not.toContain("determinedBy");
    expect(html).not.toContain("observationConfidence");
    expect(html).not.toContain("visionUsable");
    expect(html).not.toContain("disagreement");
  });
});

// ── B5 — Your Wardrobe (B4 evidence) + Your History (B3 evidence) ───────────
//
// The component performs no matching/classification of its own — it only
// translates an already-computed decisionEvidence.wardrobeUtility /
// .outcomeHistory status into customer wording. These tests prove: the
// translation is correct for the supported states, every unsupported/absent
// state renders nothing (never an invented claim in either direction), the
// canonical verdict/heading are never altered by B4/B3 evidence, and older
// records missing these fields render safely.

const WARDROBE_LABEL = "Your Wardrobe";
const HISTORY_LABEL = "Your History";

function wardrobeUtility(overrides: Record<string, unknown> = {}) {
  return {
    redundancy: { status: "no-match" },
    gap: { status: "no-clear-gap" },
    utility: { status: "evidence-only", complementCount: 0, complementItemIds: [] },
    ...overrides,
  };
}

describe("BuyOrSkipResult — B5 Your Wardrobe (B4 gap/redundancy/complement)", () => {
  it("3. gap: fills-gap → 'This fills a gap in your wardrobe.'", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ gap: { status: "fills-gap" } }) },
    });
    expect(html).toContain(WARDROBE_LABEL);
    expect(html).toContain("This fills a gap in your wardrobe.");
  });

  it("4. redundancy: already-enough → 'You already have similar options in your Closet.'", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ redundancy: { status: "already-enough" } }) },
    });
    expect(html).toContain(WARDROBE_LABEL);
    expect(html).toContain("You already have similar options in your Closet.");
  });

  it("5. complement evidence surfaces only when complementCount > 0", () => {
    const withComplement = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ utility: { status: "evidence-only", complementCount: 3, complementItemIds: ["a", "b", "c"] } }) },
    });
    expect(withComplement).toContain("This works with several pieces you already own.");

    const singleComplement = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ utility: { status: "evidence-only", complementCount: 1, complementItemIds: ["a"] } }) },
    });
    expect(singleComplement).toContain("This works with a piece you already own.");

    const noComplement = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility() },
    });
    expect(noComplement).not.toContain("you already own.");
    expect(noComplement).not.toContain(WARDROBE_LABEL);
  });

  it("6. redundancy: unavailable never becomes 'unique' — section does not render on redundancy alone", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ redundancy: { status: "unavailable" } }) },
    });
    expect(html).not.toContain("unique");
    expect(html).not.toContain(WARDROBE_LABEL);
  });

  it("6b. redundancy: no-match never becomes 'unique' or any redundancy claim", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ redundancy: { status: "no-match" } }) },
    });
    expect(html).not.toContain("unique");
    expect(html).not.toContain("similar options");
  });

  it("7. gap: no-clear-gap never becomes 'You don't need this.'", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ gap: { status: "no-clear-gap" } }) },
    });
    expect(html).not.toContain("don't need");
    expect(html).not.toContain("fills a gap");
  });

  it("gap: unavailable renders nothing", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { wardrobeUtility: wardrobeUtility({ gap: { status: "unavailable" } }) },
    });
    expect(html).not.toContain("fills a gap");
    expect(html).not.toContain("don't need");
  });

  it("the 'repetition' background finding is never surfaced to the customer", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: {
        wardrobeUtility: wardrobeUtility({
          gap: {
            status: "no-clear-gap",
            backgroundFinding: { id: "need-work-repetition", title: "You have work pieces, but fewer ways to combine them", body: "...", kind: "repetition" },
          },
        }),
      },
    });
    expect(html).not.toContain("repetition");
    expect(html).not.toContain("fewer ways to combine them");
  });

  it("no internal evidence identifiers/enum names leak into rendered HTML", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: {
        wardrobeUtility: wardrobeUtility({
          redundancy: { status: "already-enough", findingId: "enough-work-top-neutral", title: "You already have enough work neutral tops", body: "...", garmentIds: ["g1", "g2"] },
          gap: { status: "fills-gap", findingId: "need-work", title: "Work is the thinner side of your wardrobe", body: "...", garmentIds: [], kind: "could-use-more" },
        }),
      },
    });
    expect(html).not.toContain("enough-work-top-neutral");
    expect(html).not.toContain("need-work");
    expect(html).not.toContain("DepthFinding");
    expect(html).not.toContain("outfitClassKey");
    expect(html).not.toContain('"g1"');
    expect(html).not.toContain("could-use-more");
  });

  it("13. older record with no wardrobeUtility field renders safely, no Your Wardrobe section", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence({ status: "clear" }) },
    });
    expect(html).not.toContain(WARDROBE_LABEL);
    expect(html).toContain("Why It Works");
  });

  it("14. missing decisionEvidence entirely renders safely", () => {
    const html = render({ verdict: "BUY", confidence: 80, finalThought: "Good fit." });
    expect(html).not.toContain(WARDROBE_LABEL);
    expect(html).toContain("Why It Works");
  });
});

describe("BuyOrSkipResult — B5 Your History (B3 outcome history)", () => {
  it("8. loved outcome surfaces narrowly by category", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { outcomeHistory: { available: true, category: "Top", lovedCount: 2, returnedCount: 0, provenanceIds: ["o1", "o2"] } },
    });
    expect(html).toContain(HISTORY_LABEL);
    expect(html).toContain("loved top purchases like this before.");
    expect(html).not.toContain("returned");
  });

  it("8b. returned outcome surfaces narrowly by category", () => {
    const html = render({
      verdict: "SKIP", confidence: 40, finalThought: "Not a fit.",
      decisionEvidence: { outcomeHistory: { available: true, category: "Bottom", lovedCount: 0, returnedCount: 1, provenanceIds: ["o1"] } },
    });
    expect(html).toContain(HISTORY_LABEL);
    expect(html).toContain("returned bottom purchases like this before.");
    expect(html).not.toContain("loved");
  });

  it("9. a single outcome never produces sweeping taste language", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { outcomeHistory: { available: true, category: "Top", lovedCount: 1, returnedCount: 0, provenanceIds: ["o1"] } },
    });
    expect(html).toContain("loved top purchases like this before.");
    expect(html).not.toMatch(/you love/i);
    expect(html).not.toMatch(/your (go-to|favourite|favorite)/i);
  });

  it("outcomeHistory.available === false renders nothing", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { outcomeHistory: { available: false } },
    });
    expect(html).not.toContain(HISTORY_LABEL);
  });

  it("13. older record with no outcomeHistory field renders safely", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { colourPreferenceEvidence: conflictEvidence({ status: "clear" }) },
    });
    expect(html).not.toContain(HISTORY_LABEL);
  });

  it("no provenance IDs leak into rendered HTML", () => {
    const html = render({
      verdict: "BUY", confidence: 80, finalThought: "Good fit.",
      decisionEvidence: { outcomeHistory: { available: true, category: "Top", lovedCount: 1, returnedCount: 0, provenanceIds: ["outcome-record-xyz-123"] } },
    });
    expect(html).not.toContain("outcome-record-xyz-123");
  });
});

describe("BuyOrSkipResult — B5 does not alter the canonical verdict, and preserves hard-constraint authority", () => {
  it("1. BUY renders the existing canonical verdict unchanged alongside B4/B3 evidence", () => {
    const html = render({
      verdict: "BUY", confidence: 85, finalThought: "Strong match.",
      decisionEvidence: {
        wardrobeUtility: wardrobeUtility({ gap: { status: "fills-gap" } }),
        outcomeHistory: { available: true, category: "Top", lovedCount: 1, returnedCount: 0, provenanceIds: ["o1"] },
      },
    });
    expect(html).toContain("BUY");
    expect(html).toContain("Why It Works");
    expect(html).toContain(WARDROBE_LABEL);
    expect(html).toContain(HISTORY_LABEL);
  });

  it("2. SKIP renders the existing canonical verdict unchanged alongside B4/B3 evidence", () => {
    const html = render({
      verdict: "SKIP", confidence: 20, finalThought: "Clear mismatch.",
      decisionEvidence: {
        wardrobeUtility: wardrobeUtility({ redundancy: { status: "already-enough" } }),
        outcomeHistory: { available: true, category: "Top", lovedCount: 0, returnedCount: 1, provenanceIds: ["o1"] },
      },
    });
    expect(html).toContain("SKIP");
    expect(html).toContain("Why It Doesn");
    expect(html).toContain(WARDROBE_LABEL);
    expect(html).toContain(HISTORY_LABEL);
  });

  it("12. a genuine hard-constraint SKIP reason text is unaffected by B4/B3 evidence being present", () => {
    const html = render({
      verdict: "SKIP",
      confidence: 15,
      finalThought: "Conflicts with a dressing requirement on your Passport: Keep arms covered.",
      decisionEvidence: {
        constraintEvidence: { hasHardViolation: true, checks: [{ label: "Keep arms covered", state: "violated", reason: "sleeveless construction" }] },
        wardrobeUtility: wardrobeUtility({ gap: { status: "fills-gap" } }),
      },
    });
    expect(html).toContain("Conflicts with a dressing requirement on your Passport: Keep arms covered.");
    expect(html).toContain("SKIP");
  });

  it("10. B5 performs no verdict recalculation — displayVerdict still derives solely from fullAnalysis.verdict/DB verdict", () => {
    // Rich B4/B3 evidence that would, under an invented rule, suggest BUY — the
    // rendered verdict must still be the canonical SKIP from fullAnalysis.verdict.
    const html = render({
      verdict: "SKIP",
      confidence: 30,
      finalThought: "Still a skip despite wardrobe evidence.",
      decisionEvidence: {
        wardrobeUtility: wardrobeUtility({ gap: { status: "fills-gap" }, utility: { status: "evidence-only", complementCount: 5, complementItemIds: ["a", "b", "c", "d", "e"] } }),
        outcomeHistory: { available: true, category: "Top", lovedCount: 3, returnedCount: 0, provenanceIds: ["o1", "o2", "o3"] },
      },
    });
    expect(html).toContain("Why It Doesn");
    expect(html).not.toContain("Why It Works");
  });

  it("B2b3 BUY-only caution still renders exactly once, unduplicated, alongside new B4/B3 sections", () => {
    const html = render({
      verdict: "BUY",
      confidence: 88,
      finalThought: "Strong match overall.",
      decisionEvidence: {
        colourPreferenceEvidence: conflictEvidence(),
        wardrobeUtility: wardrobeUtility({ gap: { status: "fills-gap" } }),
        outcomeHistory: { available: true, category: "Top", lovedCount: 1, returnedCount: 0, provenanceIds: ["o1"] },
      },
    });
    const occurrences = html.split(CAUTION_TEXT).length - 1;
    expect(occurrences).toBe(1);
    expect(html).toContain(WARDROBE_LABEL);
    expect(html).toContain(HISTORY_LABEL);
  });

  it("11. SKIP does not gain the BUY-only B2b3 caution even with B4/B3 evidence present", () => {
    const html = render({
      verdict: "SKIP",
      confidence: 30,
      finalThought: "Fit concerns dominate.",
      decisionEvidence: {
        colourPreferenceEvidence: conflictEvidence(),
        wardrobeUtility: wardrobeUtility({ gap: { status: "fills-gap" } }),
      },
    });
    expect(html).not.toContain(CAUTION_TEXT);
    expect(html).toContain(WARDROBE_LABEL);
  });
});
