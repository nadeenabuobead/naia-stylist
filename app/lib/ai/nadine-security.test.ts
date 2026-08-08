// app/lib/ai/nadine-security.test.ts
// Phase 4A4 — Focused security and privacy certification tests.
// Tests: origin validation, forged IDs, guest privacy, POST-only handoff,
//        extension block contract, and Closet isolation.
// Run: node --test --import tsx/esm app/lib/ai/nadine-security.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  resolveProductByGid,
  assessProduct,
  buildProductPageResponse,
  computeTryOnStatus,
} from "./nadine-product-assessment.ts";
import { LOCKED_CATALOGUE_HANDLES, VIRTUAL_TRY_ON_ENABLED } from "./naia-product-media.ts";
import type {
  CustomerAssessmentProfile,
  ClosetItemSummary,
} from "./nadine-product-assessment.types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_PRODUCT_ID = "10285940179076"; // collar-shirt — Becoming Real
const ALLOWED_ORIGIN = "https://naiabynadine.com";
const LOCKED_HANDLES = new Set<string>(LOCKED_CATALOGUE_HANDLES);

function makeProfile(overrides: Partial<CustomerAssessmentProfile> = {}): CustomerAssessmentProfile {
  return {
    stylePersonalities: ["corporate-chic"],
    desiredFeelings: ["more-elevated"],
    lifestyle: "professional",
    dressesFor: ["work"],
    favoriteColors: [],
    avoidColors: [],
    fitPreferences: [],
    comfortLevel: null,
    ...overrides,
  };
}

function makeClosetItem(overrides: Partial<ClosetItemSummary> = {}): ClosetItemSummary {
  return {
    id: "ci-001",
    name: "Black trouser",
    category: "bottom",
    colors: ["black"],
    styleTags: [],
    occasions: ["work"],
    ...overrides,
  };
}

// ── Extension block contract ──────────────────────────────────────────────────

const EXT_ROOT = path.resolve("extensions/naia-storefront");
const BLOCK_LIQUID = path.join(EXT_ROOT, "blocks/nadine-product-block.liquid");
const BLOCK_JS    = path.join(EXT_ROOT, "assets/naia-product-block.js");
const BLOCK_CSS   = path.join(EXT_ROOT, "assets/naia-product-block.css");

describe("§S1 extension block contract", () => {

  it("S01 — all three block files exist", () => {
    assert.ok(fs.existsSync(BLOCK_LIQUID), "Liquid block missing");
    assert.ok(fs.existsSync(BLOCK_JS),     "JS asset missing");
    assert.ok(fs.existsSync(BLOCK_CSS),    "CSS asset missing");
  });

  it("S02 — Liquid block embeds a valid JSON schema with correct target", () => {
    const liquid = fs.readFileSync(BLOCK_LIQUID, "utf8");
    const schemaMatch = liquid.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
    assert.ok(schemaMatch, "no {% schema %} block found");
    const schema = JSON.parse(schemaMatch[1].trim()); // throws if invalid JSON
    assert.equal(schema.target, "section", "target must be 'section'");
    assert.ok(typeof schema.name === "string" && schema.name.length > 0, "name required");
  });

  it("S03 — Liquid block passes product.id via data attribute (not product.title/handle)", () => {
    const liquid = fs.readFileSync(BLOCK_LIQUID, "utf8");
    assert.ok(liquid.includes("data-product-id="), "must pass product id as data-product-id");
    assert.ok(liquid.includes("product.id"), "must use Liquid product.id");
    // Must NOT use product.title or product.handle as the primary identity signal.
    assert.ok(!liquid.includes("data-product-title="), "must not pass product title as identity");
    assert.ok(!liquid.includes("data-product-handle="), "must not pass product handle as identity");
  });

  it("S04 — JS asset does not use script_tag filter (parser-blocking)", () => {
    const liquid = fs.readFileSync(BLOCK_LIQUID, "utf8");
    // script_tag filter produces synchronous blocking script elements.
    assert.ok(!liquid.includes("| script_tag"), "script_tag filter must not be used — use defer");
  });

  it("S05 — JS asset contains an XSS escaping function", () => {
    const js = fs.readFileSync(BLOCK_JS, "utf8");
    // The esc() function must escape at minimum &, <, >, " — all rendered into innerHTML.
    assert.ok(js.includes("&amp;"), "esc() must escape &");
    assert.ok(js.includes("&lt;"),  "esc() must escape <");
    assert.ok(js.includes("&gt;"),  "esc() must escape >");
    assert.ok(js.includes("&quot;"), "esc() must escape \"");
  });

  it("S06 — JS asset uses form POST for handoff, not window.location.href with GET", () => {
    const js = fs.readFileSync(BLOCK_JS, "utf8");
    assert.ok(js.includes('form.method = "POST"'), "handoff must use POST");
    assert.ok(js.includes("form.submit()"), "handoff must use form.submit()");
    // Must NOT navigate via GET.
    const getHandoffPattern = /window\.location\.href.*styleme-handoff/;
    assert.ok(!getHandoffPattern.test(js), "handoff must not use GET via window.location.href");
  });

  it("S07 — JS asset never calls FASHN API or prompts for photo uploads", () => {
    const js = fs.readFileSync(BLOCK_JS, "utf8");
    // No call to the FASHN API domain.
    assert.ok(!js.includes("fashn.ai"),         "must not call FASHN API");
    assert.ok(!js.includes("api.fashn.ai"),     "must not call FASHN API domain");
    // No photo or model upload prompts in client code.
    assert.ok(!js.toLowerCase().includes("selfie"), "must not reference selfie");
    assert.ok(!js.toLowerCase().includes("face photo"), "must not reference face photo");
    // No file input or FormData-based upload.
    assert.ok(!js.includes('type="file"'),      "must not create file input");
    assert.ok(!js.includes("FileReader"),       "must not use FileReader");
  });

});

// ── Origin validation (handoff route behaviour) ───────────────────────────────

describe("§S2 styleme-handoff origin and POST enforcement", () => {

  it("S08 — handoff route file exports action (POST), not loader (GET)", () => {
    // Import the route module and verify it exports action and not loader.
    // We test the module exports statically via the file content — the route
    // is framework-verified at build time; here we confirm the intent.
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.styleme-handoff.tsx"),
      "utf8",
    );
    assert.ok(routeFile.includes("export async function action"), "must export action (POST)");
    assert.ok(!routeFile.includes("export async function loader"), "must not export loader (GET)");
  });

  it("S09 — handoff route validates Origin header", () => {
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.styleme-handoff.tsx"),
      "utf8",
    );
    assert.ok(
      routeFile.includes("naiabynadine.com"),
      "allowed origin must be naiabynadine.com",
    );
    assert.ok(
      routeFile.includes('status: 403') || routeFile.includes("status:403"),
      "must return 403 for invalid origin",
    );
  });

  it("S10 — handoff handle is validated server-side against locked catalogue", () => {
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.styleme-handoff.tsx"),
      "utf8",
    );
    assert.ok(
      routeFile.includes("LOCKED_CATALOGUE_HANDLES") || routeFile.includes("VALID_HANDLES"),
      "must validate handle against locked catalogue",
    );
  });

  it("S11 — arbitrary handle cannot create an anchor (server validates against 11 locked handles)", () => {
    // The LOCKED_CATALOGUE_HANDLES set is the only source of truth.
    // A browser-supplied handle like 'admin-product' or '../../etc/passwd' is never accepted.
    const malicious = ["admin", "../../../etc/passwd", "'; DROP TABLE --", "double-top/../admin"];
    for (const attempt of malicious) {
      assert.ok(!LOCKED_HANDLES.has(attempt), `malicious handle '${attempt}' must not be in locked set`);
    }
    // All 11 locked handles are exactly those defined in LOCKED_CATALOGUE_HANDLES.
    assert.equal(LOCKED_HANDLES.size, 11, "exactly 11 locked handles");
  });

  it("S12 — no return-to URL param accepted (no open redirect)", () => {
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.styleme-handoff.tsx"),
      "utf8",
    );
    // The handoff always redirects to /style-me/mood — no dynamic return URL.
    assert.ok(!routeFile.includes("returnTo"), "must not accept returnTo param");
    assert.ok(!routeFile.includes("return_to"), "must not accept return_to param");
    assert.ok(routeFile.includes('"/style-me/mood"'), "redirect must be hardcoded to /style-me/mood");
  });

});

// ── Customer identity and Closet privacy ──────────────────────────────────────

describe("§S3 customer identity and Closet privacy", () => {

  it("S13 — product identity is derived from Shopify numeric GID, not browser title/handle", () => {
    // Resolve via numeric ID (Liquid product.id) — correct path.
    const resolved = resolveProductByGid(VALID_PRODUCT_ID);
    assert.ok(resolved, "must resolve by numeric ID");
    assert.equal(resolved.v8Handle, "collar-shirt");

    // Passing a string that looks like a handle instead of a numeric ID → null.
    assert.equal(resolveProductByGid("collar-shirt"), null, "handle string must not resolve");
    assert.equal(resolveProductByGid("art-collar-layered-shirt"), null, "Shopify handle must not resolve");
  });

  it("S14 — guest request produces null assessment and null compatibility count", () => {
    const response = buildProductPageResponse(VALID_PRODUCT_ID, null, [], false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      assert.equal(response.assessment, null, "guests must get null assessment");
      assert.equal(response.wardrobeCompatibilityCount, null, "guests must get null count");
    }
  });

  it("S15 — guest response contains no profile or Closet data", () => {
    const response = buildProductPageResponse(VALID_PRODUCT_ID, null, [], false);
    const json = JSON.stringify(response);
    // No evidence of profile fields in guest response.
    assert.ok(!json.includes("stylePersonalities"), "must not leak profile fields");
    assert.ok(!json.includes("avoidColors"),       "must not leak avoid colors");
    assert.ok(!json.includes("closetItems"),       "must not leak raw closet data");
  });

  it("S16 — Closet evidence is customer-isolated: different profiles yield different verdicts", () => {
    // Customer A: avoids the product's color → not-best-addition.
    const profileA = makeProfile({ avoidColors: ["Cream"] });
    const rA = assessProduct(
      {
        v8Handle: "collar-shirt", nadinaTitle: "Becoming Real", shopifyHandle: null,
        itemType: "TOP", colors: ["Cream", "beige"], formalityScore: 3,
        formalityDescription: "Smart casual", stylingRole: "Anchor", occasionTags: ["work"],
        notIdealFor: "", desiredFeelingMatch: ["more-elevated"], stylePersonalityMatch: ["corporate-chic"],
        colorDirection: "", coverageModesty: "", bodyFitLogic: "",
        avoidPairingWithNadinePieces: null, mediaEligibility: "ready", hasVerifiedMedia: true,
      },
      profileA,
      [],
    );
    // Customer B: no avoid colors → better verdict.
    const profileB = makeProfile({ avoidColors: [], stylePersonalities: ["corporate-chic"], dressesFor: ["work"] });
    const rB = assessProduct(
      {
        v8Handle: "collar-shirt", nadinaTitle: "Becoming Real", shopifyHandle: null,
        itemType: "TOP", colors: ["Cream", "beige"], formalityScore: 3,
        formalityDescription: "Smart casual", stylingRole: "Anchor", occasionTags: ["work"],
        notIdealFor: "", desiredFeelingMatch: ["more-elevated"], stylePersonalityMatch: ["corporate-chic"],
        colorDirection: "", coverageModesty: "", bodyFitLogic: "",
        avoidPairingWithNadinePieces: null, mediaEligibility: "ready", hasVerifiedMedia: true,
      },
      profileB,
      [],
    );
    assert.equal(rA.verdict, "not-best-addition");
    assert.notEqual(rA.verdict, rB.verdict, "profiles must produce isolated verdicts");
  });

  it("S17 — forged numeric product ID does not resolve", () => {
    // A browser cannot override the product GID — the Liquid template emits product.id.
    // Even if JS were tampered with, the server validates against the locked GID map.
    assert.equal(resolveProductByGid("1"), null, "fake id 1 must not resolve");
    assert.equal(resolveProductByGid("0"), null, "fake id 0 must not resolve");
    assert.equal(resolveProductByGid("99999999999999"), null, "made-up large id must not resolve");
  });

  it("S18 — raw Shopify GIDs are not present in the client response", () => {
    const response = buildProductPageResponse(VALID_PRODUCT_ID, makeProfile(), [], false);
    const json = JSON.stringify(response);
    assert.ok(!json.includes("gid://shopify/Product/"),   "product GID must not be in response");
    assert.ok(!json.includes("gid://shopify/MediaImage/"), "media GID must not be in response");
  });

  it("S19 — authenticated customer with no Closet gets assessment with zero compatibility", () => {
    const response = buildProductPageResponse(VALID_PRODUCT_ID, makeProfile(), [], false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      assert.ok(response.assessment !== null, "authenticated profile should yield assessment");
      assert.equal(response.wardrobeCompatibilityCount, 0);
    }
  });

  it("S20 — authenticated customer with Closet item gets non-zero compatibility count", () => {
    const closet = [makeClosetItem({ category: "bottom" })];
    const response = buildProductPageResponse(VALID_PRODUCT_ID, makeProfile(), closet, false);
    assert.equal(response.resolved, true);
    if (response.resolved) {
      assert.ok(
        response.wardrobeCompatibilityCount !== null &&
        response.wardrobeCompatibilityCount > 0,
        "should count compatible bottom as compatible with collar-shirt (TOP)",
      );
    }
  });

});

// ── Proxy auth route contract ─────────────────────────────────────────────────
// Updated from §S4 (JWT Bearer + CORS) to proxy-HMAC after Phase 4A4 identity correction.
// Requests now arrive via the Shopify app proxy (same-origin); CORS headers are absent.

describe("§S4 proxy auth and route contract", () => {

  it("S21 — intelligence route uses proxy HMAC auth, not JWT Bearer session helper", () => {
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.nadine-product-intelligence.tsx"),
      "utf8",
    );
    // Must import authenticate from shopify.server (provides appProxy HMAC validation).
    assert.ok(
      routeFile.includes("authenticate"),
      "must use authenticate (proxy HMAC)",
    );
    // Must not import the JWT-based helper or the SameSite:Lax session helper.
    assert.ok(
      !routeFile.includes('import { authenticateCustomer }'),
      "must not import authenticateCustomer (JWT Bearer replaced by proxy HMAC)",
    );
    assert.ok(
      !routeFile.includes('import { getCurrentNaiaCustomer }'),
      "must not import getCurrentNaiaCustomer (SameSite:Lax blocks __naia_tok in cross-origin fetch)",
    );
  });

  it("S22 — no CORS headers — requests arrive via proxy (same-origin)", () => {
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.nadine-product-intelligence.tsx"),
      "utf8",
    );
    // Proxy-routed requests are same-origin from the browser; CORS is not required.
    // No wildcard origin must be present.
    assert.ok(!routeFile.includes('"*"'), "must not use wildcard CORS origin");
    assert.ok(!routeFile.includes("'*'"), "must not use wildcard CORS origin");
    assert.ok(!routeFile.includes("CORS_HEADERS"), "must not define CORS_HEADERS");
    assert.ok(!routeFile.includes("Access-Control-Allow-Origin"), "must not set CORS origin header");
  });

  it("S23 — identity from proxy HMAC, not from Authorization header", () => {
    const routeFile = fs.readFileSync(
      path.resolve("app/routes/api.nadine-product-intelligence.tsx"),
      "utf8",
    );
    // Identity source is logged_in_customer_id from the proxy-validated URL params.
    assert.ok(
      routeFile.includes("authenticate.public.appProxy"),
      "route must validate identity via authenticate.public.appProxy",
    );
    assert.ok(
      !routeFile.includes("Access-Control-Allow-Headers"),
      "proxy-gated route must not set CORS Allow-Headers",
    );
  });

  it("S24 — soldSeparately is always false on every component view", async () => {
    // Components cannot be purchased separately — this invariant must hold.
    const { getProductComponents } = await import("./nadine-product-assessment.ts");
    for (const handle of ["double-top", "dress-set"]) {
      const components = getProductComponents(handle);
      for (const c of components) {
        assert.equal(c.soldSeparately, false, `${c.componentHandle}.soldSeparately must be false`);
      }
    }
  });

  it("S25 — try-on gate is globally off: no state implies a live FASHN call", () => {
    assert.equal(VIRTUAL_TRY_ON_ENABLED, false, "global gate must be false");
    // Every possible TryOnState for the gate-off path.
    const states = ["coming-soon", "needs-testing", "no-model", "unavailable"] as const;
    for (const eligibility of ["ready", "needs-manual-review", "unsuitable-image"] as const) {
      const status = computeTryOnStatus(eligibility, true);
      assert.ok(states.includes(status.state as typeof states[number]),
        `state ${status.state} must be one of the inactive states`);
    }
  });

});
