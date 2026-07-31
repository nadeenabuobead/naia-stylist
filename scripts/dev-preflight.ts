// scripts/dev-preflight.ts
// Phase 4A5 pre-flight check. Validates all prerequisites immediately before the first FASHN call.
// Does NOT call FASHN or claim a cap slot for any other purpose.
//
// Run from project root:
//   node --import tsx/esm scripts/dev-preflight.ts
//
// Stops just before POST /v1/run. If all steps pass, the collar-shirt slot will be claimed
// in .dev-tryon-cap.json (newCalls = 1) and the harness can proceed without a double-count.

try { process.loadEnvFile(".env"); } catch { /* base env optional */ }
try { process.loadEnvFile(".env.local"); } catch { /* local overrides optional */ }

import { downloadModelPhotoAsDataUrl, validateGarmentEligibility } from "../app/lib/ai/fashn-tryon-service.server.js";
import { isAllowedProductImageUrl } from "../app/lib/ai/fashn-try-on.server.js";
import { claimDevCallSlot, getDevCapState } from "../app/lib/ai/dev-tryon-cap.server.js";

const PREFLIGHT_GARMENT = "collar-shirt";

const ENV_VARS = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "DEV_TEST_MODEL_IMAGE_PUBLIC_ID",
  "DEV_TEST_MODEL_FORMAT",
  "FASHN_API_KEY",
] as const;

type Line = { label: string; status: "OK" | "FAIL" | "WARN"; detail?: string };

function report(lines: Line[]): void {
  const pad = Math.max(...lines.map((l) => l.label.length)) + 2;
  for (const { label, status, detail } of lines) {
    const icon = status === "OK" ? "✓" : status === "WARN" ? "⚠" : "✗";
    const row = `  ${icon}  ${(label + ":").padEnd(pad)}${status}${detail ? `  (${detail})` : ""}`;
    process.stderr.write(row + "\n");
  }
}

async function main(): Promise<void> {
  process.stderr.write("\n=== Phase 4A5 pre-flight ===\n\n");

  // ── Step 0: Env var presence ────────────────────────────────────────────────
  process.stderr.write("Env vars\n");
  const envLines: Line[] = ENV_VARS.map((v) => ({
    label: v,
    status: process.env[v] ? "OK" : "FAIL",
    detail: process.env[v] ? "PRESENT" : "MISSING",
  }));
  report(envLines);
  process.stderr.write("\n");

  const missingRequired = envLines.filter(
    (l) => l.status === "FAIL" && l.label !== "FASHN_API_KEY",
  );
  if (missingRequired.length > 0) {
    const names = missingRequired.map((l) => l.label).join(", ");
    process.stderr.write(`HOLD — missing required env vars before model download: ${names}\n`);
    process.exit(1);
  }
  if (!process.env.FASHN_API_KEY) {
    process.stderr.write(
      "  Note: FASHN_API_KEY missing — the actual FASHN call cannot proceed,\n" +
      "  but steps 1-4 can still be validated.\n\n",
    );
  }

  const devModelPublicId = process.env.DEV_TEST_MODEL_IMAGE_PUBLIC_ID!;
  const devModelFormat = process.env.DEV_TEST_MODEL_FORMAT ?? "jpg";
  const devModelDeliveryType = process.env.DEV_TEST_MODEL_DELIVERY_TYPE ?? "private";

  // ── Step 1: Download test model ─────────────────────────────────────────────
  process.stderr.write("Step 1 — Download test model from Cloudinary\n");
  const photoResult = await downloadModelPhotoAsDataUrl(
    devModelPublicId,
    devModelFormat,
    devModelDeliveryType,
  );
  const step1Lines: Line[] = [
    {
      label: `delivery type "${devModelDeliveryType}"`,
      status: photoResult.ok ? "OK" : "FAIL",
      detail: photoResult.ok
        ? "download succeeded"
        : `errorCode=${(photoResult as { errorCode: string }).errorCode}`,
    },
    {
      label: "data URL format",
      status: photoResult.ok
        ? (photoResult.dataUrl.startsWith("data:image/") ? "OK" : "FAIL")
        : "FAIL",
      detail: photoResult.ok
        ? `data:image/${devModelFormat === "jpg" || devModelFormat === "jpeg" ? "jpeg" : devModelFormat}…`
        : "n/a",
    },
  ];
  report(step1Lines);
  process.stderr.write("\n");

  if (!photoResult.ok) {
    process.stderr.write("HOLD — model download failed; cannot proceed to FASHN\n");
    process.exit(1);
  }

  // ── Step 2: Validate garment ────────────────────────────────────────────────
  process.stderr.write(`Step 2 — Validate garment (${PREFLIGHT_GARMENT})\n`);
  const garment = validateGarmentEligibility(PREFLIGHT_GARMENT);
  const urlValid = garment.ok && isAllowedProductImageUrl(garment.garmentUrl);
  const step2Lines: Line[] = [
    {
      label: "eligibility",
      status: garment.ok ? "OK" : "FAIL",
      detail: garment.ok
        ? `ready, category=${garment.garmentCategory}`
        : `${garment.code}: ${garment.reason}`,
    },
    {
      label: "garment URL",
      status: urlValid ? "OK" : "FAIL",
      detail: urlValid
        ? "HTTPS, passes isAllowedProductImageUrl"
        : garment.ok
          ? "failed URL validation"
          : "n/a (eligibility failed)",
    },
  ];
  report(step2Lines);
  process.stderr.write("\n");

  if (!garment.ok || !urlValid) {
    process.stderr.write(`HOLD — garment validation failed for ${PREFLIGHT_GARMENT}\n`);
    process.exit(1);
  }

  // ── Step 3: Claim call slot ─────────────────────────────────────────────────
  process.stderr.write(`Step 3 — Claim call slot for ${PREFLIGHT_GARMENT}\n`);
  const capBefore = getDevCapState();
  const slot = claimDevCallSlot(PREFLIGHT_GARMENT);
  const capAfter = getDevCapState();
  const step3Lines: Line[] = [
    {
      label: "cap before",
      status: "OK",
      detail: `${capBefore.newCalls}/${capBefore.maxCalls} used`,
    },
    {
      label: "slot claim",
      status: slot.allowed ? "OK" : "FAIL",
      detail: slot.allowed
        ? `allowed, entryIndex=${slot.entryIndex}`
        : "cap exhausted",
    },
    {
      label: "cap after",
      status: "OK",
      detail: `${capAfter.newCalls}/${capAfter.maxCalls} used`,
    },
  ];
  report(step3Lines);
  process.stderr.write("\n");

  if (!slot.allowed) {
    process.stderr.write("HOLD — cap exhausted, no slot available\n");
    process.exit(1);
  }

  // ── Step 4: Delivery type confirmation ──────────────────────────────────────
  process.stderr.write("Step 4 — Delivery type\n");
  report([
    {
      label: `delivery type "${devModelDeliveryType}"`,
      status: "OK",
      detail: "confirmed by successful download in step 1",
    },
  ]);
  process.stderr.write("\n");

  // ── Summary ─────────────────────────────────────────────────────────────────
  process.stderr.write("=== Pre-flight: ALL CHECKS PASSED ===\n");
  process.stderr.write(`Slot ${capAfter.newCalls}/${capAfter.maxCalls} claimed for ${PREFLIGHT_GARMENT}.\n`);
  if (!process.env.FASHN_API_KEY) {
    process.stderr.write("\nBLOCKER: FASHN_API_KEY is missing from .env.local.\n");
    process.stderr.write("Add it to .env.local, then restart the dev server before calling FASHN.\n");
    process.exit(2);
  }
  process.stderr.write("FASHN_API_KEY is present. Ready for the first FASHN call.\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
