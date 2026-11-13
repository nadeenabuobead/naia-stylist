// app/lib/billing/admin-revocation-override.server.ts
//
// Founder Decision 16's last rule: "Admin overrides require authorization,
// reason, transaction/customer references, timestamp and audit record."
// This is the one place that rule is enforced in code — every manual
// change to AccessRevocation state (restoring access the automatic
// refund/dispute logic revoked, or manually revoking access outside that
// automatic logic) goes through here, which always writes the
// AdminAuditLog row FIRST and links its id onto the AccessRevocation
// row(s) it touches via overrideAuditLogId, never mutating
// AccessRevocation without that link.
//
// performedBy must come from the authenticated admin session's identity
// (same rule as admin-audit-log.server.ts's own recordAdminAction) —
// never from request input. Callers are responsible for passing the
// session-derived value.

import type { MembershipStatus, SubscriptionStatus } from "@prisma/client";
import prisma from "~/db.server";
import { recordAdminAction as defaultRecordAdminAction } from "../admin-audit-log.server";

export interface AdminRevocationOverrideDeps {
  recordAdminAction?: (performedBy: string, action: string, detail?: Record<string, unknown>) => Promise<{ id: string }>;
  resolveActiveRevocationsForSubscription?: (
    subscriptionId: string,
    resolvedReason: string,
    overrideAuditLogId: string,
  ) => Promise<number>;
  createAccessRevocation?: (input: {
    subscriptionId: string;
    reason: "REFUND" | "DISPUTE_LOST";
    overrideAuditLogId: string;
  }) => Promise<void>;
  findSubscriptionById?: (id: string) => Promise<{ id: string; status: SubscriptionStatus } | null>;
  updateCustomerMembershipStatus?: (customerId: string, status: MembershipStatus) => Promise<void>;
}

async function defaultResolveActiveRevocationsForSubscription(
  subscriptionId: string,
  resolvedReason: string,
  overrideAuditLogId: string,
): Promise<number> {
  const result = await prisma.accessRevocation.updateMany({
    where: { subscriptionId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedReason, overrideAuditLogId },
  });
  return result.count;
}

async function defaultCreateAccessRevocation(input: {
  subscriptionId: string;
  reason: "REFUND" | "DISPUTE_LOST";
  overrideAuditLogId: string;
}): Promise<void> {
  await prisma.accessRevocation.create({
    data: {
      subscriptionId: input.subscriptionId,
      reason: input.reason,
      overrideAuditLogId: input.overrideAuditLogId,
    },
  });
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

  const _recordAdminAction = deps.recordAdminAction ?? defaultRecordAdminAction;
  const _resolve = deps.resolveActiveRevocationsForSubscription ?? defaultResolveActiveRevocationsForSubscription;
  const _findSubscriptionById = deps.findSubscriptionById ?? defaultFindSubscriptionById;
  const _updateCustomerMembershipStatus = deps.updateCustomerMembershipStatus ?? defaultUpdateCustomerMembershipStatus;

  const auditLog = await _recordAdminAction(input.performedBy, "access_revocation_override_restore", {
    subscriptionId: input.subscriptionId,
    customerId: input.customerId,
    reason: input.reason,
  });

  const resolvedCount = await _resolve(input.subscriptionId, `admin_override: ${input.reason}`, auditLog.id);

  const sub = await _findSubscriptionById(input.subscriptionId);
  if (sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) {
    await _updateCustomerMembershipStatus(input.customerId, "MEMBER");
  }

  return { ok: true, overrideAuditLogId: auditLog.id, resolvedCount };
}

// Manually revokes access outside the automatic refund/dispute logic.
// Always creates a NEW, independent AccessRevocation row rather than
// reusing or mutating an existing automatic one, so an unrelated automatic
// resolution later (e.g. a separate dispute being won) can never silently
// undo this admin decision — the same independent-reason invariant the
// automatic REFUND/DISPUTE_LOST paths already rely on.
export async function applyAdminRevokeOverride(
  input: AdminOverrideInput & { reasonCode: "REFUND" | "DISPUTE_LOST" },
  deps: AdminRevocationOverrideDeps = {},
): Promise<AdminOverrideResult> {
  if (!input.reason.trim()) return { ok: false, reason: "override_reason_required" };

  const _recordAdminAction = deps.recordAdminAction ?? defaultRecordAdminAction;
  const _createAccessRevocation = deps.createAccessRevocation ?? defaultCreateAccessRevocation;
  const _updateCustomerMembershipStatus = deps.updateCustomerMembershipStatus ?? defaultUpdateCustomerMembershipStatus;

  const auditLog = await _recordAdminAction(input.performedBy, "access_revocation_override_revoke", {
    subscriptionId: input.subscriptionId,
    customerId: input.customerId,
    reason: input.reason,
    reasonCode: input.reasonCode,
  });

  await _createAccessRevocation({
    subscriptionId: input.subscriptionId,
    reason: input.reasonCode,
    overrideAuditLogId: auditLog.id,
  });
  await _updateCustomerMembershipStatus(input.customerId, "NONE");

  return { ok: true, overrideAuditLogId: auditLog.id, resolvedCount: 0 };
}
