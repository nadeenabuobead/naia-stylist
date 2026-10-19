// app/lib/age-confirmation.test.ts
// Priority 5 (2026-10-19) — age declaration check/record functions.
//
// Mocked Prisma — no live DB. This module is intentionally not wired into
// any live route yet (see the file header comment in
// age-confirmation.server.ts for why) — these tests cover the standalone
// capability so it's ready and correct whenever placement is decided.
//
// Run: npx vitest run app/lib/age-confirmation.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: { customer: { update: vi.fn().mockResolvedValue({}) } },
}));

import prisma from "~/db.server";
import {
  hasConfirmedCurrentAge,
  recordAgeConfirmation,
  CURRENT_AGE_CONFIRMATION_VERSION,
} from "./age-confirmation.server";

const mockUpdate = () => (prisma as any).customer.update as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("hasConfirmedCurrentAge", () => {
  it("false when never confirmed", () => {
    expect(hasConfirmedCurrentAge({ ageConfirmedAt: null, ageConfirmationVersion: null })).toBe(false);
  });

  it("true when confirmed under the current version", () => {
    expect(
      hasConfirmedCurrentAge({ ageConfirmedAt: new Date(), ageConfirmationVersion: CURRENT_AGE_CONFIRMATION_VERSION }),
    ).toBe(true);
  });

  it("false when confirmed under a stale version — must be asked again after a policy/wording change", () => {
    expect(hasConfirmedCurrentAge({ ageConfirmedAt: new Date(), ageConfirmationVersion: "v0-legacy" })).toBe(false);
  });
});

describe("recordAgeConfirmation", () => {
  it("stamps the current version and a timestamp for exactly the given customer", async () => {
    await recordAgeConfirmation("synthetic-customer-A");
    expect(mockUpdate()).toHaveBeenCalledWith({
      where: { id: "synthetic-customer-A" },
      data: { ageConfirmedAt: expect.any(Date), ageConfirmationVersion: CURRENT_AGE_CONFIRMATION_VERSION },
    });
  });

  it("never touches a different customer's id", async () => {
    await recordAgeConfirmation("synthetic-customer-B");
    expect(mockUpdate()).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "synthetic-customer-A" } }));
  });
});
