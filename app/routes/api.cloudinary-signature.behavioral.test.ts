// app/routes/api.cloudinary-signature.behavioral.test.ts
// Phase 1 — real loader() invocation, mocked auth/Cloudinary/rate-limit
// deps. No live DB, no network, no real customer photos.
//
// Run: npx vitest run app/routes/api.cloudinary-signature.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));
vi.mock("../lib/cloudinary-admin.server", () => ({
  buildModelUploadUrl: vi.fn(() => "https://api.cloudinary.com/v1_1/test/image/private/upload"),
}));
vi.mock("../lib/api-rate-limit.server", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn((r) =>
    Response.json({ error: "Too many requests. Please try again shortly." }, {
      status: 429,
      headers: { "Retry-After": String(r.retryAfterSeconds) },
    }),
  ),
}));

import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { checkRateLimit } from "../lib/api-rate-limit.server";
import { loader } from "./api.cloudinary-signature.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  process.env.CLOUDINARY_WARDROBE_UPLOAD_PRESET = "test-preset";
});

const req = () => new Request("http://localhost/api/cloudinary-signature");

describe("unauthenticated requests", () => {
  it("401s before the rate limit is ever checked", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue(null);
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("authenticated, within limit", () => {
  it("returns a real signature and checks the limit keyed by the customer id", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    (checkRateLimit as any).mockResolvedValue({ allowed: true, overLimit: false, mode: "shadow", count: 1, limit: 20, retryAfterSeconds: 0 });
    const res = await loader({ request: req() } as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.signature).toBeTruthy();
    expect(body.apiKey).toBe("test-key");
    expect(checkRateLimit).toHaveBeenCalledWith("cust_abc", expect.objectContaining({ routeKey: "cloudinary-signature" }));
  });
});

describe("shadow mode never blocks a legitimate multi-image Closet upload", () => {
  it("still returns 200 even when checkRateLimit reports overLimit", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    (checkRateLimit as any).mockResolvedValue({ allowed: true, overLimit: true, mode: "shadow", count: 25, limit: 20, retryAfterSeconds: 0 });
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(200);
  });
});

describe("enforce mode — 429 with Retry-After", () => {
  it("returns 429 and never reaches the Cloudinary signing code", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    (checkRateLimit as any).mockResolvedValue({ allowed: false, overLimit: true, mode: "enforce", count: 25, limit: 20, retryAfterSeconds: 42 });
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.signature).toBeUndefined();
  });
});

describe("existing behavior preserved", () => {
  it("still 500s cleanly if Cloudinary env vars are missing, after auth+rate-limit pass", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    (checkRateLimit as any).mockResolvedValue({ allowed: true, overLimit: false, mode: "shadow", count: 1, limit: 20, retryAfterSeconds: 0 });
    delete process.env.CLOUDINARY_API_SECRET;
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(500);
  });
});
