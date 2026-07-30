// Phase 16 — Customer route contract tests.
//
// Source-code assertions that enforce the invariants established during the
// customer-app remediation pass (Phases 2–15). Tests run in node:test with
// tsx/esm, no DOM or Prisma connection required.
//
// Coverage categories:
//   A. Auth gate — customer routes use canonical OIDC auth, not legacy JWT
//   B. Legacy retirement — deprecated routes issue 301 redirects
//   C. No alert() in customer UI — inline error state only
//   D. Canonical catalog — api routes source products from naia-catalog
//   E. Passport signal forwarding — buildProfileSignals maps all 12 fields
//   F. Route registration — all customer routes registered in routes.js
//   G. Dashboard hygiene — no /quick-style links remain in dashboard

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function route(rel: string): string {
  return readFileSync(join(__dirname, rel), "utf8");
}

function lib(rel: string): string {
  return readFileSync(join(ROOT, "app/lib", rel), "utf8");
}

function rootFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ── A. Auth gate ──────────────────────────────────────────────────────────────

describe("A — auth gate: routes use canonical OIDC auth", () => {
  it("settings.tsx imports requireCurrentNaiaCustomer from naia-session.server", () => {
    const src = route("settings.tsx");
    assert.ok(src.includes("requireCurrentNaiaCustomer"), "imports requireCurrentNaiaCustomer");
    assert.ok(src.includes("naia-session.server"), "from naia-session.server");
    assert.ok(!src.includes("authenticateCustomer"), "does not use legacy authenticateCustomer");
  });

  it("settings.tsx calls requireCurrentNaiaCustomer inside loader", () => {
    const src = route("settings.tsx");
    assert.ok(src.includes("await requireCurrentNaiaCustomer(request)"), "awaits requireCurrentNaiaCustomer");
  });

  it("my-naia._index.tsx imports and calls requireCurrentNaiaCustomer", () => {
    const src = route("my-naia._index.tsx");
    assert.ok(src.includes("requireCurrentNaiaCustomer"), "imports requireCurrentNaiaCustomer");
    assert.ok(src.includes("naia-session.server"), "from naia-session.server");
    assert.ok(!src.includes("authenticateCustomer"), "does not use legacy authenticateCustomer");
  });

  it("my-naia.saved.tsx requires auth with requireCurrentNaiaCustomer", () => {
    const src = route("my-naia.saved.tsx");
    assert.ok(src.includes("requireCurrentNaiaCustomer"), "imports requireCurrentNaiaCustomer");
    assert.ok(src.includes("await requireCurrentNaiaCustomer(request)"), "awaits requireCurrentNaiaCustomer");
    assert.ok(!src.includes("authenticateCustomer"), "does not use legacy authenticateCustomer");
  });

  it("closet._index.tsx uses requireCurrentNaiaCustomer (not legacy auth) for auth guard", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("requireCurrentNaiaCustomer"), "imports requireCurrentNaiaCustomer");
    assert.ok(src.includes("naia-session.server"), "from naia-session.server");
    assert.ok(!src.includes("localStorage"), "no localStorage token");
    assert.ok(!src.includes("naia_customer_token"), "no legacy token key");
  });

  it("passport.tsx requires auth with requireCurrentNaiaCustomer", () => {
    const src = route("passport.tsx");
    assert.ok(src.includes("requireCurrentNaiaCustomer"), "imports requireCurrentNaiaCustomer");
    assert.ok(src.includes("await requireCurrentNaiaCustomer(request)"), "awaits requireCurrentNaiaCustomer");
    assert.ok(!src.includes("authenticateCustomer"), "does not use legacy authenticateCustomer");
  });

  it("post-wear-review.tsx uses canonical session helpers from naia-session.server", () => {
    const src = route("post-wear-review.tsx");
    assert.ok(src.includes("naia-session.server"), "imports from naia-session.server");
    assert.ok(!src.includes("authenticateCustomer"), "does not use legacy authenticateCustomer");
    assert.ok(!src.includes("naia_customer_token"), "no legacy token key");
    assert.ok(!src.includes("localStorage"), "no localStorage token");
  });
});

// ── B. Legacy retirement ──────────────────────────────────────────────────────

describe("B — legacy retirement: deprecated routes redirect to canonical destinations", () => {
  it("stylist.jsx is a redirect-only route (no legacy SPA code)", () => {
    const src = route("stylist.jsx");
    assert.ok(src.includes('redirect("/style-me"'), "redirects to /style-me");
    assert.ok(src.includes("status: 301"), "is a 301 permanent redirect");
    assert.ok(!src.includes("localStorage"), "no localStorage token handling");
    assert.ok(!src.includes("authenticateCustomer"), "no legacy auth");
    assert.ok(!src.includes("callClaude"), "no Engine A calls");
    // Should be a very short file — not the old 2000-line SPA
    assert.ok(src.length < 300, `file is unexpectedly large (${src.length} chars) — legacy code may have been restored`);
  });

  it("account.jsx redirects to /my-naia with 301", () => {
    const src = route("account.jsx");
    assert.ok(src.includes('redirect("/my-naia"'), "redirects to /my-naia");
    assert.ok(src.includes("status: 301"), "is a 301 permanent redirect");
    assert.ok(src.length < 300, "file is unexpectedly large — check for legacy code");
  });

  it("stylist-popup.jsx redirects to / with 301", () => {
    const src = route("stylist-popup.jsx");
    assert.ok(src.includes('redirect("/"'), "redirects to /");
    assert.ok(src.includes("status: 301"), "is a 301 permanent redirect");
    assert.ok(src.length < 300, "file is unexpectedly large — check for legacy code");
  });

  it("style-session-new/_index.tsx redirects to /style-me with 301", () => {
    const src = route("style-session-new/_index.tsx");
    assert.ok(src.includes('redirect("/style-me"'), "redirects to /style-me");
    assert.ok(src.includes("status: 301"), "is a 301 permanent redirect");
    assert.ok(src.length < 300, "file is unexpectedly large — check for legacy code");
  });

  it("no retired route uses authenticateCustomer or naia_customer_token", () => {
    const retired = ["stylist.jsx", "account.jsx", "stylist-popup.jsx", "style-session-new/_index.tsx"];
    for (const file of retired) {
      const src = route(file);
      assert.ok(!src.includes("authenticateCustomer"), `${file}: must not use authenticateCustomer`);
      assert.ok(!src.includes("naia_customer_token"), `${file}: must not reference legacy token`);
    }
  });
});

// ── C. No alert() in customer UI ──────────────────────────────────────────────

describe("C — no alert() in customer-facing routes", () => {
  it("quick-style/_index.tsx does not call alert()", () => {
    const src = route("quick-style/_index.tsx");
    assert.ok(!src.includes("alert("), "no alert() call — must use inline error state");
  });

  it("quick-style/_index.tsx has inline error state for save validation", () => {
    const src = route("quick-style/_index.tsx");
    assert.ok(src.includes("saveError"), "has saveError state");
    assert.ok(src.includes("setSaveError"), "has setSaveError setter");
  });

  it("my-naia.saved.tsx does not call alert()", () => {
    const src = route("my-naia.saved.tsx");
    assert.ok(!src.includes("alert("), "no alert() call");
  });

  it("post-wear-review.tsx does not call alert()", () => {
    const src = route("post-wear-review.tsx");
    assert.ok(!src.includes("alert("), "no alert() call");
  });
});

// ── D. Canonical catalog ──────────────────────────────────────────────────────

describe("D — canonical catalog: api routes use naia-catalog as single source of truth", () => {
  it("api.wishlist.jsx imports getAllCatalogProducts from naia-catalog", () => {
    const src = route("api.wishlist.jsx");
    assert.ok(src.includes("getAllCatalogProducts"), "imports getAllCatalogProducts");
    assert.ok(src.includes("naia-catalog"), "from naia-catalog module");
  });

  it("api.wishlist.jsx builds NAIA_PRODUCTS from canonical catalog, not a hardcoded array", () => {
    const src = route("api.wishlist.jsx");
    assert.ok(src.includes("NAIA_PRODUCTS = getAllCatalogProducts()"), "NAIA_PRODUCTS derived from catalog");
    // Ensure the old static hardcoded list (with specific product handles) is gone
    assert.ok(!src.includes('"naia-by-nadine-silk"'), "no hardcoded product handles");
  });

  it("api.naia-products.jsx imports getAllCatalogProducts from naia-catalog", () => {
    const src = route("api.naia-products.jsx");
    assert.ok(src.includes("getAllCatalogProducts"), "imports getAllCatalogProducts");
    assert.ok(src.includes("naia-catalog"), "from naia-catalog module");
  });

  it("api.naia-products.jsx maps parsed.identity fields from catalog", () => {
    const src = route("api.naia-products.jsx");
    assert.ok(src.includes("parsed.identity.verifiedTitle"), "uses verifiedTitle");
    assert.ok(src.includes("parsed.identity.itemType"), "uses itemType");
    assert.ok(src.includes("parsed.identity.liveUrl"), "uses liveUrl");
  });
});

// ── E. Passport signal forwarding ────────────────────────────────────────────

describe("E — passport signal forwarding: buildProfileSignals maps all 12 fields", () => {
  it("StyleMeProfileSignals type includes all 12 passport fields", () => {
    const src = lib("ai/styleme-recommendation.types.ts");
    const requiredFields = [
      "stylePersonalities",
      "favoriteColors",
      "avoidColors",
      "styleSupport",
      "desiredImpression",
      "desiredFeelings",
      "becoming",
      "lifestyle",
      "dressesFor",
      "bodyFocusAreas",
      "bodyAvoidAreas",
      "fitPreferences",
    ];
    for (const field of requiredFields) {
      assert.ok(src.includes(field), `StyleMeProfileSignals missing field: ${field}`);
    }
  });

  it("buildProfileSignals accepts all 12 passport fields in its profile parameter", () => {
    const src = lib("ai/styleme-result.server.ts");
    const requiredFields = [
      "stylePersonalities",
      "favoriteColors",
      "avoidColors",
      "styleSupport",
      "desiredImpression",
      "desiredFeelings",
      "becoming",
      "lifestyle",
      "dressesFor",
      "bodyFocusAreas",
      "bodyAvoidAreas",
      "fitPreferences",
    ];
    for (const field of requiredFields) {
      assert.ok(
        src.includes(`${field}?:`),
        `buildProfileSignals parameter type missing field: ${field}`
      );
    }
  });

  it("buildProfileSignals forwards all 12 fields to the signals object", () => {
    const src = lib("ai/styleme-result.server.ts");
    const forwarded = [
      "signals.stylePersonalities",
      "signals.favoriteColors",
      "signals.avoidColors",
      "signals.styleSupport",
      "signals.desiredImpression",
      "signals.desiredFeelings",
      "signals.becoming",
      "signals.lifestyle",
      "signals.dressesFor",
      "signals.bodyFocusAreas",
      "signals.bodyAvoidAreas",
      "signals.fitPreferences",
    ];
    for (const assignment of forwarded) {
      assert.ok(src.includes(assignment), `buildProfileSignals not forwarding: ${assignment}`);
    }
  });

  it("buildProfileSignals returns undefined for null/empty profile (no signals fabricated)", () => {
    const src = lib("ai/styleme-result.server.ts");
    assert.ok(src.includes("if (!profile) return undefined"), "returns undefined for null profile");
    assert.ok(
      src.includes("Object.keys(signals).length > 0 ? signals : undefined"),
      "returns undefined when no signals present"
    );
  });

  it("buildProfileSignals omits size/budget/shopping fields (non-actionable for engine)", () => {
    const src = lib("ai/styleme-result.server.ts");
    // These fields exist on OnboardingProfile but were deliberately excluded
    // as non-actionable for the recommendation engine
    assert.ok(!src.includes("signals.heightCm"), "excludes heightCm (not engine-actionable)");
    assert.ok(!src.includes("signals.topSize"), "excludes topSize (not engine-actionable)");
    assert.ok(!src.includes("signals.budgetRange"), "excludes budgetRange (not engine-actionable)");
  });
});

// ── F. Route registration ────────────────────────────────────────────────────

describe("F — route registration: all customer routes registered in routes.js", () => {
  it("my-naia route is registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(src.includes('"my-naia"') || src.includes("'my-naia'"), "my-naia route registered");
    assert.ok(src.includes("my-naia._index.tsx"), "points to my-naia._index.tsx");
  });

  it("my-naia/saved route is registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(
      src.includes('"my-naia/saved"') || src.includes("'my-naia/saved'"),
      "my-naia/saved route registered"
    );
    assert.ok(src.includes("my-naia.saved.tsx"), "points to my-naia.saved.tsx");
  });

  it("my-naia-model route is registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(
      src.includes('"my-naia-model"') || src.includes("'my-naia-model'"),
      "my-naia-model route registered"
    );
    assert.ok(src.includes("my-naia-model.tsx"), "points to my-naia-model.tsx");
  });

  it("settings route is registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(src.includes('"settings"') || src.includes("'settings'"), "settings route registered");
    assert.ok(src.includes("settings.tsx"), "points to settings.tsx");
  });

  it("post-wear-review route is registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(
      src.includes('"post-wear-review"') || src.includes("'post-wear-review'"),
      "post-wear-review route registered"
    );
    assert.ok(src.includes("post-wear-review.tsx"), "points to post-wear-review.tsx");
  });

  it("passport/selfie route is registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(
      src.includes('"passport/selfie"') || src.includes("'passport/selfie'"),
      "passport/selfie route registered"
    );
    assert.ok(src.includes("passport.selfie.tsx"), "points to passport.selfie.tsx");
  });

  it("style-session-new route is registered (as redirect tombstone)", () => {
    const src = rootFile("app/routes.js");
    assert.ok(
      src.includes('"style-session-new"') || src.includes("'style-session-new'"),
      "style-session-new route registered"
    );
    assert.ok(src.includes("style-session-new"), "has style-session-new file reference");
  });

  it("canonical auth routes are registered", () => {
    const src = rootFile("app/routes.js");
    assert.ok(src.includes('"auth/shopify/login"') || src.includes("'auth/shopify/login'"), "auth/shopify/login registered");
    assert.ok(src.includes('"auth/shopify/callback"') || src.includes("'auth/shopify/callback'"), "auth/shopify/callback registered");
    assert.ok(src.includes('"auth/logout"') || src.includes("'auth/logout'"), "auth/logout registered");
  });
});

// ── G. Dashboard hygiene ─────────────────────────────────────────────────────

describe("G — dashboard hygiene: no /quick-style links in main dashboard", () => {
  it("_index.tsx (dashboard) has no to='/quick-style' links", () => {
    const src = route("_index.tsx");
    assert.ok(!src.includes('to="/quick-style"'), 'no to="/quick-style" links');
    assert.ok(!src.includes("to='/quick-style'"), "no to='/quick-style' links");
    assert.ok(!src.includes('href="/quick-style"'), 'no href="/quick-style" links');
  });

  it("_index.tsx (dashboard) links to /style-me for styling actions", () => {
    const src = route("_index.tsx");
    assert.ok(src.includes('"/style-me"') || src.includes("'/style-me'"), "links to /style-me");
  });

  it("_index.tsx (dashboard) has post-wear review entry point", () => {
    const src = route("_index.tsx");
    assert.ok(
      src.includes("post-wear-review") || src.includes("HOW DID IT GO"),
      "has post-wear review entry point"
    );
  });
});
