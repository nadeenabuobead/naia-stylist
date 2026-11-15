import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/customer-export-zip.server", () => ({
  buildCustomerExportZip: vi.fn(),
}));

vi.mock("~/lib/customer-export-zip-large.server", () => ({
  buildLargeCustomerExportZip: vi.fn(),
  buildExportJobDownloadUrl: vi.fn(),
}));

vi.mock("~/lib/api-rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api-rate-limit.server")>();
  return {
    // rateLimitResponse is the real, pure implementation — not under test here.
    rateLimitResponse: actual.rateLimitResponse,
    checkRateLimit: vi.fn(),
  };
});

vi.mock("~/lib/export-audit.server", () => ({
  recordExportAudit: vi.fn(),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { buildCustomerExportZip } from "~/lib/customer-export-zip.server";
import { buildLargeCustomerExportZip, buildExportJobDownloadUrl } from "~/lib/customer-export-zip-large.server";
import { checkRateLimit } from "~/lib/api-rate-limit.server";
import { recordExportAudit } from "~/lib/export-audit.server";
import { loader } from "./api.export-zip";

function allowedRateLimit() {
  return { allowed: true, overLimit: false, mode: "shadow" as const, count: 1, limit: 5, retryAfterSeconds: 0 };
}

describe("api/export-zip loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(allowedRateLimit());
  });

  it("never resolves a customer id from the request itself — only from the authenticated session", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({
      ok: true,
      stream: Readable.from([Buffer.from("fake-zip-bytes")]),
      filename: "naia-data-export-2026-11-14.zip",
    });

    // A malicious ?customerId=someone-else query param must be ignored.
    await loader({ request: new Request("http://localhost/api/export-zip?customerId=someone-else") } as any);

    expect(buildCustomerExportZip).toHaveBeenCalledWith("cust-1");
    expect(checkRateLimit).toHaveBeenCalledWith("cust-1", expect.objectContaining({ routeKey: "export-zip" }));
  });

  it("propagates the auth redirect when the customer is not signed in", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    vi.mocked(requireCurrentNaiaCustomer).mockRejectedValueOnce(redirect);

    await expect(loader({ request: new Request("http://localhost/api/export-zip") } as any)).rejects.toBe(redirect);
    expect(buildCustomerExportZip).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("streams a real zip response with attachment headers on success, and records a completed audit entry", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({
      ok: true,
      stream: Readable.from([Buffer.from("fake-zip-bytes")]),
      filename: "naia-data-export-2026-11-14.zip",
    });

    const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="naia-data-export-2026-11-14.zip"',
    );
    const body = await response.text();
    expect(body).toBe("fake-zip-bytes");
    expect(recordExportAudit).toHaveBeenCalledWith("cust-1", "requested");
    expect(recordExportAudit).toHaveBeenCalledWith("cust-1", "completed");
  });

  it("returns 404 when the customer has no exportable data", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({ ok: false, reason: "not_found" });

    const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);
    expect(response.status).toBe(404);
    expect(recordExportAudit).toHaveBeenCalledWith("cust-1", "failed", { reason: "not_found" });
  });

  describe("rate limiting", () => {
    it("returns 429 with Retry-After when the limit is exceeded, and never reaches the export builder", async () => {
      vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
      vi.mocked(checkRateLimit).mockResolvedValueOnce({
        allowed: false, overLimit: true, mode: "enforce", count: 6, limit: 5, retryAfterSeconds: 42,
      });

      const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("42");
      expect(buildCustomerExportZip).not.toHaveBeenCalled();
      expect(recordExportAudit).toHaveBeenCalledWith("cust-1", "failed", { reason: "rate_limited" });
    });

    it("shadow mode never blocks a real request even when overLimit is true", async () => {
      vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
      vi.mocked(checkRateLimit).mockResolvedValueOnce({
        allowed: true, overLimit: true, mode: "shadow", count: 6, limit: 5, retryAfterSeconds: 0,
      });
      vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({
        ok: true,
        stream: Readable.from([Buffer.from("x")]),
        filename: "f.zip",
      });

      const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);
      expect(response.status).toBe(200);
    });
  });

  describe("large export (>300 images) — secure completion mechanism", () => {
    it("builds the large export and 302-redirects to a fresh signed download link — never streams the oversized archive directly", async () => {
      vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
      vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({ ok: false, reason: "too_large", imageCount: 301 });
      vi.mocked(buildLargeCustomerExportZip).mockResolvedValueOnce({ ok: true, jobId: "job-1" });
      vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({
        ok: true,
        downloadUrl: "https://api.cloudinary.com/v1_1/test/raw/download?signed=1",
        expiresInSeconds: 600,
      });

      const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

      expect(buildLargeCustomerExportZip).toHaveBeenCalledWith("cust-1", 301);
      expect(buildExportJobDownloadUrl).toHaveBeenCalledWith("job-1", "cust-1");
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://api.cloudinary.com/v1_1/test/raw/download?signed=1");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(recordExportAudit).toHaveBeenCalledWith("cust-1", "completed", { large: true, imageCount: 301 });
    });

    it("never leaks the raw internal image count or error code to the customer-visible response body when the large build fails", async () => {
      vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
      vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({ ok: false, reason: "too_large", imageCount: 301 });
      vi.mocked(buildLargeCustomerExportZip).mockResolvedValueOnce({
        ok: false, reason: "upload_failed", jobId: "job-1", errorCode: "PROVIDER_ERROR",
      });

      const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/plain");
      const body = await response.text();
      expect(body).not.toContain("301");
      expect(body).not.toContain("PROVIDER_ERROR");
      expect(buildExportJobDownloadUrl).not.toHaveBeenCalled();
      expect(recordExportAudit).toHaveBeenCalledWith(
        "cust-1", "failed", { reason: "large_export_build_failed", imageCount: 301 },
      );
    });

    it("tells the customer their export is already being prepared, and never requests a download link for the OTHER in-flight job", async () => {
      vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
      vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({ ok: false, reason: "too_large", imageCount: 301 });
      vi.mocked(buildLargeCustomerExportZip).mockResolvedValueOnce({
        ok: false, reason: "already_processing", jobId: "job-already-running",
      });

      const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("already being prepared");
      expect(buildExportJobDownloadUrl).not.toHaveBeenCalled();
      expect(recordExportAudit).toHaveBeenCalledWith(
        "cust-1", "failed", { reason: "already_processing", imageCount: 301 },
      );
    });

    it("if the archive builds and uploads but the immediate signed link can't be generated, tells the customer to retry rather than losing the already-built export", async () => {
      vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
      vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({ ok: false, reason: "too_large", imageCount: 301 });
      vi.mocked(buildLargeCustomerExportZip).mockResolvedValueOnce({ ok: true, jobId: "job-1" });
      vi.mocked(buildExportJobDownloadUrl).mockResolvedValueOnce({ ok: false, reason: "not_ready" });

      const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("try again");
      expect(recordExportAudit).toHaveBeenCalledWith(
        "cust-1", "failed", { reason: "large_export_link_unavailable", imageCount: 301 },
      );
    });
  });
});
