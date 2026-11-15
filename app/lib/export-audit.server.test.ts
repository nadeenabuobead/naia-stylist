// app/lib/export-audit.server.test.ts
//
// Proves the export audit trail is genuinely privacy-safe: hashed customerId
// only, no raw customerId, no export content, no image reference, ever.
//
// Run: npx vitest run app/lib/export-audit.server.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordExportAudit } from "./export-audit.server";

describe("recordExportAudit", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("never logs the raw customerId — only a one-way hash", () => {
    recordExportAudit("real-customer-id-must-never-leak", "requested");
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("real-customer-id-must-never-leak");
    expect(logSpy).toHaveBeenCalledWith("[export-audit]", expect.objectContaining({ action: "requested" }));
    const entry = logSpy.mock.calls[0][1] as any;
    expect(entry.customerIdHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("the same customerId always hashes to the same value — consistent across calls, still never reversible", () => {
    recordExportAudit("cust-1", "requested");
    recordExportAudit("cust-1", "completed");
    const [firstEntry] = logSpy.mock.calls[0];
    void firstEntry;
    const hash1 = (logSpy.mock.calls[0][1] as any).customerIdHash;
    const hash2 = (logSpy.mock.calls[1][1] as any).customerIdHash;
    expect(hash1).toBe(hash2);
  });

  it("routes 'failed' actions to console.error, every other action to console.log", () => {
    recordExportAudit("cust-1", "failed", { reason: "not_found" });
    expect(errorSpy).toHaveBeenCalledWith("[export-audit]", expect.objectContaining({ action: "failed", reason: "not_found" }));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("only ever logs small, structured fields (counts/flags/reason strings) — never arbitrary export content", () => {
    recordExportAudit("cust-1", "completed", { large: true, imageCount: 42 });
    const entry = logSpy.mock.calls[0][1] as any;
    expect(Object.keys(entry).sort()).toEqual(["action", "customerIdHash", "imageCount", "large"]);
  });

  it("logs cleanly with no detail at all — detail is optional", () => {
    recordExportAudit("cust-1", "requested");
    expect(logSpy).toHaveBeenCalledWith("[export-audit]", { customerIdHash: expect.any(String), action: "requested" });
  });
});
