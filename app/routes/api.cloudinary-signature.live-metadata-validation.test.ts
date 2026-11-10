// app/routes/api.cloudinary-signature.live-metadata-validation.test.ts
//
// Validation harness for the fl_force_strip fix, in two clearly separated parts:
//
// 1. DRY-RUN (always runs, no network, no credentials) — exercises the actual
//    locally modified loader() from api.cloudinary-signature.jsx with
//    getCurrentNaiaCustomer MOCKED, and sanity-checks the synthetic GPS/EXIF
//    fixture itself. This is "mocked authorization" — the customer identity
//    is fake and injected, nothing real is checked.
//
// 2. LIVE (skipped unless CLOUDINARY_METADATA_STRIP_LIVE=1 is set) — performs
//    exactly one real upload to the real Cloudinary account using whatever
//    real credentials already exist in process.env at the time this process
//    is started. This file never reads, pulls, prints, or otherwise handles
//    those credentials itself — it only references process.env.CLOUDINARY_*
//    the same way every other production file in this codebase already does.
//    Populating those env vars (by whatever means the operator chooses,
//    outside this file and outside any tool acting on their behalf) is the
//    one remaining manual step before this block can run. This is "live
//    authorization testing" — getCurrentNaiaCustomer is still mocked (no
//    real customer/session needed to test the signing route), but the
//    Cloudinary call itself is real.
//
// Run (dry-run only, safe always):
//   npx vitest run app/routes/api.cloudinary-signature.live-metadata-validation.test.ts
//
// Run (including the one live upload — only after explicit approval):
//   CLOUDINARY_METADATA_STRIP_LIVE=1 npx vitest run app/routes/api.cloudinary-signature.live-metadata-validation.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  buildSyntheticGpsJpeg,
  scanForExifGpsTags,
} from "../lib/testing/synthetic-exif-fixture";
import { detectMimeFromBytes, extractImageDimensions } from "../lib/ai/selfie-upload.server";
import { checkPresence, checkPlaceholderContamination, checkEnvDrift } from "../lib/testing/live-env-guard";

vi.mock("../lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("../lib/cloudinary-admin.server", () => ({
  buildModelUploadUrl: vi.fn(() => "https://api.cloudinary.com/v1_1/test/image/private/upload"),
  getCloudinaryConfig: vi.fn(),
  buildPrivateDownloadUrl: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { loader } from "./api.cloudinary-signature.jsx";

const SYNTHETIC_CUSTOMER_ID = "_validation-test-customer";

// ── Fix for env-var contamination between DRY-RUN and LIVE ───────────────────
//
// Root cause (found by inspection, not assumption): the DRY-RUN describe
// below ("the actual modified signing route") used to set
// process.env.CLOUDINARY_* directly in a beforeEach, with no afterEach ever
// restoring the originals. Vitest runs every describe/it in this file, in
// file order, inside ONE process — raw `process.env.X = ...` mutation is a
// real, persistent side effect on a shared global object; Vitest does not
// snapshot or restore it automatically. So whatever the dry-run's beforeEach
// last set stayed in process.env for the rest of the file, including the
// LIVE describe declared further down — which is exactly how a real,
// correctly-injected cloud name/preset got silently replaced by
// "test-cloud"/"test-preset" before the LIVE test ever read process.env.
//
// Fix, two layers:
//   1. Capture whatever is in process.env.CLOUDINARY_* RIGHT HERE, at module
//      load — before any describe/beforeEach in this file (or conceivably
//      any other file sharing this process) has had a chance to run. LIVE
//      reads ONLY this frozen snapshot, never process.env directly, so it is
//      structurally immune to any later mutation, however it happens.
//   2. The dry-run's own env mutation is switched to vi.stubEnv(), which
//      Vitest tracks, paired with an explicit afterEach(vi.unstubAllEnvs())
//      — so even process.env itself is restored immediately after each
//      dry-run test, as defense in depth.
const REAL_ENV_SNAPSHOT_AT_LOAD = Object.freeze({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
  uploadPreset: process.env.CLOUDINARY_WARDROBE_UPLOAD_PRESET,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DRY-RUN — fixture sanity check (no network, no credentials)", () => {
  it("the synthetic JPEG really contains the embedded GPS/EXIF tags before upload", () => {
    const fixture = buildSyntheticGpsJpeg();
    const scan = scanForExifGpsTags(fixture);
    expect(scan.hasExifApp1).toBe(true);
    expect(scan.hasGpsIfd).toBe(true);
    expect(scan.gpsTagsFound).toEqual(
      expect.arrayContaining(["GPSLatitudeRef", "GPSLatitude", "GPSLongitudeRef", "GPSLongitude"]),
    );
  });

  it("the fixture decodes as a valid JPEG with sane dimensions", () => {
    const fixture = buildSyntheticGpsJpeg();
    expect(detectMimeFromBytes(fixture)).toBe("image/jpeg");
    const dims = extractImageDimensions(fixture);
    expect(dims).toEqual({ width: 300, height: 300 });
  });
});

describe("DRY-RUN — the actual modified signing route, with authorization MOCKED", () => {
  // vi.stubEnv is tracked by Vitest and explicitly unwound in afterEach via
  // vi.unstubAllEnvs() — unlike raw `process.env.X = ...` assignment, this
  // cannot leak into any later test (in this file or, since it's scoped to
  // this process's Vitest instance, any other file in the same run).
  beforeEach(() => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "test-cloud");
    vi.stubEnv("CLOUDINARY_API_KEY", "test-key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "test-secret");
    vi.stubEnv("CLOUDINARY_WARDROBE_UPLOAD_PRESET", "test-preset");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a correctly-signed response including transformation=fl_force_strip, for a mocked synthetic customer", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: SYNTHETIC_CUSTOMER_ID });
    const res = await loader({ request: new Request("http://localhost/api/cloudinary-signature") } as any);
    const body = await res.json();

    expect(body.transformation).toBe("fl_force_strip");
    expect(body.assetFolder).toBe(`naia-wardrobe/${SYNTHETIC_CUSTOMER_ID}`);

    const expectedParams = [
      `allowed_formats=${body.allowedFormats}`,
      `folder=${body.assetFolder}`,
      `timestamp=${body.timestamp}`,
      `transformation=${body.transformation}`,
      `type=${body.deliveryType}`,
      `upload_preset=${body.uploadPreset}`,
    ].join("&");
    const expectedSig = crypto.createHash("sha1").update(expectedParams + "test-secret").digest("hex");
    expect(body.signature).toBe(expectedSig);
  });
});

// ── LIVE — real Cloudinary call, opt-in only ──────────────────────────────────
//
// Skipped by default. The operator sets CLOUDINARY_METADATA_STRIP_LIVE=1 and
// ensures CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET /
// CLOUDINARY_WARDROBE_UPLOAD_PRESET are already present in their own shell
// environment (by whatever means they choose) before invoking vitest. This
// file reads process.env the same way production code already does; it never
// fetches, writes, or prints those values.
const LIVE = process.env.CLOUDINARY_METADATA_STRIP_LIVE === "1";

describe.skipIf(!LIVE)("LIVE — one real synthetic upload, strip verification, and cleanup", () => {
  it("uploads a synthetic GPS/EXIF image, confirms stripping, and deletes the asset even on failure", async () => {
    // Default is NOT_RUN, not FAIL — a check that never got a chance to
    // execute (because an earlier step rejected) must not read as a failure
    // of that specific check. PREFLIGHT_FAILED and ABORTED_LOCAL are both
    // distinct from generic FAIL: PREFLIGHT_FAILED means a real network
    // preflight request was made and Cloudinary rejected it; ABORTED_LOCAL
    // means the test refused to make ANY network request at all because a
    // local, credential-free check already proved the environment was
    // wrong or contaminated.
    type CheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "NOT_APPLICABLE" | "PREFLIGHT_FAILED" | "ABORTED_LOCAL";
    const report: {
      presetPreflight: CheckStatus;
      signedUploadAccepted: CheckStatus;
      gpsExifStripped: CheckStatus;
      privateTypePreserved: CheckStatus;
      dimensionsFormat: CheckStatus;
      cleanupVerified: CheckStatus;
      notes: string[];
    } = {
      presetPreflight: "NOT_RUN",
      signedUploadAccepted: "NOT_RUN",
      gpsExifStripped: "NOT_RUN",
      privateTypePreserved: "NOT_RUN",
      dimensionsFormat: "NOT_RUN",
      cleanupVerified: "NOT_RUN",
      notes: [],
    };
    let publicId: string | null = null;
    let assetId: string | null = null;
    let format = "jpg";

    const printReportAndAbort = (): never => {
      console.log("\n=== METADATA-STRIP VALIDATION REPORT ===");
      console.log("0. Preset/credential preflight:     ", report.presetPreflight);
      console.log("1. Signed upload accepted:         ", report.signedUploadAccepted);
      console.log("2. Original GPS/EXIF stripping:     ", report.gpsExifStripped);
      console.log("3. Private delivery type preserved: ", report.privateTypePreserved);
      console.log("4. Image dimensions/format:         ", report.dimensionsFormat);
      console.log("5. Synthetic asset deletion+verify: ", report.cleanupVerified);
      console.log("6. Notes / unexpected behavior:     ", report.notes);
      console.log("==========================================\n");
      throw new Error(report.notes[report.notes.length - 1] ?? "Aborted before any Cloudinary request.");
    };

    const missing = checkPresence(REAL_ENV_SNAPSHOT_AT_LOAD);
    console.log("Missing Cloudinary env vars at module load (values never logged):", missing.length ? missing : "(none)");
    if (missing.length > 0) {
      report.presetPreflight = "ABORTED_LOCAL";
      report.notes.push(`Missing env var(s) at module load: ${missing.join(", ")} — set them in your own shell before running with CLOUDINARY_METADATA_STRIP_LIVE=1.`);
      printReportAndAbort();
    }

    // Read ONLY from the module-load-time snapshot — never from process.env
    // directly here — so nothing any describe/beforeEach in this file does
    // later can substitute a different value for the live call.
    const cloudName = REAL_ENV_SNAPSHOT_AT_LOAD.cloudName!;
    const apiKey = REAL_ENV_SNAPSHOT_AT_LOAD.apiKey!;
    const apiSecret = REAL_ENV_SNAPSHOT_AT_LOAD.apiSecret!;
    const uploadPreset = REAL_ENV_SNAPSHOT_AT_LOAD.uploadPreset!;

    // Non-secret, safe to log: confirms which environment/preset this run
    // actually targets, independent of the runner script's own echo.
    console.log("Preflight target — cloud name:", cloudName, "| upload preset:", uploadPreset);

    // ── Fail-closed local checks — zero network calls, zero credential use
    // beyond string comparison — run BEFORE any request leaves this process.

    // 1. Reject known dry-run placeholder values outright. These are the
    // exact literals the DRY-RUN describe above stubs in; if either the
    // cloud name or preset still equals one of them, something is wrong
    // regardless of mechanism, and we must not even try a request.
    const placeholderMatches = checkPlaceholderContamination({ cloudName, apiKey, apiSecret, uploadPreset });
    if (placeholderMatches.length > 0) {
      report.presetPreflight = "ABORTED_LOCAL";
      report.notes.push(
        `ABORTED before any Cloudinary request: live config still matches known test-fixture placeholder value(s) for: ${placeholderMatches.join(", ")}. ` +
        `Target was cloud name "${cloudName}", preset "${uploadPreset}" (non-secret, shown for diagnosis). ` +
        "This indicates environment contamination, not invalid real credentials — do not retry without fixing isolation first.",
      );
      printReportAndAbort();
    }

    // 2. Re-read process.env right now and compare against the snapshot
    // taken at module load. Any difference proves something in this file
    // (or this process) mutated process.env after load — direct, local,
    // network-free proof of contamination, not an assumption.
    const liveReread = {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      uploadPreset: process.env.CLOUDINARY_WARDROBE_UPLOAD_PRESET,
    };
    const driftedKeys = checkEnvDrift(REAL_ENV_SNAPSHOT_AT_LOAD, liveReread);
    if (driftedKeys.length > 0) {
      report.presetPreflight = "ABORTED_LOCAL";
      report.notes.push(
        `ABORTED before any Cloudinary request: process.env changed after module load for: ${driftedKeys.join(", ")} ` +
        "(values not shown — only the fact that they drifted). This test now reads only the frozen snapshot, " +
        "so the live call itself is unaffected, but drift this late means some other hook in this run is still " +
        "mutating process.env and should be fixed at its source.",
      );
      printReportAndAbort();
    }

    // ── Preflight: does this exact key/secret/cloud-name combination see a
    // preset by this exact name? One read-only Admin API GET, before any
    // upload is attempted. A 401 here means the credentials don't belong to
    // this cloud (wrong environment); a 404 means no such preset is visible
    // to these credentials even if it exists in the account you checked by
    // hand; a name or signing-mode mismatch means the exact string or type
    // differs from what's configured.
    try {
      const preflightRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/upload_presets/${encodeURIComponent(uploadPreset)}`,
        { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` } },
      );
      const preflightJson: any = await preflightRes.json().catch(() => ({}));

      if (preflightRes.status === 401) {
        throw new Error(
          "Preflight FAILED: 401 Unauthorized — this API key/secret pair does not authenticate against " +
          `cloud name "${cloudName}". The credentials likely belong to a different Cloudinary environment/account.`,
        );
      }
      if (preflightRes.status === 404 || !preflightRes.ok) {
        throw new Error(
          `Preflight FAILED: upload preset "${uploadPreset}" was not found via the Admin API for cloud "${cloudName}" ` +
          `with the supplied credentials (status ${preflightRes.status}, body: ${JSON.stringify(preflightJson)}). ` +
          "This checks the exact credentials supplied to this run, which may differ from the dashboard session used to confirm the preset by hand.",
        );
      }
      if (preflightJson.name !== uploadPreset) {
        throw new Error(
          `Preflight FAILED: name mismatch — supplied "${uploadPreset}", Admin API returned "${preflightJson.name}". ` +
          "Re-check the exact preset name against the dashboard (case and whitespace both matter).",
        );
      }
      if (preflightJson.unsigned === true) {
        throw new Error(
          `Preflight FAILED: preset "${uploadPreset}" is unsigned, but this upload path requires a SIGNED preset. ` +
          "Confirm this is the intended preset.",
        );
      }

      report.presetPreflight = "PASS";
      console.log(`Preflight PASSED — preset "${uploadPreset}" confirmed signed and reachable on cloud "${cloudName}".`);
    } catch (preflightErr) {
      // A real network request WAS made and Cloudinary (or the fetch call
      // itself) rejected it — this is categorically different from the
      // ABORTED_LOCAL branches above, which never made a request at all.
      // Reporting this as NOT_RUN would understate what actually happened.
      report.presetPreflight = "PREFLIGHT_FAILED";
      report.notes.push(preflightErr instanceof Error ? preflightErr.message : String(preflightErr));
      printReportAndAbort();
    }

    const fixture = buildSyntheticGpsJpeg();
    const beforeScan = scanForExifGpsTags(fixture);
    expect(beforeScan.hasGpsIfd).toBe(true); // re-confirm immediately before the real call

    const timestamp = Math.floor(Date.now() / 1000);
    const assetFolder = `naia-wardrobe/${SYNTHETIC_CUSTOMER_ID}`;
    const allowedFormats = "jpg,jpeg,png,webp,heic,heif";
    const deliveryType = "private";
    const transformation = "fl_force_strip";

    const paramsToSign = [
      `allowed_formats=${allowedFormats}`,
      `folder=${assetFolder}`,
      `timestamp=${timestamp}`,
      `transformation=${transformation}`,
      `type=${deliveryType}`,
      `upload_preset=${uploadPreset}`,
    ].join("&");
    const signature = crypto.createHash("sha1").update(paramsToSign + apiSecret).digest("hex");

    try {
      const uploadBody = new URLSearchParams({
        api_key: apiKey,
        allowed_formats: allowedFormats,
        file: `data:image/jpeg;base64,${fixture.toString("base64")}`,
        folder: assetFolder,
        signature,
        timestamp: String(timestamp),
        transformation,
        type: deliveryType,
        upload_preset: uploadPreset,
      });

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: "POST",
        body: uploadBody,
      });
      const uploadJson: any = await uploadRes.json();
      if (!uploadRes.ok) {
        // Exact Cloudinary rejection reason, verbatim, into the report —
        // this is the only place that generates this note, so it is never
        // duplicated by the outer catch below.
        report.signedUploadAccepted = "FAIL";
        throw new Error(`Cloudinary rejected the signature/upload: ${JSON.stringify(uploadJson.error ?? uploadJson)}`);
      }
      report.signedUploadAccepted = "PASS";

      // Record the exact, immutable identifiers for this one asset — cleanup
      // later targets ONLY this asset_id+public_id pair, never "whatever is
      // in the test folder".
      publicId = uploadJson.public_id;
      assetId = uploadJson.asset_id ?? null;
      format = uploadJson.format ?? "jpg";
      console.log("Uploaded test-only asset — public_id:", publicId, "asset_id:", assetId);

      expect(uploadJson.type, "Upload did not come back as delivery type 'private'").toBe("private");
      report.privateTypePreserved = "PASS";

      // Fetch the stored original back via a signed private-download URL.
      const dlTimestamp = Math.floor(Date.now() / 1000);
      const dlExpiresAt = dlTimestamp + 300;
      const dlSigString =
        `expires_at=${dlExpiresAt}&format=${format}&public_id=${publicId}&timestamp=${dlTimestamp}&type=${deliveryType}` + apiSecret;
      const dlSignature = crypto.createHash("sha1").update(dlSigString).digest("hex");
      const downloadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/download?${new URLSearchParams({
        api_key: apiKey,
        expires_at: String(dlExpiresAt),
        format,
        public_id: publicId!,
        signature: dlSignature,
        timestamp: String(dlTimestamp),
        type: deliveryType,
      }).toString()}`;

      const dlRes = await fetch(downloadUrl);
      expect(dlRes.ok, "Could not fetch the stored original back for verification").toBe(true);
      const storedBytes = Buffer.from(await dlRes.arrayBuffer());

      const afterScan = scanForExifGpsTags(storedBytes);
      // Primary assertion: our deliberately-embedded GPS tags are gone.
      expect(afterScan.hasGpsIfd, "GPS IFD still present after fl_force_strip — stripping did not work").toBe(false);
      report.gpsExifStripped = "PASS";

      // Format/dimensions — reported, not hard-asserted on cosmetic drift.
      const storedMime = detectMimeFromBytes(storedBytes);
      const storedDims = extractImageDimensions(storedBytes);
      const sourceDims = extractImageDimensions(fixture);
      console.log("Format before/after:", "image/jpeg", "->", storedMime);
      console.log("Dimensions before/after:", sourceDims, "->", storedDims);
      const formatChanged = storedMime !== "image/jpeg";
      const dimsChanged = JSON.stringify(storedDims) !== JSON.stringify(sourceDims);
      if (formatChanged) report.notes.push(`format changed: image/jpeg -> ${storedMime}`);
      if (dimsChanged) report.notes.push(`dimensions changed: ${JSON.stringify(sourceDims)} -> ${JSON.stringify(storedDims)}`);
      // Minor encoding differences (recompression, re-encode) are reported
      // above, not treated as automatic failure — only a format OTHER than
      // a still-decodable image, or missing/zero dimensions, is a failure.
      report.dimensionsFormat = storedDims && storedMime ? "PASS" : "FAIL";
      // No byte-identity assertion — Cloudinary may recompress. Visual/color
      // fidelity beyond decode+dimensions is for manual/visual review, not
      // asserted here. Cloudinary documents DigitalSourceType as a metadata
      // field that may legitimately survive stripping — absence of OTHER GPS
      // tags above is the pass/fail bar, not "zero metadata fields remain".
    } catch (err) {
      // The exact failure reason — including Cloudinary's own verbatim
      // rejection message when that's the cause — goes into the report's
      // Notes field, not just vitest's separate failure output.
      report.notes.push(err instanceof Error ? err.message : String(err));
      throw err; // preserve the real pass/fail signal to vitest
    } finally {
      if (!publicId) {
        // No public_id/asset_id was ever returned, which means Cloudinary
        // rejected the request before creating any resource (preset/param
        // validation happens before storage) — there is nothing to clean up.
        // This is read from the existing upload response alone; no new
        // Cloudinary request was made to reach this conclusion.
        report.cleanupVerified = "NOT_APPLICABLE";
        report.notes.push(
          "No public_id/asset_id was ever returned by Cloudinary, so no asset was created and there is nothing to clean up " +
          "(Cloudinary validates upload_preset/signature before creating any resource).",
        );
      } else {
        // Verify this exact asset (by its immutable asset_id, not just its
        // public_id/folder) still exists before targeting it for deletion —
        // never delete based on folder membership alone.
        const verifyBeforeDelete = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/${deliveryType}/${publicId}`,
          { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` } },
        );
        const beforeDeleteJson: any = await verifyBeforeDelete.json().catch(() => ({}));
        const assetIdMatches = !assetId || beforeDeleteJson.asset_id === assetId;
        if (!assetIdMatches) {
          report.notes.push(
            `SAFETY ABORT: asset_id mismatch before delete (expected ${assetId}, got ${beforeDeleteJson.asset_id}) — ` +
            `did NOT delete. Manual recovery: verify in the Cloudinary dashboard which asset is at ` +
            `public_id "${publicId}" before deleting anything.`,
          );
        } else {
          const delTimestamp = Math.floor(Date.now() / 1000);
          const delSigString = `invalidate=true&public_id=${publicId}&timestamp=${delTimestamp}&type=${deliveryType}` + apiSecret;
          const delSignature = crypto.createHash("sha1").update(delSigString).digest("hex");
          const delBody = new URLSearchParams({
            api_key: apiKey,
            invalidate: "true",
            public_id: publicId,
            signature: delSignature,
            timestamp: String(delTimestamp),
            type: deliveryType,
          });
          const delRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
            method: "POST",
            body: delBody,
          });
          const delJson: any = await delRes.json().catch(() => ({}));
          console.log("Cleanup destroy result:", delJson.result ?? "(unknown)");

          // Informational only — a 401 on the old signed-download URL is NOT
          // definitive deletion proof (the URL could fail for reasons other
          // than the asset being gone, e.g. expiry). Logged for visibility,
          // not used to decide pass/fail.
          const verifyTimestamp = Math.floor(Date.now() / 1000);
          const verifyExpiresAt = verifyTimestamp + 60;
          const verifySigString =
            `expires_at=${verifyExpiresAt}&format=${format}&public_id=${publicId}&timestamp=${verifyTimestamp}&type=${deliveryType}` + apiSecret;
          const verifySignature = crypto.createHash("sha1").update(verifySigString).digest("hex");
          const verifyUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/download?${new URLSearchParams({
            api_key: apiKey,
            expires_at: String(verifyExpiresAt),
            format,
            public_id: publicId,
            signature: verifySignature,
            timestamp: String(verifyTimestamp),
            type: deliveryType,
          }).toString()}`;
          const verifyRes = await fetch(verifyUrl);
          console.log("(informational only) signed-URL fetch status post-delete:", verifyRes.status);

          // Authoritative check: look the asset up by its immutable asset_id
          // via the Admin API's resources/by_asset_ids endpoint. This is a
          // read-only GET, scoped to exactly the one asset_id recorded at
          // upload time — it must come back with no matching resource.
          let byAssetIdConfirmsGone = false;
          let byAssetIdCheckRan = false;
          if (assetId) {
            byAssetIdCheckRan = true;
            const lookupUrl = `https://api.cloudinary.com/v1_1/${cloudName}/resources/by_asset_ids?${new URLSearchParams({
              "asset_ids[]": assetId,
            }).toString()}`;
            const lookupRes = await fetch(lookupUrl, {
              headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}` },
            });
            const lookupJson: any = await lookupRes.json().catch(() => ({}));
            const stillPresent = Array.isArray(lookupJson.resources)
              && lookupJson.resources.some((r: any) => r.asset_id === assetId);
            byAssetIdConfirmsGone = lookupRes.ok && !stillPresent;
            console.log("Authoritative by_asset_id lookup — still present:", stillPresent);
          }

          const deleteSucceeded =
            (delJson.result === "ok" || delJson.result === "not found")
            && (byAssetIdCheckRan ? byAssetIdConfirmsGone : !verifyRes.ok);

          if (deleteSucceeded) {
            report.cleanupVerified = "PASS";
            if (!byAssetIdCheckRan) {
              report.notes.push(
                "Cleanup verified only via the weaker signed-URL signal — upload response had no asset_id, " +
                "so the authoritative by_asset_ids lookup could not run. Recommend a manual dashboard check.",
              );
            }
          } else {
            report.notes.push(
              `CLEANUP FAILED — manual recovery required. public_id: "${publicId}", asset_id: "${assetId}". ` +
              `destroy result: "${delJson.result ?? "unknown"}", by_asset_ids lookup ran: ${byAssetIdCheckRan}, ` +
              `still present per by_asset_ids: ${byAssetIdCheckRan ? !byAssetIdConfirmsGone : "unknown"}. ` +
              `Manual steps: Cloudinary dashboard -> Media Library -> search "${publicId}" -> delete, ` +
              `or: curl https://api.cloudinary.com/v1_1/${cloudName}/image/destroy -u "<api_key>:<api_secret>" ` +
              `-d "public_id=${publicId}" -d "type=${deliveryType}" -d "invalidate=true"`,
            );
          }
        }
      }

      console.log("\n=== METADATA-STRIP VALIDATION REPORT ===");
      console.log("0. Preset/credential preflight:     ", report.presetPreflight);
      console.log("1. Signed upload accepted:         ", report.signedUploadAccepted);
      console.log("2. Original GPS/EXIF stripping:     ", report.gpsExifStripped);
      console.log("3. Private delivery type preserved: ", report.privateTypePreserved);
      console.log("4. Image dimensions/format:         ", report.dimensionsFormat);
      console.log("5. Synthetic asset deletion+verify: ", report.cleanupVerified);
      console.log("6. Notes / unexpected behavior:     ", report.notes.length ? report.notes : "(none)");
      console.log("==========================================\n");
    }
  });
});

// ── Environment-isolation proof — always runs, no network, no credentials ────
//
// Added after the env-var-contamination incident where the DRY-RUN describe's
// beforeEach (lines ~85-97 above) set process.env.CLOUDINARY_* to literal
// placeholder strings with no afterEach ever restoring them — so by the time
// the LIVE test read process.env, it got "test-cloud"/"test-preset" instead
// of the real injected values. These tests run unconditionally (no
// CLOUDINARY_METADATA_STRIP_LIVE flag needed) and prove the fix with real
// assertions, not just inspection.
describe("Environment isolation — proves dry-run cannot contaminate live config", () => {
  it("1. by the end of this file's run, process.env.CLOUDINARY_* still matches what was captured at module load", () => {
    // This test is declared AFTER the DRY-RUN describe that stubs
    // CLOUDINARY_* to placeholder values. If vi.unstubAllEnvs() in that
    // describe's afterEach were missing or broken, this would fail — it is
    // not an inspection of the code, it is a live check of this run's own
    // process.env at this point in file-order execution.
    const rereadNow = {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      uploadPreset: process.env.CLOUDINARY_WARDROBE_UPLOAD_PRESET,
    };
    expect(checkEnvDrift(REAL_ENV_SNAPSHOT_AT_LOAD, rereadNow)).toEqual([]);
  });

  it("vi.stubEnv + vi.unstubAllEnvs correctly restores the original value (the mechanism the dry-run describe now relies on)", () => {
    const before = process.env.CLOUDINARY_CLOUD_NAME;
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "test-cloud");
    expect(process.env.CLOUDINARY_CLOUD_NAME).toBe("test-cloud"); // stub applied
    vi.unstubAllEnvs();
    expect(process.env.CLOUDINARY_CLOUD_NAME).toBe(before); // restored exactly
  });

  it("2. valid, realistic (non-placeholder) injected identifiers pass both guards untouched", () => {
    const realistic = {
      cloudName: "diybves1z",
      apiKey: "123456789012345",
      apiSecret: "aRealLookingSecretValue",
      uploadPreset: "naia_wardrobe_signed",
    };
    expect(checkPresence(realistic)).toEqual([]);
    expect(checkPlaceholderContamination(realistic)).toEqual([]);
    expect(checkEnvDrift(realistic, realistic)).toEqual([]);
  });

  it("3. known dry-run placeholder values are rejected by the placeholder guard — zero network calls involved in this check", () => {
    const contaminated = {
      cloudName: "test-cloud",
      apiKey: "test-key",
      apiSecret: "test-secret",
      uploadPreset: "test-preset",
    };
    const matches = checkPlaceholderContamination(contaminated);
    expect(matches.sort()).toEqual(["apiKey", "apiSecret", "cloudName", "uploadPreset"].sort());
  });

  it("3b. a single contaminated field (the exact scenario reported) is still caught", () => {
    const partiallyContaminated = {
      cloudName: "test-cloud", // only this one leaked
      apiKey: "realkey",
      apiSecret: "realsecret",
      uploadPreset: "test-preset", // and this one
    };
    const matches = checkPlaceholderContamination(partiallyContaminated);
    expect(matches).toEqual(expect.arrayContaining(["cloudName", "uploadPreset"]));
    expect(matches).not.toEqual(expect.arrayContaining(["apiKey", "apiSecret"]));
  });

  it("4. a drift between an at-load snapshot and a later re-read is detected (the exact mechanism that would catch future contamination)", () => {
    const atLoad = { cloudName: "diybves1z", apiKey: "k1", apiSecret: "s1", uploadPreset: "naia_wardrobe_signed" };
    const laterRead = { cloudName: "test-cloud", apiKey: "k1", apiSecret: "s1", uploadPreset: "naia_wardrobe_signed" };
    expect(checkEnvDrift(atLoad, laterRead)).toEqual(["cloudName"]);
  });

  it("missing required values are reported by key name, not silently treated as valid", () => {
    const incomplete = { cloudName: "diybves1z", apiKey: undefined, apiSecret: "s1", uploadPreset: undefined };
    expect(checkPresence(incomplete).sort()).toEqual(["apiKey", "uploadPreset"].sort());
  });
});

// Property 4's second half — "an environment mismatch prevents all upload
// and deletion requests" — is verified by code structure, not a runtime
// test, since exercising it live would require either a real network call
// or mocking global fetch inside the LIVE it() block itself (out of scope
// for this fix). In the LIVE test above, every placeholder/drift guard
// calls printReportAndAbort(), which throws synchronously; both guards are
// lexically positioned before the only three fetch(...) call sites in that
// test (the preset preflight, the upload, and the cleanup/by_asset_ids
// calls) — so a thrown abort there makes those call sites unreachable in
// the same synchronous function body. This is a structural guarantee, not
// an inferred one.
