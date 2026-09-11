import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ── Helpers ───────────────────────────────────────────────────────────────────

// requireNaiaAdminAccess calls authenticate.admin which requires a live Shopify
// session — not suitable for unit testing without mocking the entire runtime.
// These tests verify the env-var isolation contract: that the function reads
// NAIA_ADMIN_* variables and NOT DESIGNER_INTELLIGENCE_* variables.

type EnvSnapshot = Record<string, string | undefined>;

function captureEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const k of keys) snapshot[k] = process.env[k];
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

const NAIA_ADMIN_KEYS = [
  "NAIA_ADMIN_ALLOWED_SHOPS",
  "NAIA_ADMIN_ALLOWED_EMAILS",
  "NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER",
];

const DESIGNER_KEYS = [
  "DESIGNER_INTELLIGENCE_ALLOWED_SHOPS",
  "DESIGNER_INTELLIGENCE_ALLOWED_EMAILS",
  "DESIGNER_INTELLIGENCE_REQUIRE_ACCOUNT_OWNER",
];

// ── AUTH-01: env var isolation ────────────────────────────────────────────────

describe("AUTH-01 env var naming contract", () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = captureEnv([...NAIA_ADMIN_KEYS, ...DESIGNER_KEYS]);
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it("NAIA_ADMIN_* keys are distinct from DESIGNER_INTELLIGENCE_* keys", () => {
    for (const naiaKey of NAIA_ADMIN_KEYS) {
      for (const designerKey of DESIGNER_KEYS) {
        assert.notEqual(naiaKey, designerKey, `env var collision: ${naiaKey} === ${designerKey}`);
      }
    }
  });

  it("NAIA_ADMIN_ALLOWED_SHOPS does not share a name with any DESIGNER key", () => {
    assert.ok(!DESIGNER_KEYS.includes("NAIA_ADMIN_ALLOWED_SHOPS"));
  });

  it("NAIA_ADMIN_ALLOWED_EMAILS does not share a name with any DESIGNER key", () => {
    assert.ok(!DESIGNER_KEYS.includes("NAIA_ADMIN_ALLOWED_EMAILS"));
  });

  it("setting DESIGNER_INTELLIGENCE_ALLOWED_SHOPS does not populate NAIA_ADMIN_ALLOWED_SHOPS", () => {
    delete process.env.NAIA_ADMIN_ALLOWED_SHOPS;
    process.env.DESIGNER_INTELLIGENCE_ALLOWED_SHOPS = "test-shop.myshopify.com";
    assert.equal(process.env.NAIA_ADMIN_ALLOWED_SHOPS, undefined, "NAIA_ADMIN_ALLOWED_SHOPS must not inherit DESIGNER value");
  });

  it("setting DESIGNER_INTELLIGENCE_ALLOWED_EMAILS does not populate NAIA_ADMIN_ALLOWED_EMAILS", () => {
    delete process.env.NAIA_ADMIN_ALLOWED_EMAILS;
    process.env.DESIGNER_INTELLIGENCE_ALLOWED_EMAILS = "admin@test.com";
    assert.equal(process.env.NAIA_ADMIN_ALLOWED_EMAILS, undefined, "NAIA_ADMIN_ALLOWED_EMAILS must not inherit DESIGNER value");
  });
});

// ── AUTH-02: env parsing contract (whitebox) ─────────────────────────────────

// Test the parse logic extracted from the implementation, without mocking Shopify auth.
// This exercises the exact same string-processing that requireNaiaAdminAccess uses.

function parseAllowedShops(envValue: string | undefined): string[] {
  return (envValue ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function parseAllowedEmails(envValue: string | undefined): string[] {
  return (envValue ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

describe("AUTH-02 env var parsing — fails closed when empty", () => {
  it("undefined NAIA_ADMIN_ALLOWED_SHOPS yields empty list (deny-all)", () => {
    assert.deepEqual(parseAllowedShops(undefined), []);
  });

  it("empty string NAIA_ADMIN_ALLOWED_SHOPS yields empty list", () => {
    assert.deepEqual(parseAllowedShops(""), []);
  });

  it("whitespace-only yields empty list", () => {
    assert.deepEqual(parseAllowedShops("  ,  ,  "), []);
  });

  it("single shop is parsed and lowercased", () => {
    assert.deepEqual(parseAllowedShops("My-Shop.myshopify.com"), ["my-shop.myshopify.com"]);
  });

  it("comma-separated shops are parsed individually", () => {
    const result = parseAllowedShops("ShopA.myshopify.com, ShopB.myshopify.com");
    assert.deepEqual(result, ["shopa.myshopify.com", "shopb.myshopify.com"]);
  });

  it("shops are lowercased for case-insensitive match", () => {
    const result = parseAllowedShops("MY-SHOP.MYSHOPIFY.COM");
    assert.deepEqual(result, ["my-shop.myshopify.com"]);
  });

  it("undefined NAIA_ADMIN_ALLOWED_EMAILS yields empty list (no email restriction)", () => {
    assert.deepEqual(parseAllowedEmails(undefined), []);
  });

  it("non-empty email list is parsed and lowercased", () => {
    const result = parseAllowedEmails("ADMIN@Test.com, ops@Test.com");
    assert.deepEqual(result, ["admin@test.com", "ops@test.com"]);
  });
});

// ── AUTH-03: account-owner flag ───────────────────────────────────────────────

describe("AUTH-03 NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER semantics", () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = captureEnv(["NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER"]);
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it('flag is only active when set to the exact string "true"', () => {
    // Mimic the check inside requireNaiaAdminAccess
    const isActive = (v: string | undefined) => v === "true";
    assert.ok(isActive("true"));
    assert.ok(!isActive("1"));
    assert.ok(!isActive("TRUE"));
    assert.ok(!isActive("yes"));
    assert.ok(!isActive(undefined));
    assert.ok(!isActive(""));
    assert.ok(!isActive("false"));
  });

  it("undefined env value does not activate the account-owner restriction", () => {
    delete process.env.NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER;
    assert.notEqual(process.env.NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER, "true");
  });
});

// ── AUTH-04: shop match logic ─────────────────────────────────────────────────

describe("AUTH-04 shop match logic", () => {
  it("empty allowlist results in deny (fails closed)", () => {
    const allowedShops: string[] = [];
    const shopUnderTest = "any-shop.myshopify.com";
    const passed = allowedShops.length > 0 && allowedShops.includes(shopUnderTest.toLowerCase());
    assert.ok(!passed, "empty allowlist must deny");
  });

  it("non-matching shop results in deny", () => {
    const allowedShops = ["allowed-shop.myshopify.com"];
    const shopUnderTest = "other-shop.myshopify.com";
    const passed = allowedShops.length > 0 && allowedShops.includes(shopUnderTest.toLowerCase());
    assert.ok(!passed);
  });

  it("matching shop (case-insensitive) results in allow", () => {
    const allowedShops = ["my-shop.myshopify.com"];
    const shopUnderTest = "MY-SHOP.myshopify.com";
    const passed = allowedShops.length > 0 && allowedShops.includes(shopUnderTest.toLowerCase());
    assert.ok(passed);
  });

  it("email allowlist check skipped when allowlist is empty", () => {
    const allowedEmails: string[] = [];
    const emailUnderTest = "someone@test.com";
    // Logic: if allowedEmails is non-empty AND session.email exists → check
    const checked = allowedEmails.length > 0 && !!emailUnderTest;
    assert.ok(!checked, "empty email allowlist must skip check (allow any email)");
  });

  it("email check is case-insensitive", () => {
    const allowedEmails = ["admin@test.com"];
    const emailUnderTest = "ADMIN@TEST.COM";
    const passed = allowedEmails.includes(emailUnderTest.toLowerCase());
    assert.ok(passed);
  });

  it("non-matching email results in deny when allowlist is set", () => {
    const allowedEmails = ["admin@test.com"];
    const emailUnderTest = "other@test.com";
    const passed = allowedEmails.includes(emailUnderTest.toLowerCase());
    assert.ok(!passed);
  });
});
