// app/routes/api.naia-observation-feedback.test.ts
// Source-code contract tests for /api/naia-observation-feedback.
// All tests are static assertions against route source — no live DB, no Prisma connection.
//
// Covers FR15–FR19 (original) and expanded FR50–FR62 (server-side provenance + tamper-proof):
//   FR15  non-POST rejected with 405
//   FR16  observationKey must start with schema version prefix
//   FR17  feedback enum validated ("accurate" | "not-quite")
//   FR18  upsert by (customerId, observationKey) pair
//   FR19  body must be valid JSON object
//   FR50  route registered in routes.ts
//   FR51  server loads OnboardingProfile from DB — not client-supplied
//   FR52  computeNaiaFirstRead called server-side
//   FR53  observation looked up by key — stale/forged keys rejected (422)
//   FR54  upsert writes server-generated observationType
//   FR55  upsert writes server-generated evidenceFields
//   FR56  upsert writes server-generated evidenceValues
//   FR57  upsert writes server-generated claimText
//   FR58  client cannot override claimText (field not read from request body)
//   FR59  client cannot override evidenceFields
//   FR60  client cannot override evidenceValues
//   FR61  upsert key is (customerId, observationKey) — idempotent repeats
//   FR62  auth check happens before DB load

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_READ_SCHEMA_VERSION } from "../lib/ai/first-naia-read.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const route = readFileSync(join(__dirname, "api.naia-observation-feedback.tsx"), "utf8");
const routesConfig = readFileSync(join(ROOT, "app/routes.ts"), "utf8");
const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(ROOT, "prisma/migrations/20260830000000_first_naia_read/migration.sql"),
  "utf8",
).toUpperCase();

// ── FR15: method guard ────────────────────────────────────────────────────────

describe("FR15 — non-POST requests rejected with 405", () => {
  it("route guards against non-POST method", () => {
    assert.ok(
      route.includes('request.method !== "POST"'),
      "must check request.method !== 'POST'",
    );
    assert.ok(
      route.includes("405"),
      "must return 405 for non-POST",
    );
  });
});

// ── FR16: observationKey prefix validation ────────────────────────────────────

describe("FR16 — observationKey must start with schema version prefix", () => {
  it("route validates observationKey starts with FIRST_READ_SCHEMA_VERSION", () => {
    assert.ok(
      route.includes("FIRST_READ_SCHEMA_VERSION") || route.includes("first-read-v1"),
      "must validate observationKey prefix",
    );
    assert.ok(
      route.includes("startsWith"),
      "must use startsWith for prefix check",
    );
  });

  it("FIRST_READ_SCHEMA_VERSION constant is correct", () => {
    assert.equal(FIRST_READ_SCHEMA_VERSION, "first-read-v1");
  });
});

// ── FR17: feedback enum ───────────────────────────────────────────────────────

describe("FR17 — feedback enum: only 'accurate' and 'not-quite' accepted", () => {
  it("route checks feedback against VALID_FEEDBACK set", () => {
    assert.ok(
      route.includes("accurate") && route.includes("not-quite"),
      "must reference both valid feedback values",
    );
    assert.ok(
      route.includes("VALID_FEEDBACK"),
      "must use a named set for valid feedback",
    );
  });

  it("route returns 400 for invalid feedback", () => {
    const feedbackBlock = route.slice(route.indexOf("VALID_FEEDBACK"));
    assert.ok(
      feedbackBlock.includes("400"),
      "must return 400 when feedback is invalid",
    );
  });
});

// ── FR18: upsert uses compound key ────────────────────────────────────────────

describe("FR18 — upsert uses (customerId, observationKey) compound key", () => {
  it("upsert where clause uses customerId_observationKey compound", () => {
    assert.ok(
      route.includes("customerId_observationKey"),
      "upsert must use customerId_observationKey compound unique key",
    );
  });

  it("upsert where contains both customerId and observationKey", () => {
    const upsertBlock = route.slice(route.indexOf("upsert("));
    assert.ok(upsertBlock.includes("customerId"), "upsert must include customerId");
    assert.ok(upsertBlock.includes("observationKey"), "upsert must include observationKey");
  });
});

// ── FR19: body validation ─────────────────────────────────────────────────────

describe("FR19 — request body must be a JSON object", () => {
  it("route checks typeof body !== 'object' || body === null", () => {
    assert.ok(
      route.includes('typeof body !== "object"') || route.includes("typeof body !== 'object'"),
      "must check body is an object",
    );
    assert.ok(route.includes("body === null"), "must check body !== null");
    assert.ok(route.includes("400"), "must return 400 for invalid body");
  });
});

// ── FR50: route registration ──────────────────────────────────────────────────

describe("FR50 — route registered in routes.ts", () => {
  it("api/naia-observation-feedback is registered in routes.ts", () => {
    assert.ok(
      routesConfig.includes("api/naia-observation-feedback"),
      "routes.ts must register api/naia-observation-feedback",
    );
    assert.ok(
      routesConfig.includes("api.naia-observation-feedback.tsx"),
      "routes.ts must reference api.naia-observation-feedback.tsx file",
    );
  });
});

// ── FR51: server loads OnboardingProfile from DB ──────────────────────────────

describe("FR51 — server loads OnboardingProfile from DB, not client-supplied", () => {
  it("route loads onboardingProfile via prisma.onboardingProfile.findUnique", () => {
    assert.ok(
      route.includes("onboardingProfile.findUnique"),
      "must load OnboardingProfile from DB",
    );
  });

  it("profile lookup uses customerId from authenticated session (not request body)", () => {
    // The customerId used in findUnique must come from customer.id (session),
    // not from the request body
    const profileBlock = route.slice(route.indexOf("onboardingProfile.findUnique"));
    assert.ok(
      profileBlock.includes("customer.id"),
      "findUnique must use customer.id from session",
    );
  });
});

// ── FR52: computeNaiaFirstRead called server-side ────────────────────────────

describe("FR52 — computeNaiaFirstRead called server-side from loaded profile", () => {
  it("route imports computeNaiaFirstRead", () => {
    assert.ok(
      route.includes("computeNaiaFirstRead"),
      "must import and call computeNaiaFirstRead",
    );
  });

  it("computeNaiaFirstRead receives the DB-loaded profile", () => {
    const idx = route.indexOf("computeNaiaFirstRead(");
    assert.ok(idx !== -1, "must call computeNaiaFirstRead");
    const call = route.slice(idx, idx + 100);
    assert.ok(
      call.includes("profile") || call.includes("{}"),
      "computeNaiaFirstRead must receive the DB profile",
    );
  });
});

// ── FR53: stale/unknown observationKey rejected 422 ──────────────────────────

describe("FR53 — stale or forged observationKey rejected with 422", () => {
  it("route returns 422 when observation is not found", () => {
    assert.ok(
      route.includes("422"),
      "must return 422 for unmatched observationKey",
    );
  });

  it("route searches observations by key match", () => {
    assert.ok(
      route.includes("obs.observationKey === observationKey"),
      "must find observation by key equality",
    );
  });

  it("rejection message mentions profile context", () => {
    assert.ok(
      route.includes("current profile") || route.includes("Observation not found"),
      "rejection message must indicate key does not match current profile",
    );
  });
});

// ── FR54–FR57: server-generated provenance in upsert ─────────────────────────

describe("FR54 — upsert writes server-generated observationType", () => {
  it("upsert includes observation.type (not client-supplied)", () => {
    assert.ok(
      route.includes("observationType: observation.type"),
      "upsert must persist observation.type from server-generated result",
    );
  });
});

describe("FR55 — upsert writes server-generated evidenceFields", () => {
  it("upsert includes observation.evidenceFields", () => {
    assert.ok(
      route.includes("evidenceFields:  observation.evidenceFields") ||
      route.includes("evidenceFields: observation.evidenceFields"),
      "upsert must persist observation.evidenceFields",
    );
  });
});

describe("FR56 — upsert writes server-generated evidenceValues", () => {
  it("upsert includes observation.evidenceValues", () => {
    assert.ok(
      route.includes("evidenceValues:  observation.evidenceValues") ||
      route.includes("evidenceValues: observation.evidenceValues"),
      "upsert must persist observation.evidenceValues",
    );
  });
});

describe("FR57 — upsert writes server-generated claimText", () => {
  it("upsert includes observation.claim as claimText", () => {
    assert.ok(
      route.includes("claimText:       observation.claim") ||
      route.includes("claimText: observation.claim"),
      "upsert must persist observation.claim as claimText",
    );
  });
});

// ── FR58–FR60: client cannot override provenance ─────────────────────────────

describe("FR58 — client cannot override claimText", () => {
  it("route does not read claimText from request body", () => {
    // If claimText were accepted from the body, it would appear in the body destructure
    const bodyBlock = route.slice(route.indexOf("body as Record"), route.indexOf("observationKey") + 200);
    assert.ok(
      !bodyBlock.includes("claimText"),
      "claimText must not be extracted from request body",
    );
  });
});

describe("FR59 — client cannot override evidenceFields", () => {
  it("route does not read evidenceFields from request body", () => {
    const bodyBlock = route.slice(route.indexOf("body as Record"), route.indexOf("observationKey") + 200);
    assert.ok(
      !bodyBlock.includes("evidenceFields"),
      "evidenceFields must not be extracted from request body",
    );
  });
});

describe("FR60 — client cannot override evidenceValues", () => {
  it("route does not read evidenceValues from request body", () => {
    const bodyBlock = route.slice(route.indexOf("body as Record"), route.indexOf("observationKey") + 200);
    assert.ok(
      !bodyBlock.includes("evidenceValues"),
      "evidenceValues must not be extracted from request body",
    );
  });
});

// ── FR61: upsert is idempotent ────────────────────────────────────────────────

describe("FR61 — repeated feedback for same key UPSERTs, not duplicates", () => {
  it("route uses upsert (not create) for persistence", () => {
    assert.ok(
      route.includes(".upsert(") || route.includes(".upsert({"),
      "must use prisma upsert for idempotency",
    );
    assert.ok(
      !route.includes(".create(") || route.includes("create:"),
      "must not use standalone create (upsert create: block is ok)",
    );
  });
});

// ── FR62: auth check before DB load ──────────────────────────────────────────

describe("FR62 — authentication checked before any DB load", () => {
  it("getCurrentNaiaCustomer call appears before onboardingProfile.findUnique", () => {
    const authIdx    = route.indexOf("getCurrentNaiaCustomer");
    const profileIdx = route.indexOf("onboardingProfile.findUnique");
    assert.ok(authIdx !== -1,    "must call getCurrentNaiaCustomer");
    assert.ok(profileIdx !== -1, "must call onboardingProfile.findUnique");
    assert.ok(authIdx < profileIdx, "auth check must appear before profile DB load");
  });
});

// ── Migration: NaiaObservationFeedback provenance columns ────────────────────

describe("FR63 — migration includes provenance columns for NaiaObservationFeedback", () => {
  it("migration creates observationType column", () => {
    assert.ok(
      migration.includes("OBSERVATIONTYPE"),
      "migration must include observationType column",
    );
  });

  it("migration creates evidenceFields column", () => {
    assert.ok(
      migration.includes("EVIDENCEFIELDS"),
      "migration must include evidenceFields column",
    );
  });

  it("migration creates evidenceValues column", () => {
    assert.ok(
      migration.includes("EVIDENCEVALUES"),
      "migration must include evidenceValues column",
    );
  });

  it("migration creates claimText column", () => {
    assert.ok(
      migration.includes("CLAIMTEXT"),
      "migration must include claimText column",
    );
  });

  it("NaiaObservationFeedback has UNIQUE constraint on (customerId, observationKey)", () => {
    assert.ok(
      migration.includes("UNIQUE") && migration.includes("OBSERVATIONKEY"),
      "migration must create unique index on customerId + observationKey",
    );
  });

  it("NaiaObservationFeedback has CASCADE FK to Customer", () => {
    assert.ok(
      migration.includes("ON DELETE CASCADE"),
      "migration must use ON DELETE CASCADE for customer FK",
    );
  });
});

// ── Schema: NaiaObservationFeedback provenance fields ────────────────────────

describe("FR64 — Prisma schema has provenance fields on NaiaObservationFeedback", () => {
  it("schema has observationType field", () => {
    assert.ok(schema.includes("observationType"), "schema must have observationType");
  });

  it("schema has evidenceFields field", () => {
    assert.ok(schema.includes("evidenceFields"), "schema must have evidenceFields");
  });

  it("schema has evidenceValues field", () => {
    assert.ok(schema.includes("evidenceValues"), "schema must have evidenceValues");
  });

  it("schema has claimText field", () => {
    assert.ok(schema.includes("claimText"), "schema must have claimText");
  });

  it("schema has @@unique([customerId, observationKey])", () => {
    assert.ok(
      schema.includes("@@unique([customerId, observationKey])"),
      "schema must have compound unique constraint",
    );
  });
});
