// app/lib/clerk-session.server.session-revocation.test.ts
//
// 2026-11-21 (H4, closing the real gap) — revokeClerkSessionsForCustomer is
// the one place that actually ends a customer's live Clerk session(s). Pure
// dependency injection via the function's own `deps._clerkClient` param — no
// module mock needed, same convention this file already supports for
// resolveClerkUserId/getCurrentNaiaCustomer's `deps._clerkClient`.
//
// Run: npx vitest run app/lib/clerk-session.server.session-revocation.test.ts

import { describe, it, expect, vi } from "vitest";
import { revokeClerkSessionsForCustomer, ClerkSessionRevocationError } from "./clerk-session.server";

function fakeClient(opts: {
  sessions?: { id: string; status: string }[];
  totalCount?: number;
  revokeImpl?: (id: string) => Promise<{ status: string }>;
  listError?: Error;
}) {
  const sessions = opts.sessions ?? [];
  const getSessionList = vi.fn().mockImplementation(async () => {
    if (opts.listError) throw opts.listError;
    return { data: sessions, totalCount: opts.totalCount ?? sessions.length };
  });
  const revokeSession = vi.fn().mockImplementation(
    opts.revokeImpl ?? (async (id: string) => ({ status: "revoked" })),
  );
  return { sessions: { getSessionList, revokeSession } };
}

describe("revokeClerkSessionsForCustomer", () => {
  it("revokes every active/pending session and reports the count", async () => {
    const client = fakeClient({
      sessions: [
        { id: "sess_1", status: "active" },
        { id: "sess_2", status: "pending" },
      ],
    });

    const result = await revokeClerkSessionsForCustomer("user_1", { _clerkClient: client });

    expect(result.revokedCount).toBe(2);
    expect(result.alreadyInactiveCount).toBe(0);
    expect(client.sessions.revokeSession).toHaveBeenCalledWith("sess_1");
    expect(client.sessions.revokeSession).toHaveBeenCalledWith("sess_2");
  });

  it("skips sessions that are already inactive without calling revoke on them", async () => {
    const client = fakeClient({
      sessions: [
        { id: "sess_1", status: "active" },
        { id: "sess_2", status: "ended" },
        { id: "sess_3", status: "expired" },
      ],
    });

    const result = await revokeClerkSessionsForCustomer("user_1", { _clerkClient: client });

    expect(result.revokedCount).toBe(1);
    expect(result.alreadyInactiveCount).toBe(2);
    expect(client.sessions.revokeSession).toHaveBeenCalledTimes(1);
    expect(client.sessions.revokeSession).toHaveBeenCalledWith("sess_1");
  });

  it("reports zero with no error when the customer has no Clerk sessions at all", async () => {
    const client = fakeClient({ sessions: [] });

    const result = await revokeClerkSessionsForCustomer("user_1", { _clerkClient: client });

    expect(result).toEqual({ revokedCount: 0, alreadyInactiveCount: 0 });
    expect(client.sessions.revokeSession).not.toHaveBeenCalled();
  });

  it("fails closed when Clerk's list call throws — never reports a count", async () => {
    const client = fakeClient({ sessions: [], listError: new Error("Clerk API unreachable") });

    await expect(
      revokeClerkSessionsForCustomer("user_1", { _clerkClient: client }),
    ).rejects.toThrow(ClerkSessionRevocationError);
  });

  it("fails closed when Clerk's revoke call throws for one session", async () => {
    const client = fakeClient({
      sessions: [{ id: "sess_1", status: "active" }],
      revokeImpl: async () => {
        throw new Error("network blip");
      },
    });

    await expect(
      revokeClerkSessionsForCustomer("user_1", { _clerkClient: client }),
    ).rejects.toThrow(ClerkSessionRevocationError);
  });

  it("fails closed when Clerk returns 200 but the session isn't actually revoked — this is the exact scenario the founder's instruction named", async () => {
    const client = fakeClient({
      sessions: [{ id: "sess_1", status: "active" }],
      // A real-world case this guards against: Clerk's API returns success,
      // but the session comes back in some other non-"revoked" state
      // (e.g. still "active") — an API call succeeding is NOT the same as
      // the session actually being dead, and this must not be reported as
      // success either way.
      revokeImpl: async () => ({ status: "active" }),
    });

    await expect(
      revokeClerkSessionsForCustomer("user_1", { _clerkClient: client }),
    ).rejects.toThrow(/did not report status "revoked"/);
  });

  it("stops revoking and fails closed as soon as one session in a multi-session batch fails — never silently continues", async () => {
    const client = fakeClient({
      sessions: [
        { id: "sess_1", status: "active" },
        { id: "sess_2", status: "active" },
      ],
      revokeImpl: async (id: string) => {
        if (id === "sess_1") throw new Error("boom");
        return { status: "revoked" };
      },
    });

    await expect(
      revokeClerkSessionsForCustomer("user_1", { _clerkClient: client }),
    ).rejects.toThrow(ClerkSessionRevocationError);
  });

  it("passes userId through to the list call", async () => {
    const client = fakeClient({ sessions: [] });

    await revokeClerkSessionsForCustomer("user_abc123", { _clerkClient: client });

    expect(client.sessions.getSessionList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_abc123" }),
    );
  });

  it("paginates past the first page rather than only revoking the first batch", async () => {
    // 150 sessions, page size 100 — must fetch a second page and revoke
    // every session across both, not just the first 100.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `sess_${i}`, status: "active" }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `sess_${100 + i}`, status: "active" }));
    const getSessionList = vi.fn()
      .mockResolvedValueOnce({ data: page1, totalCount: 150 })
      .mockResolvedValueOnce({ data: page2, totalCount: 150 });
    const revokeSession = vi.fn().mockResolvedValue({ status: "revoked" });

    const result = await revokeClerkSessionsForCustomer("user_1", {
      _clerkClient: { sessions: { getSessionList, revokeSession } },
    });

    expect(getSessionList).toHaveBeenCalledTimes(2);
    expect(revokeSession).toHaveBeenCalledTimes(150);
    expect(result.revokedCount).toBe(150);
  });
});
