// app/routes/api.staging-full-look-vto.access-gate.test.ts
//
// 2026-11-21 — access control for the retained staging prototype
// (POST /api/staging-full-look-vto). It makes a real, billable FASHN call with
// no VirtualTryOnJob row, no entitlement check and no cooldown, so it must be
// reachable only by allowlisted staging QA accounts, and by nobody in any
// environment that is not the staging project. Fully mocked: no FASHN, no DB.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/lib/ai/my-naia-model.server", () => ({ loadNaiaModel: vi.fn(), computeModelReadinessFromRecord: vi.fn() }));
vi.mock("~/lib/ai/fashn-tryon-service.server", () => ({ downloadModelPhotoAsDataUrl: vi.fn() }));
vi.mock("~/db.server", () => ({ default: { outfitSuggestion: { findUnique: vi.fn() } } }));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel } from "~/lib/ai/my-naia-model.server";
import { downloadModelPhotoAsDataUrl } from "~/lib/ai/fashn-tryon-service.server";
import prisma from "~/db.server";
import { action } from "./api.staging-full-look-vto";

const req = () =>
  new Request("http://localhost/api/staging-full-look-vto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestionId: "s1", virtualTryOnConsentAt: new Date().toISOString() }),
  });
const call = () => action({ request: req(), params: {}, context: {} } as any) as Promise<any>;

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  delete process.env.NAIA_PROJECT_VARIANT;
  delete process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS;
  (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust-1", shopifyCustomerId: "shop-1" });
  (loadNaiaModel as any).mockResolvedValue(null); // allowlisted callers stop here with model_not_configured (no FASHN)
});
afterEach(() => vi.unstubAllGlobals());

function expectNothingPaidOrLoaded() {
  expect(loadNaiaModel).not.toHaveBeenCalled();
  expect(downloadModelPhotoAsDataUrl).not.toHaveBeenCalled();
  expect((prisma.outfitSuggestion.findUnique as any)).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe("POST /api/staging-full-look-vto — access control", () => {
  it("is refused (403 staging_only) in any environment that is not the staging project, even for an allowlisted id, before auth or anything else", async () => {
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "cust-1";
    const res = await call();
    expect(res.init.status).toBe(403);
    expect(res.data.code).toBe("staging_only");
    expect(getCurrentNaiaCustomer).not.toHaveBeenCalled();
    expectNothingPaidOrLoaded();
  });

  it("on staging, an unauthenticated caller gets 401 and nothing runs", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    (getCurrentNaiaCustomer as any).mockResolvedValue(null);
    expect((await call()).init.status).toBe(401);
    expectNothingPaidOrLoaded();
  });

  it("on staging, an ordinary signed-in customer who is NOT allowlisted gets 404 and nothing paid or loaded (the exposure this closes)", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "someone-else";
    const res = await call();
    expect(res.init.status).toBe(404);
    expectNothingPaidOrLoaded();
  });

  it("on staging with an EMPTY or unset allowlist, nobody gets through", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    expect((await call()).init.status).toBe(404);
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = " , ";
    expect((await call()).init.status).toBe(404);
    expectNothingPaidOrLoaded();
  });

  it("a variant value that merely resembles staging is refused", async () => {
    process.env.NAIA_PROJECT_VARIANT = "Staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "cust-1";
    expect((await call()).init.status).toBe(403);
    expectNothingPaidOrLoaded();
  });

  it("an allowlisted staging account (by customer id OR shopifyCustomerId) passes the gate and proceeds to the next validation (model_not_configured) — no FASHN call", async () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "cust-1";
    let res = await call();
    expect(res.init.status).toBe(400);
    expect(res.data.code).toBe("model_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "shop-1";
    res = await call();
    expect(res.data.code).toBe("model_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
