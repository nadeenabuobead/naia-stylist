// app/routes/admin.naia.closet.delete-audit.test.ts
//
// 2026-11-17 — C3 regression test (Nov 12 privacy/breach audit).
//
// C3 stated, among other things, that the admin portal has "zero audit log
// for any action including destructive hard-deletes" and specifically that
// "closet-item hard-delete logs nothing."
//
// Reassessed against current code: the audit-log infrastructure now exists
// (app/lib/admin-audit-log.server.ts, the AdminAuditLog model) and
// admin.maintenance.tsx records every one of its own purges. The closet
// hard-delete intents in admin.naia.closet._index.tsx were the remaining
// destructive admin actions writing no record at all — a cross-customer,
// irreversible delete of another person's wardrobe data that left no trace
// of who performed it.
//
// These tests pin the audit write behaviourally, by invoking the route's
// real action with mocked collaborators — not by asserting on source text,
// so a refactor that keeps the behaviour keeps the tests passing and one
// that drops the audit write fails them.
//
// Mocked: internal-auth.server (no real admin session), closet-review.server
// (no real DB delete), admin-audit-log.server (no real DB write).
//
// Run: npx vitest run app/routes/admin.naia.closet.delete-audit.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_EMAIL = "owner@naiabynadine.com";

vi.mock("~/lib/internal-auth.server", () => ({
  requireAdminSession: vi.fn().mockResolvedValue({
    authenticated: true,
    identity: { id: "owner", email: ADMIN_EMAIL, role: "owner" },
  }),
}));

vi.mock("~/lib/admin/closet-review.server", () => ({
  markItemReviewed: vi.fn().mockResolvedValue(undefined),
  deleteClosetItem: vi.fn().mockResolvedValue({ customerId: "cust-A" }),
  deleteClosetItems: vi.fn().mockResolvedValue({
    count: 2,
    customerIds: ["cust-A", "cust-B"],
  }),
}));

vi.mock("~/lib/admin-audit-log.server", () => ({
  recordAdminAction: vi.fn().mockResolvedValue({ id: "audit-1" }),
}));

// closet-intelligence.server is imported by the route module for its loader
// and its types. The action never touches it, but the import must resolve.
vi.mock("~/lib/admin/closet-intelligence.server", () => ({
  listClosetItems: vi.fn(),
  getClosetReviewSummary: vi.fn(),
  getNewIntentionReviewSummary: vi.fn(),
}));

const { action } = await import("./admin.naia.closet._index");
const { recordAdminAction } = await import("~/lib/admin-audit-log.server");
const { deleteClosetItem, deleteClosetItems } = await import(
  "~/lib/admin/closet-review.server"
);

function postForm(fields: Array<[string, string]>) {
  const body = new URLSearchParams();
  for (const [k, v] of fields) body.append(k, v);
  return new Request("http://localhost/admin/naia/closet", {
    method: "POST",
    body,
  });
}

function callAction(request: Request) {
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("C3 — single closet-item hard-delete is audited", () => {
  it("writes an AdminAuditLog entry naming the action, the item and the owning customer", async () => {
    const res = await callAction(
      postForm([
        ["intent", "delete-item"],
        ["itemId", "item-1"],
      ]),
    );

    expect(await res.json()).toEqual({ ok: true, deleted: 1 });
    expect(recordAdminAction).toHaveBeenCalledTimes(1);

    const [performedBy, actionName, detail] = vi.mocked(recordAdminAction).mock.calls[0];
    expect(actionName).toBe("closet-item-hard-delete");
    expect(detail).toMatchObject({ itemId: "item-1", customerId: "cust-A" });
  });

  it("attributes the action to the authenticated session's email, never to request input", async () => {
    // The forged performedBy/reviewedBy fields below must be ignored
    // entirely — performedBy has to come from requireAdminSession.
    await callAction(
      postForm([
        ["intent", "delete-item"],
        ["itemId", "item-1"],
        ["performedBy", "attacker@evil.test"],
        ["reviewedBy", "attacker@evil.test"],
      ]),
    );

    const [performedBy] = vi.mocked(recordAdminAction).mock.calls[0];
    expect(performedBy).toBe(ADMIN_EMAIL);
  });

  it("audits only after the delete succeeded — a failing delete records nothing", async () => {
    vi.mocked(deleteClosetItem).mockRejectedValueOnce(new Error("db down"));

    await expect(
      callAction(postForm([["intent", "delete-item"], ["itemId", "item-1"]])),
    ).rejects.toThrow("db down");

    // A record claiming the item was deleted when it wasn't is worse than
    // no record.
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("a failing audit write is not swallowed — the request fails loudly rather than deleting silently", async () => {
    vi.mocked(recordAdminAction).mockRejectedValueOnce(new Error("audit write failed"));

    await expect(
      callAction(postForm([["intent", "delete-item"], ["itemId", "item-1"]])),
    ).rejects.toThrow("audit write failed");
  });

  it("a rejected request (missing itemId) deletes nothing and audits nothing", async () => {
    const res = await callAction(postForm([["intent", "delete-item"]]));

    expect(res.status).toBe(400);
    expect(deleteClosetItem).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});

describe("C3 — bulk closet-item hard-delete is audited", () => {
  it("records every requested id and the full set of affected customers", async () => {
    const res = await callAction(
      postForm([
        ["intent", "delete-items"],
        ["itemIds", "item-1"],
        ["itemIds", "item-2"],
      ]),
    );

    expect(await res.json()).toEqual({ ok: true, deleted: 2 });

    const [performedBy, actionName, detail] = vi.mocked(recordAdminAction).mock.calls[0];
    expect(performedBy).toBe(ADMIN_EMAIL);
    expect(actionName).toBe("closet-item-bulk-hard-delete");
    expect(detail).toMatchObject({
      requestedCount: 2,
      deletedCount: 2,
      itemIds: ["item-1", "item-2"],
      // The cross-customer blast radius is the whole point of auditing a
      // bulk delete — this must not collapse to a single customer.
      customerIds: ["cust-A", "cust-B"],
    });
  });

  it("records the requested/deleted discrepancy when an id no longer exists", async () => {
    vi.mocked(deleteClosetItems).mockResolvedValueOnce({
      count: 1,
      customerIds: ["cust-A"],
    });

    const res = await callAction(
      postForm([
        ["intent", "delete-items"],
        ["itemIds", "item-1"],
        ["itemIds", "already-gone"],
      ]),
    );

    expect(await res.json()).toEqual({ ok: true, deleted: 1 });

    const [, , detail] = vi.mocked(recordAdminAction).mock.calls[0];
    expect(detail).toMatchObject({ requestedCount: 2, deletedCount: 1 });
  });

  it("an empty selection deletes nothing and audits nothing", async () => {
    const res = await callAction(postForm([["intent", "delete-items"]]));

    expect(res.status).toBe(400);
    expect(deleteClosetItems).not.toHaveBeenCalled();
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});

describe("C3 — non-destructive intents are unchanged", () => {
  it("quick-approve still works and is not audited through this path", async () => {
    const res = await callAction(
      postForm([
        ["intent", "quick-approve"],
        ["itemId", "item-1"],
      ]),
    );

    expect(await res.json()).toEqual({ ok: true, itemId: "item-1" });
    // quick-approve is a reversible classification review, already attributed
    // via markItemReviewed(itemId, reviewedBy) — it is deliberately not part
    // of the destructive-action audit trail.
    expect(recordAdminAction).not.toHaveBeenCalled();
  });
});
