import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/customer-export-zip.server", () => ({
  buildCustomerExportZip: vi.fn(),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { buildCustomerExportZip } from "~/lib/customer-export-zip.server";
import { loader } from "./api.export-zip";

describe("api/export-zip loader", () => {
  beforeEach(() => vi.clearAllMocks());

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
  });

  it("propagates the auth redirect when the customer is not signed in", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    vi.mocked(requireCurrentNaiaCustomer).mockRejectedValueOnce(redirect);

    await expect(loader({ request: new Request("http://localhost/api/export-zip") } as any)).rejects.toBe(redirect);
    expect(buildCustomerExportZip).not.toHaveBeenCalled();
  });

  it("streams a real zip response with attachment headers on success", async () => {
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
  });

  it("returns a friendly 200 text message, not a broken download, when the export is too large", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({
      ok: false,
      reason: "too_large",
      imageCount: 301,
    });

    const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("contact support");
    expect(body).not.toContain("301"); // never leaks the raw internal count to the customer
  });

  it("returns 404 when the customer has no exportable data", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "cust-1" } as any);
    vi.mocked(buildCustomerExportZip).mockResolvedValueOnce({ ok: false, reason: "not_found" });

    const response = await loader({ request: new Request("http://localhost/api/export-zip") } as any);
    expect(response.status).toBe(404);
  });
});
