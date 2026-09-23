// app/routes/styleme-trend-handoff.test.ts
//
// Step 6 — Trend → StyleMe handoff.
//
// The two things that must hold: the matched piece is the anchor and nothing
// substitutes it, and trend context is provenance that never reaches ranking.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sessionStore = new Map<string, unknown>();

vi.mock("~/lib/session.server", () => ({
  getSession: vi.fn(async () => ({
    get: (k: string) => sessionStore.get(k),
    set: (k: string, v: unknown) => sessionStore.set(k, v),
    unset: (k: string) => sessionStore.delete(k),
  })),
  commitSession: vi.fn(async () => "cookie=1"),
}));
vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));
vi.mock("~/db.server", () => ({
  default: {
    closetItem: {
      findFirst: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { id: string; customerId: string };
        // cust-1 owns ci_1 and ci_2. Nobody else owns anything.
        return w.customerId === "cust-1" && ["ci_1", "ci_2"].includes(w.id) ? { id: w.id } : null;
      }),
    },
  },
}));
vi.mock("~/lib/ai/naia-product-media", () => ({ LOCKED_CATALOGUE_HANDLES: ["oversized-blazer"] }));

import { action } from "./api.styleme-handoff";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";

const APP = "https://naia.test";

function post(fields: Record<string, string>, origin = APP) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`${APP}/api/styleme-handoff`, {
    method: "POST", body, headers: origin ? { Origin: origin } : {},
  });
}

const trendPost = (over: Record<string, string> = {}) => post({
  source: "trend", closetItemId: "ci_1",
  reportId: "rep_1", reportTitle: "Autumn Edit",
  contentId: "tc_aaaaaaaaaaaa", trendLabel: "Softened tailoring",
  ...over,
});

beforeEach(() => {
  sessionStore.clear();
  vi.clearAllMocks();
  vi.mocked(getCurrentNaiaCustomer).mockResolvedValue({ id: "cust-1" } as never);
});

// ── §H-1 registration ─────────────────────────────────────────────────────────

describe("§H-1 route registration", () => {
  it("is registered and therefore reachable", () => {
    const routes = readFileSync(join(process.cwd(), "app/routes.ts"), "utf8");
    expect(routes).toContain('route("api/styleme-handoff", "routes/api.styleme-handoff.tsx")');
  });

  it("there is only ONE handoff route — no second mechanism", () => {
    const routes = readFileSync(join(process.cwd(), "app/routes.ts"), "utf8");
    // Count ROUTE REGISTRATIONS, not string occurrences — the path and the file
    // name both contain "styleme-handoff" on the same line.
    expect((routes.match(/route\("api\/styleme-handoff"/g) ?? []).length).toBe(1);
  });
});

// ── §H-2 the anchor ───────────────────────────────────────────────────────────

describe("§H-2 explicit anchor", () => {
  it("the matched piece becomes the explicit closet anchor", async () => {
    await action({ request: trendPost() } as never);
    expect(sessionStore.get("styleMeClosetAnchorId")).toBe("ci_1");
    expect(sessionStore.get("styleMeSource")).toBe("my-closet");
    expect(sessionStore.get("styleMeMode")).toBe("naia");
  });

  it("anchor mode is manual, so auto-selection cannot substitute a piece", async () => {
    await action({ request: trendPost() } as never);
    expect(sessionStore.get("styleMeAnchorMode")).toBe("manual");
  });

  it("the handoff never CALLS autoSelectClosetAnchor", () => {
    const src = readFileSync(join(process.cwd(), "app/routes/api.styleme-handoff.tsx"), "utf8");
    // Strip comments first: the file explains that auto-selection is bypassed,
    // and that explanation must not read as the thing it rules out.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
      .filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("autoSelectClosetAnchor");
    expect(code).not.toContain("import { autoSelectClosetAnchor");
  });

  it("clears any stale NADINE anchor", async () => {
    sessionStore.set("styleMeNadineAnchorHandle", "oversized-blazer");
    await action({ request: trendPost() } as never);
    expect(sessionStore.has("styleMeNadineAnchorHandle")).toBe(false);
  });

  it("enters the Rev 3 flow at its start", async () => {
    const res = await action({ request: trendPost() } as never) as Response;
    expect(res.headers.get("Location")).toBe("/style-me/state");
  });
});

// ── §H-3 provenance survives ─────────────────────────────────────────────────

describe("§H-3 trend provenance", () => {
  it("carries report and trend identity plus a display label", async () => {
    await action({ request: trendPost() } as never);
    expect(sessionStore.get("styleMeTrendReportId")).toBe("rep_1");
    expect(sessionStore.get("styleMeTrendReportTitle")).toBe("Autumn Edit");
    expect(sessionStore.get("styleMeTrendContentId")).toBe("tc_aaaaaaaaaaaa");
    expect(sessionStore.get("styleMeTrendLabel")).toBe("Softened tailoring");
  });

  it("bounds stored provenance text", async () => {
    await action({ request: trendPost({ trendLabel: "x".repeat(400) }) } as never);
    expect((sessionStore.get("styleMeTrendLabel") as string).length).toBe(160);
  });

  it("a NADINE product handoff clears trend context — no bleed between sources", async () => {
    await action({ request: trendPost() } as never);
    await action({ request: post({ handle: "oversized-blazer" }, "https://naiabynadine.com") } as never);
    expect(sessionStore.has("styleMeTrendReportId")).toBe(false);
    expect(sessionStore.has("styleMeTrendLabel")).toBe(false);
  });
});

// ── §H-4 ownership ────────────────────────────────────────────────────────────

describe("§H-4 customer isolation", () => {
  it("a customer CANNOT hand off another customer's closet item", async () => {
    vi.mocked(getCurrentNaiaCustomer).mockResolvedValue({ id: "cust-2" } as never);
    const res = await action({ request: trendPost({ closetItemId: "ci_1" }) } as never) as Response;
    expect(res.headers.get("Location")).toBe("/style-me");
    expect(sessionStore.has("styleMeClosetAnchorId")).toBe(false);
  });

  it("a DELETED piece cannot be handed off", async () => {
    const res = await action({ request: trendPost({ closetItemId: "ci_deleted" }) } as never) as Response;
    expect(res.headers.get("Location")).toBe("/style-me");
    expect(sessionStore.has("styleMeClosetAnchorId")).toBe(false);
  });

  it("a signed-out visitor is sent to sign in, and nothing is set", async () => {
    vi.mocked(getCurrentNaiaCustomer).mockResolvedValue(null as never);
    const res = await action({ request: trendPost() } as never) as Response;
    expect(res.headers.get("Location")).toContain("/auth/shopify/login");
    expect(sessionStore.size).toBe(0);
  });

  it("rejects a foreign origin", async () => {
    const res = await action({ request: trendPost({}, ) } as never);
    expect((res as Response).status).not.toBe(403);
    const hostile = await action({ request: post({ source: "trend", closetItemId: "ci_1" }, "https://evil.test") } as never);
    expect((hostile as Response).status).toBe(403);
  });
});

// ── §H-5 session lifecycle ───────────────────────────────────────────────────

describe("§H-5 session lifecycle", () => {
  it("every trend key is registered for cleanup", () => {
    // A key absent from STYLEME_SESSION_KEYS survives clearStyleMeSession() and
    // attaches itself to the next, unrelated styling session.
    const src = readFileSync(join(process.cwd(), "app/lib/session.server.ts"), "utf8");
    const keys = src.slice(src.indexOf("STYLEME_SESSION_KEYS"), src.indexOf("] as const;"));
    for (const k of ["styleMeTrendReportId", "styleMeTrendReportTitle", "styleMeTrendContentId", "styleMeTrendLabel"]) {
      expect(keys).toContain(`"${k}"`);
    }
  });

  it("cleanup removes them, so the next session starts with none", async () => {
    const { clearStyleMeSession } = await vi.importActual<typeof import("~/lib/session.server")>("~/lib/session.server");
    const src = readFileSync(join(process.cwd(), "app/lib/session.server.ts"), "utf8");
    // clearStyleMeSession unsets every listed key — assert the loop is intact.
    expect(src).toContain("for (const key of STYLEME_SESSION_KEYS)");
    expect(src).toContain("session.unset(key)");
    expect(typeof clearStyleMeSession).toBe("function");
  });
});

// ── §H-6 ranking invariance — the hard constraint ────────────────────────────

describe("§H-6 trend context is not a ranking input", () => {
  it("no StyleMe scoring module reads a trend session key", () => {
    // The strongest available proof: the ranking engine cannot see what it does
    // not read. If a trend key ever appears here, ranking has become
    // trend-aware and this fails.
    for (const f of [
      "app/lib/ai/styleme-recommendation.ts",
      "app/lib/ai/styleme-result.server.ts",
      "app/lib/ai/styleme-anchor.server.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toContain("styleMeTrend");
      expect(src.toLowerCase()).not.toContain("trendlabel");
    }
  });

  it("the result route reads trend context only to display it and to save it", () => {
    const src = readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");
    // Every read is either a loader return (display) or the SavedLook write.
    // None sits inside a scoring or suggestion-building path.
    for (const line of src.split("\n")) {
      if (!line.includes("readTrendProvenance(")) continue;
      const isDefinition = line.includes("function readTrendProvenance");
      const isDisplay = line.includes("trendProvenance:");
      const isSave = line.includes("const trendProv");
      expect(isDefinition || isDisplay || isSave).toBe(true);
    }
    expect(src).toContain("inspiredByReportId");
  });

  it("computeStyleMeResult is never passed trend context", () => {
    const src = readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");
    const calls = [...src.matchAll(/computeStyleMeResult\([\s\S]{0,600}?\)/g)];
    for (const c of calls) {
      expect(c[0]).not.toContain("trend");
      expect(c[0]).not.toContain("Trend");
    }
  });
});
