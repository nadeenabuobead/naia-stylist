// app/routes/closet-assess.test.ts
// Contract tests for the /api/closet-assess endpoint.
//
// Static source-code assertions — no DB, no Cloudinary, no Claude calls.
// Covers:
//   T1  Action is exported (no loader, no component)
//   T2  Auth: getCurrentNaiaCustomer called before any DB item fetch
//   T3  Ownership: item.customerId checked against customer.id before Stage B
//   T4  Idempotency: tryOnEligibility !== "pending-assessment" → returns stored result without AI
//   T5  Client cannot supply imagePublicId — only itemId accepted from formData
//   T6  Image URL built server-side via buildPrivateDownloadUrl (not from client)
//   T7  Stage B called only via assessClosetEligibilityStageB (the injectable function)
//   T8  DB written (closetItem.update) before the success response on genuine result
//   T9  Timeout → assessmentFailed: true returned, no DB write in that branch
//   T10 visual-assessment-failed → assessmentFailed: true returned, no DB write in that branch
//   T11 closet._index.tsx no longer imports or calls runStageBAssessment
//   T12 closet._index.tsx adds pendingAssessment + itemId to add action response
//   T13 closet._index.tsx adds pendingAssessment + itemId to edit action response
//   T14 closet._index.tsx imports useRevalidator

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const assess  = readFileSync(join(__dirname, "api.closet-assess.ts"), "utf8");
const closet  = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");

// ── T1: Action exported, no loader / component ────────────────────────────────

describe("T1: action exported; no loader or default component", () => {
  it("exports an action function", () => {
    assert.ok(
      assess.includes("export async function action"),
      "api.closet-assess must export an action function",
    );
  });

  it("does not export a loader", () => {
    assert.ok(
      !assess.includes("export async function loader") && !assess.includes("export function loader"),
      "api.closet-assess must not export a loader",
    );
  });

  it("does not export a default component", () => {
    assert.ok(
      !assess.includes("export default function"),
      "api.closet-assess must not export a default component",
    );
  });
});

// ── T2: Auth before DB item fetch ─────────────────────────────────────────────

describe("T2: auth resolved before item DB lookup", () => {
  it("imports getCurrentNaiaCustomer", () => {
    assert.ok(
      assess.includes("getCurrentNaiaCustomer"),
      "assess endpoint must import and call getCurrentNaiaCustomer",
    );
  });

  it("auth check appears before closetItem.findUnique", () => {
    const authIdx = assess.indexOf("getCurrentNaiaCustomer");
    const dbIdx   = assess.indexOf("closetItem.findUnique");
    assert.ok(authIdx !== -1, "getCurrentNaiaCustomer must be present");
    assert.ok(dbIdx   !== -1, "closetItem.findUnique must be present");
    assert.ok(authIdx < dbIdx, "auth must appear before item DB lookup");
  });
});

// ── T3: Ownership enforced ────────────────────────────────────────────────────

describe("T3: item.customerId checked against customer.id before Stage B", () => {
  it("contains an ownership comparison", () => {
    assert.ok(
      assess.includes("item.customerId !== customer.id") ||
      assess.includes("item.customerId === customer.id"),
      "assess endpoint must compare item.customerId against customer.id",
    );
  });

  it("ownership check appears before assessClosetEligibilityStageB call", () => {
    const ownerIdx = assess.indexOf("item.customerId");
    const stageIdx = assess.indexOf("assessClosetEligibilityStageB");
    assert.ok(ownerIdx !== -1, "ownership check must exist");
    assert.ok(stageIdx !== -1, "assessClosetEligibilityStageB call must exist");
    assert.ok(ownerIdx < stageIdx, "ownership check must precede Stage B call");
  });
});

// ── T4: Idempotency ───────────────────────────────────────────────────────────

describe("T4: idempotency — non-pending item returns stored result without AI", () => {
  it("checks tryOnEligibility !== pending-assessment", () => {
    assert.ok(
      assess.includes('tryOnEligibility !== "pending-assessment"'),
      "assess endpoint must check tryOnEligibility !== \"pending-assessment\" for idempotency",
    );
  });

  it("idempotency check appears before assessClosetEligibilityStageB call", () => {
    const idemIdx  = assess.indexOf('"pending-assessment"');
    const stageIdx = assess.indexOf("assessClosetEligibilityStageB");
    assert.ok(idemIdx < stageIdx, "idempotency check must appear before Stage B call");
  });
});

// ── T5: Client cannot supply imagePublicId ────────────────────────────────────

describe("T5: imagePublicId is never read from formData — only itemId is accepted", () => {
  it("reads itemId from formData", () => {
    assert.ok(
      assess.includes('formData.get("itemId")'),
      "assess endpoint must read itemId from formData",
    );
  });

  it("does not read imagePublicId or imageUrl from formData", () => {
    assert.ok(
      !assess.includes('formData.get("imagePublicId")') &&
      !assess.includes('formData.get("imageUrl")'),
      "assess endpoint must never read imagePublicId or imageUrl from formData — loaded from DB only",
    );
  });
});

// ── T6: Server-side URL build ─────────────────────────────────────────────────

describe("T6: image URL built server-side via buildPrivateDownloadUrl", () => {
  it("imports buildPrivateDownloadUrl", () => {
    assert.ok(
      assess.includes("buildPrivateDownloadUrl"),
      "assess endpoint must build the signed URL server-side via buildPrivateDownloadUrl",
    );
  });

  it("buildPrivateDownloadUrl called with item.imagePublicId (from DB)", () => {
    assert.ok(
      assess.includes("item.imagePublicId"),
      "buildPrivateDownloadUrl must use imagePublicId loaded from DB",
    );
  });
});

// ── T7: Stage B called via assessClosetEligibilityStageB ─────────────────────

describe("T7: Stage B invoked via assessClosetEligibilityStageB", () => {
  it("imports assessClosetEligibilityStageB", () => {
    assert.ok(
      assess.includes("assessClosetEligibilityStageB"),
      "assess endpoint must call assessClosetEligibilityStageB",
    );
  });
});

// ── T8: DB written before response on genuine result ─────────────────────────

describe("T8: DB updated before the success response on a genuine Stage B result", () => {
  it("closetItem.update called in the successful path", () => {
    assert.ok(
      assess.includes("closetItem.update"),
      "assess endpoint must call closetItem.update to persist Stage B result",
    );
  });

  it("closetItem.update appears before the final return data on the success path", () => {
    const updateIdx = assess.lastIndexOf("closetItem.update");
    const returnIdx = assess.lastIndexOf("return data(");
    assert.ok(updateIdx !== -1, "closetItem.update must exist");
    assert.ok(returnIdx !== -1, "return data must exist");
    assert.ok(updateIdx < returnIdx, "DB update must appear before the final return data");
  });
});

// ── T9: Timeout → assessmentFailed, no DB write ──────────────────────────────

describe("T9: timeout returns assessmentFailed without writing to DB", () => {
  it("handles null timeout result", () => {
    assert.ok(
      assess.includes("result === null"),
      "assess endpoint must handle the timeout case (result === null)",
    );
  });

  it("assessmentFailed is returned on timeout", () => {
    const timeoutIdx = assess.indexOf("result === null");
    const failBlock  = assess.slice(timeoutIdx, timeoutIdx + 300);
    assert.ok(
      failBlock.includes("assessmentFailed"),
      "timeout branch must return assessmentFailed: true",
    );
  });

  it("timeout branch does not call closetItem.update", () => {
    const timeoutIdx = assess.indexOf("result === null");
    const nextReturn = assess.indexOf("return data(", timeoutIdx);
    const block = assess.slice(timeoutIdx, nextReturn + 50);
    assert.ok(
      !block.includes("closetItem.update"),
      "timeout branch must NOT call closetItem.update",
    );
  });
});

// ── T10: visual-assessment-failed → assessmentFailed, no DB write ────────────

describe("T10: visual-assessment-failed returns assessmentFailed without writing to DB", () => {
  it("checks for visual-assessment-failed", () => {
    assert.ok(
      assess.includes('"visual-assessment-failed"'),
      "assess endpoint must check for visual-assessment-failed from Stage B",
    );
  });

  it("failure branch returns assessmentFailed and does not call closetItem.update", () => {
    const failIdx   = assess.indexOf('"visual-assessment-failed"');
    const nextReturn = assess.indexOf("return data(", failIdx);
    // Use 200 chars past the return statement start to cover the full return line.
    const block = assess.slice(failIdx, nextReturn + 200);
    assert.ok(block.includes("assessmentFailed"), "failure branch must return assessmentFailed: true");
    assert.ok(!block.includes("closetItem.update"), "failure branch must NOT call closetItem.update");
  });
});

// ── T11: closet._index.tsx no longer uses runStageBAssessment ─────────────────

describe("T11: closet._index.tsx does not import or call runStageBAssessment", () => {
  it("does not import runStageBAssessment", () => {
    assert.ok(
      !closet.includes("runStageBAssessment"),
      "closet._index.tsx must not import or call runStageBAssessment — Stage B is now via /api/closet-assess",
    );
  });
});

// ── T12: Add action returns pendingAssessment + itemId ────────────────────────

describe("T12: add action response includes pendingAssessment and itemId", () => {
  it("add action response includes pendingAssessment", () => {
    const addIdx = closet.indexOf('intent === "add"');
    assert.ok(addIdx !== -1, "add intent handler must exist");
    // Add block is long (~200 lines of upload/verify/moderate/assess/DB); use a wide window.
    const block = closet.slice(addIdx, addIdx + 13000);
    assert.ok(
      block.includes("pendingAssessment"),
      "add action must include pendingAssessment in its success response",
    );
  });

  it("add action response includes itemId", () => {
    const addIdx = closet.indexOf('intent === "add"');
    const block = closet.slice(addIdx, addIdx + 13000);
    assert.ok(
      block.includes("itemId"),
      "add action must include itemId in its success response for Stage B routing",
    );
  });
});

// ── T13: Edit action returns pendingAssessment + itemId ───────────────────────

describe("T13: edit photo-replacement action response includes pendingAssessment and itemId", () => {
  it("edit action response includes pendingAssessment", () => {
    const editIdx = closet.indexOf('intent === "edit"');
    assert.ok(editIdx !== -1, "edit intent handler must exist");
    const block = closet.slice(editIdx, editIdx + 10000);
    assert.ok(
      block.includes("pendingAssessment"),
      "edit action must include pendingAssessment in its success response",
    );
  });

  it("edit action response includes itemId", () => {
    const editIdx = closet.indexOf('intent === "edit"');
    const block = closet.slice(editIdx, editIdx + 10000);
    assert.ok(
      block.includes("itemId"),
      "edit action must include itemId in its success response for Stage B routing",
    );
  });
});

// ── T14: closet._index.tsx imports useRevalidator ─────────────────────────────

describe("T14: closet._index.tsx imports and uses useRevalidator", () => {
  it("imports useRevalidator from react-router", () => {
    assert.ok(
      closet.includes("useRevalidator"),
      "closet._index.tsx must import useRevalidator for post-assess loader refresh",
    );
  });
});
