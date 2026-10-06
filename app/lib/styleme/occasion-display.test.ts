// app/lib/styleme/occasion-display.test.ts
//
// The result page must name the occasion in the words she chose.
//
// Three occasions had drifted, because the display map was keyed on the canonical session ID
// and its values were written independently of the questionnaire:
//
//   chose "Night out / party"    → page said "Evening out"      (no word in common)
//   chose "Date"                 → page said "Date night"
//   chose "Event / celebration"  → page said "Special event"
//
// OD-A..OD-D pin the behaviour. OD-F is the one that matters long-term: it reads the
// questionnaire's own option list and REV3_OCCASION_MAP out of occasion.tsx and proves every
// display label still equals the label that produced it. A unit test on hardcoded strings
// would pass forever while the two files drift apart again; this one cannot.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OCCASION_DISPLAY_LABELS, occasionDisplayFor } from "./occasion-display.js";

const ROOT = process.cwd();

// ── OD-A: the three that were wrong ─────────────────────────────────────────

describe("OD-A — the drifted occasions now echo the questionnaire", () => {
  test("OD-A.1 girls-night displays 'Night out / party'", () => {
    assert.equal(occasionDisplayFor(null, "girls-night"), "Night out / party");
  });

  test("OD-A.2 date-night displays 'Date'", () => {
    assert.equal(occasionDisplayFor(null, "date-night"), "Date");
  });

  test("OD-A.3 special-event displays 'Event / celebration'", () => {
    assert.equal(occasionDisplayFor(null, "special-event"), "Event / celebration");
  });

  test("OD-A.4 none of the replaced wordings survives anywhere in the map", () => {
    const values = Object.values(OCCASION_DISPLAY_LABELS);
    for (const gone of ["Evening out", "Date night", "Special event"]) {
      assert.ok(!values.includes(gone), `"${gone}" is the old invented wording and must be gone`);
    }
  });
});

// ── OD-B: the ones that were already right must not move ───────────────────

describe("OD-B — unchanged occasions stay unchanged", () => {
  test("OD-B.1 dinner still displays 'Dinner'", () => {
    assert.equal(occasionDisplayFor(null, "dinner"), "Dinner");
  });

  test("OD-B.2 active displays 'Busy / on-the-go day'", () => {
    // Renamed: the occasion is a practical day, not a workout. Canonical key stays "active".
    assert.equal(occasionDisplayFor(null, "active"), "Busy / on-the-go day");
  });

  test("OD-B.3 family and travel keep the questionnaire wording", () => {
    assert.equal(occasionDisplayFor(null, "family"), "Family gathering");
    assert.equal(occasionDisplayFor(null, "travel"), "Travel day");
  });
});

// ── OD-C: the stored label wins when present ───────────────────────────────

describe("OD-C — the label she actually saw takes precedence", () => {
  test("OD-C.1 a stored label is used verbatim", () => {
    assert.equal(occasionDisplayFor("Night out / party", "girls-night"), "Night out / party");
  });

  test("OD-C.2 a stored label from older questionnaire copy is still honoured", () => {
    // The point of capturing it: a suggestion keeps the wording of its own time rather than
    // being retro-relabelled when the questionnaire copy changes.
    assert.equal(occasionDisplayFor("Girls' night", "girls-night"), "Girls' night");
  });

  test("OD-C.3 surrounding whitespace is trimmed, not treated as content", () => {
    assert.equal(occasionDisplayFor("  Dinner  ", "dinner"), "Dinner");
  });
});

// ── OD-D: the fallback is safe for anything older or unknown ───────────────

describe("OD-D — fallback behaviour", () => {
  test("OD-D.1 a suggestion with no stored label falls back to the canonical map", () => {
    assert.equal(occasionDisplayFor(undefined, "girls-night"), "Night out / party");
    assert.equal(occasionDisplayFor(null, "work"), "Work or meetings");
  });

  test("OD-D.2 a blank or whitespace-only stored label is treated as absent", () => {
    // An empty "Dressing for" value is worse than slightly stale wording.
    assert.equal(occasionDisplayFor("", "dinner"), "Dinner");
    assert.equal(occasionDisplayFor("   ", "dinner"), "Dinner");
  });

  test("OD-D.3 an unrecognised canonical ID renders as itself, never blank", () => {
    assert.equal(occasionDisplayFor(null, "some-future-occasion"), "some-future-occasion");
  });

  test("OD-D.4 no occasion at all yields an empty string, and the caller hides the row", () => {
    // result.tsx renders this block only when loaderData.occasion is truthy, so this value
    // is never printed; the assertion pins that it cannot throw or print "undefined".
    assert.equal(occasionDisplayFor(null, null), "");
    assert.equal(occasionDisplayFor(null, undefined), "");
  });
});

// ── OD-E: every canonical occasion the session can store has a label ───────

describe("OD-E — coverage of the canonical vocabulary", () => {
  test("OD-E.1 all ten canonical occasions resolve to a human label", () => {
    for (const o of ["everyday", "work", "dinner", "date-night", "special-event",
                     "girls-night", "family", "travel", "active", "not-sure"]) {
      const label = occasionDisplayFor(null, o);
      assert.ok(label && label !== o, `${o} must resolve to a written label, got ${label}`);
    }
  });

  test("OD-E.2 no canonical ID leaks through as display text", () => {
    // Was `!label.includes("-")`, using a hyphen as the proxy for "looks like an ID".
    // Too crude: "Busy / on-the-go day" is written English that happens to hyphenate.
    // The real property is that a label must not be ID-SHAPED — all lowercase, hyphen
    // separated, no spaces, which is what "date-night" looks like.
    for (const [id, label] of Object.entries(OCCASION_DISPLAY_LABELS)) {
      assert.notEqual(label, id, `${id} renders as its own key`);
      // ID-shaped = all lowercase, hyphen separated ("date-night"). Single written words
      // like "Dinner" are fine, so the check is capitalisation + shape, not word count.
      assert.doesNotMatch(label, /^[a-z]+(-[a-z]+)*$/,
        `${id} renders as "${label}", which still looks like an ID`);
    }
  });
});

// ── OD-F: the display label IS the questionnaire label ─────────────────────
//
// The guard against the original defect recurring. Reads the questionnaire's own option list
// and REV3_OCCASION_MAP from source and proves the correspondence, so the two cannot drift
// apart again silently.

describe("OD-F — display labels are derived from the questionnaire, not written beside it", () => {
  const src = readFileSync(join(ROOT, "app/routes/style-me/occasion.tsx"), "utf8");

  /** { id, label } pairs from the `occasions` array. */
  const options = [...src.matchAll(/\{\s*id:\s*"([a-z-]+)"\s*,\s*label:\s*"([^"]+)"\s*\}/g)]
    .map((m) => ({ id: m[1], label: m[2] }));

  /** UI id → canonical id from REV3_OCCASION_MAP. */
  const mapBody = src.slice(
    src.indexOf("const REV3_OCCASION_MAP"),
    src.indexOf("};", src.indexOf("const REV3_OCCASION_MAP")),
  );
  const uiToCanonical = Object.fromEntries(
    [...mapBody.matchAll(/"([a-z-]+)":\s*"([a-z-]+)"/g)].map((m) => [m[1], m[2]]),
  );

  test("OD-F.1 the questionnaire was parsed — guards the regexes themselves", () => {
    // Without this, a changed source shape would silently yield zero options and OD-F.2
    // would vacuously pass.
    const occasionOpts = options.filter((o) => !o.id.startsWith("formality-"));
    assert.ok(occasionOpts.length >= 9, `expected the nine occasion options, parsed ${occasionOpts.length}`);
    assert.equal(uiToCanonical["night-out"], "girls-night", "REV3_OCCASION_MAP was not parsed");
  });

  test("OD-F.2 every questionnaire option's label is what its canonical ID displays", () => {
    for (const { id, label } of options) {
      if (id.startsWith("formality-")) continue;          // dressiness options, not occasions
      const canonical = uiToCanonical[id] ?? id;
      if (canonical === "not-sure") continue;             // "other" → no questionnaire wording to echo
      assert.equal(
        OCCASION_DISPLAY_LABELS[canonical], label,
        `she chooses "${label}" (${id}) and the result would say ` +
        `"${OCCASION_DISPLAY_LABELS[canonical]}" — these must be the same words`,
      );
    }
  });
});

// ── OD-G: the route uses the helper, and the old map is gone ───────────────

describe("OD-G — result.tsx renders through the helper", () => {
  const src = readFileSync(join(ROOT, "app/routes/style-me/result.tsx"), "utf8");

  test("OD-G.1 the local OCCASION_LABELS map no longer exists", () => {
    assert.ok(!src.includes("OCCASION_LABELS"),
      "the superseded local map must be removed, not left shadowing the shared one");
  });

  test("OD-G.2 both 'Dressing for' values go through occasionDisplayFor", () => {
    const uses = src.split("occasionDisplayFor(").length - 1;
    assert.ok(uses >= 2, `expected both display sites to use the helper; found ${uses}`);
  });

  test("OD-G.3 the captured label is threaded into the loader's fresh-generation return", () => {
    assert.ok(src.includes('occasionDisplayLabel: (cookieSession.get("styleMeOccasionDisplayLabel")'),
      "the loader must pass the captured questionnaire wording to the page");
  });
});
