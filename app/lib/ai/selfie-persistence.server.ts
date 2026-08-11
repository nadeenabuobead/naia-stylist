// app/lib/ai/selfie-persistence.server.ts
// Phase 4A8 — Injectable DB operations for SelfieAnalysis persistence.
//
// Security contract:
//   - photoPublicId is stored but never returned to the browser by any function here
//   - analysisResult stores only validated SelfieStyleSignals — no raw provider output
//   - Deletion is Cloudinary-first: asset gone before DB reference clears
//   - Duplicate-analysis guard: beginSelfieAnalysis returns { blocked: true } when
//     analysisStatus is "pending" (unless forceReplace is set)
//
// All DB operations accept injectable stubs so tests run without a live database.
// Migration: prisma/migrations/20260717100000_add_selfie_analysis/migration.sql
//            NOT yet applied — do not call real Prisma fns until migration runs.

import prisma from "../../db.server.js";
import type { SelfieStyleSignals } from "./selfie-analysis.js";
import {
  deleteCloudinaryAsset,
  type DeleteAssetFn,
} from "../cloudinary-admin.server.js";

// ── DB record type ─────────────────────────────────────────────────────────────
//
// Mirrors the SelfieAnalysis Prisma model fields.
// Defined manually because the generated Prisma types are unavailable before migration.

export interface DbSelfieRecord {
  id: string;
  customerId: string;
  consentAt: Date;
  photoPublicId: string | null;
  photoFormat: string | null;
  photoDeletedAt: Date | null;
  analysisStatus: string;
  analysisResult: unknown;       // SelfieStyleSignals | null (stored as JSONB)
  analysedAt: Date | null;
  analysisDeletedAt: Date | null; // set when customer explicitly deletes the analysis result
  analysisVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── Injectable function types ─────────────────────────────────────────────────

export type FindSelfieRecordFn = (customerId: string) => Promise<DbSelfieRecord | null>;

export type UpsertSelfieRecordFn = (
  customerId: string,
  data: Partial<Omit<DbSelfieRecord, "id" | "customerId" | "createdAt">>,
) => Promise<DbSelfieRecord>;

// ── Real Prisma implementations ───────────────────────────────────────────────
// These functions require the SelfieAnalysis migration to be applied.

async function _findSelfieRecord(customerId: string): Promise<DbSelfieRecord | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).selfieAnalysis.findUnique({ where: { customerId } }) as Promise<DbSelfieRecord | null>;
}

async function _upsertSelfieRecord(
  customerId: string,
  data: Partial<Omit<DbSelfieRecord, "id" | "customerId" | "createdAt">>,
): Promise<DbSelfieRecord> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).selfieAnalysis.upsert({
    where: { customerId },
    create: { customerId, updatedAt: new Date(), ...data },
    update: { updatedAt: new Date(), ...data },
  }) as Promise<DbSelfieRecord>;
}

// ── beginSelfieAnalysis ───────────────────────────────────────────────────────
//
// Sets analysisStatus to "pending" and stores the consent timestamp.
// Blocks a new analysis when status is already "pending" to prevent duplicate
// simultaneous provider calls (race-window guard).
// forceReplace bypasses the pending guard (used by the replace-and-rerun flow).

export type BeginSelfieResult =
  | { blocked: true }
  | { blocked: false; record: DbSelfieRecord };

export async function beginSelfieAnalysis(
  customerId: string,
  consentAt: Date,
  photoPublicId: string | null,
  photoFormat: string | null,
  options?: { forceReplace?: boolean },
  _findFn: FindSelfieRecordFn = _findSelfieRecord,
  _upsertFn: UpsertSelfieRecordFn = _upsertSelfieRecord,
): Promise<BeginSelfieResult> {
  const existing = await _findFn(customerId);

  if (existing?.analysisStatus === "pending" && !options?.forceReplace) {
    return { blocked: true };
  }

  const record = await _upsertFn(customerId, {
    consentAt,
    photoPublicId,
    photoFormat,
    analysisStatus: "pending",
    analysisResult: null,
    analysedAt: null,
    updatedAt: new Date(),
  });

  return { blocked: false, record };
}

// ── completeSelfieAnalysis ────────────────────────────────────────────────────
//
// Stores only the validated SelfieStyleSignals — never raw provider output.
// Clears analysisDeletedAt so a re-analysis after a delete-analysis is reflected correctly.
// Returns the updated record.

export async function completeSelfieAnalysis(
  customerId: string,
  signals: SelfieStyleSignals,
  analysisVersion: number,
  analysedAt: Date = new Date(),
  _upsertFn: UpsertSelfieRecordFn = _upsertSelfieRecord,
): Promise<DbSelfieRecord> {
  return _upsertFn(customerId, {
    analysisStatus: "completed",
    analysisResult: signals as unknown,
    analysedAt,
    analysisDeletedAt: null,  // clear any prior deletion timestamp on successful analysis
    analysisVersion,
    updatedAt: new Date(),
  });
}

// ── failSelfieAnalysis ────────────────────────────────────────────────────────
//
// Sets status to "failed". Does not clear the photo reference — the photo may still
// be used for a retry. analysisResult is cleared so no stale signals persist.

export async function failSelfieAnalysis(
  customerId: string,
  _upsertFn: UpsertSelfieRecordFn = _upsertSelfieRecord,
): Promise<DbSelfieRecord> {
  return _upsertFn(customerId, {
    analysisStatus: "failed",
    analysisResult: null,
    analysedAt: null,
    updatedAt: new Date(),
  });
}

// ── deleteSelfiePhoto ─────────────────────────────────────────────────────────
//
// Deletion order (privacy-first): Cloudinary asset deleted before DB reference cleared.
// If Cloudinary deletion fails, the DB reference is preserved so deletion can be retried.
// deleteCloudinaryAsset already treats "not found" as ok — so "already absent" is handled
// by the Cloudinary layer and is transparent here.
// analysisResult is preserved (kept for display; no photo needed to show signals).

export type DeletePhotoResult =
  | { ok: true }
  | { ok: false; errorCode: string };

export async function deleteSelfiePhoto(
  customerId: string,
  _deleteAssetFn: DeleteAssetFn = deleteCloudinaryAsset,
  _findFn: FindSelfieRecordFn = _findSelfieRecord,
  _upsertFn: UpsertSelfieRecordFn = _upsertSelfieRecord,
): Promise<DeletePhotoResult> {
  const existing = await _findFn(customerId);
  if (!existing) return { ok: false, errorCode: "NOT_FOUND" };

  // Delete Cloudinary asset if we have a reference.
  // Only clear the DB reference after Cloudinary confirms deletion.
  if (existing.photoPublicId) {
    const del = await _deleteAssetFn(existing.photoPublicId, "private");
    if (!del.ok) {
      // Preserve photoPublicId so the deletion can be retried
      return { ok: false, errorCode: "DELETION_FAILED" };
    }
  }

  await _upsertFn(customerId, {
    photoPublicId: null,
    photoFormat: null,
    photoDeletedAt: new Date(),
    updatedAt: new Date(),
  });

  return { ok: true };
}

// ── deleteAnalysisResult ──────────────────────────────────────────────────────
//
// Clears analysisResult and sets status to "deleted".
// Sets analysisDeletedAt to track when the customer removed the result.
// Photo reference is preserved — the photo can be used to re-run analysis.
// No Cloudinary call: the photo asset is not touched.

export async function deleteAnalysisResult(
  customerId: string,
  _findFn: FindSelfieRecordFn = _findSelfieRecord,
  _upsertFn: UpsertSelfieRecordFn = _upsertSelfieRecord,
): Promise<{ ok: boolean; errorCode?: string }> {
  const existing = await _findFn(customerId);
  if (!existing) return { ok: false, errorCode: "NOT_FOUND" };

  await _upsertFn(customerId, {
    analysisStatus: "deleted",
    analysisResult: null,
    analysedAt: null,
    analysisDeletedAt: new Date(),
    updatedAt: new Date(),
  });

  return { ok: true };
}

// ── deleteBoth ────────────────────────────────────────────────────────────────
//
// Deletes Cloudinary asset and clears all analysis fields.
// Uses the same Cloudinary-first ordering as deleteSelfiePhoto.
// If Cloudinary deletion fails, the DB is left unchanged so deletion can be retried.

export async function deleteBoth(
  customerId: string,
  _deleteAssetFn: DeleteAssetFn = deleteCloudinaryAsset,
  _findFn: FindSelfieRecordFn = _findSelfieRecord,
  _upsertFn: UpsertSelfieRecordFn = _upsertSelfieRecord,
): Promise<DeletePhotoResult> {
  const existing = await _findFn(customerId);
  if (!existing) return { ok: false, errorCode: "NOT_FOUND" };

  if (existing.photoPublicId) {
    const del = await _deleteAssetFn(existing.photoPublicId, "private");
    if (!del.ok) {
      return { ok: false, errorCode: "DELETION_FAILED" };
    }
  }

  await _upsertFn(customerId, {
    photoPublicId: null,
    photoFormat: null,
    photoDeletedAt: new Date(),
    analysisStatus: "deleted",
    analysisResult: null,
    analysedAt: null,
    analysisDeletedAt: new Date(),
    updatedAt: new Date(),
  });

  return { ok: true };
}

// ── getSelfieForModeration ────────────────────────────────────────────────────
//
// Returns the stored photo credentials for server-side re-moderation.
// Only called from the retry-moderation action intent — never serialised to browser.

export interface SelfieModerationCredentials {
  publicId: string;
  format: string;
  consentAt: string;
  analysisStatus: string;
}

export async function getSelfieForModeration(
  customerId: string,
  _findFn: FindSelfieRecordFn = _findSelfieRecord,
): Promise<SelfieModerationCredentials | null> {
  const record = await _findFn(customerId);
  if (!record || !record.photoPublicId || !record.photoFormat || record.photoDeletedAt !== null) return null;
  return {
    publicId: record.photoPublicId,
    format: record.photoFormat,
    consentAt: record.consentAt.toISOString(),
    analysisStatus: record.analysisStatus,
  };
}

// ── loadSelfieForDisplay ──────────────────────────────────────────────────────
//
// Returns a public-safe view of the record — no photoPublicId or photoFormat.
// Callers must use this function when building loader data for the browser.

export interface SelfieDisplayRecord {
  hasPhoto: boolean;
  analysisStatus: string | null;
  signals: SelfieStyleSignals | null;
  analysedAt: string | null;
  consentAt: string | null;
}

export async function loadSelfieForDisplay(
  customerId: string,
  _findFn: FindSelfieRecordFn = _findSelfieRecord,
): Promise<SelfieDisplayRecord | null> {
  const record = await _findFn(customerId);
  if (!record) return null;

  return {
    hasPhoto: record.photoPublicId !== null && record.photoDeletedAt === null,
    analysisStatus: record.analysisStatus,
    signals: (record.analysisResult ?? null) as SelfieStyleSignals | null,
    analysedAt: record.analysedAt ? record.analysedAt.toISOString() : null,
    consentAt: record.consentAt.toISOString(),
  };
}
