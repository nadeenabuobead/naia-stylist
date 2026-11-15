// app/lib/export-audit.server.ts
//
// Privacy-safe audit trail for data-export requests. Deliberately NOT a new
// database table: the existing Legal/Privacy Request Handling SOP
// (03-PRIVACY-REQUEST-HANDLING-SOP-DRAFT.md §3/§6) already concludes a
// self-service, automatic export "may not need a log row at all since it's
// self-serve" — a durable per-event table would be more than what's
// actually called for. This instead matches the exact structured-logging
// convention already established one file over for the same class of
// concern (api-rate-limit.server.ts: a SHA-256 customerIdHash and an event
// label, nothing else, via console.log/console.error) — proportionate,
// consistent, and queryable through the same log aggregation this app
// already relies on for that module.
//
// Never logs: raw customerId, email, any export content, any image
// reference, any field from compileCustomerExport's output. Only a
// one-way hash and small integer counts.

import { hashCustomerId } from "./ai/journey-events.server";

export type ExportAuditAction = "requested" | "completed" | "too_large" | "failed";

export interface ExportAuditDetail {
  imageCount?: number;
  large?: boolean;
  reason?: string;
}

export function recordExportAudit(customerId: string, action: ExportAuditAction, detail: ExportAuditDetail = {}): void {
  const entry = {
    customerIdHash: hashCustomerId(customerId),
    action,
    ...detail,
  };
  if (action === "failed") {
    console.error("[export-audit]", entry);
  } else {
    console.log("[export-audit]", entry);
  }
}
