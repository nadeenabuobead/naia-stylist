// app/routes/my-naia.buying-decisions.test.ts
//
// Per-decision "×" remove control on Buy or Skip → My Decisions.
//
// Source-code assertions — no DOM, no Prisma connection, no network, same
// convention as settings.test.ts. Proves:
//   A. Every decision card renders a remove control
//   B. Removal is gated behind a confirmation modal (no immediate submit)
//   C. Cancel never submits — the decision is left untouched
//   D. Only the pending (selected) decision's id is submitted for removal
//   E. The list refreshes after a successful removal
//   F. Auth guard — requireCurrentNaiaCustomer before formData/prisma
//   G. Ownership — the action passes the authenticated customer's id, not a
//      client-supplied one, into deleteOneBosDecision (cross-customer
//      deletion is rejected at the lib layer, see buy-or-skip-privacy.test.ts)
//   H. This route calls deleteOneBosDecision, never deleteCustomerBosImages/
//      deleteOneBosImage — the per-decision removal is a distinct action from
//      Settings & Privacy's bulk image-only deletion, which is left unchanged

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "my-naia.buying-decisions.tsx"), "utf8");
const settingsSrc = readFileSync(join(__dirname, "settings.tsx"), "utf8");

describe("A — remove control on every card", () => {
  it("renders a bos-decision-remove button inside the decisions.map", () => {
    const mapIdx = src.indexOf("decisions.map(d =>");
    assert.ok(mapIdx > -1, "maps over decisions");
    const afterMap = src.slice(mapIdx);
    assert.ok(afterMap.includes("bos-decision-remove"), "remove control present per card");
    assert.ok(afterMap.includes('aria-label="Remove this decision"'), "accessible label present");
  });

  it("the remove button is not nested inside the navigating Link — sibling wrapper avoids interactive-in-interactive nesting", () => {
    assert.ok(src.includes("bos-decision-card-wrap"), "uses a wrapper div around the Link + remove button");
  });
});

describe("B — confirmation required before removal", () => {
  it("clicking remove only sets pending state — it does not call fetcher.submit directly", () => {
    const btnIdx = src.indexOf("bos-decision-remove");
    const onClickSlice = src.slice(btnIdx, btnIdx + 400);
    assert.ok(onClickSlice.includes("setPending(d.id)"), "remove button sets pending, not submit");
    assert.ok(!onClickSlice.includes("fetcher.submit"), "no direct submit from the card button");
  });

  it("renders the required confirmation copy", () => {
    assert.ok(src.includes("Remove this decision?"), "modal title matches spec");
    assert.ok(src.includes("This will remove this Buy or Skip decision from your history."), "modal body matches spec");
  });

  it("the submit happens only from the modal's confirm action, gated on pending", () => {
    const modalIdx = src.indexOf("dc-modal-overlay");
    assert.ok(modalIdx > -1, "confirmation modal present");
    assert.ok(src.includes("confirmRemove"), "modal confirm button uses a dedicated handler");
    const confirmFnIdx = src.indexOf("const confirmRemove");
    assert.ok(confirmFnIdx > -1 && src.slice(confirmFnIdx).includes("fetcher.submit"), "confirmRemove submits via fetcher");
  });
});

describe("C — cancel leaves the decision untouched", () => {
  it("Cancel only clears pending state — never submits", () => {
    const cancelIdx = src.indexOf('onClick={() => setPending(null)}');
    assert.ok(cancelIdx > -1, "Cancel button clears pending");
  });
});

describe("D — only the selected decision is removed", () => {
  it("confirmRemove submits the pending id as analysisId", () => {
    const confirmFnIdx = src.indexOf("const confirmRemove");
    const slice = src.slice(confirmFnIdx, confirmFnIdx + 300);
    assert.ok(slice.includes("analysisId: pending"), "submits the specific pending decision id");
    assert.ok(slice.includes('intent: "delete-decision"'), "uses the delete-decision intent");
  });

  it("the action looks up the analysisId from formData, not a hardcoded or bulk value", () => {
    const actionIdx = src.indexOf("export async function action");
    const slice = src.slice(actionIdx);
    assert.ok(slice.includes('formData.get("analysisId")'), "action reads analysisId from the form");
    assert.ok(slice.includes("deleteOneBosDecision(analysisId, naiaCustomer.id)"), "action scopes deletion to the authed customer");
  });
});

describe("E — list updates after removal", () => {
  it("a successful action response triggers revalidation", () => {
    assert.ok(src.includes("revalidator.revalidate()"), "revalidates the loader after success");
    const effectIdx = src.indexOf("useEffect");
    assert.ok(effectIdx > -1 && src.slice(effectIdx).includes("actionData?.ok"), "revalidation gated on a successful response");
  });
});

describe("F — auth guard", () => {
  it("loader calls requireCurrentNaiaCustomer before any prisma access", () => {
    const loaderIdx = src.indexOf("export async function loader");
    const authIdx = src.indexOf("requireCurrentNaiaCustomer(request)", loaderIdx);
    const prismaIdx = src.indexOf("prisma.", loaderIdx);
    assert.ok(authIdx > -1, "loader calls requireCurrentNaiaCustomer");
    assert.ok(authIdx < prismaIdx, "auth called before prisma in loader");
  });

  it("action calls requireCurrentNaiaCustomer before reading formData", () => {
    const actionIdx = src.indexOf("export async function action");
    const authIdx = src.indexOf("requireCurrentNaiaCustomer(request)", actionIdx);
    const formIdx = src.indexOf("formData", actionIdx);
    assert.ok(authIdx > -1, "action calls requireCurrentNaiaCustomer");
    assert.ok(authIdx < formIdx, "auth called before formData in action");
  });
});

describe("G — ownership scoping", () => {
  it("passes naiaCustomer.id (server-derived), never a client-supplied customerId", () => {
    assert.ok(!src.includes('formData.get("customerId")'), "no client-supplied customerId read anywhere");
    assert.ok(src.includes("deleteOneBosDecision(analysisId, naiaCustomer.id)"), "customerId comes from the authenticated session");
  });
});

describe("H — distinct from Settings & Privacy bulk image deletion", () => {
  it("this route imports and calls deleteOneBosDecision, not deleteCustomerBosImages/deleteOneBosImage", () => {
    assert.ok(src.includes("deleteOneBosDecision"), "imports deleteOneBosDecision");
    assert.ok(!src.includes("deleteCustomerBosImages"), "does not use the bulk image-only deletion helper");
    assert.ok(!src.includes("deleteOneBosImage"), "does not use the single image-only deletion helper");
  });

  it("Settings & Privacy's bulk image deletion intent and copy are unchanged", () => {
    assert.ok(settingsSrc.includes('"delete-bos-images"'), "delete-bos-images intent still present in settings.tsx");
    assert.ok(settingsSrc.includes("deleteCustomerBosImages"), "settings.tsx still calls the bulk image-only helper");
    assert.ok(settingsSrc.includes("Remove all images"), "Remove all images button copy unchanged");
    assert.ok(
      settingsSrc.includes("Your decisions, recommendations and history will remain."),
      "settings.tsx copy still promises decisions/history are preserved by bulk image deletion",
    );
  });
});
