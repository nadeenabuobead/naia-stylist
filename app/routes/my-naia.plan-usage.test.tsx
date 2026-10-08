// Focused tests for /my-naia/plan-usage — ownership, empty/edge states, and
// the honest-usage contract (no fabricated counters, no raw billing IDs).
//
// Mirrors the mock/render pattern established in my-naia._index.test.tsx:
// static structure via renderToString (no DOM), loader contract via vi.mock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

// ── Module mocks — hoisted before imports ─────────────────────────────────────

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({ to, children, className, style }: { to: string; children: unknown; className?: string; style?: object }) =>
    createElement("a", { href: to, className, style }, children as any);
  const mockUseLoaderData = vi.fn();
  return { ...actual, Link: mockLink, useLoaderData: mockUseLoaderData };
});

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/plan/entitlement.server", () => ({
  getEntitlementSummary: vi.fn(),
}));

vi.mock("~/styles/naia-design-system.css?url", () => ({ default: "/styles.css" }));

vi.mock("~/components/my-naia/MyNaiaLayout", () => ({
  default: ({ children }: { children: unknown }) => children,
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import { useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import PlanUsagePage, { loader } from "./my-naia.plan-usage";
import { MEMBERSHIP_PRICING, ADDON_CATALOG } from "~/lib/plan/plan-limits.server";

// ── Loader — ownership / auth gate ────────────────────────────────────────────

describe("plan-usage loader — authentication and ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls requireCurrentNaiaCustomer before reading any entitlement data", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", membershipStatus: "MEMBER",
    } as any);
    vi.mocked(getEntitlementSummary).mockResolvedValueOnce({} as any);

    await loader({ request: new Request("http://localhost/my-naia/plan-usage"), params: {}, context: {} } as any);

    expect(requireCurrentNaiaCustomer).toHaveBeenCalledOnce();
    const authOrder = vi.mocked(requireCurrentNaiaCustomer).mock.invocationCallOrder[0];
    const entOrder = vi.mocked(getEntitlementSummary).mock.invocationCallOrder[0];
    expect(authOrder).toBeLessThan(entOrder);
  });

  it("propagates the redirect thrown when no session exists (unauthenticated)", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockImplementationOnce(() => {
      throw new Response(null, { status: 302, headers: { Location: "/auth/shopify/login?return_to=%2Fmy-naia%2Fplan-usage" } });
    });
    await expect(
      loader({ request: new Request("http://localhost/my-naia/plan-usage"), params: {}, context: {} } as any)
    ).rejects.toBeInstanceOf(Response);
    expect(getEntitlementSummary).not.toHaveBeenCalled();
  });

  it("requests entitlement data scoped to the authenticated customer's own id — never a param or query value", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "customer-A", membershipStatus: "MEMBER",
    } as any);
    vi.mocked(getEntitlementSummary).mockResolvedValueOnce({} as any);

    await loader({
      request: new Request("http://localhost/my-naia/plan-usage?customerId=customer-B"),
      params: { customerId: "customer-B" },
      context: {},
    } as any);

    expect(getEntitlementSummary).toHaveBeenCalledWith("customer-A", "MEMBER");
    expect(getEntitlementSummary).not.toHaveBeenCalledWith("customer-B", expect.anything());
  });

  it("does not return the customer id, email, or shopifyCustomerId in the loader payload", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c-secret", email: "private@example.com", shopifyCustomerId: "gid://shopify/Customer/1",
      membershipStatus: "MEMBER",
    } as any);
    vi.mocked(getEntitlementSummary).mockResolvedValueOnce({
      membershipStatus: "MEMBER",
      styleMe: { monthlyLimit: 8, monthlyUsed: 0, resetDate: "1 October" },
      buySkip: { monthlyLimit: 5, monthlyUsed: 0, resetDate: "1 October" },
      vto: { monthlyLimit: 10, monthlyCompleted: 0, monthlyInFlight: 0, resetDate: "1 October" },
      closet: { currentCount: 0, limit: 250, atCapacity: false },
      personalisedTrend: { monthlyLimit: 1, monthlyUsed: null },
      windowLabel: "October 2026",
    } as any);

    const result = await loader({ request: new Request("http://localhost/my-naia/plan-usage"), params: {}, context: {} } as any);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("c-secret");
    expect(serialised).not.toContain("private@example.com");
    expect(serialised).not.toContain("gid://shopify");
  });
});

// ── Component — rendered states ───────────────────────────────────────────────

type Summary = {
  membershipStatus: "NONE" | "MEMBER";
  styleMe: { monthlyLimit: number; monthlyUsed: number; resetDate: string };
  buySkip: { monthlyLimit: number; monthlyUsed: number; resetDate: string };
  vto: { monthlyLimit: number; monthlyCompleted: number; monthlyInFlight: number; resetDate: string };
  closet: { currentCount: number; limit: number; atCapacity: boolean };
  personalisedTrend: { monthlyLimit: number; monthlyUsed: null };
  windowLabel: string;
};

function baseSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    membershipStatus: "MEMBER",
    styleMe: { monthlyLimit: 8, monthlyUsed: 3, resetDate: "1 October" },
    buySkip: { monthlyLimit: 5, monthlyUsed: 1, resetDate: "1 October" },
    vto: { monthlyLimit: 10, monthlyCompleted: 2, monthlyInFlight: 0, resetDate: "1 October" },
    closet: { currentCount: 47, limit: 250, atCapacity: false },
    personalisedTrend: { monthlyLimit: 1, monthlyUsed: null },
    windowLabel: "October 2026",
    ...overrides,
  };
}

function render(summary: Summary): string {
  vi.mocked(useLoaderData).mockReturnValue({
    summary,
    membershipPricing: MEMBERSHIP_PRICING,
    addonCatalog: ADDON_CATALOG,
  });
  return renderToString(<PlanUsagePage />);
}

describe("plan-usage component — MEMBER with partial usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows used/remaining/allowance for StyleMe, Buy or Skip, and VTO", () => {
    const html = render(baseSummary());
    expect(html).toContain("3 of 8 used");
    expect(html).toContain("1 of 5 used");
    expect(html).toContain("2 of 10 used");
  });

  it("shows real closet item count against the real limit, not a monthly-usage framing", () => {
    const html = render(baseSummary());
    expect(html).toContain("47 of 250 items");
    expect(html).not.toContain("47 of 250 used");
  });

  it("shows a reset date derived from the entitlement summary, not a hardcoded string", () => {
    const html = render(baseSummary({ styleMe: { monthlyLimit: 8, monthlyUsed: 3, resetDate: "14 November" } }));
    expect(html).toContain("14 November");
  });

  it("never renders a subscription provider id, raw enum string, or internal debugging metadata", () => {
    const html = render(baseSummary());
    expect(html).not.toMatch(/gid:\/\//);
    expect(html).not.toContain("cus_");
    expect(html).not.toContain("sub_");
  });
});

describe("plan-usage component — zero and exactly-at-limit usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders zero usage without fabricating a positive count", () => {
    const html = render(baseSummary({
      styleMe: { monthlyLimit: 8, monthlyUsed: 0, resetDate: "1 October" },
    }));
    expect(html).toContain("0 of 8 used");
  });

  it("renders exactly-at-limit as exhausted (red bar fill, not understated)", () => {
    const html = render(baseSummary({
      styleMe: { monthlyLimit: 8, monthlyUsed: 8, resetDate: "1 October" },
    }));
    expect(html).toContain("8 of 8 used");
    expect(html).toContain("var(--c-alert");
  });

  it("renders an over-limit historical anomaly without a negative remaining count", () => {
    const html = render(baseSummary({
      styleMe: { monthlyLimit: 8, monthlyUsed: 11, resetDate: "1 October" },
    }));
    expect(html).not.toContain("-3");
    expect(html).toContain("11 sessions used");
    expect(html).toContain("8 included this month");
  });

  it("closet at capacity shows a non-punitive message, not an error string", () => {
    const html = render(baseSummary({ closet: { currentCount: 250, limit: 250, atCapacity: true } }));
    expect(html).toContain("Closet full");
    expect(html).not.toMatch(/ERROR|QUOTA EXCEEDED|LIMIT VIOLATION/);
  });
});

describe("plan-usage component — NONE (no membership) state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not render usage meters or a resets-on date for a non-member", () => {
    const html = render(baseSummary({ membershipStatus: "NONE" }));
    expect(html).not.toContain("This Month");
    expect(html).not.toContain("Usage resets");
  });

  it("renders a 'what you get' marketing list instead of fabricating zero-usage meters", () => {
    const html = render(baseSummary({ membershipStatus: "NONE" }));
    expect(html).toContain("What you get");
    expect(html).toContain("StyleMe — 8 sessions/month");
  });
});

describe("plan-usage component — Personalised Trend Edit (unavailable usage source)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not fabricate a used count when monthlyUsed is null", () => {
    const html = render(baseSummary());
    expect(html).not.toMatch(/\d+ of 1 used/);
    expect(html).toContain("1 included this month");
  });
});

describe("plan-usage component — add-ons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks add-ons as not-yet-purchasable instead of offering a fake checkout", () => {
    const html = render(baseSummary());
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("reflects the authoritative AED 15 price for the VTO +10 pack", () => {
    const html = render(baseSummary());
    expect(html).toContain("+10 Virtual Try-Ons");
    const addonSection = html.slice(html.indexOf("VTO Pack"));
    expect(addonSection.slice(0, 400)).toContain("AED 15");
  });
});

describe("plan-usage component — accessibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a real h1 for the page title and h2 for each section", () => {
    const html = render(baseSummary());
    expect(html).toMatch(/<h1[^>]*>Plans/);
    expect(html).toMatch(/<h2[^>]*>This Month<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>My Closet<\/h2>/);
  });

  it("hides the decorative usage bar from assistive tech since the text equivalent sits beside it", () => {
    const html = render(baseSummary());
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("3 of 8 used");
  });
});

describe("plan-usage component — empty closet / fresh membership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without crashing when every usage source is empty", () => {
    const html = render(baseSummary({
      styleMe: { monthlyLimit: 8, monthlyUsed: 0, resetDate: "1 October" },
      buySkip: { monthlyLimit: 5, monthlyUsed: 0, resetDate: "1 October" },
      vto: { monthlyLimit: 10, monthlyCompleted: 0, monthlyInFlight: 0, resetDate: "1 October" },
      closet: { currentCount: 0, limit: 250, atCapacity: false },
    }));
    expect(html).toContain("0 of 250 items");
  });
});
