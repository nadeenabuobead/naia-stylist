// app/lib/billing/admin-revocation-override.test.ts
// Founder Decision 16's admin-override rule: "Admin overrides require
// authorization, reason, transaction/customer references, timestamp and
// audit record." No real Prisma, no real network — every dependency is
// injected via AdminRevocationOverrideDeps, mirroring the WebhookHandlerDeps
// convention in webhook-handler.test.ts.
//
// Correctness review (2026-11-13): the AdminAuditLog write and the
// AccessRevocation mutation now run inside ONE injected transaction
// (runOverrideTransaction) — these tests inject a fake tx whose methods
// are directly inspectable, mirroring how RSV.1-6 in
// entitlement-reservation.test.ts inject a fake transaction client.
//
// Run: node --import tsx/esm --test app/lib/billing/admin-revocation-override.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAdminRestoreOverride,
  applyAdminRevokeOverride,
  type AdminRevocationOverrideDeps,
  type RunOverrideTransactionFn,
} from "./admin-revocation-override.server";

const BASE_INPUT = {
  subscriptionId: "sub-1",
  customerId: "cust-1",
  performedBy: "owner@naiabynadine.com",
  reason: "Goodwill restore after dispute review",
};

// A fake tx whose adminAuditLog.create/accessRevocation.updateMany|create
// calls are directly inspectable — this is what proves BOTH writes are
// scoped to the SAME transaction callback (real atomicity — commit or
// rollback together — is Prisma/Postgres's own guarantee for a thrown
// callback, which a unit test without a live DB cannot independently
// observe; what these tests DO prove is that the wiring places both
// writes where that guarantee applies).
function fakeTx(overrides: {
  createAuditLog?: (args: any) => Promise<{ id: string }>;
  updateManyRevocations?: (args: any) => Promise<{ count: number }>;
  createRevocation?: (args: any) => Promise<void>;
} = {}) {
  return {
    adminAuditLog: {
      create: overrides.createAuditLog ?? (async () => ({ id: "audit-1" })),
    },
    accessRevocation: {
      updateMany: overrides.updateManyRevocations ?? (async () => ({ count: 0 })),
      create: overrides.createRevocation ?? (async () => {}),
    },
  } as any;
}

describe("applyAdminRestoreOverride", () => {
  it("AO.1 — writes the audit record and resolves every active revocation inside ONE transaction, linked, and restores membership for an ACTIVE subscription", async () => {
    let auditCreateArgs: any = null;
    let updateManyArgs: any = null;
    let txCalls = 0;
    const tx = fakeTx({
      createAuditLog: async (args) => { auditCreateArgs = args; return { id: "audit-123" }; },
      updateManyRevocations: async (args) => { updateManyArgs = args; return { count: 2 }; },
    });
    const runOverrideTransaction: RunOverrideTransactionFn = async (fn) => { txCalls++; return fn(tx); };
    let membershipCall: any = null;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction,
      findSubscriptionById: async () => ({ id: "sub-1", status: "ACTIVE" as const }),
      updateCustomerMembershipStatus: async (customerId, status) => { membershipCall = { customerId, status }; },
    };

    const result = await applyAdminRestoreOverride(BASE_INPUT, deps);

    assert.deepEqual(result, { ok: true, overrideAuditLogId: "audit-123", resolvedCount: 2 });
    assert.equal(txCalls, 1, "both writes must happen inside exactly one transaction call");
    assert.equal(auditCreateArgs.data.performedBy, "owner@naiabynadine.com");
    assert.equal(auditCreateArgs.data.action, "access_revocation_override_restore");
    assert.deepEqual(auditCreateArgs.data.detail, { subscriptionId: "sub-1", customerId: "cust-1", reason: BASE_INPUT.reason });
    assert.equal(updateManyArgs.where.subscriptionId, "sub-1");
    assert.equal(updateManyArgs.where.resolvedAt, null);
    assert.match(updateManyArgs.data.resolvedReason, /admin_override/);
    assert.match(updateManyArgs.data.resolvedReason, new RegExp(BASE_INPUT.reason));
    assert.equal(updateManyArgs.data.overrideAuditLogId, "audit-123", "the revocation update must use the EXACT id the SAME transaction's audit write produced");
    assert.deepEqual(membershipCall, { customerId: "cust-1", status: "MEMBER" });
  });

  it("AO.2 — a CANCELED/EXPIRED subscription's revocations are still resolved (financial-record accuracy) but membership is never resurrected", async () => {
    let membershipCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => fn(fakeTx({ updateManyRevocations: async () => ({ count: 1 }) })),
      findSubscriptionById: async () => ({ id: "sub-1", status: "CANCELED" as const }),
      updateCustomerMembershipStatus: async () => { membershipCalls++; },
    };

    const result = await applyAdminRestoreOverride(BASE_INPUT, deps);

    assert.equal(result.ok, true);
    assert.equal(membershipCalls, 0, "a subscription that has independently CANCELED/EXPIRED must never be resurrected to MEMBER by this override");
  });

  it("AO.3 — a blank or whitespace-only reason refuses before writing anything — an unexplained override defeats the audit requirement", async () => {
    let txCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => { txCalls++; return fn(fakeTx()); },
    };

    const result = await applyAdminRestoreOverride({ ...BASE_INPUT, reason: "   " }, deps);

    assert.deepEqual(result, { ok: false, reason: "override_reason_required" });
    assert.equal(txCalls, 0);
  });

  it("AO.4 — no Subscription row found at all is a safe no-op for membership (still resolves the revocations and still audits)", async () => {
    let membershipCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => fn(fakeTx({ updateManyRevocations: async () => ({ count: 1 }) })),
      findSubscriptionById: async () => null,
      updateCustomerMembershipStatus: async () => { membershipCalls++; },
    };
    const result = await applyAdminRestoreOverride(BASE_INPUT, deps);
    assert.equal(result.ok, true);
    assert.equal(membershipCalls, 0);
  });

  it("AO.8 — if the AccessRevocation mutation throws, the whole call rejects rather than silently returning ok:true with a dangling audit record", async () => {
    const tx = fakeTx({ updateManyRevocations: async () => { throw new Error("DB write failed mid-transaction"); } });
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => fn(tx), // a real prisma.$transaction would roll back BOTH writes on this throw
    };
    await assert.rejects(() => applyAdminRestoreOverride(BASE_INPUT, deps), /DB write failed mid-transaction/);
  });
});

describe("applyAdminRevokeOverride", () => {
  it("AO.5 — writes the audit record and creates an independent AccessRevocation row inside ONE transaction, linked to that exact record, then denies access", async () => {
    let auditCreateArgs: any = null;
    let revocationCreateArgs: any = null;
    let txCalls = 0;
    const tx = fakeTx({
      createAuditLog: async (args) => { auditCreateArgs = args; return { id: "audit-999" }; },
      createRevocation: async (args) => { revocationCreateArgs = args; },
    });
    const runOverrideTransaction: RunOverrideTransactionFn = async (fn) => { txCalls++; return fn(tx); };
    let membershipCall: any = null;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction,
      updateCustomerMembershipStatus: async (customerId, status) => { membershipCall = { customerId, status }; },
    };

    const result = await applyAdminRevokeOverride({ ...BASE_INPUT, reason: "Policy violation — manual revoke", reasonCode: "DISPUTE_LOST" }, deps);

    assert.deepEqual(result, { ok: true, overrideAuditLogId: "audit-999", resolvedCount: 0 });
    assert.equal(txCalls, 1, "both writes must happen inside exactly one transaction call");
    assert.equal(auditCreateArgs.data.action, "access_revocation_override_revoke");
    assert.deepEqual(revocationCreateArgs.data, { subscriptionId: "sub-1", reason: "DISPUTE_LOST", overrideAuditLogId: "audit-999" });
    assert.deepEqual(membershipCall, { customerId: "cust-1", status: "NONE" });
  });

  it("AO.6 — a blank reason refuses before writing anything", async () => {
    let txCalls = 0;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => { txCalls++; return fn(fakeTx()); },
    };
    const result = await applyAdminRevokeOverride({ ...BASE_INPUT, reason: "", reasonCode: "REFUND" }, deps);
    assert.deepEqual(result, { ok: false, reason: "override_reason_required" });
    assert.equal(txCalls, 0);
  });

  it("AO.7 — the audit detail records the subscription/customer references and the reasonCode — Founder Decision 16's 'transaction/customer references' requirement", async () => {
    let auditCreateArgs: any = null;
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => fn(fakeTx({ createAuditLog: async (args) => { auditCreateArgs = args; return { id: "audit-1" }; } })),
      updateCustomerMembershipStatus: async () => {},
    };
    await applyAdminRevokeOverride({ ...BASE_INPUT, reasonCode: "REFUND" }, deps);
    assert.equal(auditCreateArgs.data.detail.subscriptionId, "sub-1");
    assert.equal(auditCreateArgs.data.detail.customerId, "cust-1");
    assert.equal(auditCreateArgs.data.detail.reasonCode, "REFUND");
    assert.equal(auditCreateArgs.data.detail.reason, BASE_INPUT.reason);
  });

  it("AO.9 — if the AccessRevocation create throws, the whole call rejects rather than silently returning ok:true with a dangling audit record", async () => {
    const tx = fakeTx({ createRevocation: async () => { throw new Error("DB write failed mid-transaction"); } });
    const deps: AdminRevocationOverrideDeps = {
      runOverrideTransaction: async (fn) => fn(tx),
    };
    await assert.rejects(
      () => applyAdminRevokeOverride({ ...BASE_INPUT, reasonCode: "REFUND" }, deps),
      /DB write failed mid-transaction/,
    );
  });
});
