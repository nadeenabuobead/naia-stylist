// app/routes/admin.naia.customers.buyskip-decision-evidence-compat.test.tsx
//
// B2b1 backward-compatibility proof: historical decisionEvidence rows were
// persisted under schema v1 (no colourPreferenceEvidence). Proves the admin
// detail page renders v1 rows exactly as it always did, renders v2 rows
// (with the new field) correctly for all three statuses, and never throws
// on either shape. No migration required — this is read-path compatibility
// only, proven by actually rendering the real component.

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({ to, children, className }: { to: string; children: unknown; className?: string }) =>
    createElement("a", { href: to, className }, children as any);
  return {
    ...actual,
    Link: mockLink,
    useLoaderData: vi.fn(),
    UNSAFE_withComponentProps: (Component: any) => Component,
    data: (val: unknown) => val,
    redirect: (url: string) => url,
  };
});
vi.mock("~/lib/internal-auth.server", () => ({ requireAdminSession: vi.fn() }));
vi.mock("~/lib/admin/buyskip-admin.server", () => ({ getAdminCustomerBuySkipUploadDetail: vi.fn() }));

import { useLoaderData } from "react-router";
import AdminBuySkipUploadDetailPage from "./admin.naia.customers.$customerId.buyskip.$analysisId";
import React from "react";

const baseUpload = {
  id: "analysis-1",
  createdAt: new Date(0).toISOString(),
  displayVerdict: "BUY",
  itemType: "Blazer",
  category: "Top",
  reasoning: "Looks great on you.",
  confidence: 85,
  thumbnailUrl: null,
  outcome: null,
  hasDecisionEvidence: true,
  verdictOverridden: false,
  imageUrl: null,
};

// The exact old B0/B1 shape — schema v1, no colourPreferenceEvidence at all.
const V1_DECISION_EVIDENCE = {
  productFacts: { category: { value: "Top", status: "known", provenance: "customer-declared" } },
  duplicateEvidence: { overlap: "no-supported-overlap", matches: [], sameSlotCandidateCount: 0 },
  constraintEvidence: { hasHardViolation: false, checks: [], deferredToResolvedPassport: false },
  wardrobeNeed: { status: "unavailable", reason: "Wardrobe Intelligence is not yet wired into Buy/Skip." },
  passportAlignment: "available",
  tasteEvidence: "unavailable",
  provenance: { computedAt: "2026-09-01T00:00:00.000Z", schemaVersion: "buyskip-decision-evidence-v1" },
};

function v2DecisionEvidence(colourStatus: "conflict" | "clear" | "unknown") {
  return {
    ...V1_DECISION_EVIDENCE,
    colourPreferenceEvidence: {
      status: colourStatus,
      detectedColour: colourStatus === "unknown" ? null : "red",
      avoidColours: colourStatus === "unknown" ? [] : ["red"],
      reason: colourStatus === "conflict"
        ? 'Detected colour "red" appears to be a colour this customer usually avoids. Advisory only — does not affect the verdict on its own.'
        : colourStatus === "clear"
          ? "Detected colour does not match any colour this customer usually avoids."
          : "No avoid-colour preferences on file.",
    },
    provenance: { computedAt: "2026-10-05T00:00:00.000Z", schemaVersion: "buyskip-decision-evidence-v2" },
  };
}

function render(decisionEvidence: unknown) {
  (useLoaderData as ReturnType<typeof vi.fn>).mockReturnValue({
    customerId: "cust-1",
    upload: { ...baseUpload, fullAnalysis: { verdict: "BUY", decisionEvidence } },
  });
  return renderToString(React.createElement(AdminBuySkipUploadDetailPage));
}

describe("B2b1 backward compatibility — v1 historical rows (no colourPreferenceEvidence)", () => {
  it("renders with no exception", () => {
    expect(() => render(V1_DECISION_EVIDENCE)).not.toThrow();
  });

  it("Hard-Constraint Evidence renders exactly as before — 'No declared hard requirements to check.'", () => {
    const html = render(V1_DECISION_EVIDENCE);
    expect(html).toContain("Hard-Constraint Evidence");
    expect(html).toContain("No declared hard requirements to check.");
  });

  it("Colour Preference section does not render at all for a v1 row — absence, not a crash", () => {
    const html = render(V1_DECISION_EVIDENCE);
    expect(html).not.toContain("Colour Preference");
  });

  it("every other section (Product Facts, Duplicate Evidence, Wardrobe Need) still renders", () => {
    const html = render(V1_DECISION_EVIDENCE);
    expect(html).toContain("Product Facts");
    expect(html).toContain("Duplicate Evidence");
    expect(html).toContain("Wardrobe Need");
  });
});

describe("B2b1 backward compatibility — v2 rows, all three colour statuses", () => {
  it('status="conflict" renders advisory wording, explicitly NOT as a violation', () => {
    const html = render(v2DecisionEvidence("conflict"));
    expect(html).toContain("Colour Preference");
    expect(html).toContain("advisory, not a violation");
    expect(html).toContain("usually avoids");
    expect(html).not.toContain("Colour Preference — VIOLATION");
  });

  it('status="clear" renders the clear reason, no advisory flag', () => {
    const html = render(v2DecisionEvidence("clear"));
    expect(html).toContain("Colour Preference");
    expect(html).toContain("does not match any colour this customer usually avoids");
    expect(html).not.toContain("advisory, not a violation");
  });

  it('status="unknown" renders the unknown reason, no advisory flag, no exception', () => {
    expect(() => render(v2DecisionEvidence("unknown"))).not.toThrow();
    const html = render(v2DecisionEvidence("unknown"));
    expect(html).toContain("Colour Preference");
    expect(html).toContain("No avoid-colour preferences on file.");
  });

  it("v2's Hard-Constraint Evidence section is unaffected by colourPreferenceEvidence's presence", () => {
    const html = render(v2DecisionEvidence("conflict"));
    expect(html).toContain("No declared hard requirements to check.");
  });
});

describe("B2b1 backward compatibility — no decisionEvidence at all (pre-foundation legacy rows)", () => {
  it("renders with no exception when fullAnalysis.decisionEvidence is entirely absent", () => {
    expect(() => render(undefined)).not.toThrow();
  });
});
