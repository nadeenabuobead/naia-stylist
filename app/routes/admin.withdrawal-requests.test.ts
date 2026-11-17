// app/routes/admin.withdrawal-requests.test.ts
//
// 2026-11-17 Operations follow-up — restricted case access for EU
// withdrawal requests, built as a least-privilege (owner-OR-staff) proof
// of concept via the shared requireRole gate. Mirrors
// admin.billing-overrides.test.ts's own conventions: mocked
// internal-auth.server and the library module — no real admin session, no
// real DB, no real INTERNAL_STAFF_SECRET anywhere.
//
// Run: npx vitest run app/routes/admin.withdrawal-requests.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/internal-auth.server", () => ({
  requireRole: vi.fn().mockResolvedValue({
    authenticated: true,
    identity: { id: "owner", email: "owner@naiabynadine.com", role: "owner" },
  }),
}));

vi.mock("~/lib/withdrawal-request.server", () => ({
  listOpenWithdrawalRequests: vi.fn().mockResolvedValue([]),
  acknowledgeWithdrawalRequest: vi.fn(),
  closeWithdrawalRequest: vi.fn(),
}));

import { requireRole } from "~/lib/internal-auth.server";
import {
  listOpenWithdrawalRequests,
  acknowledgeWithdrawalRequest,
  closeWithdrawalRequest,
} from "~/lib/withdrawal-request.server";
import { loader, action } from "./admin.withdrawal-requests";

const mockRequireRole = () => requireRole as ReturnType<typeof vi.fn>;
const mockList = () => listOpenWithdrawalRequests as ReturnType<typeof vi.fn>;
const mockAck = () => acknowledgeWithdrawalRequest as ReturnType<typeof vi.fn>;
const mockClose = () => closeWithdrawalRequest as ReturnType<typeof vi.fn>;

function actionRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/admin/withdrawal-requests", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("admin.withdrawal-requests — session and role requirements (owner OR staff)", () => {
  it("loader requires a session with the right role and lists open requests", async () => {
    mockRequireRole().mockResolvedValueOnce({ authenticated: true, identity: { id: "owner", email: "owner@naiabynadine.com", role: "owner" } });
    mockList().mockResolvedValue([{ id: "wr-1", reference: "WD-20261117-ABC123" }]);
    const result = await loader({ request: new Request("http://localhost/admin/withdrawal-requests") } as any);
    expect(mockRequireRole()).toHaveBeenCalledWith(expect.anything(), ["owner", "staff"]);
    expect(result).toEqual({ openRequests: [{ id: "wr-1", reference: "WD-20261117-ABC123" }] });
  });

  it("a STAFF session is accepted, not rejected — the point of this being a least-privilege route, not an owner-only one", async () => {
    mockRequireRole().mockResolvedValueOnce({ authenticated: true, identity: { id: "staff", email: "staff@naiabynadine.com", role: "staff" } });
    mockList().mockResolvedValue([]);
    const result = await loader({ request: new Request("http://localhost/admin/withdrawal-requests") } as any);
    expect(result).toEqual({ openRequests: [] });
  });

  it("loader propagates a 403 from requireRole (e.g. no session, or a role outside owner/staff) without listing anything", async () => {
    mockRequireRole().mockRejectedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(loader({ request: new Request("http://localhost/admin/withdrawal-requests") } as any)).rejects.toMatchObject({ status: 403 });
    expect(mockList()).not.toHaveBeenCalled();
  });

  it("action propagates a 403 from requireRole without calling acknowledge or close", async () => {
    mockRequireRole().mockRejectedValueOnce(new Response("Forbidden", { status: 403 }));
    const request = actionRequest({ intent: "close", id: "wr-1", note: "resolved" });
    await expect(action({ request } as any)).rejects.toMatchObject({ status: 403 });
    expect(mockClose()).not.toHaveBeenCalled();
  });
});

describe("admin.withdrawal-requests — acknowledge", () => {
  it("calls acknowledgeWithdrawalRequest with the session's OWN email, never from form input", async () => {
    mockAck().mockResolvedValue({ status: "acknowledged" });
    const request = actionRequest({ intent: "acknowledge", id: "wr-1", performedBy: "attacker@evil.com" });
    const result = await action({ request } as any);
    expect(mockAck()).toHaveBeenCalledWith("wr-1", "owner@naiabynadine.com");
    expect(result).toEqual({ ok: true, intent: "acknowledge", message: "Marked acknowledged." });
  });

  it("a STAFF session's own email is used as performedBy too — the audit trail always reflects who actually acted", async () => {
    mockRequireRole().mockResolvedValueOnce({ authenticated: true, identity: { id: "staff", email: "staff@naiabynadine.com", role: "staff" } });
    mockAck().mockResolvedValue({ status: "acknowledged" });
    const request = actionRequest({ intent: "acknowledge", id: "wr-1" });
    await action({ request } as any);
    expect(mockAck()).toHaveBeenCalledWith("wr-1", "staff@naiabynadine.com");
  });

  it("surfaces a not-found case as an error, not a thrown exception", async () => {
    mockAck().mockResolvedValue({ status: "not-found" });
    const request = actionRequest({ intent: "acknowledge", id: "wr-missing" });
    const result = await action({ request } as any);
    expect(result).toEqual({ ok: false, error: "Request not found." });
  });
});

describe("admin.withdrawal-requests — close", () => {
  it("calls closeWithdrawalRequest with the session's own email and the resolution note", async () => {
    mockClose().mockResolvedValue({ status: "closed" });
    const request = actionRequest({ intent: "close", id: "wr-2", note: "Refunded per case OPS-0001, customer notified" });
    const result = await action({ request } as any);
    expect(mockClose()).toHaveBeenCalledWith("wr-2", "owner@naiabynadine.com", "Refunded per case OPS-0001, customer notified");
    expect(result).toEqual({ ok: true, intent: "close", message: "Closed." });
  });

  it("a blank-reason refusal from the library function surfaces as an error, not a 500", async () => {
    mockClose().mockRejectedValue(new Error("closeWithdrawalRequest requires a non-blank note — an unexplained closure defeats the audit trail."));
    const request = actionRequest({ intent: "close", id: "wr-3", note: "" });
    const result = await action({ request } as any);
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/non-blank note/);
  });
});

describe("admin.withdrawal-requests — invalid intent", () => {
  it("rejects without calling anything", async () => {
    const request = actionRequest({ intent: "delete-everything", id: "wr-4" });
    const result = await action({ request } as any);
    expect(result).toEqual({ ok: false, error: "Invalid request." });
    expect(mockAck()).not.toHaveBeenCalled();
    expect(mockClose()).not.toHaveBeenCalled();
  });
});
