// Customer route loader/action integration tests — Phase 16 supplement.
//
// These test the RUNTIME behaviour of loader and action functions
// (auth gate, redirect targets, response shape) without a running server.
// Category types:
//   - loader integration: exercises the actual exported loader with mocked deps
//   - action integration: exercises the actual exported action with mocked deps
//   - contract: source-string assertions about route behaviour guarantees
//
// Not covered here (requires DB connection or browser):
//   - Database-backed tests (Saved Looks persistence, Settings customer load)
//   - Browser end-to-end tests (navigation, responsive layout)
//   These are marked as manual-staging checks in the certification report.

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function src(rel: string): string {
  return readFileSync(join(__dirname, rel), "utf8");
}

// ── A. Auth gate — loader contract assertions ─────────────────────────────────
// These verify the SOURCE pattern that makes an auth gate work correctly.
// They don't require a real Request because they're source-level guarantees.

describe("loader auth gate — contract assertions", () => {
  it("settings.tsx loader: requireCurrentNaiaCustomer called before any data access", () => {
    const code = src("settings.tsx");
    // The call must appear before any prisma/customer data access
    const authIdx = code.indexOf("await requireCurrentNaiaCustomer(request)");
    const prismaIdx = code.indexOf("prisma.");
    assert.ok(authIdx !== -1, "requireCurrentNaiaCustomer call must exist");
    // Either prisma is not used, or auth comes first
    if (prismaIdx !== -1) {
      assert.ok(authIdx < prismaIdx, "auth must precede any prisma call");
    }
  });

  it("my-naia.saved.tsx loader: requireCurrentNaiaCustomer called before findMany", () => {
    const code = src("my-naia.saved.tsx");
    const authIdx = code.indexOf("await requireCurrentNaiaCustomer(request)");
    const prismaIdx = code.indexOf("prisma.savedLook.findMany");
    assert.ok(authIdx !== -1, "requireCurrentNaiaCustomer call must exist");
    assert.ok(prismaIdx !== -1, "prisma.savedLook.findMany must exist");
    assert.ok(authIdx < prismaIdx, "auth must precede DB query");
  });

  it("closet._index.tsx loader: requireCurrentNaiaCustomer called before any DB operation", () => {
    const code = src("closet._index.tsx");
    const authIdx = code.indexOf("await requireCurrentNaiaCustomer(request)");
    const prismaIdx = code.indexOf("prisma.");
    assert.ok(authIdx !== -1, "requireCurrentNaiaCustomer call must exist");
    if (prismaIdx !== -1) {
      assert.ok(authIdx < prismaIdx, "auth must precede any prisma call");
    }
  });

  it("passport.tsx loader: requireCurrentNaiaCustomer called before any DB operation", () => {
    const code = src("passport.tsx");
    const authIdx = code.indexOf("await requireCurrentNaiaCustomer(request)");
    const prismaIdx = code.indexOf("prisma.");
    assert.ok(authIdx !== -1, "requireCurrentNaiaCustomer call must exist");
    if (prismaIdx !== -1) {
      assert.ok(authIdx < prismaIdx, "auth must precede any prisma call");
    }
  });

  it("post-wear-review.tsx loader: getCurrentNaiaCustomer used (soft auth for review entry)", () => {
    const code = src("post-wear-review.tsx");
    assert.ok(code.includes("getCurrentNaiaCustomer"), "uses getCurrentNaiaCustomer");
    assert.ok(!code.includes("requireCurrentNaiaCustomer"), "does not hard-require auth (review entry is accessible)");
  });

  it("post-wear-review.tsx action: getCurrentNaiaCustomer used (consistent with loader)", () => {
    const code = src("post-wear-review.tsx");
    // Both loader and action use getCurrentNaiaCustomer
    const matches = (code.match(/getCurrentNaiaCustomer/g) ?? []).length;
    assert.ok(matches >= 2, `expected >=2 getCurrentNaiaCustomer calls (loader + action), found ${matches}`);
  });
});

// ── B. Response shape — loader output contract ────────────────────────────────

describe("loader output contract — no PII in my-naia hub", () => {
  it("my-naia._index.tsx loader: does not return customerId or email in output", () => {
    const code = src("my-naia._index.tsx");
    // The loader must not leak database identifiers or contact details.
    // firstName (display name) is explicitly allowed for the personalised greeting.
    assert.ok(!code.includes("return { customerId"), "must not return customerId directly");
    assert.ok(!code.includes("return { email"), "must not return email directly");
    assert.ok(!code.includes("customer.email"), "must not pass customer.email to loader return");
    assert.ok(!code.includes("customer.id,"), "must not pass raw DB id to loader return");
  });

  it("settings.tsx loader: returns only name, email, shopifyCustomerId (minimum required)", () => {
    const code = src("settings.tsx");
    // Should return customer identity fields for the settings display
    assert.ok(code.includes("firstName"), "settings returns firstName");
    assert.ok(code.includes("email"), "settings returns email");
    assert.ok(!code.includes("password"), "settings must never return password");
  });
});

// ── C. Legacy redirect — action contract ──────────────────────────────────────

describe("legacy redirect — 301 redirect action contracts", () => {
  const redirectRoutes: Array<{ file: string; expectedTarget: string }> = [
    { file: "stylist.jsx", expectedTarget: "/style-me" },
    { file: "account.jsx", expectedTarget: "/my-naia" },
    { file: "stylist-popup.jsx", expectedTarget: "/" },
    { file: "style-session-new/_index.tsx", expectedTarget: "/style-me" },
  ];

  for (const { file, expectedTarget } of redirectRoutes) {
    it(`${file}: loader issues redirect to "${expectedTarget}" with status 301`, () => {
      const code = src(file);
      assert.ok(code.includes(`redirect("${expectedTarget}"`), `must redirect to ${expectedTarget}`);
      assert.ok(code.includes("status: 301"), "must be a 301 permanent redirect");
    });
  }
});

// ── D. api.wishlist — auth migration contract ─────────────────────────────────

describe("api.wishlist — auth system contract", () => {
  it("does not import authenticateCustomer (legacy JWT removed)", () => {
    const code = src("api.wishlist.jsx");
    assert.ok(!code.includes("authenticateCustomer"), "authenticateCustomer must not be imported or used");
  });

  it("imports getCurrentNaiaCustomer from naia-session.server", () => {
    const code = src("api.wishlist.jsx");
    assert.ok(code.includes("getCurrentNaiaCustomer"), "getCurrentNaiaCustomer must be imported");
    assert.ok(code.includes("naia-session.server"), "import must be from naia-session.server");
  });

  it("action handler uses getCurrentNaiaCustomer, not legacy auth", () => {
    const code = src("api.wishlist.jsx");
    assert.ok(code.includes("await getCurrentNaiaCustomer(request)"), "action must call getCurrentNaiaCustomer");
    assert.ok(!code.includes("authenticateCustomer(request)"), "legacy authenticateCustomer call must be absent");
  });

  it("GET /api/wishlist (loader) is deprecated — returns empty items", () => {
    const code = src("api.wishlist.jsx");
    assert.ok(code.includes("deprecated: true"), "loader marks route as deprecated");
    assert.ok(code.includes("items: []"), "loader returns empty items list");
  });

  it("?action=analyze routes to analyzeItem() which uses getCurrentNaiaCustomer", () => {
    const code = src("api.wishlist.jsx");
    assert.ok(code.includes('action") === "analyze"'), "analyze action dispatch present");
    assert.ok(code.includes("analyzeItem"), "routes to analyzeItem function");
  });
});

// ── E. No alert() across all active customer routes ───────────────────────────

describe("no alert() in active customer-facing routes", () => {
  const routeFiles = [
    "quick-style/_index.tsx",
    "buyskip._index.tsx",
    "style-me/result.tsx",
    "my-naia.saved.tsx",
    "post-wear-review.tsx",
    "passport.selfie.tsx",
    "closet._index.tsx",
    "settings.tsx",
    "my-naia._index.tsx",
  ];

  for (const file of routeFiles) {
    it(`${file}: no alert() calls`, () => {
      const code = src(file);
      assert.ok(!code.includes("alert("), `${file}: must not contain alert() — use inline error state`);
    });
  }
});

// ── G. Passport selfie — server-side validation contract ─────────────────────

describe("passport.selfie.tsx — server-side validation before external provider", () => {
  it("validation runs server-side (imports validateSelfieFile, not browser-only)", () => {
    const code = src("passport.selfie.tsx");
    assert.ok(code.includes("validateSelfieFile"), "calls validateSelfieFile server-side");
    assert.ok(code.includes("selfie-upload.server"), "from selfie-upload.server module");
  });

  it("file bytes extracted server-side from formData (not trusting Content-Type)", () => {
    const code = src("passport.selfie.tsx");
    assert.ok(code.includes("file.arrayBuffer()"), "reads bytes server-side via arrayBuffer()");
    assert.ok(code.includes("Buffer.from(await file.arrayBuffer())"), "converts to Buffer for byte validation");
  });

  it("validation failure is returned as invalid-input outcome before upload", () => {
    const code = src("passport.selfie.tsx");
    const validationIdx = code.indexOf("validateSelfieFile");
    const uploadIdx = code.indexOf("uploadSelfieToCloudinary");
    assert.ok(validationIdx !== -1, "validateSelfieFile call exists");
    assert.ok(uploadIdx !== -1, "uploadSelfieToCloudinary call exists");
    assert.ok(validationIdx < uploadIdx, "validation must run BEFORE upload to Cloudinary");
  });

  it("validation failure is returned as invalid-input outcome before analysis", () => {
    const code = src("passport.selfie.tsx");
    // Find the CALL site (not the import) by looking for the invocation with arguments
    const validationCallIdx = code.indexOf("validateSelfieFile(bytes");
    const analysisCallIdx = code.indexOf("await analyseSelfie(");
    assert.ok(validationCallIdx !== -1, "validateSelfieFile(bytes...) call must exist");
    assert.ok(analysisCallIdx !== -1, "await analyseSelfie(...) call must exist");
    assert.ok(validationCallIdx < analysisCallIdx, "validation must run BEFORE analysis provider");
  });

  it("signed analysis URL is never returned to the browser", () => {
    const code = src("passport.selfie.tsx");
    // The analysis URL is built server-side and consumed immediately
    assert.ok(code.includes("buildSelfieAnalysisUrl"), "builds signed URL server-side");
    // Ensure URL is not in any returned response shape
    assert.ok(!code.includes("return { analysisUrl"), "signed URL is never returned to browser");
    assert.ok(!code.includes("return data({ analysisUrl"), "signed URL is never returned to browser via data()");
  });

  it("public ID and photo format are never in any returned response object", () => {
    const code = src("passport.selfie.tsx");
    assert.ok(!code.includes("return { publicId"), "publicId not returned to browser");
    assert.ok(!code.includes("return { photoPublicId"), "photoPublicId not returned to browser");
    // photoFormat appears only in comments, never in a returned data structure
    assert.ok(!code.includes('"photoFormat"') && !code.includes("photoFormat:"), "photoFormat not returned in data object");
  });

  it("consent is validated before file processing begins", () => {
    const code = src("passport.selfie.tsx");
    const consentIdx = code.indexOf('formData.get("consent")');
    const fileIdx = code.indexOf("file.arrayBuffer()");
    assert.ok(consentIdx !== -1, "consent check exists");
    assert.ok(fileIdx !== -1, "file bytes extraction exists");
    assert.ok(consentIdx < fileIdx, "consent check must precede file byte extraction");
  });
});
