// app/lib/internal-auth.test.ts
//
// Behavioural tests for the standalone admin portal auth layer.
//
// Sections:
//   §IA-01  verifyAdminSecret — timing-safe comparison
//   §IA-02  createAdminSession — session creation
//   §IA-03  requireAdminSession — session reading and redirect on failure
//   §IA-04  destroyAdminSession — session destruction
//   §IA-05  Identity contract — shape and source guarantees
//
// Run: node --test --import tsx/esm app/lib/internal-auth.test.ts

// Set env vars BEFORE module import so the module-level PORTAL_AVAILABLE check
// uses a known test secret.
process.env.INTERNAL_ADMIN_COOKIE_SECRET = "test-cookie-secret-32chars-abcdefg";
process.env.INTERNAL_ADMIN_SECRET = "correct-test-password-for-unit-tests";
process.env.INTERNAL_ADMIN_IDENTITY_EMAIL = "nadeenabuobead@gmail.com";
// Disable secure cookie for test environment
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  verifyAdminSecret,
  createAdminSession,
  requireAdminSession,
  destroyAdminSession,
  type AdminSession,
} from "~/lib/internal-auth.server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function requestWithCookie(setCookieHeader: string): Request {
  const cookiePart = setCookieHeader.split(";")[0];
  return new Request("http://localhost/admin/naia", {
    headers: { Cookie: cookiePart },
  });
}

function requestWithNoCookie(): Request {
  return new Request("http://localhost/admin/naia");
}

// ── §IA-01 verifyAdminSecret ──────────────────────────────────────────────────

describe("§IA-01 verifyAdminSecret — timing-safe comparison", () => {
  it("returns true for the correct secret", () => {
    assert.equal(verifyAdminSecret("correct-test-password-for-unit-tests"), true);
  });

  it("returns false for a wrong password", () => {
    assert.equal(verifyAdminSecret("wrong-password"), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(verifyAdminSecret(""), false);
  });

  it("returns false when INTERNAL_ADMIN_SECRET is not set", () => {
    const prev = process.env.INTERNAL_ADMIN_SECRET;
    delete process.env.INTERNAL_ADMIN_SECRET;
    const result = verifyAdminSecret("correct-test-password-for-unit-tests");
    process.env.INTERNAL_ADMIN_SECRET = prev;
    assert.equal(result, false);
  });

  it("is case-sensitive — uppercase of correct password is rejected", () => {
    assert.equal(verifyAdminSecret("CORRECT-TEST-PASSWORD-FOR-UNIT-TESTS"), false);
  });
});

// ── §IA-02 createAdminSession ─────────────────────────────────────────────────

describe("§IA-02 createAdminSession — session creation", () => {
  it("returns a non-empty Set-Cookie string", async () => {
    const cookie = await createAdminSession();
    assert.ok(typeof cookie === "string" && cookie.length > 0);
  });

  it("Set-Cookie header begins with __naia_admin=", async () => {
    const cookie = await createAdminSession();
    assert.ok(cookie.startsWith("__naia_admin="), `Expected cookie to start with __naia_admin=, got: ${cookie.slice(0, 40)}`);
  });

  it("Set-Cookie includes HttpOnly", async () => {
    const cookie = await createAdminSession();
    assert.ok(cookie.toLowerCase().includes("httponly"), "Expected HttpOnly flag");
  });
});

// ── §IA-03 requireAdminSession ────────────────────────────────────────────────

describe("§IA-03 requireAdminSession — session reading and redirect on failure", () => {
  it("returns AdminSession with correct shape after valid createAdminSession round-trip", async () => {
    const setCookie = await createAdminSession();
    const req = requestWithCookie(setCookie);
    const session = await requireAdminSession(req);

    assert.equal(session.authenticated, true);
    assert.ok(typeof session.identity.id === "string" && session.identity.id.length > 0);
    assert.equal(session.identity.email, "nadeenabuobead@gmail.com");
    assert.ok(session.identity.role === "owner" || session.identity.role === "staff");
  });

  it("throws a Response redirect to /admin/login when no cookie is present", async () => {
    const req = requestWithNoCookie();
    let threw = false;
    try {
      await requireAdminSession(req);
    } catch (e) {
      threw = true;
      assert.ok(e instanceof Response, "Expected a Response redirect");
      assert.equal(e.status, 302);
      assert.equal(e.headers.get("Location"), "/admin/login");
    }
    assert.ok(threw, "Expected requireAdminSession to throw");
  });

  it("throws a redirect to /admin/login when cookie has wrong signature", async () => {
    const tamperedCookie = "__naia_admin=tampered_garbage_value; Path=/";
    const req = requestWithCookie(tamperedCookie);
    let threw = false;
    try {
      await requireAdminSession(req);
    } catch (e) {
      threw = true;
      assert.ok(e instanceof Response);
      assert.equal(e.status, 302);
      assert.equal(e.headers.get("Location"), "/admin/login");
    }
    assert.ok(threw, "Expected requireAdminSession to throw on tampered cookie");
  });
});

// ── §IA-04 destroyAdminSession ────────────────────────────────────────────────

describe("§IA-04 destroyAdminSession — session destruction", () => {
  it("returns a Set-Cookie header string", async () => {
    const setCookie = await createAdminSession();
    const req = requestWithCookie(setCookie);
    const destroyed = await destroyAdminSession(req);
    assert.ok(typeof destroyed === "string" && destroyed.length > 0);
  });

  it("after destroy, the same cookie value no longer yields a valid session", async () => {
    const setCookie = await createAdminSession();
    const req = requestWithCookie(setCookie);
    const destroyedCookie = await destroyAdminSession(req);

    // The destroyed cookie header clears the value — use it as the new request cookie
    const reqAfterDestroy = requestWithCookie(destroyedCookie);
    let threw = false;
    try {
      await requireAdminSession(reqAfterDestroy);
    } catch {
      threw = true;
    }
    assert.ok(threw, "Expected session to be invalid after destroy");
  });
});

// ── §IA-05 Identity contract ──────────────────────────────────────────────────

describe("§IA-05 Identity contract — shape and source guarantees", () => {
  it("session identity.email comes from INTERNAL_ADMIN_IDENTITY_EMAIL, not form input", async () => {
    // createAdminSession takes no arguments — identity can only come from env vars
    const setCookie = await createAdminSession();
    const req = requestWithCookie(setCookie);
    const session = await requireAdminSession(req);
    assert.equal(session.identity.email, process.env.INTERNAL_ADMIN_IDENTITY_EMAIL);
  });

  it("session.identity has id, email, and role fields", async () => {
    const setCookie = await createAdminSession();
    const session = await requireAdminSession(requestWithCookie(setCookie));
    assert.ok("id" in session.identity);
    assert.ok("email" in session.identity);
    assert.ok("role" in session.identity);
  });

  it("session.identity.role is 'owner' or 'staff'", async () => {
    const setCookie = await createAdminSession();
    const session = await requireAdminSession(requestWithCookie(setCookie));
    assert.ok(
      session.identity.role === "owner" || session.identity.role === "staff",
      `Unexpected role: ${session.identity.role}`,
    );
  });

  it("createAdminSession accepts no form arguments — cannot be injected from user input", () => {
    // Verify at type/signature level: createAdminSession() takes zero arguments
    assert.equal(createAdminSession.length, 0);
  });
});
