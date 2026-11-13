// app/lib/billing/admin-revocation-override.server.ts
//
// Founder Decision 16's last rule: "Admin overrides require authorization,
// reason, transaction/customer references, timestamp and audit record."
// This is the one place that rule is enforced in code — every manual
// change to AccessRevocation state (restoring access the automatic
// refund/dispute logic revoked, or manually revoking access outside that
// automatic logic) goes through here.
//
// Correctness review (2026-11-13): the AdminAuditLog write and the
// AccessRevocation mutation now run inside ONE transaction — previously
// they were two separate statements with the audit write first, so a
// failure in the mutation left a permanent audit record claiming a
// completed override that never actually happened. Both commit together
// or neither does. Membership-status sync remains a separate, best-effort
// follow-up step — the SAME convention webhook-handler.server.ts's own
// syncMembershipStatusAfterRevocationChange already uses for the automatic
// paths, not a new inconsistency introduced here.
//
// performedBy must come from the authenticated admin session's identity
// (same rule as admin-audit-log.server.ts's own recordAdminAction) —
// never from request input. Callers are responsible for passing the
// session-derived value.

import type { AccessRevocationReason, MembershipStatus, SubscriptionStatus } from "@prisma/client";
import prisma from "~/db.server";

type OverrideTx = Pick<typeof prisma, "adminAuditLog" | "accessRevocation">;

export type RunOverrideTransactionFn = <T>(fn: (tx: OverrideTx) => Promise<T>) => Promise<T>;

const _runOverrideTransaction: RunOverrideTransactionFn = (fn) => prisma.$transaction((tx: OverrideTx) => fn(tx));

export interface AdminRevocationOverrideDeps {
  runOverrideTransaction?: RunOverrideTransactionFn;
  findSubscriptionById?: (id: string) => Promise<{ id: string; status: SubscriptionStatus } | null>;
  updateCustomerMembershipStatus?: (customerId: string, status: MembershipStatus) => Promise<void>;
}

async function defaultFindSubscriptionById(id: string) {
  return prisma.subscription.findUnique({ where: { id }, select: { id: true, status: true } });
}

async function defaultUpdateCustomerMembershipStatus(customerId: string, status: MembershipStatus): Promise<void> {
  await prisma.customer.update({ where: { id: customerId }, data: { membershipStatus: status } });
}

export interface AdminOverrideInput {
  subscriptionId: string;
  customerId: string;
  performedBy: string;
  // Human-entered justification — required. A blank reason defeats the
  // whole point of an audited override, so this refuses rather than
  // recording an unexplained one.
  reason: string;
}

export type AdminOverrideResult = { ok: true; overrideAuditLogId: string; resolvedCount: number } | { ok: false; reason: string };

// Restores access by resolving EVERY currently-active AccessRevocation row
// on this subscription — e.g. a lost dispute the admin has decided, on
// review, not to enforce (Founder Decision 16: "subject to the approved
// review/override rules"). Resolves ALL active rows at once, not one
// reason at a time: an admin-authorized restore is a decision about the
// customer's access, not about re-litigating one specific automatic
// trigger while leaving a second, independent one silently in place.
export async function applyAdminRestoreOverride(
  input: AdminOverrideInput,
  deps: AdminRevocationOverrideDeps = {},
): Promise<AdminOverrideResult> {
  if (!input.reason.trim()) return { ok: false, reason: "override_reason_required" };

  const _runTransaction = deps.runOverrideTransaction ?? _runOverrideTransaction;
  const _findSubscriptionById = deps.findSubscriptionById ?? defaultFindSubscriptionById;
  const _updateCustomerMembershipStatus = deps.updateCustomerMembershipStatus ?? defaultUpdateCustomerMembershipStatus;

  const { overrideAuditLogId, resolvedCount } = await _runTransaction(async (tx) => {
    const auditLog = await tx.adminAuditLog.create({
      data: {
        performedBy: input.performedBy,
        action: "access_revocation_override_restore",
        detail: { subscriptionId: input.subscriptionId, customerId: input.customerId, reason: input.reason },
      },
      select: { id: true },
    });
    const result = await tx.accessRevocation.updateMany({
      where: { subscriptionId: input.subscriptionId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedReason: `admin_override: ${input.reason}`, overrideAuditLogId: auditLog.id },
    });
    return { overrideAuditLogId: auditLog.id, resolvedCount: result.count };
  });

  const sub = await _findSubscriptionById(input.subscriptionId);
  if (sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) {
    await _updateCustomerMembershipStatus(input.customerId, "MEMBER");
  }

  return { ok: true, overrideAuditLogId, resolvedCount };
}

// Manually revokes access outside the automatic refund/dispute logic.
// Always creates a NEW, independent AccessRevocation row rather than
// reusing or mutating an existing automatic one, so an unrelated automatic
// resolution later (e.g. a separate dispute being won) can never silently
// undo this admin decision — the same independent-reason invariant the
// automatic REFUND/DISPUTE_LOST paths already rely on.
export async function applyAdminRevokeOverride(
  input: AdminOverrideInput & { reasonCode: AccessRevocationReason },
  deps: AdminRevocationOverrideDeps = {},
): Promise<AdminOverrideResult> {
  if (!input.reason.trim()) return { ok: false, reason: "override_reason_required" };

  const _runTransaction = deps.runOverrideTransaction ?? _runOverrideTransaction;
  const _updateCustomerMembershipStatus = deps.updateCustomerMembershipStatus ?? defaultUpdateCustomerMembershipStatus;

  const overrideAuditLogId = await _runTransaction(async (tx) => {
    const auditLog = await tx.adminAuditLog.create({
      data: {
        performedBy: input.performedBy,
        action: "access_revocation_override_revoke",
        detail: { subscriptionId: input.subscriptionId, customerId: input.customerId, reason: input.reason, reasonCode: input.reasonCode },
      },
      select: { id: true },
    });
    await tx.accessRevocation.create({
      data: { subscriptionId: input.subscriptionId, reason: input.reasonCode, overrideAuditLogId: auditLog.id },
    });
    return auditLog.id;
  });

  await _updateCustomerMembershipStatus(input.customerId, "NONE");

  return { ok: true, overrideAuditLogId, resolvedCount: 0 };
}

// ── Admin-route read support ────────────────────────────────────────────────
// What an admin needs to see BEFORE deciding to override anything — every
// subscription currently under an active revocation, with enough context
// (reason, source) to judge whether an override is warranted.

export interface ActiveRevocationSummary {
  id: string;
  subscriptionId: string;
  customerId: string;
  reason: AccessRevocationReason;
  createdAt: Date;
  sourceTransactionId: string | null;
  sourceDisputeId: string | null;
}

export async function listActiveAccessRevocations(limit: number = 50): Promise<ActiveRevocationSummary[]> {
  const rows = await prisma.accessRevocation.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { subscription: { select: { customerId: true } } },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    subscriptionId: r.subscriptionId,
    customerId: r.subscription.customerId,
    reason: r.reason,
    createdAt: r.createdAt,
    sourceTransactionId: r.sourceTransactionId,
    sourceDisputeId: r.sourceDisputeId,
  }));
}
