// app/lib/styleme/anchor-rejection-visible.test.ts
//
// A refusal the customer cannot see is indistinguishable from a broken button.
//
// set-anchor correctly refuses a hand-picked anchor that fails her Passport's dressing
// requirements, and returns the reason:
//
//   return data({ error: eligibility.message, anchorRejectionCode: eligibility.code },
//               { status: 400 });
//
// But source.tsx never called useActionData, so no step rendered it. Live trace from
// manual QA — four CONTINUE presses, four silent refusals:
//
//   10:48:53  POST /style-me/source.data  400
//   10:48:58  POST /style-me/source.data  400
//   10:48:59  POST /style-me/source.data  400
//   10:49:04  POST /style-me/source.data  400
//
// The picker's button is disabled={!selected}, so closetItemId was certainly submitted,
// which rules out the "Please select a Closet item" branch and leaves the eligibility
// refusal as the only 400 that path can produce.
//
// WHAT THIS FIX IS NOT. The refusal itself is right and is untouched: an anchor appears in
// every candidate, so an ineligible one would quietly break a requirement she set, and
// substituting a different garment would be worse — she chose that piece deliberately.
// This only makes the existing answer visible.
//
// Pre-existing, not a B.2 defect: the same dead end exists in the ordinary nAia flow,
// where the source lock forces my-closet and the manual picker is reached the same way.
// B.2 only changed which door led there.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateAnchorEligibility } from "../ai/styleme-profile-gate.js";
import type { ClosetAnchorInput } from "../ai/styleme-recommendation.types.js";

const src = (): string =>
  readFileSync(join(process.cwd(), "app/routes/style-me/source.tsx"), "utf8");

/** The slice of source.tsx for one component. */
const component = (name: string): string => {
  const text = src();
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return "";
  const next = text.indexOf("\nfunction ", i + 1);
  return text.slice(i, next > 0 ? next : undefined);
};

const anchorInput = (o: Partial<ClosetAnchorInput>): ClosetAnchorInput =>
  ({ hemLength: null, topLength: null, approvedProfile: null, ...o } as unknown as ClosetAnchorInput);

// ── AR-A: the refusal still happens, and still explains itself ─────────────

describe("AR-A — the eligibility refusal is unchanged", () => {
  test("AR-A.1 an ineligible anchor is refused with a message and a code", () => {
    // legs-covered against a mini hem: the garment cannot satisfy it and no layer can
    // change that, which is exactly the case the refusal exists for.
    const r = evaluateAnchorEligibility(
      anchorInput({ hemLength: "mini" }), "everyday", ["legs-covered"],
    );
    assert.equal(r.eligible, false, "the refusal must not be weakened by this fix");
    assert.ok(r.message && r.message.length > 0, "it must carry a message to show her");
    assert.ok(r.code, "and a code, which the action returns as anchorRejectionCode");
  });

  test("AR-A.2 an eligible anchor is still accepted", () => {
    const r = evaluateAnchorEligibility(
      anchorInput({ hemLength: "full" }), "everyday", ["legs-covered"],
    );
    assert.equal(r.eligible, true);
  });

  test("AR-A.3 the action still returns the refusal shape at 400", () => {
    const text = src();
    assert.ok(/anchorRejectionCode: eligibility\.code/.test(text),
      "the code must still reach the client");
    assert.ok(/error: eligibility\.message/.test(text),
      "and the message, which is what she reads");
    const setAnchor = text.slice(text.indexOf('intent === "set-anchor"'));
    assert.ok(/status: 400/.test(setAnchor.slice(0, 2000)),
      "a refusal is a 400, not a redirect — she must stay on the picker");
    assert.ok(/evaluateAnchorEligibility\(/.test(setAnchor.slice(0, 2000)),
      "the gate itself must still run");
  });
});

// ── AR-B: it is now visible ───────────────────────────────────────────────

describe("AR-B — the message reaches the screen", () => {
  test("AR-B.1 source.tsx reads the action response at all", () => {
    assert.ok(/useActionData/.test(src()),
      "without this, every 400 from this route is invisible and CONTINUE looks broken");
  });

  test("AR-B.2 the closet-anchor picker renders the error", () => {
    const c = component("ClosetAnchorStep");
    assert.ok(c.length > 0, "the picker component must exist");
    assert.ok(/actionError|ActionError|actionData/.test(c),
      "the step that triggers the refusal must display it");
  });

  test("AR-B.3 the anchor-method step renders the error", () => {
    const c = component("AnchorMethodStep");
    assert.ok(/actionError|ActionError|actionData/.test(c),
      "its own 400 (invalid anchor method) must not be silent either");
  });

  test("AR-B.4 the source step renders the error", () => {
    const c = component("SourceStep");
    assert.ok(/actionError|ActionError|actionData/.test(c),
      "'Please select what we're styling' must not be silent either");
  });

  test("AR-B.5 no 400 the action can return is left unrendered", () => {
    // Enumerated deliberately: every 400 belongs to a step a customer can be sitting on,
    // except the catch-all, which no component submits.
    const text = src();
    const four00s = (text.match(/status: 400/g) ?? []).length;
    assert.ok(four00s >= 4, `expected the known 400 paths; found ${four00s}`);
    for (const name of ["SourceStep", "AnchorMethodStep", "ClosetAnchorStep"]) {
      assert.ok(/actionError|ActionError|actionData/.test(component(name)),
        `${name} can receive a 400 and must be able to show it`);
    }
  });
});

// ── AR-C: she stays put, and can pick something else ──────────────────────

describe("AR-C — recovery without losing her place", () => {
  test("AR-C.1 a refusal does not redirect her away from the picker", () => {
    const text = src();
    const setAnchor = text.slice(text.indexOf('intent === "set-anchor"'));
    const upToRefusal = setAnchor.slice(0, setAnchor.indexOf("status: 400") + 20);
    assert.ok(!/return redirect\(/.test(upToRefusal),
      "the refusal path must not navigate — she needs to stay where her options are");
  });

  test("AR-C.2 the picker still offers every item, so she can choose another", () => {
    const c = component("ClosetAnchorStep");
    assert.ok(/items\.map\(/.test(c), "all her items must remain listed after a refusal");
    assert.ok(/setSelected\(item\.id\)/.test(c), "and remain selectable");
    assert.ok(/disabled=\{!selected\}/.test(c),
      "CONTINUE stays guarded, so an empty submission is still impossible");
  });

  test("AR-C.3 an eligible pick still proceeds to the result", () => {
    const text = src();
    const setAnchor = text.slice(text.indexOf('intent === "set-anchor"'));
    // Window widened: the rejection branch now also remembers a rejected pick as pending
    // (styleMePendingClosetAnchorId, for Change Occasion), pushing this success block
    // further from the start of the action than it used to sit.
    const block = setAnchor.slice(0, 3200);
    assert.ok(/session\.set\("styleMeClosetAnchorId", closetItemId\)/.test(block));
    assert.ok(/session\.set\("styleMeAnchorProvenance", "MANUAL"\)/.test(block),
      "a hand-picked anchor stays MANUAL, so New Look cannot move it");
    assert.ok(/redirect\("\/style-me\/result"/.test(block));
  });
});

// ── AR-D: the auto path is untouched ──────────────────────────────────────

describe("AR-D — auto-anchor behaviour is unchanged", () => {
  test("AR-D.1 auto still selects, stamps AUTO, and goes to the result", () => {
    const text = src();
    const method = text.slice(text.indexOf('intent === "set-anchor-method"'));
    // Window widened again: an auto-selected anchor is never part of a WI
    // combination, so this branch now also drops any stale
    // styleMeClosetCompanionIds before redirecting — one more line between the
    // AUTO stamp and the redirect this block already asserts.
    const block = method.slice(0, 2700);
    assert.ok(/autoSelectClosetAnchor\(/.test(block));
    assert.ok(/session\.set\("styleMeAnchorProvenance", "AUTO"\)/.test(block));
    assert.ok(/redirect\("\/style-me\/result"/.test(block));
  });

  test("AR-D.2 the auto failure signal it already had still works", () => {
    const text = src();
    assert.ok(/styleMeAutoAnchorFail/.test(text),
      "auto already had a visible failure path — the manual path was the odd one out");
    assert.ok(/autoAnchorFail/.test(component("AnchorMethodStep")));
  });
});
