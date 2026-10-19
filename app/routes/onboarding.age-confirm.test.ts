// app/routes/onboarding.age-confirm.test.ts
// Priority 5 (2026-10-19) — mandatory age declaration interstitial.
//
// Mocked session + age-confirmation module — no real DB. Verifies: already-
// confirmed customers are redirected straight through; an unconfirmed
// checkbox is rejected without recording anything; a confirmed submission
// records exactly the session-authenticated customer and redirects to
// `next`; a malicious/foreign `next` value is never honoured (open-redirect
// guard) — both from the loader's query string and the action's hidden
// field, which are parsed independently.
//
// Run: npx vitest run app/routes/onboarding.age-confirm.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/age-confirmation.server", () => ({
  hasConfirmedCurrentAge: vi.fn(),
  recordAgeConfirmation: vi.fn().mockResolvedValue(undefined),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { hasConfirmedCurrentAge, recordAgeConfirmation } from "~/lib/age-confirmation.server";

const mockRequireCustomer = () => requireCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockHasConfirmed = () => hasConfirmedCurrentAge as ReturnType<typeof vi.fn>;
const mockRecord = () => recordAgeConfirmation as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "synthetic-customer-A" };
const CUSTOMER_B = { id: "synthetic-customer-B" };

beforeEach(() => vi.clearAllMocks());

describe("loader", () => {
  it("already confirmed — redirects straight to next without rendering the checkbox page", async () => {
    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockHasConfirmed().mockReturnValueOnce(true);
    const { loader } = await import("./onboarding.age-confirm.tsx");

    const result = await loader({ request: new Request("http://localhost/onboarding/age-confirm?next=/onboarding/step/3") } as any);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/onboarding/step/3");
  });

  it("not confirmed — renders the page, passing through a VALID next value", async () => {
    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockHasConfirmed().mockReturnValueOnce(false);
    const { loader } = await import("./onboarding.age-confirm.tsx");

    const result = await loader({ request: new Request("http://localhost/onboarding/age-confirm?next=/onboarding/step/5") } as any);
    expect(result).toEqual({ next: "/onboarding/step/5" });
  });

  it("not confirmed — an invalid/foreign next value falls back to step 1, never an open redirect", async () => {
    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockHasConfirmed().mockReturnValueOnce(false);
    const { loader } = await import("./onboarding.age-confirm.tsx");

    for (const malicious of ["https://evil.example.com", "/auth/logout", "javascript:alert(1)", "//evil.example.com"]) {
      const result = await loader({ request: new Request(`http://localhost/onboarding/age-confirm?next=${encodeURIComponent(malicious)}`) } as any);
      expect(result).toEqual({ next: "/onboarding/step/1" });
    }
  });
});

describe("action", () => {
  function submit(ageConfirmed: string | null, next: string = "/onboarding/step/3") {
    const body = new URLSearchParams({ next });
    if (ageConfirmed !== null) body.set("ageConfirmed", ageConfirmed);
    return new Request("http://localhost/onboarding/age-confirm", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  it("unchecked box — rejected, nothing recorded", async () => {
    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const { action } = await import("./onboarding.age-confirm.tsx");

    const result = await action({ request: submit(null) } as any);
    expect((result as any).error).toBeTruthy();
    expect(mockRecord()).not.toHaveBeenCalled();
  });

  it("checked box — records exactly the session-authenticated customer, redirects to next", async () => {
    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const { action } = await import("./onboarding.age-confirm.tsx");

    const result = await action({ request: submit("true", "/onboarding/step/3") } as any);

    expect(mockRecord()).toHaveBeenCalledWith(CUSTOMER_A.id);
    expect(mockRecord()).not.toHaveBeenCalledWith(CUSTOMER_B.id);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/onboarding/step/3");
  });

  it("a malicious next field is never honoured, even on confirmation", async () => {
    mockRequireCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const { action } = await import("./onboarding.age-confirm.tsx");

    const result = await action({ request: submit("true", "https://evil.example.com") } as any);
    expect((result as Response).headers.get("Location")).toBe("/onboarding/step/1");
  });
});
