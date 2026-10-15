// app/routes/closet-delete-confirmation.test.ts
//
// My Closet's "×" delete control used to submit immediately on click. This
// brings it in line with Buy or Skip's per-decision delete pattern (see
// my-naia.buying-decisions.test.ts): a confirmation modal gates the actual
// removal, Cancel leaves the item untouched, and only the selected item's id
// is ever submitted.
//
// Source-code assertions — no DOM, no Prisma connection, no network, same
// convention as settings.test.ts / my-naia.buying-decisions.test.ts. Proves:
//   1. × opens the confirmation modal (sets pending state, no direct submit)
//   2. Cancel closes the modal and submits nothing
//   3. Confirm (Remove) submits only the selected item's id, via the
//      existing "delete" intent — no change to the action itself

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");

describe("1 — × opens confirmation, does not delete directly", () => {
  it("the cl-delete button sets pendingDeleteItemId, it does not call fetcher.submit", () => {
    const btnIdx = src.indexOf('className="cl-delete"');
    assert.ok(btnIdx > -1, "cl-delete button present");
    const onClickSlice = src.slice(btnIdx, btnIdx + 300);
    assert.ok(onClickSlice.includes("setPendingDeleteItemId(item.id)"), "× sets the pending item, scoped to this item");
    assert.ok(!onClickSlice.includes("fetcher.submit"), "× no longer submits the delete directly");
  });

  it("renders the required Buy/Skip-pattern confirmation copy", () => {
    assert.ok(src.includes("dc-modal-overlay"), "uses the same modal overlay class as Buy or Skip");
    assert.ok(src.includes("Remove this item?"), "modal title matches spec");
    assert.ok(src.includes("This will remove this item from My Closet."), "modal body matches spec");
  });

  it("the modal is gated on pendingDeleteItemId, same conditional-render shape as Buy/Skip's pending", () => {
    const modalGateIdx = src.indexOf("{pendingDeleteItemId && (");
    assert.ok(modalGateIdx > -1, "modal only renders while a delete is pending");
  });
});

describe("2 — Cancel preserves the item", () => {
  it("Cancel only clears pendingDeleteItemId — it never submits", () => {
    const cancelIdx = src.indexOf("onClick={() => setPendingDeleteItemId(null)}");
    assert.ok(cancelIdx > -1, "Cancel button clears the pending item id");
    const cancelBtnSlice = src.slice(Math.max(0, cancelIdx - 200), cancelIdx + 50);
    assert.ok(cancelBtnSlice.includes("sp-btn-ghost"), "Cancel uses the same ghost-button styling as Buy or Skip's modal");
  });
});

describe("3 — Confirm removes only the selected item", () => {
  it("confirmDeleteItem submits the pending item's id under the existing delete intent", () => {
    const fnIdx = src.indexOf("const confirmDeleteItem");
    assert.ok(fnIdx > -1, "confirmDeleteItem handler exists");
    const slice = src.slice(fnIdx, fnIdx + 300);
    assert.ok(slice.includes('intent: "delete"'), "uses the existing delete intent — the server action is unchanged");
    assert.ok(slice.includes("itemId: pendingDeleteItemId"), "submits the specific pending item id, not a hardcoded or bulk value");
  });

  it("the Remove button in the modal calls confirmDeleteItem, not a direct submit", () => {
    const modalGateIdx = src.indexOf("{pendingDeleteItemId && (");
    const modalSlice = src.slice(modalGateIdx, modalGateIdx + 1200);
    assert.ok(modalSlice.includes("onClick={confirmDeleteItem}"), "Remove button is wired to confirmDeleteItem");
    assert.ok(modalSlice.includes("sp-btn-primary"), "Remove uses the same primary-button styling as Buy or Skip's modal");
  });

  it("the delete action itself is untouched — still scoped by itemId + the authenticated customer", () => {
    const actionIdx = src.indexOf('if (intent === "delete")');
    assert.ok(actionIdx > -1, "delete branch still present in the action");
    const slice = src.slice(actionIdx, actionIdx + 300);
    assert.ok(slice.includes("deleteClosetItemWithImage(itemId, customer.id)"), "delete action unchanged — still scoped to this item + customer");
  });
});
