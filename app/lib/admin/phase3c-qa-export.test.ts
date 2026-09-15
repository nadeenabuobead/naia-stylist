// app/lib/admin/phase3c-qa-export.test.ts
//
// Tests for Phase 3C V1 QA Export server module.
//
// Sections:
//   §P3CX-01  Auth — unauthenticated requests redirect to /admin/login
//   §P3CX-02  Export shape — HTML and JSON include required fields
//   §P3CX-03  No database writes — only reads performed
//   §P3CX-04  Effective classification — admin overrides applied, not raw values
//   §P3CX-05  Customer anonymisation — labels only, no emails or raw IDs in output
//   §P3CX-06  Images — embedded as data URIs when Cloudinary succeeds
//   §P3CX-07  Intentions — all 12 intentions present for every item
//   §P3CX-08  StyleMe isolation — Phase 3C module not imported from StyleMe paths
//
// Run: node --test --import tsx/esm app/lib/admin/phase3c-qa-export.test.ts

process.env.INTERNAL_ADMIN_COOKIE_SECRET = "test-cookie-secret-32chars-abcdefg";
process.env.INTERNAL_ADMIN_SECRET = "correct-test-password-for-unit-tests";
process.env.INTERNAL_ADMIN_IDENTITY_EMAIL = "nadeenabuobead@gmail.com";
process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { requireAdminSession } from "~/lib/internal-auth.server";
import { generatePhase3CQAExport } from "~/lib/admin/phase3c-qa-export.server";
import { ALL_INTENTIONS } from "~/lib/admin/garment-intelligence-v1.server";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BASE_ITEM = {
  id: "item-001",
  name: "Navy Blazer",
  category: "OUTERWEAR",
  subcategory: "Blazer",
  customerId: "cust-aaa",
  imagePublicId: "naia-wardrobe/cust-aaa/item-001",
  imageFormat: "jpg",
  thumbnailUrl: null,
  silhouette: "tailored",
  fitProfile: "slim",
  hemLength: null,
  topLength: null,
  waistShape: null,
  sleeveLength: "long",
  necklineCoverage: null,
  shoulderCoverage: null,
  midriffExposed: null,
  material: null,
  pattern: "solid",
  primaryColor: "navy",
  colors: ["navy"],
  occasions: ["work", "formal"],
  seasons: ["autumn", "winter"],
  formality: "formal",
  stylePersonality: "classic",
  styleTags: ["power-dressing", "structured"],
  garmentRelationships: [],
  adminReview: null,
};

const ITEM_WITH_OVERRIDE = {
  ...BASE_ITEM,
  id: "item-002",
  name: "Floral Dress (overridden)",
  category: "DRESSES",
  customerId: "cust-bbb",
  material: "cotton",         // ← raw value
  pattern: "solid",           // ← raw value, will be overridden to "floral"
  adminReview: {
    reviewStatus: "overridden",
    overrides: {
      pattern: "floral",      // ← admin override
      formality: "casual",    // ← admin override
    },
  },
};

const PASSPORT_A: {
  customerId: string;
  stylePersonalities: string[];
  favoriteColors: string[];
  coveragePreferences: string[];
  dressingPreferences: string[];
} = {
  customerId: "cust-aaa",
  stylePersonalities: ["minimal", "classic"],
  favoriteColors: ["navy", "white", "grey"],
  coveragePreferences: ["covered-shoulders"],
  dressingPreferences: ["structured"],
};

function makeMockPrisma(items: typeof BASE_ITEM[], profiles = [PASSPORT_A]): PrismaClient {
  return {
    closetItem: {
      findMany: async () => items,
    },
    onboardingProfile: {
      findMany: async () => profiles,
    },
  } as unknown as PrismaClient;
}

function makeMockFetch(succeed = true, mime = "image/jpeg"): typeof fetch {
  return async () => {
    if (!succeed) return { ok: false } as Response;
    const bytes = Buffer.from("FAKEJPEG");
    return {
      ok: true,
      headers: { get: () => mime },
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response;
  };
}

function noImageFetch(): typeof fetch {
  return makeMockFetch(false);
}

// ── §P3CX-01 Auth ─────────────────────────────────────────────────────────────

describe("§P3CX-01 Auth — unauthenticated requests redirect to /admin/login", () => {
  it("requireAdminSession redirects unauthenticated requests", async () => {
    const req = new Request("http://localhost/admin/naia/phase3c-export");
    let redirected = false;
    try {
      await requireAdminSession(req);
    } catch (e) {
      if (e instanceof Response && e.status === 302) {
        const loc = e.headers.get("Location") ?? "";
        assert.ok(loc.includes("/admin/login"), `Redirect should go to /admin/login, got: ${loc}`);
        redirected = true;
      } else {
        throw e;
      }
    }
    assert.ok(redirected, "Should have redirected to /admin/login");
  });

  it("requireAdminSession passes with valid session cookie", async () => {
    const { createAdminSession } = await import("~/lib/internal-auth.server");
    const setCookie = await createAdminSession();
    const cookiePart = setCookie.split(";")[0];
    const req = new Request("http://localhost/admin/naia/phase3c-export", {
      headers: { Cookie: cookiePart },
    });
    const session = await requireAdminSession(req);
    assert.equal(session.authenticated, true);
  });
});

// ── §P3CX-02 Export shape ────────────────────────────────────────────────────

describe("§P3CX-02 Export shape — HTML and JSON include required fields", () => {
  it("returns htmlContent and jsonContent strings", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    assert.equal(typeof result.htmlContent, "string");
    assert.equal(typeof result.jsonContent, "string");
    assert.ok(result.htmlContent.length > 0);
    assert.ok(result.jsonContent.length > 0);
  });

  it("HTML is a valid document with DOCTYPE", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    assert.ok(result.htmlContent.startsWith("<!DOCTYPE html>"), "Should start with DOCTYPE");
    assert.ok(result.htmlContent.includes("<title>Phase 3C V1 QA Export</title>"));
  });

  it("JSON parses successfully with required meta fields", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      meta: {
        shadowOnly: boolean;
        styleMeChanged: boolean;
        dbWritesPerformed: boolean;
        phase3cVersion: string;
      };
    };
    assert.equal(json.meta.shadowOnly, true);
    assert.equal(json.meta.styleMeChanged, false);
    assert.equal(json.meta.dbWritesPerformed, false);
    assert.equal(json.meta.phase3cVersion, "V1");
  });

  it("JSON items array has correct length", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM, ITEM_WITH_OVERRIDE]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as { items: unknown[] };
    assert.equal(json.items.length, 2);
  });

  it("HTML includes garment name from fixture", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    assert.ok(result.htmlContent.includes("Navy Blazer"), "Should contain garment name");
  });

  it("summary carries correct totalItems count", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM, ITEM_WITH_OVERRIDE]),
      _fetch: noImageFetch(),
    });
    assert.equal(result.summary.totalItems, 2);
  });
});

// ── §P3CX-03 No database writes ──────────────────────────────────────────────

describe("§P3CX-03 No database writes — only read operations called", () => {
  it("does not call any Prisma write methods", async () => {
    const writeCalls: string[] = [];
    const mockPrisma = {
      closetItem: {
        findMany: async () => [BASE_ITEM],
        create: () => { writeCalls.push("closetItem.create"); },
        update: () => { writeCalls.push("closetItem.update"); },
        delete: () => { writeCalls.push("closetItem.delete"); },
        upsert: () => { writeCalls.push("closetItem.upsert"); },
      },
      onboardingProfile: {
        findMany: async () => [PASSPORT_A],
        create: () => { writeCalls.push("onboardingProfile.create"); },
        update: () => { writeCalls.push("onboardingProfile.update"); },
      },
    } as unknown as PrismaClient;

    await generatePhase3CQAExport({
      _prisma: mockPrisma,
      _fetch: noImageFetch(),
    });

    assert.equal(
      writeCalls.length,
      0,
      `Expected no write calls, got: ${writeCalls.join(", ")}`,
    );
  });
});

// ── §P3CX-04 Effective classification ────────────────────────────────────────

describe("§P3CX-04 Effective classification — admin overrides applied", () => {
  it("uses admin-overridden pattern, not raw stored value", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([ITEM_WITH_OVERRIDE], []),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ effectiveClassification: Record<string, unknown> }>;
    };
    const item = json.items[0]!;
    assert.equal(
      item.effectiveClassification.pattern,
      "floral",
      "Should use admin-overridden pattern 'floral', not raw 'solid'",
    );
    assert.equal(
      item.effectiveClassification.formality,
      "casual",
      "Should use admin-overridden formality 'casual'",
    );
  });

  it("keeps non-overridden fields from original item", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([ITEM_WITH_OVERRIDE], []),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ effectiveClassification: Record<string, unknown> }>;
    };
    const cls = json.items[0]!.effectiveClassification;
    assert.equal(cls.material, "cotton", "Non-overridden material should stay as raw value");
  });

  it("item with no adminReview uses raw values unchanged", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM], []),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ effectiveClassification: Record<string, unknown> }>;
    };
    const cls = json.items[0]!.effectiveClassification;
    assert.equal(cls.pattern, "solid");
    assert.equal(cls.primaryColor, "navy");
  });
});

// ── §P3CX-05 Customer anonymisation ──────────────────────────────────────────

describe("§P3CX-05 Customer anonymisation — labels only, no raw IDs in output", () => {
  it("assigns Customer A / B labels by sorted customerId", async () => {
    const items = [
      { ...BASE_ITEM, id: "i1", customerId: "cust-aaa" },
      { ...BASE_ITEM, id: "i2", name: "Item 2", customerId: "cust-bbb" },
    ];
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma(items, []),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ customerLabel: string }>;
    };
    assert.equal(json.items[0]!.customerLabel, "Customer A");
    assert.equal(json.items[1]!.customerLabel, "Customer B");
  });

  it("JSON items do not include customer email fields", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<Record<string, unknown>>;
    };
    const item = json.items[0]!;
    assert.ok(!("customerEmail" in item), "Should not include customerEmail");
    assert.ok(!("email" in item), "Should not include email");
  });

  it("JSON items do not include raw customerId", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<Record<string, unknown>>;
    };
    const item = json.items[0]!;
    assert.ok(!("customerId" in item), "Should not expose customerId in exported items");
  });

  it("HTML does not contain raw customer IDs", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    assert.ok(
      !result.htmlContent.includes("cust-aaa"),
      "HTML should not contain raw customerId 'cust-aaa'",
    );
  });
});

// ── §P3CX-06 Image embedding ──────────────────────────────────────────────────

describe("§P3CX-06 Images — embedded as data URIs when fetch succeeds", () => {
  it("sets hasEmbeddedImage=true when mock fetch succeeds", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: makeMockFetch(true),
      _getCloudinaryConfig: () => ({
        cloudName: "testcloud",
        apiKey: "testkey",
        apiSecret: "testsecret",
      }),
      _nowFn: () => 1000000,
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ hasEmbeddedImage: boolean }>;
    };
    assert.equal(json.items[0]!.hasEmbeddedImage, true);
    assert.equal(result.summary.imagesEmbedded, 1);
  });

  it("sets hasEmbeddedImage=false when fetch fails", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ hasEmbeddedImage: boolean }>;
    };
    assert.equal(json.items[0]!.hasEmbeddedImage, false);
    assert.equal(result.summary.imagesEmbedded, 0);
  });

  it("HTML contains data: URI when image embedding succeeds", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: makeMockFetch(true),
      _getCloudinaryConfig: () => ({
        cloudName: "testcloud",
        apiKey: "testkey",
        apiSecret: "testsecret",
      }),
      _nowFn: () => 1000000,
    });
    assert.ok(
      result.htmlContent.includes("data:image/jpeg;base64,"),
      "HTML should embed image as base64 data URI",
    );
  });

  it("HTML contains placeholder when no image available", async () => {
    const itemNoImage = { ...BASE_ITEM, imagePublicId: null, thumbnailUrl: null };
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([itemNoImage]),
      _fetch: noImageFetch(),
    });
    assert.ok(
      result.htmlContent.includes("No image"),
      "HTML should show placeholder when no image",
    );
  });

  it("exported HTML does not contain expiring Cloudinary CDN URLs", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM]),
      _fetch: makeMockFetch(true),
      _getCloudinaryConfig: () => ({
        cloudName: "testcloud",
        apiKey: "testkey",
        apiSecret: "testsecret",
      }),
      _nowFn: () => 1000000,
    });
    assert.ok(
      !result.htmlContent.includes("res.cloudinary.com"),
      "HTML should not contain Cloudinary CDN URLs (should be embedded)",
    );
  });
});

// ── §P3CX-07 Intentions — all 12 present ─────────────────────────────────────

describe("§P3CX-07 Intentions — all 12 intention potentials present", () => {
  it("every exported item JSON has exactly 12 intention potentials", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM, ITEM_WITH_OVERRIDE], [PASSPORT_A]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ phase3c: { intentionPotentials: Array<{ intention: string; signals: string[] }> } }>;
    };
    for (const item of json.items) {
      assert.equal(
        item.phase3c.intentionPotentials.length,
        12,
        `Item should have 12 intentionPotentials, got ${item.phase3c.intentionPotentials.length}`,
      );
    }
  });

  it("all 12 known intentions appear in every item", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM], [PASSPORT_A]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ phase3c: { intentionPotentials: Array<{ intention: string }> } }>;
    };
    const intentionsInExport = json.items[0]!.phase3c.intentionPotentials.map(ip => ip.intention);
    for (const expected of ALL_INTENTIONS) {
      assert.ok(
        intentionsInExport.includes(expected),
        `Intention '${expected}' should appear in export`,
      );
    }
  });

  it("each intention potential has a signals array (may be empty)", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM], [PASSPORT_A]),
      _fetch: noImageFetch(),
    });
    const json = JSON.parse(result.jsonContent) as {
      items: Array<{ phase3c: { intentionPotentials: Array<{ signals: unknown }> } }>;
    };
    for (const ip of json.items[0]!.phase3c.intentionPotentials) {
      assert.ok(Array.isArray(ip.signals), "signals should be an array");
    }
  });

  it("HTML includes all 12 intention names", async () => {
    const result = await generatePhase3CQAExport({
      _prisma: makeMockPrisma([BASE_ITEM], [PASSPORT_A]),
      _fetch: noImageFetch(),
    });
    for (const intention of ALL_INTENTIONS) {
      assert.ok(
        result.htmlContent.includes(intention),
        `HTML should include intention '${intention}'`,
      );
    }
  });
});

// ── §P3CX-08 StyleMe isolation ────────────────────────────────────────────────

describe("§P3CX-08 StyleMe isolation — Phase 3C export not reachable from StyleMe", () => {
  it("phase3c-qa-export.server does not import from styleme paths", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./phase3c-qa-export.server.ts", import.meta.url),
      "utf-8",
    );
    const forbidden = ["styleme-recommendation", "styleme-result", "routes/style-me"];
    for (const pattern of forbidden) {
      assert.ok(
        !src.includes(pattern),
        `phase3c-qa-export.server.ts must not import from '${pattern}'`,
      );
    }
  });

  it("garment-intelligence-v1.server remains shadow-only (V1_SHADOW_ONLY = true)", async () => {
    const { V1_SHADOW_ONLY } = await import("~/lib/admin/garment-intelligence-v1.server");
    assert.equal(V1_SHADOW_ONLY, true);
  });
});
