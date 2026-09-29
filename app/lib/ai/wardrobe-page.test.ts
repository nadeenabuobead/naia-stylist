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
  mergeEnough,
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
    const takeaways = now!.blocks.find((b) => b.kind === "takeaways");
    assert.ok(takeaways, "the opening summary exists");
    assert.ok(takeaways!.entries.length > 0);
    for (const entry of takeaways!.entries) {
      assert.equal(entry.role, "pointer");
      assert.equal(entry.body, undefined, "a takeaway must not carry an explanation");
    }
  });

  it("§WP-1e the Closet description is descriptive, and draws no conclusion", () => {
    const input = baseInput();
    (input.intelligence as unknown as { dna: unknown }).dna = {
      palette: [{ colour: "black", count: 19 }],
      shapes: [{ label: "straight" }],
      traits: [{ id: "t1", label: "neutral", evidence: "most of what you own" }],
      shapesReading: null,
    };
    const page = buildWardrobePage(input);
    const dna = page.sections.find((s) => s.id === "now")!.blocks.find((b) => b.kind === "dna");
    assert.ok(dna, "the description lives in the opening section");
    const shapes = dna!.entries.find((e) => e.id === "dna-shapes")!;
    // Wear behaviour is not captured, so nothing may claim she returns to a shape.
    assert.equal(shapes.title, "Silhouettes that appear most in your Closet");
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /shapes you come back to|you (keep|often) wear|you reach for most/i);
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

  it("§WP-2b a garment is featured once, carrying its label and its note", () => {
    const page = buildWardrobePage(baseInput());
    const fulls = auditClaims(page).filter((l) => l.claim === claims.garment("g1") && l.role === "full");
    assert.equal(fulls.length, 1);

    const entry = page.sections
      .flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    const meta = entry.meta as Record<string, unknown>;
    assert.ok(meta.label, "hero label kept");
    // The rediscovery text and the contradiction observation make the same
    // claim; §WP-6b pins which of the two survives.
    assert.ok(meta.rediscover ?? meta.note, "the piece still carries its note");
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
    // One deliberate, precise exception: "nAia hasn't selected an example to
    // show here" distinguishes "no display was chosen" from "no combination
    // exists" — the opposite of an apology, since the alternative would be
    // claiming the Closet can't make one when that isn't established.
    assert.doesNotMatch(copy, /nAia (?:hasn't|has not)(?! selected an? \w+ example)|hasn't appeared in .* look/i);
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
  it("§WP-5a a reveal action shows what it names, or an honest superset of it", () => {
    const page = buildWardrobePage(baseInput());
    for (const entry of page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)) {
      if (entry.action?.kind !== "reveal") continue;
      if (entry.action.detail) {
        // A text-only reveal ("Why this?") carries no garments of its own.
        assert.equal(entry.action.garmentIds.length, 0);
        continue;
      }
      // Otherwise the reveal can only ADD pieces already implied (e.g. "see
      // all 8" on top of the 6 shown) — never substitute a different set.
      const revealed = new Set(entry.action.garmentIds);
      for (const id of entry.garmentIds) assert.ok(revealed.has(id), `${id} shown but not in the reveal`);
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

// ── §WP-6 — merging must not delete findings ──────────────────────────────────
//
// The first version of the garment merge dropped a real observation: a piece
// known only from a contradiction had no title, and the entry was filtered out.
// Deduplication removes repetition; it never removes information.

describe("§WP-6 merging preserves findings", () => {
  it("§WP-6a a garment known only from an observation still appears", () => {
    const input = baseInput({ garmentName: (id) => (id === "g9" ? "Burgundy Cowl Neck Evening Gown" : null) });
    (input.intelligence as unknown as { observations: unknown[] }).observations = [
      { id: "o3", kind: "contradiction-favourite-isolated", tier: "pattern",
        headline: "A favourite with fewer ways to wear it",
        observation: "You've marked this as one you reach for, but it has fewer natural partners.",
        explanation: null, action: null, garmentIds: ["g9"] },
    ];
    const page = buildWardrobePage(input);
    const copy = visibleCopy(page).join(" ");
    assert.match(copy, /Burgundy Cowl Neck Evening Gown/);
    assert.match(copy, /fewer natural partners/);
  });

  it("§WP-6b one garment entry never states the same claim twice", () => {
    const page = buildWardrobePage(baseInput());
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    const meta = (entry.meta ?? {}) as Record<string, unknown>;
    // The rediscovery note carries the partner count, so it is the one kept.
    assert.ok(meta.rediscover, "the specific statement survives");
    assert.equal(meta.note, undefined, "the duplicate statement is dropped");
  });

  it("§WP-6c the buy verdict names the area and closes the rest", () => {
    const page = buildWardrobePage(baseInput());
    const verdict = page.sections.find((s) => s.id === "do")!
      .blocks.flatMap((b) => b.entries).find((e) => e.claim === "buy-verdict")!;
    assert.match(verdict.body!, /Work is where it would help/);
    assert.match(verdict.body!, /Everything else you own already covers/);
    // …but it points at the gap rather than re-explaining it.
    assert.doesNotMatch(verdict.body!, /repeats one formula|mostly make the same outfit/);
  });
});

// ── §WP-7 — sentence-level repetition ─────────────────────────────────────────

describe("§WP-7 repeated sentences", () => {
  it("§WP-7a the Passport-match sentence appears at most once on the page", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: unknown }).heroes = {
      state: "available",
      heroes: [
        { garmentId: "g1", name: "Trench", category: "OUTERWEAR", label: "passport-match", labelText: null,
          headline: "This is the piece closest to what you told nAia you want.",
          reasons: ["Matches the style and colours you described in your Passport."] },
        { garmentId: "g2", name: "Blazer", category: "OUTERWEAR", label: "most-versatile", labelText: null,
          headline: "One of your most versatile pieces.",
          reasons: ["Matches the style and colours you described in your Passport."] },
      ],
    };
    const page = buildWardrobePage(input);
    const copy = visibleCopy(page).join(" ");
    const hits = copy.match(/matches the style and colours you described in your Passport/gi) ?? [];
    assert.ok(hits.length <= 1, `Passport-match printed ${hits.length} times`);
  });

  it("§WP-7b one entry never states the same partner count twice", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: unknown }).heroes = {
      state: "available",
      heroes: [{ garmentId: "g1", name: "Tank", category: "TOPS", label: "most-versatile", labelText: null,
        headline: "One of your most versatile pieces.",
        reasons: ["Pairs easily with 9 other pieces in your Closet."] }],
    };
    (input.intelligence as unknown as { opportunities: unknown }).opportunities = {
      rediscover: [{ garmentId: "g1", name: "Tank", imageUrl: null,
        body: "The connections are already there — 9 pieces you own work with it.",
        worksWithIds: ["g3"] }],
    };
    const page = buildWardrobePage(input);
    const copy = visibleCopy(page).join(" ");
    assert.equal((copy.match(/\b9 (?:other )?pieces/gi) ?? []).length, 1);
  });

  it("§WP-7c a register with its own gap finding does not restate it", () => {
    const page = buildWardrobePage(baseInput());
    const range = page.sections.find((s) => s.id === "range")!;
    const register = range.blocks.find((b) => b.kind === "registers")!
      .entries.find((e) => e.claim === claims.register("work"))!;
    assert.equal(register.body, undefined, "the finding below carries the explanation");
    assert.ok((register.meta as Record<string, unknown>).stateText, "the verdict is still shown");
  });

  it("§WP-7d the shopping advice is given once, not twice", () => {
    // The live finding already ends with the guidance, so appending the
    // "not a priority" sentence printed the conclusion twice.
    const withAdvice =
      "You own 8 of these. Another similar piece is unlikely to materially expand what you can wear; " +
      "strengthening your work options would add more.";
    assert.equal(
      mergeEnough(withAdvice, "You already have strong depth here. A similar piece would add very little."),
      withAdvice,
      "the second statement of the same advice is dropped",
    );

    // A finding that only states depth still gets the guidance.
    const bare = "You own 8 of these that work with the rest of your Closet.";
    const merged = mergeEnough(bare, "You already have strong depth here.");
    assert.match(merged, /You own 8 of these/);
    assert.match(merged, /strong depth here/);
  });

  it("§WP-7e an entry is never left with no words at all", () => {
    const page = buildWardrobePage(baseInput());
    for (const entry of page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)) {
      const meta = (entry.meta ?? {}) as Record<string, unknown>;
      const hasText = Boolean(entry.title || entry.body || meta.label || meta.note || meta.rediscover
        || meta.palette || meta.shapes || meta.traits || meta.strengths || meta.stateText);
      assert.ok(hasText, `entry ${entry.id} rendered with nothing to say`);
    }
  });
});

// ── §WP-8 — the numbers must reconcile ────────────────────────────────────────
//
// The page showed a piece "pairs easily with 9 other pieces" and then revealed
// six of them, with nothing saying the six were a subset. Three different
// measures were in play and none was labelled.

describe("§WP-8 partner counts reconcile", () => {
  it("§WP-8a the reveal names its own count, and shows exactly that many", () => {
    const input = baseInput();
    (input.intelligence as unknown as { opportunities: unknown }).opportunities = {
      rediscover: [{
        garmentId: "g1", name: "Cream Ribbed Knit Tank Top", imageUrl: null,
        body: "Worth another look.",
        worksWithIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      }],
    };
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    assert.equal(entry.action?.kind, "reveal");
    assert.match(entry.action!.label, /See 9 matching pieces/);
    // The body did not state the count, so the button carries it.
    assert.equal((entry.action as { garmentIds: string[] }).garmentIds.length, 9);
    assert.deepEqual(entry.garmentIds, (entry.action as { garmentIds: string[] }).garmentIds);
  });

  it("§WP-8e the count is not repeated when the entry already gave it", () => {
    const input = baseInput();
    (input.intelligence as unknown as { opportunities: unknown }).opportunities = {
      rediscover: [{
        garmentId: "g1", name: "Tank", imageUrl: null,
        body: "The connections are already there — 9 pieces you own work with it.",
        worksWithIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      }],
    };
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    assert.equal(entry.action!.label, "See matching pieces");
    assert.equal((entry.action as { garmentIds: string[] }).garmentIds.length, 9);
  });

  it("§WP-8f the opening summary says it is a preview", () => {
    const page = buildWardrobePage(baseInput());
    const takeaways = page.sections.find((s) => s.id === "now")!.blocks.find((b) => b.kind === "takeaways")!;
    assert.match(takeaways.note ?? "", /explained below/i);
  });

  it("§WP-8b singular is not pluralised", () => {
    const input = baseInput();
    (input.intelligence as unknown as { opportunities: unknown }).opportunities = {
      rediscover: [{ garmentId: "g1", name: "Tank", imageUrl: null, body: "x", worksWithIds: ["a"] }],
    };
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    assert.match(entry.action!.label, /See 1 matching piece/);
  });

  it("§WP-8c the shopping verdict never lists something that is not a priority", () => {
    const page = buildWardrobePage(baseInput());
    const verdict = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.kind === "verdict")!;
    assert.equal(verdict.entries.length, 1, "the verdict answers the question and nothing else");
    assert.equal(verdict.entries[0].claim, "buy-verdict");
    // The advice itself still exists, in full, where it belongs.
    const enough = page.sections.find((s) => s.id === "works")!
      .blocks.flatMap((b) => b.entries).find((e) => e.claim === claims.enough("everyday"))!;
    assert.match(enough.body!, /strong depth here|unlikely to materially expand/);
  });

  it("§WP-8d capability is attributed to garment profiles, not to a personal stylist", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /a stylist has reviewed|stylist personally|reviewed by a stylist/i);
    // Internal vocabulary must not reach the customer either.
    assert.doesNotMatch(copy, /approved style profile|intention potential|curated rating/i);
    // And a garment rating may never be stated as how she will feel.
    assert.doesNotMatch(copy, /will (make you )?feel like yourself/i);
    assert.match(copy, /could help with/i);
  });
});

describe("§WP-9 curated assessments are not a Passport comparison", () => {
  it("§WP-9a the capability block says what it is, and what it is not", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.match(copy, /estimate the kinds of looks/i);
    assert.match(copy, /aren't complete outfits or a match against your personal requirements/i);
  });

  it("§WP-9b no capability row reads as meeting her stated requirements", () => {
    // The same page carries a Coverage row reporting whether pieces meet the
    // coverage preferences she actually stated. A curated assessment must never
    // be mistaken for that comparison — "more coverage" did exactly that.
    const page = buildWardrobePage(baseInput());
    const rows = page.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) => b.entries)
      .filter((e) => e.claim === "closet-capability")
      .flatMap((e) => ((e.meta?.strengths ?? []) as Array<{ label: string }>).map((c) => c.label));
    for (const label of rows) {
      assert.doesNotMatch(label, /^more coverage$/i, `"${label}" collides with the Coverage comparison`);
      assert.doesNotMatch(label, /meets? your|your requirement|your preference/i);
    }
  });
});

// ── §WP-10 — Ways to get dressed: the outfit lives directly under its own
//    heading, with a real per-register example when one genuinely exists ────

/** A synthetic WardrobePairing-shaped candidate for `bestByRegister`/`pairings`. */
function pairingFixture(over: Record<string, unknown> = {}) {
  return {
    id: "p1", garmentIds: ["g1", "g2"], reason: "They sit at the same level of dress.",
    untried: true, register: "everyday", ...over,
  };
}

/**
 * `bestByRegister` is the FULL-pool, uncapped source the fix reads from;
 * `pairings` is the separate, globally-capped top-4 list "Possibilities to
 * try" reads from — the exact split that caused the original contradiction
 * (a register could have genuine depth and a real `bestByRegister` entry,
 * while losing every seat in the capped `pairings` list to other registers).
 */
function pairingsIntelligence(
  bestByRegister: Record<string, unknown[]>,
  cappedList: unknown[] = [],
) {
  return { state: "available", untriedPresentation: "none", untriedNote: null, pairings: cappedList, bestByRegister };
}

/**
 * Same wardrobe as baseInput(), but "everyday" is explicitly NOT something she
 * told nAia matters (needed: false) — this is the case the "undeclared
 * lifestyle must not get promoted" rule exists for. "work" stays needed.
 */
function inputWithRegisterPairings(): WardrobePageInput {
  const input = baseInput();
  const needsFixture = input.needs as unknown as { registers: Array<Record<string, unknown>> };
  needsFixture.registers = needsFixture.registers.map((r) =>
    r.register === "everyday" ? { ...r, needed: false } : r,
  );
  const work = pairingFixture({ id: "p-work", garmentIds: ["g6", "g9"], register: "work" });
  const everyday = pairingFixture({ id: "p-everyday", garmentIds: ["g1", "g3"], reason: "Both are wardrobe neutrals.", untried: false });
  (input.intelligence as unknown as { pairings: unknown }).pairings =
    pairingsIntelligence({ work: [work], everyday: [everyday] }, [work, everyday]);
  return input;
}

/** "work" is needed but the Closet has nothing for it yet (rawCount: 0). */
function inputWithNeededButEmptyWork(): WardrobePageInput {
  const input = baseInput();
  const needsFixture = input.needs as unknown as { registers: Array<Record<string, unknown>> };
  needsFixture.registers = needsFixture.registers.map((r) =>
    r.register === "work" ? { ...r, rawCount: 0 } : r,
  );
  return input; // no pairings fixture at all — a truly empty register.
}

/** "work" is needed, has real depth (rawCount > 0), but no candidate ever formed. */
function inputWithNeededWorkNoCandidate(): WardrobePageInput {
  return baseInput(); // p1 carries no register, so nothing matches "work" via bestByRegister
}

describe("§WP-10 Ways to get dressed: the outfit is the answer, shown where its heading is", () => {
  it("§WP-10a a needed register's own combination renders directly on its own entry, images included", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    assert.equal(explore.kind, "lifestyle-combos");
    const work = explore.entries.find((e) => e.id === "explore-work")!;
    assert.ok(work.garmentIds.includes("g6") && work.garmentIds.includes("g9"), "the outfit's own garments sit on the SAME entry as its heading");
    // No separate "shown below" placeholder and no separate pairings block —
    // there is exactly one block for this whole section.
    const doBlocks = page.sections.find((s) => s.id === "do")!.blocks;
    assert.equal(doBlocks.filter((b) => b.id === "ways-to-get-dressed" || b.kind === "lifestyle-combos").length, 1);
    assert.doesNotMatch(work.body ?? "", /shown below/i);
  });

  it("§WP-10b the explore entry no longer offers a jump", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "do")!.blocks
      .find((b) => b.id === "ways-to-get-dressed")!.entries.find((e) => e.id === "explore-work")!;
    assert.equal(explore.action, undefined, "the answer is shown in context now, not behind a link");
  });

  it("§WP-10c the same combination does not also appear in Possibilities to try", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const possibilitiesPairings = page.sections.find((s) => s.id === "possibilities")!.blocks
      .find((b) => b.id === "pairings");
    const ids = possibilitiesPairings?.entries.map((e) => e.id) ?? [];
    assert.ok(!ids.includes("p-work"), "moved, not duplicated");
  });

  it("§WP-10d owning pieces for an undeclared life area does not promote it into Ways to get dressed", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed");
    const explored = explore?.entries.map((e) => e.id) ?? [];
    assert.ok(!explored.includes("explore-everyday"), "everyday was never named as part of her life");

    // The everyday combination is not lost — it stays in the general list.
    const possibilitiesPairings = page.sections.find((s) => s.id === "possibilities")!.blocks
      .find((b) => b.id === "pairings");
    const ids = possibilitiesPairings?.entries.map((e) => e.id) ?? [];
    assert.ok(ids.includes("p-everyday"), "a combination for a life area she didn't name stays in the general list");
  });

  it("§WP-10e a needed register with zero Closet coverage still renders, and says so plainly", () => {
    const page = buildWardrobePage(inputWithNeededButEmptyWork());
    const doBlocks = page.sections.find((s) => s.id === "do")!.blocks;
    const explore = doBlocks.find((b) => b.id === "ways-to-get-dressed")!.entries.find((e) => e.id === "explore-work");
    assert.ok(explore, "a needed register with nothing in the Closet must still render, never be hidden");
    assert.match(explore!.body ?? "", /doesn't have anything for this part of your life yet/i);
  });

  it("§WP-10f a needed register with real depth but no candidate ever formed says so precisely, not that none can exist", () => {
    const page = buildWardrobePage(inputWithNeededWorkNoCandidate());
    const doBlocks = page.sections.find((s) => s.id === "do")!.blocks;
    const explore = doBlocks.find((b) => b.id === "ways-to-get-dressed")!.entries.find((e) => e.id === "explore-work")!;
    // The old wording asserted the Closet CANNOT make a combination — a claim
    // stronger than the data supports. It must be gone entirely.
    assert.doesNotMatch(explore.body ?? "", /there isn't a combination in your closet for this/i);
    assert.match(explore.body ?? "", /nAia hasn't selected a work example to show here yet/i);
  });

  it("§WP-10g a 'Plenty of options' verdict never coexists with an unqualified 'no combination exists' claim", () => {
    // The exact contradiction reported: a register read as having strong
    // depth must never be paired with wording that flatly denies a
    // combination exists, unless the wording explicitly distinguishes "no
    // display was chosen" from "none exists".
    for (const input of [inputWithRegisterPairings(), inputWithNeededWorkNoCandidate(), baseInput()]) {
      const page = buildWardrobePage(input);
      const registers = page.sections.find((s) => s.id === "range")?.blocks.find((b) => b.id === "registers");
      const doExplore = page.sections.find((s) => s.id === "do")?.blocks.find((b) => b.id === "ways-to-get-dressed");
      if (!registers || !doExplore) continue;
      for (const reg of registers.entries) {
        const meta = reg.meta as Record<string, unknown> | undefined;
        if (meta?.stateText !== "Plenty of options") continue;
        const registerKey = reg.id.replace(/^register-/, "");
        const explore = doExplore.entries.find((e) => e.id === `explore-${registerKey}`);
        if (!explore) continue;
        const flatDenial = /there isn't a combination in your closet for this|the closet (cannot|can't) make/i;
        assert.doesNotMatch(explore.body ?? "", flatDenial,
          `"${reg.id}" is Plenty of options but its example card denies a combination can exist: "${explore.body}"`);
      }
    }
  });
});

// ── §WP-11 — Ways to get dressed speaks her life, in the engine's own
//    3-register data; a declared activity pulls its own already-valid
//    combination out from under a generic heading, and only when one exists ─

describe("§WP-11 lifestyle-labelled presentation, same 3-register engine", () => {
  it("§WP-11a the three register cards are headed in life terms, not engine terms", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const work = explore.entries.find((e) => e.id === "explore-work")!;
    assert.equal(work.title, "For work");
  });

  it("§WP-11b a genuinely gym-tagged combination gets its own card, directly under it, when fitness/gym is declared", () => {
    const input = baseInput(); // "everyday" and "work" are both needed:true here
    const gym = pairingFixture({ id: "p-gym", garmentIds: ["g10", "g11"], reason: "You've tagged these for gym." });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [gym] }, [gym]);
    input.lifestyle = ["fitness-gym"];
    const page = buildWardrobePage(input);

    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const gymEntry = explore.entries.find((e) => e.id === "explore-gym");
    assert.ok(gymEntry, "a gym card should appear");
    assert.equal(gymEntry!.title, "For active / gym days");
    assert.ok(gymEntry!.garmentIds.includes("g10"), "the combination's own images sit directly on the gym card");

    // Not left anywhere in the general list either.
    const possibilitiesPairings = page.sections.find((s) => s.id === "possibilities")?.blocks.find((b) => b.id === "pairings");
    assert.ok(!(possibilitiesPairings?.entries ?? []).some((e) => e.id === "p-gym"), "not left in the general list either");
  });

  it("§WP-11c gym is declared but nothing is gym-tagged: no card is invented", () => {
    const input = inputWithRegisterPairings();
    input.lifestyle = ["fitness-gym"];
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    assert.equal(explore.entries.find((e) => e.id === "explore-gym"), undefined);
  });

  it("§WP-11d undeclared gym-only pairing is not surfaced under For everyday", () => {
    // The customer-facing lifestyle label and the engine's internal register
    // are not the same thing: activewear formality-buckets to "everyday", but
    // evidence that is specifically gym-tagged must never be relabelled
    // "For everyday" just because fitness/gym was never declared.
    const input = baseInput();
    const gym = pairingFixture({ id: "p-gym2", garmentIds: ["g12", "g13"], reason: "You've tagged these for gym." });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [gym] }, [gym]);
    // input.lifestyle left unset — she never told nAia fitness/gym is part of her life.
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    assert.equal(explore.entries.find((e) => e.id === "explore-gym"), undefined, "no Active/Gym card without the declared lifestyle");
    const everydayEntry = explore.entries.find((e) => e.id === "explore-everyday")!;
    assert.ok(!everydayEntry.garmentIds.includes("g12"), "not relabelled For everyday either");
  });

  it("§WP-11e a genuinely everyday-compatible pairing still renders under For everyday", () => {
    const input = baseInput();
    const casual = pairingFixture({ id: "p-casual", garmentIds: ["g14", "g15"] });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [casual] }, [casual]);
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const everydayEntry = explore.entries.find((e) => e.id === "explore-everyday")!;
    assert.ok(everydayEntry.garmentIds.includes("g14"), "evidence that IS genuinely everyday still renders there");
  });

  it("§WP-11f an excluded gym-only pairing stays available to Possibilities to try when otherwise valid", () => {
    const input = baseInput();
    const gym = pairingFixture({ id: "p-gym3", garmentIds: ["g16", "g17"], reason: "You've tagged these for gym." });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [gym] }, [gym]);
    // No lifestyle declared, so it's excluded from "Ways to get dressed" —
    // but it is a real, engine-approved pairing, so it must not be lost.
    const page = buildWardrobePage(input);
    const possibilitiesPairings = page.sections.find((s) => s.id === "possibilities")?.blocks.find((b) => b.id === "pairings");
    assert.ok(possibilitiesPairings, "the possibilities pairings block should exist");
    assert.ok(possibilitiesPairings!.entries.some((e) => e.id === "p-gym3"), "still offered in the general list");
  });

  it("§WP-11g combination explanations name the actual garments", () => {
    const input = baseInput();
    const work = pairingFixture({ id: "p-named", garmentIds: ["g6"], register: "work" });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ work: [work] }, [work]);
    input.garmentName = (id: string) => (id === "g6" ? "Beige Tailored Trousers" : null);
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const workEntry = explore.entries.find((e) => e.id === "explore-work")!;
    assert.match(workEntry.body ?? "", /beige tailored trousers/i);
    assert.match(workEntry.body ?? "", /^Try your/);
  });
});

// ── §WP-12 — colour low-priority advice is role-specific, never bare volume ───

function inputWithPalette(palette: Array<{ colour: string; count: number; share: number; neutral: boolean }>): WardrobePageInput {
  const input = baseInput();
  (input.intelligence as unknown as { dna: { palette: unknown } }).dna.palette = palette;
  return input;
}

describe("§WP-12 colour advice connects abundance to actual duplication evidence", () => {
  it("§WP-12a a dominant neutral with a genuine enough-cluster is stated once, not restated in the colour card", () => {
    const input = inputWithPalette([{ colour: "Black", count: 19, share: 0.4, neutral: true }]);
    const page = buildWardrobePage(input); // baseInput()'s enough finding is "everyday neutral tops"
    const palette = page.sections.find((s) => s.id === "now")!.blocks
      .find((b) => b.id === "dna")!.entries.find((e) => e.id === "dna-palette")!;
    // The "plenty of X, so another one is low priority" conclusion belongs to
    // the "enough" and "Low priority right now" sections, which already say
    // it with full evidence (count, garments). Restating it here — a third
    // time — is exactly the duplication this section stopped doing.
    assert.match(palette.body ?? "", /^Black is already a big part of your wardrobe \(19 pieces\)\.$/);
    assert.doesNotMatch(palette.body ?? "", /low priority/i);
    assert.doesNotMatch(palette.body ?? "", /plenty of/i);
  });

  it("§WP-12b a colour a live recommendation actually wants is never called low priority", () => {
    const input = inputWithPalette([{ colour: "Grey", count: 12, share: 0.35, neutral: true }]);
    (input.recommendations as unknown as { recommendations: unknown[] }).recommendations = [
      { id: "rec-work", register: "work", specificity: "detailed", title: "A full-length work bottom",
        attributes: [{ kind: "colour", values: ["grey"], label: "Grey", source: "passport" }],
        body: "x", unlocksIds: [], criteria: {}, evidence: [], strength: "strong" },
    ];
    const page = buildWardrobePage(input);
    const palette = page.sections.find((s) => s.id === "now")!.blocks
      .find((b) => b.id === "dna")!.entries.find((e) => e.id === "dna-palette")!;
    assert.doesNotMatch(palette.body ?? "", /low priority/i);
    assert.match(palette.body ?? "", /Grey is already a big part of your wardrobe/);
  });

  it("§WP-12c abundant but no role is actually covered enough: observation only, no skip advice", () => {
    const input = inputWithPalette([{ colour: "Navy", count: 10, share: 0.4, neutral: true }]);
    (input.needs as unknown as { enough: unknown[] }).enough = []; // nothing sufficiently covered
    const page = buildWardrobePage(input);
    const palette = page.sections.find((s) => s.id === "now")!.blocks
      .find((b) => b.id === "dna")!.entries.find((e) => e.id === "dna-palette")!;
    assert.match(palette.body ?? "", /Navy is already a big part of your wardrobe/);
    assert.doesNotMatch(palette.body ?? "", /low priority/i);
  });

  it("§WP-12d a chromatic (non-neutral) dominant colour never gets a role-specific claim the data can't back", () => {
    const input = inputWithPalette([{ colour: "Burgundy", count: 14, share: 0.4, neutral: false }]);
    const page = buildWardrobePage(input);
    const palette = page.sections.find((s) => s.id === "now")!.blocks
      .find((b) => b.id === "dna")!.entries.find((e) => e.id === "dna-palette")!;
    assert.match(palette.body ?? "", /Burgundy is already a big part of your wardrobe/);
    assert.doesNotMatch(palette.body ?? "", /low priority/i);
  });
});

// ── §WP-13 — the useful conclusion survives collapsing ─────────────────────────

describe("§WP-13 a block's own conclusion stays visible even while its detail is collapsed", () => {
  it("§WP-13a the Passport-match block states its lifestyle reading as a summary, not as a duplicated detail row", () => {
    const input = baseInput();
    (input.intelligence as unknown as { passportView: { state: string; comparisons: unknown[] } }).passportView = {
      state: "available",
      comparisons: [{ id: "structure", stated: "fitted", observed: "mostly relaxed", reading: "Your shapes lean relaxed.", strength: "strong" }],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "learning")!.blocks.find((b) => b.id === "passport")!;
    assert.ok(block.summary && block.summary.trim() !== "", "the block has a visible summary even before anything is opened");
    assert.ok(block.disclosure, "detail still sits behind a reveal");
    assert.equal(
      block.entries.some((e) => e.id === "match-lifestyle"), false,
      "lifestyle is the summary now, not also a row inside the detail list",
    );
  });

  it("§WP-13a-2 the summary alone is enough to keep the block on the page, even with nothing behind the reveal", () => {
    const page = buildWardrobePage(baseInput()); // no synthesis lines, no comparisons — summary only
    const block = page.sections.find((s) => s.id === "learning")!.blocks.find((b) => b.id === "passport")!;
    assert.ok(block, "a block whose entries resolve to zero, but which has a summary, still survives claim resolution");
    assert.ok(block!.summary && block!.summary.trim() !== "");
    assert.equal(block!.disclosure, undefined, "nothing to reveal, so no reveal control is offered");
  });

  it("§WP-13b the StyleMe-history block states what the customer most often asks for as a summary", () => {
    const page = buildWardrobePage(baseInput());
    const block = page.sections.find((s) => s.id === "learning")!.blocks.find((b) => b.id === "behaviour")!;
    assert.match(block.summary ?? "", /relaxed, everyday looks/i);
    assert.ok(block.disclosure, "the counts and provenance behind it still sit behind a reveal");
  });

  it("§WP-13c the always-visible copy transcript includes a collapsed block's summary", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page);
    const behaviour = page.sections.find((s) => s.id === "learning")!.blocks.find((b) => b.id === "behaviour")!;
    assert.ok(behaviour.summary);
    assert.ok(copy.includes(behaviour.summary!), "the summary sentence reaches the customer without opening anything");
  });
});

// ── §WP-14 — identical resolved matches present as one card ────────────────────

function inputWithRediscoverPieces(pieces: Array<Record<string, unknown>>): WardrobePageInput {
  const input = baseInput();
  const intel = input.intelligence as unknown as {
    heroes: { state: string; heroes: unknown[] };
    opportunities: { rediscover: unknown[] };
  };
  intel.heroes = { state: "available", heroes: [] };
  intel.opportunities = { rediscover: pieces };
  return input;
}

describe("§WP-14 identical resolved matches group into one card, different ones stay separate", () => {
  it("§WP-14a two difficult-to-style pieces with the exact same matching-garment set are grouped into one card", () => {
    const input = inputWithRediscoverPieces([
      { garmentId: "b1", name: "Beige Tailored Blazer", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
        worksWithIds: ["m1", "m2", "m3", "m4", "m5", "m6"] },
      { garmentId: "b2", name: "Beige Oversized Blazer", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
        worksWithIds: ["m6", "m5", "m4", "m3", "m2", "m1"] },
    ]);
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "possibilities")!.blocks.find((b) => b.id === "worth-trying")!;
    assert.equal(block.entries.length, 1, "one grouped card, not two separate ones");
    const [entry] = block.entries;
    assert.match(entry.title ?? "", /^TWO BLAZERS WORTH ANOTHER LOOK$/);
    const members = (entry.meta as Record<string, unknown>).members as Array<{ garmentId: string; title: string }>;
    assert.deepEqual(new Set(members.map((m) => m.garmentId)), new Set(["b1", "b2"]));
    assert.equal(new Set(entry.garmentIds).size, 6, "the shared reveal still carries the full matching set");
    assert.ok(entry.action && entry.action.kind === "reveal", "one shared reveal, not two");
  });

  it("§WP-14b two difficult-to-style pieces with different matching-garment sets stay as two separate cards", () => {
    const input = inputWithRediscoverPieces([
      { garmentId: "b1", name: "Beige Tailored Blazer", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
        worksWithIds: ["m1", "m2", "m3", "m4", "m5", "m6"] },
      { garmentId: "b2", name: "Beige Oversized Blazer", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 2 potential matching pieces.",
        worksWithIds: ["m7", "m8"] },
    ]);
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "possibilities")!.blocks.find((b) => b.id === "worth-trying")!;
    assert.equal(block.entries.length, 2, "distinct match sets are never merged into one card");
    assert.ok(block.entries.every((e) => (e.meta as Record<string, unknown> | undefined)?.members === undefined));
  });
});

// ── §WP-15 — a hero label is not restated by its own headline and reason ───────

describe("§WP-15 closet-connector and rediscover copy do not restate what the heading already says", () => {
  it("§WP-15a closet-connector drops the generic headline and reason that just restate its own hero label", () => {
    const input = baseInput();
    const intel = input.intelligence as unknown as { heroes: { state: string; heroes: unknown[] } };
    intel.heroes = {
      state: "available",
      heroes: [
        { garmentId: "g1", name: "Cream Ribbed Knit Tank Top", category: "TOPS",
          label: "closet-connector", labelText: null,
          headline: "It connects parts of your wardrobe that don't otherwise meet.",
          reasons: [
            "It works with both the relaxed and the polished side of your wardrobe.",
            "Pieces that cross registers are what let a wardrobe stretch without growing.",
          ],
          evidence: [{ kind: "garment-fact", source: "formality/compatibility graph", detail: "x", garmentIds: ["m1", "m2"] }] },
      ],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "works")!.blocks.find((b) => b.id === "garments")!;
    const entry = block.entries.find((e) => (e.meta as Record<string, unknown>)?.garmentId === "g1")!;
    assert.equal(entry.body, undefined, "the generic 'connects parts of your wardrobe' headline is dropped");
    assert.equal((entry.meta as Record<string, unknown>)?.reason, undefined, "the restated 'relaxed and polished' reason is dropped");
    assert.match(String((entry.meta as Record<string, unknown>)?.label ?? ""), /relaxed and polished/i, "the finding still shows once, as the label");
  });

  it("§WP-15b a rediscover match count names real garments instead of leaving a bare number", () => {
    const input = inputWithRediscoverPieces([
      { garmentId: "t1", name: "Cream Ribbed Knit Tank Top", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 8 potential matching pieces. It also matches the style and colours you described in your Passport.",
        worksWithIds: ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"] },
    ]);
    input.garmentName = (id) =>
      ({ j1: "Blue Jeans", j2: "Beige Tailored Trousers", j3: "Black Jacket" }) [id as "j1" | "j2" | "j3"] ?? null;
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "possibilities")!.blocks.find((b) => b.id === "worth-trying")!;
    const text = String((block.entries[0].meta as Record<string, unknown>)?.rediscover ?? "");
    assert.match(text, /8 potential matches, including blue jeans, beige tailored trousers and black jacket\./i);
    assert.doesNotMatch(text, /8 potential matching pieces/i);
  });
});

// ── §WP-16 — an unresolved shape reads as an instruction, not a taxonomy chip ──

function inputWithShapeRecommendation(): WardrobePageInput {
  const input = baseInput();
  (input.recommendations as unknown as { recommendations: unknown[] }).recommendations = [
    {
      id: "rec-work", register: "work", specificity: "detailed",
      title: "One option to explore: a full-length work bottom",
      attributes: [
        { kind: "structure", values: ["a-line", "flared"], label: "a different shape — A-line or flared", source: "closet" },
        { kind: "colour", values: ["grey"], label: "Grey", source: "passport" },
      ],
      body: "Your work pieces repeat similar combinations. A piece like this could pair with 4 pieces already in your Closet, so it adds ways to dress rather than another version of something you have. Grey is a colour you said you like.",
      unlocksIds: ["g7", "g8"], criteria: {}, evidence: [], strength: "strong",
    },
  ];
  return input;
}

describe("§WP-17 a hero-only card still offers a way to see the pieces it claims to pair with", () => {
  it("§WP-17a a hero with no rediscover note of its own still gets a matching-pieces reveal, from its own evidence", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: unknown }).heroes = {
      state: "available",
      heroes: [{
        garmentId: "t1", name: "Beige Tailored Trousers", category: "BOTTOMS",
        label: "most-versatile", labelText: null,
        headline: "Pairs easily with 8 other pieces in your Closet.",
        reasons: [],
        evidence: [{ kind: "garment-fact", source: "compatibility graph", detail: "x",
          garmentIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] }],
      }],
    };
    (input.intelligence as unknown as { opportunities: unknown }).opportunities = { rediscover: [] };
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("t1"))!;
    assert.equal(entry.action?.kind, "reveal", "the claim of pairing widely is backed by a way to see the pieces");
    assert.deepEqual((entry.action as { garmentIds: string[] }).garmentIds, ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
  });
});

describe("§WP-16 an unresolved shape reads as an instruction, not a taxonomy chip", () => {
  it("§WP-16a the title folds an unresolved shape into a plain instruction instead of a raw attribute", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "recommendations")!;
    const entry = block.entries[0];
    assert.equal(
      entry.title,
      "Look for a full-length work bottom in a shape that's meaningfully different from the ones you already own.",
    );
    assert.doesNotMatch(entry.title ?? "", /a different shape/i);
  });

  it("§WP-16b the raw 'a different shape' attribute is not also shown as a chip", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "recommendations")!;
    const attrs = ((block.entries[0].meta as Record<string, unknown>).attributes ?? []) as Array<{ kind: string; label: string }>;
    assert.equal(attrs.some((a) => /a different shape/i.test(a.label)), false);
    assert.ok(attrs.some((a) => a.kind === "colour"), "other attributes are untouched");
  });

  it("§WP-16c 'Why this?' explains the wardrobe limitation, not a bare attribute dump", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "do")!.blocks.find((b) => b.id === "recommendations")!;
    const detail = block.entries[0].action?.kind === "reveal" ? block.entries[0].action.detail : undefined;
    assert.ok(detail);
    assert.doesNotMatch(detail!, /^This comes from/i);
    assert.match(detail!, /work pieces repeat similar combinations/i);
    assert.match(detail!, /grey is one of the colours you selected in your passport/i);
  });
});
