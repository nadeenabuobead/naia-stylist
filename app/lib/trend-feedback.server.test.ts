// app/lib/trend-feedback.server.test.ts
//
// setTrendFeedback is the "one row per (customer, report, content, action)"
// contract — these tests prove the create/reverse/already-active/
// concurrent-race branches directly, with Prisma mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, create, delete_ } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  delete_: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: { trendContentFeedback: { findUnique, create, delete: delete_ } },
}));

import { setTrendFeedback, isTrendFeedbackAction } from "./trend-feedback.server";

const TARGET = {
  reportSlug: "spring-2026-soft-structure",
  contentType: "TREND",
  contentKey: "softened-tailoring",
  contentLabel: "Softened Tailoring",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isTrendFeedbackAction", () => {
  it("accepts NOT_FOR_ME and STYLED only", () => {
    expect(isTrendFeedbackAction("NOT_FOR_ME")).toBe(true);
    expect(isTrendFeedbackAction("STYLED")).toBe(true);
    expect(isTrendFeedbackAction("SAVE")).toBe(false);
  });
});

describe("setTrendFeedback", () => {
  it("activating for the first time creates exactly one row", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "fb-1" });

    const result = await setTrendFeedback("customer-A", TARGET, "NOT_FOR_ME", true);

    expect(result).toEqual({ active: true, recordId: "fb-1" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("activating again when already active is a no-op — one row, not a growing log", async () => {
    findUnique.mockResolvedValueOnce({ id: "fb-1" });

    const result = await setTrendFeedback("customer-A", TARGET, "NOT_FOR_ME", true);

    expect(result).toEqual({ active: true, recordId: "fb-1" });
    expect(create).not.toHaveBeenCalled();
  });

  it("reversing deletes the row", async () => {
    findUnique.mockResolvedValueOnce({ id: "fb-1" });
    delete_.mockResolvedValueOnce({ id: "fb-1" });

    const result = await setTrendFeedback("customer-A", TARGET, "NOT_FOR_ME", false);

    expect(result).toEqual({ active: false, recordId: null });
    expect(delete_).toHaveBeenCalledWith({ where: { id: "fb-1" } });
  });

  it("reversing something never recorded is a no-op", async () => {
    findUnique.mockResolvedValueOnce(null);

    const result = await setTrendFeedback("customer-A", TARGET, "NOT_FOR_ME", false);

    expect(result).toEqual({ active: false, recordId: null });
    expect(delete_).not.toHaveBeenCalled();
  });

  it("a concurrent double-submit (P2002) resolves to the row the other request created", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "fb-winner" });
    create.mockRejectedValueOnce({ code: "P2002" });

    const result = await setTrendFeedback("customer-A", TARGET, "NOT_FOR_ME", true);

    expect(result).toEqual({ active: true, recordId: "fb-winner" });
  });
});
