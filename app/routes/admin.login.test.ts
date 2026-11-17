// app/routes/admin.login.test.ts
// Priority 5 (2026-10-19) — admin login wired to durable rate limiting.
//
// Mocked internal-auth.server and admin-login-rate-limit.server — no real
// password check, no real DB. Verifies: a locked-out IP is rejected before
// the password is ever checked; a failed attempt is recorded; a successful
// attempt is recorded and still creates a session; lockout copy names a
// wait time, not a raw internal error.
//
// Run: npx vitest run app/routes/admin.login.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/internal-auth.server", () => ({
  verifyAdminSecret: vi.fn(),
  // 2026-11-17: defaults to false in every test here, matching
  // INTERNAL_STAFF_SECRET's real unset-everywhere state. Tests that
  // specifically exercise staff login override this per-case below.
  verifyStaffSecret: vi.fn().mockReturnValue(false),
  createAdminSession: vi.fn().mockResolvedValue("__naia_admin=fake"),
  requireAdminSession: vi.fn().mockRejectedValue(new Error("no session")),
}));

vi.mock("~/lib/admin-login-rate-limit.server", () => ({
  checkAdminLoginLockout: vi.fn(),
  recordAdminLoginAttempt: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn(() => "203.0.113.5"),
}));

import { verifyAdminSecret, verifyStaffSecret, createAdminSession } from "~/lib/internal-auth.server";
import { checkAdminLoginLockout, recordAdminLoginAttempt } from "~/lib/admin-login-rate-limit.server";

const mockVerify = () => verifyAdminSecret as ReturnType<typeof vi.fn>;
const mockVerifyStaff = () => verifyStaffSecret as ReturnType<typeof vi.fn>;
const mockCreateSession = () => createAdminSession as ReturnType<typeof vi.fn>;
const mockLockout = () => checkAdminLoginLockout as ReturnType<typeof vi.fn>;
const mockRecord = () => recordAdminLoginAttempt as ReturnType<typeof vi.fn>;

function loginRequest(password: string) {
  const body = new URLSearchParams({ password });
  return new Request("http://localhost/admin/login", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("admin login action — durable rate limiting", () => {
  it("a locked-out IP is rejected before the password is ever checked", async () => {
    mockLockout().mockResolvedValueOnce({ locked: true, retryAfterSeconds: 300 });
    const { action } = await import("./admin.login.tsx");

    const result = await action({ request: loginRequest("anything") } as any);

    expect(mockVerify()).not.toHaveBeenCalled();
    expect(mockRecord()).not.toHaveBeenCalled();
    expect((result as any).error).toMatch(/too many failed attempts/i);
    expect((result as any).error).toMatch(/\d+ minute/);
  });

  it("a wrong password when not locked out is recorded as a failure", async () => {
    mockLockout().mockResolvedValueOnce({ locked: false, retryAfterSeconds: 0 });
    mockVerify().mockReturnValueOnce(false);
    const { action } = await import("./admin.login.tsx");

    const result = await action({ request: loginRequest("wrong-password") } as any);

    expect(mockRecord()).toHaveBeenCalledWith("203.0.113.5", false);
    expect((result as any).error).toBe("Incorrect password.");
  });

  it("a correct password is recorded as a success and still creates a session", async () => {
    mockLockout().mockResolvedValueOnce({ locked: false, retryAfterSeconds: 0 });
    mockVerify().mockReturnValueOnce(true);
    const { action } = await import("./admin.login.tsx");

    const result = await action({ request: loginRequest("correct-password") } as any);

    expect(mockRecord()).toHaveBeenCalledWith("203.0.113.5", true);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe("/admin");
  });

  it("the owner secret is checked, creating an owner session — verifyStaffSecret is never even called when the owner secret already matched", async () => {
    mockLockout().mockResolvedValueOnce({ locked: false, retryAfterSeconds: 0 });
    mockVerify().mockReturnValueOnce(true);
    const { action } = await import("./admin.login.tsx");

    await action({ request: loginRequest("owner-password") } as any);

    expect(mockVerifyStaff()).not.toHaveBeenCalled();
    expect(mockCreateSession()).toHaveBeenCalledWith("owner");
  });
});

describe("admin login action — staff secret (2026-11-17, least-privilege follow-up)", () => {
  it("a wrong owner secret that matches the STAFF secret instead creates a staff session, not an owner one", async () => {
    mockLockout().mockResolvedValueOnce({ locked: false, retryAfterSeconds: 0 });
    mockVerify().mockReturnValueOnce(false);
    mockVerifyStaff().mockReturnValueOnce(true);
    const { action } = await import("./admin.login.tsx");

    const result = await action({ request: loginRequest("staff-password") } as any);

    expect(mockRecord()).toHaveBeenCalledWith("203.0.113.5", true);
    expect(mockCreateSession()).toHaveBeenCalledWith("staff");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
  });

  it("a password matching NEITHER secret is still a plain, recorded failure — identical to the pre-staff-role behavior", async () => {
    mockLockout().mockResolvedValueOnce({ locked: false, retryAfterSeconds: 0 });
    mockVerify().mockReturnValueOnce(false);
    mockVerifyStaff().mockReturnValueOnce(false);
    const { action } = await import("./admin.login.tsx");

    const result = await action({ request: loginRequest("neither") } as any);

    expect(mockRecord()).toHaveBeenCalledWith("203.0.113.5", false);
    expect((result as any).error).toBe("Incorrect password.");
    expect(mockCreateSession()).not.toHaveBeenCalled();
  });
});
