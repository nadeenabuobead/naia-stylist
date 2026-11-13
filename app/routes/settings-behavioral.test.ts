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

// Identity resolution (2026-11-05, Clerk migration): requireCurrentNaiaCustomer
// is now Clerk-backed (clerk-session.server.ts) — see
// phase1-synthetic-integration.test.ts's own header comment for the full
// rationale. Same boundary swap here: @clerk/backend's authenticateRequest
// and prisma.customer.findUnique replace the old naiaSession mock;
// clerk-session.server.ts's real logic still runs.
const TEST_CLERK_USER_HEADER = "X-Test-Clerk-User-Id";

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async (request: Request) => {
      const clerkUserId = request.headers.get(TEST_CLERK_USER_HEADER);
      return {
        toAuth: () => (clerkUserId ? { isAuthenticated: true, userId: clerkUserId } : { isAuthenticated: false, userId: null }),
      };
    },
  }),
}));

vi.mock("~/db.server", () => {
  const customerFindUnique = vi.fn();
  const naiaModelFindUnique = vi.fn().mockResolvedValue(null);
  return {
    default: {
      customer: { findUnique: customerFindUnique },
      naiaModel: { findUnique: naiaModelFindUnique },
    },
  };
});

vi.mock("~/lib/customer-privacy.server", () => ({
  compileCustomerExport: vi.fn(),
  eraseCustomerData: vi.fn(),
}));

// settings.tsx's delete-account action deletes the Clerk user after nAia's
// own data is erased (see its own header comment on ordering) — mocked here
// the same way every other service dependency on this route already is.
const { clerkDeleteUserMock } = vi.hoisted(() => ({ clerkDeleteUserMock: vi.fn().mockResolvedValue({}) }));

vi.mock("@clerk/react-router/server", () => ({
  clerkClient: () => ({ users: { deleteUser: clerkDeleteUserMock } }),
}));

vi.mock("~/lib/clerk-cleanup.server", () => ({
  recordPendingClerkCleanup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/fashn-tryon-service.server", () => ({
  deleteCustomerVtoResults: vi.fn().mockResolvedValue({ failedAssets: [] }),
  customerHasVtoResults: vi.fn().mockResolvedValue(false),
  deleteNaiaModelBodyPhotoAndVtoResults: vi.fn().mockResolvedValue({
    ok: true,
    cloudinaryOk: true,
    dbCleared: true,
    staleReference: false,
    vtoResultsCleanupAttempted: true,
    vtoResultsDeletedCount: 0,
    vtoResultsPendingCleanup: [],
  }),
  withdrawSaveModelConsentAndVtoResults: vi.fn().mockResolvedValue({
    ok: true,
    deletedAssets: [],
    failedAssets: [],
    vtoResultsDeletedCount: 0,
    vtoResultsPendingCleanup: [],
  }),
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

const mockCustomerFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockCompileExport = () => compileCustomerExport as ReturnType<typeof vi.fn>;
const mockEraseData = () => eraseCustomerData as ReturnType<typeof vi.fn>;

// ── Synthetic customers — never real data ─────────────────────────────────────

const CUSTOMER_A = { id: "synthetic-customer-A", clerkUserId: "clerk_synthetic-customer-A", firstName: "A", lastName: "Test", email: "a@example.invalid" };
const CUSTOMER_B = { id: "synthetic-customer-B", clerkUserId: "clerk_synthetic-customer-B", firstName: "B", lastName: "Test", email: "b@example.invalid" };

function requestAs(customer: typeof CUSTOMER_A, method: string, body?: Record<string, string>) {
  const headers = new Headers({ [TEST_CLERK_USER_HEADER]: customer.clerkUserId });
  mockCustomerFindUnique().mockResolvedValueOnce(customer);
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

  it("a successful deletion redirects to signed-out AND ends every session for that identity via Clerk — not a nAia-issued cookie, since Clerk owns the session now", async () => {
    mockEraseData().mockResolvedValue({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
    const res: any = await action({ request: requestAs(CUSTOMER_A, "POST", { intent: "delete-account" }), params: {}, context: {} } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/signed-out");
    // The actual "no longer signed in" guarantee in the Clerk era: deleting
    // the Clerk user ends every session for that identity server-side (see
    // settings.tsx's own comment on this ordering) — not a Set-Cookie header
    // nAia's own action issues, which is how the pre-Clerk __naia_tok flow
    // used to provide this same guarantee.
    expect(clerkDeleteUserMock).toHaveBeenCalledWith(CUSTOMER_A.clerkUserId);
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
