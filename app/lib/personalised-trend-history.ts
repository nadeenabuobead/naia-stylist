// app/lib/personalised-trend-history.ts
//
// PERSONALISED TREND EDIT HISTORY — the pure half.
//
// Two separate concepts, deliberately not conflated:
//
//   PersonalisedTrendEdit        an immutable snapshot of what nAia SHOWED her
//   PersonalisedTrendEditUnlock  the entitlement event: she received this report
//
// A snapshot is history. An unlock is allowance. Many snapshots may exist for one
// unlock — an engine change or a Passport edit produces a new snapshot and costs
// nothing.
//
// This module holds the rules that decide snapshot identity, what is safe to
// persist, and how history collapses into one card per report. No DB, no I/O.

import { createHash } from "node:crypto";
import type { ShopperEdit } from "./trend-evidence.server";

/**
 * Bump when buildShopperEdit's OUTPUT rules change in a way that should produce
 * a new historical snapshot. Kept here rather than in trend-evidence.server.ts so
 * the edit engine itself stays untouched by the history layer.
 */
export const PERSONALISED_EDIT_ENGINE_VERSION = "1.0.0";

// ── What is safe to persist ───────────────────────────────────────────────────

/**
 * Strip everything that must not enter a stored snapshot.
 *
 * Closet thumbnails are signed Cloudinary URLs carrying `timestamp` and
 * `expires_at`, so they differ on EVERY request and die after ten minutes.
 * Persisting one would store a dead credential; hashing one would mint a fresh
 * snapshot row on every refresh — precisely the duplicate history this design
 * forbids.
 *
 * What survives is the stable ASSET reference — closetItemId plus the Cloudinary
 * public id and format — and the labels she read. Those are identifiers, not
 * credentials: signing requires the API secret, which never leaves the server.
 *
 * Pinning the public id is what makes replay historically faithful. Replacing a
 * photo mints a new public id and hard-deletes the old asset, so re-resolving
 * from the closet row would show TODAY's photo under a September edit. Storing
 * the asset she actually saw means the image either comes back as it was, or
 * not at all.
 */
export function sanitiseEditForSnapshot(edit: ShopperEdit): ShopperEdit {
  // Step 5 closet connections carry signed URLs too — same expiry, same churn,
  // same rule. The pinned asset reference survives; the URL does not.
  const withConnections = edit as ShopperEdit & {
    closetConnections?: Array<{ pieces: Array<Record<string, unknown>> }>;
  };
  const closetConnections = withConnections.closetConnections?.map((c) => ({
    ...c,
    pieces: c.pieces.map((piece) => ({ ...piece, imageUrl: null })),
  }));

  return {
    ...edit,
    ...(closetConnections ? { closetConnections } : {}),
    evidenceClosetItems: (edit.evidenceClosetItems ?? []).map((item) => ({
      closetItemId: item.closetItemId,
      imagePublicId: item.imagePublicId,
      imageFormat: item.imageFormat,
      name: item.name,
      category: item.category,
      roleNote: item.roleNote,
      imageUrl: null,
    })),
  };
}

/** Counts only — never closet records, garment analysis, or profile data. */
export interface EditEvidenceSummary {
  closetItemsNamed: number;
  hasStyleDnaEvidence: boolean;
  hasPassportEvidence: boolean;
  hasReviewEvidence: boolean;
}

export function summariseEditEvidence(edit: ShopperEdit): EditEvidenceSummary {
  return {
    closetItemsNamed: edit.evidenceClosetItems?.length ?? 0,
    hasStyleDnaEvidence: edit.evidenceStyleDna != null,
    hasPassportEvidence: edit.evidencePassportSays != null,
    hasReviewEvidence: edit.evidenceReviews != null,
  };
}

// ── Snapshot identity ─────────────────────────────────────────────────────────

/**
 * Stable JSON: object keys sorted recursively, array ORDER preserved because
 * order is meaningful in an edit (bullet one is not bullet two). Two structurally
 * equal payloads always serialise identically regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * The stable, user-visible payload a snapshot is fingerprinted over.
 *
 * It covers the personalised body AND the report metadata shown alongside it:
 * the same advice presented under a changed title or season is not the same
 * historical presentation, and history should record both.
 *
 * Excluded: generatedAt / createdAt, row ids, request ids, the evidence summary,
 * and signed image URLs — none of which change what she read, and each of which
 * would manufacture versions out of nothing.
 */
export interface SnapshotFingerprintInput {
  engineVersion: string;
  reportId: string;
  reportSlug: string;
  reportTitle: string;
  reportSeason: string;
  edit: ShopperEdit;
}

export function buildFingerprintPayload(input: SnapshotFingerprintInput): Record<string, unknown> {
  return {
    engineVersion: input.engineVersion,
    reportId: input.reportId,
    reportSlug: input.reportSlug,
    reportTitle: input.reportTitle,
    reportSeason: input.reportSeason,
    edit: sanitiseEditForSnapshot(input.edit),
  };
}

/**
 * SHA-256 over the canonical payload. Standard, collision-resistant, and no
 * bespoke hashing logic to maintain — not a security boundary, just a content
 * fingerprint that decides whether a render is a new historical version.
 */
export function computeSnapshotHash(input: SnapshotFingerprintInput): string {
  return createHash("sha256")
    .update(canonicalJson(buildFingerprintPayload(input)), "utf8")
    .digest("hex");
}

// ── Customer-facing history ───────────────────────────────────────────────────

export interface SnapshotRecord {
  id: string;
  reportId: string;
  reportSlug: string;
  reportTitle: string;
  reportSeason: string;
  engineVersion: string;
  snapshotHash: string;
  createdAt: string;
}

export interface HistoryCard {
  /** The snapshot that opens when this card is clicked — the latest for its report. */
  snapshotId: string;
  reportId: string;
  reportSlug: string;
  reportTitle: string;
  reportSeason: string;
  /** When this customer's edit was generated. */
  receivedAt: string;
  /** Internal versions behind this card. Never surfaced as separate cards. */
  versionCount: number;
}

/**
 * Collapse an internal version log into the customer-facing Previously list:
 * ONE card per canonical report, resolving to that report's latest snapshot.
 *
 * Three engine changes must read as "Autumn Edit", not "Autumn Edit v1, v2, v3".
 * `receivedAt` is the FIRST snapshot's time — when she actually received this
 * edit — while the card opens the latest, which is the most accurate stored copy.
 */
export function buildHistoryCards(snapshots: SnapshotRecord[]): HistoryCard[] {
  const byReport = new Map<string, SnapshotRecord[]>();
  for (const snap of snapshots) {
    const group = byReport.get(snap.reportId) ?? [];
    group.push(snap);
    byReport.set(snap.reportId, group);
  }

  const cards: HistoryCard[] = [];
  for (const [reportId, group] of byReport) {
    const ordered = [...group].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    cards.push({
      snapshotId: latest.id,
      reportId,
      reportSlug: latest.reportSlug,
      reportTitle: latest.reportTitle,
      reportSeason: latest.reportSeason,
      receivedAt: first.createdAt,
      versionCount: ordered.length,
    });
  }

  // Most recently received first.
  return cards.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}
