// app/lib/ai/wardrobe-page.test.ts
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-page.test.ts
//
// The contract here is about REPETITION. Earlier passes removed individual
// duplicate blocks and the page still said the same thing four times, because
// dedup ran on observation kind and garment id rather than on meaning. These
// tests pin the rule that replaced it: one claim, one home, everywhere.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWardrobePage,
  duplicateClaims,
  auditClaims,
  visibleCopy,
  ownerOf,
  claims,
  SECTION_ORDER,
  type WardrobePageInput,
} from "./wardrobe-page.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Hand-built rather than engine-generated: these tests are about the page model,
// and a fixture that runs the engine would fail for engine reasons.

function finding(over: Record<string, unknown> = {}) {
  return {
    id: "f1", kind: "enough", register: "everyday",
    title: "You already have enough everyday neutral tops",
    body: "You own 8 of these that work with the rest of your Closet.",
    garmentIds: ["g1", "g2"], evidence: [], strength: "strong",
    ...over,
  } as never;
}

function baseInput(over: Partial<WardrobePageInput> = {}): WardrobePageInput {
  const intelligence = {
    ready: true,
    snapshotReading: "Your wardrobe leans neutral, everyday and black-anchored.",
    heroes: { state: "available", heroes: [
      { garmentId: "g1", name: "Cream Ribbed Knit Tank Top", category: "TOPS",
        label: "most-versatile", labelText: null,
        headline: "One of your most versatile pieces.", reasons: ["It works with a lot of what you own."] },
    ] },
    pairings: { state: "available", untriedPresentation: "none", untriedNote: null, pairings: [
      { id: "p1", garmentIds: ["g1", "g3"], reason: "They sit at the same level of dress.", untried: false },
    ] },
    observations: [
      { id: "o1", kind: "contradiction-potential-struggle", tier: "discovery",
        headline: "Hard to style, but well connected",
        observation: "You've marked Cream Ribbed Knit Tank Top as difficult to style.",
        explanation: null, action: null, garmentIds: ["g1"] },
      { id: "o2", kind: "contradiction-alignment-unused", tier: "pattern",
        headline: "Strongly yours, but not yet in a look",
        observation: "nAia hasn't put this in a look yet.",
        explanation: null, action: null, garmentIds: ["g4"] },
    ],
    opportunities: { rediscover: [
      { garmentId: "g1", name: "Cream Ribbed Knit Tank Top", imageUrl: null,
        body: "Worth another look.", worksWithIds: ["g3", "g5"] },
    ] },
    passportView: { state: "available", comparisons: [] },
    wear: { learningNote: "nAia doesn't know what you actually wear yet." },
    dna: { palette: [], shapes: [], traits: [], shapesReading: null },
    snapshot: [], signalAvailability: [], coverage: null,
  } as never;

  const needs = {
    state: "available",
    registers: [
      { register: "everyday", label: "everyday and casual", depthLabel: "Strong everyday depth",
        depthNote: "You can dress for this.", rawCount: 20, usableCount: 18, blockedCount: 0,
        unknownCount: 2, distinctLooks: 9, needed: true },
      { register: "work", label: "work", depthLabel: "Limited work range",
        depthNote: "Your work dressing repeats.", rawCount: 10, usableCount: 10, blockedCount: 0,
        unknownCount: 0, distinctLooks: 3, needed: true },
    ],
    enough: [finding()],
    couldUseMore: [finding({
      id: "need-work-repetition", kind: "could-use-more", register: "work",
      title: "Your work dressing repeats one formula",
      body: "You own 10 pieces that work for work dressing, but they mostly make the same outfit.",
      garmentIds: ["g6"],
    })],
    noUrgentNeed: null,
    synthesis: { state: "available", lines: [] },
    styleMe: { state: "available", reachedFor: [], requests: [{ register: "everyday", sessions: 149 }],
      struggles: [], strongIntentions: [], thinIntentions: [] },
    outcomes: { state: "available", totalOutcomes: 4, keptNote: "You kept most of them.", changedNote: null },
    intentions: { state: "available",
      chosen: [{ intention: "put-together", label: "feel put together", sessions: 60 },
               { intention: "easy", label: "keep things easy", sessions: 20 }],
      closetStrengths: [{ intention: "put-together", label: "feel put together", strong: 22 }] },
    headlines: [
      { id: "need-work-repetition", text: "Your work dressing repeats one formula", source: "depth", evidence: [] },
      { id: "f1", text: "You already have enough everyday neutral tops", source: "depth", evidence: [] },
    ],
  } as never;

  const recommendations = {
    state: "available",
    recommendations: [
      { id: "rec-work", register: "work", specificity: "detailed", title: "A full-length work bottom",
        attributes: [{ kind: "colour", label: "Grey" }],
        body: "A piece like this would work with 4 of the pieces you already own.",
        unlocksIds: ["g7", "g8"], criteria: {}, evidence: [], strength: "strong" },
    ],
    notAPriority: [
      { id: "not-priority-everyday", title: "Another of your everyday neutral tops",
        body: "You already have strong depth here." },
    ],
  } as never;

  return { intelligence, needs, recommendations, closetCount: 46, ...over };
}

// ── §WP-1 — one home per claim ────────────────────────────────────────────────

describe("§WP-1 one home per claim", () => {
  it("§WP-1a no claim is explained twice anywhere on the page", () => {
    const page = buildWardrobePage(baseInput());
    assert.deepEqual(duplicateClaims(page), []);
  });

  it("§WP-1b every full entry sits in the section that owns its claim", () => {
    const page = buildWardrobePage(baseInput());
    for (const loc of auditClaims(page)) {
      if (loc.role !== "full") continue;
      const owner = ownerOf(loc.claim);
      if (owner === null) continue;
      assert.equal(loc.section, owner, `${loc.claim} explained in ${loc.section}, owned by ${owner}`);
    }
  });

  it("§WP-1c opening takeaways point at findings, never re-explain them", () => {
    const page = buildWardrobePage(baseInput());
    const now = page.sections.find((s) => s.id === "now");
    assert.ok(now);
    for (const block of now!.blocks) {
      for (const entry of block.entries) {
        assert.equal(entry.role, "pointer");
        assert.equal(entry.body, undefined, "a takeaway must not carry an explanation");
      }
    }
  });

  it("§WP-1d the work-variety finding is explained once, in the range section", () => {
    const page = buildWardrobePage(baseInput());
    const full = auditClaims(page).filter((l) => l.claim === claims.gap("work") && l.role === "full");
    assert.equal(full.length, 1);
    assert.equal(full[0].section, "range");
  });
});

// ── §WP-2 — specific merges from the feedback ─────────────────────────────────

describe("§WP-2 merges", () => {
  it("§WP-2a 'you have enough' and 'not a priority' become one entry", () => {
    const page = buildWardrobePage(baseInput());
    const locs = auditClaims(page).filter((l) => l.claim === claims.enough("everyday"));
    const fulls = locs.filter((l) => l.role === "full");
    assert.equal(fulls.length, 1, "the claim is explained once");

    const works = page.sections.find((s) => s.id === "works")!;
    const entry = works.blocks.flatMap((b) => b.entries).find((e) => e.claim === claims.enough("everyday"));
    assert.ok(entry?.body);
    // Both halves survive the merge: the depth fact AND the shopping guidance.
    assert.match(entry!.body!, /You own 8 of these/);
    assert.match(entry!.body!, /already have strong depth here/);
    assert.ok(entry!.garmentIds.length > 0, "the pieces that prove it are kept");
  });

  it("§WP-2b a garment is featured once, carrying every note about it", () => {
    const page = buildWardrobePage(baseInput());
    const fulls = auditClaims(page).filter((l) => l.claim === claims.garment("g1") && l.role === "full");
    assert.equal(fulls.length, 1);

    const entry = page.sections
      .flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    const meta = entry.meta as Record<string, unknown>;
    assert.ok(meta.label, "hero label kept");
    assert.ok(meta.rediscover, "rediscovery note kept");
    assert.ok(meta.note, "the difficult-to-style observation kept");
  });

  it("§WP-2c the difficult-to-style note never tells her she is wrong", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /your Closet disagrees|but your Closet says|you're wrong|actually wrong/i);
  });

  it("§WP-2d colour representation is explained once, and colour balance stays separate", () => {
    const input = baseInput();
    (input.needs as unknown as { synthesis: unknown }).synthesis = {
      state: "available",
      lines: [{ id: "synth-colour", kind: "uneven", dimension: "Colour",
        reading: "Everything you own sits inside the palette you named, but only part of it is present.",
        evidence: [] },
        { id: "synth-neutral", kind: "alignment", dimension: "Colour balance",
        reading: "Your neutral-to-colour balance matches what you said you like.", evidence: [] }],
    };
    const page = buildWardrobePage(input);
    const fulls = auditClaims(page).filter((l) => l.claim === "palette-representation" && l.role === "full");
    assert.equal(fulls.length, 1);
    assert.equal(fulls[0].section, "learning");
    // Deduplication must not eat a different finding that happens to share a word.
    const balance = auditClaims(page).filter((l) => l.claim === "passport:colour balance");
    assert.equal(balance.length, 1, "colour balance survives as its own claim");
  });
});

// ── §WP-3 — sequence and naming ───────────────────────────────────────────────

describe("§WP-3 sequence", () => {
  it("§WP-3a sections appear in the agreed order", () => {
    const page = buildWardrobePage(baseInput());
    const ids = page.sections.map((s) => s.id);
    const expected = SECTION_ORDER.filter((id) => ids.includes(id));
    assert.deepEqual(ids, [...expected]);
  });

  it("§WP-3b the combinations section claims nothing about what she has worn", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.match(copy, /Possibilities to try/);
    assert.doesNotMatch(copy, /haven't (worn|tried|explored)|hasn't put (them|these) together|untapped/i);
  });

  it("§WP-3c nAia never reports its own failure to the customer", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /nAia hasn't|nAia has not|hasn't appeared in .* look/i);
  });

  it("§WP-3d empty sections are dropped rather than rendered as headings", () => {
    const input = baseInput();
    (input.intelligence as unknown as { ready: boolean }).ready = false;
    const page = buildWardrobePage(input);
    for (const section of page.sections) assert.ok(section.blocks.length > 0);
  });
});

// ── §WP-4 — basis and confidence ──────────────────────────────────────────────

describe("§WP-4 basis and confidence", () => {
  it("§WP-4a the denominator is stated and matches the Closet", () => {
    const page = buildWardrobePage(baseInput({ closetCount: 46 }));
    assert.match(page.basis, /Based on the 46 pieces you've added to your Closet\./);
  });

  it("§WP-4b unanswered completeness hedges the shopping verdict", () => {
    const page = buildWardrobePage(baseInput());
    const verdict = page.sections.find((s) => s.id === "do")!
      .blocks.flatMap((b) => b.entries).find((e) => e.claim === "buy-verdict")!;
    assert.match(verdict.body!, /based on what's in your Closet so far/i);
  });

  it("§WP-4c 'mostly complete' removes the hedge", () => {
    const page = buildWardrobePage(baseInput({ confidence: "mostly" }));
    const verdict = page.sections.find((s) => s.id === "do")!
      .blocks.flatMap((b) => b.entries).find((e) => e.claim === "buy-verdict")!;
    assert.doesNotMatch(verdict.body ?? "", /could change|first read/i);
    assert.match(page.basis, /most of what you wear/i);
  });

  it("§WP-4d 'still adding' softens the advice further", () => {
    const page = buildWardrobePage(baseInput({ confidence: "still-adding" }));
    const verdict = page.sections.find((s) => s.id === "do")!
      .blocks.flatMap((b) => b.entries).find((e) => e.claim === "buy-verdict")!;
    assert.match(verdict.body!, /first read rather than a final answer/i);
  });
});

// ── §WP-5 — actions ───────────────────────────────────────────────────────────

describe("§WP-5 actions", () => {
  it("§WP-5a a reveal action shows exactly the pieces it names", () => {
    const page = buildWardrobePage(baseInput());
    for (const entry of page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)) {
      if (entry.action?.kind !== "reveal") continue;
      assert.deepEqual(entry.action.garmentIds, entry.garmentIds);
      assert.ok(entry.action.garmentIds.length > 0);
    }
  });

  it("§WP-5b no link action exists unless a destination was supplied", () => {
    const page = buildWardrobePage(baseInput());
    const links = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .filter((e) => e.action?.kind === "link");
    assert.equal(links.length, 0, "a link is only offered when the route can carry the garment");
  });

  it("§WP-5c a supplied destination carries the garment id", () => {
    const page = buildWardrobePage(baseInput({ styleMeGarmentHref: (id) => `/style-me?piece=${id}` }));
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    // g1 already has a reveal action, so the link must not displace it.
    assert.equal(entry.action?.kind, "reveal");
  });

  it("§WP-5d no copy promises a number of outfits", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /\b(three|3|two|2) (ways|outfits|looks) to wear/i);
  });
});
