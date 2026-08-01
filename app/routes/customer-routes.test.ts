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

  it("my-naia._index.tsx has no broken /my-naia/styleme/looks links", () => {
    const src = route("my-naia._index.tsx");
    assert.ok(!src.includes("/my-naia/styleme/looks"), "no /my-naia/styleme/looks hrefs");
  });

  it("my-naia._index.tsx has no /quick-style links", () => {
    const src = route("my-naia._index.tsx");
    assert.ok(!src.includes("/quick-style"), "no /quick-style links");
  });

  it("my-naia._index.tsx feedback path is single: only /post-wear-review", () => {
    const src = route("my-naia._index.tsx");
    assert.ok(src.includes("/post-wear-review"), "has /post-wear-review link");
    assert.ok(!src.includes("/my-naia/styleme/looks"), "no broken feedback links");
  });
});

// ── H. Digital Wardrobe (closet) — composed-shell invariants ────────────────
//   Enforces the approved composition: Option B shell (MyNaiaLayout) +
//   Option A page content (Digital Wardrobe title, stats, Add to Wardrobe,
//   filters, card grid, Style Me → /style-me).

describe("H — Digital Wardrobe: composed shell + content invariants", () => {
  it("closet._index.tsx uses MyNaiaLayout (NADINE global header)", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("MyNaiaLayout"), "imports MyNaiaLayout");
    assert.ok(src.includes("~/components/my-naia/MyNaiaLayout"), "from correct path");
  });

  it("closet._index.tsx loads naiaStyles (My nAia design system CSS)", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("naiaStyles"), "imports naiaStyles");
    assert.ok(src.includes("naia-design-system.css"), "from naia-design-system.css");
  });

  it("closet._index.tsx has no standalone cl-topbar (removed in favour of MyNaiaLayout)", () => {
    const src = route("closet._index.tsx");
    assert.ok(!src.includes("cl-topbar"), "no cl-topbar class");
    assert.ok(!src.includes("cl-topbar-logo"), "no cl-topbar-logo");
    assert.ok(!src.includes("cl-topbar-link"), "no cl-topbar-link");
  });

  it("closet._index.tsx uses Digital Wardrobe title from Option A", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("Digital Wardrobe"), "cl-headline says Digital Wardrobe");
    assert.ok(src.includes("cl-headline"), "uses cl-headline class");
  });

  it("closet._index.tsx has Total Pieces / Categories / Brands stats from Option A", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("Total Pieces"), "has Total Pieces stat");
    assert.ok(src.includes("Categories"), "has Categories stat");
    assert.ok(src.includes("Brands"), "has Brands stat");
    assert.ok(src.includes("cl-stats"), "uses cl-stats grid");
  });

  it("closet._index.tsx Add to Wardrobe form is from Option A (inline panel, not overlay)", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("Add to Wardrobe"), "has Add to Wardrobe panel title");
    assert.ok(src.includes("cl-form"), "uses cl-form class");
    assert.ok(src.includes("+ Add a Piece"), "has + Add a Piece CTA");
  });

  it("closet._index.tsx Style Me CTA links to /style-me (not deprecated /quick-style)", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes('to="/style-me"') || src.includes("to='/style-me'") || src.includes('"/style-me"'), "Style Me links to /style-me");
    assert.ok(!src.includes("/quick-style"), "no /quick-style links");
  });

  it("closet._index.tsx server action rejects imageUrl values not from Cloudinary", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("res.cloudinary.com"), "validates Cloudinary hostname");
    assert.ok(src.includes("Image must be uploaded via the app"), "returns rejection error message");
  });

  it("closet._index.tsx client-side MIME validation rejects non-image files", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("file.type.startsWith(\"image/\")"), "MIME type guard");
    assert.ok(src.includes("5 * 1024 * 1024"), "5 MB size guard");
  });

  it("closet._index.tsx has search filter (query state from Option B)", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("query"), "has query state");
    assert.ok(src.includes("Ivory trouser"), "has search placeholder text");
  });

  it("closet._index.tsx Back to Overview link goes to /my-naia", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("Back to Overview"), "has Back to Overview link text");
    assert.ok(src.includes('to="/my-naia"') || src.includes("to='/my-naia'"), "links to /my-naia");
  });
});

describe("I — BUG-5: closet-sourced saved look items carry imageUrl from closetItem join", () => {
  it("my-naia.saved.tsx loader joins closetItem.imageUrl on SavedLookItem records", () => {
    const src = route("my-naia.saved.tsx");
    assert.ok(src.includes("closetItem"), "loader includes closetItem relation");
    assert.ok(src.includes("select: { imageUrl: true }"), "selects imageUrl from closetItem");
  });

  it("my-naia.saved.tsx mapper falls back to closetItem.imageUrl when productImageUrl is null", () => {
    const src = route("my-naia.saved.tsx");
    assert.ok(
      src.includes("item.productImageUrl ?? item.closetItem?.imageUrl ?? null"),
      "mapper coalesces productImageUrl → closetItem.imageUrl → null"
    );
  });

  it("my-naia.saved.tsx LookCard filters to items with productImageUrl (now non-null for closet items)", () => {
    const src = route("my-naia.saved.tsx");
    assert.ok(src.includes("productImageUrl"), "LookCard uses productImageUrl for thumbnails");
  });

  it("my-naia._index.tsx loader selects productImageUrl and closetItem.imageUrl on SavedLook items", () => {
    const src = route("my-naia._index.tsx");
    assert.ok(src.includes("productImageUrl: true"), "selects productImageUrl from SavedLookItem");
    assert.ok(
      src.includes("closetItem: { select: { name: true, imageUrl: true } }"),
      "joins closetItem with imageUrl for overview thumbnails"
    );
  });

  it("my-naia._index.tsx overview thumbnail waterfall includes closetItem.imageUrl as final fallback", () => {
    const src = route("my-naia._index.tsx");
    assert.ok(
      src.includes("closetItem?.imageUrl"),
      "thumbnail rendering includes closetItem?.imageUrl fallback"
    );
  });
});

describe("J — upload security: client magic-byte validation + server-side Admin API + byte fetch + deletion", () => {
  it("closet._index.tsx defines IMAGE_SIGNATURES with magic bytes for JPEG PNG GIF WEBP HEIC", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("IMAGE_SIGNATURES"), "has IMAGE_SIGNATURES constant");
    assert.ok(src.includes("0xFF, 0xD8, 0xFF"), "JPEG magic bytes present");
    assert.ok(src.includes("0x89, 0x50, 0x4E, 0x47"), "PNG magic bytes present");
    assert.ok(src.includes("0x47, 0x49, 0x46, 0x38"), "GIF magic bytes present");
    assert.ok(src.includes("0x52, 0x49, 0x46, 0x46"), "WEBP/RIFF magic bytes present");
    assert.ok(src.includes("0x66, 0x74, 0x79, 0x70"), "HEIC ftyp magic bytes present");
  });

  it("closet._index.tsx reads 12-byte file header for client-side magic-byte signature check", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("file.slice(0, 12).arrayBuffer()"), "reads first 12 bytes for signature check");
    assert.ok(src.includes("new Uint8Array"), "wraps buffer as Uint8Array for byte comparison");
  });

  it("closet._index.tsx checks WEBP magic at both RIFF offset 0 and WEBP offset 8", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("isWebp"), "WEBP-specific check present");
    assert.ok(src.includes("header[8] === 0x57"), "checks byte 8 == W (0x57) for WEBP marker");
  });

  it("closet._index.tsx rejects files whose magic bytes do not match any supported signature", () => {
    const src = route("closet._index.tsx");
    assert.ok(
      src.includes("does not appear to be a valid image"),
      "returns user-facing error when client-side signature check fails"
    );
  });

  it("closet._index.tsx uses Image.decode + createObjectURL to catch corrupted images", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("createObjectURL"), "uses createObjectURL for image decode test");
    assert.ok(src.includes("new Image()"), "decodes via HTMLImageElement");
    assert.ok(src.includes("img.onerror"), "catches decode failures via onerror handler");
    assert.ok(
      src.includes("could not be decoded"),
      "user-facing error message for corrupted/undecodable files"
    );
  });

  it("closet._index.tsx enforces MIN_DIMENSION and MAX_DIMENSION on decoded image", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("MIN_DIMENSION"), "defines MIN_DIMENSION constant");
    assert.ok(src.includes("MAX_DIMENSION"), "defines MAX_DIMENSION constant");
    assert.ok(src.includes("too small"), "error message for images below minimum dimensions");
    assert.ok(src.includes("too large"), "error message for images above maximum dimensions");
  });

  it("closet._index.tsx rejects empty files before any upload attempt", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("file.size === 0"), "checks for zero-byte file");
    assert.ok(src.includes("appears to be empty"), "user-facing error for empty file");
  });

  it("closet._index.tsx server action verifies asset via Cloudinary Admin API before any DB write", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("verifyCloudinaryAsset"), "calls verifyCloudinaryAsset");
    assert.ok(
      src.indexOf("verifyCloudinaryAsset") < src.indexOf("prisma.closetItem.create"),
      "Admin API verification precedes DB write"
    );
  });

  it("closet._index.tsx server action deletes Cloudinary asset on any validation failure", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("deleteCloudinaryAsset"), "calls deleteCloudinaryAsset on rejection");
    const deleteCount = (src.match(/deleteCloudinaryAsset/g) ?? []).length;
    assert.ok(
      deleteCount >= 2,
      `expected deleteCloudinaryAsset on multiple rejection paths; found ${deleteCount}`
    );
  });

  it("closet._index.tsx server action extracts publicId from Cloudinary URL and validates ownership", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("extractCloudinaryPublicId"), "calls extractCloudinaryPublicId helper");
    assert.ok(src.includes("validatePublicIdOwnership"), "calls validatePublicIdOwnership");
    assert.ok(
      src.indexOf("extractCloudinaryPublicId") < src.indexOf("prisma.closetItem.create"),
      "publicId extraction precedes DB write"
    );
  });

  it("closet._index.tsx server action has ALLOWED_FORMATS allowlist from Admin API before prisma.closetItem.create", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("ALLOWED_FORMATS"), "defines ALLOWED_FORMATS set");
    assert.ok(src.includes('"jpg"'), "allowlist includes jpg");
    assert.ok(src.includes('"webp"'), "allowlist includes webp");
    assert.ok(src.includes('"heic"'), "allowlist includes heic");
    assert.ok(
      src.indexOf("ALLOWED_FORMATS") < src.indexOf("prisma.closetItem.create"),
      "format check precedes DB write"
    );
  });

  it("closet._index.tsx server action enforces file-size cap (Admin API serverBytes) before prisma.closetItem.create", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("SERVER_MAX_BYTES"), "defines SERVER_MAX_BYTES server-side limit");
    assert.ok(src.includes("serverBytes"), "uses serverBytes from Admin API, not client form data");
    assert.ok(
      src.indexOf("SERVER_MAX_BYTES") < src.indexOf("prisma.closetItem.create"),
      "size check precedes DB write"
    );
  });

  it("closet._index.tsx server action enforces dimension bounds (Admin API serverWidth/serverHeight) before prisma.closetItem.create", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("serverWidth"), "uses serverWidth from Admin API, not client form data");
    assert.ok(src.includes("serverHeight"), "uses serverHeight from Admin API, not client form data");
    const dimCheck = src.includes("MIN_DIM") && src.includes("MAX_DIM");
    assert.ok(dimCheck, "defines both MIN_DIM and MAX_DIM server-side constants");
    assert.ok(
      src.indexOf("MIN_DIM") < src.indexOf("prisma.closetItem.create"),
      "dimension check precedes DB write"
    );
  });

  it("closet._index.tsx server action fetches first 12 bytes via buildPrivateDownloadUrl for magic-byte check", () => {
    const src = route("closet._index.tsx");
    assert.ok(src.includes("buildPrivateDownloadUrl"), "uses buildPrivateDownloadUrl for server-side download");
    assert.ok(src.includes("bytes=0-11"), "requests only first 12 bytes via Range header");
    assert.ok(src.includes("detectImageFormatFromBytes"), "checks server-fetched magic bytes");
    assert.ok(
      src.indexOf("buildPrivateDownloadUrl") < src.indexOf("prisma.closetItem.create"),
      "server magic-byte fetch precedes DB write"
    );
  });

  it("closet._index.tsx server validation failures return 400 — rejected uploads never create DB records", () => {
    const src = route("closet._index.tsx");
    const status400Count = (src.match(/status: 400/g) ?? []).length;
    assert.ok(
      status400Count >= 8,
      `expected at least 8 server-side 400 rejections (hostname, publicId, ownership, Admin API, format, size, dimensions, magic bytes); found ${status400Count}`
    );
  });
});
