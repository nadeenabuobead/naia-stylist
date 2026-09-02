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

// ── Bug Fix Batch 1 ───────────────────────────────────────────────────────────
// Static source-code regression tests for the four bugs found in live staging QA.
// Groups A-F: Bug 1 (OTHER follow-up field)
// Groups G-N: Bug 2 (fresh session clears old answers)
// Groups P-Y: Bug 3 (empty answers can continue)
// Groups Z-AE: Bug 4 (bodyNeeds type crash)

const indexSrc  = readFileSync(join(__dirname, "_index.tsx"), "utf8");
const resultSrc = readFileSync(join(__dirname, "result.tsx"), "utf8");
const sessionSrc = readFileSync(join(__dirname, "../../lib/session.server.ts"), "utf8");

// ── A-F: Bug 1 — State "other" requires follow-up text ───────────────────────

describe("BUG1-A — OTHER reveals a text field in state.tsx", () => {
  it("component renders a text input when selected === 'other'", () => {
    assert.ok(
      state.includes('selected === "other"') && state.includes('stateOtherText'),
      "state.tsx must show a text field when 'other' is selected",
    );
  });
  it("label is 'Tell nAia how you're feeling today.'", () => {
    assert.ok(
      state.includes("Tell nAia how you're feeling today."),
      "state.tsx label text must match approved copy",
    );
  });
  it("OTHER follow-up input has no placeholder (visual QA fix)", () => {
    // Placeholder was removed so the label alone guides the user.
    // The sm-other-input block must not carry a placeholder attribute.
    const inputBlock = state.slice(state.indexOf("sm-other-input"), state.indexOf("autoComplete"));
    assert.ok(
      !inputBlock.includes("placeholder"),
      "sm-other-input must not have a placeholder attribute",
    );
  });
});

describe("BUG1-B — OTHER requires non-empty text before Continue", () => {
  it("action rejects 'other' with empty otherText", () => {
    const actionBlock = state.slice(
      state.indexOf("export async function action"),
      state.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes('selected === "other"') && actionBlock.includes("!otherText"),
      "action must reject 'other' when otherText is empty",
    );
  });
  it("SmContinue is disabled when state is 'other' and text is empty", () => {
    assert.ok(
      state.includes("isValid") && state.includes("disabled={!isValid}"),
      "SmContinue must be disabled={!isValid} where isValid requires otherText for 'other'",
    );
    assert.ok(
      state.includes("selected !== \"other\" || otherText.trim().length > 0"),
      "isValid must require non-empty otherText when 'other' is selected",
    );
  });
});

describe("BUG1-C — Back restores OTHER selection and text", () => {
  it("loader reads styleMeStateOtherText from session", () => {
    const loaderBlock = state.slice(
      state.indexOf("export async function loader"),
      state.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes('"styleMeStateOtherText"'),
      "loader must read styleMeStateOtherText for Back hydration",
    );
    assert.ok(
      loaderBlock.includes("otherText"),
      "loader must return otherText",
    );
  });
  it("component hydrates otherText from loader via useState", () => {
    assert.ok(
      state.includes("initialOtherText") && state.includes("useState<string>(initialOtherText)"),
      "component must initialize otherText state from loader value",
    );
  });
});

describe("BUG1-D — switching away from OTHER clears stale text", () => {
  it("selectState helper clears otherText when id !== 'other'", () => {
    assert.ok(
      state.includes('id !== "other"') && state.includes('setOtherText("")'),
      "selectState must call setOtherText('') when switching away from 'other'",
    );
  });
  it("action unsets styleMeStateOtherText when state is not 'other'", () => {
    const actionBlock = state.slice(
      state.indexOf("export async function action"),
      state.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes('session.unset("styleMeStateOtherText")'),
      "action must unset styleMeStateOtherText when a non-other state is committed",
    );
  });
});

describe("BUG1-E — internal State ID for 'Other' remains 'other'", () => {
  it("STATE_OPTIONS entry has id: 'other'", () => {
    const optionsBlock = state.slice(
      state.indexOf("const STATE_OPTIONS"),
      state.indexOf("const VALID_STATE_IDS"),
    );
    assert.ok(
      optionsBlock.includes('id: "other"'),
      "STATE_OPTIONS must retain id: 'other' — ID must not change",
    );
  });
  it("VALID_STATE_IDS includes 'other'", () => {
    assert.ok(
      state.includes("VALID_STATE_IDS") && state.includes('"other"'),
      "'other' must remain a valid state ID",
    );
  });
});

describe("BUG1-F — State (including 'other') is context-only / zero scoring", () => {
  it("state.tsx file-level comment declares zero product scoring", () => {
    assert.ok(
      state.includes("ZERO product scoring") || state.includes("zero scoring") || state.includes("context only"),
      "state.tsx must declare that state is zero-scoring context only",
    );
  });
  it("action stores to STATE_QUESTION.storageKey (styleMeState) not to any scoring field", () => {
    const actionBlock = state.slice(
      state.indexOf("export async function action"),
      state.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("STATE_QUESTION.storageKey"),
      "action stores selected to STATE_QUESTION.storageKey only",
    );
    assert.ok(
      !actionBlock.includes("styleMeMood") && !actionBlock.includes("styleMeBodyNeeds"),
      "action must not map 'other' to any scoring field",
    );
  });
  it("otherText is stored to styleMeStateOtherText (separate from scoring fields)", () => {
    const actionBlock = state.slice(
      state.indexOf("export async function action"),
      state.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes('"styleMeStateOtherText"'),
      "other text stored in styleMeStateOtherText, not a scoring field",
    );
    assert.ok(
      !actionBlock.includes("styleMeBodyNeeds") && !actionBlock.includes("styleMeIntentions"),
      "otherText must not be routed to any scoring field",
    );
  });
});

// ── G-N: Bug 2 — Fresh StyleMe clears old answers ────────────────────────────

describe("BUG2-G — Start StyleMe from landing page clears transient run state", () => {
  it("_index.tsx exports an action that calls clearStyleMeSession", () => {
    assert.ok(
      indexSrc.includes("export async function action") && indexSrc.includes("clearStyleMeSession"),
      "_index.tsx must export an action that calls clearStyleMeSession",
    );
  });
  it("action redirects to /style-me/state after clearing", () => {
    assert.ok(
      indexSrc.includes('redirect("/style-me/state"'),
      "action must redirect to /style-me/state after clearing session",
    );
  });
  it("Start StyleMe button submits a POST form (not a plain Link)", () => {
    assert.ok(
      indexSrc.includes('method="post"') && indexSrc.includes("Start StyleMe"),
      "Start StyleMe must be a POST form submit, not a Link",
    );
    assert.ok(
      !indexSrc.includes('to="/style-me/state"'),
      "Start StyleMe must not be a direct Link to /style-me/state (would skip clearing)",
    );
  });
});

describe("BUG2-H — session.server.ts clears styleMeBodyNeedsRaw on fresh start", () => {
  it("STYLEME_SESSION_KEYS includes styleMeBodyNeedsRaw", () => {
    assert.ok(
      sessionSrc.includes('"styleMeBodyNeedsRaw"'),
      "clearStyleMeSession must unset styleMeBodyNeedsRaw",
    );
  });
});

describe("BUG2-I — session.server.ts clears styleMeStateOtherText on fresh start", () => {
  it("STYLEME_SESSION_KEYS includes styleMeStateOtherText", () => {
    assert.ok(
      sessionSrc.includes('"styleMeStateOtherText"'),
      "clearStyleMeSession must unset styleMeStateOtherText",
    );
  });
});

describe("BUG2-J — session.server.ts clears source hydration keys on fresh start", () => {
  it("STYLEME_SESSION_KEYS includes styleMeSourcePrev", () => {
    assert.ok(
      sessionSrc.includes('"styleMeSourcePrev"'),
      "clearStyleMeSession must unset styleMeSourcePrev",
    );
  });
  it("STYLEME_SESSION_KEYS includes styleMeAnchorMethodPrev", () => {
    assert.ok(
      sessionSrc.includes('"styleMeAnchorMethodPrev"'),
      "clearStyleMeSession must unset styleMeAnchorMethodPrev",
    );
  });
});

describe("BUG2-K — start-over from result page still clears session", () => {
  it("result.tsx start-over calls clearStyleMeSession", () => {
    const startOverIdx = resultSrc.indexOf('intent === "start-over"');
    const block = resultSrc.slice(startOverIdx, startOverIdx + 400);
    assert.ok(
      block.includes("clearStyleMeSession"),
      "start-over must still call clearStyleMeSession",
    );
  });
  it("result.tsx start-over still redirects to /style-me/state", () => {
    assert.ok(
      resultSrc.includes('redirect("/style-me/state"'),
      "start-over must still redirect to /style-me/state",
    );
  });
});

describe("BUG2-L — Back within an active run still restores selections", () => {
  it("state.tsx loader reads styleMeState for hydration within active run", () => {
    const loaderBlock = state.slice(
      state.indexOf("export async function loader"),
      state.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes("STATE_QUESTION.storageKey"),
      "state loader must read session for within-run hydration",
    );
    assert.ok(loaderBlock.includes("return { selected"), "state loader returns selected");
  });
  it("physical-need.tsx loader reads styleMeBodyNeedsRaw for within-run hydration", () => {
    const loaderBlock = physNeed.slice(
      physNeed.indexOf("export async function loader"),
      physNeed.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes('"styleMeBodyNeedsRaw"'),
      "physical-need loader reads styleMeBodyNeedsRaw for back hydration",
    );
  });
});

describe("BUG2-M — refresh within active flow preserves current-run state", () => {
  it("no loader in any step destroys session on plain GET (no session clear in loaders)", () => {
    const loaders = [state, intention, physNeed, occasion, source];
    for (const file of loaders) {
      const loaderBlock = file.slice(
        file.indexOf("export async function loader"),
        file.indexOf("export async function action"),
      );
      assert.ok(
        !loaderBlock.includes("clearStyleMeSession") && !loaderBlock.includes("destroySession"),
        "No step loader may destroy the session (would break refresh-within-run)",
      );
    }
  });
});

describe("BUG2-N — persistent Passport/Closet keys are not in STYLEME_SESSION_KEYS", () => {
  it("clearStyleMeSession does not touch auth or profile keys", () => {
    const clearFnStart = sessionSrc.indexOf("export async function clearStyleMeSession");
    const clearFnBody = sessionSrc.slice(clearFnStart, clearFnStart + 800);
    assert.ok(
      !clearFnBody.includes("__naia_tok"),
      "clearStyleMeSession must not touch auth session cookie",
    );
    assert.ok(
      !clearFnBody.includes("destroySession"),
      "clearStyleMeSession must not destroy the entire session (auth PKCE state preserved)",
    );
  });
});

// ── P-Y: Bug 3 — Required answers per step ───────────────────────────────────

describe("BUG3-P — State cannot advance empty", () => {
  it("state.tsx action rejects missing or invalid state ID", () => {
    const actionBlock = state.slice(
      state.indexOf("export async function action"),
      state.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("!VALID_STATE_IDS.has(selected)"),
      "state action must reject invalid/empty state",
    );
  });
  it("SmContinue in state.tsx is disabled when nothing selected", () => {
    assert.ok(
      state.includes("disabled={!isValid}"),
      "state SmContinue must be disabled until a valid selection is made",
    );
  });
});

describe("BUG3-Q — Intention cannot advance empty", () => {
  it("intention.tsx action rejects 0 selections", () => {
    const actionBlock = intention.slice(
      intention.indexOf("export async function action"),
      intention.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("selected.length === 0"),
      "intention action must reject 0 selections",
    );
  });
  it("SmContinue in intention.tsx is disabled when nothing selected", () => {
    assert.ok(
      intention.includes("disabled={selected.length === 0}"),
      "intention SmContinue must be disabled when nothing selected",
    );
  });
});

describe("BUG3-R — Intention advances with 1 or 2 answers", () => {
  it("intention.tsx action allows 1–2 selections", () => {
    const actionBlock = intention.slice(
      intention.indexOf("export async function action"),
      intention.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("selected.length > MAX_SELECTIONS"),
      "intention action rejects > MAX_SELECTIONS but allows 1–2",
    );
    assert.ok(
      !actionBlock.includes("selected.length < 1"),
      "intention action does not require > 1 (1 selection is valid)",
    );
  });
});

describe("BUG3-S — Physical Need cannot advance empty", () => {
  it("physical-need.tsx action rejects 0 selections", () => {
    const actionBlock = physNeed.slice(
      physNeed.indexOf("export async function action"),
      physNeed.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("selected.length === 0"),
      "physical-need action must reject 0 selections",
    );
  });
  it("SmContinue in physical-need.tsx is disabled when nothing selected", () => {
    assert.ok(
      physNeed.includes("disabled={selected.length === 0}"),
      "physical-need SmContinue must be disabled when nothing selected",
    );
  });
  it("helper copy is 'Choose up to 2.' (no 'or skip')", () => {
    assert.ok(
      !physNeed.includes("or skip"),
      "physical-need must not say 'or skip' — nothing-specific is the explicit skip option",
    );
    assert.ok(
      physNeed.includes("Choose up to"),
      "physical-need must still say 'Choose up to' in the helper",
    );
  });
});

describe("BUG3-T — nothing-specific is a valid Physical Need answer", () => {
  it("nothing-specific is in PHYSICAL_NEED_OPTIONS", () => {
    assert.ok(
      physNeed.includes('"nothing-specific"'),
      "nothing-specific must remain a valid option",
    );
  });
  it("nothing-specific with 1 selection passes the minimum-1 check", () => {
    // The action's min=1 check fires before the > MAX_SELECTIONS check.
    // [nothing-specific].length === 1 passes both guards.
    const actionBlock = physNeed.slice(
      physNeed.indexOf("export async function action"),
      physNeed.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("selected.length === 0"),
      "min-1 guard fires on 0 selections (nothing-specific alone = 1, passes)",
    );
    assert.ok(
      !actionBlock.includes("selected.includes(EXCLUSIVE_ID) && selected.length > 1"),
      "nothing-specific exclusivity is enforced before the guard, not as a separate error",
    );
  });
});

describe("BUG3-U — nothing-specific remains exclusive", () => {
  it("toggle handler clears other selections when nothing-specific is chosen", () => {
    assert.ok(
      physNeed.includes("EXCLUSIVE_ID") &&
      physNeed.includes("includes(EXCLUSIVE_ID)"),
      "nothing-specific exclusivity logic is present in toggle handler",
    );
  });
  it("action enforces nothing-specific exclusivity server-side", () => {
    const actionBlock = physNeed.slice(
      physNeed.indexOf("export async function action"),
      physNeed.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("raw.includes(EXCLUSIVE_ID) ? [EXCLUSIVE_ID]"),
      "action collapses to [EXCLUSIVE_ID] when nothing-specific is submitted",
    );
  });
});

describe("BUG3-V — Occasion cannot advance empty", () => {
  it("occasion.tsx action rejects missing occasion", () => {
    const actionBlock = occasion.slice(
      occasion.indexOf("export async function action"),
      occasion.indexOf("export default function StyleMeOccasion"),
    );
    assert.ok(
      actionBlock.includes("!rawOccasion") || actionBlock.includes("!VALID_OCCASION_IDS.has"),
      "occasion action must reject missing/invalid occasion",
    );
  });
  it("SmContinue in occasion.tsx is disabled when nothing selected", () => {
    assert.ok(
      occasion.includes("disabled={!selected}"),
      "occasion SmContinue must be disabled when nothing selected",
    );
  });
});

describe("BUG3-W — Source cannot advance empty", () => {
  it("source.tsx set-source action rejects missing source", () => {
    const actionBlock = source.slice(
      source.indexOf('"set-source"'),
      source.indexOf('"set-anchor-method"'),
    );
    assert.ok(
      actionBlock.includes("!VALID_SOURCE_IDS.has(source)") || actionBlock.includes("!source"),
      "set-source action must reject missing/invalid source",
    );
  });
  it("SourceStep Continue is disabled when nothing selected", () => {
    const stepBlock = source.slice(
      source.indexOf("function SourceStep"),
      source.indexOf("function AnchorMethodStep"),
    );
    assert.ok(
      stepBlock.includes("disabled={!selected}"),
      "SourceStep Continue must be disabled when nothing selected",
    );
  });
});

describe("BUG3-X — Anchor Method cannot advance empty", () => {
  it("AnchorMethodStep Continue is disabled when nothing selected", () => {
    const anchorBlock = source.slice(
      source.indexOf("function AnchorMethodStep"),
      source.indexOf("function ClosetAnchorStep"),
    );
    assert.ok(
      anchorBlock.includes("disabled={!selected}"),
      "AnchorMethodStep Continue must be disabled when nothing selected",
    );
  });
  it("set-anchor-method action rejects no method submitted", () => {
    const actionBlock = source.slice(
      source.indexOf('"set-anchor-method"'),
      source.indexOf('"set-anchor"'),
    );
    assert.ok(
      actionBlock.includes('method === "auto"') && actionBlock.includes('method === "manual"'),
      "set-anchor-method action only proceeds on known values; unrecognised = error",
    );
  });
});

describe("BUG3-Y — No defaults are silently inserted", () => {
  it("state.tsx action does not insert a default state when selection is absent", () => {
    const actionBlock = state.slice(
      state.indexOf("export async function action"),
      state.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("!VALID_STATE_IDS.has(selected)"),
      "state action must reject invalid/empty rather than defaulting",
    );
    assert.ok(
      !actionBlock.includes('selected = "feel-good"') && !actionBlock.includes('?? "feel-good"'),
      "state action must not insert a default state",
    );
  });
  it("physical-need.tsx action does not insert nothing-specific as a default", () => {
    const actionBlock = physNeed.slice(
      physNeed.indexOf("export async function action"),
      physNeed.indexOf("export default function"),
    );
    assert.ok(
      !actionBlock.includes('selected = ["nothing-specific"]') &&
      !actionBlock.includes('?? ["nothing-specific"]'),
      "physical-need action must not insert nothing-specific as a default — customer must select it explicitly",
    );
  });
});

// ── Z-AE: Bug 4 — bodyNeeds type at persistence boundary ─────────────────────

describe("BUG4-Z — bodyNeeds is parsed from cookie before StylingSession.create", () => {
  it("result.tsx parses styleMeBodyNeeds from cookie (does not cast directly to string[])", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes("JSON.parse") && loaderBlock.includes("styleMeBodyNeeds"),
      "result loader must parse styleMeBodyNeeds from cookie via JSON.parse",
    );
    assert.ok(
      !loaderBlock.includes('cookieSession.get("styleMeBodyNeeds") as string[]'),
      "result loader must NOT directly cast styleMeBodyNeeds to string[] without parsing",
    );
  });
  it("Array.isArray guard handles sessions where array was stored directly", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes("Array.isArray"),
      "result loader must guard with Array.isArray to handle both storage formats",
    );
  });
});

describe("BUG4-AA — two bodyNeeds are parsed as string[] (not nested JSON)", () => {
  it("JSON.parse in result loader produces a flat string array", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes("JSON.parse"),
      "one JSON.parse call is sufficient — value was stored once via JSON.stringify",
    );
    assert.ok(
      !loaderBlock.includes("JSON.parse(JSON.parse"),
      "double-parse must not occur — would produce an array of JSON strings, not a string[]",
    );
  });
});

describe("BUG4-AB — nothing-specific reaches Prisma as ['nothing-specific']", () => {
  it("EXCLUSIVE_ID 'nothing-specific' passes through normalization unchanged", () => {
    const actionBlock = physNeed.slice(
      physNeed.indexOf("export async function action"),
      physNeed.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes("BODY_NEED_NORMALIZATION_MAP[id] ?? id"),
      "normalization uses ?? id fallback, so nothing-specific passes through unchanged",
    );
  });
  it("result.tsx bodyNeeds guard checks array length (not string truthiness)", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes("bodyNeeds") && loaderBlock.includes("bodyNeeds ?? []"),
      "Prisma create uses bodyNeeds ?? [] — must be a real array at this point",
    );
  });
});

describe("BUG4-AC — serialized JSON string is never passed directly as bodyNeeds to Prisma", () => {
  it("result.tsx does not pass raw cookie value to StylingSession.create bodyNeeds", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    // The old bug: direct `cookieSession.get("styleMeBodyNeeds") as string[]`
    // feeding into `bodyNeeds: bodyNeeds ?? []` while bodyNeeds was still a string.
    // The fix parses before the variable is used.
    assert.ok(
      !loaderBlock.includes('cookieSession.get("styleMeBodyNeeds") as string[]'),
      "result loader must not cast cookie value directly to string[] without parsing",
    );
  });
  it("generate action already correctly parses bodyNeeds from formData", () => {
    const generateBlock = resultSrc.slice(
      resultSrc.indexOf('"generate"'),
      resultSrc.indexOf('"regenerate"'),
    );
    assert.ok(
      generateBlock.includes("JSON.parse(bodyNeedsRaw)"),
      "generate action must parse bodyNeedsRaw from form data",
    );
  });
});

describe("BUG4-AD — all 8 Rev 3 Physical Need IDs are defined and persist to normalization map", () => {
  const ALL_8 = [
    "nothing-tight-waist",
    "less-body-conscious",
    "more-coverage",
    "softer-easier-fabrics",
    "loose-comfortable",
    "still-want-shape",
    "waist-definition",
    "nothing-specific",
  ];

  for (const id of ALL_8) {
    it(`${id} is in PHYSICAL_NEED_OPTIONS`, () => {
      assert.ok(physNeed.includes(`"${id}"`), `${id} must be in PHYSICAL_NEED_OPTIONS`);
    });
  }

  it("all 8 IDs survive JSON round-trip (stored as JSON.stringify array)", () => {
    const actionBlock = physNeed.slice(
      physNeed.indexOf("export async function action"),
      physNeed.indexOf("export default function"),
    );
    assert.ok(
      actionBlock.includes('"styleMeBodyNeedsRaw"') && actionBlock.includes("JSON.stringify"),
      "action stores raw IDs via JSON.stringify for round-trip correctness",
    );
  });
});

describe("BUG4-AE — all 4 source × anchor combinations reach Prisma without bodyNeeds type crash", () => {
  it("result loader reads bodyNeeds from cookie with JSON.parse before StylingSession.create", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    assert.ok(
      loaderBlock.includes("JSON.parse") && loaderBlock.includes("bodyNeeds"),
      "bodyNeeds is parsed before the create call for all source/anchor paths",
    );
  });
  it("StylingSession.create uses bodyNeeds variable (not raw cookie get)", () => {
    assert.ok(
      resultSrc.includes("bodyNeeds: bodyNeeds ?? []"),
      "create payload references the parsed bodyNeeds variable",
    );
  });
  it("source path (CLOSET vs BOTH) does not bypass bodyNeeds parsing", () => {
    const loaderBlock = resultSrc.slice(
      resultSrc.indexOf("export async function loader"),
      resultSrc.indexOf("export async function action"),
    );
    const parsePos  = loaderBlock.indexOf("JSON.parse");
    const createPos = loaderBlock.indexOf("bodyNeeds: bodyNeeds ?? []");
    assert.ok(
      parsePos !== -1 && createPos !== -1 && parsePos < createPos,
      "JSON.parse must occur before the Prisma create call",
    );
  });
});
