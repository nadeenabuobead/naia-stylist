// app/lib/clerk-session.server.authorized-parties.test.ts
//
// Regression coverage for resolveClerkUserId's Preview-origin allowance.
// Root cause: every CLI `vercel deploy` on this project mints a brand-new,
// unique *.vercel.app hostname that a static CLERK_AUTHORIZED_PARTIES list
// can never contain ahead of time, so Clerk's own authenticateRequest()
// rejected genuinely valid sessions with reason "token-invalid-authorized-
// parties" on every fresh Preview deployment. The fix trusts exactly one
// additional origin — the platform-injected VERCEL_URL, never a request
// header — and only when VERCEL_ENV === "preview".
//
// The fake client below mirrors the real SDK's actual contract (reject
// unless the token's azp claim is in the given authorizedParties list) so
// these tests exercise resolveClerkUserId's real list-construction logic,
// not a reimplementation of it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveClerkUserId } from "./clerk-session.server";

const ENV_KEYS = ["VERCEL_ENV", "VERCEL_URL", "CLERK_AUTHORIZED_PARTIES"] as const;
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

function fakeClerkClient() {
  const authenticateRequest = vi.fn(async (request: Request, opts: { authorizedParties: string[] }) => {
    const azp = request.headers.get("x-test-azp");
    const isAuthenticated = azp !== null && opts.authorizedParties.includes(azp);
    return {
      toAuth: () => (isAuthenticated ? { isAuthenticated: true, userId: "user_1" } : { isAuthenticated: false, userId: null }),
    };
  });
  return { authenticateRequest };
}

function requestWithAzp(azp: string | null) {
  const headers = new Headers();
  if (azp !== null) headers.set("x-test-azp", azp);
  return new Request("http://localhost/my-naia", { headers });
}

describe("resolveClerkUserId — Preview-origin allowance", () => {
  it("accepts a session whose azp matches the exact VERCEL_URL origin, in Preview", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "naia-stylist-staging-xyz-nadeenabuobeads-projects.vercel.app";
    process.env.CLERK_AUTHORIZED_PARTIES = "https://naia-stylist-staging-preview.vercel.app";
    const client = fakeClerkClient();

    const result = await resolveClerkUserId(
      requestWithAzp("https://naia-stylist-staging-xyz-nadeenabuobeads-projects.vercel.app"),
      { _clerkClient: client as any },
    );

    expect(result).toBe("user_1");
  });

  it("rejects an azp from a different, unapproved *.vercel.app origin — proves no wildcard trust", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "naia-stylist-staging-xyz-nadeenabuobeads-projects.vercel.app";
    process.env.CLERK_AUTHORIZED_PARTIES = "https://naia-stylist-staging-preview.vercel.app";
    const client = fakeClerkClient();

    const result = await resolveClerkUserId(
      requestWithAzp("https://some-other-abc-nadeenabuobeads-projects.vercel.app"),
      { _clerkClient: client as any },
    );

    expect(result).toBeNull();
  });

  it("preserves the existing static allowlist alongside the new Preview entry", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "naia-stylist-staging-xyz-nadeenabuobeads-projects.vercel.app";
    process.env.CLERK_AUTHORIZED_PARTIES = "https://naia-stylist-staging-preview.vercel.app";
    const client = fakeClerkClient();

    const result = await resolveClerkUserId(requestWithAzp("https://naia-stylist-staging-preview.vercel.app"), {
      _clerkClient: client as any,
    });

    expect(result).toBe("user_1");
    expect(client.authenticateRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authorizedParties: expect.arrayContaining(["https://naia-stylist-staging-preview.vercel.app"]),
      }),
    );
  });

  it("leaves production's authorizedParties exactly as configured — no Preview entry added", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "naia-stylist.vercel.app";
    process.env.CLERK_AUTHORIZED_PARTIES = "https://app.naia-stylist.com";
    const client = fakeClerkClient();

    await resolveClerkUserId(requestWithAzp("https://app.naia-stylist.com"), { _clerkClient: client as any });

    expect(client.authenticateRequest).toHaveBeenCalledWith(expect.anything(), {
      authorizedParties: ["https://app.naia-stylist.com"],
    });

    // A production azp that happens to be a *.vercel.app host must still be
    // rejected — production never gets the dynamic Preview allowance.
    const rejected = await resolveClerkUserId(requestWithAzp("https://naia-stylist.vercel.app"), {
      _clerkClient: client as any,
    });
    expect(rejected).toBeNull();
  });

  it("falls back to the static list alone when VERCEL_URL is missing in Preview — no crash, no wildcard substitute", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.VERCEL_URL;
    process.env.CLERK_AUTHORIZED_PARTIES = "https://naia-stylist-staging-preview.vercel.app";
    const client = fakeClerkClient();

    const result = await resolveClerkUserId(requestWithAzp("https://naia-stylist-staging-preview.vercel.app"), {
      _clerkClient: client as any,
    });

    expect(result).toBe("user_1");
    expect(client.authenticateRequest).toHaveBeenCalledWith(expect.anything(), {
      authorizedParties: ["https://naia-stylist-staging-preview.vercel.app"],
    });
  });

  it("still rejects a request with no session at all, regardless of environment", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "naia-stylist-staging-xyz-nadeenabuobeads-projects.vercel.app";
    process.env.CLERK_AUTHORIZED_PARTIES = "https://naia-stylist-staging-preview.vercel.app";
    const client = fakeClerkClient();

    const result = await resolveClerkUserId(requestWithAzp(null), { _clerkClient: client as any });

    expect(result).toBeNull();
  });
});
