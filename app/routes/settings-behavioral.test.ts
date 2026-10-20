// app/routes/settings-behavioral.test.ts
//
// Behavioral (not source-text) coverage for settings.tsx's real loader/action,
// following the same pattern phase1-synthetic-integration.test.ts established:
// TWO synthetic customers, prisma (~/db.server) and every service dependency
// mocked, the REAL exported loader/action invoked directly. settings.test.ts /
// settings-coverage-gaps.test.ts assert on the route's SOURCE TEXT (does it
// call requireCurrentNaiaCustomer, does it avoid a customerId param, etc.) —
// useful as a regression tripwire, but they never actually run the code. This
// file closes that gap for the four areas explicitly in scope: authentication,
// customer ownership, account deletion, and access to personal information.
//
// Run: npx vitest run app/routes/settings-behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => {
  const naiaSessionFindUnique = vi.fn();
  const naiaModelFindUnique = vi.fn().mockResolvedValue(null);
  return {
    default: {
      naiaSession: {
        findUnique: naiaSessionFindUnique,
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      naiaModel: { findUnique: naiaModelFindUnique },
    },
  };
});

vi.mock("~/lib/customer-privacy.server", () => ({
  compileCustomerExport: vi.fn(),
  eraseCustomerData: vi.fn(),
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  deleteNaiaModelPhoto: vi.fn().mockResolvedValue({ ok: true }),
  withdrawSaveModelConsent: vi.fn().mockResolvedValue({ failedAssets: [] }),
}));

vi.mock("~/lib/ai/fashn-tryon-service.server", () => ({
  deleteCustomerVtoResults: vi.fn().mockResolvedValue({ failedAssets: [] }),
  customerHasVtoResults: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/buy-or-skip-privacy.server", () => ({
  deleteCustomerBosImages: vi.fn().mockResolvedValue({ failedAssets: [] }),
  customerHasBosImages: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/closet-photo-privacy.server", () => ({
  deleteAllClosetPhotos: vi.fn().mockResolvedValue({ failedAssets: [] }),
  customerHasClosetPhotos: vi.fn().mockResolvedValue(false),
}));

import prisma from "~/db.server";
import { compileCustomerExport, eraseCustomerData } from "~/lib/customer-privacy.server";
import { loader, action } from "./settings";

const mockNaiaFindUnique = () => (prisma as any).naiaSession.findUnique as ReturnType<typeof vi.fn>;
const mockCompileExport = () => compileCustomerExport as ReturnType<typeof vi.fn>;
const mockEraseData = () => eraseCustomerData as ReturnType<typeof vi.fn>;

// ── Synthetic customers — never real data ─────────────────────────────────────

const CUSTOMER_A = { id: "synthetic-customer-A", firstName: "A", lastName: "Test", email: "a@example.invalid" };
const CUSTOMER_B = { id: "synthetic-customer-B", firstName: "B", lastName: "Test", email: "b@example.invalid" };

function sessionFor(customer: typeof CUSTOMER_A) {
  return { tokenHash: "irrelevant-in-mock", expiresAt: new Date(Date.now() + 10_000_000), customer };
}

function requestAs(customer: typeof CUSTOMER_A, method: string, body?: Record<string, string>) {
  const headers = new Headers({ Cookie: `__naia_tok=raw-token-for-${customer.id}` });
  mockNaiaFindUnique().mockResolvedValueOnce(sessionFor(customer));
  const init: RequestInit = { method, headers };
  if (body) {
    const form = new URLSearchParams(body);
    init.body = form;
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  return new Request("https://example.invalid/settings", init);
}

function requestUnauthenticated(method: string, body?: Record<string, string>) {
  const init: RequestInit = { method };
  if (body) init.body = new URLSearchParams(body);
  return new Request("https://example.invalid/settings", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).naiaModel.findUnique.mockResolvedValue(null);
});

describe("settings.tsx loader — authentication gate", () => {
  it("an unauthenticated request never reaches prisma.naiaModel.findUnique", async () => {
    await expect(loader({ request: requestUnauthenticated("GET"), params: {}, context: {} } as any)).rejects.toBeTruthy();
    expect((prisma as any).naiaModel.findUnique).not.toHaveBeenCalled();
  });

  it("a real session resolves the loader for that exact customer", async () => {
    const res: any = await loader({ request: requestAs(CUSTOMER_A, "GET"), params: {}, context: {} } as any);
    expect(res.data.email).toBe(CUSTOMER_A.email);
    expect((prisma as any).naiaModel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_A.id } }),
    );
  });
});

describe("settings.tsx action — customer ownership (request-data-export)", () => {
  it("customer A's export call passes customer A's id, never customer B's", async () => {
    mockCompileExport().mockResolvedValue({ customer: { id: CUSTOMER_A.id } });
    await action({ request: requestAs(CUSTOMER_A, "POST", { intent: "request-data-export" }), params: {}, context: {} } as any);
    expect(mockCompileExport()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockCompileExport()).not.toHaveBeenCalledWith(CUSTOMER_B.id);
  });

  it("customer B's export call is independently scoped to customer B's id", async () => {
    mockCompileExport().mockResolvedValue({ customer: { id: CUSTOMER_B.id } });
    await action({ request: requestAs(CUSTOMER_B, "POST", { intent: "request-data-export" }), params: {}, context: {} } as any);
    expect(mockCompileExport()).toHaveBeenCalledWith(CUSTOMER_B.id);
    expect(mockCompileExport()).not.toHaveBeenCalledWith(CUSTOMER_A.id);
  });

  it("the exported data for customer A is returned to A's own request, not substituted", async () => {
    mockCompileExport().mockResolvedValue({ customer: { id: CUSTOMER_A.id, email: CUSTOMER_A.email } });
    const res: any = await action({ request: requestAs(CUSTOMER_A, "POST", { intent: "request-data-export" }), params: {}, context: {} } as any);
    expect(res.data.exportData.customer.id).toBe(CUSTOMER_A.id);
  });

  it("an unauthenticated export request never reaches compileCustomerExport", async () => {
    await expect(
      action({ request: requestUnauthenticated("POST", { intent: "request-data-export" }), params: {}, context: {} } as any),
    ).rejects.toBeTruthy();
    expect(mockCompileExport()).not.toHaveBeenCalled();
  });
});

describe("settings.tsx action — account deletion", () => {
  it("deletes exactly the requesting customer's own account, never another customer's", async () => {
    mockEraseData().mockResolvedValue({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
    await action({ request: requestAs(CUSTOMER_A, "POST", { intent: "delete-account" }), params: {}, context: {} } as any);
    expect(mockEraseData()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockEraseData()).not.toHaveBeenCalledWith(CUSTOMER_B.id);
  });

  it("a successful deletion clears the session cookie and redirects, rather than re-rendering settings", async () => {
    mockEraseData().mockResolvedValue({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
    const res: any = await action({ request: requestAs(CUSTOMER_A, "POST", { intent: "delete-account" }), params: {}, context: {} } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/signed-out");
    expect(res.headers.get("Set-Cookie")).toBeTruthy();
  });

  it("an unauthenticated delete-account request never reaches eraseCustomerData", async () => {
    await expect(
      action({ request: requestUnauthenticated("POST", { intent: "delete-account" }), params: {}, context: {} } as any),
    ).rejects.toBeTruthy();
    expect(mockEraseData()).not.toHaveBeenCalled();
  });

  it("a client-supplied customerId in the form body is ignored — identity comes only from the session", async () => {
    mockEraseData().mockResolvedValue({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
    // Customer A's session, but the form body tries to claim customer B's id.
    await action({
      request: requestAs(CUSTOMER_A, "POST", { intent: "delete-account", customerId: CUSTOMER_B.id }),
      params: {},
      context: {},
    } as any);
    expect(mockEraseData()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockEraseData()).not.toHaveBeenCalledWith(CUSTOMER_B.id);
  });
});

describe("settings.tsx action — invalid intent", () => {
  it("rejects an unrecognised intent with 400, before any service call", async () => {
    const res: any = await action({ request: requestAs(CUSTOMER_A, "POST", { intent: "not-a-real-intent" }), params: {}, context: {} } as any);
    expect(res.init.status).toBe(400);
    expect(mockEraseData()).not.toHaveBeenCalled();
    expect(mockCompileExport()).not.toHaveBeenCalled();
  });
});
