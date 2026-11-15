# Customer Data Export — Preview acceptance tests

Prepared, not executed. Running these requires: (1) this branch deployed to
an isolated Preview, and (2) live Cloudinary calls against that Preview's
own staging Cloudinary scope — both need separate explicit approval before
any step below is run for real. Every destructive step uses a disposable
synthetic customer created for this purpose, never a real customer record.

## Setup

1. Deploy this branch to a new, isolated Vercel Preview (not the stable
   staging alias). Confirm via the deployment JSON: `target: null`,
   `environment: "preview"`.
2. Create a disposable synthetic customer with a known small set of Closet
   items, a My nAia Model body photo, and at least one completed
   Virtual Try-On result — enough to produce a non-empty export.
3. Sign in to the new Preview hostname as that synthetic customer
   (Deployment Protection requires a fresh sign-in per unique hostname).

## 1. Ordinary export (≤ MAX_SYNC_EXPORT_IMAGES)

- [ ] `GET /api/export-zip` while signed in as the synthetic customer.
- [ ] Response streams a real `.zip` with `Content-Disposition: attachment`.
- [ ] Archive contains `data.json` plus `images/closet/*`, `images/model/*`,
      `images/vto/*` for every image the synthetic account actually has.
- [ ] `data.json` does NOT reference `NaiaModel.facePublicId` or
      `SelfieAnalysis.photoPublicId` as bundled files — face/selfie photos
      stay excluded (see `customer-export-zip.server.ts`'s own note).
- [ ] A second immediate request succeeds independently (the sync path has
      no job-row state to collide with).

## 2. Large export (> MAX_SYNC_EXPORT_IMAGES)

- [ ] Temporarily raise the synthetic customer's Closet item count past
      `MAX_SYNC_EXPORT_IMAGES` (300) using disposable synthetic Closet
      items — never a real customer's data.
- [ ] `GET /api/export-zip` 302-redirects to a signed Cloudinary `raw`
      download URL.
- [ ] Following the redirect actually downloads a real ZIP with the same
      contents guarantees as section 1.
- [ ] A `CustomerExportJob` row exists for this customer with
      `status: COMPLETED`, a `publicId`, and `expiresAt` ~24h out.

## 3. Duplicate-export overlap guard (this session's fix)

- [ ] Fire two concurrent `GET /api/export-zip` requests for the same
      large-export synthetic customer (e.g. two near-simultaneous curl
      calls). Confirm only ONE `CustomerExportJob` row is created — the
      second request gets the "already being prepared" message, not a
      second build.
- [ ] Manually set an existing `CustomerExportJob` row's `createdAt` to
      more than 10 minutes in the past while `status: PROCESSING` (synthetic
      row only). Confirm the next request terminalizes it
      (`FAILED` / `ABANDONED_STALE_PROCESSING`) and proceeds with a fresh
      build rather than staying blocked indefinitely.

## 4. Customer isolation

- [ ] Create a second disposable synthetic customer. Confirm
      `GET /api/export-zip-download/:jobId` (or the equivalent download
      route) using customer A's `jobId` while signed in as customer B
      returns the same response as a nonexistent job — never customer A's
      data, never a distinguishable "wrong customer" error.

## 5. Expired downloads

- [ ] Manually set a synthetic `CustomerExportJob`'s `expiresAt` into the
      past. Confirm requesting its download link returns `expired`, and
      that no new signed link is issued.

## 6. Sweep deletion (actual Cloudinary removal, not just DB status)

- [ ] For a synthetic job already past `expiresAt` with a real uploaded
      Cloudinary asset, call `/api/export-zip-sweep` with the dedicated
      secret.
- [ ] Confirm the response reports `deleted: 1` (or more) and the job's
      `status` flips to `EXPIRED` with `publicId: null`.
- [ ] Confirm independently (Cloudinary admin API or dashboard) that the
      asset itself is actually gone — not just the DB row updated. This is
      the one check that proves deletion really happened, not merely that
      the sweep endpoint claimed success.
- [ ] Repeat with a backlog larger than `SWEEP_BATCH_SIZE` to confirm
      `more: true` is reported and a second call drains the remainder.

## 7. Failure recovery

- [ ] Simulate a Cloudinary upload failure during a large-export build
      (e.g. temporarily point `_uploadRaw` at a failing stub via a staging-
      only override, or exhaust a synthetic account's upload quota if one
      exists). Confirm the job is marked `FAILED` with a specific
      `errorCode`, and that a subsequent retry starts a fresh build rather
      than being permanently blocked by the failed row.
- [ ] Simulate exceeding `MAX_LARGE_EXPORT_BYTES` (e.g. a synthetic account
      with enough large images). Confirm the job fails with
      `EXCEEDS_BYTE_CEILING` and the customer sees the generic "couldn't be
      prepared, try again or contact support" message — never a raw error
      or a silently truncated ZIP presented as complete.

## Out of scope for this pass

Execution-time behavior under Vercel's real function timeout cannot be
verified by this checklist — it requires the actual deployed function
configuration, which is a separate, unresolved item (see the main report's
item 4 discussion on execution-time limits).
