# Content-Security-Policy — Report-Only Implementation Plan

**Status: a plan only. No CSP header has been added, no code changed beyond the jsPDF version bump in this branch's other commit.** Kept deliberately separate per instruction — this document exists so the CSP work can be picked up as its own reviewed change, not bundled into dependency hardening.

## 0. A correctness finding this plan depends on — read first

**The app's current `frame-ancestors` protection is not actually enforced by any spec-compliant browser, and this is not new — it predates this engagement.** It's delivered via `app/root.jsx:60`, a `<meta httpEquiv="Content-Security-Policy" content="frame-ancestors https://admin.shopify.com https://*.myshopify.com;">`. Per the CSP specification, **`frame-ancestors` (along with `sandbox`) is explicitly ignored when delivered via a `<meta>` element** — the framing decision has already been made by the time the HTML is parsed, so only a real HTTP response header can carry this directive. Chromium logs this to the console as a no-op. ([content-security-policy.com meta example](https://content-security-policy.com/examples/meta/), [OWASP Clickjacking Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html))

**What this means for "preserve the existing enforced frame-ancestors protection":** the honest state today is that it reads as enforced in the source but isn't, in any browser that follows the spec. Preserving its *intent* — not its current, non-functional delivery mechanism — requires sending `frame-ancestors https://admin.shopify.com https://*.myshopify.com;` as a **real, always-enforced** `Content-Security-Policy` HTTP response header, same exact value, from the moment any CSP work ships — **decoupled from, and shipped before or alongside, the Report-Only experimentation below, never gated behind it.** A `Content-Security-Policy-Report-Only` header never blocks anything, by definition, so `frame-ancestors` must never live only in the Report-Only header. The existing `<meta>` tag can stay (harmless, and `frame-ancestors` is the only directive it's used for today) or be removed once the real header ships — either is fine; what matters is the header existing.

## 1. Script/resource inventory (recap, for this document's self-containedness)

| Source | What | Directive(s) needed |
|---|---|---|
| `app/root.jsx:96` | jsPDF 4.2.1, CDN, SRI-pinned | `script-src https://cdnjs.cloudflare.com` |
| `app/root.jsx:99` | One inline IIFE (cookie/sessionStorage clear, same-origin link handling) | `script-src` needs a nonce or hash for this specific inline script |
| `app/root.jsx:74` | One inline `<style>` (CSS custom properties) | `style-src` needs a nonce/hash, or accept Clerk's own constraint below |
| `ClerkProvider` (wraps the whole app, `app/root.jsx:112`) | Clerk's own JS, loaded dynamically from the app's Frontend API domain at runtime; Clerk's bot/fraud-protection challenge UI | see §2 |
| React Router hydration | The app's own bundled client JS (`build/client/assets/*.js`), same-origin | `script-src 'self'` |
| Fonts | `fonts.googleapis.com` (stylesheet), `fonts.gstatic.com` (font files), `cdn.shopify.com` (Inter stylesheet) | `style-src`, `font-src` |
| Images | `cdn.shopify.com` (product images), `res.cloudinary.com` (customer photos) | `img-src` |
| Stripe | **None** — `api.billing-checkout.tsx` returns a Stripe-hosted Checkout `session.url`; the browser navigates away. Zero CSP accommodation needed on this app's own pages. | — |
| Shopify App Bridge | **None found** — no App Bridge CDN script tag exists anywhere in this codebase today. Re-check this inventory if App Bridge is ever added. | — |

## 2. Clerk's current, official requirements (fetched directly from Clerk's own docs, not inferred)

Per [Clerk's CSP headers guide](https://clerk.com/docs/guides/secure/best-practices/csp-headers):

- `script-src`: Clerk's own Frontend API domain (**app-specific — derived from the live `CLERK_PUBLISHABLE_KEY`/`CLERK_FRONTEND_API`; not readable from code, must be supplied by whoever has that live value**), plus `https://challenges.cloudflare.com` (**this is Clerk's "security challenge domain"** — Cloudflare Turnstile, used for Clerk's bot/abuse protection challenge UI) and `https://*.protect.clerk.com` (Clerk's fraud/abuse-protection rotating subdomains).
- `connect-src`: the same Frontend API domain, plus `https://*.protect.clerk.com:*` (note the explicit `:*` port wildcard, called out by Clerk's own docs).
- `frame-src`: `https://challenges.cloudflare.com` and `https://*.protect.clerk.com`.
- `img-src`: `https://img.clerk.com`.
- `style-src`: Clerk's own docs state `'unsafe-inline'` is **required** for Clerk's runtime CSS-in-JS — they do not offer a nonce-based alternative for their own styles. This is a real, externally-imposed constraint, not a choice this app can design around.
- `worker-src`: `'self' blob:`.
- Clerk also documents an `x-nonce`-header-based mechanism for apps that want strict, non-`'unsafe-inline'` `script-src` — relevant to this app's own one inline script (see §3).
- `'unsafe-eval'` is only needed in `script-src` for development (Vite HMR) — **must not** appear in the production/staging policy.
- Clerk's SDK may need a `dynamic` prop set on `ClerkProvider` to cooperate with a strict CSP — a real code change to make when this plan is implemented, not something achievable by headers alone.

## 3. React Router hydration + the app's own inline script/style — nonce plan

React Router's SSR hydration script is the same-origin bundled JS already covered by `script-src 'self'` — no nonce needed there, it's a real `<script src="/assets/...">` tag, not inline.

The two places that DO need a nonce (or hash) are specific to this app, not React Router itself:
1. `app/root.jsx:99`'s inline cookie-clearing script.
2. `app/root.jsx:74`'s inline `<style>` block.

**Plan:** generate one random nonce per request in `app/entry.server.jsx` (where the response is first assembled), thread it through to `app/root.jsx`'s `Layout` component (via `loaderData` or a request-scoped context — React Router's `getLoadContext`/middleware mechanism, already used elsewhere in this codebase for similar per-request concerns, is the natural fit), and:
- Add `nonce={requestNonce}` to both the inline `<script>` and the inline `<style>` tags.
- Send `script-src 'self' 'nonce-<value>' https://cdnjs.cloudflare.com <CLERK_FAPI_DOMAIN> https://challenges.cloudflare.com https://*.protect.clerk.com;` — browsers that understand nonces use it; there is no `'unsafe-inline'` fallback needed in `script-src` since this app controls 100% of its own inline scripts (just the one).
- For `style-src`, accept Clerk's documented constraint: `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;` — per the CSP spec, a nonce/hash source and `'unsafe-inline'` can coexist in the same directive safely: browsers that support nonces ignore `'unsafe-inline'` when a valid nonce is also present; only browsers unaware of nonces fall back to it. So the app's own inline `<style>` CAN still carry a nonce (defense-in-depth for modern browsers) even though Clerk's requirement means `'unsafe-inline'` must stay in the policy as a floor.

## 4. Full proposed Report-Only policy

```
Content-Security-Policy:
  frame-ancestors https://admin.shopify.com https://*.myshopify.com;
  (sent as its own, always-enforced header — see §0. Never Report-Only.)

Content-Security-Policy-Report-Only:
  default-src 'self';
  script-src 'self' 'nonce-<per-request>' https://cdnjs.cloudflare.com <CLERK_FAPI_DOMAIN> https://challenges.cloudflare.com https://*.protect.clerk.com;
  style-src 'self' 'unsafe-inline' 'nonce-<per-request>' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com https://cdn.shopify.com;
  img-src 'self' https://cdn.shopify.com https://res.cloudinary.com https://img.clerk.com data:;
  connect-src 'self' <CLERK_FAPI_DOMAIN> https://*.protect.clerk.com:*;
  frame-src https://challenges.cloudflare.com https://*.protect.clerk.com;
  worker-src 'self' blob:;
  report-to csp-endpoint;
```

`<CLERK_FAPI_DOMAIN>` is the one value this plan cannot supply — it needs filling in by whoever has live access to the Clerk dashboard/env vars (this is not a secret in the credential sense, but it is a live-environment-specific value this session has no way to read).

## 5. Reporting endpoint — concrete proposal, not yet built

Recommend a new minimal route, e.g. `app/routes/api.csp-report.tsx`, that:
- Accepts the browser's CSP violation report POST body (`application/csp-report` or the newer Reporting API JSON format — support both, browsers are mid-migration between the two).
- Routes it through the **existing** `captureFailure` from `app/lib/error-tracking.server.ts` (the same seam built in an earlier phase for FASHN/Claude) — `captureFailure("csp-violation", report.violatedDirective, { blockedUri: report.blockedUri, documentUri: report.documentUri })` or similar, logging only the directive/URI fields, never any page content.
- Needs zero new external vendor decision — reuses infrastructure this codebase already has, consistent with how `error-tracking.server.ts` was designed to be a single integration point.
- The `report-to` directive needs a matching `Reporting-Endpoints` header (or the older `Report-To` header) pointing at this route's URL — both headers ship together, not just one.

## 6. Rollout sequence (not started)

1. Land the real, always-enforced `frame-ancestors` header (§0) as its own small, independently-reviewable change — this is a pure bug fix (restoring protection that was never actually active), not CSP "work," and shouldn't wait on anything else in this plan.
2. Build the reporting endpoint (§5) and confirm it receives a test violation locally before relying on it.
3. Get the real `<CLERK_FAPI_DOMAIN>` value from whoever has live Clerk dashboard access.
4. Implement the nonce wiring (§3) — `entry.server.jsx` → `root.jsx`.
5. Ship the full policy in §4 as `Content-Security-Policy-Report-Only` ONLY (the `frame-ancestors` header from step 1 continues enforcing in parallel, unaffected).
6. Watch real violation reports for a meaningful period (days, not hours) across every route category: customer-facing trend reports (jsPDF), the Clerk sign-in/sign-up flow, the Shopify-embedded admin surface, and the billing-checkout redirect path.
7. Fix whatever the reports reveal (a missed domain, a missed inline script) — expect at least one iteration here; this plan's domain list is researched, not empirically proven against this app's live traffic.
8. Only once reports are clean for a sustained period, promote `Content-Security-Policy-Report-Only` to a real, enforcing `Content-Security-Policy` header (merged with the `frame-ancestors` header from step 1, or kept as two headers — either is valid CSP).

Nothing in this sequence has been executed. Steps 1 and 2 are the only ones with zero external dependency and could be scheduled first and independently of the Clerk-domain question in step 3.
