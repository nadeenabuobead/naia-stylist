# Handling the Preview-Only Build Guard for Eventual Production Release — Design Only

**Status: design/recommendation document only. The guard has NOT been removed, weakened, or modified in any way by this phase.** `vercel.json` and `scripts/require-preview-env.sh` on `integrate/staging-rc-unified-prep@f7fb57c339ea2edb6b446daa88592092b26cdfa2` are untouched and re-confirmed byte-identical to their state at the start of this phase.

## The guard, exactly as it stands today

`vercel.json`:
```json
{
  "framework": "react-router",
  "installCommand": "npm install",
  "buildCommand": "sh scripts/require-preview-env.sh && sh scripts/build-preview.sh"
}
```

`scripts/require-preview-env.sh` unconditionally exits 1 unless `VERCEL_ENV` is literally `"preview"` — its own header comment states its purpose plainly: it was written (2026-10-20) for "ONE controlled Preview deployment... must never run as Production," on a branch that was explicitly disposable at the time. That branch's lineage is now the unified release candidate — the guard's original justification (a one-off disposable deploy-candidate) no longer matches what this file actually is today, but the guard itself is still doing real, valuable work: it is the only thing standing between an accidental Production promotion and a build that was never meant to run there.

**Do not read this document as "the guard is stale, remove it."** The guard is correct about the one thing it checks. What's missing is a path for the one day this branch's descendant *is* meant to run in Production.

## Why this matters now, not just "eventually"

Every domain audited in Task 8 and this phase assumes a real staging→production path exists. It currently doesn't, in the most literal sense: if this exact build config were promoted to Production today, the build would fail outright (exit 1) before a single line of application code runs. That's a safe failure mode (fails closed, not open) — but it means "deploy to Production" isn't a deployment decision today, it's also a code-change decision, and that code change needs to be designed in advance rather than improvised under launch-day pressure.

## Three options considered

**Option A — Delete the guard entirely at cutover time, as its own deliberate, reviewed commit.**
Simplest. The guard's own header comment already documents the condition under which it should go away ("the canonical ... branch and the published application are untouched" — implying this file was never meant to live forever). Risk: a plain deletion is a one-line diff with high leverage — easy to review, but also easy to merge by accident or too early if it's just sitting on a branch waiting.

**Option B — Replace the guard with a real environment-aware build path that handles Production correctly, not just permissively.**
E.g., restore something closer to the original (pre-Oct-20) three-way branch: Production runs `prisma migrate deploy` unconditionally (migrations are the versioned source of truth, should always apply on a real Production deploy), Preview keeps today's opt-in `NAIA_ALLOW_PREVIEW_MIGRATIONS` gate, anything else fails closed same as today. This is "finish the environment matrix" rather than "remove a check." More code than Option A, but it's the shape the build config should have had all along once this stopped being a one-off branch.

**Option C — Add one explicit, narrow opt-in flag rather than removing or rewriting anything.**
E.g. `if [ "$VERCEL_ENV" != "preview" ] && [ "$NAIA_PRODUCTION_RELEASE_APPROVED" != "true" ]; then exit 1; fi`. The guard stays exactly as strict as today for every environment except the one moment someone deliberately sets a new, single-purpose, named env var for the actual cutover deployment. The commit that adds this flag can happen well in advance (reviewed calmly, not under launch pressure); the risk moves entirely to a Vercel dashboard action (setting one env var), which is itself easy to audit (who set it, when) and easy to unset afterward if cutover needs to be redone.

## Recommendation

**Option C, with Option B's correctness fix folded in.** Reasoning:
- It lets the actual code change (the small, reviewable diff that adds the opt-in) happen now, calmly, independent of the cutover date — rather than being one more thing to write correctly under time pressure on launch day.
- It keeps the existing fail-closed guarantee for every environment by default — nothing about today's safety posture weakens until someone takes a second, explicit, separately-logged action (setting the Vercel env var).
- It composes with Option B's observation: once `NAIA_PRODUCTION_RELEASE_APPROVED=true` is set and `VERCEL_ENV=="production"`, that path should run unconditional `prisma migrate deploy` (the real Production migration behavior), not reuse `build-preview.sh`'s opt-in-gated preview logic — Production should never need a second flag (`NAIA_ALLOW_PREVIEW_MIGRATIONS`) just to apply its own already-reviewed migrations.

## What this means for the actual cutover sequence (not executed, sequence only)

1. Land the small, reviewed code change (Option C + B) well before any planned cutover date — ordinary PR review, no special ceremony.
2. On cutover day: set `NAIA_PRODUCTION_RELEASE_APPROVED=true` on the Production environment only, confirm `VERCEL_ENV=="production"` is what Vercel actually sets for that deployment (not assumed — verify in the dashboard), then trigger the Production deployment.
3. Immediately after, decide whether to unset the flag again (if it's meant to gate every future Production deploy, leave it; if it's meant to be a one-time cutover switch, document that choice explicitly rather than leaving it ambiguous).
4. Confirm `/api/health` responds on the real Production domain as the first smoke check, per `docs/runbooks/backup-restore-dr.md`'s existing "smoke-check before trusting a new deployment" pattern.

None of steps 1-4 has been executed or scheduled by this phase — this section exists so the sequence is written down once, calmly, rather than reconstructed later under time pressure.
