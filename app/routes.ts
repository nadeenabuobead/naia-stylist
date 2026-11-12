import type { RouteConfig } from "@react-router/dev/routes";
import { route, index } from "@react-router/dev/routes";

// Fully explicit route registry.
// routes.js previously shadowed this file (findEntry prefers .js over .ts).
// routes.js has been removed; this file is now the authoritative config.
// Test files (*.test.ts / *.test.tsx) are intentionally absent — they are
// not application routes and must not appear in the route manifest.
export default [
  index("routes/_index.tsx"),
  // Phase 1 ops — minimal unauthenticated liveness check for external
  // uptime monitors. See the route file's header for what it deliberately
  // does not do (no DB/provider check, no env/version/stack exposure).
  route("api/health", "routes/api.health.tsx"),
  route("onboarding/step/:step", "routes/onboarding/step.$step.tsx"),
  route("onboarding/age-confirm", "routes/onboarding.age-confirm.tsx"),
  route("onboarding/complete", "routes/onboarding/complete.tsx"),
  route("passport", "routes/passport.tsx"),
  route("closet", "routes/closet._index.tsx"),
  route("closet/intelligence", "routes/closet.intelligence.tsx"),
  route("api/wi-style-this", "routes/api.wi-style-this.tsx"),
  route("style-me", "routes/style-me/_index.tsx"),
  // Rev 3 — Psychology-First StyleMe (Group 5)
  route("style-me/state", "routes/style-me/state.tsx"),
  route("style-me/intention", "routes/style-me/intention.tsx"),
  route("style-me/physical-need", "routes/style-me/physical-need.tsx"),
  route("style-me/mood", "routes/style-me/mood.tsx"),
  route("style-me/feeling", "routes/style-me/feeling.tsx"),
  route("style-me/comfort", "routes/style-me/comfort.tsx"),
  route("style-me/occasion", "routes/style-me/occasion.tsx"),
  route("style-me/source", "routes/style-me/source.tsx"),
  route("style-me/result", "routes/style-me/result.tsx"),

  // Temporary staging-only QA doorway into the NADINE context. Stamps the entry origin
  // and nothing else; 404s outside staging. Not the eventual public NADINE StyleMe URL,
  // and not linked from the storefront. Remove when the real handoff is connected.
  route("style-me/nadine-preview", "routes/style-me.nadine-preview.tsx"),
  route("api/styleme-nadine-entry", "routes/api.styleme-nadine-entry.tsx"),
  // The NADINE PDP "Style Me" handoff. The route module has existed complete and
  // origin-guarded since the PDP block shipped, but was never registered here, so
  // every tap posted into a 404 (verified against production:
  //   GET https://naia-stylist.vercel.app/api/styleme-handoff -> 404).
  // The path must stay in step with naia-product-block.js, which builds
  // form.action = appUrl + "/api/styleme-handoff" — see HR-A.4.
  route("api/styleme-handoff", "routes/api.styleme-handoff.tsx"),
  route("api/customer-auth", "routes/api.customer-auth.jsx"),
  route("api/closet", "routes/api.closet.jsx"),
  route("api/closet-preview-analyze", "routes/api.closet-preview-analyze.ts"),
  // api/style retired 2026-11-02 — security remediation. Had no auth gate at
  // all (an optional authenticateCustomer() lookup was used only to enrich
  // the AI prompt, never to gate the request) and called Anthropic directly.
  // Its only caller was the AI-stylist-preview prototype on the embedded
  // admin's home page (app._index.jsx), itself retired in the same change —
  // real admin tooling lives at /app/naia-admin, and customer-facing styling
  // lives at /style-me. See api/tryon and api/quick-style above for the same
  // bug class, fixed 2026-10-19.
  route("api/outfit-history", "routes/api.outfit-history.jsx"),
  route("api/outfit-rating", "routes/api.outfit-rating.jsx"),
  route("api/naia-products", "routes/api.naia-products.jsx"),
  route("api/wishlist", "routes/api.wishlist.jsx"),
  route("api/customer-profile", "routes/api.customer-profile.jsx"),
  route("api/confidence-dashboard", "routes/api.confidence-dashboard.jsx"),
  route("api/designer-stats", "routes/api.designer-stats.jsx"),
  route("api/generate-trend-report", "routes/api.generate-trend-report.jsx"),
  route("api/personalized-trends", "routes/api.personalized-trends.jsx"),
  route("trend-reports", "routes/trend-reports._index.tsx"),
  route("trend-reports/:slug", "routes/trend-reports.$slug.tsx"),
  route("trends", "routes/trends.jsx"),
  route("trends/my-edits", "routes/trends.my-edits.tsx"),
  route("trends/my-edits/:slug", "routes/trends.my-edits.$slug.tsx"),
  route("trends/:slug", "routes/trends.$slug.tsx"),
  route("trends/:slug/edit", "routes/trends.$slug.edit.tsx"),
  route("trends/:slug/lens/:lens", "routes/trends.$slug.lens.$lens.tsx"),
  route("stylist", "routes/stylist.jsx"),
  route("stylist-popup", "routes/stylist-popup.jsx"),
  route("app", "routes/app.jsx", [
    index("routes/app._index.jsx"),
    route("designer-intelligence", "routes/app.designer-intelligence.jsx"),
    route("trend-reports", "routes/app.trend-reports._index.tsx"),
    route("trend-reports/:id", "routes/app.trend-reports.$id.tsx"),
    // nAia Admin — Phase 2: Closet Intelligence (read-only)
    route("naia-admin", "routes/app.naia-admin.tsx", [
      index("routes/app.naia-admin._index.tsx"),
      route("closet", "routes/app.naia-admin.closet._index.tsx"),
      route("closet/:itemId", "routes/app.naia-admin.closet.$itemId.tsx"),
    ]),
  ]),
  route("my-naia", "routes/my-naia._index.tsx"),
  route("my-naia/what-naia-notices", "routes/my-naia.what-naia-notices.tsx"),
  route("my-naia/plan-usage", "routes/my-naia.plan-usage.tsx"),
  route("my-naia/saved", "routes/my-naia.saved.tsx"),
  route("my-naia/buying-decisions", "routes/my-naia.buying-decisions.tsx"),
  route("my-naia-model", "routes/my-naia-model.tsx"),
  route("settings", "routes/settings.tsx"),
  route("post-wear-review", "routes/post-wear-review.tsx"),
  route("passport/selfie", "routes/passport.selfie.tsx"),
  route("style-session-new", "routes/style-session-new/_index.tsx"),
  route("auth/login", "routes/auth.login/route.jsx"),
  // Clerk — nAia's primary customer-auth provider (2026-11-04). Splat
  // routes, per Clerk's own React Router SDK requirement: SignIn/SignUp
  // render Clerk's own multi-step sub-paths (factor-one, verify-email,
  // reset-password, ...) under these prefixes.
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  // Where Clerk's own <SignUp/> component redirects once IT considers the
  // person signed up — this is where the nAia-specific Customer-provisioning
  // step (resolveCustomerForClerkSignUp) actually runs, server-side. A
  // separate top-level path, not nested under sign-up/*, since Clerk's own
  // splat route owns every path under that prefix for its multi-step UI.
  route("auth/clerk-callback", "routes/auth.clerk-callback.tsx"),
  route("account/link-identity", "routes/account.link-identity.tsx"),
  // Legacy — superseded by the Clerk routes above but not yet removed; see
  // naia-session.server.ts's own SUPERSEDED banner comment.
  route("auth/shopify/login", "routes/auth.shopify.login.tsx"),
  route("auth/shopify/callback", "routes/auth.shopify.callback.tsx"),
  // Cross-domain handoff for a preview-deployment-initiated login — see
  // auth.shopify.callback.tsx's comment on originHost for why this exists.
  route("auth/shopify/handoff", "routes/auth.shopify.handoff.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  route("auth/signed-out", "routes/auth.signed-out.tsx"),
  route("auth/*", "routes/auth.$.jsx"),
  route("webhooks/app/scopes_update", "routes/webhooks.app.scopes_update.jsx"),
  route("webhooks/app/uninstalled", "routes/webhooks.app.uninstalled.jsx"),
  // Phase 2 privacy remediation (2026-10-19) — Shopify's three mandatory
  // customer-privacy webhooks, previously entirely unimplemented.
  route("webhooks/customers/data_request", "routes/webhooks.customers.data_request.tsx"),
  route("webhooks/customers/redact", "routes/webhooks.customers.redact.tsx"),
  route("webhooks/shop/redact", "routes/webhooks.shop.redact.tsx"),
  route("quick-style", "routes/quick-style/_index.tsx"),
  // api/quick-style retired 2026-10-19 — Phase 1 security lockdown. No live
  // caller (the /quick-style page above posts to its own route action); this
  // file called Anthropic directly with no auth and no entitlement checks.
  route("full-style-profile", "routes/full-style-profile/_index.tsx"),
  route("api/full-style-profile", "routes/api.full-style-profile.jsx"),
  route("api/save-look", "routes/api.save-look.jsx"),
  route("buyskip", "routes/buyskip._index.tsx"),
  route("buyskip/:id", "routes/buyskip.$id.tsx"),
  // api/tryon retired 2026-10-19 — Phase 1 security lockdown. No live caller
  // (TryOnButton.tsx is never imported/rendered); had no auth, did an
  // unsigned public Cloudinary upload, and skipped all moderation. The
  // canonical, hardened VTO path is api/trigger-tryon + api/tryon-status.
  route("api/body-scan", "routes/api.bodyscan.jsx"),
  route("account", "routes/account.jsx"),
  route("api/recommendation-feedback", "routes/api.recommendation-feedback.tsx"),
  route("api/naia-observation-feedback", "routes/api.naia-observation-feedback.tsx"),
  route("api/post-wear-review", "routes/api.post-wear-review.tsx"),
  route("api/analyze-item", "routes/api.analyze-item.jsx"),
  route("api/cloudinary-signature", "routes/api.cloudinary-signature.jsx"),
  route("api/save-style-profile", "routes/api.save-style-profile.jsx"),
  route("api/save-about-you", "routes/api.save-about-you.jsx"),
  route("api/customer-account-identity", "routes/api.customer-account-identity.jsx"),
  route("api/designer-dashboard", "routes/api.designer-dashboard.jsx"),
  route("api/seed-staging", "routes/api.seed-staging.jsx"),
  route("api/staging-omar-fix", "routes/api.staging-omar-fix.ts"),
  route("api/staging-saved-looks-audit", "routes/api.staging-saved-looks-audit.jsx"),
  route("staging/designer-preview", "routes/staging.designer-preview.jsx"),
  // Full-Look VTO — staging-only, mock-only test harness (blocked in
  // production by NAIA_PROJECT_VARIANT; further gated to an explicit
  // customer allowlist via FULL_LOOK_VTO_TEST_CUSTOMER_IDS). Model photo and
  // FASHN are both still fully mocked — see the route's own header.
  route("staging/full-look-vto-test", "routes/staging.full-look-vto-test.tsx"),
  // Full-Look VTO — staging-only, REAL FASHN test harness (2026-11-03).
  // Registered here for the first time; the loader/action's own
  // isAuthorizedStagingTestAccount gate is the actual enforcement — same
  // NAIA_PROJECT_VARIANT==="staging" strict check (never VERCEL_ENV, which
  // can't distinguish Preview from a promoted Production deployment) plus
  // the SAME FULL_LOOK_VTO_TEST_CUSTOMER_IDS allowlist the mock route
  // above uses, re-checked independently on every request. Registering
  // this route does not change the mock route above in any way — different
  // path, different file, same gate function imported unmodified from it.
  route("staging/full-look-vto-real", "routes/staging.full-look-vto-real.tsx"),
  // Independent cleanup for Full-Look VTO QA pauses abandoned permanently —
  // see the route's own header for why Vercel Cron does NOT reach this path
  // on this project, and the authenticated, idempotent, staging-only
  // contract that applies regardless of how it's invoked.
  route("api/staging-full-look-vto-sweep", "routes/api.staging-full-look-vto-sweep.ts"),

  // ── Standalone Internal Admin Portal ─────────────────────────────────────
  // login and logout are flat (PUBLIC) — they must NOT be children of the
  // protected admin.tsx layout, or an unauthenticated request creates a loop:
  //   /admin → requireAdminSession → redirect /admin/login
  //   → admin.tsx loader runs AGAIN → redirect /admin/login → …
  route("admin/login",  "routes/admin.login.tsx"),
  route("admin/logout", "routes/admin.logout.tsx"),
  // Protected shell — all children inherit the requireAdminSession check.
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("maintenance", "routes/admin.maintenance.tsx"),
    route("naia", "routes/admin.naia.tsx", [
      index("routes/admin.naia._index.tsx"),
      route("closet", "routes/admin.naia.closet._index.tsx"),
      route("closet/:itemId", "routes/admin.naia.closet.$itemId.tsx"),
      route("customers", "routes/admin.naia.customers._index.tsx"),
      route("customers/:customerId", "routes/admin.naia.customers.$customerId.tsx"),
      route("customers/:customerId/buyskip/:analysisId", "routes/admin.naia.customers.$customerId.buyskip.$analysisId.tsx"),
      route("customers/:customerId/styleme/:sessionId", "routes/admin.naia.customers.$customerId.styleme.$sessionId.tsx"),
      route("customers/:customerId/trend-edit/:usageId", "routes/admin.naia.customers.$customerId.trend-edit.$usageId.tsx"),
      // Read-only JSON export of one customer's Closet (occasionFit / intentionPotentials
      // returned whole, nothing filtered). Admin-gated, GET only, no writes.
      route("customers/:customerId/closet-export", "routes/admin.naia.customers.$customerId.closet-export.tsx"),
      route("phase3c-export", "routes/admin.naia.phase3c-export.tsx"),
    ]),
    route("nadine", "routes/admin.nadine.tsx", [
      index("routes/admin.nadine._index.tsx"),
    ]),
  ]),
  route("api/track_event", "routes/api.track_event.jsx"),
  // Phase 3 billing — Stripe test-mode Checkout, webhook handling, billing management
  route("api/stripe-webhook", "routes/api.stripe-webhook.tsx"),
  route("api/billing-checkout", "routes/api.billing-checkout.tsx"),
  route("api/billing-portal", "routes/api.billing-portal.tsx"),
  // Clerk account-sync webhook (fix/stripe-clerk-phase1-security)
  route("api/clerk-webhook", "routes/api.clerk-webhook.tsx"),
  // VTO M1 — customer-facing virtual try-on trigger
  route("api/trigger-tryon", "routes/api.trigger-tryon.tsx"),
  // Full-look VTO — staging QA prototype only (blocked in production)
  route("api/staging-full-look-vto", "routes/api.staging-full-look-vto.tsx"),
  // VTO M2 — session-auth job status polling and result delivery
  route("api/tryon-status/:jobId", "routes/api.tryon-status.$jobId.tsx"),
  // Style Memory V1 — StyleMe outcome capture (UPSERT per OutfitSuggestion)
  route("api/styleme-outcome", "routes/api.styleme-outcome.tsx"),
  // Phase 5D — Taste & Evidence Layer V1
  route("api/taste-observation-feedback", "routes/api.taste-observation-feedback.tsx"),

] satisfies RouteConfig;
