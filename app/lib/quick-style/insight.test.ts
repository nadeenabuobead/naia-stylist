// app/lib/quick-style/insight.test.ts
//
// Regression coverage for the /quick-style guest-teaser insight logic:
// determinism, full id coverage (no silent "undefined" in output), and that
// nothing here can accidentally reach a network/AI call.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStyleDirection,
  moodOpts,
  occasionOpts,
  feelingOpts,
} from "./insight";

const __dirname = dirname(fileURLToPath(import.meta.url));
const insightSrc = readFileSync(join(__dirname, "insight.ts"), "utf8");

describe("buildStyleDirection is deterministic", () => {
  it("returns the exact same string for the same answers, called twice", () => {
    const answers = { mood: "confident", occasion: "work", feeling: "more-confident" };
    assert.equal(buildStyleDirection(answers), buildStyleDirection({ ...answers }));
  });

  it("produces different text for different answers", () => {
    const a = buildStyleDirection({ mood: "tired", occasion: "travel", feeling: "more-effortless" });
    const b = buildStyleDirection({ mood: "powerful", occasion: "special-event", feeling: "more-powerful" });
    assert.notEqual(a, b);
  });

  it("never contains the literal 'undefined' for any valid combination", () => {
    for (const mood of moodOpts) {
      for (const occasion of occasionOpts) {
        for (const feeling of feelingOpts) {
          const text = buildStyleDirection({ mood: mood.id, occasion: occasion.id, feeling: feeling.id });
          assert.ok(!text.includes("undefined"), `${mood.id}/${occasion.id}/${feeling.id} produced "undefined"`);
          assert.ok(text.length > 20, `${mood.id}/${occasion.id}/${feeling.id} produced a suspiciously short string`);
        }
      }
    }
  });

  it("throws rather than silently degrading on an unrecognized id", () => {
    assert.throws(() => buildStyleDirection({ mood: "not-a-real-mood", occasion: "work", feeling: "more-confident" }));
  });
});

describe("insight.ts never reaches a network or AI provider", () => {
  it("contains no fetch, no Anthropic/OpenAI reference, and no prisma import", () => {
    assert.ok(!insightSrc.includes("fetch("), "no network calls");
    assert.ok(!/anthropic|openai/i.test(insightSrc), "no AI provider reference");
    assert.ok(!insightSrc.includes("prisma"), "no database access");
  });
});
