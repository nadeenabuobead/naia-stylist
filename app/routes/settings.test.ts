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
//   I. Sign out — not duplicated here; lives in the nav (MyNaiaLayout.tsx)
//   J. Selfie Style Analysis is V1-deactivated; My nAia Model is body-only

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

  it("loader does not query SelfieAnalysis — the feature is V1-deactivated", () => {
    assert.ok(!src.includes("selfieAnalysis"), "loader does not query prisma.selfieAnalysis");
    assert.ok(!src.includes("hasPhoto"),    "loader no longer computes selfie hasPhoto");
    assert.ok(!src.includes("hasAnalysis"), "loader no longer computes selfie hasAnalysis");
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
  it("does not import selfie-persistence.server — Selfie Style Analysis is V1-deactivated here", () => {
    assert.ok(!src.includes("selfie-persistence.server"), "no selfie-persistence.server import");
    assert.ok(!src.includes("deleteSelfiePhoto"),    "no deleteSelfiePhoto import");
    assert.ok(!src.includes("deleteAnalysisResult"), "no deleteAnalysisResult import");
    assert.ok(!src.includes("deleteBoth"),           "no deleteBoth import");
  });

  it("imports deleteNaiaModelPhoto from my-naia-model.server", () => {
    assert.ok(src.includes("deleteNaiaModelPhoto"),   "imports deleteNaiaModelPhoto");
    assert.ok(src.includes("my-naia-model.server"),   "from my-naia-model.server");
  });

  it("imports withdrawSaveModelConsent from my-naia-model.server", () => {
    assert.ok(src.includes("withdrawSaveModelConsent"), "imports withdrawSaveModelConsent");
  });

  it("action does not handle any delete-selfie-* or delete-model-face intent", () => {
    const actionBlock = src.slice(src.indexOf("export async function action"));
    assert.ok(!actionBlock.includes('"delete-selfie-photo"'),    "no delete-selfie-photo handling");
    assert.ok(!actionBlock.includes('"delete-selfie-analysis"'), "no delete-selfie-analysis handling");
    assert.ok(!actionBlock.includes('"delete-selfie-both"'),     "no delete-selfie-both handling");
    assert.ok(!actionBlock.includes('"delete-model-face"'),      "no delete-model-face handling");
    assert.ok(!actionBlock.includes('deleteNaiaModelPhoto(customer.id, "face")'), "never calls deleteNaiaModelPhoto with face slot");
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
//
// 2026-10-19: data export and account deletion are now real, immediate,
// authenticated actions (app/lib/customer-privacy.server.ts) — not mailto
// requests. This section previously asserted the opposite; updated per an
// explicit, repeated, multi-turn request to implement exactly this, not an
// accidental regression. The mailto link remains for genuinely unhandled
// "other queries" only — see section N below for the real mechanism checks.

describe("H — privacy contact email remains for other queries only", () => {
  it("still offers privacy@naiabynadine.com for queries outside export/deletion", () => {
    assert.ok(src.includes("mailto:privacy@naiabynadine.com"), "uses correct privacy email");
  });

  it("does not fabricate a fake success message independent of the real action result", () => {
    // The real success copy ("permanently deleted") comes from
    // SUCCESS_MESSAGES / CONFIRM, driven by an actual eraseCustomerData call —
    // this just guards against a second, hardcoded claim existing alongside it.
    assert.ok(!src.includes("account deletion request has been received"), "no stale fake-mailto-era confirmation copy");
    assert.ok(!src.includes("data export request has been received"),      "no stale fake-mailto-era confirmation copy");
  });
});

// ── I. Sign out ───────────────────────────────────────────────────────────────
// Sign Out moved to the authenticated left nav (Account group, MyNaiaLayout.tsx)
// — Settings no longer renders its own Sign Out control, so logout isn't duplicated.

describe("I — sign out", () => {
  it("Settings does not render its own /auth/logout form — the nav action is the only one", () => {
    assert.ok(!src.includes('action="/auth/logout"'), "no standalone Sign Out form in Settings");
  });

  it("Settings has no standalone Sign Out section heading", () => {
    assert.ok(!/<h2[^>]*>Sign Out<\/h2>/.test(src), "no 'Sign Out' section heading");
  });
});

// ── J. Selfie is V1-deactivated; model section is body-only ──────────────────

describe("J — Selfie Style Analysis is V1-deactivated; My nAia Model is body-only", () => {
  it("has no Selfie Style Analysis section — feature hidden from customer-facing V1", () => {
    assert.ok(!src.includes("Selfie Style Analysis"), "no Selfie Style Analysis heading");
  });

  it("has distinct My nAia Model section heading", () => {
    assert.ok(src.includes("My nAia Model"), "has My nAia Model heading");
  });

  it("My nAia Model section never renders a standalone 'Remove saved face photo' control", () => {
    assert.ok(!src.includes("Remove saved face photo"), "no face-specific remove control");
    assert.ok(!src.includes('intent="delete-model-face"'), "no delete-model-face ControlRow");
  });

  it("model-all intent (the only remaining path touching face data) does not reference selfie functions", () => {
    const modelBodyCase = src.slice(src.indexOf('"delete-model-body"'), src.indexOf('"delete-model-all"'));
    const modelAllCase  = src.slice(src.indexOf('"delete-model-all"'), src.indexOf('"delete-vto-results"'));
    for (const block of [modelBodyCase, modelAllCase]) {
      assert.ok(!block.includes("deleteSelfiePhoto"),    "model case does not call deleteSelfiePhoto");
      assert.ok(!block.includes("deleteAnalysisResult"), "model case does not call deleteAnalysisResult");
      assert.ok(!block.includes("deleteBoth"),           "model case does not call deleteBoth");
    }
  });

  it("Closet photos section links to My Closet for individual management and offers a real bulk delete-all here", () => {
    assert.ok(src.includes("My Closet Photos"),               "has My Closet Photos section");
    assert.ok(src.includes("Go to My Closet"),                "links out to My Closet for per-item management");
    assert.ok(src.includes("delete-all-closet-photos"),        "real bulk-delete-all intent exists");
    // Settings & Privacy is a privacy/deletion control surface, not a photo
    // gallery — no per-item thumbnails, selectors, or single-photo intent here.
    assert.ok(!src.includes("delete-closet-photo\""),          "no single-photo delete intent in Settings — that lives in My Closet");
    assert.ok(
      !src.includes("delete the corresponding item from your Closet"),
      "old destructive-by-necessity copy must be removed",
    );
  });

  it("the Closet bulk-delete action is genuinely wired to the shared image-only privacy module, not a stub", () => {
    assert.ok(src.includes("~/lib/closet-photo-privacy.server"), "imports the real closet-photo privacy module");
    assert.ok(src.includes("deleteAllClosetPhotos"),             "calls the real bulk deletion function");
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

  it("no standalone Sign Out section — it lives in the nav, not as its own bos-section here", () => {
    assert.ok(!/<h2[^>]*>Sign Out<\/h2>/.test(src), "no Sign Out section heading in Settings");
    assert.ok(!src.includes('<button type="submit" className="sp-btn-outline">Sign Out</button>'), "no standalone Sign Out button in Settings");
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

  it("no 'Remove face photo' button label — the control is removed, not just hidden text", () => {
    assert.ok(
      !src.includes('buttonLabel="Remove face photo"'),
      "no face-photo-specific buttonLabel remains",
    );
  });

  it("My nAia Model has one consolidated 'Remove photo' control — single-photo product truth, not separate body/all-photos controls", () => {
    assert.ok(
      src.includes('buttonLabel="Remove photo"'),
      "consolidated nAia Model ControlRow has explicit buttonLabel",
    );
    assert.ok(
      !src.includes('buttonLabel="Remove body photo"') && !src.includes('buttonLabel="Remove all photos"'),
      "the old two-control body/all-photos buttonLabels are gone — collapsed to one control",
    );
  });

  it("VTO section offers 'Go to My nAia Model' and 'Remove all previews' — no duplicated gallery here", () => {
    assert.ok(src.includes("Go to My nAia Model"), "VTO links out to My nAia Model's preview management");
    assert.ok(src.includes("Remove all previews"), "VTO still offers its own bulk-delete control");
  });

  it("BOS section offers 'Go to Buy or Skip' and 'Remove all images' — no gallery/selector here", () => {
    assert.ok(src.includes("Go to Buy or Skip"), "BOS links out to Buy or Skip for per-item management");
    assert.ok(src.includes("Remove all images"), "BOS bulk-delete control exists");
    assert.ok(!src.includes("Choose images to remove"), "no individual-selection entry point in Settings");
  });
});

// ── M. Account details ────────────────────────────────────────────────────────

describe("M — account details", () => {
  it("renders Name when available — the row pairs the Name label with the real fullName value", () => {
    const guardIdx = src.indexOf("{fullName && (");
    assert.ok(guardIdx !== -1, "fullName guard present");
    const rowBlock = src.slice(guardIdx, guardIdx + 300);
    assert.ok(rowBlock.includes(">Name<"), "label text is literally 'Name'");
    assert.ok(rowBlock.includes("{fullName}"), "value binds to the real fullName, not a literal or the email");
  });

  it("omits Name when unavailable — the row is absent from the tree, not shown with a placeholder", () => {
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
//
// 2026-10-19: both are now real actions, not mailto links — see the header
// note on section H above for why this flips the prior assertions.

describe("N — data export and account deletion are real, authenticated actions", () => {
  it("VALID_INTENTS includes request-data-export and delete-account", () => {
    assert.ok(src.includes('"request-data-export"'), "export intent registered");
    assert.ok(src.includes('"delete-account"'),       "deletion intent registered");
  });

  it("export calls compileCustomerExport, deletion calls eraseCustomerData — both from the shared privacy module", () => {
    assert.ok(src.includes("compileCustomerExport(customer.id)"), "export uses the shared compile function");
    assert.ok(src.includes("eraseCustomerData(customer.id)"),     "deletion uses the shared erase function");
    assert.ok(src.includes('from "~/lib/customer-privacy.server"'), "imports from the one shared module, not a one-off implementation");
  });

  it("export button submits via fetcher, not a mailto link", () => {
    assert.ok(
      src.includes('exportFetcher.submit({ intent: "request-data-export" }'),
      "export button is a real form submission",
    );
  });

  it("deletion goes through the same confirm-modal flow as every other destructive action, not a bare click", () => {
    assert.ok(src.includes('openConfirm("delete-account")'), "deletion opens the confirm modal first");
    assert.ok(src.includes('"delete-account": {'),            "delete-account has its own CONFIRM entry with real warning copy");
  });

  it("account deletion deletes the Clerk user entirely and redirects — it does not leave a stale, unlinked Clerk login or an active session behind", () => {
    // Clerk migration (2026-11-04): deleting the whole Clerk user (not just
    // revoking one session) is what "delete my account" should mean — it
    // ends every session for this identity and leaves no Clerk-hosted
    // email/password behind once nAia's own PII is erased. Superseding the
    // old __naia_tok cookie clear, which is no longer what any route reads
    // to decide "signed in" (see clerk-session.server.ts).
    assert.ok(src.includes("clerkClient(args).users.deleteUser(customer.clerkUserId)"), "deletes the Clerk user on account deletion");
    assert.ok(src.includes('redirect("/auth/signed-out"'),     "redirects to signed-out after deletion");
  });

  it("a failed Clerk user deletion is durably recorded (not just logged) so it can't go unnoticed", () => {
    // 2026-11-04: a bare console.error here was real but not durable (lost
    // to log rotation) and not actionable (no list anywhere to check). See
    // clerk-cleanup.server.ts + admin.maintenance.tsx's retry surface.
    const deleteIdx = src.indexOf("clerkClient(args).users.deleteUser(customer.clerkUserId)");
    const catchBlock = src.slice(deleteIdx, deleteIdx + 300);
    assert.ok(catchBlock.includes("recordPendingClerkCleanup"), "the failure handler calls recordPendingClerkCleanup, not just console.error");
    assert.ok(!catchBlock.includes("console.error"), "console.error alone is no longer the failure handler — it was replaced, not supplemented silently");
  });

  it("deletion warning copy explicitly distinguishes account deletion from subscription cancellation", () => {
    const confirmBlock = src.slice(src.indexOf('"delete-account": {'), src.indexOf('"delete-account": {') + 600);
    assert.ok(/cancel|subscription|membership/i.test(confirmBlock), "warning copy addresses the cancellation-vs-deletion distinction");
  });

  it("page does not claim to automatically email or mail anything for these two actions", () => {
    assert.ok(
      !src.includes("Your request has been submitted"),
      "no false automatic-submission claim",
    );
    assert.ok(
      !src.includes("We will process your request"),
      "no false processing claim",
    );
  });
});

// ── O. Routing targets ────────────────────────────────────────────────────────

describe("O — routing targets", () => {
  it("Go to My Closet links to /closet (covered by storefront rewrite)", () => {
    assert.ok(src.includes('to="/closet"'), "My Closet link uses /closet");
  });

  it("no hardcoded absolute URLs that would break through the storefront proxy", () => {
    assert.ok(
      !src.includes("naia-stylist-staging.vercel.app"),
      "no hardcoded staging domain in component",
    );
  });
});
