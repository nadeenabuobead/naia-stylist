/**
 * Staging-only probe: reads .env.staging.local, connects to DB (Accelerate or direct),
 * and reports all SavedLook rows with their items.
 */
import { readFileSync, existsSync } from "fs";
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

const env = {
  ...parseEnvFile("/Users/nadeenabuobead/naia-stylist/.env.staging"),
  ...parseEnvFile("/Users/nadeenabuobead/naia-stylist/.env.staging.local"),
};

// Pick best URL: direct postgres first, then any other
const candidates = [
  env["DATABASE_POSTGRES_URL"],
  env["DATABASE_PRISMA_DATABASE_URL"],
  env["DATABASE_URL"],
].filter(Boolean);

const pgUrl = candidates.find(u => u.startsWith("postgresql://") || u.startsWith("postgres://"))
  || candidates[0];

if (!pgUrl) { console.error("No DB URL found"); process.exit(1); }

const proto = pgUrl.includes("://") ? pgUrl.split("://")[0] : "unknown";
const isAccelerate = proto === "prisma" || proto.startsWith("prisma+");
console.log(`Protocol: ${proto} | Accelerate: ${isAccelerate} | URL length: ${pgUrl.length}`);

let prisma;
if (isAccelerate) {
  try {
    const { withAccelerate } = await import("@prisma/extension-accelerate");
    prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } }).$extends(withAccelerate());
    console.log("Using Prisma Accelerate extension");
  } catch {
    console.error(
      "All staging URLs are prisma:// (Accelerate) but @prisma/extension-accelerate is not installed.\n" +
      "Cannot connect directly. Use the staging SEED_SECRET admin route or Vercel CLI psql instead."
    );
    process.exit(2);
  }
} else {
  prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
  console.log("Using direct PrismaClient");
}

const looks = await prisma.savedLook.findMany({
  orderBy: { createdAt: "asc" },
  include: {
    items: {
      select: { id: true, itemType: true, closetItemId: true, shopifyProductId: true, productImageUrl: true },
    },
  },
}).catch(e => { console.error(e.message); process.exit(1); });

await prisma.$disconnect();

console.log(`\n=== SavedLooks (total: ${looks.length}) ===`);
for (const look of looks) {
  const nadineItems = look.items.filter(i => i.shopifyProductId !== null);
  const arch = nadineItems.length > 0 ? "LEGACY (NADINE-inclusive)" : "CURRENT (Closet-only)";
  console.log(`\n  [${arch}]`);
  console.log(`  id:               ${look.id}`);
  console.log(`  name:             "${look.name}"`);
  console.log(`  createdAt:        ${look.createdAt.toISOString().slice(0, 10)}`);
  console.log(`  fromSuggestionId: ${look.fromSuggestionId}`);
  console.log(`  items (${look.items.length}):`);
  for (const item of look.items) {
    const kind = item.shopifyProductId ? "NADINE-product" : item.closetItemId ? "closet" : "unknown";
    console.log(`    [${kind}] id=${item.id} type=${item.itemType} closetItemId=${item.closetItemId ?? "null"} shopifyProductId=${item.shopifyProductId ?? "null"}`);
  }
}
