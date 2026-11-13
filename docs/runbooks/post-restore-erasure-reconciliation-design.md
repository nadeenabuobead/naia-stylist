# Post-Restore Privacy-Erasure Reconciliation — Design Only

**Status: design document only. No schema change, no migration, no implementation.** This addresses the gap Task 8 surfaced and this phase's backup/DR re-verification confirmed still open: if a database restore brings the DB back to a point *before* a customer's erasure request completed, nothing in this codebase today detects that condition or knows it needs to re-apply the erasure. This document proposes a mechanism; it does not build one.

## The problem, precisely

Today, `app/lib/customer-privacy.server.ts` erases a customer one of two ways:
- `prisma.customer.delete()` for a customer with no billing history — the row is simply gone.
- `anonymizeBilledCustomer` for a customer with `Subscription`/`BillingTransaction` rows (`onDelete: Restrict` prevents a hard delete) — PII fields are nulled in place, the row stays.

Neither path writes any **durable, queryable** record that says "customer X was erased, as of timestamp T." The only durable tables in this area are **failure** records (`PendingCustomerErasureFailure`, `PendingCloudinaryDeletion`) — success is logged only via an ephemeral `console.log` in the GDPR webhook routes (`webhooks.customers.redact.tsx`, `webhooks.shop.redact.tsx`), which doesn't survive a restore and isn't queryable even before one.

So: customer requests erasure → row deleted/anonymized → some time later, a restore (for an unrelated reason — a bad migration, a corrupted table, anything) rolls the database back to a snapshot taken *before* the erasure → the customer's row reappears with PII intact (delete path) or un-anonymized (anonymize path) → nothing anywhere notices.

## Design: a durable, append-only erasure ledger

**Proposal (not yet built): a new model, tentatively `CustomerErasureRecord`**, written at the moment an erasure succeeds, independent of whether the `Customer` row was deleted or anonymized:

```
model CustomerErasureRecord {
  id            String   @id @default(cuid())
  // The customer's identity needs to survive even if the Customer row
  // itself is hard-deleted — store the id as a plain string, with no FK
  // relation to Customer (same deliberate pattern PendingCustomerErasureFailure
  // already uses for this exact reason, once that customer's row may be gone).
  customerId    String
  erasureMethod String   // "HARD_DELETE" | "ANONYMIZED"
  requestSource String   // "customer_self_service" | "shopify_customers_redact" | "shopify_shop_redact" | "admin_action"
  erasedAt      DateTime @default(now())

  @@index([customerId])
  @@index([erasedAt])
}
```

Design choices, and why:
- **Append-only, never updated or deleted.** The whole point is to survive a restore of *other* tables intact — if this table could itself be rolled back, it wouldn't help. (A real implementation would need this table on a separement durability guarantee, or — more practically for this stack — simply treated as data nobody ever deletes, with its own entry checked after any restore before trusting the rest of the restored data.)
- **No FK to `Customer`.** Mirrors `PendingCustomerErasureFailure`'s existing, already-reviewed pattern for the same reason: the referenced customer row may no longer exist (hard-delete path) by the time anyone reads this table.
- **One row per erasure event, not a flag on `Customer`.** A flag on the `Customer` row itself would be lost exactly when it matters (restored away along with everything else about that customer). A separate, append-only table is the only shape that can be *diffed against* a restored snapshot.

## Design: the reconciliation procedure (added to the restore runbook, not run today)

After any restore (per `docs/runbooks/backup-restore-dr.md` §3's existing procedure, step 4 — "run the application's own smoke checks" — this would be one more check added there, not a replacement):

1. Query `CustomerErasureRecord` for every row with `erasedAt` **after** the restore's target timestamp. Each one names a customer whose erasure may not have "stuck" in the restored data.
2. For each such `customerId`, check the restored `Customer` row: does it exist (hard-delete path) or does it still carry PII (anonymize path)?
3. If either check shows the erasure didn't survive the restore, **re-run the exact same erasure function** (`eraseCustomerData`/`anonymizeBilledCustomer` — whichever `erasureMethod` the ledger recorded) against the restored data, before the restored environment is promoted to serve real traffic.
4. Record the reconciliation action itself in `AdminAuditLog` (already exists, already used for admin retry actions) — so there's a visible trail of "this customer's erasure had to be re-applied after a restore on date X," which also matters for proving GDPR compliance was maintained through the incident.

## Why this is scoped as a ledger, not a bigger change

Considered and rejected for this design pass:
- **Writing erasure status onto the `Customer` row itself** (e.g. `erasedAt` field) — rejected because it's lost in the hard-delete path (no row to hold the field) and doesn't help in the anonymize path either, since that row *is* what gets rolled back.
- **A separate, continuously-replicated system of record outside this Postgres instance entirely** (e.g. logging erasures to an external, independently-backed-up store) — more robust in principle, but a much bigger decision (a new external dependency, its own durability/cost questions) than this phase should propose unilaterally. Flagged as a possible future upgrade if the ledger-in-the-same-database approach is judged insufficient, not recommended now.

## What would actually need building, if approved

1. One additive migration (new table, no FK, no change to any existing table) — small, same shape as `PendingCustomerErasureFailure`'s own migration.
2. One write call added at each of the (currently two) places an erasure actually completes in `customer-privacy.server.ts` — small, additive, same file already being touched by the Cloudinary/erasure-owning workstream, so this should be coordinated with them rather than done by this phase.
3. The reconciliation procedure itself (§ above) added as a step in `backup-restore-dr.md`'s restore procedure — documentation only, this phase's own responsibility once the ledger exists.
4. Tests mirroring the existing behavioral-test house style for erasure (two-synthetic-customer pattern) — confirm the ledger row is written on both erasure paths, confirm it is NOT written on a failed erasure (that stays in `PendingCustomerErasureFailure` as today).

None of the above has been done. This document is the proposal only, per this phase's read-only instruction for this item.
