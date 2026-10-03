// app/lib/ai/buyskip-considered-evidence.test.ts
// Causal tests for the Phase 4 considered-event derivation rule — each
// §CIA-CONSIDERED-1..3 group mirrors one of the 4 real repeat-image groups
// found in production data (see buyskip-considered-evidence.ts's module
// doc); the remaining sections are synthetic fixtures proving the
// consideration-signature rule the real data never happened to exercise.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveConsideredEvents, type ConsideredAnalysisFact } from "./buyskip-considered-evidence.ts";

function fact(partial: Partial<ConsideredAnalysisFact> & { id: string; createdAt: Date }): ConsideredAnalysisFact {
  return {
    customerId: "cust-1", imagePublicId: "img-1", imageUrl: null, category: "Bottom",
    colors: ["Grey"], forOccasion: "brunch with friends", whatLike: "the relaxed drape",
    unsureAbout: "whether the fit is right", itemSize: "M", colorNote: null,
    ...partial,
  };
}

const MIN = 60 * 1000;

describe("§CIA-CONSIDERED-1 real-shape: four re-analyses of the same photo over ~3.5h, each a genuinely separate consideration", () => {
  it("gaps of 22min/169min/25min, same category, but every occasion/whatLike/unsureAbout genuinely different — none collapse", () => {
    const base = new Date("2026-08-03T08:13:59Z").getTime();
    const facts = [
      fact({ id: "a0", createdAt: new Date(base), forOccasion: "birthday lunch", whatLike: "it looks comfortable", unsureAbout: "dont know if its too tight on my body shape", itemSize: "m" }),
      fact({ id: "a1", createdAt: new Date(base + 22 * MIN), forOccasion: "Casual weekend brunch", whatLike: "The wide-leg silhouette and texture", unsureAbout: "Whether it suits my lifestyle enough to wear regularly", itemSize: null }),
      fact({ id: "a2", createdAt: new Date(base + 22 * MIN + 169 * MIN), forOccasion: "Dinner out", whatLike: "The silhouette and drape", unsureAbout: "Whether the fit is right for me", itemSize: "M" }),
      fact({ id: "a3", createdAt: new Date(base + 22 * MIN + 169 * MIN + 25 * MIN), forOccasion: "brunch", whatLike: "The relaxed drape and silhouette", unsureAbout: "Whether the fit will be right for me", itemSize: "M" }),
    ];
    const events = deriveConsideredEvents(facts);
    assert.equal(events.length, 4, "each re-analysis is a distinct consideration — none are close enough, or similar enough, to collapse");
    assert.deepEqual(events.map((e) => e.id), ["a0", "a1", "a2", "a3"]);
  });
});

describe("§CIA-CONSIDERED-2 real-shape: two fully-identical-input re-analyses 16 minutes apart collapse to one", () => {
  it("same category AND same colors/forOccasion/whatLike/unsureAbout/itemSize — collapses to the latest row", () => {
    const base = new Date("2026-08-03T12:10:18Z").getTime();
    const facts = [
      fact({ id: "b0", createdAt: new Date(base) }),
      fact({ id: "b1", createdAt: new Date(base + 16 * MIN) }),
    ];
    const events = deriveConsideredEvents(facts);
    assert.equal(events.length, 1, "16 minutes, identical inputs — one genuine episode");
    assert.equal(events[0].id, "b1", "the representative is the latest row in the episode");
  });
});

describe("§CIA-CONSIDERED-3 real-shape: a same-image category change never collapses, even when the gap is tiny", () => {
  it("Top, Top (4.2h later), then Jewelry 2 minutes after that — all three survive separately", () => {
    const base = new Date("2026-08-03T14:20:30Z").getTime();
    const facts = [
      fact({ id: "c0", category: "Top", colors: ["White"], forOccasion: null, whatLike: null, unsureAbout: null, itemSize: null, createdAt: new Date(base) }),
      fact({ id: "c1", category: "Top", colors: ["White", "Beige"], forOccasion: "dinner dates", whatLike: "the structured silhouette", unsureAbout: null, itemSize: "M", createdAt: new Date(base + 252.5 * MIN) }),
      fact({ id: "c2", category: "Jewelry", colors: ["Gold"], forOccasion: "dinner dates", whatLike: null, unsureAbout: null, itemSize: null, createdAt: new Date(base + 252.5 * MIN + 2.1 * MIN) }),
    ];
    const events = deriveConsideredEvents(facts);
    assert.equal(events.length, 3, "a category change is never collapsed, regardless of how small the gap is");
    assert.deepEqual(events.map((e) => e.category), ["Top", "Top", "Jewelry"]);
  });
});

describe("§CIA-CONSIDERED-4 rows with no category produce nothing", () => {
  it("a null-category row is filtered out entirely — there is no honest value to report", () => {
    const events = deriveConsideredEvents([
      fact({ id: "d0", category: null, createdAt: new Date("2026-07-30T10:26:45Z") }),
      fact({ id: "d1", category: null, createdAt: new Date("2026-07-30T10:48:10Z") }),
    ]);
    assert.deepEqual(events, []);
  });
});

describe("§CIA-CONSIDERED-5 identity requires a real asset reference", () => {
  it("two rows with neither imagePublicId nor imageUrl are never collapsed with each other", () => {
    const base = new Date("2026-08-03T08:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "e0", imagePublicId: null, imageUrl: null, createdAt: new Date(base) }),
      fact({ id: "e1", imagePublicId: null, imageUrl: null, createdAt: new Date(base + 1 * MIN) }),
    ]);
    assert.equal(events.length, 2, "no provable shared identity — each stands alone");
  });

  it("imageUrl is used as the identity fallback when imagePublicId is absent", () => {
    const base = new Date("2026-08-03T08:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "f0", imagePublicId: null, imageUrl: "https://cdn.example/x.png", createdAt: new Date(base) }),
      fact({ id: "f1", imagePublicId: null, imageUrl: "https://cdn.example/x.png", createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 1, "same imageUrl, same category, identical inputs, 5 minutes apart — one episode");
  });
});

describe("§CIA-CONSIDERED-6 a single genuine consideration is simply itself", () => {
  it("one row, one event, using that row's own id/category/time", () => {
    const createdAt = new Date("2026-10-01T00:00:00Z");
    const events = deriveConsideredEvents([fact({ id: "solo", category: "Dress", createdAt })]);
    assert.deepEqual(events, [{ id: "solo", customerId: "cust-1", category: "Dress", observedAt: createdAt }]);
  });
});

describe("§CIA-CONSIDERED-7 different customers are never grouped together", () => {
  it("same image, same moment, different customers — two separate events", () => {
    const createdAt = new Date("2026-10-01T00:00:00Z");
    const events = deriveConsideredEvents([
      fact({ id: "g0", customerId: "cust-A", createdAt }),
      fact({ id: "g1", customerId: "cust-B", createdAt }),
    ]);
    assert.equal(events.length, 2);
  });
});

describe("§CIA-CONSIDERED-8 identical customer inputs inside the window collapse", () => {
  it("same image, same category, identical colors/forOccasion/whatLike/unsureAbout/itemSize/colorNote, 10 minutes apart", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "h0", colorNote: "the darker grey one", createdAt: new Date(base) }),
      fact({ id: "h1", colorNote: "the darker grey one", createdAt: new Date(base + 10 * MIN) }),
    ]);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, "h1");
  });
});

describe("§CIA-CONSIDERED-9 identical inputs outside the window remain separate", () => {
  it("same everything, but 25 minutes apart — the gap alone is enough to keep them distinct", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "i0", createdAt: new Date(base) }),
      fact({ id: "i1", createdAt: new Date(base + 25 * MIN) }),
    ]);
    assert.equal(events.length, 2);
  });
});

describe("§CIA-CONSIDERED-10 a different forOccasion inside the window keeps analyses distinct", () => {
  it("same image, same category, same everything else, only forOccasion differs, 5 minutes apart", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "j0", forOccasion: "birthday lunch", createdAt: new Date(base) }),
      fact({ id: "j1", forOccasion: "work dinner", createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 2, "a genuinely different purpose for the same garment is a distinct consideration");
  });
});

describe("§CIA-CONSIDERED-11 a different whatLike or unsureAbout inside the window keeps analyses distinct", () => {
  it("whatLike differs, 5 minutes apart", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "k0", whatLike: "the relaxed drape", createdAt: new Date(base) }),
      fact({ id: "k1", whatLike: "the structured silhouette", createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 2);
  });

  it("unsureAbout differs, 5 minutes apart", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "l0", unsureAbout: "whether the fit is right", createdAt: new Date(base) }),
      fact({ id: "l1", unsureAbout: "whether it suits my lifestyle", createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 2);
  });
});

describe("§CIA-CONSIDERED-12 a different colour selection inside the window keeps analyses distinct", () => {
  it("colors differ, 5 minutes apart", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "m0", colors: ["Grey"], createdAt: new Date(base) }),
      fact({ id: "m1", colors: ["Grey", "Black"], createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 2);
  });

  it("colour ARRAY ORDER alone is not a meaningful difference — sorted before comparison", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "n0", colors: ["Black", "Grey"], createdAt: new Date(base) }),
      fact({ id: "n1", colors: ["Grey", "Black"], createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 1, "same two colours in a different order is not a material change");
  });
});

describe("§CIA-CONSIDERED-13 harmless formatting differences are normalized, not treated as changes", () => {
  it("whitespace-only differences in free text do not block collapse", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "o0", forOccasion: "  brunch with friends  ", createdAt: new Date(base) }),
      fact({ id: "o1", forOccasion: "brunch with friends", createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 1);
  });

  it("empty string and null are treated the same for a given field", () => {
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "p0", colorNote: "", createdAt: new Date(base) }),
      fact({ id: "p1", colorNote: null, createdAt: new Date(base + 5 * MIN) }),
    ]);
    assert.equal(events.length, 1);
  });
});

describe("§CIA-CONSIDERED-14 AI-generated output is structurally impossible to feed into event identity", () => {
  it("ConsideredAnalysisFact has no verdict/confidence/fullAnalysis/reasoning/closetPairings field at all", () => {
    const f = fact({ id: "q0", createdAt: new Date() });
    for (const field of ["verdict", "confidence", "fullAnalysis", "reasoning", "closetPairings", "stylingIdeas", "alternatives"]) {
      assert.equal(field in f, false, `${field} must not be part of the considered-event input shape`);
    }
  });

  it("two analyses with identical customer inputs collapse regardless of how differently nAia might have answered — the signature never reads AI output in the first place", () => {
    // There is nothing to vary here: the fact type has no AI-output field,
    // so this is true by construction, not by a runtime branch. This test
    // documents that guarantee as a visible, explicit case.
    const base = new Date("2026-10-01T00:00:00Z").getTime();
    const events = deriveConsideredEvents([
      fact({ id: "r0", createdAt: new Date(base) }),
      fact({ id: "r1", createdAt: new Date(base + 10 * MIN) }),
    ]);
    assert.equal(events.length, 1);
  });
});
