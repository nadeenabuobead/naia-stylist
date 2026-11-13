// app/routes/api.tryon-result.behavioral.test.ts
//
// Behavioral coverage for api.tryon-result.$jobId.tsx's fail-closed check —
// this is the Shopify app-proxy-facing result-delivery endpoint, separate
// from the session-cookie-facing api.tryon-status.$jobId.tsx poll route, and
// was missed in the first pass of the fail-closed fix (it also serves a
// signed URL for a COMPLETED job and needs the identical obligation check).
// No prior test file in this repo exercised this route at all.
//
// Run: npx vitest run app/routes/api.tryon-result.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/shopify.server", () => ({
  authenticate: { public: { appProxy: vi.fn().mockResolvedValue({}) } },
}));

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    virtualTryOnJob: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/ai/fashn-tryon-service.server", () => ({
  buildTryOnResultUrl: vi.fn(),
  checkResultOwnership: vi.fn((a: string, b: string) => a === b),
  customerHasOutstandingVtoSweepObligation: vi.fn(),
}));

import prisma from "~/db.server";
import {
  buildTryOnResultUrl,
  customerHasOutstandingVtoSweepObligation,
} from "~/lib/ai/fashn-tryon-service.server";
import { loader } from "./api.tryon-result.$jobId";

const CUSTOMER_ID = "cust_001";
const SHOPIFY_ID = "shop_cust_001";
const JOB_ID = "job_001";

beforeEach(() => {
  vi.clearAllMocks();
  (customerHasOutstandingVtoSweepObligation as any).mockResolvedValue(false);
  (buildTryOnResultUrl as any).mockReturnValue("https://example.invalid/signed-result");
  (prisma.customer.findUnique as any).mockResolvedValue({ id: CUSTOMER_ID });
});

function args() {
  const url = `http://localhost/api/tryon-result/${JOB_ID}?logged_in_customer_id=${SHOPIFY_ID}`;
  return { request: new Request(url), params: { jobId: JOB_ID }, context: {} } as any;
}

describe("api.tryon-result.$jobId — fails closed while a cleanup obligation is outstanding", () => {
  it("returns 404, never a signed URL, when an obligation is outstanding for this customer", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue({
      id: JOB_ID,
      customerId: CUSTOMER_ID,
      status: "COMPLETED",
    });
    (customerHasOutstandingVtoSweepObligation as any).mockResolvedValue(true);

    const res: Response = await loader(args());

    expect(customerHasOutstandingVtoSweepObligation).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(buildTryOnResultUrl).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });

  it("serves the signed URL normally once no obligation is outstanding — unaffected baseline", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue({
      id: JOB_ID,
      customerId: CUSTOMER_ID,
      status: "COMPLETED",
    });

    const res: Response = await loader(args());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resultUrl).toBe("https://example.invalid/signed-result");
  });

  it("checks the obligation only AFTER ownership is verified — never leaks timing/existence to another customer", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue({
      id: JOB_ID,
      customerId: "someone-else",
      status: "COMPLETED",
    });

    const res: Response = await loader(args());

    expect(res.status).toBe(403);
    expect(customerHasOutstandingVtoSweepObligation).not.toHaveBeenCalled();
  });
});
