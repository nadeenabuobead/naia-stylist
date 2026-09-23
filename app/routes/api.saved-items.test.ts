// app/routes/api.saved-items.test.ts
//
// The save endpoint. Two things matter most here and both are tested below:
// a customer can only ever touch their own saves, and a signed-out visitor gets
// a usable answer rather than a silent no-op.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));
vi.mock("~/lib/saved-items.server", () => ({
  saveItem: vi.fn(async () => ({ created: true, refKey: "r:rep_1|TREND|tc_aaaaaaaaaaaa", itemId: "si_1" })),
  unsaveItem: vi.fn(async () => "si_1"),
  savedItemFacets: vi.fn(async () => null),
}));
vi.mock("~/lib/trend-feedback.server", () => ({
  emitTrendEvidence: vi.fn(async () => {}),
  withdrawTrendEvidence: vi.fn(async () => {}),
}));
vi.mock("~/lib/saved-items-resolve.server", () => ({
  resolveSaveTarget: vi.fn(async () => ({
    ok: true,
    request: {
      contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", reportId: "rep_1",
      label: "Suede Textures", sourceKind: "TREND_REPORT",
    },
  })),
}));

import { action, loader } from "./api.saved-items";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { saveItem, unsaveItem } from "~/lib/saved-items.server";
import { resolveSaveTarget } from "~/lib/saved-items-resolve.server";

function post(fields: Record<string, string>, url = "https://naia.test/api/saved-items") {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(url, { method: "POST", body });
}

const asCustomer = (id: string) => vi.mocked(getCurrentNaiaCustomer).mockResolvedValue({ id } as never);

// react-router's data() returns a DataWithResponseInit wrapper, not a Response.
const status = (res: unknown) => (res as { init?: { status?: number } })?.init?.status ?? 200;
const payload = (res: unknown) => (res as { data?: unknown })?.data as Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

// ── §API-1 authenticated ──────────────────────────────────────────────────────

describe("§API-1 signed in", () => {
  it("saves and reports the canonical refKey", async () => {
    asCustomer("cust-1");
    const res = await action({ request: post({ intent: "save", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", reportSlug: "autumn" }) } as never);
    expect(payload(res)).toEqual({ ok: true, saved: true, refKey: "r:rep_1|TREND|tc_aaaaaaaaaaaa" });
  });

  it("passes the SESSION customer id to the service, never one from the body", async () => {
    asCustomer("cust-1");
    await action({ request: post({
      intent: "save", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", reportSlug: "autumn",
      customerId: "cust-2",                        // hostile field
    }) } as never);
    expect(vi.mocked(saveItem).mock.calls[0][0]).toBe("cust-1");
  });

  it("unsaves scoped to the session customer", async () => {
    asCustomer("cust-1");
    await action({ request: post({ intent: "unsave", refKey: "r:rep_9|TREND|tc_ffffffffffff", customerId: "cust-2" }) } as never);
    expect(vi.mocked(unsaveItem).mock.calls[0][0]).toBe("cust-1");
  });

  it("a repeat save is accepted and reports the same state — idempotent", async () => {
    asCustomer("cust-1");
    vi.mocked(saveItem).mockResolvedValueOnce({ created: false, refKey: "r:rep_1|TREND|tc_aaaaaaaaaaaa" } as never);
    const res = await action({ request: post({ intent: "save", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", reportSlug: "autumn" }) } as never);
    expect(payload(res).saved).toBe(true);
  });

  it("rejects an unknown content type rather than writing it", async () => {
    asCustomer("cust-1");
    const res = await action({ request: post({ intent: "save", contentType: "OUTFIT", contentId: "x" }) } as never);
    expect(status(res)).toBe(400);
    expect(saveItem).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    asCustomer("cust-1");
    const res = await action({ request: post({ intent: "delete-everything" }) } as never);
    expect(status(res)).toBe(400);
  });

  it("404s content that is not in the report", async () => {
    asCustomer("cust-1");
    vi.mocked(resolveSaveTarget).mockResolvedValueOnce({ ok: false, reason: "content_not_found" } as never);
    const res = await action({ request: post({ intent: "save", contentType: "TREND", contentId: "tc_ffffffffffff", reportSlug: "autumn" }) } as never);
    expect(status(res)).toBe(404);
    expect(saveItem).not.toHaveBeenCalled();
  });
});

// ── §API-2 signed out ─────────────────────────────────────────────────────────

describe("§API-2 signed out", () => {
  beforeEach(() => vi.mocked(getCurrentNaiaCustomer).mockResolvedValue(null as never));

  it("answers 401 with a sign-in path instead of redirecting a background POST", async () => {
    const res = await action({ request: post({ intent: "save", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", reportSlug: "autumn", returnTo: "/trends/autumn" }) } as never);
    expect(status(res)).toBe(401);
    expect(payload(res).error).toBe("unauthenticated");
    expect(payload(res).signInPath).toBe("/auth/shopify/login?return_to=%2Ftrends%2Fautumn");
  });

  it("writes nothing", async () => {
    await action({ request: post({ intent: "save", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", reportSlug: "autumn" }) } as never);
    expect(saveItem).not.toHaveBeenCalled();
    expect(unsaveItem).not.toHaveBeenCalled();
  });

  it("refuses to bounce the visitor off-site after sign-in", async () => {
    for (const hostile of ["https://evil.test/x", "//evil.test/x"]) {
      const res = await action({ request: post({ intent: "save", contentType: "TREND", contentId: "tc_aaaaaaaaaaaa", returnTo: hostile }) } as never);
      expect(payload(res).signInPath).toBe("/auth/shopify/login?return_to=%2Ftrends");
    }
  });
});

// ── §API-3 method ─────────────────────────────────────────────────────────────

describe("§API-3 method", () => {
  it("is POST only", async () => {
    asCustomer("cust-1");
    const res = await action({ request: new Request("https://naia.test/api/saved-items", { method: "PUT" }) } as never);
    expect(status(res)).toBe(405);
    expect(status(await loader())).toBe(405);
  });
});

// ── §API-4 isolation by construction ──────────────────────────────────────────

describe("§API-4 customer isolation", () => {
  it("the endpoint never reads a customer id from the request", () => {
    const src = readFileSync(join(process.cwd(), "app/routes/api.saved-items.tsx"), "utf8");
    expect(src).toContain("getCurrentNaiaCustomer(request)");
    expect(src).not.toContain('readString(form, "customerId")');
    expect(src).not.toContain('form.get("customerId")');
  });

  it("every SavedItem query is scoped by customerId", () => {
    const src = readFileSync(join(process.cwd(), "app/lib/saved-items.server.ts"), "utf8");
    // Each savedItem query in the service passes customerId in its where clause.
    const queries = src.match(/prisma\.savedItem\.\w+\(\{[\s\S]*?\}\)/g) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).toContain("customerId");
  });
});
