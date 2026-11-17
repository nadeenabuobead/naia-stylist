// app/lib/terms-acceptance.test.ts
//
// Terms of Service acceptance recording — Legal handoff W1.
// Run: npx vitest run app/lib/terms-acceptance.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

import prisma from "~/db.server";
import { recordTermsAcceptance, getTermsAcceptanceStatus, CURRENT_TERMS_VERSION } from "./terms-acceptance.server";

const mockUpdate = () => (prisma as any).customer.update as ReturnType<typeof vi.fn>;
const mockFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-11-17T15:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CURRENT_TERMS_VERSION", () => {
  it("is deliberately null until Legal publishes a real, versioned Terms document", () => {
    expect(CURRENT_TERMS_VERSION).toBeNull();
  });
});

describe("recordTermsAcceptance", () => {
  it("writes exactly the two Customer fields, nothing else — never touches Subscription/billing", async () => {
    await recordTermsAcceptance("cust-1", "v1", { _now: () => NOW });
    expect(mockUpdate()).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { termsAcceptedAt: NOW, termsAcceptedVersion: "v1" },
    });
  });
});

describe("getTermsAcceptanceStatus", () => {
  it("reports not accepted when the customer has never accepted anything", async () => {
    mockFindUnique().mockResolvedValue({ termsAcceptedAt: null, termsAcceptedVersion: null });
    const status = await getTermsAcceptanceStatus("cust-2");
    expect(status).toEqual({ accepted: false, acceptedVersion: null, acceptedAt: null, isCurrent: false });
  });

  it("reports accepted but not current when CURRENT_TERMS_VERSION is still null (no real version exists yet)", async () => {
    mockFindUnique().mockResolvedValue({ termsAcceptedAt: NOW, termsAcceptedVersion: "v1" });
    const status = await getTermsAcceptanceStatus("cust-3");
    expect(status.accepted).toBe(true);
    expect(status.acceptedVersion).toBe("v1");
    // isCurrent can never be true while CURRENT_TERMS_VERSION is null —
    // there is no "current" version to match against yet.
    expect(status.isCurrent).toBe(false);
  });

  it("queries by id only, never leaks any other Customer field", async () => {
    mockFindUnique().mockResolvedValue(null);
    await getTermsAcceptanceStatus("cust-4");
    expect(mockFindUnique()).toHaveBeenCalledWith({
      where: { id: "cust-4" },
      select: { termsAcceptedAt: true, termsAcceptedVersion: true },
    });
  });
});
