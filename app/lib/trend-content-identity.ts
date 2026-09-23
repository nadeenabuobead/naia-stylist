// app/lib/trend-content-identity.ts
//
// STABLE IDENTITY for every Trend Report object a customer can save or dismiss.
//
// Why this exists: report content lives in JSON arrays of display text. Before
// anything can carry a ♡ or a "Not for me", each object needs an identifier that
// survives copy edits, renames and reordering — because a SavedItem or a
// TrendContentFeedback row points at it and must keep pointing at the same thing.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
// Identity is the STORED id. Display text is never identity.
//
// A label only ever SEEDS an id, once, when an entry first acquires one. From
// that moment the id is stored in the entry and preserved verbatim through every
// subsequent edit — see recoverOrMintIds(), which reclaims a previous id by name
// or by position before it will mint a new one. Rename a trend and its id does
// not move; saves stay attached.
//
// Seeding is deterministic (FNV-1a, no randomness, no crypto) so the backfill is
// idempotent: running it twice produces the same ids, and running it over rows
// that already have ids changes nothing.
//
// ── SCOPE ────────────────────────────────────────────────────────────────────
// Not every content type is scoped to a report:
//
//   TREND / SIGNAL / REFERENCE   report-scoped   — minted, immutable
//   TAKEAWAY                     edition-scoped  — semantic section key, never text
//   PRODUCT                      global          — NADINE handle, already stable
//   FACET                        global          — controlled vocabulary token
//   LOOK                         global          — SavedLook id
//
// FACET is deliberately global: saving "suede" in the Autumn Edit and again in a
// later report is the SAME saved object. That is what makes repeated engagement
// with a material or colour legible to the taste layer later.

import { validateFacets, isEmptyFacets } from "./trend-facets";

// ── Content types ─────────────────────────────────────────────────────────────

export const TREND_CONTENT_TYPES = [
  "TREND",     // a key trend / story within a report
  "SIGNAL",    // a rising or fading signal
  "REFERENCE", // a brand / collection reference card
  "PRODUCT",   // a NADINE catalogue piece
  "FACET",     // a colour family, material, silhouette … from the controlled vocabulary
  "TAKEAWAY",  // a section of a customer's own personalised edit
  "LOOK",      // a saved StyleMe look
] as const;

export type TrendContentType = (typeof TREND_CONTENT_TYPES)[number];

export function isTrendContentType(value: unknown): value is TrendContentType {
  return typeof value === "string" && (TREND_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Content types that are meaningless without a report. */
const REPORT_SCOPED: ReadonlySet<TrendContentType> = new Set(["TREND", "SIGNAL", "REFERENCE", "TAKEAWAY"]);

/** Report fields that hold identity-bearing entries, and the content type each yields. */
export const IDENTITY_BEARING_FIELDS = {
  keyTrends:                "TREND",
  rising:                   "SIGNAL",
  fading:                   "SIGNAL",
  referencesBehindThisEdit: "REFERENCE",
} as const satisfies Record<string, TrendContentType>;

export type IdentityBearingField = keyof typeof IDENTITY_BEARING_FIELDS;

export const IDENTITY_BEARING_FIELD_NAMES = Object.keys(
  IDENTITY_BEARING_FIELDS,
) as IdentityBearingField[];

// ── Takeaway sections ─────────────────────────────────────────────────────────
// Semantic identity for a personalised edit's sections. These key off the fixed
// ShopperEdit shape, NOT the generated sentence — so regenerating an edit, or
// rewording a section, keeps a save attached to the same takeaway.

export const TAKEAWAY_SECTION_KEYS = [
  "yourVersion",
  "evidenceStyleDna",
  "evidencePassportSays",
  "evidenceCloset",
  "evidenceReviews",
  "yourBestRouteIn",
  "aLookToTry",
  "theBalanceToProtect",
  "worthInvesting",
  "partToTake",
  "partToLeave",
] as const;

export type TakeawaySectionKey = (typeof TAKEAWAY_SECTION_KEYS)[number];

export function isTakeawaySectionKey(value: unknown): value is TakeawaySectionKey {
  return typeof value === "string" && (TAKEAWAY_SECTION_KEYS as readonly string[]).includes(value);
}

/**
 * Content id for one takeaway. List-valued sections (partToTake, partToLeave)
 * take a zero-based index; scalar sections must not.
 */
export function makeTakeawayContentId(section: TakeawaySectionKey, index?: number): string {
  if (index === undefined) return section;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Takeaway index must be a non-negative integer, received: ${String(index)}`);
  }
  return `${section}:${index}`;
}

// ── Id format ─────────────────────────────────────────────────────────────────

const ID_PREFIX = "tc_";
const ID_HEX_LENGTH = 12;
const ID_PATTERN = new RegExp(`^${ID_PREFIX}[0-9a-f]{${ID_HEX_LENGTH}}$`);

export function isContentId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * FNV-1a over UTF-16 code units, run twice with different offsets to fill 48
 * bits. Not cryptographic and does not need to be — these are content ids, and
 * the backfill checks for collisions within a report before accepting them.
 */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619, kept in 32-bit range without Math.imul overflow surprises
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

function hex(value: number, digits: number): string {
  return value.toString(16).padStart(digits, "0").slice(-digits);
}

/** Deterministic id from a seed string. Same seed in, same id out, always. */
export function deriveContentId(seed: string): string {
  const a = fnv1a(seed, 0x811c9dc5);
  const b = fnv1a(`${seed}#2`, 0x01000193);
  return `${ID_PREFIX}${hex(a, 8)}${hex(b, 4)}`;
}

/** Normalised label used only as SEED material — never as identity. */
function seedLabel(entry: Record<string, unknown>): string {
  const raw =
    entry.name ?? entry.signal ?? entry.trend ?? entry.brand ?? entry.label ?? "";
  return String(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

function seedFor(slug: string, field: string, index: number, entry: Record<string, unknown>): string {
  return `${slug}|${field}|${index}|${seedLabel(entry)}`;
}

// ── Recover-or-mint ───────────────────────────────────────────────────────────

/**
 * Assign an id to every entry in one report field, preserving existing identity
 * wherever it can be recovered. Resolution order per entry:
 *
 *   1. the entry already carries a valid id            → keep it
 *   2. a previous entry in the same field has the same
 *      normalised label                                 → reclaim that id  (copy was edited)
 *   3. a previous entry sits at the same index          → reclaim that id  (label was renamed)
 *   4. nothing matches                                  → derive a fresh id
 *
 * Steps 2 and 3 are what make a rename safe: the admin edits raw JSON, and if the
 * id is dropped from the textarea we recover it rather than orphaning saves.
 *
 * Pure: returns new entries, mutates nothing.
 */
export function recoverOrMintIds(
  slug: string,
  field: string,
  entries: ReadonlyArray<Record<string, unknown>>,
  previousEntries: ReadonlyArray<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  const byLabel = new Map<string, string>();
  const byIndex = new Map<number, string>();

  previousEntries.forEach((prev, i) => {
    if (!isContentId(prev.id)) return;
    const label = seedLabel(prev);
    // First writer wins — an earlier duplicate label keeps the claim.
    if (label && !byLabel.has(label)) byLabel.set(label, prev.id as string);
    byIndex.set(i, prev.id as string);
  });

  const claimed = new Set<string>();
  const out: Array<Record<string, unknown>> = [];

  entries.forEach((entry, index) => {
    let id: string | null = null;

    if (isContentId(entry.id) && !claimed.has(entry.id as string)) {
      id = entry.id as string;
    }

    if (!id) {
      const label = seedLabel(entry);
      const fromLabel = label ? byLabel.get(label) : undefined;
      if (fromLabel && !claimed.has(fromLabel)) id = fromLabel;
    }

    if (!id) {
      const fromIndex = byIndex.get(index);
      if (fromIndex && !claimed.has(fromIndex)) id = fromIndex;
    }

    if (!id) {
      // Derive, then walk a discriminator until the id is free within this field.
      let attempt = 0;
      let candidate = deriveContentId(seedFor(slug, field, index, entry));
      while (claimed.has(candidate)) {
        attempt += 1;
        candidate = deriveContentId(`${seedFor(slug, field, index, entry)}|${attempt}`);
      }
      id = candidate;
    }

    claimed.add(id);
    out.push({ ...entry, id });
  });

  return out;
}

// ── Edition key ───────────────────────────────────────────────────────────────

/**
 * Identifies a report EDITION — the thing customer-facing history shows one card
 * for. Derived from the set of content ids plus title and season, so:
 *
 *   editing a trend's copy          → same edition   (same objects, reworded)
 *   adding or removing a trend      → new edition    (the report is materially different)
 *   an engine or schema bump        → same edition   (nothing here changes)
 *
 * Content ids are sorted, so reordering the array alone does not mint a new edition.
 */
export function computeEditionKey(report: {
  title?: string | null;
  season?: string | null;
  keyTrends?: unknown;
  rising?: unknown;
  fading?: unknown;
  referencesBehindThisEdit?: unknown;
}): string {
  const ids: string[] = [];
  for (const field of IDENTITY_BEARING_FIELD_NAMES) {
    const entries = report[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const id = (entry as Record<string, unknown> | null)?.id;
      if (isContentId(id)) ids.push(id as string);
    }
  }
  ids.sort();
  const seed = `${report.title ?? ""}|${report.season ?? ""}|${ids.join(",")}`;
  return deriveContentId(seed).slice(ID_PREFIX.length);
}

// ── Reference keys ────────────────────────────────────────────────────────────

export interface TrendContentRef {
  contentType: TrendContentType;
  /** Stored id, NADINE handle, facet token, section key, or SavedLook id. */
  contentId: string;
  /** Required for TREND / SIGNAL / REFERENCE / TAKEAWAY. */
  reportId?: string | null;
  /** Required for TAKEAWAY — pins a takeaway to the report edition it belongs to. */
  editionKey?: string | null;
}

/**
 * The durable key a SavedItem or TrendContentFeedback row is stored under.
 * Built only from stable identifiers — never from a label or normalised
 * display text.
 */
export function buildRefKey(ref: TrendContentRef): string {
  const { contentType, contentId } = ref;

  if (!isTrendContentType(contentType)) {
    throw new Error(`Unknown trend content type: ${String(contentType)}`);
  }
  if (typeof contentId !== "string" || contentId.trim() === "") {
    throw new Error(`Content id is required for ${contentType}`);
  }

  if (REPORT_SCOPED.has(contentType)) {
    if (!ref.reportId) {
      throw new Error(`${contentType} is report-scoped and requires a reportId`);
    }
    if (contentType === "TAKEAWAY") {
      if (!ref.editionKey) {
        throw new Error("TAKEAWAY is edition-scoped and requires an editionKey");
      }
      return `r:${ref.reportId}@${ref.editionKey}|TAKEAWAY|${contentId}`;
    }
    return `r:${ref.reportId}|${contentType}|${contentId}`;
  }

  return `g|${contentType}|${contentId}`;
}

// ── Applying identity to a whole report ───────────────────────────────────────

export interface IdentityBearingReport {
  slug: string;
  title?: string | null;
  season?: string | null;
  keyTrends?: unknown;
  rising?: unknown;
  fading?: unknown;
  referencesBehindThisEdit?: unknown;
}

export interface AppliedIdentity {
  keyTrends: Array<Record<string, unknown>>;
  rising: Array<Record<string, unknown>>;
  fading: Array<Record<string, unknown>>;
  referencesBehindThisEdit: Array<Record<string, unknown>>;
  editionKey: string;
  /** Per-field ids that were newly assigned — drives the backfill report. */
  assigned: Array<{ field: IdentityBearingField; index: number; id: string; label: string }>;
  /** Facet values an editor supplied that are not in the vocabulary. */
  rejectedFacets: Array<{ field: IdentityBearingField; index: number; kind: string; value: unknown }>;
}

/**
 * The single place identity is applied. Pure — no DB, no I/O — so the backfill
 * tooling and the server write path run exactly the same logic, and a dry run is
 * a faithful preview of what a real run would write.
 */
export function applyContentIdentity(
  report: IdentityBearingReport,
  previous: Record<string, unknown> | null = null,
): AppliedIdentity {
  const assigned: AppliedIdentity["assigned"] = [];
  const rejectedFacets: AppliedIdentity["rejectedFacets"] = [];
  const result: Record<string, Array<Record<string, unknown>>> = {};

  for (const field of IDENTITY_BEARING_FIELD_NAMES) {
    const raw = (report as unknown as Record<string, unknown>)[field];
    const entries = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    const previousRaw = previous?.[field];
    const previousEntries = Array.isArray(previousRaw) ? (previousRaw as Record<string, unknown>[]) : [];

    const hadId = entries.map((entry) => isContentId(entry.id));

    result[field] = recoverOrMintIds(report.slug, field, entries, previousEntries).map((entry, index) => {
      if (!hadId[index]) {
        assigned.push({
          field,
          index,
          id: entry.id as string,
          label: String(entry.name ?? entry.signal ?? entry.trend ?? entry.brand ?? entry.label ?? ""),
        });
      }
      const { facets, rejected } = validateFacets(entry.facets);
      for (const r of rejected) rejectedFacets.push({ field, index, kind: r.kind, value: r.value });
      if (isEmptyFacets(facets)) {
        const { facets: _dropped, ...rest } = entry;
        return rest;
      }
      return { ...entry, facets };
    });
  }

  const editionKey = computeEditionKey({
    title: report.title ?? "",
    season: report.season ?? "",
    ...result,
  });

  return {
    keyTrends: result.keyTrends,
    rising: result.rising,
    fading: result.fading,
    referencesBehindThisEdit: result.referencesBehindThisEdit,
    editionKey,
    assigned,
    rejectedFacets,
  };
}
