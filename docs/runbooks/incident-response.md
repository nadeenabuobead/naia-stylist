# Incident Response Runbook

**Status: documentation only.** No incident has been declared or rehearsed using this document. It names what already exists in this codebase (🟢) versus what still needs a live decision or a tool this repo doesn't have (⚪). See [`backup-restore-dr.md`](backup-restore-dr.md) for the database-specific restore procedure this document cross-references rather than duplicates.

**2026-11-21 update (H11):** added §3 (Severity), §4 (Escalation), §6 (Evidence Preservation), §7 (Notification Decision-Making), and expanded Post-Incident Review (§8). These sections are drafted from this repo's own confirmed architecture and this team's already-documented operating decisions — not invented. §7 in particular contains multiple items marked **[UNCONFIRMED — legal review needed]**: this document does not, and cannot, constitute legal advice or legal sign-off on breach-notification obligations, deadlines, or applicable jurisdiction. Do not treat anything in §7 as a cleared legal position until a qualified advisor has confirmed it.

## 1. What already exists to detect and diagnose an incident (🟢)

- **Liveness**: `GET /api/health` (`app/routes/api.health.tsx`) — proves the process is up. It deliberately does not check the database or any provider (see that file's own header comment), so a 200 from it does NOT mean the app is actually serving customers correctly. Treat a failing health check as "the process is down," and everything else below as how you find out the process is up but broken.
- **Structured error capture**: `app/lib/error-tracking.server.ts`'s `captureError`/`captureFailure`, wired into SSR render errors (`entry.server.jsx`), FASHN failures (`fashn-try-on.server.ts`), and Claude failures (`claude.server.ts`). Today this only reaches stdout/stderr — i.e. **Vercel's own function logs are the only place these events currently land.** There is no external alerting; see `error-tracking-provider-setup.md` for what adding one would require.
- **Audit trail**: `AdminAuditLog` (admin actions) and `JourneyEvent`/`PendingCustomerErasureFailure` (customer-facing operational events + GDPR-erasure retry tracking) already exist in the schema and are written to in normal operation — useful for reconstructing a timeline during an incident, not just for the features they were originally built for.
- **Entitlement/quota state**: `Subscription`, `BillingTransaction`, and the per-feature quota-tracking fields in `entitlement.server.ts` give a factual record of what a customer was and wasn't entitled to at a point in time — relevant if an incident involves a billing/entitlement bug, not just an outage.

## 2. What does NOT exist yet (⚪)

- **No alerting.** Nobody gets paged. The only way to learn about an incident today is: a customer reports it, someone is actively watching Vercel's dashboard/logs, or a future external monitor (see the separate `naia-ops-monitoring` repo workstream, tracked in memory as not yet activated) catches it.
- **No on-call rotation, and no second authorized decision-maker.** §4 documents the real current structure (founder as sole handler) rather than inventing a rotation that doesn't exist — that structure itself is still a real gap, not a tool this document can build.
- **No status page or customer-communication template.** If customers need to be told something is degraded, that copy and channel do not exist yet.
- **No automated rollback trigger.** Rolling back is a manual decision + manual command — see `deployment-rollback.md`.

## 3. Severity

No tooling assigns this automatically — it's a human judgment call made at step 2 of §5, using these criteria. Write the chosen severity into the incident's write-up (§8) even if it changes as more is learned; that's expected, not a sign the first call was wrong.

| Severity | Criteria | Examples from this codebase |
|---|---|---|
| **SEV1 — Critical** | Customer PII/photos/financial data exposed, modified, or deleted without authorization; or the app is broadly unusable for most customers | A cross-customer IDOR actually exploited (not just found — H1 was this *class* of bug before its fix); a migration run against the wrong database; broad 5xx |
| **SEV2 — High** | A single feature or a bounded subset of customers affected; no confirmed unauthorized data exposure yet, but can't rule it out | StyleMe/VTO generations failing broadly; a provider (Claude/FASHN/Cloudinary) outage; the 08P01 Postgres protocol-violation pattern recurring at volume |
| **SEV3 — Low** | Single customer or clearly cosmetic/non-security issue | One customer's export stuck; a UI regression with no data-integrity angle |

**Any SEV1, and any SEV2 where unauthorized access to personal data cannot be ruled out,** triggers §7 (Notification Decision-Making) — don't wait until root cause is fully understood to start that clock; §7 explains why.

## 4. Escalation

This team does not have an on-call rotation, a second approver, or a formal escalation ladder — documenting one that doesn't exist would be worse than naming the real, current structure plainly:

- **The founder is the sole handler, sole approver, and sole escalation point for every operational decision in this codebase today** — the same structure already decided for customer requests/refunds (see `customer-request-refund-operating-procedures-20261117.md`), extended here rather than invented fresh.
- **Known, already-flagged gap, not new**: if the founder is genuinely unreachable during an incident, no one else is currently authorized to act — this is the same "real absence-coverage gap" already named as a Legal risk in the refund-procedures document, not a separate discovery. A second approver or staff role exists in code (`INTERNAL_STAFF_SECRET`) but is deliberately inert — "do NOT appoint a second person or provision the staff-role secret without separate approval" per that same prior decision. This document does not change that; it only means a SEV1 that happens while the founder is unreachable has no fallback decision-maker today.
- **Within this constraint, escalation in practice means**: whoever first detects or is told about a candidate incident gets it in front of the founder as fast as possible, with §3's severity read and §5's step-1/step-2 findings already done, not a bare "something's wrong." There's no pager — email/a direct message/whatever channel already reaches the founder fastest is the escalation path, by necessity rather than design.
- **If the team ever does grow a second handler**, the two unresolved things to decide at that point are already named in the refund-procedures doc (who becomes the backup approver, and under what conditions the staff-role secret gets provisioned) — this document doesn't need to re-litigate that, just flag that it's the same open decision.

## 5. Incident response procedure (what to actually do, once declared)

1. **Confirm it's real, not a false alarm.** Check `GET /api/health` first (proves the process is up at all), then check Vercel's function logs for `[error-capture]` lines matching the reported symptom's timeframe.
2. **Classify severity (§3) and blast radius** before doing anything irreversible:
   - Single customer? → Check `AdminAuditLog`/`JourneyEvent` for that customer's recent activity; this is very unlikely to need a rollback or restore.
   - One feature (e.g. StyleMe generations failing)? → Check whether it's a provider-side outage (FASHN/Claude/Cloudinary status, if they publish one) vs. an app-side regression from a recent deploy. `captureFailure`'s `context` tag (`fashn:submit`, `fashn:poll`, `claude:text`, `claude:vision`) tells you which provider path, if any, is involved.
   - Everything down / 5xx-ing broadly? → Check whether it correlates with a recent deploy (see `deployment-rollback.md` — rolling back the deployment is usually faster than root-causing live) or a DB-level issue (`P2024`/connection-pool-timeout errors in logs — see `vercel-limits-and-db-budget-review.md` §4 for why this is a plausible first failure mode under load).
3. **Preserve evidence (§6) before touching anything**, in parallel with step 4, not after it — many of the easy mitigations below (redeploying, restarting, rolling back) can overwrite exactly the logs an eventual investigation or notification decision would need.
4. **Stop the bleeding before investigating root cause**, if data integrity is at risk (a bad write loop, a migration applied to the wrong environment). Pausing further writes (scaling the affected deployment down, or Vercel's own deployment protection) buys time without destroying evidence. Never delete/restore anything as a first response — see `backup-restore-dr.md` §3 for why restoring in place is explicitly the wrong move.
5. **Mitigate**: roll back the deployment (`deployment-rollback.md`) if the incident correlates with a recent deploy; otherwise mitigate at the feature level if possible (e.g. a provider outage might only need customers told to retry later — there is no feature-flag kill-switch infrastructure in this codebase today beyond the per-feature `ENTITLEMENT_ENFORCEMENT`-style env flags, which are not designed as incident kill-switches and shouldn't be repurposed as one without thinking through the fail-open/fail-closed consequences documented in `entitlement.server.ts`'s own comments).
6. **Decide on notification (§7)** — triggered per §3's rule, decided by the founder (§4), using §7's criteria. This is a decision to make and document even if the answer is "not required" — don't skip it just because it's uncomfortable or because root cause isn't fully known yet.
7. **Communicate** — internally at minimum (there is no customer-facing status mechanism to use yet, per §2); externally only per whatever §6 decided.
8. **Resolve and confirm**: re-check `GET /api/health`, spot-check the previously-failing feature manually, check error-capture logs for the incident's signature having stopped.
9. **Post-incident review (§8)** — not optional for a SEV1/SEV2, strongly recommended even for a SEV3.

## 6. Evidence preservation

The goal is simple: whatever happens next (a root-cause investigation, a notification decision, a dispute with a provider, a future audit), there should be a record of what the system actually showed at the time — not a reconstruction from memory afterward.

- **Before mitigating, capture**: the exact timestamp range of the symptom; the Vercel function logs for that window (copy/export them — **Vercel's log retention window for this project is `[UNCONFIRMED — check current Vercel plan/retention settings before relying on this]`**, so logs can age out while an investigation is still running); the specific `AdminAuditLog`/`JourneyEvent`/`PendingCustomerErasureFailure` rows relevant to the affected customer(s) if the blast radius is narrow enough to enumerate; the deployment ID and commit SHA that was live at the time (`vercel inspect` / `git log`).
- **Never delete or mutate the rows you're investigating** while the incident is open — `AdminAuditLog` and `JourneyEvent` are already append-only by convention in this codebase (nothing in the existing route code updates or deletes them in normal operation); keep that property during an incident too, including resisting the urge to "clean up" a customer's data before you've captured what it showed.
- **If a rollback or restore becomes necessary** (`deployment-rollback.md` / `backup-restore-dr.md`), capture the pre-rollback state first wherever feasible — a restore is explicitly a last resort precisely because it can overwrite the evidence of what the incident actually did (see `backup-restore-dr.md` §3).
- **Chain of custody / who held what, when**: there is no dedicated evidence-log location or tooling for this today. Until one exists, record captures (what was copied, by whom, when, and where it's stored) in the same incident write-up from §8 rather than nowhere.

## 7. Notification decision-making

**This section informs a decision; it does not make one, and it is not legal advice.** Every deadline and authority named below is a commonly-cited baseline for personal-data breaches under GDPR-style regimes, included so the decision-maker has a starting framework — **not** a confirmed statement of what applies to this business. Items marked **[UNCONFIRMED — legal review needed]** are exactly that, and must not be treated as settled until a qualified legal advisor confirms them.

- **Who decides**: the founder (§4) — there is no other authorized decision-maker today.
- **When this section is triggered**: per §3, any SEV1, or any SEV2 where unauthorized access to personal data can't be ruled out. "Personal data" here includes, at minimum, the categories this codebase already treats as sensitive in its own code comments: selfie photos, body/measurement data, closet/wardrobe photos, billing/payment records, and account-identifying information.
- **The baseline question**: did an unauthorized party access, acquire, or could they plausibly have accessed, personal data belonging to identifiable customers? If genuinely unknown, treat it as "yes" for the purpose of starting this process, and downgrade later if evidence clears it — not the reverse.
- **Commonly-cited deadlines, unconfirmed for this business**:
  - **72 hours** to notify the relevant supervisory authority, from becoming aware of a qualifying breach, is GDPR's own headline figure — **[UNCONFIRMED — legal review needed]** whether GDPR (or an equivalent regime, e.g. UK GDPR) actually applies here, which supervisory authority would be the right one, and what "becoming aware" means in practice for this specific incident.
  - **"Without undue delay"** is the typical standard for notifying affected individuals directly, when notification to them is required at all (not every notifiable breach requires this) — **[UNCONFIRMED — legal review needed]** whether this incident meets that bar.
  - This business already handles EU customers under statutory withdrawal rights (`customer-request-refund-operating-procedures-20261117.md`) — relevant context for why a GDPR-style regime is plausible, not proof that it's the controlling one.
- **Facts this document does not have, and should not guess at**: which entity is the data controller vs. processor for any given data flow (including the third-party AI vendor relationships — see C6); which supervisory authority, if any, is the right contact; whether a Data Protection Officer or equivalent role exists or is required; where a breach register (if required) would be kept. **All [UNCONFIRMED — legal review needed]** until named by counsel.
- **What TO do now, without waiting for legal confirmation of the above**: preserve evidence (§6), stop ongoing unauthorized access if any is still occurring (part of §5 step 4's mitigation), and get legal counsel engaged as early as possible once a SEV1 or qualifying SEV2 is declared — the 72-hour-style clock, if it applies, runs regardless of whether counsel has been reached yet.

## 8. Post-incident review

For any SEV1 or SEV2, and recommended even for a SEV3 that took real effort to resolve. Write it up even briefly — there is no incident-log location in this repo today; until one exists, a dated entry in whatever this team's standard documentation tool is (not necessarily this git repo) is better than nothing.

Minimum shape:
- **What happened** — in plain language, not just the technical symptom.
- **Timeline** — detection time, declaration time, mitigation time, resolution time (pull these from the evidence captured in §6).
- **Severity assigned** (§3), and whether it changed during the incident.
- **Root cause** — if known; "not yet determined" is a valid answer, but say so explicitly rather than leaving it blank.
- **Notification decision** (§7) and what was decided, even if the answer was "not required."
- **What made detection/response slower or harder than it should have been** — this is the section most likely to produce a real action item (e.g. "no alert fired for 40 minutes" → a concrete argument for finally activating a monitoring provider, see `error-tracking-provider-setup.md`).
- **Action items, each with an owner** — given §4's reality, the owner is very likely the founder for now; still write it down as an action item rather than leaving it implicit.

## 9. Explicitly deferred, not forgotten

- Wiring a real error-tracking provider (Sentry or similar) — `error-tracking-provider-setup.md` lists exactly what that needs and why it hasn't been done.
- Any paging/on-call tooling.
- A customer-facing status page.
- A kill-switch mechanism purpose-built for incident mitigation (distinct from the existing entitlement-enforcement flags, which serve a different purpose).
- A second authorized decision-maker / backup escalation path (§4) — organizational decision, not a code change.
- Legal confirmation of every item marked **[UNCONFIRMED — legal review needed]** in §7 — jurisdiction, supervisory authority, DPO/equivalent, breach-register location, and whether GDPR or an equivalent regime actually applies to this business's current customer base.
- A dedicated evidence-log/chain-of-custody location (§6) — today this lives in whatever ad hoc write-up §8 produces.
- Confirmation of this project's actual Vercel log retention window (§6) — needed before anyone relies on "the logs will still be there" during a slow-moving investigation.
