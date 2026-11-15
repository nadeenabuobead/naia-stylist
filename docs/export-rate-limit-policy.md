# Customer Data Export — rate-limit enforcement policy recommendation

Status: recommendation only. `EXPORT_RATE_LIMIT.mode` in
[`api.export-zip.ts`](../app/routes/api.export-zip.ts) stays `"shadow"` per
explicit instruction — nothing here flips it. This is the analysis to make
that decision from once staging verification is done.

## What's already true, independent of this limiter

- `reserveExportJobSlot` (customer-export-zip-large.server.ts) already
  blocks a customer from having more than one large export genuinely
  in-flight at a time — a rapid double-click or retry gets
  `already_processing`, not a second build. This closes the sharpest
  abuse case (concurrent duplicate builds) regardless of what the rate
  limiter does.
- A COMPLETED job is NOT reused on a later request. `/api/export-zip`
  calls `buildCustomerExportZip`/`buildLargeCustomerExportZip` fresh every
  time it's hit, even if the customer already has a recent, still-valid
  (unexpired) completed export sitting in Cloudinary. This means a
  customer who legitimately exports twice in the same hour — not abuse,
  just re-checking or confused about whether the first one worked — pays
  the full rebuild cost again. Worth fixing as its own small change
  (check `getExportJobForCustomer`-style for a recent COMPLETED,
  unexpired job before rebuilding) but it's a product/engineering
  decision on its own, not bundled into this policy note.

## What the current shadow-mode limiter actually covers

`EXPORT_RATE_LIMIT`: 5 requests/hour per customer, shadow mode (logs
`would-block`, never returns 429). This caps the *sync* path (≤300
images, cheap) and the *large* path (>300 images, the one this session
hardened with streaming + a time budget) under the SAME number — but
they are not equally expensive. Five large exports in an hour is a much
bigger real cost (Cloudinary storage for five ZIPs, five full image-fetch
cycles, five chunked uploads) than five small ones.

## Recommendation

1. **Before enforcing anything**, pull the actual `[rate-limit] would-block`
   log volume for routeKey `export-zip` from staging/production logs over
   a real observation window (at least a few days of real traffic). This
   policy is a reasoned guess without that data — don't flip to `enforce`
   on guesswork alone when the real numbers are one log query away.
2. **Split the limit by path, not just by route.** Keep (or lightly
   relax) 5/hour for the sync path — it's cheap and a legitimate customer
   might reasonably hit it a few times while checking their export.
   Add a SEPARATE, tighter limit specifically for the large path (e.g.
   2/day per customer) — gate it inside `buildLargeCustomerExportZip`
   itself or as a second `checkRateLimit` call keyed on a distinct
   routeKey like `export-zip-large`, checked right after
   `buildCustomerExportZip` returns `too_large` and before calling
   `buildLargeCustomerExportZip`. This directly targets the expensive
   path without over-restricting the cheap one.
3. **Enforce, don't just log, once (1) confirms low real false-positive
   risk.** Shadow mode's whole point was never jumping straight to
   blocking on a brand-new limit (same discipline this codebase already
   applies elsewhere) — once the would-block log volume is reviewed and
   looks like genuine abuse patterns (the same customer id hitting the
   ceiling repeatedly) rather than ordinary retries, flip
   `EXPORT_RATE_LIMIT.mode` (and the new large-path limit) to `"enforce"`.
4. **Reuse a still-valid COMPLETED job instead of rebuilding**, per the
   observation above — this reduces the real cost of a legitimate
   double-request without needing the limiter to distinguish intent at
   all, so it's worth doing before or alongside the enforcement flip, not
   instead of it (a determined abuser would still vary something to force
   a rebuild; the limiter is still the real backstop against that).

## What NOT to do

Don't block on image count alone as a proxy for "large" — a customer
legitimately near the Closet cap (250 items, plan-limits.server.ts) isn't
abusive just for having a lot of photos. The limiter should key on
request *frequency*, never on account size.
