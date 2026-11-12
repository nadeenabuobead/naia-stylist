// Security tests for api.seed-staging.jsx
//
// §S1 — static code guarantees: the staging-only block appears before any DB access
// §S2 — environment routing: non-staging → 404, staging+no-secret → 403, valid staging → passes gate
// §S3 — no DB side-effects outside staging: prisma never called when NAIA_PROJECT_VARIANT !== "staging"
//
// NOTE: this file previously asserted a `VERCEL_ENV === "production"` gate. Commit
// "fix(seed-staging): use NAIA_PROJECT_VARIANT guard instead of VERCEL_ENV" replaced
// that gate deliberately: VERCEL_ENV is "production" on every promoted deployment,
// including the staging project's own promoted deployment, so it couldn't distinguish
// "this is the staging project" from "this is prod" — it was blocking the endpoint
// everywhere it was actually needed. The route (and every other staging-only route in
// this codebase — see app/routes.ts) now gates on the explicit NAIA_PROJECT_VARIANT
// env var instead, which is set to "staging" on exactly one Vercel project. The
// invariant this suite verifies — hard block before any DB access, secret check, or
// body/param parsing — is unchanged; only the condition it's keyed on is updated to
// match the current, intentional contract.
//
// Run: npx vitest run app/routes/api.seed-staging.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── §S1 Static code guarantees ────────────────────────────────────────────────

describe("§S1 seed-staging — static production guard", () => {
  const src = fs.readFileSync(
    path.resolve("app/routes/api.seed-staging.jsx"),
    "utf8",
  );

  it("S101 — staging-only hard block is present in loader", () => {
    expect(src).toContain('process.env.NAIA_PROJECT_VARIANT !== "staging"');
  });

  it("S102 — non-staging block returns 404 (not 405 or 200)", () => {
    // Must use status 404 or 410 as specified
    expect(src).toMatch(/NAIA_PROJECT_VARIANT[\s\S]{0,200}status: 40[04]/);
  });

  it("S103 — staging-only block in loader appears before any prisma call", () => {
    const loaderStart = src.indexOf("export async function loader");
    const actionStart = src.indexOf("export async function action");
    const loaderSrc = src.slice(loaderStart, actionStart);

    const blockPos = loaderSrc.indexOf('NAIA_PROJECT_VARIANT !== "staging"');
    const firstPrismaPos = loaderSrc.indexOf("prisma.");
    expect(blockPos, "staging-only block must exist in loader").toBeGreaterThan(-1);
    expect(firstPrismaPos, "prisma must be used in loader").toBeGreaterThan(-1);
    expect(blockPos, "staging-only block must come before prisma calls").toBeLessThan(firstPrismaPos);
  });

  it("S104 — staging-only block in action appears before any prisma call", () => {
    const actionStart = src.indexOf("export async function action");
    const actionSrc = src.slice(actionStart);

    const blockPos = actionSrc.indexOf('NAIA_PROJECT_VARIANT !== "staging"');
    const firstPrismaPos = actionSrc.indexOf("prisma.");
    expect(blockPos, "staging-only block must exist in action").toBeGreaterThan(-1);
    expect(firstPrismaPos, "prisma must be used in action").toBeGreaterThan(-1);
    expect(blockPos, "staging-only block must come before prisma calls").toBeLessThan(firstPrismaPos);
  });

  it("S105 — staging-only block in loader appears before secret check", () => {
    const loaderStart = src.indexOf("export async function loader");
    const actionStart = src.indexOf("export async function action");
    const loaderSrc = src.slice(loaderStart, actionStart);

    const blockPos = loaderSrc.indexOf('NAIA_PROJECT_VARIANT !== "staging"');
    const secretCheckPos = loaderSrc.indexOf("STAGING_SEED_SECRET");
    expect(blockPos).toBeGreaterThan(-1);
    expect(blockPos, "staging-only block must come before secret check").toBeLessThan(secretCheckPos);
  });

  it("S106 — staging-only block in action appears before secret check", () => {
    const actionStart = src.indexOf("export async function action");
    const actionSrc = src.slice(actionStart);

    const blockPos = actionSrc.indexOf('NAIA_PROJECT_VARIANT !== "staging"');
    const secretCheckPos = actionSrc.indexOf("STAGING_SEED_SECRET");
    expect(blockPos).toBeGreaterThan(-1);
    expect(blockPos, "staging-only block must come before secret check").toBeLessThan(secretCheckPos);
  });

  it("S107 — staging-only block in loader appears before request body/param reads", () => {
    const loaderStart = src.indexOf("export async function loader");
    const actionStart = src.indexOf("export async function action");
    const loaderSrc = src.slice(loaderStart, actionStart);

    const blockPos = loaderSrc.indexOf('NAIA_PROJECT_VARIANT !== "staging"');
    const urlParsePos = loaderSrc.indexOf("new URL(request.url)");
    expect(blockPos, "staging-only block must come before URL parsing").toBeLessThan(urlParsePos);
  });

  it("S108 — action staging-only block appears before request.json() body parse", () => {
    const actionStart = src.indexOf("export async function action");
    const actionSrc = src.slice(actionStart);

    const blockPos = actionSrc.indexOf('NAIA_PROJECT_VARIANT !== "staging"');
    const bodyParsePos = actionSrc.indexOf("request.json()");
    expect(blockPos, "staging-only block must come before body parsing").toBeLessThan(bodyParsePos);
  });
});

// ── §S2 Environment routing ────────────────────────────────────────────────────
// Mock prisma so no real DB calls happen during tests.

vi.mock("../db.server", () => ({
  default: {
    customer: { findUnique: vi.fn(), create: vi.fn() },
    naiaSession: { create: vi.fn() },
  },
}));

vi.mock("../lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn(),
  recordJourneyEvent: vi.fn(),
}));

import prisma from "../db.server";
import { loader, action } from "./api.seed-staging";

const STAGING_SECRET = "test-secret-abc123";

function makeLoaderRequest(opts: {
  secret?: string;
  id?: string;
  email?: string;
  to?: string;
} = {}): Parameters<typeof loader>[0] {
  const params = new URLSearchParams();
  if (opts.secret) params.set("secret", opts.secret);
  if (opts.id) params.set("id", opts.id);
  if (opts.email) params.set("email", opts.email);
  if (opts.to) params.set("to", opts.to);
  return { request: new Request(`https://example.com/api/seed-staging?${params}`) } as any;
}

function makeActionRequest(opts: {
  secret?: string;
  body?: object;
} = {}): Parameters<typeof action>[0] {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.secret) headers["x-seed-secret"] = opts.secret;
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body ?? { _action: "countRecords", customerId: "test-id" }),
    }),
  } as any;
}

describe("§S2 seed-staging — environment routing", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  // Non-staging blocks ─────────────────────────────────────────────────────────

  it("S201 — loader: production variant + correct secret → 404", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "x", email: "x@e.com" }));
    expect((res as Response).status).toBe(404);
  });

  it("S202 — action: production variant + correct secret → 404", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({ secret: STAGING_SECRET }));
    expect((res as Response).status).toBe(404);
  });

  it("S203 — loader: production variant + no secret → 404 (block fires before secret check)", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({}));
    expect((res as Response).status).toBe(404);
  });

  it("S204 — action: production variant + no secret → 404 (block fires before secret check)", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({}));
    expect((res as Response).status).toBe(404);
  });

  it("S205 — loader: unset variant (e.g. a preview deployment) + correct secret → 404", async () => {
    delete process.env.NAIA_PROJECT_VARIANT;
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "x", email: "x@e.com" }));
    expect((res as Response).status).toBe(404);
  });

  it("S206 — action: unset variant (e.g. a preview deployment) + correct secret → 404", async () => {
    delete process.env.NAIA_PROJECT_VARIANT;
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({ secret: STAGING_SECRET }));
    expect((res as Response).status).toBe(404);
  });

  // Staging without secret ────────────────────────────────────────────────────

  it("S207 — loader: staging variant + no secret → 403", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({}));
    expect((res as Response).status).toBe(403);
  });

  it("S208 — action: staging variant + no secret → 403", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({}));
    expect((res as Response).status).toBe(403);
  });

  it("S209 — loader: staging variant + wrong secret → 403", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({ secret: "wrong-secret" }));
    expect((res as Response).status).toBe(403);
  });

  it("S210 — action: staging variant + wrong secret → 403", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({ secret: "wrong-secret" }));
    expect((res as Response).status).toBe(403);
  });

  // Staging with secret ───────────────────────────────────────────────────────

  it("S211 — loader: staging variant + correct secret + valid params → passes gate (redirects, not 403/404)", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce({ id: "existing-id" });
    (prisma.naiaSession.create as any).mockResolvedValueOnce({});
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "test-id", email: "t@e.com", to: "/my-naia" }));
    expect((res as Response).status).not.toBe(403);
    expect((res as Response).status).not.toBe(404);
    expect((res as Response).status).toBe(302);
  });

  it("S212 — staging variant + correct secret but no VERCEL_ENV at all → still passes gate", async () => {
    // Confirms the gate genuinely keys on NAIA_PROJECT_VARIANT, not VERCEL_ENV —
    // this request carries no VERCEL_ENV at all (as a plain `vercel dev` / local
    // run would), only the explicit staging variant flag.
    delete process.env.VERCEL_ENV;
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce({ id: "existing-id" });
    (prisma.naiaSession.create as any).mockResolvedValueOnce({});
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "test-id", email: "t@e.com", to: "/my-naia" }));
    expect((res as Response).status).toBe(302);
  });

  it("S213 — STAGING_SEED_SECRET unset while variant is staging → 403 (not 404)", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    delete process.env.STAGING_SEED_SECRET;
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET }));
    expect((res as Response).status).toBe(403);
  });
});

// ── §S3 No DB side-effects outside staging ───────────────────────────────────

describe("§S3 seed-staging — no DB calls outside the staging variant", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  it("S301 — loader: production variant makes zero prisma calls", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "x", email: "x@e.com" }));
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.naiaSession.create).not.toHaveBeenCalled();
  });

  it("S302 — action: production variant makes zero prisma calls for createCustomer intent", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    await action(makeActionRequest({
      secret: STAGING_SECRET,
      body: { _action: "createCustomer", shopifyCustomerId: "prod-cust", email: "x@e.com" },
    }));
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("S303 — action: production variant makes zero prisma calls for createSession intent", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    await action(makeActionRequest({
      secret: STAGING_SECRET,
      body: { _action: "createSession", shopifyCustomerId: "prod-cust", email: "x@e.com" },
    }));
    expect(prisma.naiaSession.create).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("S304 — action: production variant returns 404 for every _action value", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const actions = ["createCustomer", "createSession", "loginRedirect", "cleanup", "countRecords", "getCustomerData"];
    for (const _action of actions) {
      const res = await action(makeActionRequest({ secret: STAGING_SECRET, body: { _action } }));
      expect((res as Response).status, `${_action} must be blocked outside staging`).toBe(404);
    }
  });

  it("S305 — action: unset variant returns 404 for every _action value", async () => {
    delete process.env.NAIA_PROJECT_VARIANT;
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const actions = ["createCustomer", "createSession", "loginRedirect", "cleanup", "countRecords", "getCustomerData"];
    for (const _action of actions) {
      const res = await action(makeActionRequest({ secret: STAGING_SECRET, body: { _action } }));
      expect((res as Response).status, `${_action} must be blocked when the staging variant is unset`).toBe(404);
    }
  });
});
