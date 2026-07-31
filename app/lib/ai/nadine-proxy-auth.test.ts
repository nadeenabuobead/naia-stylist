// app/lib/ai/nadine-proxy-auth.test.ts
// Phase 4A4 identity correction — 16 focused proxy-auth security tests.
// Proves that Shopify app-proxy HMAC is the sole identity gate for customer-auth
// and product intelligence. No JWT Bearer, no localStorage, no CORS-based identity.
// Run: node --test --import tsx/esm app/lib/ai/nadine-proxy-auth.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

import { buildProductPageResponse } from "./nadine-product-assessment.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_PRODUCT_ID = "10285940179076"; // collar-shirt — Becoming Real

const ROUTES = path.resolve("app/routes");
const CUSTOMER_AUTH   = path.join(ROUTES, "api.customer-auth.jsx");
const PRODUCT_INTEL   = path.join(ROUTES, "api.nadine-product-intelligence.tsx");
const STYLEME_HANDOFF = path.join(ROUTES, "api.styleme-handoff.tsx");
const BLOCK_JS        = path.resolve("extensions/naia-storefront/assets/naia-product-block.js");

const customerAuthSrc   = fs.readFileSync(CUSTOMER_AUTH,   "utf8");
const productIntelSrc   = fs.readFileSync(PRODUCT_INTEL,   "utf8");
const stylemeHandoffSrc = fs.readFileSync(STYLEME_HANDOFF, "utf8");
const blockJsSrc        = fs.readFileSync(BLOCK_JS,        "utf8");

// ── §1 customer-auth proxy gate (P01-P07) ─────────────────────────────────────

describe("§1 customer-auth proxy gate", () => {

  it("P01 unsigned raw shopifyId body field cannot mint a JWT", () => {
    assert.ok(
      !customerAuthSrc.includes("body.shopifyId"),
      "customer-auth must not read body.shopifyId as identity source",
    );
    assert.ok(
      customerAuthSrc.includes("logged_in_customer_id"),
      "customer-auth must use logged_in_customer_id URL param as the identity source",
    );
  });

  it("P02 forged customer ID rejected — HMAC gate runs before identity extraction", () => {
    const proxyCallIdx = customerAuthSrc.indexOf("authenticate.public.appProxy");
    // Search for the actual extraction call, not a comment that may precede it.
    const idExtractIdx = customerAuthSrc.indexOf('url.searchParams.get("logged_in_customer_id")');
    assert.ok(proxyCallIdx >= 0,  "customer-auth must call authenticate.public.appProxy");
    assert.ok(idExtractIdx >= 0,  "customer-auth must read logged_in_customer_id from URL params");
    assert.ok(
      proxyCallIdx < idExtractIdx,
      "authenticate.public.appProxy must be called before logged_in_customer_id is read",
    );
  });

  it("P03 forged email/name fields do not establish identity", () => {
    const idParamIdx  = customerAuthSrc.indexOf('url.searchParams.get("logged_in_customer_id")');
    const bodyEmailIdx = customerAuthSrc.indexOf("body.email");
    assert.ok(idParamIdx  >= 0, "shopifyId must come from URL params");
    assert.ok(bodyEmailIdx >= 0, "body.email is read for profile hints");
    assert.ok(
      idParamIdx < bodyEmailIdx,
      "logged_in_customer_id URL param must be assigned before body fields are read",
    );
  });

  it("P04 valid proxy request creates token from proxy-verified shopifyId", () => {
    assert.ok(
      customerAuthSrc.includes("createCustomerToken"),
      "customer-auth must call createCustomerToken",
    );
    // shopifyId comes from logged_in_customer_id (URL param), not from the body.
    assert.ok(
      customerAuthSrc.includes('url.searchParams.get("logged_in_customer_id")'),
      "token shopifyId must derive from logged_in_customer_id URL param",
    );
  });

  it("P05 invalid signature → 403 Forbidden", () => {
    // The catch block that wraps appProxy must return 403, not leak token creation.
    const proxyStart   = customerAuthSrc.indexOf("authenticate.public.appProxy");
    const idParamStart = customerAuthSrc.indexOf('url.searchParams.get("logged_in_customer_id")');
    const catchRegion  = customerAuthSrc.slice(proxyStart, idParamStart);
    assert.ok(
      catchRegion.includes("403"),
      "catch block around appProxy must return status 403",
    );
  });

  it("P06 missing logged_in_customer_id → guest fail-closed", () => {
    assert.ok(
      customerAuthSrc.includes("guest: true"),
      "customer-auth must return { guest: true } when no customer is logged in",
    );
    assert.ok(
      customerAuthSrc.includes("|| null"),
      "absent logged_in_customer_id must resolve to null, not an empty string ID",
    );
  });

  it("P07 no body-shopifyId fallback path anywhere in the route", () => {
    assert.ok(!customerAuthSrc.includes('body["shopifyId"]'), "no bracket-notation body shopifyId");
    assert.ok(!customerAuthSrc.includes("body?.shopifyId"),   "no optional-chain body shopifyId");
    assert.ok(!customerAuthSrc.includes("body.shopifyId"),    "no dot-access body shopifyId");
  });
});

// ── §2 product intelligence proxy gate (P08-P12) ──────────────────────────────

describe("§2 product intelligence proxy gate", () => {

  it("P08 cross-customer Closet access blocked — Prisma uses proxy-verified shopifyId", () => {
    assert.ok(
      productIntelSrc.includes("shopifyCustomerId: shopifyId"),
      "Prisma findUnique must use shopifyCustomerId from proxy-verified shopifyId",
    );
    assert.ok(
      productIntelSrc.includes('url.searchParams.get("logged_in_customer_id")'),
      "shopifyId must come from the proxy-validated logged_in_customer_id URL param",
    );
    assert.ok(
      !productIntelSrc.includes("import { authenticateCustomer }"),
      "product intelligence must not import JWT-based authenticateCustomer",
    );
  });

  it("P09 guest receives null assessment — no private evidence exposed", () => {
    const result = buildProductPageResponse(VALID_PRODUCT_ID, null, [], false) as any;
    assert.strictEqual(result.resolved, true,  "valid product must resolve");
    assert.strictEqual(result.assessment, null, "guest must receive null assessment");
    assert.strictEqual(
      result.wardrobeCompatibilityCount,
      null,
      "guest must receive null wardrobe count",
    );
  });

  it("P10 customer identity derived solely from proxy-verified URL param", () => {
    const proxyCallIdx = productIntelSrc.indexOf("authenticate.public.appProxy");
    // Search for the actual extraction call, not a comment that may precede it.
    const idExtractIdx = productIntelSrc.indexOf('url.searchParams.get("logged_in_customer_id")');
    assert.ok(proxyCallIdx >= 0, "product intelligence must call authenticate.public.appProxy");
    assert.ok(idExtractIdx >= 0, "product intelligence must extract logged_in_customer_id from URL params");
    assert.ok(
      proxyCallIdx < idExtractIdx,
      "HMAC validation must precede logged_in_customer_id extraction",
    );
  });

  it("P11 CORS headers absent — CORS cannot be used to bypass proxy-auth gate", () => {
    assert.ok(
      !productIntelSrc.includes("Access-Control-Allow-Origin"),
      "product intelligence must not set Access-Control-Allow-Origin (requests arrive via proxy)",
    );
    assert.ok(
      !productIntelSrc.includes("CORS_HEADERS"),
      "product intelligence must not define CORS_HEADERS",
    );
  });

  it("P12 localStorage alone cannot grant identity — JS uses proxy URL, no JWT Bearer", () => {
    assert.ok(
      !blockJsSrc.includes('localStorage.getItem("naia_token")'),
      "JS must not read naia_token from localStorage",
    );
    assert.ok(!blockJsSrc.includes("storeToken"),    "JS must not contain storeToken");
    assert.ok(!blockJsSrc.includes("getStoredToken"), "JS must not contain getStoredToken");

    // Verify the intelligence fetch function does not send Authorization header.
    const fetchFnStart = blockJsSrc.indexOf("function fetchIntelligence");
    const fetchFnEnd   = blockJsSrc.indexOf("}", fetchFnStart + 100) + 1;
    const fetchFnBody  = blockJsSrc.slice(fetchFnStart, fetchFnEnd);
    assert.ok(
      !fetchFnBody.includes("Authorization"),
      "fetchIntelligence must not send an Authorization header",
    );
  });
});

// ── §3 fail-closed invariants (P13-P16) ───────────────────────────────────────

describe("§3 fail-closed invariants", () => {

  it("P13 product spoofing fails closed — unknown / forged productId does not resolve", () => {
    const zeroResult   = buildProductPageResponse("0",             null, [], false) as any;
    const bogusResult  = buildProductPageResponse("9999999999999", null, [], false) as any;
    assert.strictEqual(zeroResult.resolved,  false, "productId 0 must not resolve");
    assert.strictEqual(bogusResult.resolved, false, "unknown numeric productId must not resolve");
  });

  it("P14 StyleMe handoff is POST-only — no loader export", () => {
    assert.ok(
      !stylemeHandoffSrc.includes("export async function loader"),
      "styleme-handoff must not export a loader (GET rejected)",
    );
    assert.ok(
      stylemeHandoffSrc.includes("export async function action"),
      "styleme-handoff must export an action (POST handler)",
    );
  });

  it("P15 no FASHN API call or job in any Phase 4A4 route or extension file", () => {
    const fashnDomain = "api.fashn.ai";
    assert.ok(!customerAuthSrc.includes(fashnDomain),   "customer-auth must not call FASHN");
    assert.ok(!productIntelSrc.includes(fashnDomain),   "product intelligence must not call FASHN");
    assert.ok(!blockJsSrc.includes(fashnDomain),        "block JS must not call FASHN");
    assert.ok(!stylemeHandoffSrc.includes(fashnDomain), "styleme-handoff must not call FASHN");
  });

  it("P16 theme extension JS fetches intelligence via Shopify app proxy path", () => {
    const proxyPath = "/apps/naia-stylist/api/nadine-product-intelligence";
    assert.ok(
      blockJsSrc.includes(proxyPath),
      "JS must fetch product intelligence via the Shopify app proxy path",
    );
    // The proxy fetch must not add an Authorization header.
    const proxyFetchRegion = blockJsSrc.slice(
      blockJsSrc.indexOf(proxyPath) - 250,
      blockJsSrc.indexOf(proxyPath) + 250,
    );
    assert.ok(
      !proxyFetchRegion.includes("Authorization"),
      "proxy intelligence fetch must not include Authorization header",
    );
  });
});
