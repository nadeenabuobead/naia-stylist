// app/routes/settings-action-identity.test.ts
// Priority 4 verification (2026-10-19) — "customer export and deletion
// cannot expose or delete another customer's data."
//
// settings.test.ts and settings-coverage-gaps.test.ts already prove this
// statically (the action source never reads a client-supplied customer id).
// This file closes the gap to an actual behavioral run: the real action
// function, invoked twice as two different authenticated customers, each
// touching only their own id — never the other's. Session identity is
// mocked at the one place it's established (requireCurrentNaiaCustomer),
// exactly where a real attacker would have to subvert it; everything
// downstream is real action code.
//
// Mocked: session lookup, the privacy module, and every other helper the
// action imports (so importing the route module has no live DB/Cloudinary
// dependency). No real Prisma, no real Cloudinary, no real Shopify call.
//
// Run: npx vitest run app/routes/settings-action-identity.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
  buildClearSessionCookieHeader: vi.fn(() => "naia_session=; Max-Age=0"),
}));

vi.mock("~/lib/customer-privacy.server", () => ({
  compileCustomerExport: vi.fn(),
  eraseCustomerData: vi.fn(),
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  deleteNaiaModelPhoto: vi.fn(),
  withdrawSaveModelConsent: vi.fn(),
}));
vi.mock("~/lib/ai/fashn-tryon-service.server", () => ({
  deleteCustomerVtoResults: vi.fn(),
  customerHasVtoResults: vi.fn(),
}));
vi.mock("~/lib/buy-or-skip-privacy.server", () => ({
  deleteCustomerBosImages: vi.fn(),
  customerHasBosImages: vi.fn(),
}));
vi.mock("~/lib/closet-photo-privacy.server", () => ({
  deleteAllClosetPhotos: vi.fn(),
  customerHasClosetPhotos: vi.fn(),
}));
vi.mock("~/db.server", () => ({ default: { onboardingProfile: { findUnique: vi.fn() } } }));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { compileCustomerExport, eraseCustomerData } from "~/lib/customer-privacy.server";

const mockRequireCustomer = () => requireCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockCompile = () => compileCustomerExport as ReturnType<typeof vi.fn>;
const mockErase = () => eraseCustomerData as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "synthetic-customer-A", email: "a@test.invalid" };
const CUSTOMER_B = { id: "synthetic-customer-B", email: "b@test.invalid" };

function formRequest(intent: string) {
  const body = new URLSearchParams({ intent });
  return new Request("http://localhost/settings", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("settings action — identity comes only from the session, never crosses customers", () => {
  it("request-data-export: exports exactly the session-authenticated customer, for two different customers in turn", async () => {
    const { action } = await import("./settings.tsx");

    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockCompile().mockResolvedValueOnce({ exportedAt: "t", customer: CUSTOMER_A });
    await action({ request: formRequest("request-data-export") } as any);
    expect(mockCompile()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockCompile()).not.toHaveBeenCalledWith(CUSTOMER_B.id);

    vi.clearAllMocks();

    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_B);
    mockCompile().mockResolvedValueOnce({ exportedAt: "t", customer: CUSTOMER_B });
    await action({ request: formRequest("request-data-export") } as any);
    expect(mockCompile()).toHaveBeenCalledWith(CUSTOMER_B.id);
    // Still never called with A's id on this second, separate request.
    expect(mockCompile()).not.toHaveBeenCalledWith(CUSTOMER_A.id);
  });

  it("delete-account: erases exactly the session-authenticated customer, for two different customers in turn", async () => {
    const { action } = await import("./settings.tsx");

    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
    await action({ request: formRequest("delete-account") } as any);
    expect(mockErase()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockErase()).not.toHaveBeenCalledWith(CUSTOMER_B.id);

    vi.clearAllMocks();

    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_B);
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });
    await action({ request: formRequest("delete-account") } as any);
    expect(mockErase()).toHaveBeenCalledWith(CUSTOMER_B.id);
    expect(mockErase()).not.toHaveBeenCalledWith(CUSTOMER_A.id);
  });

  it("identity comes from the session lookup, never from form data — a spoofed customerId field is ignored", async () => {
    const { action } = await import("./settings.tsx");

    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockErase().mockResolvedValueOnce({ ok: true, alreadyErased: false, cloudinaryFailures: [], journeyEventsPurged: 0 });

    const body = new URLSearchParams({ intent: "delete-account", customerId: CUSTOMER_B.id });
    const spoofedRequest = new Request("http://localhost/settings", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    await action({ request: spoofedRequest } as any);

    // Session identity (A) wins — the spoofed form field (B) is never read.
    expect(mockErase()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockErase()).not.toHaveBeenCalledWith(CUSTOMER_B.id);
  });

  it("if the session lookup rejects (no valid session), the action never reaches the privacy module at all", async () => {
    const { action } = await import("./settings.tsx");
    mockRequireCustomer().mockRejectedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(action({ request: formRequest("delete-account") } as any)).rejects.toBeInstanceOf(Response);
    expect(mockErase()).not.toHaveBeenCalled();
    expect(mockCompile()).not.toHaveBeenCalled();
  });
});
