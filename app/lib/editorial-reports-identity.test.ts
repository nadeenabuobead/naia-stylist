// app/lib/editorial-reports-identity.test.ts
//
// The static fallback and a freshly seeded database must agree on every
// content id for the three legacy built-in reports.
//
// Why this is load-bearing: the facet backfill resolves its manifest by the
// DERIVED legacy id. If the seed path minted opaque ids instead, a freshly
// provisioned environment would seed rows whose ids the manifest could never
// match — the backfill would refuse to write all ten authored facet sets, and
// the failure would look like a data problem rather than a minter mismatch.
//
// It also keeps a save made pre-seed resolving post-seed, which is the reason
// the fallback path applies identity at all.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, fakePrisma } = vi.hoisted(() => {
  const s = { seeded: [] as Array<Record<string, unknown>>, count: 0 };
  return {
    store: s,
    fakePrisma: {
      default: {
        editorialTrendReport: {
          count: vi.fn(async () => s.count),
          findMany: vi.fn(async () => []),
          findUnique: vi.fn(async () => null),
          upsert: vi.fn(async ({ create }: never) => {
            s.seeded.push(create as unknown as Record<string, unknown>);
            return create;
          }),
        },
      },
    },
  };
});

vi.mock("../db.server", () => fakePrisma);

import { getPublishedEditorialReports, seedEditorialReportsFromStatic } from "./editorial-reports.server";
import { trendReports } from "./trend-reports";
import { IDENTITY_BEARING_FIELD_NAMES, isLegacyContentId } from "./trend-content-identity";

/** slug → field → index → id, for whichever shape the reports arrive in. */
function idMap(reports: Array<Record<string, unknown>>) {
  const out = new Map<string, string>();
  for (const r of reports) {
    for (const field of IDENTITY_BEARING_FIELD_NAMES) {
      const list = r[field];
      if (!Array.isArray(list)) continue;
      list.forEach((entry: Record<string, unknown>, i: number) => {
        out.set(`${r.slug}|${field}|${i}`, String(entry.id));
      });
    }
  }
  return out;
}

beforeEach(() => {
  store.seeded = [];
  store.count = 0;
  vi.clearAllMocks();
});

describe("legacy seed identity matches the static fallback", () => {
  it("THE CONTRACT: every content unit gets the same id on both paths", async () => {
    const fallback = idMap((await getPublishedEditorialReports()) as never);

    await seedEditorialReportsFromStatic();
    const seeded = idMap(store.seeded as never);

    expect(fallback.size).toBeGreaterThan(0);

    let compared = 0;
    for (const [key, fallbackId] of fallback) {
      expect(seeded.get(key), `id mismatch at ${key}`).toBe(fallbackId);
      compared += 1;
    }
    // Guard against the assertion loop silently comparing nothing.
    expect(compared).toBe(fallback.size);
  });

  it("seeded ids are DERIVED, not opaque — the facet manifest depends on it", async () => {
    await seedEditorialReportsFromStatic();
    const seeded = idMap(store.seeded as never);

    expect(seeded.size).toBeGreaterThan(0);
    for (const [key, id] of seeded) {
      expect(isLegacyContentId(id), `${key} is not a derived legacy id: ${id}`).toBe(true);
    }
  });

  it("covers all three legacy reports, not just the published ones", async () => {
    await seedEditorialReportsFromStatic();
    const slugs = store.seeded.map((r) => r.slug);
    expect(slugs).toHaveLength(trendReports.length);
    expect(new Set(slugs).size).toBe(trendReports.length);
  });

  it("seeding twice produces identical ids — provisioning is repeatable", async () => {
    await seedEditorialReportsFromStatic();
    const first = idMap(store.seeded as never);

    store.seeded = [];
    await seedEditorialReportsFromStatic();
    const second = idMap(store.seeded as never);

    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("every seeded id is unique within its report", async () => {
    await seedEditorialReportsFromStatic();
    for (const report of store.seeded) {
      const ids = IDENTITY_BEARING_FIELD_NAMES.flatMap((f) =>
        Array.isArray(report[f]) ? (report[f] as Array<{ id: string }>).map((e) => e.id) : [],
      );
      expect(new Set(ids).size, `duplicate id in ${report.slug}`).toBe(ids.length);
    }
  });
});
