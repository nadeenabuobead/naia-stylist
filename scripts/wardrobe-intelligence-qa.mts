// scripts/wardrobe-intelligence-qa.mts
//
// Real-wardrobe QA harness for Wardrobe Intelligence.
// Read-only: it runs the production loader against live Closet data and prints
// every section plus the internal evidence behind each claim.
//
//   npx tsx scripts/wardrobe-intelligence-qa.mts [--env <file>] [--gate-open] [customerId …]
//
// --gate-open flips flags.derivedIntentionIntelligence on so the shadow Phase 3C
// V2 intention layer can be compared against the gated default.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const gateOpen = args.includes("--gate-open");
const envIdx = args.indexOf("--env");
const envFile = envIdx >= 0 ? args[envIdx + 1] : ".env.local";
const explicitIds = args.filter((a, i) => !a.startsWith("--") && i !== envIdx + 1);

// Load a usable connection string BEFORE db.server is imported — it reads
// process.env.DATABASE_URL at module initialisation.
const env: Record<string, string> = {};
for (const line of readFileSync(envFile, "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const url = [env.DIRECT_URL, env.DATABASE_POSTGRES_URL, env.DATABASE_URL].find(
  (candidate) => candidate && /^postgres(ql)?:\/\//.test(candidate),
);
if (!url) {
  console.error(`No usable postgres URL in ${envFile} (looked at DIRECT_URL, DATABASE_POSTGRES_URL, DATABASE_URL).`);
  process.exit(1);
}
process.env.DATABASE_URL = url;

const { default: prisma } = await import("../app/db.server.js");
const { loadWardrobeIntelligence } = await import("../app/lib/ai/wardrobe-intelligence.server.ts");

const line = (char = "─", n = 78) => char.repeat(n);
const head = (title: string) => {
  console.log("");
  console.log(title.toUpperCase());
  console.log(line("─", Math.max(title.length, 24)));
};

function fmtEvidence(evidence: Array<{ signal: string; field: string; detail: string; garmentIds: string[] }>, names: Map<string, string>) {
  for (const e of evidence) {
    const who = e.garmentIds.length
      ? ` [${e.garmentIds.slice(0, 4).map((id) => names.get(id) ?? id).join(", ")}${e.garmentIds.length > 4 ? `, +${e.garmentIds.length - 4}` : ""}]`
      : "";
    console.log(`      · ${e.signal} · ${e.field} — ${e.detail}${who}`);
  }
}

const customers = explicitIds.length
  ? await prisma.customer.findMany({ where: { id: { in: explicitIds } }, include: { onboardingProfile: true } })
  : (await prisma.customer.findMany({ include: { onboardingProfile: true, _count: { select: { closetItems: true } } } }))
      .filter((c: any) => c._count.closetItems > 0)
      .sort((a: any, b: any) => b._count.closetItems - a._count.closetItems);

console.log(`Wardrobe Intelligence QA — ${customers.length} wardrobe(s) · derived V2 intention gate ${gateOpen ? "OPEN" : "CLOSED"}`);

for (const customer of customers as any[]) {
  const profile = customer.onboardingProfile;

  const { intelligence, garments } = await loadWardrobeIntelligence(customer.id, {
    imageUrlById: new Map(),
    flags: { derivedIntentionIntelligence: gateOpen },
    passport: profile
      ? {
          lifestyle: profile.lifestyle,
          favoriteColors: profile.favoriteColors,
          avoidColors: profile.avoidColors,
          stylePersonalities: profile.stylePersonalities,
          silhouette: profile.silhouette,
          structure: profile.structure ?? null,
          fitPreferences: profile.fitPreferences,
          styleStruggles: profile.styleStruggles,
          styleSupport: profile.styleSupport,
          becoming: profile.becoming,
        }
      : null,
  });

  const names = new Map<string, string>(
    garments.map((g) => [g.id, (g.name && g.name.trim()) || `${g.primaryColor ?? ""} ${g.subcategory ?? g.category}`.trim()]),
  );

  console.log("");
  console.log(line("═"));
  console.log(`WARDROBE ${customer.id.slice(0, 10)} — ${garments.length} pieces · Passport ${profile ? "present" : "absent"}`);
  console.log(line("═"));

  const cov = intelligence.coverage;
  console.log(
    `coverage: analysed ${cov.analysedItems}/${cov.totalItems} · colour ${(cov.colourCoverage * 100).toFixed(0)}% · shape ${(cov.shapeCoverage * 100).toFixed(0)}% · formality ${(cov.formalityCoverage * 100).toFixed(0)}% · self-report ${(cov.relationshipCoverage * 100).toFixed(0)}% · occasion ${(cov.occasionCoverage * 100).toFixed(0)}% · usable intentions ${(cov.usableIntentionCoverage * 100).toFixed(0)}%`,
  );
  console.log(`signals: ${intelligence.signalAvailability.map((s) => `${s.signal}=${s.state}`).join(" · ")}`);

  if (!intelligence.ready) {
    console.log(`NOT READY — ${intelligence.readyNote}`);
    continue;
  }

  head("wardrobe snapshot");
  for (const m of intelligence.snapshot) {
    console.log(`  ${m.value === null ? "—" : m.value}  ${m.label} · ${m.caption} [${m.signal} · ${m.state}]`);
    if (m.learningNote) console.log(`      learning: ${m.learningNote}`);
  }

  head("wardrobe dna");
  console.log(`  state: ${intelligence.dna.state}`);
  if (intelligence.dna.palette.length) {
    console.log(`  palette: ${intelligence.dna.palette.map((p) => `${p.colour} ×${p.count}${p.neutral ? " (neutral)" : ""}`).join(" · ")}`);
    console.log(`  reading: "${intelligence.dna.paletteReading}"`);
  }
  if (intelligence.dna.shapes.length) {
    console.log(`  shapes: ${intelligence.dna.shapes.map((s) => `${s.label} ×${s.count}`).join(" · ")}`);
    if (intelligence.dna.shapesReading) console.log(`  reading: "${intelligence.dna.shapesReading}"`);
  }
  for (const t of intelligence.dna.traits) console.log(`  trait: ${t.label} — ${t.evidence}`);

  head("wardrobe heroes");
  console.log(`  state: ${intelligence.heroes.state}${intelligence.heroes.learningNote ? ` — ${intelligence.heroes.learningNote}` : ""}`);
  for (const h of intelligence.heroes.heroes) {
    console.log(`  [${h.labelText}] ${h.name} (${h.category}) · strength=${h.strength}`);
    console.log(`      "${h.headline}"`);
    for (const r of h.reasons) console.log(`      – ${r}`);
    fmtEvidence(h.evidence, names);
  }

  head("what works well together");
  console.log(`  state: ${intelligence.pairings.state} · ${intelligence.pairings.totalFound} combinations found`);
  for (const p of intelligence.pairings.pairings) {
    console.log(`  ${p.garmentIds.map((id) => names.get(id) ?? id).join("  +  ")}${p.untried ? "   (untried)" : ""}`);
    console.log(`      "${p.reason}"`);
    fmtEvidence(p.evidence, names);
  }

  head("what nAia is noticing");
  if (!intelligence.observations.length) console.log("  (none)");
  for (const o of intelligence.observations) {
    console.log(`  [${o.kind}${o.gated ? " · GATED" : ""}] strength=${o.strength}`);
    console.log(`      ${o.headline.toUpperCase()}`);
    console.log(`      "${o.observation}"`);
    if (o.explanation) console.log(`      ↳ ${o.explanation}`);
    if (o.garmentIds.length) {
      console.log(`      pieces (${o.garmentIds.length}): ${o.garmentIds.slice(0, 6).map((id) => names.get(id) ?? id).join(", ")}${o.garmentIds.length > 6 ? ", …" : ""}`);
    }
    fmtEvidence(o.evidence, names);
  }

  head("rediscover");
  if (!intelligence.opportunities.rediscover.length) console.log("  (none)");
  for (const r of intelligence.opportunities.rediscover) {
    console.log(`  ${r.name} · strength=${r.strength}`);
    console.log(`      "${r.body}"`);
    console.log(`      works with: ${r.worksWithIds.map((id) => names.get(id) ?? id).join(", ")}`);
    fmtEvidence(r.evidence, names);
  }

  head("try together");
  if (!intelligence.opportunities.tryTogether.length) console.log("  (none)");
  for (const t of intelligence.opportunities.tryTogether) {
    console.log(`  ${t.garmentIds.map((id) => names.get(id) ?? id).join("  +  ")}`);
    console.log(`      "${t.body}"`);
  }

  head("worth considering");
  if (!intelligence.opportunities.worthConsidering.length) {
    console.log(`  (no evidenced gap) "${intelligence.opportunities.noGapNote}"`);
  }
  for (const g of intelligence.opportunities.worthConsidering) {
    console.log(`  ${g.title} · strength=${g.strength}`);
    console.log(`      "${g.body}"`);
    if (g.garmentIds.length) {
      console.log(`      pieces (${g.garmentIds.length}): ${g.garmentIds.slice(0, 6).map((id) => names.get(id) ?? id).join(", ")}`);
    }
    fmtEvidence(g.evidence, names);
  }

  head("passport vs closet");
  console.log(`  state: ${intelligence.passportView.state}${intelligence.passportView.learningNote ? ` — ${intelligence.passportView.learningNote}` : ""}`);
  for (const c of intelligence.passportView.comparisons) {
    console.log(`  [${c.id}] strength=${c.strength}`);
    console.log(`      said:     ${c.stated}`);
    console.log(`      observed: ${c.observed}`);
    console.log(`      reading:  ${c.reading}`);
    fmtEvidence(c.evidence, names);
  }
}

await prisma.$disconnect();
