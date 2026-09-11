// nAia Admin — StyleMe QA review utilities.
// StylingSessionAdminReview stores the admin's QA decision for a complete
// StyleMe session (TODAY inputs + Passport + Closet + anchor + outfit + outcome).

export const STYLEME_QA_STATUSES = ["unreviewed", "pass", "questionable", "fail"] as const;
export type StyleMeQaStatus = (typeof STYLEME_QA_STATUSES)[number];

export function isValidQaStatus(value: unknown): value is StyleMeQaStatus {
  return STYLEME_QA_STATUSES.includes(value as StyleMeQaStatus);
}

export function validateQaStatus(value: unknown): StyleMeQaStatus {
  if (!isValidQaStatus(value)) {
    throw new Error(
      `Invalid QA status: ${JSON.stringify(value)}. Must be one of: ${STYLEME_QA_STATUSES.join(", ")}`
    );
  }
  return value;
}
