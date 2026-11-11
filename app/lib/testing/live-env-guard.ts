// app/lib/testing/live-env-guard.ts
//
// Pure, credential-free, network-free guard functions used by the live
// metadata-stripping validation harness to detect environment-variable
// contamination (e.g. a dry-run test's placeholder values leaking into the
// live config) BEFORE any Cloudinary request is attempted. Extracted as
// pure functions specifically so they can be unit-tested deterministically
// without ever needing CLOUDINARY_METADATA_STRIP_LIVE=1, real credentials,
// or a network call.

export interface CloudinaryEnvSnapshot {
  cloudName: string | undefined;
  apiKey: string | undefined;
  apiSecret: string | undefined;
  uploadPreset: string | undefined;
}

export const KNOWN_TEST_PLACEHOLDERS: Record<keyof CloudinaryEnvSnapshot, string> = {
  cloudName: "test-cloud",
  apiKey: "test-key",
  apiSecret: "test-secret",
  uploadPreset: "test-preset",
};

// Which of the 4 required values are missing (present = truthy string).
export function checkPresence(snapshot: CloudinaryEnvSnapshot): string[] {
  return (Object.keys(snapshot) as Array<keyof CloudinaryEnvSnapshot>).filter((k) => !snapshot[k]);
}

// Which keys exactly match a known dry-run/test-fixture placeholder value.
// A non-empty result means: do not proceed, this is almost certainly
// contamination rather than a real (if invalid) credential.
export function checkPlaceholderContamination(snapshot: CloudinaryEnvSnapshot): string[] {
  return (Object.keys(KNOWN_TEST_PLACEHOLDERS) as Array<keyof CloudinaryEnvSnapshot>)
    .filter((k) => snapshot[k] === KNOWN_TEST_PLACEHOLDERS[k]);
}

// Which keys differ between two snapshots of the same four variables taken
// at different times. A non-empty result proves process.env was mutated
// between the two reads — direct, local evidence of drift, not inference.
export function checkEnvDrift(
  a: CloudinaryEnvSnapshot,
  b: CloudinaryEnvSnapshot,
): string[] {
  return (Object.keys(a) as Array<keyof CloudinaryEnvSnapshot>).filter((k) => a[k] !== b[k]);
}
