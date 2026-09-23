// app/lib/saved-items-resolve.server.ts
//
// Loads the report, then delegates every rule to the pure resolver.

import { getEditorialReportBySlug } from "./editorial-reports.server";
import {
  resolveSaveTargetFromReport,
  type SaveTargetRef,
  type ResolveResult,
} from "./saved-items-resolve";

export type { SaveTargetRef, ResolveResult } from "./saved-items-resolve";

export async function resolveSaveTarget(
  ref: SaveTargetRef,
  options: { takeawayText?: string | null } = {},
): Promise<ResolveResult> {
  const report = ref.reportSlug ? await getEditorialReportBySlug(ref.reportSlug) : null;
  return resolveSaveTargetFromReport(ref, report, options);
}
