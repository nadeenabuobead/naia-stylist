// app/lib/clerk-session.server.key-guard.test.ts
//
// Correctness follow-up (2026-11-14) to the Nov 12 Stripe/Clerk audit's own
// open finding: "Clerk publishable-key sharing has no code-level guard,
// unlike Stripe's assertTestModeKey." Mirrors that guard's shape, but
// asymmetrically — Clerk's Production environment legitimately needs a
// live key pair, unlike Stripe's standing test-mode-only constraint.
//
// Run: npx vitest run app/lib/clerk-session.server.key-guard.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertClerkKeysConsistent, ClerkKeyMisconfiguredError } from "./clerk-session.server";

const ENV_KEYS = ["VERCEL_ENV"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("assertClerkKeysConsistent", () => {
  it("passes for a valid test key pair, in any environment", () => {
    process.env.VERCEL_ENV = "preview";
    expect(() => assertClerkKeysConsistent("sk_test_abc123", "pk_test_abc123")).not.toThrow();
  });

  it("passes for a valid live key pair in Production", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => assertClerkKeysConsistent("sk_live_abc123", "pk_live_abc123")).not.toThrow();
  });

  it("passes for a valid live key pair when VERCEL_ENV is unset entirely (e.g. local dev against a real instance)", () => {
    expect(() => assertClerkKeysConsistent("sk_live_abc123", "pk_live_abc123")).not.toThrow();
  });

  it("is a no-op when the publishable key is missing entirely — not this guard's concern", () => {
    expect(() => assertClerkKeysConsistent("sk_test_abc123", undefined)).not.toThrow();
  });

  it("rejects a secret key with no recognizable Clerk prefix", () => {
    expect(() => assertClerkKeysConsistent("not-a-real-key", "pk_test_abc123")).toThrow(ClerkKeyMisconfiguredError);
    expect(() => assertClerkKeysConsistent("not-a-real-key", "pk_test_abc123")).toThrow(/CLERK_SECRET_KEY/);
  });

  it("rejects a publishable key with no recognizable Clerk prefix", () => {
    expect(() => assertClerkKeysConsistent("sk_test_abc123", "not-a-real-key")).toThrow(ClerkKeyMisconfiguredError);
    expect(() => assertClerkKeysConsistent("sk_test_abc123", "not-a-real-key")).toThrow(/CLERK_PUBLISHABLE_KEY/);
  });

  it("rejects a mismatched pair — test secret with live publishable", () => {
    expect(() => assertClerkKeysConsistent("sk_test_abc123", "pk_live_abc123")).toThrow(ClerkKeyMisconfiguredError);
    expect(() => assertClerkKeysConsistent("sk_test_abc123", "pk_live_abc123")).toThrow(/different Clerk modes/);
  });

  it("rejects a mismatched pair — live secret with test publishable", () => {
    expect(() => assertClerkKeysConsistent("sk_live_abc123", "pk_test_abc123")).toThrow(/different Clerk modes/);
  });

  it("rejects a genuinely live key pair on a Preview deployment — the core misconfiguration this guard exists to catch", () => {
    process.env.VERCEL_ENV = "preview";
    expect(() => assertClerkKeysConsistent("sk_live_abc123", "pk_live_abc123")).toThrow(ClerkKeyMisconfiguredError);
    expect(() => assertClerkKeysConsistent("sk_live_abc123", "pk_live_abc123")).toThrow(/Preview/);
  });

  it("does NOT reject a test key pair on Production — a non-functional but not security-relevant misconfiguration, left to surface naturally", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => assertClerkKeysConsistent("sk_test_abc123", "pk_test_abc123")).not.toThrow();
  });

  it("does NOT reject a live key pair outside Preview specifically (e.g. plain 'production' or unset VERCEL_ENV)", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => assertClerkKeysConsistent("sk_live_abc123", "pk_live_abc123")).not.toThrow();
  });
});
