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
import { Prisma } from "@prisma/client";
} from "./shopify-customer-name-sync.server.ts";

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

  it("the existing-customer path calls customer.update with the merged profile update, not a raw overwrite", () => {
    const updateIdx = callbackSrc.indexOf("prisma.customer.update(");
    assert.ok(updateIdx !== -1, "customer.update call present");
    const updateBlock = callbackSrc.slice(updateIdx, updateIdx + 150);
    assert.ok(updateBlock.includes("data: profileUpdate"), "update writes the resolved profileUpdate object, not raw Shopify fields");
  });

  it("profileUpdate is the merge of the resolved name and email updates", () => {
    assert.ok(
      callbackSrc.includes("const profileUpdate = { ...nameUpdate, ...emailUpdate };"),
      "profileUpdate merges nameUpdate and emailUpdate",
    );
  });

  it("the profile-sync update is skipped entirely when there is nothing to change", () => {
    const syncIdx = callbackSrc.indexOf("resolveNameUpdate(");
    const guardBlock = callbackSrc.slice(syncIdx, syncIdx + 600);
    assert.ok(
      guardBlock.includes("Object.keys(profileUpdate).length > 0"),
      "an empty profileUpdate never reaches prisma.customer.update",
    );
  });

  it("a failed profile-sync write does not fail the login", () => {
    const syncIdx = callbackSrc.indexOf("resolveNameUpdate(");
    const guardBlock = callbackSrc.slice(syncIdx, syncIdx + 1200);
    assert.ok(guardBlock.includes("catch (err) {"), "the update's failure is caught, not left to propagate");
    assert.ok(
      guardBlock.includes("Non-fatal — login must never fail over a profile-sync write"),
      "the catch is explicitly documented as non-fatal — login proceeds regardless",
    );
  });

  it("an email unique-constraint collision on sync retries with the name-only subset instead of failing login", () => {
    const syncIdx = callbackSrc.indexOf("resolveNameUpdate(");
    const guardBlock = callbackSrc.slice(syncIdx, syncIdx + 1200);
    assert.ok(
      guardBlock.includes("isEmailUniqueConstraintViolation(err)"),
      "the retry is gated on the error's own meta.target confirming an email collision, not inferred from the write shape alone",
    );
    assert.ok(guardBlock.includes('"email" in emailUpdate'), "the branch also checks that email was actually part of this write");
    assert.ok(guardBlock.includes("data: nameUpdate"), "the retry writes only the name subset, dropping the colliding email");
  });

  it("an unrelated P2002 on sync (not confirmed as an email collision) is never retried as one", () => {
    const syncIdx = callbackSrc.indexOf("resolveNameUpdate(");
    const guardBlock = callbackSrc.slice(syncIdx, syncIdx + 1200);
    // The retry condition is a conjunction starting with isEmailUniqueConstraintViolation(err) —
    // a plain `err.code === "P2002"` check alone no longer appears in this guard.
    assert.ok(
      !/err\s*instanceof\s*Prisma\.PrismaClientKnownRequestError\s*&&\s*\n?\s*err\.code\s*===\s*"P2002"/.test(guardBlock),
      "the sync-retry guard no longer reacts to a bare P2002 code without confirming the field",
    );
    assert.ok(
      /prisma\.customer\.create\(\{\s*data:\s*\{\s*shopifyCustomerId,\s*firstName: usableName\(shopifyProfile\.firstName\),\s*lastName:\s*usableName\(shopifyProfile\.lastName\),\s*\},/.test(rest),
      "the retry create call omits the email field entirely",
    );
  });

  it("a still-missing row after re-read that is NOT confirmed as an email collision fails loudly instead of guessing", () => {
    const createIdx = callbackSrc.indexOf("prisma.customer.create(");
    const rest = callbackSrc.slice(createIdx, createIdx + 1600);
    // The retry-without-email block is gated behind isEmailUniqueConstraintViolation(err);
    // when that's false, control falls straight to the existing `if (!customer) return fail(...)`
    // below it — there is no other branch that would otherwise resolve `customer`.
    const guardIdx = rest.indexOf("if (!customer && emailAtCreate && isEmailUniqueConstraintViolation(err)) {");
    assert.ok(guardIdx !== -1, "the explicit email-collision guard is present");
    const afterGuard = rest.slice(guardIdx);
    assert.ok(
      /\}\s*\n\s*if \(!customer\) return fail\(502, "Database error"\);/.test(afterGuard),
      "an unconfirmed collision (or no row) still reaches the generic Database error failure, never a silent success",
    );
  });
});

describe("isEmailUniqueConstraintViolation()", () => {
  it("a P2002 whose meta.target names email is recognised", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "6.19.2", meta: { target: ["email"] },
    });
    assert.equal(isEmailUniqueConstraintViolation(err), true);
  });

  it("a P2002 whose meta.target is a constraint-name STRING containing 'email' is recognised", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "6.19.2", meta: { target: "Customer_email_key" },
    });
    assert.equal(isEmailUniqueConstraintViolation(err), true);
  });

  it("a composite target that happens to include email among other fields is still recognised", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "6.19.2", meta: { target: ["shopifyCustomerId", "email"] },
    });
    assert.equal(isEmailUniqueConstraintViolation(err), true);
  });

  it("a P2002 on a DIFFERENT unique field (shopifyCustomerId) is NOT mistaken for an email collision", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "6.19.2", meta: { target: ["shopifyCustomerId"] },
    });
    assert.equal(isEmailUniqueConstraintViolation(err), false);
  });

  it("a P2002 on a differently-named constraint STRING is NOT mistaken for an email collision", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "6.19.2", meta: { target: "Customer_shopifyCustomerId_key" },
    });
    assert.equal(isEmailUniqueConstraintViolation(err), false);
  });

  it("a P2002 with no meta at all is NOT assumed to be an email collision", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "6.19.2",
    });
    assert.equal(isEmailUniqueConstraintViolation(err), false);
  });

  it("a different Prisma error code (not P2002) is never treated as any kind of unique collision", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025", clientVersion: "6.19.2", meta: { target: ["email"] },
    });
    assert.equal(isEmailUniqueConstraintViolation(err), false);
  });

  it("a plain (non-Prisma) Error is never treated as an email collision", () => {
    assert.equal(isEmailUniqueConstraintViolation(new Error("some other db error")), false);
  });

  it("a non-error value is never treated as an email collision", () => {
    assert.equal(isEmailUniqueConstraintViolation(null), false);
    assert.equal(isEmailUniqueConstraintViolation(undefined), false);
    assert.equal(isEmailUniqueConstraintViolation("P2002"), false);
  });
});

describe("shopify-customer-oauth.server.ts — the GraphQL lookup actually requests the name and email fields", () => {
  it("fetchCustomerProfile queries firstName, lastName, and emailAddress.emailAddress alongside id", () => {
    assert.ok(
      oauthSrc.includes("query CurrentCustomer { customer { id firstName lastName emailAddress { emailAddress } } }"),
      "GraphQL query requests id, firstName, lastName, and the nested emailAddress.emailAddress field",
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

  it("the profile's email falls back to null for any non-string response shape", () => {
    assert.ok(
      oauthSrc.includes('typeof rawEmail === "string" ? rawEmail : null'),
      "email defensively falls back to null",
    );
  });
});

describe("usableEmail()", () => {
  it("passes through a non-blank string", () => {
    assert.equal(usableEmail("nadeen@example.com"), "nadeen@example.com");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(usableEmail("  nadeen@example.com  "), "nadeen@example.com");
  });

  it("treats null as unusable", () => {
    assert.equal(usableEmail(null), null);
  });

  it("treats undefined as unusable", () => {
    assert.equal(usableEmail(undefined), null);
  });

  it("treats an empty string as unusable", () => {
    assert.equal(usableEmail(""), null);
  });

  it("treats a whitespace-only string as unusable", () => {
    assert.equal(usableEmail("   "), null);
  });
});

describe("resolveEmailUpdate() — new customer → Shopify email persisted", () => {
  it("a brand-new local record (email null) adopts Shopify's on-file email", () => {
    const update = resolveEmailUpdate("nadeen@example.com", null);
    assert.deepEqual(update, { email: "nadeen@example.com" });
  });
});

describe("resolveEmailUpdate() — existing customer with missing email → populated on next login", () => {
  it("local email was null — Shopify's value fills it in", () => {
    const update = resolveEmailUpdate("nadeen@example.com", null);
    assert.deepEqual(update, { email: "nadeen@example.com" });
  });
});

describe("resolveEmailUpdate() — existing customer → changed Shopify email updates locally", () => {
  it("Shopify's email changed since last sync — local value is updated to match", () => {
    const update = resolveEmailUpdate("nadine@example.com", "nadeen@example.com");
    assert.deepEqual(update, { email: "nadine@example.com" });
  });

  it("an already-matching value produces no update — no redundant write", () => {
    const update = resolveEmailUpdate("nadeen@example.com", "nadeen@example.com");
    assert.deepEqual(update, {});
  });
});

describe("resolveEmailUpdate() — Shopify null/blank → existing valid local email preserved (never overwritten)", () => {
  it("Shopify returns null — the existing local email is left alone, not cleared", () => {
    const update = resolveEmailUpdate(null, "nadeen@example.com");
    assert.deepEqual(update, {});
  });

  it("Shopify returns a blank string — the existing local email is left alone, not cleared", () => {
    const update = resolveEmailUpdate("   ", "nadeen@example.com");
    assert.deepEqual(update, {});
  });

  it("Shopify returns null, local email was already null — no update at all, not even a no-op write", () => {
    const update = resolveEmailUpdate(null, null);
    assert.deepEqual(update, {});
  });
});
