// scripts/generate-lenses.ts
// Dry-run professional lens generator.
// Reads source data, calls Claude 5x sequentially, prints TypeScript to stdout.
// NEVER writes to app/lib/professional-lens-content.ts automatically.
// NEVER commits, pushes, or deploys.
//
// Usage:
//   npm run generate:lenses -- --slug spring-2026-example

import { trendReports } from "../app/lib/trend-reports.js";
import {
  buildSourceBlock,
  designerPrompt,
  buyerPrompt,
  marketerPrompt,
  creativeDirectorPrompt,
  stylistPrompt,
} from "./lens-prompts.js";

// ---- CONFIG ----------------------------------------------------------------

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-7";
const MAX_TOKENS = 8192;

// ---- TYPES -----------------------------------------------------------------

interface Module {
  type?: string;
  label: string;
  [key: string]: unknown;
}

interface LensContent {
  modules: Module[];
}

// ---- CLI -------------------------------------------------------------------

function getSlug(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--slug");
  if (idx === -1 || !args[idx + 1]) {
    console.error("Usage: npm run generate:lenses -- --slug <trend-slug>");
    process.exit(1);
  }
  return args[idx + 1];
}

// ---- CLAUDE ----------------------------------------------------------------

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Claude API ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as { content?: Array<{ text?: string }> };
  return (data.content?.[0]?.text ?? "").trim();
}

// ---- JSON PARSING ----------------------------------------------------------

function parseJSON(raw: string, lensKey: string): unknown {
  let s = raw.trim();
  if (s.startsWith("```json")) s = s.slice(7);
  if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  s = s.trim();
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(
      `${lensKey}: JSON parse failed.\nFirst 400 chars of response:\n${raw.slice(0, 400)}`
    );
  }
}

// ---- VALIDATION ------------------------------------------------------------

const EXPECTED_COUNTS: Record<string, number> = {
  designer: 7,
  buyer: 7,
  marketer: 8,
  "creative-director": 9,
  stylist: 9,
};

const LOCKED_SLUG = "spring-2026-soft-structure";

function validateLens(lensKey: string, parsed: unknown): LensContent {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${lensKey}: response is not a JSON object.`);
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.modules)) {
    throw new Error(`${lensKey}: missing or invalid "modules" array.`);
  }

  const modules = obj.modules as Module[];

  if (modules.length === 0) {
    throw new Error(`${lensKey}: modules array is empty.`);
  }

  // Every module must have a label
  modules.forEach((mod, i) => {
    if (!mod.label || typeof mod.label !== "string") {
      errors.push(`module[${i}] is missing a string "label".`);
    }
  });

  // Last module must be a highlight
  const last = modules[modules.length - 1];
  if (last.type !== "highlight") {
    errors.push(
      `Last module must be type "highlight" — got: ${JSON.stringify(last.type ?? "(none)")}`
    );
  }

  // Highlight body must be a non-empty string
  if (typeof last.body !== "string" || last.body.trim() === "") {
    errors.push(`Last highlight module has an empty or missing "body".`);
  }

  // Section count check (warning only — generation can produce ±1)
  const expected = EXPECTED_COUNTS[lensKey];
  if (expected && modules.length !== expected) {
    console.warn(
      `  ⚠  ${lensKey}: expected ${expected} sections, got ${modules.length}.`
    );
  }

  // Safety: output must not reference the locked Soft Structure slug
  const outputStr = JSON.stringify(parsed);
  if (outputStr.includes(LOCKED_SLUG)) {
    errors.push(
      `Output contains locked slug "${LOCKED_SLUG}" — model confused reference content with output.`
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `${lensKey} validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  return { modules };
}

// ---- TYPESCRIPT SERIALIZER -------------------------------------------------

function serializeStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function serializeValue(value: unknown, indent: number): string {
  const pad = (n: number) => " ".repeat(n);

  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return serializeStr(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = indent + 2;

    // String-only arrays: one item per line
    if (value.every((v) => typeof v === "string")) {
      const items = value.map((v) => `${pad(inner)}${serializeStr(v as string)}`).join(",\n");
      return `[\n${items},\n${pad(indent)}]`;
    }

    // Object arrays: serialize each item
    const items = value
      .map((v) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return serializeInlineOrBlock(v as Record<string, unknown>, inner);
        }
        return `${pad(inner)}${serializeValue(v, inner)}`;
      })
      .join(",\n");
    return `[\n${items},\n${pad(indent)}]`;
  }

  if (typeof value === "object" && value !== null) {
    return serializeInlineOrBlock(value as Record<string, unknown>, indent);
  }

  return String(value);
}

// Simple objects with ≤3 string keys and no long values render inline.
// Everything else renders as a block.
function serializeInlineOrBlock(obj: Record<string, unknown>, indent: number): string {
  const pad = (n: number) => " ".repeat(n);
  const entries = Object.entries(obj);

  const canInline =
    entries.length <= 3 &&
    entries.every(([, v]) => typeof v === "string") &&
    entries.every(([, v]) => (v as string).length < 72);

  if (canInline) {
    const parts = entries.map(([k, v]) => `${k}: ${serializeStr(v as string)}`);
    return `${pad(indent)}{ ${parts.join(", ")} }`;
  }

  const inner = indent + 2;
  const lines = entries
    .map(([k, v]) => `${pad(inner)}${k}: ${serializeValue(v, inner)}`)
    .join(",\n");
  return `${pad(indent)}{\n${lines},\n${pad(indent)}}`;
}

// Modules are always rendered as multi-line blocks.
function serializeModule(mod: Module, indent: number): string {
  const pad = (n: number) => " ".repeat(n);
  const inner = indent + 2;
  const entries = Object.entries(mod);
  const lines = entries
    .map(([k, v]) => `${pad(inner)}${k}: ${serializeValue(v, inner)}`)
    .join(",\n");
  return `${pad(indent)}{\n${lines},\n${pad(indent)}},`;
}

// ---- OUTPUT ----------------------------------------------------------------

const DIVIDER = "// " + "-".repeat(73);

function printOutput(slug: string, lenses: Record<string, LensContent>): void {
  const slugKey = `"${slug}"`;

  console.log("\n");
  console.log(DIVIDER);
  console.log(`// GENERATED LENS CONTENT — ${slug}`);
  console.log(`// Generated: ${new Date().toISOString().split("T")[0]}`);
  console.log(`//`);
  console.log(`// ⚠  REVIEW ALL 5 LENSES BEFORE PASTING.`);
  console.log(`// ⚠  Run: npm run typecheck  after pasting into`);
  console.log(`//         app/lib/professional-lens-content.ts`);
  console.log(`// ⚠  Run: git add app/lib/professional-lens-content.ts ONLY.`);
  console.log(`// ⚠  Do NOT commit without approval.`);
  console.log(DIVIDER);

  console.log(`\n  ${slugKey}: {\n`);

  const lensOrder: Array<[string, string]> = [
    ["designer", "designer"],
    ["buyer", "buyer"],
    ["marketer", "marketer"],
    ["creative-director", '"creative-director"'],
    ["stylist", "stylist"],
  ];

  for (const [key, tsKey] of lensOrder) {
    const content = lenses[key];
    if (!content) continue;

    console.log(`    ${tsKey}: {`);
    console.log(`      modules: [`);
    for (const mod of content.modules) {
      console.log(serializeModule(mod, 8));
    }
    console.log(`      ],`);
    console.log(`    },\n`);
  }

  console.log(`  },`);
  console.log(`\n${DIVIDER}`);
  console.log(`// END — paste above into PROFESSIONAL_LENS_CONTENT in`);
  console.log(`//        app/lib/professional-lens-content.ts`);
  console.log(DIVIDER + "\n");
}

// ---- MAIN ------------------------------------------------------------------

async function main(): Promise<void> {
  const slug = getSlug();

  console.log(`\n[generate-lenses] slug: ${slug}`);
  console.log(`[generate-lenses] model: ${MODEL}\n`);

  // 1. Find trend in trendReports
  const trend = trendReports.find((r) => r.slug === slug);
  if (!trend) {
    const available = trendReports.map((r) => r.slug).join("\n  ");
    console.error(`\n❌ Slug "${slug}" not found in trendReports.`);
    console.error(`\nAvailable slugs:\n  ${available}`);
    process.exit(1);
  }

  console.log(`[generate-lenses] Found: "${trend.title}" (${trend.season})`);

  // 2. Warn if source material is sparse
  const warnings: string[] = [];
  if (!trend.rising?.length) warnings.push("'rising' is empty.");
  if (!trend.fading?.length) warnings.push("'fading' is empty.");
  if (!trend.referencesBehindThisEdit?.length)
    warnings.push("'referencesBehindThisEdit' is empty — key source material missing.");
  if (!trend.editorialIntro) warnings.push("'editorialIntro' is empty.");

  if (warnings.length > 0) {
    console.warn("\n⚠  Source material warnings (add data to trend-reports.ts first):");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }

  // 3. Build source block
  const source = buildSourceBlock(trend);

  // 4. Lens definitions
  const lenses: Array<{ key: string; label: string; promptFn: (s: string) => string }> = [
    { key: "designer", label: "Designer", promptFn: designerPrompt },
    { key: "buyer", label: "Buyer", promptFn: buyerPrompt },
    { key: "marketer", label: "Marketer", promptFn: marketerPrompt },
    { key: "creative-director", label: "Creative Director", promptFn: creativeDirectorPrompt },
    { key: "stylist", label: "Stylist", promptFn: stylistPrompt },
  ];

  // 5. Generate sequentially
  const results: Record<string, LensContent> = {};

  for (const { key, label, promptFn } of lenses) {
    console.log(`[generate-lenses] Generating ${label} lens...`);

    try {
      const raw = await callClaude(promptFn(source));
      const parsed = parseJSON(raw, key);
      const validated = validateLens(key, parsed);
      results[key] = validated;
      console.log(`  ✓ ${label}: ${validated.modules.length} sections`);
    } catch (err) {
      console.error(`\n❌ ${label} failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // 6. Confirm all 5 lenses produced
  const missing = lenses.filter((l) => !results[l.key]).map((l) => l.label);
  if (missing.length > 0) {
    console.error(`\n❌ Missing lenses: ${missing.join(", ")}`);
    process.exit(1);
  }

  // 7. Print TypeScript block to stdout
  console.log(`\n[generate-lenses] All 5 lenses generated. Printing output...\n`);
  printOutput(slug, results);

  console.log(`[generate-lenses] Next steps:`);
  console.log(`  1. Review all 5 lenses above against the quality checklist.`);
  console.log(`  2. Paste the block into app/lib/professional-lens-content.ts`);
  console.log(`  3. Run: npm run typecheck`);
  console.log(`  4. git add app/lib/professional-lens-content.ts  (only this file)`);
  console.log(`  5. Commit and push only after explicit approval.\n`);
}

main().catch((err: unknown) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
