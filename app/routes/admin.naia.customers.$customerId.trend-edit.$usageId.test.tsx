// app/routes/admin.naia.customers.$customerId.trend-edit.$usageId.test.tsx
//
// Proves the Admin Customer 360 Trend Edit detail page renders the actual
// complete Personalised Trend Edit report — via the same TrendEditReportBody
// component the customer's own My Trend Edits page renders — not a
// database-inspector summary. Covers:
//   - the historical "not stored" message is unchanged for a null snapshot
//   - every substantive customer-facing section (01-06) renders from a
//     stored snapshot
//   - the NADINE recommendation card is gated behind
//     !worthInvestingStatement exactly as the customer saw it (regression
//     for the bug where Admin showed the card unconditionally)
//   - the NADINE "VIEW PIECE" link renders
//   - the editorial season resolved onto the snapshot is shown
//   - no raw JSON, schemaVersion, or internal id ever appears in the
//     rendered HTML

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({ to, children, style }: { to: string; children: unknown; style?: object }) =>
    createElement("a", { href: to, style }, children as any);
  return {
    ...actual,
    Link: mockLink,
    useLoaderData: vi.fn(),
    UNSAFE_withComponentProps: (Component: any) => Component,
  };
});
vi.mock("~/lib/internal-auth.server", () => ({ requireAdminSession: vi.fn() }));
vi.mock("~/lib/admin/customer-360.server", () => ({ getAdminCustomerTrendEditDetail: vi.fn() }));
vi.mock("~/lib/trend-evidence.server", () => ({ hydrateShopperEditImages: vi.fn() }));

import { useLoaderData } from "react-router";
import { getAdminCustomerTrendEditDetail } from "~/lib/admin/customer-360.server";
import { hydrateShopperEditImages } from "~/lib/trend-evidence.server";
import AdminTrendEditDetailPage, { loader } from "./admin.naia.customers.$customerId.trend-edit.$usageId";
import React from "react";

const BASE_EDIT = {
  subTitle: "Your personal read",
  yourVersion: "This direction suits you because of your fit preferences.",
  evidenceStyleDna: "Your style DNA reads as clean-polished.",
  evidencePassportSays: "Your lifestyle signals formal occasions.",
  evidenceClosetItems: [],
  evidenceReviews: null,
  lowDataNotice: null,
  yourBestRouteIn: "Start with the blazer.",
  routeInItems: [],
  aLookToTry: "A longline blazer with wide-leg trousers.",
  lookToTryItems: [],
  partToTake: ["A longline blazer", "Clean wide-leg trousers"],
  worthInvestingStatement: null as string | null,
  coveredClosetCategories: [],
  partToLeave: ["Rigid matching suits"],
  theBalanceToProtect: "Keep one tailored piece loose and fluid.",
};

const NADINE = {
  handle: "modern-blazer",
  title: "The Modern Blazer",
  url: "https://example.com/products/modern-blazer",
  imageUrl: "https://example.com/blazer.jpg",
  gapCategory: "Tailoring",
  personalExplanation: "Fills the structured-anchor gap in your closet.",
};

function detailWith(overrides: Record<string, unknown>) {
  return {
    hasSnapshot: true,
    reportTitle: "Modern Tailoring",
    reportSeason: "Spring 2026",
    periodLabel: "October 2026",
    createdAt: "2026-10-01T00:00:00.000Z",
    snapshot: {
      schemaVersion: "trend-edit-snapshot-v1",
      reportSlug: "modern-tailoring",
      reportTitle: "Modern Tailoring",
      reportSeason: "Spring 2026",
      generatedAt: "2026-10-01T00:00:00.000Z",
      edit: BASE_EDIT,
      nadineRecommendation: NADINE,
      ...overrides,
    },
  };
}

describe("Admin Trend Edit detail — historical row with no snapshot (unchanged)", () => {
  it("shows the honest 'not stored' message and never fabricates content", () => {
    (useLoaderData as any).mockReturnValue({
      customerId: "cust-A",
      detail: { hasSnapshot: false, snapshot: null, reportTitle: "Modern Tailoring", reportSeason: null, periodLabel: "September 2026", createdAt: "2026-09-01T00:00:00.000Z" },
    });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    expect(html).toContain("Historical personalised content wasn&#x27;t stored for this generation.");
    expect(html).not.toContain("01 / Why this matters");
  });
});

describe("Admin Trend Edit detail — full snapshot renders the actual report", () => {
  it("renders every substantive section (01-06) via the shared report body", () => {
    (useLoaderData as any).mockReturnValue({ customerId: "cust-A", detail: detailWith({}) });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    for (const label of [
      "01 / Why this matters to you",
      "02 / Your nAia Evidence",
      "03 / Your route in",
      "04 / A look to try",
      "05 / Worth investing in",
      "06 / Hold off on",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(BASE_EDIT.yourVersion);
    expect(html).toContain(BASE_EDIT.aLookToTry);
  });

  it("shows the resolved editorial season alongside the title", () => {
    (useLoaderData as any).mockReturnValue({ customerId: "cust-A", detail: detailWith({}) });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    expect(html).toContain("Spring 2026");
  });

  it("renders the NADINE recommendation card with its VIEW PIECE link when worthInvestingStatement is null (Outcome A/B)", () => {
    (useLoaderData as any).mockReturnValue({ customerId: "cust-A", detail: detailWith({ edit: { ...BASE_EDIT, worthInvestingStatement: null } }) });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    expect(html).toContain("A NADINE piece for this gap");
    expect(html).toContain(NADINE.title);
    expect(html).toContain("VIEW PIECE");
    expect(html).toContain(NADINE.url);
  });

  it("does NOT render the NADINE card when worthInvestingStatement is set (Outcome C) — matches what the customer actually saw", () => {
    (useLoaderData as any).mockReturnValue({
      customerId: "cust-A",
      detail: detailWith({ edit: { ...BASE_EDIT, worthInvestingStatement: "This whole look is worth investing in." } }),
    });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    expect(html).not.toContain("A NADINE piece for this gap");
    expect(html).not.toContain(NADINE.title);
    expect(html).toContain("This whole look is worth investing in.");
  });

  it("never leaks raw JSON or schemaVersion into the rendered HTML", () => {
    (useLoaderData as any).mockReturnValue({ customerId: "cust-A", detail: detailWith({}) });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    expect(html).not.toContain("schemaVersion");
    expect(html).not.toContain("trend-edit-snapshot-v1");
  });

  it("customerId appears only in the back-navigation link's href, never as visible report content", () => {
    (useLoaderData as any).mockReturnValue({ customerId: "cust-A", detail: detailWith({}) });
    const html = renderToString(React.createElement(AdminTrendEditDetailPage));
    // Strip the one legitimate occurrence (the back link's href) and confirm
    // the customerId does not appear anywhere else in the markup.
    const withoutBackLink = html.replace('href="/admin/naia/customers/cust-A"', "");
    expect(withoutBackLink).not.toContain("cust-A");
  });
});

describe("Admin Trend Edit detail — loader re-resolves images without touching the stored snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the exact saved snapshot with a freshly re-resolved image, not the (possibly dead) persisted one", async () => {
    const storedDetail = detailWith({ edit: { ...BASE_EDIT, evidenceClosetItems: [{ name: "Blazer", imageUrl: "https://stale.example.com/old.jpg", closetItemId: "item-1", category: "TOPS", roleNote: "anchor" }] } });
    // Captured before the loader runs: it reassigns detail.snapshot.edit
    // (same object reference as storedDetail) to the rehydrated result, so
    // asserting against storedDetail.snapshot.edit afterwards would compare
    // against the already-rehydrated value instead of the pre-call one.
    const originalEditSnapshot = JSON.parse(JSON.stringify(storedDetail.snapshot.edit));
    (getAdminCustomerTrendEditDetail as any).mockResolvedValue(storedDetail);
    (hydrateShopperEditImages as any).mockImplementation(async (edit: any) => ({
      ...edit,
      evidenceClosetItems: edit.evidenceClosetItems.map((item: any) => ({ ...item, imageUrl: "https://fresh.example.com/new.jpg" })),
    }));

    const response = await loader({
      request: new Request("http://localhost/admin/naia/customers/cust-A/trend-edit/usage-1"),
      params: { customerId: "cust-A", usageId: "usage-1" },
      context: {} as any,
    } as any);
    const body = await (response as Response).json();

    expect(hydrateShopperEditImages).toHaveBeenCalledWith(originalEditSnapshot, "cust-A");
    expect(body.detail.snapshot.edit.evidenceClosetItems[0].imageUrl).toBe("https://fresh.example.com/new.jpg");
    // Everything else about the stored snapshot — text, names, role notes — is untouched.
    expect(body.detail.snapshot.edit.yourVersion).toBe(BASE_EDIT.yourVersion);
    expect(body.detail.snapshot.edit.evidenceClosetItems[0].name).toBe("Blazer");
  });

  it("never calls hydrateShopperEditImages for a historical row with no stored snapshot", async () => {
    (getAdminCustomerTrendEditDetail as any).mockResolvedValue({
      hasSnapshot: false,
      snapshot: null,
      reportTitle: "Modern Tailoring",
      reportSeason: null,
      periodLabel: "September 2026",
      createdAt: "2026-09-01T00:00:00.000Z",
    });

    await loader({
      request: new Request("http://localhost/admin/naia/customers/cust-A/trend-edit/usage-2"),
      params: { customerId: "cust-A", usageId: "usage-2" },
      context: {} as any,
    } as any);

    expect(hydrateShopperEditImages).not.toHaveBeenCalled();
  });
});
