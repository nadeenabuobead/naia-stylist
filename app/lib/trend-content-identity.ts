// app/lib/trend-content-identity.ts
//
// STABLE IDENTITY for every Trend Report object a customer can save or dismiss.
//
// Why this exists: report content lives in JSON arrays of display text. Before
// anything can carry a ♡ or a "Not for me", each object needs an identifier that
// survives copy edits, renames and reordering — because a SavedItem or a
// TrendContentFeedback row points at it and must keep pointing at the same thing.
//
// ── THE RULES ────────────────────────────────────────────────────────────────
// 1. Identity is the STORED id. Display text is NEVER identity.
// 2. An embedded id is canonical and is always preserved verbatim.
// 3. An id is recovered from the previous version ONLY on exact label evidence.
//    There is no positional recovery: array position is not evidence of identity,
//    and using it would let a brand-new object inherit a deleted object's id.
// 4. Otherwise a NEW OPAQUE id is minted — random, permanent, uncoupled from
//    any content that can change.
//
// Post-backfill, rule 2 does all the work: every entry carries its id, and
// identity is preserved rather than rediscovered. Rules 3 and 4 are the safety
// net for a hand-edited JSON payload that arrives without one.
//
// Deterministic derivation still exists, but ONLY for the one-time legacy
// backfill (deriveLegacyContentId), where re-runnability matters and the content
// is a known fixed set. Runtime minting is opaque.
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
 * Content id for one takeaway: the SECTION KEY, and nothing else.
 *
 * An earlier draft allowed "partToTake:1" for the list-valued sections. That was
 * wrong — the index is the bullet's position in a per-customer generated array,
 * and regenerating an edit can reorder or replace bullets, so "1" identifies a
 * slot rather than a thing. A save would silently re-point at different advice.
 *
 * Whole sections only until the edit engine gives bullets a stable identity of
 * their own (each bullet traces to a named rule in buildShopperEdit, which is
 * where that identity would come from). Section-level identity is stable across
 * regeneration today, which is what the approved rule requires.
 */
export function makeTakeawayContentId(section: TakeawaySectionKey): string {
  if (!isTakeawaySectionKey(section)) {
    throw new Error(`Unknown takeaway section: ${String(section)}`);
  }
  return section;
}

// ── Id format ─────────────────────────────────────────────────────────────────

const ID_PREFIX = "tc_";

// Two shapes, both opaque to every consumer:
//   tc_ + 12 hex   legacy backfill id, deterministically derived, one-time only
//   tc_ + 32 hex   opaque minted id, random, the only shape issued at runtime
const ID_PATTERN = new RegExp(`^${ID_PREFIX}(?:[0-9a-f]{12}|[0-9a-f]{32})$`);

export function isContentId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** True for a one-time legacy backfill id, as opposed to an opaque minted one. */
export function isLegacyContentId(value: unknown): boolean {
  return typeof value === "string" && /^tc_[0-9a-f]{12}$/.test(value);
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

/**
 * Deterministic id from a seed string — LEGACY BACKFILL ONLY.
 *
 * Permanent identity must not be coupled to mutable content, so this is never
 * used at runtime. It exists because the one-time backfill over a known, fixed
 * set of reports has to be re-runnable and produce the same ids every time.
 */
export function deriveLegacyContentId(seed: string): string {
  const a = fnv1a(seed, 0x811c9dc5);
  const b = fnv1a(`${seed}#2`, 0x01000193);
  return `${ID_PREFIX}${hex(a, 8)}${hex(b, 4)}`;
}

/** Context handed to a minter so the legacy variant can build its seed. */
export interface MintContext {
  slug: string;
  field: string;
  index: number;
  entry: Record<string, unknown>;
}

export type ContentIdMinter = (context: MintContext) => string;

/**
 * The runtime minter. Opaque, random, permanent — carries no information about
 * the content it identifies, so no content change can ever invalidate it.
 */
export const mintOpaqueContentId: ContentIdMinter = () => {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, "");
  return `${ID_PREFIX}${uuid}`;
};

/** The one-time backfill minter. Passed explicitly by the backfill script only. */
export const mintLegacyContentId: ContentIdMinter = ({ slug, field, index, entry }) =>
  deriveLegacyContentId(seedFor(slug, field, index, entry));

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
 * Assign an id to every entry in one report field.
 *
 *   1. the entry carries a valid id          → keep it (canonical, always wins)
 *   2. a previous entry has the SAME LABEL   → reclaim that id
 *   3. otherwise                             → mint a new opaque id
 *
 * There is deliberately NO positional recovery. Position is not evidence of
 * identity: if trend A is deleted and an unrelated trend D is inserted at the
 * same index without an id, positional recovery would silently hand D the id
 * that A's saves point at. Minting a new id is the safe failure — a save is
 * orphaned rather than misattributed to the wrong content.
 *
 * Step 2 is scoped to the IMMEDIATELY PREVIOUS saved version only, never to
 * history, so a deleted trend cannot be resurrected by a later trend reusing
 * its label.
 *
 * Pure apart from the minter. Returns new entries; mutates nothing.
 */
export function recoverOrMintIds(
  slug: string,
  field: string,
  entries: ReadonlyArray<Record<string, unknown>>,
  previousEntries: ReadonlyArray<Record<string, unknown>> = [],
  minter: ContentIdMinter = mintOpaqueContentId,
): Array<Record<string, unknown>> {
  const byLabel = new Map<string, string>();

  for (const prev of previousEntries) {
    if (!isContentId(prev.id)) continue;
    const label = seedLabel(prev);
    // First writer wins — an earlier duplicate label keeps the claim.
    if (label && !byLabel.has(label)) byLabel.set(label, prev.id as string);
  }

  const claimed = new Set<string>();
  const out: Array<Record<string, unknown>> = [];

  entries.forEach((entry, index) => {
    let id: string | null = null;

    // 1. Embedded id is canonical.
    if (isContentId(entry.id) && !claimed.has(entry.id as string)) {
      id = entry.id as string;
    }

    // 2. Label evidence from the immediately previous version.
    if (!id) {
      const label = seedLabel(entry);
      const fromLabel = label ? byLabel.get(label) : undefined;
      if (fromLabel && !claimed.has(fromLabel)) id = fromLabel;
    }

    // 3. Mint. Loop guards against the (vanishingly unlikely) duplicate.
    if (!id) {
      let candidate = minter({ slug, field, index, entry });
      let attempt = 0;
      while (claimed.has(candidate)) {
        attempt += 1;
        candidate = minter({ slug, field, index: index + attempt * 1000, entry });
      }
      id = candidate;
    }

    claimed.add(id);
    out.push({ ...entry, id });
  });

  return out;
}

// ── Report identity ─────────────────────────────────────────────────────────
//
// There is no separate "edition key". EditorialTrendReport.id is already an
// immutable, opaque primary key, and deriving a second identity from report
// content would do exactly what identity must not do: change when copy changes.
// Report history therefore groups on reportId, which is precisely the approved
// rule — one card per report, regardless of engine version, regeneration or
// republish.

// ── Reference keys ────────────────────────────────────────────────────────────

export interface TrendContentRef {
  contentType: TrendContentType;
  /** Stored id, NADINE handle, facet token, section key, or SavedLook id. */
  contentId: string;
  /** Required for TREND / SIGNAL / REFERENCE / TAKEAWAY. */
  reportId?: string | null;
}

/**
 * Where a save came from. Identity and provenance are separate concerns:
 * FACET and PRODUCT ids are global — the same material saved from two reports is
 * ONE object — so the report and trend a customer saved it from lives here, on
 * the SavedItem row, not in the id. "Source: Trend Report · Autumn Edit · Suede
 * Textures" is rendered from this, never parsed back out of a refKey.
 */
export interface TrendContentProvenance {
  sourceReportId: string;
  sourceReportTitle: string;
  sourceSeason: string;
  /** The TREND/SIGNAL/REFERENCE this object was saved from, when applicable. */
  sourceContentId?: string | null;
  sourceContentLabel?: string | null;
  savedAt: string;
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
  minter: ContentIdMinter = mintOpaqueContentId,
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

    result[field] = recoverOrMintIds(report.slug, field, entries, previousEntries, minter).map((entry, index) => {
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

  return {
    keyTrends: result.keyTrends,
    rising: result.rising,
    fading: result.fading,
    referencesBehindThisEdit: result.referencesBehindThisEdit,
    assigned,
    rejectedFacets,
  };
}
