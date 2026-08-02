// scripts/run-dev-tryon.ts
// Phase 4A5 — FASHN provider test matrix runner.
//
// Usage (from project root):
//   node --import tsx/esm scripts/run-dev-tryon.ts <garment-handle>
//
// Runs one garment at a time. Reuses the open cap slot for collar-shirt (no re-claim).
// After a successful run, saves a sanitised inspection PNG to the scratchpad.
//
// Never prints: credentials, signed URLs, customer IDs, private asset IDs,
// raw provider payloads, or data URIs.

try { process.loadEnvFile(".env"); } catch { /* optional base env */ }
try { process.loadEnvFile(".env.local"); } catch { /* optional local overrides */ }

import fs from "node:fs";
import path from "node:path";
import {
  downloadModelPhotoAsDataUrl,
  validateGarmentEligibility,
  uploadTryOnResult,
} from "../app/lib/ai/fashn-tryon-service.server.js";
import { runFashnTryOn } from "../app/lib/ai/fashn-try-on.server.js";
import { POLICY_VERSION } from "../app/lib/ai/virtual-try-on.types.js";
import {
  verifyCloudinaryAsset,
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
} from "../app/lib/cloudinary-admin.server.js";
import {
  getDevCapState,
  claimDevCallSlot,
  updateDevCallEntry,
  getExistingPredictionId,
} from "../app/lib/ai/dev-tryon-cap.server.js";

const SCRATCHPAD =
  "/private/tmp/claude-501/-Users-nadeenabuobead-naia-stylist/ac9a2987-ab11-490d-b61f-a03b0e8d6cdc/scratchpad";

// Deterministic Cloudinary public ID for dev test results.
// Matches the derivation in the harness action.
function devResultPublicId(handle: string): string {
  return `naia-tryon/dev-test/${handle.replace(/\//g, "-")}`;
}

// Scratchpad path for the inspection PNG (no private info in the filename).
function inspectionPath(handle: string): string {
  return path.join(SCRATCHPAD, `tryon-${handle.replace(/\//g, "-")}.png`);
}

type RunOutcome = "completed" | "reused" | "cap-reached" | "error" | "not-ready";

async function runGarment(handle: string): Promise<RunOutcome> {
  const devModelPublicId = process.env.DEV_TEST_MODEL_IMAGE_PUBLIC_ID ?? null;
  const devModelFormat = process.env.DEV_TEST_MODEL_FORMAT ?? "jpg";
  const devModelDeliveryType = process.env.DEV_TEST_MODEL_DELIVERY_TYPE ?? "private";

  if (!devModelPublicId) {
    log("  HOLD — DEV_TEST_MODEL_IMAGE_PUBLIC_ID not set");
    return "error";
  }

  // Validate garment eligibility before touching the cap.
  const garment = validateGarmentEligibility(handle);
  if (!garment.ok) {
    log(`  Not ready: ${garment.code} — ${garment.reason}`);
    return "not-ready";
  }

  // ── Resume path ───────────────────────────────────────────────────────────
  const resumePredictionId = getExistingPredictionId(handle);

  if (resumePredictionId) {
    log("  Resume: existing prediction found — polling without a new slot.");
  } else {
    // ── New submission path ─────────────────────────────────────────────────

    // Idempotency: if result is already stored, return without calling FASHN.
    const existing = await verifyCloudinaryAsset(devResultPublicId(handle), "private");
    if (existing.ok) {
      log("  Reused — result already stored in Cloudinary (no FASHN call).");
      return "reused";
    }

    // Claim slot. Idempotent for open entries: collar-shirt already has a slot
    // from the pre-flight, so this call returns it without incrementing.
    const slot = claimDevCallSlot(handle);
    if (!slot.allowed) {
      const cap = getDevCapState();
      log(`  Cap reached: ${cap.newCalls}/${cap.maxCalls} new submissions used.`);
      return "cap-reached";
    }
    const cap = getDevCapState();
    log(`  Slot: ${cap.newCalls}/${cap.maxCalls} used.`);
  }

  // Download the test model photo (bytes only — data URI never logged).
  log("  Downloading test model photo from Cloudinary…");
  const photo = await downloadModelPhotoAsDataUrl(
    devModelPublicId,
    devModelFormat,
    devModelDeliveryType,
  );
  if (!photo.ok) {
    updateDevCallEntry(handle, { outcome: "failed" });
    log(`  Photo download failed: ${photo.errorCode}`);
    return "error";
  }
  log("  Model photo ready.");

  // Submit to FASHN (or resume polling an existing prediction).
  log("  Calling FASHN… (max 90s polling at 2s interval)");
  const fashnResult = await runFashnTryOn(
    {
      customerId: "dev-test",
      modelImageDataUrl: photo.dataUrl,
      productImageUrl: garment.garmentUrl,
      productHandle: handle,
      consent: {
        virtualTryOnConsent: true,
        policyVersion: POLICY_VERSION,
        consentedAt: new Date().toISOString(),
      },
    },
    resumePredictionId
      ? { existingPredictionId: resumePredictionId }
      : { onPredictionId: (id) => updateDevCallEntry(handle, { predictionId: id }) },
  );

  if (!fashnResult.ok) {
    const outcome = fashnResult.code === "TIMEOUT" ? "timeout" : "failed";
    updateDevCallEntry(handle, { outcome });
    log(`  FASHN error: ${fashnResult.code}`);
    return "error";
  }
  log("  FASHN generation complete (prediction ID suppressed).");

  // Upload result to private Cloudinary storage.
  log("  Uploading result to Cloudinary (private delivery)…");
  const upload = await uploadTryOnResult(
    "dev-test",
    handle.replace(/\//g, "-"),
    fashnResult.outputDataUrl,
  );
  if (!upload.ok) {
    updateDevCallEntry(handle, { outcome: "failed" });
    log(`  Upload failed: ${upload.errorCode}`);
    return "error";
  }
  updateDevCallEntry(handle, { outcome: "completed" });
  log(`  Stored at naia-tryon/dev-test/${handle.replace(/\//g, "-")} (private).`);

  // Download result to scratchpad for visual inspection (URL never printed).
  const cfg = getCloudinaryConfig();
  if (cfg) {
    const resultPid = devResultPublicId(handle);
    const dlUrl = buildPrivateDownloadUrl(cfg, resultPid, "png", "private");
    try {
      const res = await fetch(dlUrl);
      if (res.ok) {
        const bytes = await res.arrayBuffer();
        const outPath = inspectionPath(handle);
        fs.writeFileSync(outPath, Buffer.from(bytes));
        // Write to stdout so caller can capture the path.
        process.stdout.write(`PREVIEW_PATH:${outPath}\n`);
        log("  Inspection PNG saved to scratchpad.");
      } else {
        log(`  Warning: inspection download returned HTTP ${res.status}`);
      }
    } catch (e) {
      log(`  Warning: inspection download error — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return "completed";
}

function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

// ── Entry point ───────────────────────────────────────────────────────────────

const handle = process.argv[2];
if (!handle) {
  process.stderr.write(
    "Usage: node --import tsx/esm scripts/run-dev-tryon.ts <garment-handle>\n",
  );
  process.exit(1);
}

process.stderr.write(`\n=== run-dev-tryon: ${handle} ===\n`);
const capBefore = getDevCapState();
process.stderr.write(`Cap before: ${capBefore.newCalls}/${capBefore.maxCalls} used\n\n`);

const outcome = await runGarment(handle);

process.stderr.write(`\nOutcome: ${outcome}\n`);
const capAfter = getDevCapState();
process.stderr.write(`Cap after: ${capAfter.newCalls}/${capAfter.maxCalls} used\n`);
