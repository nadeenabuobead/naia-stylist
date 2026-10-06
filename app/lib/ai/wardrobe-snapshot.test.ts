// app/lib/ai/wardrobe-snapshot.test.ts
// Run with: node --test --import tsx/esm app/lib/ai/wardrobe-snapshot.test.ts
//
// "What changed?" has to be a real comparison. These tests exist mostly to pin
// what it must REFUSE to say: no change without a previous reading, no change
// from a snapshot written by an older version, and nothing at all when the
// wardrobe has not moved.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summariseWardrobe,
  diffSnapshots,
  changeLines,
  SNAPSHOT_VERSION,
  type WardrobeSnapshotSummary,
} from "./wardrobe-snapshot.ts";

function summary(over: Partial<WardrobeSnapshotSummary> = {}): WardrobeSnapshotSummary {
  return {
    version: SNAPSHOT_VERSION,
    closetCount: 46,
    registers: [
      { register: "everyday", distinctLooks: 9, usableCount: 18 },
      { register: "work", distinctLooks: 3, usableCount: 10 },
    ],
    openGaps: ["need-work-repetition"],
    recommendations: ["rec-work"],
    ...over,
  };
}

describe("§WS-1 summarising", () => {
  it("§WS-1a a summary carries depth, gaps and what was being recommended", () => {
    const s = summariseWardrobe({
      needs: {
        registers: [{ register: "work", distinctLooks: 3, usableCount: 10 }],
        couldUseMore: [{ id: "need-work-repetition" }],
      } as never,
      recommendations: { recommendations: [{ id: "rec-work" }] } as never,
      closetCount: 46,
    });
    assert.equal(s.version, SNAPSHOT_VERSION);
    assert.equal(s.closetCount, 46);
    assert.deepEqual(s.openGaps, ["need-work-repetition"]);
    assert.deepEqual(s.recommendations, ["rec-work"]);
  });
});

describe("§WS-2 what it refuses to say", () => {
  it("§WS-2a no previous reading means no change", () => {
    assert.equal(
      diffSnapshots({ before: null, after: summary(), takenAt: null, added: [] }),
      null,
    );
  });

  it("§WS-2b a snapshot from an older version is ignored, not misread", () => {
    const stale = { ...summary(), version: 0 } as unknown as WardrobeSnapshotSummary;
    assert.equal(
      diffSnapshots({ before: stale, after: summary(), takenAt: "2026-09-01T00:00:00.000Z", added: [] }),
      null,
    );
  });

  it("§WS-2c an unmoved wardrobe produces nothing at all", () => {
    assert.equal(
      diffSnapshots({ before: summary(), after: summary(), takenAt: "2026-09-01T00:00:00.000Z", added: [] }),
      null,
    );
  });
});

describe("§WS-3 what it reports", () => {
  const takenAt = "2026-09-01T00:00:00.000Z";

  it("§WS-3a a new piece reports what it works with, and the depth it added", () => {
    const change = diffSnapshots({
      before: summary(),
      after: summary({
        closetCount: 47,
        registers: [
          { register: "everyday", distinctLooks: 9, usableCount: 18 },
          { register: "work", distinctLooks: 7, usableCount: 11 },
        ],
        openGaps: [],
        recommendations: [],
      }),
      takenAt,
      added: [{ garmentId: "g1", name: "Grey Tailored Trousers", worksWithIds: ["a", "b", "c", "d"] }],
    });
    assert.ok(change);
    assert.equal(change!.piecesAdded, 1);
    assert.deepEqual(change!.improved, [{ register: "work", from: 3, to: 7 }]);
    assert.deepEqual(change!.gapsClosed, ["need-work-repetition"]);
    assert.equal(change!.priorityChanged, true);

    const lines = changeLines(change!);
    assert.match(lines.join(" "), /Grey Tailored Trousers works with 4 pieces you already own\./);
    assert.match(lines.join(" "), /work dressing has more variety/);
    assert.match(lines.join(" "), /closes a gap/);
  });

  it("§WS-3b removing a piece is reported as removal, never as a gain", () => {
    const change = diffSnapshots({
      before: summary(),
      after: summary({ closetCount: 45 }),
      takenAt,
      added: [],
    });
    assert.ok(change);
    assert.equal(change!.piecesRemoved, 1);
    assert.equal(change!.piecesAdded, 0);
    assert.match(changeLines(change!).join(" "), /removed 1 piece/);
  });

  it("§WS-3c depth that fell is not dressed up as an improvement", () => {
    const change = diffSnapshots({
      before: summary(),
      after: summary({
        closetCount: 45,
        registers: [
          { register: "everyday", distinctLooks: 9, usableCount: 18 },
          { register: "work", distinctLooks: 1, usableCount: 8 },
        ],
      }),
      takenAt,
      added: [],
    });
    assert.ok(change);
    assert.deepEqual(change!.improved, []);
    assert.doesNotMatch(changeLines(change!).join(" "), /more variety/);
  });

  it("§WS-3d a piece that combines with nothing makes no claim about combinations", () => {
    const change = diffSnapshots({
      before: summary(),
      after: summary({ closetCount: 47 }),
      takenAt,
      added: [{ garmentId: "g1", name: "Sequin Mini Dress", worksWithIds: [] }],
    });
    assert.ok(change);
    const text = changeLines(change!).join(" ");
    assert.doesNotMatch(text, /works with/);
    assert.match(text, /added 1 piece/);
  });
});

describe("§WS-4 attribution", () => {
  const takenAt = "2026-09-01T00:00:00.000Z";

  it("§WS-4a depth moving without a Closet change is not attributed to a garment", () => {
    // A Passport edit, an admin correction, or an engine change can all move
    // depth. None of them is something she added.
    const change = diffSnapshots({
      before: summary(),
      after: summary({
        registers: [
          { register: "everyday", distinctLooks: 9, usableCount: 18 },
          { register: "work", distinctLooks: 8, usableCount: 10 },
        ],
        openGaps: [],
        recommendations: [],
      }),
      takenAt,
      added: [],
    });
    assert.ok(change);
    assert.equal(change!.piecesAdded, 0);
    const text = changeLines(change!).join(" ");
    assert.match(text, /Your Closet hasn't changed, but nAia's reading of it has\./);
    assert.doesNotMatch(text, /works with \d+ piece|You've added/);
  });

  it("§WS-4b a real addition is not prefixed with the no-change line", () => {
    const change = diffSnapshots({
      before: summary(),
      after: summary({ closetCount: 47 }),
      takenAt,
      added: [{ garmentId: "g1", name: "Grey Trousers", worksWithIds: ["a", "b"] }],
    });
    assert.ok(change);
    assert.doesNotMatch(changeLines(change!).join(" "), /Closet hasn't changed/);
  });
});

describe("§WS-5 evidence boundaries in the change copy", () => {
  it("§WS-5a more variety is never reported as complete outfits", () => {
    const change = diffSnapshots({
      before: summary(),
      after: summary({
        registers: [
          { register: "everyday", distinctLooks: 9, usableCount: 18 },
          { register: "work", distinctLooks: 7, usableCount: 11 },
        ],
      }),
      takenAt: "2026-09-01T00:00:00.000Z",
      added: [],
    });
    assert.ok(change);
    const text = changeLines(change!).join(" ");
    // Distinct looks counts SUPPORTED COMBINATIONS between class
    // representatives. They are not finished, wearable outfits, and crossing
    // the threshold does not make a wardrobe complete.
    assert.match(text, /supported combinations/);
    assert.doesNotMatch(text, /\boutfits?\b/i);
    assert.doesNotMatch(text, /complete|fully covered|everything you need/i);
  });
});
