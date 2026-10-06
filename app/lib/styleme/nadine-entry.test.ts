// app/lib/styleme/nadine-entry.test.ts
//
// PHASE B.2 — the NADINE entry, and the source choice it unlocks.
//
// THREE DOORWAYS, THREE BEHAVIOURS:
//
//   (no origin)    the nAia app. Closet-only, forced by the Rev 3 source lock. Must never
//                  see or inherit the NADINE source choice.
//   "nadine-pdp"   she tapped a specific product. Skips the source screen entirely because
//                  the anchor is already decided. Untouched by B.2.
//   "nadine-entry" she arrived from the NADINE context without choosing a product. This is
//                  the only doorway that offers My Closet / NADINE + My Closet.
//
// WHY THE ENTRY ROUTE MUST NOT SET mode. Arriving from NADINE is not the same as asking for
// NADINE merchandise. The PDP handoff sets mode=nadine because tapping a product IS that
// request; this route only records where she came from, and mode is decided when she picks
// a source. Setting it at entry would make "My Closet" a NADINE-mode session and hand the
// live-five selector a customer who explicitly declined it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  STYLEME_HANDOFF_ORIGIN_KEY,
  HANDOFF_ORIGIN_NADINE_PDP,
  HANDOFF_ORIGIN_NADINE_ENTRY,
  HANDOFF_ENTRY_PATH,
} from "./handoff.js";
import { STYLEME_SESSION_KEYS } from "../session.server.js";

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");

// ── NE-A: the origin vocabulary ────────────────────────────────────────────

describe("NE-A — the entry origin is distinct and recorded", () => {
  test("NE-A.1 nadine-entry is its own value, not the PDP one", () => {
    assert.equal(HANDOFF_ORIGIN_NADINE_ENTRY, "nadine-entry");
    assert.notEqual(HANDOFF_ORIGIN_NADINE_ENTRY, HANDOFF_ORIGIN_NADINE_PDP,
      "the two doorways behave differently and must be distinguishable");
  });

  test("NE-A.2 the entry route is registered", () => {
    assert.ok(/route\("api\/styleme-nadine-entry"/.test(read("app/routes.ts")),
      "the entry action must be reachable");
  });

  test("NE-A.3 the entry route records ONLY the origin — never mode, source or an anchor", () => {
    const src = read("app/routes/api.styleme-nadine-entry.tsx");
    assert.ok(src.includes("HANDOFF_ORIGIN_NADINE_ENTRY"), "it must stamp the entry origin");
    assert.ok(!/session\.set\("styleMeMode"/.test(src),
      "arriving from NADINE is not asking for NADINE merchandise — mode is decided at the " +
      "source screen, and setting it here would make My Closet a NADINE-mode session");
    assert.ok(!/session\.set\("styleMeSource"/.test(src),
      "the source is hers to choose; this route must not pre-empt it");
    // Only SETTING an anchor is forbidden. The route legitimately unsets stale ones, and
    // the first draft of this assertion matched the bare key name either way — it failed
    // on a correct implementation.
    assert.ok(!/session\.set\("styleMeNadineAnchorHandle"/.test(src),
      "no NADINE anchor is implied by arriving without choosing a product");
    assert.ok(!/session\.set\("styleMeClosetAnchorId"/.test(src),
      "no closet anchor is implied either");
    assert.ok(src.includes(HANDOFF_ENTRY_PATH) || src.includes("HANDOFF_ENTRY_PATH"),
      "it must enter the existing Rev 3 questionnaire");
  });

  test("NE-A.4 the entry route is POST-only and origin-guarded, like the PDP handoff", () => {
    const src = read("app/routes/api.styleme-nadine-entry.tsx");
    assert.ok(/export async function action/.test(src), "state-changing writes must be POST");
    assert.ok(!/export async function loader/.test(src), "a GET must not mutate the session");
    assert.ok(/Origin/.test(src) && /403/.test(src), "cross-origin POSTs must be rejected");
  });
});

// ── NE-B: the source choice, only from this doorway ───────────────────────

describe("NE-B — the source screen offers exactly two options", () => {
  const src = () => read("app/routes/style-me/source.tsx");

  test("NE-B.1 the two options are offered only for the nadine-entry origin", () => {
    const text = src();
    assert.ok(/isNadineEntryOrigin\(session\)/.test(text),
      "source.tsx must branch on the session's recorded origin");
    // The Rev 3 lock is what keeps every other doorway closet-only. It must still be
    // there, and must now exempt only the NADINE entry.
    assert.ok(/isRev3 && !isNadineEntry && source !== "my-closet"/.test(text),
      "the closet-only lock must survive, exempting the NADINE entry and nothing else");
  });

  test("NE-B.2 NADINE + My Closet means source=both and mode=nadine", () => {
    // Scoped to the set-source action. A looser whole-file search passed before any of
    // this was wired, because the PDP branch already contained the nadine string — it
    // proved the file mentioned the word, not that the choice did anything.
    const text = src();
    const act = text.slice(text.indexOf('intent === "set-source"'));
    const block = act.slice(0, act.indexOf("// ── ", 200) > 0 ? act.indexOf("// ── ", 200) : 4000);
    assert.ok(/"both"/.test(block), "the both source must be settable from this action");
    // The mode must depend on BOTH the origin and her choice. A literal
    // `set("styleMeMode", "nadine")` would be wrong here — it would make My Closet a
    // nadine session too — so the assertion is on the conditional.
    assert.ok(/source === "both" \? "nadine" : "naia"/.test(block),
      "the mode must be conditional on her choosing both, not set unconditionally");
    assert.ok(/isNadineEntryOrigin\(session\)/.test(block),
      "and conditional on the doorway, so an nAia session cannot reach nadine mode");
  });

  test("NE-B.3 My Closet stays closet-only and naia-moded", () => {
    const text = src();
    const act = text.slice(text.indexOf('intent === "set-source"'));
    const block = act.slice(0, act.indexOf("// ── ", 200) > 0 ? act.indexOf("// ── ", 200) : 4000);
    assert.ok(/: "naia"/.test(block),
      "My Closet must fall to naia so the live-five selector is never reached");
  });

  test("NE-B.4 there is no NADINE-only option", () => {
    const text = src();
    const optionsBlock = text.slice(text.indexOf("REV3_SOURCE_OPTIONS"), text.indexOf("];", text.indexOf("REV3_SOURCE_OPTIONS")));
    assert.ok(!/naia-piece/.test(optionsBlock),
      "a NADINE-only outfit is not offered: the collection is five pieces and a complete " +
      "NADINE look would be repetitive and artificial");
    const ids = [...optionsBlock.matchAll(/id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids.sort(), ["both", "my-closet"]);
  });
});

// ── NE-C: isolation of the other two doorways ─────────────────────────────

describe("NE-C — the other doorways are unchanged", () => {
  test("NE-C.1 an nAia session has no origin, so it cannot reach the choice", () => {
    const text = read("app/routes/style-me/source.tsx");
    // The branch must be gated on the origin, not merely on isRev3 — otherwise every
    // Rev 3 session would be offered NADINE merchandise.
    // Gated on the recorded origin, not merely on isRev3 — otherwise every Rev 3 session
    // would be offered NADINE merchandise.
    assert.ok(/const isNadineEntry = isRev3 && isNadineEntryOrigin\(session\)/.test(text),
      "the choice must be conditioned on the session's recorded origin");
    const choiceBranch = text.slice(text.indexOf("const isNadineEntry ="));
    assert.ok(/if \(isNadineEntry &&/.test(choiceBranch.slice(0, 600)),
      "the source step must be returned only inside that origin branch");
  });

  test("NE-C.2 the PDP handoff still skips the source screen", () => {
    const text = read("app/routes/style-me/source.tsx");
    assert.ok(/readNadineHandoff/.test(text), "the PDP provenance check must remain");
    assert.ok(/nadineHandoff/.test(text) && /redirect\("\/style-me\/result"/.test(text),
      "a verified PDP handoff goes straight to the result — it has already chosen");
  });

  test("NE-C.3 the PDP handoff route is untouched by B.2", () => {
    const src = read("app/routes/api.styleme-handoff.tsx");
    assert.ok(/HANDOFF_ORIGIN_NADINE_PDP/.test(src));
    assert.ok(/session\.set\("styleMeMode", "nadine"\)/.test(src),
      "tapping a specific product IS the request for NADINE merchandise, so that route " +
      "still sets the mode at entry — unlike the generic entry");
  });
});

// ── NE-D: persistence and teardown ────────────────────────────────────────

describe("NE-D — the choice survives, and Start Over clears it", () => {
  test("NE-D.1 Start Over clears the entry origin", () => {
    assert.ok((STYLEME_SESSION_KEYS as readonly string[]).includes(STYLEME_HANDOFF_ORIGIN_KEY),
      "clearStyleMeSession iterates this list, so the origin must be in it or a new " +
      "questionnaire would silently inherit the NADINE doorway");
  });

  test("NE-D.2 Start Over clears the source and mode too", () => {
    for (const k of ["styleMeSource", "styleMeMode"]) {
      assert.ok((STYLEME_SESSION_KEYS as readonly string[]).includes(k), `${k} must be cleared`);
    }
  });

  test("NE-D.3 the chosen mode is persisted at session creation, not just cookied", () => {
    // Phase A writes styleMeMode onto the StylingSession row; that is what makes reload,
    // New Look and Adjust Vibe keep the choice once the cookie is gone.
    const result = read("app/routes/style-me/result.tsx");
    assert.ok(/styleMeMode: sessionStyleMeMode/.test(result),
      "the resolved mode must be written to the StylingSession");
    assert.ok(/resolveStyleMeMode\(\s*session\.styleMeMode/.test(result),
      "New Look must read the persisted mode first");
  });

  test("NE-D.4 the source is persisted as styleFrom, so both survives a reload", () => {
    const result = read("app/routes/style-me/result.tsx");
    assert.ok(/styleFrom:/.test(result), "the chosen source must reach the StylingSession row");
    assert.ok(/source === "both" \? "BOTH"|"both" \? "BOTH"|: "BOTH"/.test(result),
      "both must map to a persisted styleFrom value rather than being dropped");
  });
});

// ── NE-E: the temporary staging QA doorway ────────────────────────────────

describe("NE-E — the staging preview route", () => {
  const src = () => read("app/routes/style-me.nadine-preview.tsx");

  test("NE-E.1 it stamps the entry origin and nothing more", () => {
    const text = src();
    assert.ok(text.includes("HANDOFF_ORIGIN_NADINE_ENTRY"), "it must stamp the entry origin");
    assert.ok(!/session\.set\("styleMeMode"/.test(text),
      "the mode is hers to choose at the source screen, exactly as for the real entry");
    assert.ok(!/session\.set\("styleMeSource"/.test(text), "the source is hers to choose");
    assert.ok(!/session\.set\("styleMeClosetAnchorId"|session\.set\("styleMeNadineAnchorHandle"/.test(text),
      "no anchor is implied");
  });

  test("NE-E.2 it is fenced to staging", () => {
    const text = src();
    assert.ok(/NAIA_PROJECT_VARIANT !== "staging"/.test(text) && /404/.test(text),
      "a GET that mutates session state must not exist in production; QA reaches this by " +
      "typing the URL, which is why it cannot be POST-only like the real entry");
  });

  test("NE-E.3 it is registered, and the real entry remains POST-only", () => {
    const routes = read("app/routes.ts");
    assert.ok(/route\("style-me\/nadine-preview"/.test(routes));
    const real = read("app/routes/api.styleme-nadine-entry.tsx");
    assert.ok(!/export async function loader/.test(real),
      "the production doorway stays POST-only and origin-guarded");
  });

  test("NE-E.4 nothing links to it", () => {
    for (const f of ["extensions/naia-storefront/blocks/style-me-button.liquid",
                     "app/routes/style-me/_index.tsx"]) {
      let text = "";
      try { text = read(f); } catch { continue; }
      assert.ok(!text.includes("nadine-preview"),
        `${f} must not link the staging doorway`);
    }
  });
});

// ── NE-F: the customer-facing copy is part of the contract ────────────────
//
// The screen shipped reading "ONLY MY CLOSET" / "MY CLOSET + BRANDS". Both were wrong for
// this surface. It is reached only from the NADINE context, and the engine evaluates only
// the five approved live handles — there is no generic multi-brand catalogue — so "BRANDS"
// promised a breadth that does not exist.
//
// Pinned exactly, because this is the one place a customer learns what the second option
// will actually do.

describe("NE-F — the NADINE source-choice copy", () => {
  const options = () => {
    const src = read("app/routes/style-me/source.tsx");
    const block = src.slice(src.indexOf("const REV3_SOURCE_OPTIONS"),
                            src.indexOf("];", src.indexOf("const REV3_SOURCE_OPTIONS")));
    return [...block.matchAll(/id:\s*"([a-z-]+)",\s*\n\s*label:\s*"([^"]+)",\s*\n\s*description:\s*"([^"]+)"/g)]
      .map((m) => ({ id: m[1], label: m[2], description: m[3] }));
  };

  test("NE-F.1 both options parse — guards the regex itself", () => {
    assert.equal(options().length, 2, "exactly two options, and both must be readable");
  });

  test("NE-F.2 MY CLOSET reads exactly as approved, and submits my-closet", () => {
    const o = options().find((x) => x.id === "my-closet");
    assert.ok(o, "the closet-only option must submit source=my-closet");
    assert.equal(o!.label, "MY CLOSET");
    assert.equal(o!.description, "Build the look using pieces I already own.");
  });

  test("NE-F.3 NADINE + MY CLOSET reads exactly as approved, and submits both", () => {
    const o = options().find((x) => x.id === "both");
    assert.ok(o, "the mixed option must submit source=both");
    assert.equal(o!.label, "NADINE + MY CLOSET");
    assert.equal(o!.description,
      "Start with what I own, and bring in a NADINE piece only if it genuinely adds something.");
  });

  test("NE-F.4 the word Brands cannot reappear anywhere on this screen", () => {
    const src = read("app/routes/style-me/source.tsx");
    assert.ok(!/brands?/i.test(src.replace(/\/\/.*$/gm, "")),
      "no form of 'brand' belongs on the NADINE source choice: the engine evaluates only " +
      "the five approved live NADINE handles, so it would promise a catalogue breadth " +
      "that does not exist");
  });

  test("NE-F.5 no third option, and no generic multi-brand path", () => {
    const ids = options().map((o) => o.id).sort();
    assert.deepEqual(ids, ["both", "my-closet"],
      "a NADINE-only option is deliberately absent, and nothing else is offered here");
  });

  test("NE-F.6 the labels are display-only — the id is what submits", () => {
    const src = read("app/routes/style-me/source.tsx");
    assert.ok(/onClick=\{\(\) => setSelected\(option\.id\)\}/.test(src),
      "selection must carry option.id, so renaming a label cannot change behaviour");
    assert.ok(/name="source" value=\{selected \?\? ""\}/.test(src),
      "the submitted source must be the selected id");
  });
});
