// app/routes/api.export-zip-download.$jobId.test.ts
//
// The re-access/retry route for an already-built large export. Covers
// customer isolation (a jobId scoped to another customer is indistinguishable
// from not-found) and the not_ready/expired/ok outcomes.
//
// Run: npx vitest run app/routes/api.export-zip-download.\$jobId.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/customer-export-zip-large.server", () => ({
  buildExportJobDownloadUrl: vi.fn(),
}));

vi.mock("~/lib/export-audit.server", () => ({
  recordExportAudit: vi.fn(),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { buildExportJobDownloadUrl } from "~/lib/customer-export-zip-large.server";
import { recordExportAudit } from "~/lib/export-audit.server";
import { loader } from "./api.export-zip-download.$jobId";

function args(jobId: string | undefined) {
  return {
    request: new Request(`http://localhost/api/export-zip-download/${jobId ?? ""}`),
    params: { jobId },
  } as any;
}

describe("api/export-zip-download/:jobId loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never resolves customerId from the URL — only the authenticated session is passed through", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({ ok: true, downloadUrl: "https://x", expiresInSeconds: 600 });

    await loader(args("job-1"));

    expect(buildExportJobDownloadUrl).toHaveBeenCalledWith("job-1", "cust-1");
  });

  it("302-redirects to the fresh signed URL on success", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({ ok: true, downloadUrl: "https://signed.example/zip", expiresInSeconds: 600 });

    const res = await loader(args("job-1"));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://signed.example/zip");
    expect(recordExportAudit).toHaveBeenCalledWith("cust-1", "completed", { reason: "large_export_redownload" });
  });

  it("a job scoped to a different customer is indistinguishable from not-found — 404, not 403", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-2" } as any);
    vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({ ok: false, reason: "not_found" });

    const res = await loader(args("job-belonging-to-cust-1"));

    expect(res.status).toBe(404);
    expect(recordExportAudit).toHaveBeenCalledWith("cust-2", "failed", { reason: "large_export_redownload_not_found" });
  });

  it("returns 410 Gone for an expired export, telling the customer to request a new one", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({ ok: false, reason: "expired" });

    const res = await loader(args("job-1"));

    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain("expired");
  });

  it("returns 409 for a job that isn't ready yet", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({ ok: false, reason: "not_ready" });

    const res = await loader(args("job-1"));
    expect(res.status).toBe(409);
  });

  it("returns 404 when no jobId param is present at all", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    const res = await loader(args(undefined));
    expect(res.status).toBe(404);
    expect(buildExportJobDownloadUrl).not.toHaveBeenCalled();
  });

  it("propagates the auth redirect when the customer is not signed in", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    vi.mocked(requireCurrentNaiaCustomer).mockRejectedValueOnce(redirect);

    await expect(loader(args("job-1"))).rejects.toBe(redirect);
    expect(buildExportJobDownloadUrl).not.toHaveBeenCalled();
  });
});
