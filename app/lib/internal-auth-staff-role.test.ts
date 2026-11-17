// app/lib/internal-auth-staff-role.test.ts
//
// 2026-11-17 Operations follow-up — the "staff" half of AdminRole, which
// existed in the type since this file was first written but was never
// actually issuable (createAdminSession hardcoded every session to
// "owner"). Separate file from internal-auth.test.ts (authored earlier,
// for a different feature) so that file's own env-var setup and history
// stay untouched.
//
// This file sets its OWN INTERNAL_STAFF_SECRET for testing — in no other
// file, config, or deployment does this env var exist. See
// docs/ops/staff-role-and-dispute-alerting.md for what provisioning a
// real one requires and the approval it's gated behind.
//
// Run: node --test --import tsx/esm app/lib/internal-auth-staff-role.test.ts

process.env.INTERNAL_ADMIN_COOKIE_SECRET = "test-cookie-secret-32chars-abcdefg";
process.env.INTERNAL_ADMIN_SECRET = "owner-test-password";
process.env.INTERNAL_STAFF_SECRET = "staff-test-password";
process.env.INTERNAL_ADMIN_IDENTITY_EMAIL = "owner@naiabynadine.com";
process.env.INTERNAL_STAFF_IDENTITY_EMAIL = "staff@naiabynadine.com";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  verifyStaffSecret,
  verifyAdminSecret,
  createAdminSession,
  requireAdminSession,
  requireRole,
} from "~/lib/internal-auth.server";

function requestWithCookie(setCookieHeader: string): Request {
  const cookiePart = setCookieHeader.split(";")[0];
  return new Request("http://localhost/admin/withdrawal-requests", { headers: { Cookie: cookiePart } });
}

describe("verifyStaffSecret", () => {
  it("returns true for the correct staff secret", () => {
    assert.equal(verifyStaffSecret("staff-test-password"), true);
  });

  it("returns false for the OWNER secret — the two credentials are not interchangeable", () => {
    assert.equal(verifyStaffSecret("owner-test-password"), false);
  });

  it("returns false for an empty or wrong submission", () => {
    assert.equal(verifyStaffSecret(""), false);
    assert.equal(verifyStaffSecret("wrong"), false);
  });
});

describe("verifyStaffSecret — fails closed when unset (the real, current state everywhere outside this test)", () => {
  it("returns false unconditionally when INTERNAL_STAFF_SECRET is unset, even for the right-shaped guess", () => {
    const original = process.env.INTERNAL_STAFF_SECRET;
    delete process.env.INTERNAL_STAFF_SECRET;
    try {
      assert.equal(verifyStaffSecret("staff-test-password"), false);
      assert.equal(verifyStaffSecret(""), false);
    } finally {
      if (original !== undefined) process.env.INTERNAL_STAFF_SECRET = original;
    }
  });
});

describe("createAdminSession(role) — identity shape", () => {
  it("defaults to role 'owner' with no argument — every pre-existing call site is unaffected", async () => {
    const cookie = await createAdminSession();
    const session = await requireAdminSession(requestWithCookie(cookie));
    assert.deepEqual(session.identity, { id: "owner", email: "owner@naiabynadine.com", role: "owner" });
  });

  it("role 'staff' produces a DIFFERENT identity, never the owner's", async () => {
    const cookie = await createAdminSession("staff");
    const session = await requireAdminSession(requestWithCookie(cookie));
    assert.deepEqual(session.identity, { id: "staff", email: "staff@naiabynadine.com", role: "staff" });
  });
});

describe("requireRole", () => {
  it("allows a role that IS in the allowed list", async () => {
    const cookie = await createAdminSession("staff");
    const session = await requireRole(requestWithCookie(cookie), ["owner", "staff"]);
    assert.equal(session.identity.role, "staff");
  });

  it("rejects a role NOT in the allowed list with a 403 Response, never silently passing through", async () => {
    const cookie = await createAdminSession("staff");
    await assert.rejects(
      () => requireRole(requestWithCookie(cookie), ["owner"]),
      (e: any) => e instanceof Response && e.status === 403,
    );
  });

  it("owner is still rejected if explicitly excluded from the allowed list — this is a real gate, not an owner-always-wins shortcut", async () => {
    const cookie = await createAdminSession("owner");
    await assert.rejects(
      () => requireRole(requestWithCookie(cookie), ["staff"]),
      (e: any) => e instanceof Response && e.status === 403,
    );
  });

  it("no session at all redirects (requireAdminSession's own behavior), propagated unchanged", async () => {
    await assert.rejects(() => requireRole(new Request("http://localhost/admin/withdrawal-requests"), ["owner", "staff"]));
  });
});
