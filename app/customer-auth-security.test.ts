// Regression coverage for the 2026-11-14 JWT-fallback-secret hotfix
// (customer-auth.server.js).
//
// Previously: const SECRET = NAIA_CUSTOMER_SECRET || SHOPIFY_API_SECRET ||
// "naia-fallback-secret" — a hardcoded, publicly-readable string (this repo
// is public) used to sign/verify customer tokens whenever both real secrets
// were unset. Anyone who read the source could forge a valid 30-day
// customer token in that configuration. Fixed to fail closed (throw)
// instead of falling back to a guessable secret.
//
// Run: npx vitest run app/customer-auth-security.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { createCustomerToken, verifyCustomerToken } from "./customer-auth.server";

const ENV_KEYS = ["NAIA_CUSTOMER_SECRET", "SHOPIFY_API_SECRET"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("customer-auth.server — JWT secret fails closed", () => {
  it("createCustomerToken throws when neither NAIA_CUSTOMER_SECRET nor SHOPIFY_API_SECRET is configured", () => {
    delete process.env.NAIA_CUSTOMER_SECRET;
    delete process.env.SHOPIFY_API_SECRET;

    expect(() =>
      createCustomerToken({ shopifyId: "123", email: "a@b.com", firstName: "A", lastName: "B" }),
    ).toThrow();
  });

  it("verifyCustomerToken does not fall back to a guessable secret when unconfigured — forged tokens signed with the old hardcoded string are rejected", () => {
    delete process.env.NAIA_CUSTOMER_SECRET;
    delete process.env.SHOPIFY_API_SECRET;

    // Simulates exactly the forgery this hotfix closes: anyone reading the
    // old source could sign with this literal string.
    const forged = jwt.sign({ shopifyId: "999", email: "attacker@evil.com" }, "naia-fallback-secret");

    // getSecret() now throws when unconfigured; that throw happens inside
    // verifyCustomerToken's own try/catch, so the caller never sees an
    // exception — it just gets a clean rejection, same as any other invalid
    // token. The actual bug being fixed is that this used to be a VALID
    // token in this exact configuration; now it can never succeed, because
    // there is no secret for jwt.verify to successfully match against.
    expect(() => verifyCustomerToken(forged)).not.toThrow();
    expect(verifyCustomerToken(forged)).toBeNull();
  });

  it("the old hardcoded fallback string is no longer used as an actual fallback value in code — only mentioned in the explanatory comment", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(require.resolve("./customer-auth.server"), "utf8");
    // The comment legitimately names the old string for documentation; what
    // must be gone is the executable pattern that used it as a fallback.
    expect(src).not.toMatch(/\|\|\s*["']naia-fallback-secret["']/);
  });

  it("with a real secret configured, createCustomerToken and verifyCustomerToken round-trip correctly", () => {
    process.env.NAIA_CUSTOMER_SECRET = "a-real-test-secret-value";
    delete process.env.SHOPIFY_API_SECRET;

    const token = createCustomerToken({ shopifyId: "42", email: "real@customer.com", firstName: "Real", lastName: "Customer" });
    const payload = verifyCustomerToken(token) as { shopifyId?: string; email?: string } | null;

    expect(payload?.shopifyId).toBe("42");
    expect(payload?.email).toBe("real@customer.com");
  });

  it("a forged token signed with a different (wrong) secret is rejected even when a real secret IS configured", () => {
    process.env.NAIA_CUSTOMER_SECRET = "a-real-test-secret-value";
    delete process.env.SHOPIFY_API_SECRET;

    const forged = jwt.sign({ shopifyId: "999", email: "attacker@evil.com" }, "some-other-guessed-secret");

    expect(verifyCustomerToken(forged)).toBeNull();
  });

  it("an unsupported / malformed legacy token returns null gracefully, never throws", () => {
    process.env.NAIA_CUSTOMER_SECRET = "a-real-test-secret-value";

    expect(() => verifyCustomerToken("not-a-real-jwt-at-all")).not.toThrow();
    expect(verifyCustomerToken("not-a-real-jwt-at-all")).toBeNull();
    expect(verifyCustomerToken("")).toBeNull();
  });
});
