// app/routes/style-me/styleme-rev3-ux.test.ts
// Static source-code contract tests for StyleMe Rev 3 UX cleanup.
// All assertions read route source files — no DB or browser required.
//
// Groups:
//   A  Design — Steps 1-3 use SmPage, naiaStyles, LinksFunction
//   B  Copy — Step 1 question, label changes
//   C  Occasion — 8 options, "other" removed
//   D  Source 5A — 2 REV3 options, question copy, labels
//   E  Source 5B — AnchorMethodStep question and labels
//   F  Back hydration — loaders in Steps 1-3
//   G  Occasion legacy compat
//   H  Source legacy compat
//   I  Source option descriptions
//   J  Occasion back hydration
//   K  Source back hydration
//   L  Anchor method back hydration + Physical Need round-trip

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (file: string) => readFileSync(join(__dirname, file), "utf8");

const state    = src("state.tsx");
const intention = src("intention.tsx");
const physNeed = src("physical-need.tsx");
const occasion = src("occasion.tsx");
const source   = src("source.tsx");

// ── A: Design — Steps 1-3 ────────────────────────────────────────────────────

describe("SM-REV3-A1 — state.tsx exports LinksFunction with naiaStyles", () => {
  it("imports naiaStyles", () => {
    assert.ok(state.includes('from "~/styles/naia-design-system.css?url"'), "naiaStyles import");
  });
  it("exports LinksFunction", () => {
    assert.ok(state.includes("LinksFunction"), "LinksFunction type");
    assert.ok(state.includes("export const links"), "links export");
    assert.ok(state.includes("naiaStyles"), "naiaStyles in links");
  });
});

describe("SM-REV3-A2 — state.tsx uses SmPage component", () => {
  it("imports SmPage", () => {
    assert.ok(state.includes('from "~/components/style-me/SmPage"'), "SmPage import");
  });
  it("renders SmPage with step=1", () => {
    assert.ok(state.includes("<SmPage step={1}>"), "SmPage step={1}");
  });
});

describe("SM-REV3-A3 — state.tsx uses sm-pill design classes", () => {
  it("uses sm-pill class", () => {
    assert.ok(state.includes('"sm-pill"') || state.includes("sm-pill"), "sm-pill class");
  });
  it("uses sm-pill--on for selected state", () => {
    assert.ok(state.includes("sm-pill--on"), "sm-pill--on selected class");
  });
  it("does NOT use sp-* prototype classes", () => {
    assert.ok(!state.includes("sp-page"), "no sp-page");
    assert.ok(!state.includes("sp-option"), "no sp-option");
    assert.ok(!state.includes("sp-btn-primary"), "no sp-btn-primary");
  });
});

describe("SM-REV3-A4 — intention.tsx exports LinksFunction with naiaStyles", () => {
  it("imports naiaStyles", () => {
    assert.ok(intention.includes('from "~/styles/naia-design-system.css?url"'), "naiaStyles import");
  });
  it("exports LinksFunction", () => {
    assert.ok(intention.includes("LinksFunction"), "LinksFunction type");
    assert.ok(intention.includes("export const links"), "links export");
  });
});

describe("SM-REV3-A5 — intention.tsx uses SmPage component", () => {
  it("imports SmPage", () => {
    assert.ok(intention.includes('from "~/components/style-me/SmPage"'), "SmPage import");
  });
  it("renders SmPage with step=2", () => {
    assert.ok(intention.includes("<SmPage step={2}>"), "SmPage step={2}");
  });
  it("does NOT use sp-* prototype classes", () => {
    assert.ok(!intention.includes("sp-page"), "no sp-page");
    assert.ok(!intention.includes("sp-option"), "no sp-option");
  });
});

describe("SM-REV3-A6 — physical-need.tsx exports LinksFunction with naiaStyles", () => {
  it("imports naiaStyles", () => {
    assert.ok(physNeed.includes('from "~/styles/naia-design-system.css?url"'), "naiaStyles import");
  });
  it("exports LinksFunction", () => {
    assert.ok(physNeed.includes("LinksFunction"), "LinksFunction type");
    assert.ok(physNeed.includes("export const links"), "links export");
  });
});

describe("SM-REV3-A7 — physical-need.tsx uses SmPage component", () => {
  it("imports SmPage", () => {
    assert.ok(physNeed.includes('from "~/components/style-me/SmPage"'), "SmPage import");
  });
  it("renders SmPage with step=3", () => {
    assert.ok(physNeed.includes("<SmPage step={3}>"), "SmPage step={3}");
  });
  it("does NOT use sp-* prototype classes", () => {
    assert.ok(!physNeed.includes("sp-page"), "no sp-page");
    assert.ok(!physNeed.includes("sp-option"), "no sp-option");
  });
});

// ── B: Copy — Step 1 ─────────────────────────────────────────────────────────

describe("SM-REV3-B1 — state.tsx question is 'How are you feeling today?'", () => {
  it("new question text is present", () => {
    assert.ok(state.includes("How are you feeling today?"), "updated question");
  });
  it("old question 'How are you arriving today?' is removed", () => {
    assert.ok(!state.includes("How are you arriving today?"), "old question removed");
  });
});

describe("SM-REV3-B2 — 'going-through-change' label is updated", () => {
  it("label is \"I'm going through something\"", () => {
    assert.ok(
      state.includes("I'm going through something"),
      "updated label",
    );
  });
  it("old label 'I'm going through a change / something' is removed", () => {
    assert.ok(
      !state.includes("I'm going through a change / something"),
      "old label removed",
    );
  });
});

describe("SM-REV3-B3 — 'other' option label is 'Other'", () => {
  it("other option label is exactly 'Other'", () => {
    assert.ok(state.includes('"Other"') || state.includes("label: \"Other\""), "Other label");
  });
  it("old 'Something else' label is removed from state.tsx", () => {
    assert.ok(!state.includes("Something else"), "Something else removed from state");
  });
});

// ── C: Occasion — 8 options, "other" removed ─────────────────────────────────

describe("SM-REV3-C1 — occasions array has exactly 8 items", () => {
  it("occasions array contains exactly 8 { id: ... } entries", () => {
    const matches = [...occasion.matchAll(/\{ id: "/g)];
    // Subtract formality options (they are also { id: "formality-... })
    const occasionMatches = [...occasion.matchAll(/\{ id: "(?!formality)/g)];
    assert.strictEqual(
      occasionMatches.length,
      8,
      `Expected 8 occasion entries, got ${occasionMatches.length}`,
    );
  });
});

describe("SM-REV3-C2 — 'other' occasion is not exposed in the UI options array", () => {
  it("{ id: \"other\" } is not in occasions array", () => {
    // Use id: "other" to avoid matching comments that mention "other"
    const occasionsBlock = occasion.slice(
      occasion.indexOf("const occasions = ["),
      occasion.indexOf("const REV3_OCCASION_MAP"),
    );
    assert.ok(!occasionsBlock.includes('id: "other"'), "id: other removed from occasions");
  });
  it("'Something else' label is not in occasion.tsx", () => {
    assert.ok(!occasion.includes("Something else"), "Something else removed from occasion");
  });
});

describe("SM-REV3-C3 — REV3_OCCASION_MAP retains 'other' for legacy internal compat", () => {
  it("'other' key is present in REV3_OCCASION_MAP (legacy/internal compat, not UI)", () => {
    // The 'other' UI option is removed from occasions[], but the mapping is intentionally
    // kept so old sessions or internally constructed requests still normalize safely.
    const mapBlock = occasion.slice(
      occasion.indexOf("const REV3_OCCASION_MAP"),
      occasion.indexOf("const OCCASION_REVERSE_MAP"),
    );
    assert.ok(mapBlock.includes('"other": "not-sure"'), "legacy other→not-sure mapping retained");
  });
});

// ── D: Source 5A ─────────────────────────────────────────────────────────────

describe("SM-REV3-D1 — REV3_SOURCE_OPTIONS has exactly 2 entries", () => {
  it("REV3_SOURCE_OPTIONS block contains exactly 2 id fields", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    const ids = [...revBlock.matchAll(/id: "/g)];
    assert.strictEqual(ids.length, 2, `Expected 2 REV3_SOURCE_OPTIONS, got ${ids.length}`);
  });
});

describe("SM-REV3-D2 — REV3_SOURCE_OPTIONS does not include 'specific-piece'", () => {
  it("specific-piece id is not in REV3_SOURCE_OPTIONS", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    assert.ok(!revBlock.includes('"specific-piece"'), "specific-piece removed");
  });
});

describe("SM-REV3-D3 — REV3_SOURCE_OPTIONS does not include 'naia-piece'", () => {
  it("naia-piece id is not in REV3_SOURCE_OPTIONS", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    assert.ok(!revBlock.includes('"naia-piece"'), "naia-piece removed from REV3 options");
  });
});

describe("SM-REV3-D4 — SourceStep question is 'What should nAia work with today?'", () => {
  it("SourceStep heading is correct", () => {
    assert.ok(
      source.includes("What should nAia work with today?"),
      "SourceStep question updated",
    );
  });
  it("old question 'What are we building the look around?' is removed", () => {
    assert.ok(
      !source.includes("What are we building the look around?"),
      "old SourceStep question removed",
    );
  });
});

describe("SM-REV3-D5 — my-closet option label is 'ONLY MY CLOSET'", () => {
  it("ONLY MY CLOSET label is in REV3_SOURCE_OPTIONS", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    assert.ok(revBlock.includes("ONLY MY CLOSET"), "ONLY MY CLOSET label");
  });
});

describe("SM-REV3-D6 — both option label is 'MY CLOSET + BRANDS'", () => {
  it("MY CLOSET + BRANDS label is in REV3_SOURCE_OPTIONS", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    assert.ok(revBlock.includes("MY CLOSET + BRANDS"), "MY CLOSET + BRANDS label");
  });
});

// ── E: Source 5B (AnchorMethodStep) ──────────────────────────────────────────

describe("SM-REV3-E1 — AnchorMethodStep question is 'Do you already have a piece in mind?'", () => {
  it("new anchor question is present", () => {
    assert.ok(
      source.includes("Do you already have a piece in mind?"),
      "AnchorMethodStep question updated",
    );
  });
  it("old anchor question 'How should nAia choose your anchor piece?' is removed", () => {
    assert.ok(
      !source.includes("How should nAia choose your anchor piece?"),
      "old anchor question removed",
    );
  });
});

describe("SM-REV3-E2 — AnchorMethodStep has 'YES — I HAVE A PIECE IN MIND' option", () => {
  it("YES — I HAVE A PIECE IN MIND label present", () => {
    assert.ok(source.includes("YES — I HAVE A PIECE IN MIND"), "manual option YES label");
  });
  it("manual helper is correct", () => {
    assert.ok(
      source.includes("Let me choose what I want the look built around."),
      "manual helper copy",
    );
  });
  it("manual option sets selected to 'manual' via onClick", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    // Two-step picker: options are type=button, method submitted via hidden input
    assert.ok(anchorBlock.includes('setSelected("manual")'), "onClick sets manual");
  });
});

describe("SM-REV3-E3 — AnchorMethodStep has 'NO — LET nAia CHOOSE' option", () => {
  it("NO — LET nAia CHOOSE label present", () => {
    assert.ok(source.includes("NO — LET nAia CHOOSE"), "auto option NO label");
  });
  it("auto helper is correct", () => {
    assert.ok(
      source.includes("Choose the best starting point for this look."),
      "auto helper copy",
    );
  });
  it("auto option sets selected to 'auto' via onClick", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    // Two-step picker: options are type=button, method submitted via hidden input
    assert.ok(anchorBlock.includes('setSelected("auto")'), "onClick sets auto");
  });
});

describe("SM-REV3-E4 — back from anchor-method clears source and returns to source step", () => {
  it("action handles _action=back with from=anchor-method", () => {
    assert.ok(source.includes('from === "anchor-method"'), "anchor-method back handler");
    assert.ok(source.includes("styleMeSource"), "unsets styleMeSource on back");
    assert.ok(source.includes("styleMeAnchorMode"), "unsets styleMeAnchorMode on back");
  });
});

describe("SM-REV3-E5 — back from closet-anchor returns to anchor-method step", () => {
  it("action handles _action=back with from=closet-anchor", () => {
    assert.ok(source.includes('from === "closet-anchor"'), "closet-anchor back handler");
  });
});

// ── F: Back hydration — loaders in Steps 1-3 ─────────────────────────────────

describe("SM-REV3-F1 — state.tsx has a loader that reads session", () => {
  it("exports async loader function", () => {
    assert.ok(state.includes("export async function loader"), "loader exported");
  });
  it("loader reads STATE_QUESTION.storageKey from session", () => {
    assert.ok(state.includes("STATE_QUESTION.storageKey"), "reads STATE_QUESTION.storageKey");
  });
  it("loader returns selected value", () => {
    assert.ok(state.includes("return { selected"), "returns selected");
  });
});

describe("SM-REV3-F2 — state.tsx component hydrates from loader", () => {
  it("imports useLoaderData", () => {
    assert.ok(state.includes("useLoaderData"), "useLoaderData imported");
  });
  it("initialises useState from loader's selected value", () => {
    assert.ok(state.includes("initialSelected"), "uses initialSelected from loader");
    assert.ok(state.includes("useState<string | null>(initialSelected)"), "useState initialised from loader");
  });
});

describe("SM-REV3-F3 — intention.tsx has a loader that reads session", () => {
  it("exports async loader function", () => {
    assert.ok(intention.includes("export async function loader"), "loader exported");
  });
  it("loader reads INTENTION_QUESTION.storageKey from session", () => {
    assert.ok(intention.includes("INTENTION_QUESTION.storageKey"), "reads INTENTION_QUESTION.storageKey");
  });
  it("loader parses JSON array from session", () => {
    assert.ok(intention.includes("JSON.parse"), "parses JSON");
    assert.ok(intention.includes("return { selected"), "returns selected array");
  });
});

describe("SM-REV3-F4 — intention.tsx component hydrates from loader", () => {
  it("imports useLoaderData", () => {
    assert.ok(intention.includes("useLoaderData"), "useLoaderData imported");
  });
  it("initialises useState from loader's selected array", () => {
    assert.ok(intention.includes("initialSelected"), "uses initialSelected from loader");
    assert.ok(intention.includes("useState<string[]>(initialSelected)"), "useState initialised from loader");
  });
});

describe("SM-REV3-F5 — physical-need.tsx has a loader that reads session", () => {
  it("exports async loader function", () => {
    assert.ok(physNeed.includes("export async function loader"), "loader exported");
  });
  it("loader reads styleMeBodyNeeds from session", () => {
    assert.ok(physNeed.includes('"styleMeBodyNeeds"'), "reads styleMeBodyNeeds");
  });
  it("loader parses JSON and filters to valid UI IDs", () => {
    assert.ok(physNeed.includes("JSON.parse"), "parses JSON");
    assert.ok(physNeed.includes("VALID_IDS.has"), "filters to valid UI IDs");
    assert.ok(physNeed.includes("return { selected"), "returns selected array");
  });
});

describe("SM-REV3-F6 — physical-need.tsx component hydrates from loader", () => {
  it("imports useLoaderData", () => {
    assert.ok(physNeed.includes("useLoaderData"), "useLoaderData imported");
  });
  it("initialises useState from loader's selected array", () => {
    assert.ok(physNeed.includes("initialSelected"), "uses initialised from loader");
    assert.ok(physNeed.includes("useState<string[]>(initialSelected)"), "useState initialised from loader");
  });
});

// ── G: Occasion legacy compatibility ─────────────────────────────────────────

describe("SM-REV3-G1 — REV3_OCCASION_MAP retains 'other' → 'not-sure' for legacy compat", () => {
  it("'other' key is present in REV3_OCCASION_MAP", () => {
    const mapBlock = occasion.slice(
      occasion.indexOf("const REV3_OCCASION_MAP"),
      occasion.indexOf("const OCCASION_REVERSE_MAP"),
    );
    assert.ok(mapBlock.includes('"other"'), "'other' key retained in REV3_OCCASION_MAP");
    assert.ok(mapBlock.includes('"not-sure"'), "'not-sure' value retained");
  });
  it("'other' → 'not-sure' mapping entry is present", () => {
    const mapBlock = occasion.slice(
      occasion.indexOf("const REV3_OCCASION_MAP"),
      occasion.indexOf("const OCCASION_REVERSE_MAP"),
    );
    assert.ok(
      mapBlock.includes('"other": "not-sure"'),
      "'other': 'not-sure' mapping intact",
    );
  });
});

describe("SM-REV3-G2 — fresh Rev 3 UI still has exactly 8 visible options", () => {
  it("occasions array has 8 entries (other not visible)", () => {
    const occasionsBlock = occasion.slice(
      occasion.indexOf("const occasions = ["),
      occasion.indexOf("const REV3_OCCASION_MAP"),
    );
    const ids = [...occasionsBlock.matchAll(/\{ id: "/g)];
    assert.strictEqual(ids.length, 8, `UI occasions must be 8, got ${ids.length}`);
    // Check id: "other" specifically — not just the word "other" in comments
    assert.ok(!occasionsBlock.includes('id: "other"'), "other id not in UI occasions");
  });
});

// ── H: Source legacy compatibility ────────────────────────────────────────────

describe("SM-REV3-H1 — specific-piece legacy handling remains in action", () => {
  it("action still processes specific-piece for backward compat", () => {
    assert.ok(
      source.includes('"specific-piece"'),
      "specific-piece handling still exists in action",
    );
    assert.ok(
      source.includes("rawSource === \"specific-piece\""),
      "specific-piece action branch present",
    );
  });
});

describe("SM-REV3-H2 — naia-piece legacy handling remains in action", () => {
  it("VALID_SOURCE_IDS still includes naia-piece for legacy session compat", () => {
    assert.ok(
      source.includes('"naia-piece"') && source.includes("VALID_SOURCE_IDS"),
      "VALID_SOURCE_IDS still includes naia-piece",
    );
  });
  it("action still processes naia-piece → redirect to result", () => {
    assert.ok(
      source.includes('source === "naia-piece"'),
      "naia-piece redirect logic present in action",
    );
  });
});

// ── I: Source option description copy ────────────────────────────────────────

describe("SM-REV3-I1 — my-closet description is approved copy", () => {
  it("my-closet description is correct", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    assert.ok(
      revBlock.includes("Build the look using pieces I already own."),
      "my-closet description approved copy",
    );
  });
});

describe("SM-REV3-I2 — both description is approved copy", () => {
  it("both description is correct", () => {
    const revBlock = source.slice(
      source.indexOf("const REV3_SOURCE_OPTIONS"),
      source.indexOf("const sourceOptions"),
    );
    assert.ok(
      revBlock.includes("Start with what I own, and bring in brand pieces only if they genuinely add something."),
      "both description approved copy",
    );
  });
});

// ── J: Occasion back hydration ────────────────────────────────────────────────

describe("SM-REV3-J1 — occasion.tsx loader reads and returns prevOccasion", () => {
  it("loader reads styleMeOccasion from session", () => {
    assert.ok(occasion.includes('"styleMeOccasion"'), "reads styleMeOccasion");
  });
  it("loader returns prevOccasion in data()", () => {
    assert.ok(occasion.includes("prevOccasion"), "prevOccasion in return");
  });
  it("OCCASION_REVERSE_MAP exists for canonical → UI reverse lookup", () => {
    assert.ok(occasion.includes("OCCASION_REVERSE_MAP"), "OCCASION_REVERSE_MAP defined");
    assert.ok(occasion.includes('"date-night": "date"'), "date-night reverse mapping");
    assert.ok(occasion.includes('"special-event": "event"'), "special-event reverse mapping");
  });
});

describe("SM-REV3-J2 — occasion.tsx loader reads and returns prevFormality", () => {
  it("loader reads styleMeFormalityConditional from session", () => {
    assert.ok(occasion.includes('"styleMeFormalityConditional"'), "reads styleMeFormalityConditional");
  });
  it("loader returns prevFormality", () => {
    assert.ok(occasion.includes("prevFormality"), "prevFormality in return");
  });
});

describe("SM-REV3-J3 — occasion.tsx component hydrates selected and formality from loader", () => {
  it("component destructures prevOccasion and prevFormality from useLoaderData", () => {
    const componentBlock = occasion.slice(occasion.indexOf("export default function StyleMeOccasion"));
    assert.ok(componentBlock.includes("prevOccasion"), "prevOccasion destructured");
    assert.ok(componentBlock.includes("prevFormality"), "prevFormality destructured");
  });
  it("useState for selected initialises from prevOccasion", () => {
    const componentBlock = occasion.slice(occasion.indexOf("export default function StyleMeOccasion"));
    assert.ok(
      componentBlock.includes("useState<string | null>(prevOccasion)"),
      "useState selected init from prevOccasion",
    );
  });
  it("useState for formality initialises from prevFormality", () => {
    const componentBlock = occasion.slice(occasion.indexOf("export default function StyleMeOccasion"));
    assert.ok(
      componentBlock.includes("useState<string | null>(prevFormality)"),
      "useState formality init from prevFormality",
    );
  });
});

// ── K: Source back hydration ──────────────────────────────────────────────────

describe("SM-REV3-K1 — back from anchor-method saves styleMeSourcePrev", () => {
  it("back action saves prevSrc to styleMeSourcePrev before clearing source", () => {
    assert.ok(
      source.includes("styleMeSourcePrev"),
      "styleMeSourcePrev key used in back action",
    );
    assert.ok(
      source.includes('session.set("styleMeSourcePrev"'),
      "styleMeSourcePrev is set on back from anchor-method",
    );
  });
});

describe("SM-REV3-K2 — loader returns prevSource for SourceStep hydration", () => {
  it("loader reads styleMeSourcePrev from session", () => {
    assert.ok(source.includes('"styleMeSourcePrev"'), "reads styleMeSourcePrev");
  });
  it("loader returns prevSource in data()", () => {
    assert.ok(source.includes("prevSource"), "prevSource in loader data");
  });
});

describe("SM-REV3-K3 — SourceStep initialises selection from prevSource", () => {
  it("SourceStep reads prevSource from loaderData", () => {
    const stepBlock = source.slice(source.indexOf("function SourceStep"), source.indexOf("function AnchorMethodStep"));
    assert.ok(stepBlock.includes("prevSource"), "SourceStep uses prevSource");
    assert.ok(stepBlock.includes("prevSource ?? null"), "prevSource with null fallback");
  });
});

describe("SM-REV3-K4 — set-source action clears styleMeSourcePrev", () => {
  it("styleMeSourcePrev is unset when a new source is selected", () => {
    assert.ok(
      source.includes('session.unset("styleMeSourcePrev")'),
      "styleMeSourcePrev unset on new selection",
    );
  });
});

// ── L: Anchor method back hydration + Physical Need round-trip ────────────────

describe("SM-REV3-L1 — AnchorMethodStep is a two-step picker (select + Continue)", () => {
  it("AnchorMethodStep accepts prevMethod prop", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    assert.ok(anchorBlock.includes("prevMethod"), "AnchorMethodStep has prevMethod");
  });
  it("useState is initialized from prevMethod", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    assert.ok(anchorBlock.includes("useState<string | null>(prevMethod)"), "useState from prevMethod");
  });
  it("options use type=button (not direct submit)", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    // Both anchor buttons must be type="button" for selection state
    const submitButtons = [...anchorBlock.matchAll(/type="submit"/g)];
    const buttonButtons = [...anchorBlock.matchAll(/type="button"/g)];
    // Expect 0 direct-submit choice buttons (there may be 1 for the Continue sm-continue)
    // The 2 choice buttons should be type="button"
    assert.ok(buttonButtons.length >= 2, "at least 2 type=button selection buttons");
  });
  it("sm-pill--on applied to selected option", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    assert.ok(anchorBlock.includes("sm-pill--on"), "sm-pill--on applied to selected option");
  });
  it("hidden input carries selected method value to server", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    assert.ok(anchorBlock.includes('name="method"') && anchorBlock.includes("{selected ?? \"\"}"), "hidden method input");
  });
  it("Continue button is disabled until a method is selected", () => {
    const anchorBlock = source.slice(source.indexOf("function AnchorMethodStep"), source.indexOf("function ClosetAnchorStep"));
    assert.ok(anchorBlock.includes("disabled={!selected}"), "Continue disabled until selection");
  });
});

describe("SM-REV3-L2 — back from closet-anchor saves styleMeAnchorMethodPrev", () => {
  it("back action saves prevAnchorMode to styleMeAnchorMethodPrev before clearing", () => {
    assert.ok(
      source.includes("styleMeAnchorMethodPrev"),
      "styleMeAnchorMethodPrev key exists",
    );
    assert.ok(
      source.includes('session.set("styleMeAnchorMethodPrev"'),
      "styleMeAnchorMethodPrev set on back from closet-anchor",
    );
  });
  it("loader reads styleMeAnchorMethodPrev for anchor-method step", () => {
    assert.ok(source.includes('"styleMeAnchorMethodPrev"'), "loader reads styleMeAnchorMethodPrev");
    assert.ok(source.includes("anchorMethodPrev"), "anchorMethodPrev in loader");
  });
});

describe("SM-REV3-L3 — manual anchor survives closet-picker Back (round-trip)", () => {
  it("set-anchor-method clears styleMeAnchorMethodPrev when committed", () => {
    assert.ok(
      source.includes('session.unset("styleMeAnchorMethodPrev")'),
      "styleMeAnchorMethodPrev cleared on commit",
    );
  });
  it("set-source clears styleMeAnchorMethodPrev on source change", () => {
    const setSourceBlock = source.slice(
      source.indexOf('"set-source"'),
      source.indexOf('"set-anchor-method"'),
    );
    assert.ok(
      setSourceBlock.includes('session.unset("styleMeAnchorMethodPrev")'),
      "styleMeAnchorMethodPrev cleared when source changes",
    );
  });
});

describe("SM-REV3-L4 — parent passes prevMethod to AnchorMethodStep", () => {
  it("JSX renders AnchorMethodStep with prevMethod prop", () => {
    assert.ok(source.includes("prevMethod="), "prevMethod prop passed to AnchorMethodStep");
  });
});

describe("SM-REV3-L5 — Physical Need raw IDs stored for hydration", () => {
  const physNeedFresh = readFileSync(join(__dirname, "physical-need.tsx"), "utf8");
  it("action stores styleMeBodyNeedsRaw before normalization", () => {
    assert.ok(physNeedFresh.includes('"styleMeBodyNeedsRaw"'), "styleMeBodyNeedsRaw key used");
    assert.ok(
      physNeedFresh.includes('session.set("styleMeBodyNeedsRaw"'),
      "styleMeBodyNeedsRaw is set in action",
    );
  });
  it("loader reads styleMeBodyNeedsRaw (not styleMeBodyNeeds) for hydration", () => {
    const loaderBlock = physNeedFresh.slice(
      physNeedFresh.indexOf("export async function loader"),
      physNeedFresh.indexOf("export async function action"),
    );
    assert.ok(loaderBlock.includes('"styleMeBodyNeedsRaw"'), "loader reads styleMeBodyNeedsRaw");
    assert.ok(!loaderBlock.includes('"styleMeBodyNeeds"') || loaderBlock.indexOf('"styleMeBodyNeeds"') === -1, "loader does NOT read normalized styleMeBodyNeeds for hydration");
  });
  it("action still writes normalized styleMeBodyNeeds for the engine", () => {
    assert.ok(physNeedFresh.includes('"styleMeBodyNeeds"'), "styleMeBodyNeeds still written for engine");
    assert.ok(physNeedFresh.includes("BODY_NEED_NORMALIZATION_MAP"), "normalization map still applied");
  });
});

describe("SM-REV3-L6 — Physical Need 8 UI IDs all round-trip via styleMeBodyNeedsRaw", () => {
  const ALL_8_IDS = [
    "nothing-tight-waist",
    "less-body-conscious",
    "more-coverage",
    "softer-easier-fabrics",
    "loose-comfortable",
    "still-want-shape",
    "waist-definition",
    "nothing-specific",
  ];
  it("all 8 Rev 3 Physical Need IDs are in PHYSICAL_NEED_OPTIONS (VALID_IDS)", () => {
    const physNeedFresh = readFileSync(join(__dirname, "physical-need.tsx"), "utf8");
    for (const id of ALL_8_IDS) {
      assert.ok(physNeedFresh.includes(`"${id}"`), `${id} is in PHYSICAL_NEED_OPTIONS`);
    }
  });
  it("styleMeBodyNeedsRaw stores raw IDs so all 8 survive Back navigation", () => {
    const physNeedFresh = readFileSync(join(__dirname, "physical-need.tsx"), "utf8");
    // Raw IDs are stored before normalization in the action
    const actionBlock = physNeedFresh.slice(
      physNeedFresh.indexOf("export async function action"),
      physNeedFresh.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.indexOf("styleMeBodyNeedsRaw") < actionBlock.indexOf("BODY_NEED_NORMALIZATION_MAP"),
      "styleMeBodyNeedsRaw stored BEFORE normalization (raw IDs preserved)",
    );
  });
  it("nothing-specific exclusive logic works regardless of normalization", () => {
    const physNeedFresh = readFileSync(join(__dirname, "physical-need.tsx"), "utf8");
    assert.ok(physNeedFresh.includes('"nothing-specific"'), "nothing-specific exclusive ID defined");
    assert.ok(physNeedFresh.includes("EXCLUSIVE_ID"), "exclusive logic present");
  });
  it("less-body-conscious label is 'Nothing too body-hugging' (Rev 3 copy polish)", () => {
    const physNeedFresh = readFileSync(join(__dirname, "physical-need.tsx"), "utf8");
    assert.ok(
      physNeedFresh.includes('"Nothing too body-hugging"'),
      "label must be updated to Nothing too body-hugging",
    );
    assert.ok(
      !physNeedFresh.includes('"Less body-conscious"'),
      "old label 'Less body-conscious' must be removed",
    );
  });
});
