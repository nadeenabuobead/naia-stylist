// app/lib/shopify-customer-name-sync.test.ts
// Customer-name sync — causal proof for usableName() / resolveNameUpdate(),
// plus source-level proof that the OAuth callback actually wires this in for
// both the new-customer (create) and existing-customer (update) paths.
//
// Run: node --test --import tsx/esm app/lib/shopify-customer-name-sync.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { usableName, resolveNameUpdate } from "./shopify-customer-name-sync.server.ts";

const CALLBACK_PATH = resolve(import.meta.dirname, "../routes/auth.shopify.callback.tsx");
const callbackSrc = readFileSync(CALLBACK_PATH, "utf-8");

const OAUTH_PATH = resolve(import.meta.dirname, "shopify-customer-oauth.server.ts");
const oauthSrc = readFileSync(OAUTH_PATH, "utf-8");

describe("usableName()", () => {
  it("passes through a non-blank string", () => {
    assert.equal(usableName("Nadeen"), "Nadeen");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(usableName("  Nadeen  "), "Nadeen");
  });

  it("treats null as unusable", () => {
    assert.equal(usableName(null), null);
  });

  it("treats undefined as unusable", () => {
    assert.equal(usableName(undefined), null);
  });

  it("treats an empty string as unusable", () => {
    assert.equal(usableName(""), null);
  });

  it("treats a whitespace-only string as unusable", () => {
    assert.equal(usableName("   "), null);
  });
});

describe("resolveNameUpdate() — new customer → Shopify name persisted", () => {
  it("a brand-new local record (both fields null) adopts Shopify's name in full", () => {
    const update = resolveNameUpdate(
      { firstName: "Nadeen", lastName: "Abu Obead" },
      { firstName: null, lastName: null },
    );
    assert.deepEqual(update, { firstName: "Nadeen", lastName: "Abu Obead" });
  });
});

describe("resolveNameUpdate() — existing customer with null name → populated on next login", () => {
  it("firstName only was missing locally — Shopify's value fills it in", () => {
    const update = resolveNameUpdate(
      { firstName: "Nadeen", lastName: "Abu Obead" },
      { firstName: null, lastName: "Abu Obead" },
    );
    assert.deepEqual(update, { firstName: "Nadeen" });
  });

  it("both fields were missing locally — both get filled in on this login", () => {
    const update = resolveNameUpdate(
      { firstName: "Nadeen", lastName: "Abu Obead" },
      { firstName: null, lastName: null },
    );
    assert.deepEqual(update, { firstName: "Nadeen", lastName: "Abu Obead" });
  });
});

describe("resolveNameUpdate() — existing customer → changed Shopify name updates locally", () => {
  it("Shopify's firstName changed since last sync — local value is updated to match", () => {
    const update = resolveNameUpdate(
      { firstName: "Nadine", lastName: "Abu Obead" },
      { firstName: "Nadeen", lastName: "Abu Obead" },
    );
    assert.deepEqual(update, { firstName: "Nadine" });
  });

  it("an already-matching value produces no update — no redundant write", () => {
    const update = resolveNameUpdate(
      { firstName: "Nadeen", lastName: "Abu Obead" },
      { firstName: "Nadeen", lastName: "Abu Obead" },
    );
    assert.deepEqual(update, {});
  });
});

describe("resolveNameUpdate() — Shopify null/blank → existing usable local name preserved", () => {
  it("Shopify returns null for firstName — the existing local firstName is left alone", () => {
    const update = resolveNameUpdate(
      { firstName: null, lastName: "Abu Obead" },
      { firstName: "Nadeen", lastName: "Abu Obead" },
    );
    assert.deepEqual(update, {});
  });

  it("Shopify returns a blank string for lastName — the existing local lastName is left alone", () => {
    const update = resolveNameUpdate(
      { firstName: "Nadeen", lastName: "   " },
      { firstName: "Nadeen", lastName: "Abu Obead" },
    );
    assert.deepEqual(update, {});
  });

  it("Shopify returns null for both, local already has both — no update at all, not even a no-op write", () => {
    const update = resolveNameUpdate(
      { firstName: null, lastName: null },
      { firstName: "Nadeen", lastName: "Abu Obead" },
    );
    assert.deepEqual(update, {});
  });
});

// ── Wiring proof — the callback actually calls these on both paths ─────────

describe("auth.shopify.callback.tsx — name sync is actually wired in", () => {
  it("imports usableName and resolveNameUpdate from the name-sync module", () => {
    assert.ok(
      callbackSrc.includes('from "~/lib/shopify-customer-name-sync.server"'),
      "callback imports the name-sync module",
    );
    assert.ok(callbackSrc.includes("usableName"), "usableName is referenced");
    assert.ok(callbackSrc.includes("resolveNameUpdate"), "resolveNameUpdate is referenced");
  });

  it("the create (new customer) path writes firstName/lastName from the Shopify profile", () => {
    const createIdx = callbackSrc.indexOf("prisma.customer.create(");
    assert.ok(createIdx !== -1, "customer.create call present");
    const createBlock = callbackSrc.slice(createIdx, createIdx + 300);
    assert.ok(createBlock.includes("usableName(shopifyProfile.firstName)"), "create writes usable firstName");
    assert.ok(createBlock.includes("usableName(shopifyProfile.lastName)"), "create writes usable lastName");
  });

  it("the existing-customer path calls customer.update with the resolved name update, not a raw overwrite", () => {
    const updateIdx = callbackSrc.indexOf("prisma.customer.update(");
    assert.ok(updateIdx !== -1, "customer.update call present");
    const updateBlock = callbackSrc.slice(updateIdx, updateIdx + 150);
    assert.ok(updateBlock.includes("data: nameUpdate"), "update writes the resolved nameUpdate object, not raw Shopify fields");
  });

  it("the name-sync update is skipped entirely when there is nothing to change", () => {
    const syncIdx = callbackSrc.indexOf("resolveNameUpdate(");
    const guardBlock = callbackSrc.slice(syncIdx, syncIdx + 400);
    assert.ok(
      guardBlock.includes("Object.keys(nameUpdate).length > 0"),
      "an empty nameUpdate never reaches prisma.customer.update",
    );
  });

  it("a failed name-sync write does not fail the login", () => {
    const syncIdx = callbackSrc.indexOf("resolveNameUpdate(");
    const guardBlock = callbackSrc.slice(syncIdx, syncIdx + 400);
    assert.ok(
      /catch\s*{\s*\/\/[^}]*Non-fatal/.test(guardBlock),
      "the update is wrapped in a non-fatal catch — login proceeds regardless",
    );
  });

  it("no code path infers a name from the email address", () => {
    assert.ok(!callbackSrc.includes(".split(\"@\")"), "no email-splitting inference");
    assert.ok(!callbackSrc.includes("email.split"), "no email-splitting inference");
  });

  it("no hard-coded name literal is written to the Customer row", () => {
    const createIdx = callbackSrc.indexOf("prisma.customer.create(");
    const createBlock = callbackSrc.slice(createIdx, createIdx + 300);
    assert.ok(!/firstName:\s*"[A-Za-z]/.test(createBlock), "firstName is not a hard-coded string literal");
  });
});

describe("shopify-customer-oauth.server.ts — the GraphQL lookup actually requests the name fields", () => {
  it("fetchCustomerProfile queries firstName and lastName alongside id", () => {
    assert.ok(
      oauthSrc.includes("query CurrentCustomer { customer { id firstName lastName"),
      "GraphQL query requests id, firstName, and lastName",
    );
  });

  it("the profile's firstName/lastName fall back to null for any non-string response shape", () => {
    assert.ok(
      oauthSrc.includes('typeof rawFirstName === "string" ? rawFirstName : null'),
      "firstName defensively falls back to null",
    );
    assert.ok(
      oauthSrc.includes('typeof rawLastName === "string" ? rawLastName : null'),
      "lastName defensively falls back to null",
    );
  });
});
