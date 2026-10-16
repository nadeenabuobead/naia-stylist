// Tests for the QA-fixture-only actions added to api.seed-staging.jsx:
// setOnboardingProfile and createClosetItemDetailed.
//
// Kept separate from api.seed-staging.test.ts (which has pre-existing,
// unrelated drift — it asserts a VERCEL_ENV gate the code no longer uses,
// see commit "fix(seed-staging): use NAIA_PROJECT_VARIANT guard instead of
// VERCEL_ENV" — not touched here).
//
// Run: npx vitest run app/routes/api.seed-staging.fixture-actions.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    customer: { findUnique: vi.fn(), create: vi.fn() },
    onboardingProfile: { upsert: vi.fn() },
    closetItem: { create: vi.fn() },
    naiaSession: { create: vi.fn() },
  },
}));

vi.mock("../lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn(),
  recordJourneyEvent: vi.fn(),
}));

import prisma from "../db.server";
import { action, loader } from "./api.seed-staging";

const STAGING_SECRET = "test-secret-abc123";

function makeLoaderRequest(search: string): Parameters<typeof loader>[0] {
  return { request: new Request(`https://example.com/api/seed-staging${search}`) } as any;
}

function makeActionRequest(body: object): Parameters<typeof action>[0] {
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": STAGING_SECRET },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe("§S4 seed-staging fixture actions — scoped to test-batch1- customers only", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  it("S401 — setOnboardingProfile refuses a customerId that is not a test-batch1- fixture", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "real-customer-id",
      shopifyCustomerId: "123456789", // a real Shopify numeric id, not test-batch1-
    });
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "real-customer-id", profile: { lifestyle: ["office"] } }),
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.onboardingProfile.upsert).not.toHaveBeenCalled();
  });

  it("S402 — setOnboardingProfile refuses when the customer does not exist at all", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "nonexistent", profile: { lifestyle: ["office"] } }),
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.onboardingProfile.upsert).not.toHaveBeenCalled();
  });

  it("S403 — setOnboardingProfile proceeds for a genuine test-batch1- fixture customer", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "fixture-id",
      shopifyCustomerId: "test-batch1-wi-a-populated",
    });
    (prisma.onboardingProfile.upsert as any).mockResolvedValueOnce({ id: "profile-1", completed: true });
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "fixture-id", profile: { lifestyle: ["office"] } }),
    );
    expect((res as Response).status).toBe(200);
    expect(prisma.onboardingProfile.upsert).toHaveBeenCalledTimes(1);
  });

  it("S404 — createClosetItemDetailed refuses a customerId that is not a test-batch1- fixture", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "real-customer-id",
      shopifyCustomerId: "123456789",
    });
    const res = await action(
      makeActionRequest({ _action: "createClosetItemDetailed", customerId: "real-customer-id", item: { category: "TOPS" } }),
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.closetItem.create).not.toHaveBeenCalled();
  });

  it("S405 — createClosetItemDetailed proceeds for a genuine test-batch1- fixture customer", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "fixture-id",
      shopifyCustomerId: "test-batch1-wi-a-populated",
    });
    (prisma.closetItem.create as any).mockResolvedValueOnce({ id: "item-1", category: "TOPS", primaryColor: "Black" });
    const res = await action(
      makeActionRequest({ _action: "createClosetItemDetailed", customerId: "fixture-id", item: { category: "TOPS" } }),
    );
    expect((res as Response).status).toBe(200);
    expect(prisma.closetItem.create).toHaveBeenCalledTimes(1);
  });

  it("S406 — a customer whose shopifyCustomerId merely contains, but does not start with, the prefix is refused", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "tricky-id",
      shopifyCustomerId: "123-test-batch1-wi-a-populated",
    });
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "tricky-id", profile: {} }),
    );
    expect((res as Response).status).toBe(403);
  });
});

// ── §S5 Login tickets — secret-free, short-lived, single-use ─────────────────

describe("§S5 seed-staging login tickets", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  it("S501 — createLoginLink refuses a shopifyCustomerId without the test-batch1- prefix", async () => {
    const res = await action(
      makeActionRequest({ _action: "createLoginLink", shopifyCustomerId: "real-123", email: "x@example.com" }),
    );
    expect((res as Response).status).toBe(400);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("S502 — createLoginLink's returned URL contains a ticket and never the raw secret", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    (prisma.customer.create as any).mockResolvedValueOnce({ id: "fixture-id" });
    const res = await action(
      makeActionRequest({ _action: "createLoginLink", shopifyCustomerId: "test-batch1-wi-a-populated", email: "wi-qa-a@example.com", to: "/closet/intelligence" }),
    );
    expect((res as Response).status).toBe(200);
    const json = await (res as Response).json();
    expect(json.url).toMatch(/\?ticket=/);
    expect(json.url).not.toContain("secret=");
    expect(json.url).not.toContain(STAGING_SECRET);
  });

  it("S503 — a freshly issued ticket redeems once: sets the cookie, redirects, and cannot be reused", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    (prisma.customer.create as any).mockResolvedValueOnce({ id: "fixture-id" });
    const createRes = await action(
      makeActionRequest({ _action: "createLoginLink", shopifyCustomerId: "test-batch1-wi-a-populated", email: "wi-qa-a@example.com", to: "/closet/intelligence" }),
    );
    const { url } = await (createRes as Response).json();
    const ticket = new URL(url).searchParams.get("ticket")!;

    (prisma.customer.findUnique as any).mockResolvedValueOnce({ id: "fixture-id" });
    (prisma.naiaSession.create as any).mockResolvedValueOnce({});
    const firstRedeem = await loader(makeLoaderRequest(`?ticket=${encodeURIComponent(ticket)}`));
    expect((firstRedeem as Response).status).toBe(302);
    expect((firstRedeem as Response).headers.get("Location")).toBe("/closet/intelligence");
    expect((firstRedeem as Response).headers.get("Set-Cookie")).toMatch(/^__naia_tok=/);

    // Same ticket again — must be refused, not silently re-honoured.
    const secondRedeem = await loader(makeLoaderRequest(`?ticket=${encodeURIComponent(ticket)}`));
    expect((secondRedeem as Response).status).toBe(410);
  });

  it("S504 — a tampered ticket (flipped signature) is rejected outright", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    (prisma.customer.create as any).mockResolvedValueOnce({ id: "fixture-id" });
    const createRes = await action(
      makeActionRequest({ _action: "createLoginLink", shopifyCustomerId: "test-batch1-wi-a-populated", email: "wi-qa-a@example.com" }),
    );
    const { url } = await (createRes as Response).json();
    const ticket = new URL(url).searchParams.get("ticket")!;
    const [payload] = ticket.split(".");
    const tampered = `${payload}.not-the-real-signature`;

    const res = await loader(makeLoaderRequest(`?ticket=${encodeURIComponent(tampered)}`));
    expect((res as Response).status).toBe(410);
    expect(prisma.naiaSession.create).not.toHaveBeenCalled();
  });

  it("S505 — an expired ticket is rejected, even with the server's own 30s floor on requested TTL", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    (prisma.customer.create as any).mockResolvedValueOnce({ id: "fixture-id" });
    const createRes = await action(
      makeActionRequest({ _action: "createLoginLink", shopifyCustomerId: "test-batch1-wi-a-populated", email: "wi-qa-a@example.com", ttlSeconds: 1 }),
    );
    const { url } = await (createRes as Response).json();
    const ticket = new URL(url).searchParams.get("ticket")!;

    // A requested 1s TTL is clamped up to the server's 30s floor — simulate
    // real time passing well beyond even that, instead of a slow real sleep.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    try {
      const res = await loader(makeLoaderRequest(`?ticket=${encodeURIComponent(ticket)}`));
      expect((res as Response).status).toBe(410);
    } finally {
      vi.useRealTimers();
    }
  });

  it("S506 — a ticket signed with a different secret is rejected", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    (prisma.customer.create as any).mockResolvedValueOnce({ id: "fixture-id" });
    const createRes = await action(
      makeActionRequest({ _action: "createLoginLink", shopifyCustomerId: "test-batch1-wi-a-populated", email: "wi-qa-a@example.com" }),
    );
    const { url } = await (createRes as Response).json();
    const ticket = new URL(url).searchParams.get("ticket")!;

    process.env.STAGING_SEED_SECRET = "a-completely-different-secret";
    const res = await loader(makeLoaderRequest(`?ticket=${encodeURIComponent(ticket)}`));
    expect((res as Response).status).toBe(410);
  });
});

// ── §S6 WI_QA_LOGIN_SECRET — dedicated, independent of STAGING_SEED_SECRET ───

function makeActionRequestWithSecret(body: object, secretHeader: string): Parameters<typeof action>[0] {
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": secretHeader },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe("§S6 seed-staging — dedicated WI_QA_LOGIN_SECRET", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSeedSecret = process.env.STAGING_SEED_SECRET;
  const originalWiSecret = process.env.WI_QA_LOGIN_SECRET;
  const WI_SECRET = "dedicated-wi-qa-secret-xyz";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSeedSecret;
    process.env.WI_QA_LOGIN_SECRET = originalWiSecret;
  });

  it("S601 — WI_QA_LOGIN_SECRET alone (STAGING_SEED_SECRET unset) authorizes a header-authenticated action", async () => {
    delete process.env.STAGING_SEED_SECRET;
    process.env.WI_QA_LOGIN_SECRET = WI_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "fixture-id",
      shopifyCustomerId: "test-batch1-wi-a-populated",
    });
    (prisma.onboardingProfile.upsert as any).mockResolvedValueOnce({ id: "profile-1", completed: true });
    const res = await action(
      makeActionRequestWithSecret({ _action: "setOnboardingProfile", customerId: "fixture-id", profile: {} }, WI_SECRET),
    );
    expect((res as Response).status).toBe(200);
  });

  it("S602 — the OLD STAGING_SEED_SECRET value no longer works if it's wrong, but WI_QA_LOGIN_SECRET still does — proving independence", async () => {
    process.env.STAGING_SEED_SECRET = "stale-or-rotated-value-the-caller-no-longer-has";
    process.env.WI_QA_LOGIN_SECRET = WI_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "fixture-id",
      shopifyCustomerId: "test-batch1-wi-a-populated",
    });
    (prisma.onboardingProfile.upsert as any).mockResolvedValueOnce({ id: "profile-1", completed: true });
    const res = await action(
      makeActionRequestWithSecret({ _action: "setOnboardingProfile", customerId: "fixture-id", profile: {} }, WI_SECRET),
    );
    expect((res as Response).status).toBe(200);
  });

  it("S603 — a wrong value for both secrets is still rejected", async () => {
    process.env.STAGING_SEED_SECRET = "real-value-a";
    process.env.WI_QA_LOGIN_SECRET = "real-value-b";
    const res = await action(
      makeActionRequestWithSecret({ _action: "setOnboardingProfile", customerId: "fixture-id", profile: {} }, "guessed-wrong-value"),
    );
    expect((res as Response).status).toBe(403);
  });

  it("S604 — a login ticket created and verified entirely under WI_QA_LOGIN_SECRET needs no STAGING_SEED_SECRET at all", async () => {
    delete process.env.STAGING_SEED_SECRET;
    process.env.WI_QA_LOGIN_SECRET = WI_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    (prisma.customer.create as any).mockResolvedValueOnce({ id: "fixture-id" });
    const createRes = await action(
      makeActionRequestWithSecret(
        { _action: "createLoginLink", shopifyCustomerId: "test-batch1-wi-a-populated", email: "wi-qa-a@example.com", to: "/closet/intelligence" },
        WI_SECRET,
      ),
    );
    expect((createRes as Response).status).toBe(200);
    const { url } = await (createRes as Response).json();
    const ticket = new URL(url).searchParams.get("ticket")!;

    (prisma.customer.findUnique as any).mockResolvedValueOnce({ id: "fixture-id" });
    (prisma.naiaSession.create as any).mockResolvedValueOnce({});
    const redeemRes = await loader(makeLoaderRequest(`?ticket=${encodeURIComponent(ticket)}`));
    expect((redeemRes as Response).status).toBe(302);
  });
});
