// Security tests for api.seed-staging.jsx
//
// §S1 — static code guarantees: production block appears before any DB access
// §S2 — environment routing: production → 404, no-secret → 403, valid staging → passes gate
// §S3 — no production DB side-effects: prisma never called when VERCEL_ENV=production
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

  it("S101 — production hard block is present in loader", () => {
    expect(src).toContain('process.env.VERCEL_ENV === "production"');
  });

  it("S102 — production block returns 404 (not 405 or 200)", () => {
    // Must use status 404 or 410 as specified
    expect(src).toMatch(/VERCEL_ENV.*?production[\s\S]{0,200}status: 40[04]/);
  });

  it("S103 — production block in loader appears before any prisma call", () => {
    const loaderStart = src.indexOf("export async function loader");
    const actionStart = src.indexOf("export async function action");
    const loaderSrc = src.slice(loaderStart, actionStart);

    const productionBlockPos = loaderSrc.indexOf('VERCEL_ENV === "production"');
    const firstPrismaPos = loaderSrc.indexOf("prisma.");
    expect(productionBlockPos, "production block must exist in loader").toBeGreaterThan(-1);
    expect(firstPrismaPos, "prisma must be used in loader").toBeGreaterThan(-1);
    expect(productionBlockPos, "production block must come before prisma calls").toBeLessThan(firstPrismaPos);
  });

  it("S104 — production block in action appears before any prisma call", () => {
    const actionStart = src.indexOf("export async function action");
    const actionSrc = src.slice(actionStart);

    const productionBlockPos = actionSrc.indexOf('VERCEL_ENV === "production"');
    const firstPrismaPos = actionSrc.indexOf("prisma.");
    expect(productionBlockPos, "production block must exist in action").toBeGreaterThan(-1);
    expect(firstPrismaPos, "prisma must be used in action").toBeGreaterThan(-1);
    expect(productionBlockPos, "production block must come before prisma calls").toBeLessThan(firstPrismaPos);
  });

  it("S105 — production block in loader appears before secret check", () => {
    const loaderStart = src.indexOf("export async function loader");
    const actionStart = src.indexOf("export async function action");
    const loaderSrc = src.slice(loaderStart, actionStart);

    const productionBlockPos = loaderSrc.indexOf('VERCEL_ENV === "production"');
    const secretCheckPos = loaderSrc.indexOf("STAGING_SEED_SECRET");
    expect(productionBlockPos).toBeGreaterThan(-1);
    expect(productionBlockPos, "production block must come before secret check").toBeLessThan(secretCheckPos);
  });

  it("S106 — production block in action appears before secret check", () => {
    const actionStart = src.indexOf("export async function action");
    const actionSrc = src.slice(actionStart);

    const productionBlockPos = actionSrc.indexOf('VERCEL_ENV === "production"');
    const secretCheckPos = actionSrc.indexOf("STAGING_SEED_SECRET");
    expect(productionBlockPos).toBeGreaterThan(-1);
    expect(productionBlockPos, "production block must come before secret check").toBeLessThan(secretCheckPos);
  });

  it("S107 — production block in loader appears before request body/param reads", () => {
    const loaderStart = src.indexOf("export async function loader");
    const actionStart = src.indexOf("export async function action");
    const loaderSrc = src.slice(loaderStart, actionStart);

    const productionBlockPos = loaderSrc.indexOf('VERCEL_ENV === "production"');
    const urlParsePos = loaderSrc.indexOf("new URL(request.url)");
    expect(productionBlockPos, "production block must come before URL parsing").toBeLessThan(urlParsePos);
  });

  it("S108 — action production block appears before request.json() body parse", () => {
    const actionStart = src.indexOf("export async function action");
    const actionSrc = src.slice(actionStart);

    const productionBlockPos = actionSrc.indexOf('VERCEL_ENV === "production"');
    const bodyParsePos = actionSrc.indexOf("request.json()");
    expect(productionBlockPos, "production block must come before body parsing").toBeLessThan(bodyParsePos);
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
  const originalEnv = process.env.VERCEL_ENV;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.VERCEL_ENV = originalEnv;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  // Production blocks ─────────────────────────────────────────────────────────

  it("S201 — loader: production + correct secret → 404", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "x", email: "x@e.com" }));
    expect((res as Response).status).toBe(404);
  });

  it("S202 — action: production + correct secret → 404", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({ secret: STAGING_SECRET }));
    expect((res as Response).status).toBe(404);
  });

  it("S203 — loader: production + no secret → 404 (block fires before secret check)", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({}));
    expect((res as Response).status).toBe(404);
  });

  it("S204 — action: production + no secret → 404 (block fires before secret check)", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({}));
    expect((res as Response).status).toBe(404);
  });

  // Staging without secret ────────────────────────────────────────────────────

  it("S205 — loader: preview env + no secret → 403", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({}));
    expect((res as Response).status).toBe(403);
  });

  it("S206 — action: preview env + no secret → 403", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({}));
    expect((res as Response).status).toBe(403);
  });

  it("S207 — loader: preview env + wrong secret → 403", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await loader(makeLoaderRequest({ secret: "wrong-secret" }));
    expect((res as Response).status).toBe(403);
  });

  it("S208 — action: preview env + wrong secret → 403", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const res = await action(makeActionRequest({ secret: "wrong-secret" }));
    expect((res as Response).status).toBe(403);
  });

  // Staging with secret ───────────────────────────────────────────────────────

  it("S209 — loader: preview env + correct secret + valid params → passes gate (redirects, not 403/404)", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce({ id: "existing-id" });
    (prisma.naiaSession.create as any).mockResolvedValueOnce({});
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "test-id", email: "t@e.com", to: "/my-naia" }));
    expect((res as Response).status).not.toBe(403);
    expect((res as Response).status).not.toBe(404);
    expect((res as Response).status).toBe(302);
  });

  it("S210 — local dev (no VERCEL_ENV set) + correct secret → passes gate", async () => {
    delete process.env.VERCEL_ENV;
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    (prisma.customer.findUnique as any).mockResolvedValueOnce({ id: "existing-id" });
    (prisma.naiaSession.create as any).mockResolvedValueOnce({});
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "test-id", email: "t@e.com", to: "/my-naia" }));
    expect((res as Response).status).toBe(302);
  });

  it("S211 — STAGING_SEED_SECRET unset in any env → 403 (not 404)", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.STAGING_SEED_SECRET;
    const res = await loader(makeLoaderRequest({ secret: STAGING_SECRET }));
    expect((res as Response).status).toBe(403);
  });
});

// ── §S3 No production DB side-effects ────────────────────────────────────────

describe("§S3 seed-staging — no DB calls in production", () => {
  const originalEnv = process.env.VERCEL_ENV;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.VERCEL_ENV = originalEnv;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  it("S301 — loader: production environment makes zero prisma calls", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    await loader(makeLoaderRequest({ secret: STAGING_SECRET, id: "x", email: "x@e.com" }));
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.naiaSession.create).not.toHaveBeenCalled();
  });

  it("S302 — action: production environment makes zero prisma calls for createCustomer intent", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    await action(makeActionRequest({
      secret: STAGING_SECRET,
      body: { _action: "createCustomer", shopifyCustomerId: "prod-cust", email: "x@e.com" },
    }));
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("S303 — action: production environment makes zero prisma calls for createSession intent", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    await action(makeActionRequest({
      secret: STAGING_SECRET,
      body: { _action: "createSession", shopifyCustomerId: "prod-cust", email: "x@e.com" },
    }));
    expect(prisma.naiaSession.create).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("S304 — action: production returns 404 for every _action value", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    const actions = ["createCustomer", "createSession", "loginRedirect", "cleanup", "countRecords", "getCustomerData"];
    for (const _action of actions) {
      const res = await action(makeActionRequest({ secret: STAGING_SECRET, body: { _action } }));
      expect((res as Response).status, `${_action} must be blocked in production`).toBe(404);
    }
  });
});
