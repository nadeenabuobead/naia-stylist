// app/routes/settings-coverage-gaps.test.ts
//
// Closes the specific gaps between settings.test.ts / settings-image-gaps.test.ts
// and the Settings & Privacy truthfulness/boundary/ownership checklist:
//
//   P. Design-research consent — real wiring, not a silent no-op
//   Q. No fake notification / marketing / AI-training controls
//   R. Account deletion is real (2026-10-19) — confirm-modal-gated, session-terminating
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

// ── P. NADINE design-pattern sharing is aggregated-only, no customer toggle ──
//
// The per-customer opt-in/opt-out toggle was removed: aggregated/coarsened
// design-pattern contribution is normal nAia operation now, not an optional
// customer choice (see design-signal.server.ts's ELIGIBLE_WHERE). This section
// proves the toggle and its action/loader wiring are genuinely gone from the
// customer-facing settings page, and that the schema fields/historical
// consent values are left untouched for backward compatibility pending legal
// review — not retroactively cleared.

describe("P — NADINE design-pattern sharing has no customer-facing toggle", () => {
  it("no consent intents remain in VALID_INTENTS or the action", () => {
    assert.ok(!settingsSrc.includes('"design-research-opt-in"'),  "opt-in intent removed");
    assert.ok(!settingsSrc.includes('"design-research-opt-out"'), "opt-out intent removed");
    assert.ok(!settingsSrc.includes("recordDesignResearchConsent"), "no call into the removed consent-write function");
  });

  it("loader no longer reads designResearchConsent for display", () => {
    const loaderIdx = settingsSrc.indexOf("export async function loader");
    const loaderBody = settingsSrc.slice(loaderIdx, settingsSrc.indexOf("export async function action"));
    assert.ok(!loaderBody.includes("designResearchConsent"), "loader does not read the consent field");
  });

  it("no 'Turn on' / 'Not currently sharing' toggle copy remains", () => {
    assert.ok(!settingsSrc.includes("Helping NADINE design"));
    assert.ok(!settingsSrc.includes("Not currently sharing"));
    assert.ok(!settingsSrc.includes('"Turn on"') && !settingsSrc.includes(">Turn on<"));
  });

  it("the Personalisation section states only the direct-data-use sentence — the aggregated/coarsened design-sharing paragraph was deliberately removed as a copy simplification", () => {
    const idx = settingsSrc.indexOf("HOW YOUR INFORMATION IS USED");
    const block = settingsSrc.slice(idx, idx + 1200);
    assert.ok(/post-wear feedback/i.test(block), "keeps the direct-data-use sentence");
    assert.ok(!/aggregat/i.test(block), "aggregated/coarsened paragraph removed per explicit copy cleanup");
    assert.ok(!/coarsen/i.test(block), "aggregated/coarsened paragraph removed per explicit copy cleanup");
  });

  it("the designResearchConsent DB field still exists in the schema (not deleted — backward compatibility pending legal review)", () => {
    const schema = read("prisma/schema.prisma");
    assert.ok(schema.includes("designResearchConsent "), "field remains declared in schema.prisma");
  });

  it("design-signal.server.ts's eligibility requires designResearchConsent again, as a 2026-11-17 fail-closed containment (reverses the prior assertion here) pending a Founder/Legal lawful-basis decision", () => {
    // This test previously asserted the OPPOSITE: that ELIGIBLE_WHERE
    // deliberately excluded designResearchConsent, since removing the
    // customer-facing toggle (above, in this same describe block) was
    // read as removing the gate entirely. No Founder/Legal decision
    // establishing a lawful basis for that was ever on record, so the
    // query layer now fails closed again — independent of whether the
    // customer-facing toggle itself is ever restored, which is a separate,
    // not-yet-decided product/copy question.
    const src = read("app/lib/ai/design-signal.server.ts");
    const whereIdx = src.indexOf("export const ELIGIBLE_WHERE");
    const whereBlock = src.slice(whereIdx, src.indexOf("} as const", whereIdx));
    assert.ok(whereBlock.includes("designResearchConsent: true"), "ELIGIBLE_WHERE requires consent again (fail-closed containment)");
    assert.ok(whereBlock.includes('accountType: "CUSTOMER"'), "still excludes test/demo/QA accounts");
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

// ── R. Account deletion is real, confirmed, and session-terminating ──────────
//
// 2026-10-19: this section previously asserted account deletion was
// deliberately NOT implemented (mailto-only). That was true until this exact
// gap was closed per an explicit, repeated, multi-turn request — flipped
// here accordingly, not an accidental regression. See app/lib/
// customer-privacy.server.ts and the matching checks in settings.test.ts
// section N for the fuller behavioral coverage; this section keeps the
// original "not a bare destructive click" framing, now pointed at the real
// confirm-then-submit flow instead of a mailto link.

describe("R — account deletion is real, but gated behind the same confirm flow as every other destructive action", () => {
  it("VALID_INTENTS has delete-account and request-data-export intents", () => {
    assert.ok(settingsSrc.includes('"delete-account"'),       "delete-account intent registered");
    assert.ok(settingsSrc.includes('"request-data-export"'),  "request-data-export intent registered");
  });

  it("account deletion is never a bare click — it requires the confirm modal, same as every other destructive control", () => {
    const dataSectionIdx = settingsSrc.indexOf("Your Data & Privacy");
    const nextSectionIdx = settingsSrc.indexOf("── Server-backed success feedback");
    const dataSection = settingsSrc.slice(dataSectionIdx, nextSectionIdx);
    assert.ok(dataSection.includes('openConfirm("delete-account")'), "deletion button opens the confirm modal, not an inline submit");
    assert.ok(!dataSection.includes("fetcher.submit"), "no direct fetcher.submit in the button itself — submission happens from the confirm modal");
  });

  it("deletion is wired to the real erase function, not a UI-only placeholder", () => {
    assert.ok(settingsSrc.includes("eraseCustomerData(customer.id)"), "action actually calls eraseCustomerData");
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
