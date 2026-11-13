// app/lib/billing/admin-revocation-override.test.ts
// Founder Decision 16's admin-override rule: "Admin overrides require
// authorization, reason, transaction/customer references, timestamp and
// audit record." No real Prisma, no real network — every dependency is
// injected via AdminRevocationOverrideDeps, mirroring the WebhookHandlerDeps
// convention in webhook-handler.test.ts.
//
// Run: node --import tsx/esm --test app/lib/billing/admin-revocation-override.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAdminRestoreOverride,
  applyAdminRevokeOverride,
  type AdminRevocationOverrideDeps,
} from "./admin-revocation-override.server";

const BASE_INPUT = {
  subscriptionId: "sub-1",
  customerId: "cust-1",
  performedBy: "owner@naiabynadine.com",
  reason: "Goodwill restore after dispute review",
};

describe("applyAdminRestoreOverride", () => {
  it("AO.1 — writes the audit record, resolves every active revocation with it linked, and restores membership for an ACTIVE subscription", async () => {
    let auditCall: any = null;
    let resolveCall: any = null;
    let membershipCall: any = null;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async (performedBy, action, detail) => {
        auditCall = { performedBy, action, detail };
        return { id: "audit-123" };
      },
      resolveActiveRevocationsForSubscription: async (subscriptionId, resolvedReason, overrideAuditLogId) => {
        resolveCall = { subscriptionId, resolvedReason, overrideAuditLogId };
        return 2;
      },
      findSubscriptionById: async () => ({ id: "sub-1", status: "ACTIVE" as const }),
      updateCustomerMembershipStatus: async (customerId, status) => {
        membershipCall = { customerId, status };
      },
    };

    const result = await applyAdminRestoreOverride(BASE_INPUT, deps);

    assert.deepEqual(result, { ok: true, overrideAuditLogId: "audit-123", resolvedCount: 2 });
    assert.equal(auditCall.performedBy, "owner@naiabynadine.com");
    assert.equal(auditCall.action, "access_revocation_override_restore");
    assert.deepEqual(auditCall.detail, { subscriptionId: "sub-1", customerId: "cust-1", reason: BASE_INPUT.reason });
    assert.equal(resolveCall.subscriptionId, "sub-1");
    assert.match(resolveCall.resolvedReason, /admin_override/);
    assert.match(resolveCall.resolvedReason, new RegExp(BASE_INPUT.reason));
    assert.equal(resolveCall.overrideAuditLogId, "audit-123", "the resolve call must use the EXACT id the audit log write returned, not an independently generated one");
    assert.deepEqual(membershipCall, { customerId: "cust-1", status: "MEMBER" });
  });

  it("AO.2 — a CANCELED/EXPIRED subscription's revocations are still resolved (financial-record accuracy) but membership is never resurrected", async () => {
    let membershipCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async () => ({ id: "audit-456" }),
      resolveActiveRevocationsForSubscription: async () => 1,
      findSubscriptionById: async () => ({ id: "sub-1", status: "CANCELED" as const }),
      updateCustomerMembershipStatus: async () => { membershipCalls++; },
    };

    const result = await applyAdminRestoreOverride(BASE_INPUT, deps);

    assert.equal(result.ok, true);
    assert.equal(membershipCalls, 0, "a subscription that has independently CANCELED/EXPIRED must never be resurrected to MEMBER by this override");
  });

  it("AO.3 — a blank or whitespace-only reason refuses before writing anything — an unexplained override defeats the audit requirement", async () => {
    let auditCalls = 0;
    let resolveCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async () => { auditCalls++; return { id: "x" }; },
      resolveActiveRevocationsForSubscription: async () => { resolveCalls++; return 0; },
    };

    const result = await applyAdminRestoreOverride({ ...BASE_INPUT, reason: "   " }, deps);

    assert.deepEqual(result, { ok: false, reason: "override_reason_required" });
    assert.equal(auditCalls, 0);
    assert.equal(resolveCalls, 0);
  });

  it("AO.4 — no Subscription row found at all is a safe no-op for membership (still resolves the revocations and still audits)", async () => {
    let membershipCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async () => ({ id: "audit-789" }),
      resolveActiveRevocationsForSubscription: async () => 1,
      findSubscriptionById: async () => null,
      updateCustomerMembershipStatus: async () => { membershipCalls++; },
    };
    const result = await applyAdminRestoreOverride(BASE_INPUT, deps);
    assert.equal(result.ok, true);
    assert.equal(membershipCalls, 0);
  });
});

describe("applyAdminRevokeOverride", () => {
  it("AO.5 — audits FIRST, then creates an independent AccessRevocation row linked to that exact audit record, then denies access", async () => {
    const callOrder: string[] = [];
    let revocationInput: any = null;
    let membershipCall: any = null;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async (performedBy, action, detail) => {
        callOrder.push("audit");
        return { id: "audit-999" };
      },
      createAccessRevocation: async (input) => {
        callOrder.push("revoke");
        revocationInput = input;
      },
      updateCustomerMembershipStatus: async (customerId, status) => {
        callOrder.push("membership");
        membershipCall = { customerId, status };
      },
    };

    const result = await applyAdminRevokeOverride({ ...BASE_INPUT, reason: "Policy violation — manual revoke", reasonCode: "DISPUTE_LOST" }, deps);

    assert.deepEqual(result, { ok: true, overrideAuditLogId: "audit-999", resolvedCount: 0 });
    assert.deepEqual(callOrder, ["audit", "revoke", "membership"], "the audit record must exist before the AccessRevocation row is created");
    assert.deepEqual(revocationInput, { subscriptionId: "sub-1", reason: "DISPUTE_LOST", overrideAuditLogId: "audit-999" });
    assert.deepEqual(membershipCall, { customerId: "cust-1", status: "NONE" });
  });

  it("AO.6 — a blank reason refuses before writing anything", async () => {
    let auditCalls = 0;
    let revokeCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async () => { auditCalls++; return { id: "x" }; },
      createAccessRevocation: async () => { revokeCalls++; },
    };
    const result = await applyAdminRevokeOverride({ ...BASE_INPUT, reason: "", reasonCode: "REFUND" }, deps);
    assert.deepEqual(result, { ok: false, reason: "override_reason_required" });
    assert.equal(auditCalls, 0);
    assert.equal(revokeCalls, 0);
  });

  it("AO.7 — the audit detail records the subscription/customer references and the reasonCode — Founder Decision 16's 'transaction/customer references' requirement", async () => {
    let auditDetail: any = null;
    const deps: AdminRevocationOverrideDeps = {
      recordAdminAction: async (_performedBy, _action, detail) => { auditDetail = detail; return { id: "audit-1" }; },
      createAccessRevocation: async () => {},
      updateCustomerMembershipStatus: async () => {},
    };
    await applyAdminRevokeOverride({ ...BASE_INPUT, reasonCode: "REFUND" }, deps);
    assert.equal(auditDetail.subscriptionId, "sub-1");
    assert.equal(auditDetail.customerId, "cust-1");
    assert.equal(auditDetail.reasonCode, "REFUND");
    assert.equal(auditDetail.reason, BASE_INPUT.reason);
  });
});
