// app/routes/settings-coverage-gaps.test.ts
//
// Closes the specific gaps between settings.test.ts / settings-image-gaps.test.ts
// and the Settings & Privacy truthfulness/boundary/ownership checklist:
//
//   P. Design-research consent — real wiring, not a silent no-op
//   Q. No fake notification / marketing / AI-training controls
//   R. No fake delete-account button (mailto request is the only mechanism)
//   S. No provider/internal IDs leaked from the loader
//   T. Ownership — no customer-id route param or client-supplied override
//   U. Legal links degrade safely — no link to an unregistered route
//   V. Boundary — no import of another lane's engine/provider/billing code
//   W. Long values wrap instead of overflowing on narrow screens
//
// Same style as the existing suite: source-code string assertions,
// no DOM, no Prisma connection, no network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const settingsSrc = read("app/routes/settings.tsx");
const routesSrc   = read("app/routes.ts");
const cssSrc       = read("app/styles/naia-design-system.css");

// ── P. Design-research consent is genuinely wired ────────────────────────────

describe("P — design-research consent is real, not decorative", () => {
  it("VALID_INTENTS includes both consent intents", () => {
    assert.ok(settingsSrc.includes('"design-research-opt-in"'),  "opt-in intent present");
    assert.ok(settingsSrc.includes('"design-research-opt-out"'), "opt-out intent present");
  });

  it("action calls recordDesignResearchConsent with server-derived customer.id for both intents", () => {
    const actionIdx = settingsSrc.indexOf("export async function action");
    const actionBody = settingsSrc.slice(actionIdx);
    const optInIdx  = actionBody.indexOf('"design-research-opt-in"');
    const optOutIdx = actionBody.indexOf('"design-research-opt-out"');
    const optInBlock  = actionBody.slice(optInIdx,  optOutIdx);
    const optOutBlock = actionBody.slice(optOutIdx, actionBody.indexOf('"delete-selfie-photo"'));
    assert.ok(optInBlock.includes("recordDesignResearchConsent({ customerId: customer.id, granted: true })"),
      "opt-in calls recordDesignResearchConsent(granted: true) with the authenticated customer id");
    assert.ok(optOutBlock.includes("recordDesignResearchConsent({ customerId: customer.id, granted: false })"),
      "opt-out calls recordDesignResearchConsent(granted: false) with the authenticated customer id");
  });

  it("loader reads designResearchConsent behind a try/catch (safe if the column is unmigrated)", () => {
    const loaderIdx = settingsSrc.indexOf("export async function loader");
    const loaderBody = settingsSrc.slice(loaderIdx, settingsSrc.indexOf("export async function action"));
    const tryIdx   = loaderBody.indexOf("try {");
    const fieldIdx = loaderBody.indexOf("designResearchConsent: true");
    const catchIdx = loaderBody.indexOf("} catch");
    assert.ok(tryIdx > -1 && fieldIdx > tryIdx && catchIdx > fieldIdx,
      "designResearchConsent read happens inside a try block with a catch fallback");
  });

  it("consent toggle is reversible and is not grouped with the destructive confirmation modal", () => {
    const confirmIdx = settingsSrc.indexOf("const CONFIRM: Record<DestructiveIntent");
    const confirmBlock = settingsSrc.slice(confirmIdx, settingsSrc.indexOf("// ── Sub-components"));
    assert.ok(
      !confirmBlock.includes('"design-research-opt-in"') && !confirmBlock.includes('"design-research-opt-out"'),
      "design-research consent intents are not DestructiveIntent keys — they need no confirm dialog",
    );
  });

  it("the designResearchConsent DB field exists in the schema (not provisional)", () => {
    const schema = read("prisma/schema.prisma");
    assert.ok(schema.includes("designResearchConsent "), "field is declared in schema.prisma");
  });
});

// ── Q. No fake notification / marketing / AI-training controls ──────────────

describe("Q — no fabricated preference controls", () => {
  it("no notification preference toggle", () => {
    assert.ok(!settingsSrc.includes("Notification"), "no 'Notification' text in Settings");
  });

  it("no marketing preference toggle", () => {
    assert.ok(!/[Mm]arketing (email|preference|opt)/.test(settingsSrc), "no marketing preference wording");
  });

  it("the only real toggle is never framed as 'AI training'", () => {
    assert.ok(!/AI training|train(ing)? the AI|opt out of AI/i.test(settingsSrc),
      "design-research consent is not mislabeled as an AI-training opt-out");
  });

  it("no cookie or analytics consent control", () => {
    assert.ok(!/[Cc]ookie (preference|consent|setting)/.test(settingsSrc), "no cookie consent control");
  });

  it("no personalisation opt-out control (personalisation is informational only)", () => {
    const personalisationIdx = settingsSrc.indexOf("Personalisation");
    const personalisationSection = settingsSrc.slice(personalisationIdx, personalisationIdx + 800);
    assert.ok(!personalisationSection.includes("<button"), "Personalisation section has no button — informational only");
    assert.ok(!personalisationSection.includes("<Form"), "Personalisation section has no form — informational only");
  });
});

// ── R. No fake delete-account button ─────────────────────────────────────────

describe("R — account deletion is a request, not a destructive action", () => {
  it("VALID_INTENTS has no delete-account / delete-customer intent", () => {
    assert.ok(!settingsSrc.includes('"delete-account"'),  "no delete-account intent");
    assert.ok(!settingsSrc.includes('"delete-customer"'), "no delete-customer intent");
  });

  it("account deletion is a mailto link, never a <Form method=\"post\"> submit", () => {
    const dataSectionIdx = settingsSrc.indexOf("Your Data & Privacy");
    const optionalSectionIdx = settingsSrc.indexOf("Optional: helping NADINE design");
    const dataSection = settingsSrc.slice(dataSectionIdx, optionalSectionIdx);
    assert.ok(dataSection.includes("mailto:privacy@naiabynadine.com"), "deletion request uses mailto");
    assert.ok(!dataSection.includes("<Form"), "no <Form> element in the data/deletion section");
    assert.ok(!dataSection.includes("fetcher.submit"), "no fetcher.submit in the data/deletion section");
  });
});

// ── S. No provider/internal IDs leaked from the loader ───────────────────────

describe("S — loader never returns raw IDs or secrets", () => {
  it("loader return payload excludes customer.id, provider ids, and session/auth tokens", () => {
    const returnIdx = settingsSrc.indexOf("return data({");
    const actionIdx = settingsSrc.indexOf("export async function action");
    const returnBlock = settingsSrc.slice(returnIdx, actionIdx);
    for (const forbidden of [
      "customer.id", "shopifyCustomerId", "providerId", "sessionToken",
      "accessToken", "apiKey", "secret",
    ]) {
      assert.ok(!returnBlock.includes(forbidden), `loader return block excludes ${forbidden}`);
    }
  });
});

// ── T. Ownership — no client-suppliable customer identity ────────────────────

describe("T — ownership cannot be overridden by the browser", () => {
  it("the settings route path has no dynamic segment (no :id / $id / customerId param)", () => {
    const line = routesSrc.split("\n").find((l) => l.includes('route("settings"'));
    assert.ok(line, 'route("settings", ...) is registered');
    assert.ok(!/[:$]/.test(line as string), "settings route path carries no dynamic parameter");
  });

  it("loader never reads a customer id from the URL (params) or query string", () => {
    const loaderIdx = settingsSrc.indexOf("export async function loader");
    const loaderBody = settingsSrc.slice(loaderIdx, settingsSrc.indexOf("export async function action"));
    assert.ok(!loaderBody.includes("params."), "loader does not destructure route params");
    assert.ok(!loaderBody.includes("searchParams"), "loader does not read query string params");
  });

  it("action never accepts a client-supplied customer id under any field name", () => {
    const actionIdx = settingsSrc.indexOf("export async function action");
    const actionBody = settingsSrc.slice(actionIdx);
    for (const field of ["customerId", "customer_id", "userId", "ownerId"]) {
      assert.ok(!actionBody.includes(`formData.get("${field}")`), `action ignores client-supplied ${field}`);
    }
  });
});

// ── U. Legal links degrade safely ─────────────────────────────────────────────

describe("U — legal links never point at an unregistered route", () => {
  it("settings.tsx does not link to /privacy or /terms (no such route is registered)", () => {
    assert.ok(!routesSrc.includes('route("privacy"') && !routesSrc.includes('route("terms"'),
      "precondition: no Privacy Policy or Terms route exists yet");
    assert.ok(!settingsSrc.includes('to="/privacy"') && !settingsSrc.includes('href="/privacy"'),
      "no dead link to an unregistered /privacy route");
    assert.ok(!settingsSrc.includes('to="/terms"') && !settingsSrc.includes('href="/terms"'),
      "no dead link to an unregistered /terms route");
  });

  it("Your Data & Privacy section names the Privacy Policy by reference, not by forged link", () => {
    assert.ok(settingsSrc.includes("Privacy Policy"), "mentions the Privacy Policy");
    const idx = settingsSrc.indexOf("in accordance with our Privacy Policy");
    assert.ok(idx > -1, "references the policy as prose, not as a clickable route");
  });
});

// ── V. Boundary — no other lane's engine/provider/billing code ───────────────

describe("V — Settings & Privacy stays inside its own lane", () => {
  it("does not import a StyleMe recommendation/engine module", () => {
    assert.ok(!/styleme-recommendation|styleme-result|styleme-outcome/.test(settingsSrc),
      "no StyleMe recommendation engine import");
  });

  it("does not import a Wardrobe Intelligence engine module", () => {
    assert.ok(!/wardrobe-intelligence|wardrobe-needs|wardrobe-recommendations/.test(settingsSrc),
      "no WI engine import");
  });

  it("does not import Buy or Skip decision logic (only the image-privacy helper)", () => {
    assert.ok(settingsSrc.includes("buy-or-skip-privacy.server"), "uses only the privacy/deletion helper");
    assert.ok(!/buyskip-foundation|buy-or-skip-decision/.test(settingsSrc), "no Buy/Skip decision engine import");
  });

  it("does not import billing/entitlement/plan-limit modules", () => {
    assert.ok(!/plan\/entitlement|plan\/plan-limits|plan\/usage-window/.test(settingsSrc),
      "no billing/entitlement import");
  });

  it("imports the VTO deletion helper only, never a live-provider call module", () => {
    assert.ok(settingsSrc.includes("fashn-tryon-service.server"), "uses the existing deletion helper");
    assert.ok(!/fashn-tryon-provider|fashn-api-client/.test(settingsSrc), "no direct VTO provider client import");
  });

  it("does not import or reference Prisma schema/migration files", () => {
    assert.ok(!settingsSrc.includes("prisma/migrations"), "no migration file reference");
    assert.ok(!settingsSrc.includes("prisma/schema.prisma"), "no schema file reference");
  });
});

// ── W. Long values wrap instead of overflowing ───────────────────────────────

describe("W — long account values stay on-screen", () => {
  it(".sp-detail-value allows wrapping so a long email cannot overflow its row", () => {
    const ruleIdx = cssSrc.indexOf(".sp-detail-value {");
    const rule = cssSrc.slice(ruleIdx, cssSrc.indexOf("}", ruleIdx));
    assert.ok(rule.includes("overflow-wrap: break-word"), "value cell breaks long unbroken strings");
    assert.ok(rule.includes("min-width: 0"), "value cell can shrink below its content's natural width in the flex row");
  });
});
