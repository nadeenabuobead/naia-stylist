/**
 * READ-ONLY staging diagnostic for the first real Full-Look VTO test.
 *
 * Reads the 3 real-chain VirtualTryOnJob rows (productHandle prefix
 * "fulllook-real:") for forensic inspection ONLY:
 *   - no write/update/delete of any row
 *   - no FASHN submission of any kind
 *   - no Cloudinary delete
 * The only Cloudinary calls made are signed GET (private_download) requests
 * to READ already-stored images, exactly the same mechanism
 * buildPrivateDownloadUrl/buildTryOnResultUrl already use for legitimate
 * customer-facing display.
 *
 * Usage: node scripts/probe-full-look-vto-real-readonly.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const ROOT = "/Users/nadeenabuobead/naia-stylist";
const env = {
  ...parseEnvFile(`${ROOT}/.env.staging`),
  ...parseEnvFile(`${ROOT}/.env.staging.local`),
};

const candidates = [
  env["DATABASE_POSTGRES_URL"],
  env["DATABASE_PRISMA_DATABASE_URL"],
  env["DATABASE_URL"],
].filter(Boolean);
const pgUrl = candidates.find((u) => u.startsWith("postgresql://") || u.startsWith("postgres://")) || candidates[0];
if (!pgUrl) { console.error("No DB URL found"); process.exit(1); }

const proto = pgUrl.includes("://") ? pgUrl.split("://")[0] : "unknown";
const isAccelerate = proto === "prisma" || proto.startsWith("prisma+");

// schema.prisma's datasource reads env("NAIA_DATABASE_URL") directly —
// the constructor's datasources override alone doesn't bypass that
// validation in this Prisma version, so set it before instantiating.
process.env.NAIA_DATABASE_URL = pgUrl;

let prisma;
if (isAccelerate) {
  const { withAccelerate } = await import("@prisma/extension-accelerate");
  prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } }).$extends(withAccelerate());
} else {
  prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
}

const jobs = await prisma.virtualTryOnJob.findMany({
  where: { productHandle: { startsWith: "fulllook-real:" } },
  orderBy: { createdAt: "asc" },
}).catch((e) => { console.error("QUERY FAILED:", e.message); process.exit(1); });

console.log(`\n=== Real Full-Look VTO jobs (total: ${jobs.length}) ===\n`);
for (const j of jobs) {
  console.log(`id:              ${j.id}`);
  console.log(`customerId:      ${j.customerId}`);
  console.log(`productHandle:   ${j.productHandle}`);
  console.log(`status:          ${j.status}`);
  console.log(`predictionId:    ${j.predictionId}`);
  console.log(`errorCode:       ${j.errorCode}`);
  console.log(`idempotencyKey:  ${j.idempotencyKey}`);
  console.log(`createdAt:       ${j.createdAt.toISOString()}`);
  console.log(`updatedAt:       ${j.updatedAt.toISOString()}`);
  console.log(`completedAt:     ${j.completedAt ? j.completedAt.toISOString() : null}`);
  console.log(`lastActivityAt:  ${j.lastActivityAt.toISOString()}`);
  console.log("---");
}

// Also report the TOTAL real VTO job count (any status) for usage accounting.
const totalRealJobs = jobs.length;
console.log(`\nTotal real (fulllook-real:) VirtualTryOnJob rows: ${totalRealJobs}`);

await prisma.$disconnect();

// ── Cloudinary signed-read helpers (read-only GET, same signature scheme
// buildPrivateDownloadUrl already uses) ─────────────────────────────────────
const cfg = {
  cloudName: env["CLOUDINARY_CLOUD_NAME"],
  apiKey: env["CLOUDINARY_API_KEY"],
  apiSecret: env["CLOUDINARY_API_SECRET"],
};

function buildPrivateDownloadUrl(publicId, format = "png", deliveryType = "private") {
  const timestamp = Math.floor(Date.now() / 1000);
  const expiresAt = timestamp + 600;
  const sigString =
    `expires_at=${expiresAt}&format=${format}&public_id=${publicId}&timestamp=${timestamp}&type=${deliveryType}${cfg.apiSecret}`;
  const signature = crypto.createHash("sha1").update(sigString).digest("hex");
  const params = new URLSearchParams({
    api_key: cfg.apiKey,
    expires_at: String(expiresAt),
    format,
    public_id: publicId,
    signature,
    timestamp: String(timestamp),
    type: deliveryType,
  });
  return `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/download?${params.toString()}`;
}

mkdirSync("/tmp/fulllook-vto-probe", { recursive: true });

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  const isFinal = i === jobs.length - 1 && jobs.length === 3;
  const publicId = isFinal
    ? `naia-tryon/${job.customerId}/${job.id}`
    : `naia-tryon-fulllook-intermediate/${job.customerId}/${job.id}`;
  const url = buildPrivateDownloadUrl(publicId);
  try {
    const res = await fetch(url);
    const outPath = `/tmp/fulllook-vto-probe/step${i + 1}-${isFinal ? "FINAL" : "intermediate"}.png`;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(outPath, buf);
      console.log(`Step ${i + 1} (${isFinal ? "FINAL result" : "intermediate"}) image fetched: ${outPath} (${buf.length} bytes)`);
    } else {
      console.log(`Step ${i + 1} (${isFinal ? "FINAL result" : "intermediate"}) image NOT FOUND (HTTP ${res.status}) — publicId=${publicId}`);
    }
  } catch (e) {
    console.log(`Step ${i + 1} fetch error: ${e.message}`);
  }
}
