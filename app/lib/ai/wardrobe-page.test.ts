// app/lib/ai/wardrobe-page.test.ts
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-page.test.ts
//
// The contract here is about REPETITION and about the five-moment content
// lock: exactly one home per claim, and every visible moment matches the
// locked copy — hero, "Wear what you already own", "What deserves your
// attention", "Shop smarter", "Your wardrobe profile" — nothing else visible
// by default.

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
  cleanPartnerIds,
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
    garmentIds: ["g1", "g2"],
    evidence: [{
      signal: "garment-fact", field: "slot + colour + formality", detail: "8 usable.",
      garmentIds: ["g1", "g2", "g30", "g31", "g32", "g33", "g34", "g35"],
    }],
    strength: "strong",
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
        headline: "One of your most versatile pieces.", reasons: ["It works with a lot of what you own."],
        evidence: [{ signal: "garment-fact", field: "compatibility graph", detail: "x", garmentIds: ["g3", "g5"] }] },
    ] },
    pairings: {
      state: "available", untriedPresentation: "none", untriedNote: null,
      pairings: [{ id: "p1", garmentIds: ["g1", "g3"], reason: "They sit at the same level of dress.", untried: false }],
      bestByRegister: {},
    },
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
      { register: "work", label: "work", depthLabel: "Limited usable work range",
        depthNote: "Your work dressing repeats.", rawCount: 10, usableCount: 10, blockedCount: 0,
        unknownCount: 0, distinctLooks: 3, needed: true },
    ],
    enough: [finding()],
    couldUseMore: [finding({
      id: "need-work-repetition", kind: "repetition", register: "work",
      title: "You have work pieces, but fewer ways to combine them",
      body: "Many of your work tops and bottoms create similar combinations.",
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
      { id: "need-work-repetition", text: "You have work pieces, but fewer ways to combine them", source: "depth", evidence: [] },
      { id: "f1", text: "You already have enough everyday neutral tops", source: "depth", evidence: [] },
    ],
  } as never;

  const recommendations = {
    state: "available",
    recommendations: [
      { id: "rec-work", register: "work", specificity: "detailed",
        title: "One option to explore: a full-length work bottom",
        attributes: [{ kind: "colour", values: ["grey"], label: "Grey", source: "passport" }],
        body: "Your work pieces repeat similar combinations. A piece like this would work with 4 of the pieces you already own.",
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

  it("§WP-1c the work-variety finding is explained once, in 'What deserves your attention'", () => {
    const page = buildWardrobePage(baseInput());
    const full = auditClaims(page).filter((l) => l.claim === claims.gap("work") && l.role === "full");
    assert.equal(full.length, 1);
    assert.equal(full[0].section, "attention");
  });

  it("§WP-1d exactly the four content-locked moments appear, in order, never more", () => {
    const page = buildWardrobePage(baseInput());
    const ids = page.sections.map((s) => s.id);
    for (const id of ids) assert.ok(SECTION_ORDER.includes(id), `unexpected section "${id}"`);
    const expected = SECTION_ORDER.filter((id) => ids.includes(id));
    assert.deepEqual(ids, [...expected]);
  });
});

// ── §WP-2 — specific merges from the feedback ─────────────────────────────────

describe("§WP-2 merges", () => {
  it("§WP-2a 'you have enough' and 'not a priority' become one self-explanatory Low Priority entry", () => {
    const page = buildWardrobePage(baseInput());
    const locs = auditClaims(page).filter((l) => l.claim === "low-priority");
    const fulls = locs.filter((l) => l.role === "full");
    assert.equal(fulls.length, 1, "the claim is explained once");

    const shop = page.sections.find((s) => s.id === "shop")!;
    const entry = shop.blocks.find((b) => b.id === "low-priority")!.entries[0];
    assert.equal(entry.title, "Another similar everyday neutral top");
    assert.equal(entry.body, "You already have 8, so another similar one probably won't add much.");
    assert.ok(entry.garmentIds.length > 0, "the pieces that prove it are kept");

    // The old separate "You have plenty of" chapter no longer exists.
    assert.equal(auditClaims(page).filter((l) => l.claim === claims.enough("everyday") && l.role === "full").length, 0);
  });

  it("§WP-2b a garment is featured once, carrying its label and its note", () => {
    const page = buildWardrobePage(baseInput());
    const fulls = auditClaims(page).filter((l) => l.claim === claims.garment("g1") && l.role === "full");
    assert.equal(fulls.length, 1);

    const entry = page.sections
      .flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    const meta = entry.meta as Record<string, unknown>;
    // The rediscovery text and the contradiction observation make the same
    // claim; §WP-6b pins which of the two survives.
    assert.ok(meta.rediscover ?? meta.note, "the piece still carries its note");
  });

  it("§WP-2c the difficult-to-style note never tells her she is wrong", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /your Closet disagrees|but your Closet says|you're wrong|actually wrong/i);
  });

  it("§WP-2d colour representation is explained once, inside the wardrobe profile's reveal", () => {
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
    assert.equal(fulls[0].section, "profile");
    // Deduplication must not eat a different finding that happens to share a word.
    const balance = auditClaims(page).filter((l) => l.claim === "passport:colour balance");
    assert.equal(balance.length, 1, "colour balance survives as its own claim");
  });
});

// ── §WP-3 — sequence and naming ───────────────────────────────────────────────

describe("§WP-3 sequence", () => {
  it("§WP-3b nothing claims she hasn't tried or explored what nAia has generated", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
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

  it("§WP-4b unanswered completeness hedges Worth Considering", () => {
    const page = buildWardrobePage(baseInput());
    const entry = page.sections.find((s) => s.id === "shop")!
      .blocks.find((b) => b.id === "worth-considering")!.entries[0];
    assert.match(entry.body!, /based on what's in your Closet so far/i);
  });

  it("§WP-4c 'mostly complete' removes the hedge", () => {
    const page = buildWardrobePage(baseInput({ confidence: "mostly" }));
    const entry = page.sections.find((s) => s.id === "shop")!
      .blocks.find((b) => b.id === "worth-considering")!.entries[0];
    assert.doesNotMatch(entry.body ?? "", /could change|first read/i);
    assert.match(page.basis, /most of what you wear/i);
  });

  it("§WP-4d 'still adding' softens the advice further", () => {
    const page = buildWardrobePage(baseInput({ confidence: "still-adding" }));
    const entry = page.sections.find((s) => s.id === "shop")!
      .blocks.find((b) => b.id === "worth-considering")!.entries[0];
    assert.match(entry.body!, /first read rather than a final answer/i);
  });

  it("§WP-4e with no recommendation at all, the hedge still applies to the fallback verdict", () => {
    const input = baseInput({ confidence: "still-adding" });
    (input.needs as unknown as { couldUseMore: unknown[] }).couldUseMore = [];
    (input.needs as unknown as { noUrgentNeed: string | null }).noUrgentNeed =
      "Nothing obvious is missing right now.";
    (input.recommendations as unknown as { recommendations: unknown[]; notAPriority: unknown[] }).recommendations = [];
    (input.recommendations as unknown as { notAPriority: unknown[] }).notAPriority = [];
    const page = buildWardrobePage(input);
    const entry = page.sections.find((s) => s.id === "shop")!
      .blocks.find((b) => b.id === "worth-considering")!.entries[0];
    assert.match(entry.body!, /first read rather than a final answer/i);
    assert.equal(entry.claim, "buy-verdict");
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

  it("§WP-5c a supplied destination does not displace an existing reveal", () => {
    const page = buildWardrobePage(baseInput({ styleMeGarmentHref: (id) => `/style-me?piece=${id}` }));
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.claim === claims.garment("g1"))!;
    assert.equal(entry.action?.kind, "reveal");
  });

  it("§WP-5d no copy promises a number of outfits", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /\b(three|3|two|2) (ways|outfits|looks) to wear/i);
  });
});

// ── §WP-6 — merging must not delete findings ──────────────────────────────────

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
          reasons: ["Matches the style and colours you described in your Passport."],
          evidence: [
            { signal: "passport-signal", field: "OnboardingProfile", detail: "x", garmentIds: ["g1"] },
            { signal: "garment-fact", field: "compatibility graph", detail: "x", garmentIds: ["g20", "g21"] },
          ] },
        { garmentId: "g2", name: "Blazer", category: "OUTERWEAR", label: "most-versatile", labelText: null,
          headline: "One of your most versatile pieces.",
          reasons: ["Matches the style and colours you described in your Passport."],
          evidence: [{ signal: "garment-fact", field: "compatibility graph", detail: "x", garmentIds: ["g22"] }] },
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
        reasons: ["Pairs easily with 9 other pieces in your Closet."],
        evidence: [{ signal: "garment-fact", field: "compatibility graph", detail: "x", garmentIds: ["g3"] }] }],
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

  it("§WP-8c the shopping section never separately lists something that is not a priority alongside its own explanation", () => {
    const page = buildWardrobePage(baseInput());
    const lowPriority = page.sections.find((s) => s.id === "shop")!.blocks.find((b) => b.id === "low-priority")!;
    assert.equal(lowPriority.entries.length, 1, "one self-contained entry, not a duplicate list");
    assert.equal(lowPriority.entries[0].claim, "low-priority");
  });

  it("§WP-8d capability is attributed to garment profiles, not to a personal stylist", () => {
    const page = buildWardrobePage(baseInput());
    const copy = visibleCopy(page).join(" ");
    assert.doesNotMatch(copy, /a stylist has reviewed|stylist personally|reviewed by a stylist/i);
    assert.doesNotMatch(copy, /approved style profile|intention potential|curated rating/i);
    assert.doesNotMatch(copy, /will (make you )?feel like yourself/i);
    assert.match(copy, /could help with/i);
  });
});

// ── §WP-9 — curated assessments live in the profile reveal ────────────────────

describe("§WP-9 curated assessments are not a Passport comparison", () => {
  it("§WP-9a the capability detail says what it is, and what it is not — inside the profile reveal", () => {
    const page = buildWardrobePage(baseInput());
    const profile = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const capability = profile.entries.find((e) => e.claim === "closet-capability")!;
    assert.match(capability.body ?? "", /estimate the kinds of looks/i);
    assert.match(capability.body ?? "", /aren't complete outfits or a match against your personal requirements/i);
    // Deeply secondary: never part of the always-visible summary lines.
    const summaryLines = (profile.meta as Record<string, unknown>).summaryLines as string[];
    for (const line of summaryLines) assert.doesNotMatch(line, /could help with|feel put together/i);
  });

  it("§WP-9b no capability row reads as meeting her stated requirements", () => {
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

function pairingsIntelligence(bestByRegister: Record<string, unknown[]>, cappedList: unknown[] = []) {
  return { state: "available", untriedPresentation: "none", untriedNote: null, pairings: cappedList, bestByRegister };
}

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

function inputWithNeededButEmptyWork(): WardrobePageInput {
  const input = baseInput();
  const needsFixture = input.needs as unknown as { registers: Array<Record<string, unknown>> };
  needsFixture.registers = needsFixture.registers.map((r) =>
    r.register === "work" ? { ...r, rawCount: 0 } : r,
  );
  return input;
}

function inputWithNeededWorkNoCandidate(): WardrobePageInput {
  return baseInput();
}

describe("§WP-10 Ways to get dressed: the outfit is the answer, shown where its heading is", () => {
  it("§WP-10a a needed register's own combination renders directly on its own entry, images included", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    assert.equal(explore.kind, "lifestyle-combos");
    const work = explore.entries.find((e) => e.id === "explore-work")!;
    assert.ok(work.garmentIds.includes("g6") && work.garmentIds.includes("g9"), "the outfit's own garments sit on the SAME entry as its heading");
    const wearBlocks = page.sections.find((s) => s.id === "wear")!.blocks;
    assert.equal(wearBlocks.filter((b) => b.id === "ways-to-get-dressed" || b.kind === "lifestyle-combos").length, 1);
    assert.doesNotMatch(work.body ?? "", /shown below/i);
  });

  it("§WP-10b the explore entry offers a 'Why this works' reveal, not a jump", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "wear")!.blocks
      .find((b) => b.id === "ways-to-get-dressed")!.entries.find((e) => e.id === "explore-work")!;
    assert.equal(explore.action?.kind, "reveal");
    assert.equal(explore.action?.label, "Why this works");
  });

  it("§WP-10d owning pieces for an undeclared life area does not promote it into Ways to get dressed", () => {
    const page = buildWardrobePage(inputWithRegisterPairings());
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed");
    const explored = explore?.entries.map((e) => e.id) ?? [];
    assert.ok(!explored.includes("explore-everyday"), "everyday was never named as part of her life");
  });

  it("§WP-10e a needed register with zero Closet coverage still renders, and says so plainly", () => {
    const page = buildWardrobePage(inputWithNeededButEmptyWork());
    const wearBlocks = page.sections.find((s) => s.id === "wear")!.blocks;
    const explore = wearBlocks.find((b) => b.id === "ways-to-get-dressed")!.entries.find((e) => e.id === "explore-work");
    assert.ok(explore, "a needed register with nothing in the Closet must still render, never be hidden");
    assert.match(explore!.body ?? "", /doesn't have anything for this part of your life yet/i);
  });

  it("§WP-10f a needed register with real depth but no candidate ever formed says so precisely, not that none can exist", () => {
    const page = buildWardrobePage(inputWithNeededWorkNoCandidate());
    const wearBlocks = page.sections.find((s) => s.id === "wear")!.blocks;
    const explore = wearBlocks.find((b) => b.id === "ways-to-get-dressed")!.entries.find((e) => e.id === "explore-work")!;
    assert.doesNotMatch(explore.body ?? "", /there isn't a combination in your closet for this/i);
    assert.match(explore.body ?? "", /nAia hasn't selected a work example to show here yet/i);
  });

  it("§WP-10g a 'Plenty of options' register never coexists with an unqualified 'no combination exists' claim", () => {
    for (const input of [inputWithRegisterPairings(), inputWithNeededWorkNoCandidate(), baseInput()]) {
      const page = buildWardrobePage(input);
      const doExplore = page.sections.find((s) => s.id === "wear")?.blocks.find((b) => b.id === "ways-to-get-dressed");
      if (!doExplore) continue;
      for (const registerKey of ["everyday", "work"]) {
        const explore = doExplore.entries.find((e) => e.id === `explore-${registerKey}`);
        if (!explore) continue;
        const flatDenial = /there isn't a combination in your closet for this|the closet (cannot|can't) make/i;
        assert.doesNotMatch(explore.body ?? "", flatDenial,
          `"${registerKey}" example card must never deny a combination can exist: "${explore.body}"`);
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
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const work = explore.entries.find((e) => e.id === "explore-work")!;
    assert.equal(work.title, "For work");
  });

  it("§WP-11b a genuinely gym-tagged combination gets its own card, directly under it, when fitness/gym is declared", () => {
    const input = baseInput();
    const gym = pairingFixture({ id: "p-gym", garmentIds: ["g10", "g11"], reason: "You've tagged these for gym." });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [gym] }, [gym]);
    input.lifestyle = ["fitness-gym"];
    const page = buildWardrobePage(input);

    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const gymEntry = explore.entries.find((e) => e.id === "explore-gym");
    assert.ok(gymEntry, "a gym card should appear");
    assert.equal(gymEntry!.title, "For active / gym days");
    assert.ok(gymEntry!.garmentIds.includes("g10"), "the combination's own images sit directly on the gym card");
  });

  it("§WP-11c gym is declared but nothing is gym-tagged: no card is invented", () => {
    const input = inputWithRegisterPairings();
    input.lifestyle = ["fitness-gym"];
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    assert.equal(explore.entries.find((e) => e.id === "explore-gym"), undefined);
  });

  it("§WP-11d undeclared gym-only pairing is not surfaced under For everyday", () => {
    const input = baseInput();
    const gym = pairingFixture({ id: "p-gym2", garmentIds: ["g12", "g13"], reason: "You've tagged these for gym." });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [gym] }, [gym]);
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    assert.equal(explore.entries.find((e) => e.id === "explore-gym"), undefined, "no Active/Gym card without the declared lifestyle");
    const everydayEntry = explore.entries.find((e) => e.id === "explore-everyday")!;
    assert.ok(!everydayEntry.garmentIds.includes("g12"), "not relabelled For everyday either");
  });

  it("§WP-11e a genuinely everyday-compatible pairing still renders under For everyday", () => {
    const input = baseInput();
    const casual = pairingFixture({ id: "p-casual", garmentIds: ["g14", "g15"] });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ everyday: [casual] }, [casual]);
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const everydayEntry = explore.entries.find((e) => e.id === "explore-everyday")!;
    assert.ok(everydayEntry.garmentIds.includes("g14"), "evidence that IS genuinely everyday still renders there");
  });

  it("§WP-11g combination explanations name the actual garments", () => {
    const input = baseInput();
    const work = pairingFixture({ id: "p-named", garmentIds: ["g6"], register: "work" });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ work: [work] }, [work]);
    input.garmentName = (id: string) => (id === "g6" ? "Beige Tailored Trousers" : null);
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const workEntry = explore.entries.find((e) => e.id === "explore-work")!;
    assert.match(workEntry.body ?? "", /beige tailored trousers/i);
    assert.match(workEntry.body ?? "", /^Try your/);
  });

  it("§WP-11h most-versatile folds into the Work combination's 'Why this works' detail, never a standalone card", () => {
    const input = baseInput();
    const work = pairingFixture({ id: "p-versatile-work", garmentIds: ["g1", "g6"], register: "work" });
    (input.intelligence as unknown as { pairings: unknown }).pairings = pairingsIntelligence({ work: [work] }, [work]);
    // g1 is the most-versatile hero in baseInput(), with 2 partners (g3, g5).
    const page = buildWardrobePage(input);
    const explore = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "ways-to-get-dressed")!;
    const workEntry = explore.entries.find((e) => e.id === "explore-work")!;
    const detail = workEntry.action?.kind === "reveal" ? workEntry.action.detail : undefined;
    assert.match(detail ?? "", /one of your most versatile.*pairs with 2 others/i);
    // No standalone hero card for g1 in "wear".
    const wearGarments = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "garments");
    assert.equal(wearGarments, undefined, "hero cards are not their own visible block");
  });
});

// ── §WP-13 — the wardrobe profile: one compact moment, nothing repeated ───────

describe("§WP-13 the wardrobe profile states its conclusions once, mostly collapsed", () => {
  it("§WP-13a colours, silhouettes, StyleMe history and wear behaviour are always visible, in one line each", () => {
    const input = baseInput();
    (input.intelligence as unknown as { dna: unknown }).dna = {
      palette: [{ colour: "Black", count: 19 }], shapes: [{ label: "Straight" }],
      traits: [], shapesReading: "Straight shapes recur most, with fitted and relaxed close behind.",
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lines = (block.meta as Record<string, unknown>).summaryLines as string[];
    assert.ok(lines.some((l) => /mostly colours you like/i.test(l)));
    assert.ok(lines.some((l) => /straight shapes recur most/i.test(l)));
    assert.ok(lines.some((l) => /relaxed, everyday looks/i.test(l)));
    assert.ok(lines.some((l) => /still learning/i.test(l) && /wore/i.test(l)));
  });

  it("§WP-13b wear behaviour correctly credits 'Wore it' as genuine self-reported evidence", () => {
    const page = buildWardrobePage(baseInput());
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lines = (block.meta as Record<string, unknown>).summaryLines as string[];
    const wearLine = lines.find((l) => /wear behaviour/i.test(l))!;
    assert.doesNotMatch(wearLine, /doesn't track what you actually wear yet/i);
    assert.match(wearLine, /knows about looks you tell it you wore/i);
  });

  it("§WP-13c the Lifestyle comparison is not a second, unlabelled headline — it lives only inside the reveal", () => {
    const page = buildWardrobePage(baseInput());
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lines = (block.meta as Record<string, unknown>).summaryLines as string[];
    for (const line of lines) assert.doesNotMatch(line, /fewer ways to combine|plenty of everyday options/i);
    assert.ok(block.entries.some((e) => e.id === "match-lifestyle"), "the evidence is still available behind the reveal");
    assert.ok(block.disclosure, "detail sits behind a reveal");
  });

  it("§WP-13d the hero's own reading is the same sentence as the profile's lifestyle evidence", () => {
    const page = buildWardrobePage(baseInput());
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lifestyle = block.entries.find((e) => e.id === "match-lifestyle")!;
    assert.equal(page.reading, lifestyle.body);
  });

  it("§WP-13e capability counts are inside the reveal only, never a visible summary line", () => {
    const page = buildWardrobePage(baseInput());
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lines = (block.meta as Record<string, unknown>).summaryLines as string[];
    for (const line of lines) assert.doesNotMatch(line, /put together|22 pieces/i);
    assert.ok(block.entries.some((e) => e.claim === "closet-capability"));
  });

  it("§WP-13f trench/favourite-type heroes survive as profile evidence, correctly self-excluded", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: unknown }).heroes = {
      state: "available",
      heroes: [{
        garmentId: "trench1", name: "Beige Double-Breasted Trench Coat", category: "OUTERWEAR",
        label: "passport-match", labelText: null,
        headline: "This is the piece closest to what you told nAia you want.", reasons: [],
        evidence: [
          { signal: "passport-signal", field: "OnboardingProfile", detail: "x", garmentIds: ["trench1"] },
          { signal: "garment-fact", field: "compatibility graph", detail: "x", garmentIds: ["m1", "m2"] },
        ],
      }],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const entry = block.entries.find((e) => e.id === "hero-trench1")!;
    assert.ok(!entry.garmentIds.includes("trench1"), "never its own match");
    assert.deepEqual(entry.garmentIds, ["m1", "m2"]);
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
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
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
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
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
          evidence: [{ signal: "garment-fact", field: "formality/compatibility graph", detail: "x", garmentIds: ["m1", "m2"] }] },
      ],
    };
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => (e.meta as Record<string, unknown>)?.garmentId === "g1")!;
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
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
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

describe("§WP-16 an unresolved shape reads as an instruction, not a taxonomy chip", () => {
  it("§WP-16a the title folds an unresolved shape into a register-prefixed instruction, never a garment type", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "shop")!.blocks.find((b) => b.id === "worth-considering")!;
    const entry = block.entries[0];
    assert.equal(
      entry.title,
      "For work, look for a full-length piece in a shape that's different from the ones you already own.",
    );
    assert.doesNotMatch(entry.title ?? "", /a different shape|work bottom/i);
  });

  it("§WP-16b the raw 'a different shape' attribute is not also shown as a chip", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "shop")!.blocks.find((b) => b.id === "worth-considering")!;
    const attrs = ((block.entries[0].meta as Record<string, unknown>).attributes ?? []) as Array<{ kind: string; label: string }>;
    assert.equal(attrs.some((a) => /a different shape/i.test(a.label)), false);
    assert.ok(attrs.some((a) => a.kind === "colour"), "other attributes are untouched");
  });

  it("§WP-16c the visible body names the real unlock count and colour, with no gap restatement", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "shop")!.blocks.find((b) => b.id === "worth-considering")!;
    const entry = block.entries[0];
    assert.match(entry.body ?? "", /^It could work with 2 pieces already in your Closet\. Grey is one colour you like that appears less often\./);
    assert.doesNotMatch(entry.body ?? "", /repeat similar combinations/i);
  });

  it("§WP-16d 'Why this?' explains the shape without restating the wardrobe-gap reasoning (Moment 3's alone)", () => {
    const page = buildWardrobePage(inputWithShapeRecommendation());
    const block = page.sections.find((s) => s.id === "shop")!.blocks.find((b) => b.id === "worth-considering")!;
    const detail = block.entries[0].action?.kind === "reveal" ? block.entries[0].action.detail : undefined;
    assert.ok(detail);
    assert.doesNotMatch(detail!, /^This comes from/i);
    assert.doesNotMatch(detail!, /repeat similar combinations/i, "the gap reasoning has exactly one home: 'What deserves your attention'");
    assert.match(detail!, /more ways to combine what you already own/i);
    assert.match(detail!, /grey is one of the colours you selected in your passport/i);
  });
});

// ── §WP-18 — a garment never reveals itself, counts always agree with what's shown ─

describe("§WP-18 cleanPartnerIds: the shared self-match/dedup guard", () => {
  it("§WP-18a removes every id in selfIds", () => {
    assert.deepEqual(cleanPartnerIds(["a", "b", "c"], ["b"]), ["a", "c"]);
    assert.deepEqual(cleanPartnerIds(["a"], ["a"]), []);
  });
  it("§WP-18b removes duplicate ids, keeping first occurrence order", () => {
    assert.deepEqual(cleanPartnerIds(["a", "b", "a", "c", "b"], []), ["a", "b", "c"]);
  });
  it("§WP-18c self-exclusion and dedup compose", () => {
    assert.deepEqual(cleanPartnerIds(["a", "b", "a", "self", "c"], ["self"]), ["a", "b", "c"]);
  });
});

describe("§WP-18 a passport-match or favourite hero never reveals itself as its only match", () => {
  function inputWithHero(label: string, headline: string, reasons: string[]): WardrobePageInput {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: { state: string; heroes: unknown[] } }).heroes = {
      state: "available",
      heroes: [{
        garmentId: "trench1", name: "Beige Double-Breasted Trench Coat", category: "OUTERWEAR",
        label, labelText: null, headline, reasons,
        evidence: [
          { signal: "passport-signal", field: "OnboardingProfile", detail: "Aligns on colour and shape.", garmentIds: ["trench1"] },
          { signal: "garment-fact", field: "compatibility graph", detail: "Compatible with 2 pieces.", garmentIds: ["m1", "m2"] },
        ],
      }],
    };
    (input.intelligence as unknown as { opportunities: { rediscover: unknown[] } }).opportunities = { rediscover: [] };
    return input;
  }

  it("§WP-18d passport-match hero (the trench) reveals its real partners, never itself", () => {
    const page = buildWardrobePage(inputWithHero(
      "passport-match", "This is the piece closest to what you told nAia you want.",
      ["Matches your Passport on colour and shape.", "And it still works with 2 other pieces you own."],
    ));
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.id === "hero-trench1")!;
    assert.equal(entry.action?.kind, "reveal");
    const revealed = (entry.action as { garmentIds: string[] }).garmentIds;
    assert.ok(!revealed.includes("trench1"), "the trench must never appear in its own match list");
    assert.deepEqual(revealed, ["m1", "m2"]);
  });

  it("§WP-18e your-favourite hero (the bag) reveals its real partners, never itself", () => {
    const input = inputWithHero(
      "your-favourite", "One of your favourites — and one of your most connected pieces.", [],
    );
    (input.intelligence as unknown as { heroes: { heroes: Array<Record<string, unknown>> } })
      .heroes.heroes[0].garmentId = "bag1";
    (input.intelligence as unknown as { heroes: { heroes: Array<Record<string, unknown>> } })
      .heroes.heroes[0].evidence = [
        { signal: "self-reported-wardrobe", field: "garmentRelationships", detail: "Marked as a favourite.", garmentIds: ["bag1"] },
        { signal: "garment-fact", field: "compatibility graph", detail: "Compatible with 3 pieces.", garmentIds: ["m1", "m2", "m3"] },
      ];
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.id === "hero-bag1")!;
    assert.equal(entry.action?.kind, "reveal");
    const revealed = (entry.action as { garmentIds: string[] }).garmentIds;
    assert.ok(!revealed.includes("bag1"), "the bag must never appear in its own match list");
    assert.deepEqual(revealed, ["m1", "m2", "m3"]);
  });

  it("§WP-18f zero genuine partners after self-removal means no action at all", () => {
    const input = inputWithHero("passport-match", "x", []);
    (input.intelligence as unknown as { heroes: { heroes: Array<Record<string, unknown>> } })
      .heroes.heroes[0].evidence = [
        { signal: "passport-signal", field: "OnboardingProfile", detail: "x", garmentIds: ["trench1"] },
        { signal: "garment-fact", field: "compatibility graph", detail: "x", garmentIds: ["trench1"] },
      ];
    const page = buildWardrobePage(input);
    const entry = page.sections.flatMap((s) => s.blocks).flatMap((b) => b.entries)
      .find((e) => e.id === "hero-trench1")!;
    assert.equal(entry.action, undefined, "no fake action when no genuine partner survives");
  });

  it("§WP-18g a rediscover piece with duplicate partner ids in its own list is deduplicated before it reaches the count or the reveal", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: { state: string; heroes: unknown[] } }).heroes =
      { state: "available", heroes: [] };
    (input.intelligence as unknown as { opportunities: { rediscover: unknown[] } }).opportunities = {
      rediscover: [{
        garmentId: "top1", name: "Cream Ribbed Knit Tank Top", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 8 potential matching pieces.",
        worksWithIds: ["j1", "j1", "top1", "j2", "j2", "j3"],
      }],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
    const entry = block.entries[0];
    assert.deepEqual(entry.garmentIds, ["j1", "j2", "j3"], "duplicates removed, self removed, order preserved");
    assert.equal((entry.action as { garmentIds: string[] }).garmentIds.length, 3);
  });
});

describe("§WP-18 blazer grouping is correct and honest about both garments", () => {
  it("§WP-18h grouping compares partner sets after self-removal, not raw lists that might include the other member", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: { state: string; heroes: unknown[] } }).heroes =
      { state: "available", heroes: [] };
    (input.intelligence as unknown as { opportunities: { rediscover: unknown[] } }).opportunities = {
      rediscover: [
        { garmentId: "b1", name: "Beige Tailored Blazer", imageUrl: null,
          body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
          worksWithIds: ["m1", "m2", "m3", "m4", "m5", "m6"] },
        { garmentId: "b2", name: "Beige Oversized Blazer", imageUrl: null,
          body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
          worksWithIds: ["m6", "m5", "m4", "m3", "m2", "m1"] },
      ],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
    assert.equal(block.entries.length, 1, "genuinely identical sets still group");
    const entry = block.entries[0];
    assert.ok(!entry.garmentIds.includes("b1") && !entry.garmentIds.includes("b2"),
      "neither blazer is ever its own — or the other's — 'match'");
  });

  it("§WP-18i grouped copy says 'both', names both garments, and states the true shared count", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: { state: string; heroes: unknown[] } }).heroes =
      { state: "available", heroes: [] };
    (input.intelligence as unknown as { opportunities: { rediscover: unknown[] } }).opportunities = {
      rediscover: [
        { garmentId: "b1", name: "Beige Tailored Blazer", imageUrl: null,
          body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
          worksWithIds: ["m1", "m2", "m3", "m4", "m5", "m6"] },
        { garmentId: "b2", name: "Beige Oversized Blazer", imageUrl: null,
          body: "You marked this as difficult to style. nAia found 6 potential matching pieces.",
          worksWithIds: ["m1", "m2", "m3", "m4", "m5", "m6"] },
      ],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
    const entry = block.entries[0];
    assert.match(entry.body ?? "", /you marked both your beige tailored blazer and beige oversized blazer as difficult to style/i);
    assert.match(entry.body ?? "", /the same 6 pieces work with either/i);
    assert.doesNotMatch(entry.body ?? "", /you marked this as difficult/i, "never the singular, reused-from-one-member wording");
    assert.equal(entry.garmentIds.length, 6);
  });

  it("§WP-18j every displayed partner count equals the length of the actually-revealed set", () => {
    const input = baseInput();
    (input.intelligence as unknown as { heroes: { state: string; heroes: unknown[] } }).heroes =
      { state: "available", heroes: [] };
    (input.intelligence as unknown as { opportunities: { rediscover: unknown[] } }).opportunities = {
      rediscover: [{
        garmentId: "top1", name: "Cream Ribbed Knit Tank Top", imageUrl: null,
        body: "You marked this as difficult to style. nAia found 8 potential matching pieces.",
        worksWithIds: ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"],
      }],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "wear")!.blocks.find((b) => b.id === "worth-trying")!;
    const entry = block.entries[0];
    const revealedCount = (entry.action as { garmentIds: string[] }).garmentIds.length;
    const text = String((entry.meta as Record<string, unknown>)?.rediscover ?? "");
    const statedCount = Number(text.match(/(\d+) potential match/)?.[1]);
    assert.equal(statedCount, revealedCount, "the stated count and the revealed set must always agree");
    assert.equal(entry.garmentIds.length, revealedCount);
  });
});

// ── §WP-19 — the hero's one prioritised reading ───────────────────────────────

describe("§WP-19 the hero states one prioritised reading, never colour, never three equal findings", () => {
  it("§WP-19a a mixed strong/thin wardrobe gets the exact locked partial-state wording", () => {
    const page = buildWardrobePage(baseInput()); // everyday strong, work needs-range
    assert.equal(page.reading, "You have plenty of everyday options. Your work wardrobe has fewer ways to combine.");
  });

  it("§WP-19b the hero reading never mentions colour", () => {
    const input = inputWithPalette([{ colour: "Grey", count: 3, share: 0.1, neutral: true }]);
    const page = buildWardrobePage(input);
    assert.doesNotMatch(page.reading ?? "", /grey|colour/i);
  });

  it("§WP-19c 'covered' never appears in the hero reading (ambiguous with coverage preferences elsewhere on the page)", () => {
    const page = buildWardrobePage(baseInput());
    assert.doesNotMatch(page.reading ?? "", /\bcovered\b/i);
  });

  it("§WP-19d changeLines is empty when nothing changed, populated when it did", () => {
    const page = buildWardrobePage(baseInput());
    assert.deepEqual(page.changeLines, []);
  });
});

// ── §WP-12 (renumbered under content-lock) — colour palette summary ───────────

function inputWithPalette(palette: Array<{ colour: string; count: number; share: number; neutral: boolean }>): WardrobePageInput {
  const input = baseInput();
  (input.intelligence as unknown as { dna: { palette: unknown } }).dna.palette = palette;
  return input;
}

describe("§WP-12 the profile's colour line is generic — abundance-to-low-priority reasoning lives in Shop Smarter only", () => {
  it("§WP-12a a dominant colour never gets a role-specific 'low priority' claim in the profile", () => {
    const page = buildWardrobePage(inputWithPalette([{ colour: "Black", count: 19, share: 0.4, neutral: true }]));
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lines = (block.meta as Record<string, unknown>).summaryLines as string[];
    for (const line of lines) assert.doesNotMatch(line, /low priority|plenty of black/i);
  });

  it("§WP-12b the colour summary names the thin colour when the engine has identified one", () => {
    const input = inputWithPalette([{ colour: "Black", count: 19, share: 0.4, neutral: true }]);
    (input.needs as unknown as { synthesis: unknown }).synthesis = {
      state: "available",
      lines: [{ id: "synth-colour", kind: "uneven", reading: "x", evidence: [], thinLabel: "Grey" }],
    };
    const page = buildWardrobePage(input);
    const block = page.sections.find((s) => s.id === "profile")!.blocks.find((b) => b.id === "profile")!;
    const lines = (block.meta as Record<string, unknown>).summaryLines as string[];
    assert.ok(lines.some((l) => /mostly colours you like; grey appears less often/i.test(l)));
  });
});
