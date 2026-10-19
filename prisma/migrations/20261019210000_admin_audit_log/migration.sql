-- Priority 5 (2026-10-19) — auditability for internal admin maintenance
-- actions. performedBy is the admin's session email, never client input.

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
