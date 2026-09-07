// app/routes/settings.test.ts
// Settings & Privacy V1 contract tests.
//
// Source-code assertions — no DOM, no Prisma connection, no network.
// All tests read settings.tsx as text and assert structural invariants.
//
// Coverage:
//   A. Auth guard — requireCurrentNaiaCustomer in loader AND action
//   B. Loader safety — no private IDs returned to browser
//   C. Valid action intents wired to correct server functions
//   D. Invalid intents rejected (400)
//   E. Customer scoping — action uses authenticated customer.id
//   F. Removed features — Communication Preferences, Delivery Addresses absent
//   G. No fake request-success — no fake "Your request has been received" behavior
//   H. Privacy contact — data/account requests use verified privacy email
//   I. Sign out — uses /auth/logout
//   J. Selfie and model sections are clearly separated

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "settings.tsx"), "utf8");

// ── A. Auth guard ─────────────────────────────────────────────────────────────

describe("A — auth guard", () => {
  it("imports requireCurrentNaiaCustomer from naia-session.server", () => {
    assert.ok(src.includes("requireCurrentNaiaCustomer"), "imports requireCurrentNaiaCustomer");
    assert.ok(src.includes("naia-session.server"),        "from naia-session.server");
  });

  it("loader calls requireCurrentNaiaCustomer before any prisma access", () => {
    const loaderIdx  = src.indexOf("export async function loader");
    const authIdx    = src.indexOf("requireCurrentNaiaCustomer(request)", loaderIdx);
    const prismaIdx  = src.indexOf("prisma.", loaderIdx);
    assert.ok(authIdx > -1,  "loader calls requireCurrentNaiaCustomer");
    assert.ok(prismaIdx > -1, "loader uses prisma");
    assert.ok(authIdx < prismaIdx, "auth called before prisma in loader");
  });

  it("action calls requireCurrentNaiaCustomer before reading formData or prisma", () => {
    const actionIdx = src.indexOf("export async function action");
    const authIdx   = src.indexOf("requireCurrentNaiaCustomer(request)", actionIdx);
    const formIdx   = src.indexOf("formData",  actionIdx);
    assert.ok(authIdx > -1, "action calls requireCurrentNaiaCustomer");
    assert.ok(authIdx < formIdx, "auth called before formData in action");
  });

  it("does not use legacy authenticateCustomer", () => {
    assert.ok(!src.includes("authenticateCustomer"), "no legacy authenticateCustomer");
  });
});

// ── B. Loader safety ──────────────────────────────────────────────────────────

describe("B — loader safety", () => {
  it("loader does not return photoPublicId to the browser", () => {
    // photoPublicId must only appear in select queries — never in the returned data() call.
    // We check that 'photoPublicId' after the 'return data(' call is absent.
    const returnIdx = src.indexOf("return data({");
    const afterReturn = src.slice(returnIdx);
    assert.ok(!afterReturn.includes("photoPublicId"), "photoPublicId not in returned loader data");
  });

  it("loader does not return facePublicId to the browser", () => {
    const returnIdx = src.indexOf("return data({");
    const afterReturn = src.slice(returnIdx);
    assert.ok(!afterReturn.includes("facePublicId"), "facePublicId not in returned loader data");
  });

  it("loader does not return bodyPublicId to the browser", () => {
    const returnIdx = src.indexOf("return data({");
    const afterReturn = src.slice(returnIdx);
    assert.ok(!afterReturn.includes("bodyPublicId"), "bodyPublicId not in returned loader data");
  });

  it("loader selects selfie state (hasPhoto, hasAnalysis) without private IDs", () => {
    assert.ok(src.includes("hasPhoto"),    "loader computes hasPhoto");
    assert.ok(src.includes("hasAnalysis"), "loader computes hasAnalysis");
  });

  it("loader selects model state (hasFace, hasBody) without private IDs", () => {
    assert.ok(src.includes("hasFace"), "loader computes hasFace");
    assert.ok(src.includes("hasBody"), "loader computes hasBody");
  });

  it("loader returns customer name and email", () => {
    assert.ok(src.includes("firstName"), "loader returns firstName");
    assert.ok(src.includes("email"),     "loader returns email");
  });
});

// ── C. Valid action intents wired to correct server functions ─────────────────

describe("C — action intents wired to server functions", () => {
  it("imports deleteSelfiePhoto from selfie-persistence.server", () => {
    assert.ok(src.includes("deleteSelfiePhoto"),         "imports deleteSelfiePhoto");
    assert.ok(src.includes("selfie-persistence.server"), "from selfie-persistence.server");
  });

  it("imports deleteAnalysisResult from selfie-persistence.server", () => {
    assert.ok(src.includes("deleteAnalysisResult"), "imports deleteAnalysisResult");
  });

  it("imports deleteBoth from selfie-persistence.server", () => {
    assert.ok(src.includes("deleteBoth"), "imports deleteBoth");
  });

  it("imports deleteNaiaModelPhoto from my-naia-model.server", () => {
    assert.ok(src.includes("deleteNaiaModelPhoto"),   "imports deleteNaiaModelPhoto");
    assert.ok(src.includes("my-naia-model.server"),   "from my-naia-model.server");
  });

  it("imports withdrawSaveModelConsent from my-naia-model.server", () => {
    assert.ok(src.includes("withdrawSaveModelConsent"), "imports withdrawSaveModelConsent");
  });

  it("action handles delete-selfie-photo intent calling deleteSelfiePhoto", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes('"delete-selfie-photo"'),  "handles delete-selfie-photo");
    assert.ok(actionBlock.includes("deleteSelfiePhoto(customer.id)"), "calls deleteSelfiePhoto with customer.id");
  });

  it("action handles delete-selfie-analysis intent calling deleteAnalysisResult", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes('"delete-selfie-analysis"'),     "handles delete-selfie-analysis");
    assert.ok(actionBlock.includes("deleteAnalysisResult(customer.id)"), "calls deleteAnalysisResult with customer.id");
  });

  it("action handles delete-selfie-both intent calling deleteBoth", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes('"delete-selfie-both"'),   "handles delete-selfie-both");
    assert.ok(actionBlock.includes("deleteBoth(customer.id)"), "calls deleteBoth with customer.id");
  });

  it("action handles delete-model-face intent calling deleteNaiaModelPhoto with face slot", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes('"delete-model-face"'),           "handles delete-model-face");
    assert.ok(actionBlock.includes('deleteNaiaModelPhoto(customer.id, "face")'), "calls deleteNaiaModelPhoto face slot");
  });

  it("action handles delete-model-body intent calling deleteNaiaModelPhoto with body slot", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes('"delete-model-body"'),           "handles delete-model-body");
    assert.ok(actionBlock.includes('deleteNaiaModelPhoto(customer.id, "body")'), "calls deleteNaiaModelPhoto body slot");
  });

  it("action handles delete-model-all intent calling withdrawSaveModelConsent", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes('"delete-model-all"'),                   "handles delete-model-all");
    assert.ok(actionBlock.includes("withdrawSaveModelConsent(customer.id)"), "calls withdrawSaveModelConsent with customer.id");
  });
});

// ── D. Invalid intent rejected ────────────────────────────────────────────────

describe("D — invalid intent rejected", () => {
  it("action has a VALID_INTENTS set that gates allowed values", () => {
    assert.ok(src.includes("VALID_INTENTS"), "VALID_INTENTS defined");
  });

  it("action returns 400 for unknown intents", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(actionBlock.includes("status: 400"), "400 returned for invalid intent");
  });
});

// ── E. Customer scoping ───────────────────────────────────────────────────────

describe("E — customer scoping", () => {
  it("action never uses client-supplied customer ID — only uses customer.id from auth", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    // No formData.get("customerId") or similar — only customer.id from requireCurrentNaiaCustomer
    assert.ok(!actionBlock.includes('formData.get("customerId")'), "no client-supplied customerId");
    assert.ok(!actionBlock.includes('formData.get("customer_id")'), "no client-supplied customer_id");
    assert.ok(actionBlock.includes("customer.id"), "uses server-side customer.id");
  });
});

// ── F. Removed features ───────────────────────────────────────────────────────

describe("F — removed features absent from component", () => {
  it("does not contain communication preference checkboxes", () => {
    assert.ok(!src.includes("Editorial & new arrivals"),             "no editorial checkbox");
    assert.ok(!src.includes("Styling recommendations from nAia"),    "no styling checkbox");
    assert.ok(!src.includes("Personalised trend reports"),           "no trend reports checkbox");
    assert.ok(!src.includes("set-comm-list"),                        "no set-comm-list class");
    assert.ok(!src.includes("set-comm-check"),                       "no set-comm-check class");
  });

  it("does not contain Delivery Addresses section", () => {
    assert.ok(!src.includes("Delivery Addresses"),  "Delivery Addresses section removed");
    assert.ok(!src.includes("Add Another Address"), "Add Another Address button removed");
    assert.ok(!src.includes("set-address-box"),     "set-address-box class removed");
  });

  it("does not contain a non-functional Update Details button", () => {
    assert.ok(!src.includes("Update Details"), "Update Details button removed");
  });

  it("does not contain Telephone placeholder field", () => {
    assert.ok(!src.includes("Telephone"), "Telephone placeholder removed");
  });
});

// ── G. No fake request-success behavior ──────────────────────────────────────

describe("G — no fake request-success behavior", () => {
  it("does not contain the fake request-received status message", () => {
    assert.ok(!src.includes("Your request has been received"), "no fake request-received message");
  });

  it("does not contain a client-side confirm() function that fakes server calls", () => {
    // The old fake confirm() set a local status string with no server call.
    // The new implementation uses fetcher.submit() which makes a real POST.
    assert.ok(!src.includes("setStatus(\"Your request"), "no fake setStatus call");
    assert.ok(!src.includes("setStatus('Your request"), "no fake setStatus call (single quote)");
  });

  it("uses fetcher.submit for deletion actions (real server call)", () => {
    assert.ok(src.includes("fetcher.submit"), "uses fetcher.submit for server calls");
  });

  it("uses useRevalidator to refresh loader state after deletion", () => {
    assert.ok(src.includes("useRevalidator"),           "imports useRevalidator");
    assert.ok(src.includes("revalidator.revalidate()"), "calls revalidator.revalidate");
  });
});

// ── H. Privacy contact ────────────────────────────────────────────────────────

describe("H — privacy contact uses verified email", () => {
  it("data export link uses privacy@naiabynadine.com mailto", () => {
    assert.ok(src.includes("mailto:privacy@naiabynadine.com"), "uses correct privacy email");
  });

  it("account deletion request link uses privacy@naiabynadine.com mailto", () => {
    const count = (src.match(/mailto:privacy@naiabynadine\.com/g) ?? []).length;
    assert.ok(count >= 2, `at least 2 privacy email mailto links (found ${count})`);
  });

  it("does not have a fake account-deletion modal that claims to submit a request", () => {
    assert.ok(!src.includes("account deletion request has been received"), "no fake deletion confirmation");
    assert.ok(!src.includes("data export request has been received"),      "no fake export confirmation");
  });
});

// ── I. Sign out ───────────────────────────────────────────────────────────────

describe("I — sign out", () => {
  it("sign out form posts to /auth/logout", () => {
    assert.ok(src.includes('action="/auth/logout"'), "sign out targets /auth/logout");
    assert.ok(src.includes('method="post"'),         "sign out uses POST method");
  });
});

// ── J. Selfie and model separation ───────────────────────────────────────────

describe("J — selfie and model clearly separated", () => {
  it("has distinct Selfie Style Analysis section heading", () => {
    assert.ok(src.includes("Selfie Style Analysis"), "has Selfie Style Analysis heading");
  });

  it("has distinct My nAia Model section heading", () => {
    assert.ok(src.includes("My nAia Model"), "has My nAia Model heading");
  });

  it("selfie intents do not reference model functions", () => {
    // delete-selfie-* intents must not call deleteNaiaModelPhoto or withdrawSaveModelConsent
    const selfiePhotoCase  = src.slice(src.indexOf('"delete-selfie-photo"'), src.indexOf('"delete-selfie-analysis"'));
    const selfieAnalysis   = src.slice(src.indexOf('"delete-selfie-analysis"'), src.indexOf('"delete-selfie-both"'));
    const selfieBoth       = src.slice(src.indexOf('"delete-selfie-both"'), src.indexOf('"delete-model-face"'));
    for (const block of [selfiePhotoCase, selfieAnalysis, selfieBoth]) {
      assert.ok(!block.includes("deleteNaiaModelPhoto"),     "selfie case does not call deleteNaiaModelPhoto");
      assert.ok(!block.includes("withdrawSaveModelConsent"), "selfie case does not call withdrawSaveModelConsent");
    }
  });

  it("model intents do not reference selfie functions", () => {
    const modelFaceCase = src.slice(src.indexOf('"delete-model-face"'), src.indexOf('"delete-model-body"'));
    const modelBodyCase = src.slice(src.indexOf('"delete-model-body"'), src.indexOf('"delete-model-all"'));
    for (const block of [modelFaceCase, modelBodyCase]) {
      assert.ok(!block.includes("deleteSelfiePhoto"),    "model case does not call deleteSelfiePhoto");
      assert.ok(!block.includes("deleteAnalysisResult"), "model case does not call deleteAnalysisResult");
      assert.ok(!block.includes("deleteBoth"),           "model case does not call deleteBoth");
    }
  });

  it("Closet photos section explains deletion via My Closet (not a delete button)", () => {
    assert.ok(src.includes("My Closet Photos"),          "has My Closet Photos section");
    assert.ok(src.includes("Go to My Closet"),           "has link to My Closet");
    assert.ok(!src.includes("delete-closet"),            "no fake delete-closet intent");
  });
});

// ── K. Hero and section copy ──────────────────────────────────────────────────

describe("K — hero and section copy", () => {
  it("hero title is 'Settings & privacy.' not 'YOUR account.'", () => {
    assert.ok(
      src.includes("Settings & <span"),
      "hero title starts with 'Settings &'",
    );
    assert.ok(
      src.includes("privacy."),
      "hero title ends with 'privacy.'",
    );
    assert.ok(
      !src.includes("YOUR account."),
      "old 'YOUR account.' hero title is gone",
    );
  });

  it("personalisation eyebrow is 'HOW YOUR INFORMATION IS USED'", () => {
    assert.ok(
      src.includes("HOW YOUR INFORMATION IS USED"),
      "personalisation eyebrow updated",
    );
    assert.ok(
      !src.includes(">How nAia works<"),
      "old 'How nAia works' eyebrow is gone",
    );
  });

  it("sign out section has a heading", () => {
    const signOutIdx = src.indexOf("Sign Out");
    assert.ok(signOutIdx > -1, "Sign Out appears in the file");
    const signOutSection = src.slice(src.lastIndexOf("Sign Out", src.indexOf('action="/auth/logout"')) - 200, src.indexOf('action="/auth/logout"'));
    assert.ok(
      signOutSection.includes("set-section-eyebrow") || signOutSection.includes("set-section-title"),
      "Sign Out section has a heading element",
    );
  });
});

// ── L. Destructive button labels ──────────────────────────────────────────────

describe("L — explicit destructive button labels", () => {
  it("ControlRow component accepts a buttonLabel prop", () => {
    assert.ok(
      src.includes("buttonLabel"),
      "ControlRow has buttonLabel prop",
    );
    assert.ok(
      !src.includes(">Continue<") && !src.includes('"Continue"'),
      "generic 'Continue' label is gone",
    );
  });

  it("Remove face photo button label is 'Remove face photo'", () => {
    assert.ok(
      src.includes('buttonLabel="Remove face photo"'),
      "face photo ControlRow has explicit buttonLabel",
    );
  });

  it("Remove body photo button label is 'Remove body photo'", () => {
    assert.ok(
      src.includes('buttonLabel="Remove body photo"'),
      "body photo ControlRow has explicit buttonLabel",
    );
  });

  it("Remove all photos button label is 'Remove all photos'", () => {
    assert.ok(
      src.includes('buttonLabel="Remove all photos"'),
      "remove-all ControlRow has explicit buttonLabel",
    );
  });

  it("VTO button label is 'Remove previews'", () => {
    assert.ok(
      src.includes('buttonLabel="Remove previews"'),
      "VTO ControlRow has explicit buttonLabel",
    );
  });

  it("BOS button label is 'Remove uploaded images'", () => {
    assert.ok(
      src.includes('buttonLabel="Remove uploaded images"'),
      "BOS ControlRow has explicit buttonLabel",
    );
  });
});

// ── M. Account details ────────────────────────────────────────────────────────

describe("M — account details", () => {
  it("name row is conditionally rendered — hidden when name is absent", () => {
    assert.ok(
      src.includes("{fullName && ("),
      "name row is wrapped in a conditional on fullName",
    );
    assert.ok(
      !src.includes('|| "—"') && !src.includes("|| '—'"),
      "no dash fallback — absent name means hidden row, not placeholder",
    );
  });

  it("email row is conditionally rendered — hidden when email is absent", () => {
    assert.ok(
      src.includes("{email && ("),
      "email row is wrapped in a conditional on email",
    );
  });

  it("email comes from loader (customer.email), not client input", () => {
    const loaderIdx = src.indexOf("export async function loader");
    const loaderSrc = src.slice(loaderIdx, src.indexOf("export async function action"));
    assert.ok(loaderSrc.includes("customer.email"), "loader reads customer.email");
    assert.ok(!loaderSrc.includes('formData.get("email")'), "email not from formData");
  });

  it("no NADINE sync note — no claim that NADINE updates propagate here", () => {
    assert.ok(
      !src.includes("NADINE account settings"),
      "no misleading NADINE sync note",
    );
  });

  it("unverified marketing / data-sharing claim is absent", () => {
    assert.ok(
      !src.includes("never sold"),
      "unverified 'never sold' claim removed pending policy review",
    );
    assert.ok(
      !src.includes("third parties for marketing"),
      "unverified third-party marketing claim removed",
    );
  });
});

// ── N. Data requests ──────────────────────────────────────────────────────────

describe("N — data request buttons are mailto links", () => {
  it("data export button is a mailto link, not a form submit", () => {
    assert.ok(
      src.includes("mailto:privacy@naiabynadine.com?subject=Data%20export%20request"),
      "data export button is a mailto link",
    );
  });

  it("account deletion request is a mailto link, not a form submit", () => {
    assert.ok(
      src.includes("mailto:privacy@naiabynadine.com?subject=Account%20deletion%20request"),
      "account deletion is a mailto link",
    );
  });

  it("page does not claim to automatically process requests", () => {
    assert.ok(
      !src.includes("Your request has been submitted"),
      "no false automatic-submission claim",
    );
    assert.ok(
      !src.includes("We will process your request"),
      "no false processing claim",
    );
  });

  it("data section copy positions buttons as primary mechanism", () => {
    assert.ok(
      src.includes("Use the options below"),
      "buttons are described as the primary mechanism",
    );
  });
});

// ── O. Routing targets ────────────────────────────────────────────────────────

describe("O — routing targets", () => {
  it("Go to My Closet links to /closet (covered by storefront rewrite)", () => {
    assert.ok(src.includes('to="/closet"'), "My Closet link uses /closet");
  });

  it("sign out posts to /auth/logout (covered by storefront /auth/:path* rewrite)", () => {
    assert.ok(src.includes('action="/auth/logout"'), "sign out targets /auth/logout");
  });

  it("no hardcoded absolute URLs that would break through the storefront proxy", () => {
    assert.ok(
      !src.includes("naia-stylist-staging.vercel.app"),
      "no hardcoded staging domain in component",
    );
  });
});
