// app/lib/ai/design-signal.test.ts
// Run with: node --test --import tsx/esm app/lib/ai/design-signal.test.ts
//
// Two things under test. First, the signal contract: what evidence it carries,
// and the stage it is allowed to claim. Second — and this is the one that has
// to hold for the product to stay honest — the architectural boundary. Wardrobe
// Intelligence must never be able to read the NADINE catalogue, because a need
// that exists because there is something to sell is not a need.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  buildDesignSignals,
  bucketByNeed,
  coOccurrence,
  EVIDENCE_STAGES,
  MIN_GROUP_SIZE,
  type DesignSignal,
} from "./design-signal.ts";
import { ELIGIBLE_WHERE, CONSENT_VERSION } from "./design-signal.server.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function needs(over: Record<string, unknown> = {}) {
  return {
    state: "available",
    registers: [
      { register: "work", label: "work", distinctLooks: 3, usableCount: 10, needed: true },
    ],
    couldUseMore: [{
      id: "need-work-repetition", kind: "could-use-more", register: "work",
      title: "Your work dressing repeats one formula",
      body: "Ten pieces that mostly make the same outfit.",
      garmentIds: [], evidence: [], strength: "strong",
    }],
    enough: [],
    styleMe: { state: "available", requests: [{ register: "work", sessions: 12 }] },
    outcomes: { state: "available", totalOutcomes: 0, keptNote: null, changedNote: null },
    ...over,
  } as never;
}

const recs = {
  state: "available",
  recommendations: [{ id: "rec-work", register: "work", title: "A full-length work bottom" }],
  notAPriority: [],
} as never;

function build(customerId: string, over: Record<string, unknown> = {}): DesignSignal[] {
  return buildDesignSignals({
    customerId,
    needs: needs(over),
    recommendations: recs,
    closetCompleteness: "mostly",
    passportRequirements: ["full-length coverage"],
    underrepresentedColours: ["grey"],
    fitCoverageRequirements: ["legs covered"],
  });
}

// ── §DS-1 — the contract ──────────────────────────────────────────────────────

describe("§DS-1 signal contract", () => {
  it("§DS-1a one signal per unresolved need, not per garment or recommendation", () => {
    const signals = build("c1");
    assert.equal(signals.length, 1);
    assert.equal(signals[0].register, "work");
  });

  it("§DS-1b every claim names its source and its stage", () => {
    for (const claim of build("c1")[0].claims) {
      assert.ok(["passport", "closet", "styleme", "feedback"].includes(claim.source), claim.statement);
      assert.ok(EVIDENCE_STAGES.includes(claim.stage), claim.statement);
    }
  });

  it("§DS-1c what nAia worked out is marked inferred, not confirmed", () => {
    const derived = build("c1")[0].claims.find((c) => c.source === "closet")!;
    assert.equal(derived.stage, "inferred");
  });

  it("§DS-1d what she actually said is marked confirmed", () => {
    const claims = build("c1")[0].claims;
    assert.equal(claims.find((c) => c.source === "passport")!.stage, "confirmed");
    assert.equal(claims.find((c) => c.source === "styleme")!.stage, "confirmed");
  });

  it("§DS-1e a signal with only derived evidence never claims more than inferred", () => {
    const signals = buildDesignSignals({
      customerId: "c1",
      needs: needs({
        registers: [{ register: "work", label: "work", distinctLooks: 3, usableCount: 10, needed: false }],
        styleMe: { state: "available", requests: [] },
      }),
      recommendations: recs,
      closetCompleteness: "unknown",
    });
    assert.equal(signals[0].stage, "inferred");
  });

  it("§DS-1f an incomplete Closet is carried, not hidden", () => {
    const signals = buildDesignSignals({
      customerId: "c1", needs: needs(), recommendations: recs, closetCompleteness: "still-adding",
    });
    assert.equal(signals[0].closetCompleteness, "still-adding");
  });

  it("§DS-1g underrepresented colour is context, never the need itself", () => {
    const signal = build("c1")[0];
    assert.deepEqual(signal.underrepresentedColours, ["grey"]);
    assert.doesNotMatch(signal.need, /grey/i);
  });
});

// ── §DS-2 — counting ──────────────────────────────────────────────────────────

describe("§DS-2 counting people, not rows", () => {
  it("§DS-2a a customer with many signals still counts once", () => {
    const many = [...build("c1"), ...build("c1"), ...build("c1")];
    const [bucket] = bucketByNeed(many, 100);
    assert.equal(bucket.customers, 1);
  });

  it("§DS-2b a big Closet does not outvote a small one", () => {
    const buckets = bucketByNeed([...build("big"), ...build("big"), ...build("small")], 100);
    assert.equal(buckets[0].customers, 2);
  });

  it("§DS-2c every bucket carries its denominator", () => {
    for (const b of bucketByNeed(build("c1"), 240)) assert.equal(b.denominator, 240);
  });

  it("§DS-2d incomplete Closets are counted separately", () => {
    const partial = buildDesignSignals({
      customerId: "c2", needs: needs(), recommendations: recs, closetCompleteness: "still-adding",
    });
    const [bucket] = bucketByNeed([...build("c1"), ...partial], 10);
    assert.equal(bucket.customers, 2);
    assert.equal(bucket.incompleteClosets, 1);
  });

  it("§DS-2e co-occurrence only counts requirements held by the SAME person", () => {
    const greyOnly = build("a");
    const fullLengthOnly = build("b").map((s) => ({ ...s, underrepresentedColours: [], passportRequirements: ["full-length coverage"] }));
    const greyPeople = [...greyOnly.map((s) => ({ ...s, passportRequirements: [] })), ...fullLengthOnly];

    // "Some like grey" + "some want full length" is NOT "wants grey full length".
    assert.equal(
      coOccurrence(
        greyPeople,
        (s) => s.underrepresentedColours.includes("grey"),
        (s) => s.passportRequirements.includes("full-length coverage"),
      ),
      0,
    );

    // The same person holding both does count.
    assert.equal(
      coOccurrence(
        build("c1"),
        (s) => s.underrepresentedColours.includes("grey"),
        (s) => s.passportRequirements.includes("full-length coverage"),
      ),
      1,
    );
  });

  it("§DS-2f a suppression threshold exists and is not one", () => {
    assert.ok(MIN_GROUP_SIZE >= 5);
  });
});

// ── §DS-3 — eligibility at the query layer ────────────────────────────────────

describe("§DS-3 eligibility", () => {
  it("§DS-3a eligibility requires consent, the current version, and a real account", () => {
    assert.equal(ELIGIBLE_WHERE.designResearchConsent, true);
    assert.equal(ELIGIBLE_WHERE.designResearchConsentVersion, CONSENT_VERSION);
    assert.equal(ELIGIBLE_WHERE.accountType, "CUSTOMER");
  });

  it("§DS-3b the filter is a query clause, so non-consenting rows are never read", () => {
    const src = readFileSync(new URL("./design-signal.server.ts", import.meta.url), "utf8");
    // Every findMany/count that selects customers must go through ELIGIBLE_WHERE
    // or an explicit accountType clause — never an unfiltered read.
    const reads = src.match(/customer\.(findMany|count)\(\{[\s\S]*?\}\)/g) ?? [];
    assert.ok(reads.length > 0, "there are customer reads to check");
    for (const read of reads) {
      assert.match(read, /ELIGIBLE_WHERE|accountType/, `unfiltered customer read:\n${read}`);
    }
  });
});

// ── §DS-4 — the architectural boundary ────────────────────────────────────────
//
// The rule the whole arrangement depends on. Wardrobe Intelligence works out
// what someone needs without knowing what NADINE sells; the designer layer
// reads those signals afterwards. If this ever reverses, the product is
// manufacturing gaps to fill them.

const WI_MODULES = [
  "wardrobe-intelligence.ts",
  "wardrobe-needs.ts",
  "wardrobe-recommendations.ts",
  "wardrobe-page.ts",
  "wardrobe-copy.ts",
  "wardrobe-snapshot.ts",
];

const CATALOGUE_IMPORT = /from\s+["'][^"']*(nadine|catalogue|catalog|product-feed|shopify-product)[^"']*["']/i;

describe("§DS-4 one-way architecture", () => {
  it("§DS-4a no Wardrobe Intelligence module imports NADINE catalogue data", () => {
    for (const name of WI_MODULES) {
      const url = new URL(`./${name}`, import.meta.url);
      if (!existsSync(url)) continue;
      const src = readFileSync(url, "utf8");
      for (const line of src.split("\n")) {
        if (!line.trimStart().startsWith("import")) continue;
        assert.doesNotMatch(line, CATALOGUE_IMPORT, `${name} reaches into the catalogue: ${line.trim()}`);
      }
    }
  });

  it("§DS-4b the design signal depends on Wardrobe Intelligence, never the reverse", () => {
    const signal = readFileSync(new URL("./design-signal.ts", import.meta.url), "utf8");
    assert.match(signal, /from "~\/lib\/ai\/wardrobe-needs"/);

    for (const name of WI_MODULES) {
      const url = new URL(`./${name}`, import.meta.url);
      if (!existsSync(url)) continue;
      assert.doesNotMatch(
        readFileSync(url, "utf8"),
        /from ["'][^"']*design-signal[^"']*["']/,
        `${name} imports the designer layer, which reverses the dependency`,
      );
    }
  });

  it("§DS-4c a well-covered wardrobe still yields no signal", () => {
    // Independence has to survive the case where there is nothing to sell into.
    const signals = buildDesignSignals({
      customerId: "c1",
      needs: needs({ couldUseMore: [] }),
      recommendations: { state: "available", recommendations: [], notAPriority: [] } as never,
      closetCompleteness: "mostly",
    });
    assert.deepEqual(signals, []);
  });
});
