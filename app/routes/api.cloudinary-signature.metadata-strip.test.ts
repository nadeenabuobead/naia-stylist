// app/routes/api.cloudinary-signature.metadata-strip.test.ts
// Verifies the fl_force_strip incoming-transformation fix on the shared
// signing endpoint used by Closet, Buy-or-Skip, and NaiaModel/VTO uploads.
// No network call, no real/synthetic image bytes — this only exercises the
// signature-construction logic itself.
//
// Run: npx vitest run app/routes/api.cloudinary-signature.metadata-strip.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

vi.mock("../lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("../lib/cloudinary-admin.server", () => ({
  buildModelUploadUrl: vi.fn(() => "https://api.cloudinary.com/v1_1/test/image/private/upload"),
}));

import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { loader } from "./api.cloudinary-signature.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  process.env.CLOUDINARY_WARDROBE_UPLOAD_PRESET = "test-preset";
});

const req = () => new Request("http://localhost/api/cloudinary-signature");

describe("unauthenticated requests remain rejected", () => {
  it("401s before any signature is computed", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue(null);
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(401);
  });
});

describe("incoming metadata stripping is included correctly", () => {
  it("response includes transformation: fl_force_strip", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    const res = await loader({ request: req() } as any);
    const body = await res.json();
    expect(body.transformation).toBe("fl_force_strip");
  });
});

describe("the signature covers every required parameter, including transformation", () => {
  it("independently recomputing the signature with the response's own values matches it", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    const res = await loader({ request: req() } as any);
    const body = await res.json();

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

describe("a client cannot remove the transformation while keeping a valid signature", () => {
  it("a signature recomputed WITHOUT transformation does not match the real one", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    const res = await loader({ request: req() } as any);
    const body = await res.json();

    const tamperedParams = [
      `allowed_formats=${body.allowedFormats}`,
      `folder=${body.assetFolder}`,
      `timestamp=${body.timestamp}`,
      `type=${body.deliveryType}`,
      `upload_preset=${body.uploadPreset}`,
    ].join("&"); // transformation omitted — simulating a client that strips it
    const tamperedSig = crypto.createHash("sha1").update(tamperedParams + "test-secret").digest("hex");

    expect(tamperedSig).not.toBe(body.signature);
  });

  it("a signature recomputed with a DIFFERENT transformation value does not match", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    const res = await loader({ request: req() } as any);
    const body = await res.json();

    const tamperedParams = [
      `allowed_formats=${body.allowedFormats}`,
      `folder=${body.assetFolder}`,
      `timestamp=${body.timestamp}`,
      `transformation=w_1,h_1`, // attacker-chosen transformation instead
      `type=${body.deliveryType}`,
      `upload_preset=${body.uploadPreset}`,
    ].join("&");
    const tamperedSig = crypto.createHash("sha1").update(tamperedParams + "test-secret").digest("hex");

    expect(tamperedSig).not.toBe(body.signature);
  });
});

describe("normal upload parameters remain unchanged", () => {
  it("folder, type, allowed_formats, uploadPreset, and ownership-relevant fields are untouched", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    const res = await loader({ request: req() } as any);
    const body = await res.json();
    expect(body.assetFolder).toBe("naia-wardrobe/cust_abc");
    expect(body.deliveryType).toBe("private");
    expect(body.allowedFormats).toBe("jpg,jpeg,png,webp,heic,heif");
    expect(body.uploadPreset).toBe("test-preset");
  });

  it("no resize/crop/quality directive was added alongside the strip flag", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    const res = await loader({ request: req() } as any);
    const body = await res.json();
    expect(body.transformation).not.toMatch(/w_|h_|c_|q_/);
  });
});

describe("existing upload paths remain compatible", () => {
  it("still 500s cleanly if Cloudinary env vars are missing", async () => {
    (getCurrentNaiaCustomer as any).mockResolvedValue({ id: "cust_abc" });
    delete process.env.CLOUDINARY_API_SECRET;
    const res = await loader({ request: req() } as any);
    expect(res.status).toBe(500);
  });
});
