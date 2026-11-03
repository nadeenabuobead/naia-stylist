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
import PlanUsagePage, { loader, CUSTOMER_FACING_ADDON_LABELS } from "./my-naia.plan-usage";
import { MEMBERSHIP_PRICING, ADDON_CATALOG } from "~/lib/plan/plan-limits.server";

const CUSTOMER_FACING_ADDONS = ADDON_CATALOG.filter((a) => CUSTOMER_FACING_ADDON_LABELS.has(a.label));

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
      personalisedTrend: { monthlyLimit: 1, monthlyUsed: 0 },
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
  personalisedTrend: { monthlyLimit: number; monthlyUsed: number };
  windowLabel: string;
};

function baseSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    membershipStatus: "MEMBER",
    styleMe: { monthlyLimit: 8, monthlyUsed: 3, resetDate: "1 October" },
    buySkip: { monthlyLimit: 5, monthlyUsed: 1, resetDate: "1 October" },
    vto: { monthlyLimit: 10, monthlyCompleted: 2, monthlyInFlight: 0, resetDate: "1 October" },
    closet: { currentCount: 47, limit: 250, atCapacity: false },
    personalisedTrend: { monthlyLimit: 1, monthlyUsed: 0 },
    windowLabel: "October 2026",
    ...overrides,
  };
}

function render(summary: Summary, addonCatalog = CUSTOMER_FACING_ADDONS): string {
  // Defaults to the filtered list the real loader actually returns — not the
  // full ADDON_CATALOG — so component tests reflect what customers see.
  vi.mocked(useLoaderData).mockReturnValue({
    summary,
    membershipPricing: MEMBERSHIP_PRICING,
    addonCatalog,
  });
  return renderToString(<PlanUsagePage />);
}

describe("plan-usage component — MEMBER with partial usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows used/remaining/allowance for StyleMe, Buy or Skip, and VTO", () => {
    const html = render(baseSummary());
    expect(html).toContain("3 of 8 used");
    expect(html).toContain("1 of 5 used");
    // VTO uses its own always-"used · included this month" copy format,
    // independent of usageLabel()'s "of"/over-limit split used by every
    // other row — see my-naia.plan-usage.tsx's vtoValue.
    expect(html).toContain("2 used · 10 included this month");
  });

  it("VTO always renders 'used · included this month', even exactly at or over the limit — not the 'of' phrasing the other rows use", () => {
    const atLimit = render(baseSummary({ vto: { monthlyLimit: 10, monthlyCompleted: 10, monthlyInFlight: 0, resetDate: "1 October" } }));
    expect(atLimit).toContain("10 used · 10 included this month");
    expect(atLimit).not.toContain("10 of 10 used");

    const overLimit = render(baseSummary({ vto: { monthlyLimit: 10, monthlyCompleted: 12, monthlyInFlight: 0, resetDate: "1 October" } }));
    expect(overLimit).toContain("12 used · 10 included this month");
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

describe("plan-usage component — Personalised Trend Edit (real usage count, PersonalisedTrendEditUsage)", () => {
  // Product decision narrowed, not reversed: monthlyUsed is no longer a
  // permanently-null placeholder (190fbdb-era "no persisted usage event
  // exists yet") — PersonalisedTrendEditUsage now makes it truthful, same
  // honesty contract every other metered feature already has.
  beforeEach(() => vi.clearAllMocks());

  it("13. shows a truthful 0 of 1 when nothing has been consumed this period", () => {
    const html = render(baseSummary({ personalisedTrend: { monthlyLimit: 1, monthlyUsed: 0 } }));
    expect(html).toContain("0 of 1 used");
  });

  it("14. shows a truthful 1 of 1 — exhausted, not understated — when the single monthly edit is consumed", () => {
    const html = render(baseSummary({ personalisedTrend: { monthlyLimit: 1, monthlyUsed: 1 } }));
    expect(html).toContain("1 of 1 used");
    expect(html).toContain("var(--c-alert");
  });

  it("15. an over-limit historical anomaly (enforcement disabled) renders truthfully, never a negative remaining count", () => {
    const html = render(baseSummary({ personalisedTrend: { monthlyLimit: 1, monthlyUsed: 2 } }));
    // usageLabel never computes "remaining" via subtraction — it only ever
    // renders "X of Y used" or, over-limit, "X unit used · Y included this
    // month" — so there is structurally no negative number to render here.
    expect(html).toContain("2 edits used · 1 included this month");
    expect(html).not.toContain("-1 ");
    expect(html).not.toContain("−1"); // unicode minus, in case of a future formatting change
  });

  it("NONE (no membership) never renders a Personalised Trend Edit usage count at all", () => {
    const html = render(baseSummary({ membershipStatus: "NONE", personalisedTrend: { monthlyLimit: 0, monthlyUsed: 0 } }));
    expect(html).toContain("What you get"); // NONE renders the marketing list, not usage meters
    expect(html).not.toMatch(/\d+ of \d+ used/);
  });
});

describe("plan-usage component — add-ons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks add-ons as not-yet-purchasable instead of offering a fake checkout", () => {
    const html = render(baseSummary());
    expect(html).toContain("Coming soon");
    // Scoped to the Add-ons section specifically — the membership section
    // above it has a real, backend-connected Subscribe button, but add-on
    // purchase is still unimplemented and must not render a fake checkout
    // control of its own.
    const addonsSection = html.slice(html.indexOf("Add-ons"), html.indexOf("Add-ons") + 2000);
    expect(addonsSection).not.toContain("<form");
    expect(addonsSection).not.toContain("<button");
  });

  it("reflects the authoritative AED 10 price for the VTO +10 pack", () => {
    const html = render(baseSummary());
    expect(html).toContain("+10 Virtual Try-Ons");
    const addonSection = html.slice(html.indexOf("VTO Pack"));
    expect(addonSection.slice(0, 400)).toContain("AED 10");
  });
});

describe("plan-usage component — membership Subscribe buttons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a NONE customer sees both Subscribe buttons with the correct AED 39/AED 299 prices", () => {
    const html = render(baseSummary({ membershipStatus: "NONE" }));
    expect(html).toContain("<button");
    expect(html).toContain(`Subscribe Monthly — AED ${MEMBERSHIP_PRICING.monthly.amount}`);
    expect(html).toContain(`Choose Annual — AED ${MEMBERSHIP_PRICING.annual.amount}`);
  });

  it("a MEMBER customer (already subscribed) does not see Subscribe buttons", () => {
    const html = render(baseSummary({ membershipStatus: "MEMBER" }));
    expect(html).not.toContain("Subscribe Monthly");
    expect(html).not.toContain("Choose Annual");
  });
});

// ── Customer-facing add-on allowlist ──────────────────────────────────────────
// Current approved package is only StyleMe Pack (+5, AED 15) and VTO Pack
// (+10, AED 10). ADDON_CATALOG in plan-limits.server.ts also holds four
// legacy/internal entries (Buy or Skip Pack, Trend Edit Add-on, nAia Boost,
// Closet Expansion) that are not approved for customer display yet — they
// must stay out of the rendered page without being deleted from the shared
// catalog, in case other code comes to depend on them later.

describe("plan-usage loader — customer-facing add-on allowlist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loader returns only the two approved add-ons, in the real rendering path", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({
      id: "c1", membershipStatus: "MEMBER",
    } as any);
    vi.mocked(getEntitlementSummary).mockResolvedValueOnce({} as any);

    const result = await loader({ request: new Request("http://localhost/my-naia/plan-usage"), params: {}, context: {} } as any);

    expect(result.addonCatalog.map((a: any) => a.label)).toEqual(["StyleMe Pack", "VTO Pack"]);
  });
});

describe("plan-usage component — only approved add-ons render", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1. StyleMe +5 renders at AED 15", () => {
    const html = render(baseSummary());
    const section = html.slice(html.indexOf("StyleMe Pack"), html.indexOf("StyleMe Pack") + 400);
    expect(section).toContain("+5 StyleMe sessions");
    expect(section).toContain("AED 15");
  });

  it("2. VTO +10 renders at AED 10", () => {
    const html = render(baseSummary());
    const section = html.slice(html.indexOf("VTO Pack"), html.indexOf("VTO Pack") + 400);
    expect(section).toContain("+10 Virtual Try-Ons");
    expect(section).toContain("AED 10");
  });

  it("3. Buy or Skip Pack does not render", () => {
    const html = render(baseSummary());
    expect(html).not.toContain("Buy or Skip Pack");
  });

  it("4. Trend Edit Add-on does not render", () => {
    const html = render(baseSummary());
    expect(html).not.toContain("Trend Edit Add-on");
  });

  it("5. nAia Boost does not render", () => {
    const html = render(baseSummary());
    expect(html).not.toContain("nAia Boost");
  });

  it("6. Closet Expansion does not render", () => {
    const html = render(baseSummary());
    expect(html).not.toContain("Closet Expansion");
  });

  it("7. shared legacy catalog entries remain intact in ADDON_CATALOG for other code that may depend on them", () => {
    const labels = ADDON_CATALOG.map((a) => a.label);
    expect(labels).toContain("Buy or Skip Pack");
    expect(labels).toContain("Trend Edit Add-on");
    expect(labels).toContain("nAia Boost");
    expect(labels).toContain("Closet Expansion");
    // The allowlist filters a view of the catalog — it never mutates the source array.
    expect(ADDON_CATALOG.length).toBeGreaterThan(CUSTOMER_FACING_ADDON_LABELS.size);
  });

  it("8. no fake checkout/action appears alongside the two approved add-ons", () => {
    const html = render(baseSummary());
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/href="\/checkout/);
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
