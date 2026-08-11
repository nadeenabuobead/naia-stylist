// app/lib/ai/selfie-analysis.ts
// Phase 4A8 — Personal Styling Photo Analysis types.
// Side-effect-free: no imports, no DB queries, no Claude calls.

// ── Photo quality ─────────────────────────────────────────────────────────────

export type SelfiePhotoIssue =
  | "blurry"
  | "obstructed"
  | "multiple-faces"
  | "strong-filter"
  | "not-a-selfie"
  | "back-facing"
  | "quality-assessment-failed";

export interface SelfiePhotoQualityResult {
  pass: boolean;
  issues: SelfiePhotoIssue[];
  guidance: string | null;
}

// ── Style signals ─────────────────────────────────────────────────────────────
//
// All fields are hedged styling directions derived from photo analysis.
// None constitute medical, diagnostic, or definitive personal assessment.
// Must be applied as SOFT_RANK / EXPLANATION_ONLY — never HARD_FILTER.

export interface SelfieStyleSignals {
  faceShapeDirection: string;
  suggestedNecklines: string[];
  necklineExplanation: string;
  colourFamilies: string[];
  colourExplanation: string;
  contrastLevel: "low" | "medium" | "high";
  hairLengthDirection: string;
  hairVolumeDirection: string;
  hairPartingDirection: string;
  earringsDirection: string;
  glassesFrameDirection: string;
  makeupColourDirection: string | null;
  overallNote: string;
}

// ── Analysis outcomes ─────────────────────────────────────────────────────────

export type SelfieAnalysisOutcome =
  | { status: "completed"; signals: SelfieStyleSignals; analysedAt: string }
  | { status: "quality-failed"; issues: SelfiePhotoIssue[]; guidance: string | null }
  | { status: "timeout" }
  | { status: "system-failure"; internalNote: string }
  | { status: "consent-missing" }
  | { status: "invalid-input"; reason: string }
  | { status: "safety-rejected" }
  | { status: "moderation-unavailable" };

// ── Persistence record ────────────────────────────────────────────────────────
//
// Proposed minimum data contract for DB persistence (migration NOT yet applied).
// These fields map to: new SelfieAnalysis model linked @unique to Customer.
//
//   model SelfieAnalysis {
//     id               String    @id @default(cuid())
//     customerId       String    @unique
//     customer         Customer  @relation(...)
//     consentAt        DateTime
//     photoPublicId    String?
//     photoDeletedAt   DateTime?
//     analysisStatus   String              // pending | completed | failed | deleted
//     analysisResult   Json?               // SelfieStyleSignals
//     analysedAt       DateTime?
//     analysisVersion  Int       @default(1)
//     createdAt        DateTime  @default(now())
//     updatedAt        DateTime  @updatedAt
//   }

export type SelfieAnalysisStatus =
  | "pending"
  | "completed"
  | "failed"
  | "deleted";

// Deletion intent discriminator used by the /passport/selfie action
export type SelfieDeleteMode =
  | "photo-only"       // delete Cloudinary asset; keep analysis signals
  | "analysis-only"    // clear signals; keep photo for re-analysis
  | "both";            // delete photo and clear all signals

export interface SelfieAnalysisRecord {
  consentAt: string;
  photoPublicId: string | null;
  photoDeletedAt: string | null;
  analysisStatus: SelfieAnalysisStatus;
  analysisResult: SelfieStyleSignals | null;
  analysedAt: string | null;
  analysisDeletedAt: string | null;
  analysisVersion: number;
}
