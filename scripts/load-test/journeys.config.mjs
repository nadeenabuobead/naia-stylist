// scripts/load-test/journeys.config.mjs
//
// Named journeys for the synthetic load-test harness (run-load-test.mjs).
// Every step is a single HTTP request. `fixtureSession` is filled in per
// virtual user from a fixtures file (see fixtures/README.md) — it is never
// a real customer's session. Journeys that would trigger a real paid
// provider call are marked `requiresProviderMock: true`; the harness
// refuses to run them unless ALLOW_PROVIDER_MOCKS=true is set in ITS OWN
// environment too (a second, independent check from the app-side guard in
// fashn-try-on.server.ts / claude.server.ts — belt and suspenders, so a
// misconfigured run fails closed instead of silently hitting a real
// provider).
//
// Weights are relative, not percentages — a user is assigned one journey
// at the start of each iteration, chosen proportionally to weight.

/**
 * @typedef {Object} JourneyStep
 * @property {string} method
 * @property {(ctx: { session: any }) => string} path
 * @property {(ctx: { session: any }) => Record<string,string>} [headers]
 * @property {(ctx: { session: any }) => string | undefined} [body]
 */

export const journeys = [
  {
    name: "health",
    weight: 5,
    requiresProviderMock: false,
    requiresAuth: false,
    steps: [{ method: "GET", path: () => "/api/health" }],
  },
  {
    name: "read-only-trend-reports",
    weight: 10,
    requiresProviderMock: false,
    requiresAuth: false,
    steps: [
      { method: "GET", path: () => "/trends" },
      { method: "GET", path: () => "/trends/my-edits" },
    ],
  },
  {
    name: "clerk-sign-in-page-render",
    weight: 10,
    requiresProviderMock: false,
    requiresAuth: false,
    // Renders the sign-in page only — does NOT complete a real Clerk
    // authentication handshake. See fixtures/README.md §2 for why
    // actually completing sign-in per virtual user is out of scope for
    // this harness without Clerk's own test-mode support.
    steps: [{ method: "GET", path: () => "/sign-in" }],
  },
  {
    name: "passport-read",
    weight: 15,
    requiresProviderMock: false,
    requiresAuth: true,
    steps: [{ method: "GET", path: () => "/passport" }],
  },
  {
    name: "closet-browse",
    weight: 20,
    requiresProviderMock: false,
    requiresAuth: true,
    steps: [
      { method: "GET", path: () => "/closet" },
      { method: "GET", path: () => "/closet/intelligence" },
    ],
  },
  {
    name: "styleme-generate",
    weight: 15,
    requiresProviderMock: true, // calls Claude (and, on the real provider path, FASHN) — must run against the mock server
    requiresAuth: true,
    steps: [
      { method: "GET", path: () => "/style-me" },
      // The actual generation POST is intentionally not enumerated here —
      // see docs/ops/load-test-plan.md §4 for why StyleMe's own quota/
      // entitlement gate (plan-limits.server.ts) makes a tight concurrent
      // loop against one fixture customer meaningless (every call past
      // the first in-window hits the SAME quota branch, not a new one),
      // and why that needs a wider pool of fixture customers rather than
      // a harness change.
    ],
  },
  {
    name: "buy-or-skip-browse",
    weight: 10,
    requiresProviderMock: false,
    requiresAuth: true,
    steps: [{ method: "GET", path: () => "/my-naia/buying-decisions" }],
  },
  {
    name: "billing-plan-usage-read",
    weight: 10,
    requiresProviderMock: false,
    requiresAuth: true,
    steps: [{ method: "GET", path: () => "/my-naia/plan-usage" }],
  },
  {
    name: "settings-privacy-read",
    weight: 5,
    requiresProviderMock: false,
    requiresAuth: true,
    steps: [{ method: "GET", path: () => "/settings" }],
  },
];
