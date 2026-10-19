// app/lib/admin-audit-log.server.ts
//
// Priority 5 (2026-10-19) — auditability for internal admin maintenance
// actions. performedBy must always come from the authenticated admin
// session's identity.email (internal-auth.server.ts), never from request
// input — callers are responsible for passing the session-derived value.

import prisma from "../db.server";

export async function recordAdminAction(
  performedBy: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await prisma.adminAuditLog.create({
    data: { performedBy, action, detail: detail ?? undefined },
  });
}

export interface AdminAuditEntry {
  id: string;
  performedBy: string;
  action: string;
  detail: unknown;
  createdAt: Date;
}

export async function listRecentAdminActions(limit: number = 20): Promise<AdminAuditEntry[]> {
  return prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
