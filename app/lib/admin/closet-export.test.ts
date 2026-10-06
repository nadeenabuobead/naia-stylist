// app/lib/admin/closet-export.test.ts
//
// Read-only Closet export, one customer at a time.
//
// It exists because re-reviewing occasionFit.active across a Closet needs the stored values
// together, and the StyleMe [nAia-*] diagnostics cannot supply them: they explain a single
// engine run, log intentionPotentials filtered to that run's own intention, and carry no
// customer identifier at all.
//
// The two properties that matter most here are SCOPE and FIDELITY. Scope, because an export
// that could reach another customer's Closet would be a data-leak shaped like a convenience
// feature. Fidelity, because the whole point is to read values before editing them — a
// filtered or renamed map would send the re-review after the wrong garments.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = "app/routes/admin.naia.customers.$customerId.closet-export.tsx";
const src = (): string => readFileSync(join(process.cwd(), ROUTE), "utf8");
const routes = (): string => readFileSync(join(process.cwd(), "app/routes.ts"), "utf8");
const page = (): string =>
  readFileSync(join(process.cwd(), "app/routes/admin.naia.customers.$customerId.tsx"), "utf8");

// ── CE-A: auth ────────────────────────────────────────────────────────────

describe("CE-A — unauthenticated access is rejected", () => {
  test("CE-A.1 the loader requires an admin session before anything else", () => {
    const s = src();
    assert.match(s, /import \{ requireAdminSession \} from "~\/lib\/internal-auth\.server";/);
    const loader = s.slice(s.indexOf("export async function loader"));
    const body = loader.slice(0, loader.indexOf("\n}"));
    const authAt = body.indexOf("await requireAdminSession(request)");
    const prismaAt = body.indexOf("prisma.");
    assert.ok(authAt > -1, "the loader must require an admin session");
    assert.ok(prismaAt === -1 || authAt < prismaAt,
      "auth must run before any database read, or an unauthenticated request touches data");
  });

  test("CE-A.2 it is nested under the admin tree, which also gates", () => {
    assert.match(routes(), /route\("customers\/:customerId\/closet-export", "routes\/admin\.naia\.customers\.\$customerId\.closet-export\.tsx"\)/);
    const r = routes();
    const adminBlock = r.slice(r.indexOf('route("admin"'), r.indexOf('route("api/track_event"'));
    assert.ok(adminBlock.includes("closet-export"), "must sit inside the admin route subtree");
  });
});

// ── CE-B: scope — one customer, never another ─────────────────────────────

describe("CE-B — one customer cannot export another", () => {
  test("CE-B.1 items are fetched scoped to the path customerId", () => {
    const s = src();
    assert.match(s, /const customerId = params\.customerId;/);
    assert.match(s, /prisma\.closetItem\.findMany\(\{\s*\n\s*where: \{ customerId \}/,
      "the item query must be scoped by customerId, not filtered after the fact");
  });

  test("CE-B.2 no query parameter can redirect the scope", () => {
    const s = src();
    assert.doesNotMatch(s, /searchParams/,
      "the customer must come from the path only — a query param would be a second, " +
      "weaker source of truth for whose data is returned");
  });

  test("CE-B.3 an unknown customer 404s rather than returning an empty export", () => {
    const s = src();
    assert.match(s, /if \(!customer\) \{\s*\n\s*return new Response\("Customer not found", \{ status: 404 \}\)/,
      "a bad id must not produce a plausible-looking empty Closet");
    assert.match(s, /if \(!customerId\)/, "a missing id must be refused too");
  });

  test("CE-B.4 the export states whose Closet it is, at both levels", () => {
    const s = src();
    assert.match(s, /customerId: customer\.id/);
    assert.match(s, /shopifyCustomerId: customer\.shopifyCustomerId/);
    // Repeated per item as well, so a row pasted out of context is still attributable.
    const itemsBlock = s.slice(s.indexOf("items: items.map("));
    assert.match(itemsBlock, /customerId: customer\.id/);
    assert.match(itemsBlock, /shopifyCustomerId: customer\.shopifyCustomerId/);
  });
});

// ── CE-C: fidelity — nothing filtered, nothing renamed ───────────────────

describe("CE-C — the stored maps are returned whole", () => {
  test("CE-C.1 occasionFit is passed through entire", () => {
    const s = src();
    assert.match(s, /occasionFit: i\.styleMeProfile\?\.occasionFit \?\? null/,
      "no key selection — the whole map, so nothing is lost");
    assert.doesNotMatch(s, /occasionFit\?\.\[/, "indexing a single key would filter the map");
    assert.doesNotMatch(s, /occasionFit\["?active/, "must not single out active");
  });

  test("CE-C.2 intentionPotentials is passed through entire", () => {
    const s = src();
    assert.match(s, /intentionPotentials: i\.styleMeProfile\?\.intentionPotentials \?\? null/);
    // The diagnostics' mistake was filtering to the session's own intention. Not here.
    for (const k of ["feel-elevated", "stand-out", "feel-fun", "feel-powerful", "give-energy"]) {
      assert.ok(!s.includes(`"${k}"`), `must not name individual intentions like ${k}`);
    }
  });

  test("CE-C.3 profileStatus travels with the maps", () => {
    // occasionFit/intentionPotentials are only StyleMe-authoritative when approved; without
    // this, an unapproved draft reads as live truth.
    assert.match(src(), /profileStatus: i\.styleMeProfile\?\.profileStatus \?\? null/);
  });

  test("CE-C.4 names and categories are stored values, not derived", () => {
    const s = src();
    assert.match(s, /itemName: i\.name \?\? null/);
    assert.match(s, /category: i\.category/);
    assert.match(s, /subcategory: i\.subcategory \?\? null/);
    assert.match(s, /occasions: i\.occasions/);
    assert.doesNotMatch(s, /toLowerCase\(\)\s*\.replace[\s\S]{0,40}itemName/, "no renaming");
  });
});

// ── CE-D: duplicates stay distinct ───────────────────────────────────────

describe("CE-D — same display name, separate records", () => {
  test("CE-D.1 one object per row, keyed by itemId, with no dedup step", () => {
    const s = src();
    assert.match(s, /items: items\.map\(/, "a 1:1 map over the rows");
    assert.match(s, /itemId: i\.id/);
    for (const collapsing of ["new Set(", "new Map(", "distinct:", "groupBy", "reduce("]) {
      assert.ok(!s.includes(collapsing),
        `${collapsing} could collapse two garments that share a name (this Closet has two ` +
        `"Beige Crew Neck Sweater" records)`);
    }
  });

  test("CE-D.2 itemCount is the raw row count", () => {
    assert.match(src(), /itemCount: items\.length/);
  });
});

// ── CE-E: read-only ──────────────────────────────────────────────────────

describe("CE-E — the route performs no mutations", () => {
  test("CE-E.1 no write operation appears anywhere in it", () => {
    const s = src();
    for (const w of ["create", "update", "upsert", "delete", "$executeRaw", "$transaction"]) {
      assert.ok(!s.includes(`prisma.closetItem.${w}`) && !s.includes(`prisma.customer.${w}`) && !s.includes(`prisma.${w}`),
        `${w} must not appear — this route reads only`);
    }
    assert.doesNotMatch(s, /\.(create|update|upsert|delete)(Many)?\(/, "no mutating client call");
  });

  test("CE-E.2 there is no action export, so a POST cannot reach it", () => {
    assert.doesNotMatch(src(), /export async function action/,
      "GET-only by construction, not by convention");
  });

  test("CE-E.3 only findUnique/findMany are used", () => {
    const calls = [...new Set((src().match(/prisma\.[a-zA-Z]+\.[a-zA-Z]+/g) ?? []))].sort();
    assert.deepEqual(calls, ["prisma.closetItem.findMany", "prisma.customer.findUnique"]);
  });

  test("CE-E.4 the response is a no-store JSON download", () => {
    const s = src();
    assert.match(s, /"Content-Type": "application\/json; charset=utf-8"/);
    assert.match(s, /"Cache-Control": "no-store"/, "customer data must not be cached");
    assert.match(s, /Content-Disposition.*attachment/);
  });
});

// ── CE-F: the admin entry point ──────────────────────────────────────────

describe("CE-F — reachable from the customer page without typing an id", () => {
  test("CE-F.1 the page links to the export for the customer it is showing", () => {
    const p = page();
    assert.match(p, /Export Closet JSON/);
    assert.match(p, /href=\{`\/admin\/naia\/customers\/\$\{customer\.id\}\/closet-export`\}/,
      "the id must come from the page's own customer, not from input");
  });
});
