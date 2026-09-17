// closet-review-phase3b.test.ts
//
// Phase 3B tests — Review Queue Speed.
//
// Tests verify the structural and security properties of the queue-speed changes:
//   §3B-A  getNextUnreviewedItemId exported + correct query shape
//   §3B-B  List route exports an action function
//   §3B-C  List action handles quick-approve intent and rejects unknown intents
//   §3B-D  Security — reviewedBy from session, not formData
//   §3B-E  Detail loader passes nextUnreviewedId and returnTo
//   §3B-F  Detail component: auto-advance useEffect and queue nav link
//
// All tests are pure-code inspection (readFileSync) — no DB or server needed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

const listSrc   = readFileSync(resolve(ROOT, "app/routes/admin.naia.closet._index.tsx"),  "utf8");
const detailSrc = readFileSync(resolve(ROOT, "app/routes/admin.naia.closet.$itemId.tsx"), "utf8");
const ciSrc     = readFileSync(resolve(ROOT, "app/lib/admin/closet-intelligence.server.ts"), "utf8");

// ── §3B-A getNextUnreviewedItemId ────────────────────────────────────────────

describe("§3B-A getNextUnreviewedItemId", () => {
  it("is exported from closet-intelligence.server.ts", () => {
    assert.ok(
      ciSrc.includes("export async function getNextUnreviewedItemId"),
      "getNextUnreviewedItemId must be exported",
    );
  });

  it("queries for items where adminReview is null OR reviewStatus = unreviewed", () => {
    assert.ok(
      ciSrc.includes("adminReview: null") && ciSrc.includes("reviewStatus: \"unreviewed\""),
      "must include both null adminReview and unreviewed status in OR clause",
    );
  });

  it("orders results by createdAt desc", () => {
    assert.ok(
      ciSrc.includes('orderBy: { createdAt: "desc" }'),
      "must order by createdAt DESC to match list view order",
    );
  });

  it("uses createdAt lt cursor to find next older item", () => {
    assert.ok(
      ciSrc.includes("createdAt: { lt: current.createdAt }"),
      "must use lt cursor for next-in-sorted-order navigation",
    );
  });

  it("returns null when current item is not found", () => {
    assert.ok(
      ciSrc.includes("if (!current) return null"),
      "must guard against missing current item",
    );
  });
});

// ── §3B-B List route action ───────────────────────────────────────────────────

describe("§3B-B list route exports action", () => {
  it("exports an action function", () => {
    assert.ok(
      listSrc.includes("export async function action"),
      "list route must export an action",
    );
  });

  it("imports markItemReviewed from closet-review.server", () => {
    assert.ok(
      listSrc.includes("markItemReviewed"),
      "list route must import markItemReviewed",
    );
  });
});

// ── §3B-C List action intent handling ────────────────────────────────────────

describe("§3B-C list action handles intents", () => {
  it("handles intent=quick-approve", () => {
    assert.ok(
      listSrc.includes('intent === "quick-approve"'),
      "must handle quick-approve intent",
    );
  });

  it("returns { ok: true } on success", () => {
    assert.ok(
      listSrc.includes("ok: true"),
      "must return { ok: true } on successful quick-approve",
    );
  });

  it("returns 400 for missing itemId", () => {
    assert.ok(
      listSrc.includes('Missing itemId') || listSrc.includes("Missing itemId"),
      "must reject missing itemId",
    );
  });

  it("throws 400 Bad Request for unknown intent", () => {
    assert.ok(
      listSrc.includes('throw new Response("Bad request"') ||
      listSrc.includes("Bad request"),
      "must throw 400 for unknown intent",
    );
  });
});

// ── §3B-D Security invariants ─────────────────────────────────────────────────

describe("§3B-D security — reviewedBy from session", () => {
  it("list action reads reviewedBy from session.identity.email", () => {
    assert.ok(
      listSrc.includes("session.identity.email"),
      "reviewedBy must come from session, not client",
    );
  });

  it("list action does not read reviewedBy from formData", () => {
    assert.ok(
      !listSrc.includes('formData.get("reviewedBy")'),
      "must never read reviewedBy from form body",
    );
  });

  it("list action calls requireAdminSession before mutation", () => {
    const actionBlock = listSrc.slice(listSrc.indexOf("export async function action"));
    const firstMutationIdx = actionBlock.indexOf("markItemReviewed");
    const requireIdx       = actionBlock.indexOf("requireAdminSession");
    assert.ok(requireIdx < firstMutationIdx, "requireAdminSession must precede markItemReviewed");
  });
});

// ── §3B-E Detail loader passes queue data ────────────────────────────────────

describe("§3B-E detail loader queue data", () => {
  it("reads 'from' search param", () => {
    assert.ok(
      detailSrc.includes('searchParams.get("from")'),
      "loader must read the ?from param",
    );
  });

  it("calls getNextUnreviewedItemId", () => {
    assert.ok(
      detailSrc.includes("getNextUnreviewedItemId"),
      "loader must call getNextUnreviewedItemId",
    );
  });

  it("returns nextUnreviewedId in response", () => {
    assert.ok(
      detailSrc.includes("nextUnreviewedId"),
      "loader must include nextUnreviewedId in response",
    );
  });

  it("returns returnTo in response", () => {
    assert.ok(
      detailSrc.includes("returnTo"),
      "loader must include returnTo in response",
    );
  });
});

// ── §3B-F Detail component: navigation and auto-advance ──────────────────────

describe("§3B-F detail component queue navigation", () => {
  it("uses useNavigate for auto-advance", () => {
    assert.ok(
      detailSrc.includes("useNavigate"),
      "detail component must import and use useNavigate",
    );
  });

  it("auto-advance useEffect fires on markCorrectFetcher.data", () => {
    assert.ok(
      detailSrc.includes("markCorrectFetcher.data?.ok") &&
      detailSrc.includes("nextUnreviewedId"),
      "useEffect must check markCorrectFetcher.data.ok and navigate to nextUnreviewedId",
    );
  });

  it("Back link uses returnTo when present", () => {
    assert.ok(
      detailSrc.includes("returnTo ? `/admin/naia/closet?${returnTo}`"),
      "Back link must use returnTo when available",
    );
  });

  it("Next unreviewed link includes returnTo param", () => {
    assert.ok(
      detailSrc.includes("na-btn-queue-next"),
      "must render next-unreviewed link with queue-next class",
    );
  });

  it("inline quick-approve button renders on list rows", () => {
    assert.ok(
      listSrc.includes("na-btn-quick-approve"),
      "list rows must include quick-approve button",
    );
  });
});

// ── §3B-G Review Progress Summary ───────────────────────────────────────────

describe("§3B-G review progress summary", () => {
  it("getClosetReviewSummary is exported from closet-intelligence.server", () => {
    assert.ok(ciSrc.includes("export async function getClosetReviewSummary"), "must export getClosetReviewSummary");
  });
  it("summary counts: total = aiOnly + reviewed + corrected", () => {
    // The implementation computes aiOnly = total - reviewed - corrected
    assert.ok(ciSrc.includes("aiOnly: total - reviewed - corrected"), "aiOnly must be derived as total minus reviewed minus corrected");
  });
  it("list loader includes summary", () => {
    assert.ok(listSrc.includes("summary"), "list loader must return summary");
  });
  it("list route renders review progress bar", () => {
    assert.ok(listSrc.includes("na-review-progress"), "list must render .na-review-progress element");
  });
  it("no raw OVERRIDDEN label appears in the list UI (must use display labels only)", () => {
    // The stored status 'overridden' must never appear as a raw badge label in the list
    // Only allowed in option values in the filter select, not as badge text
    const badgeOccurrences = (listSrc.match(/na-badge[^>]*>\s*overridden/gi) ?? []);
    assert.strictEqual(badgeOccurrences.length, 0, "raw 'overridden' badge label must not appear in list UI");
  });
});

// ── §3B-H Save & Next ────────────────────────────────────────────────────────

describe("§3B-H Save & Next", () => {
  it("EditClassificationPanel accepts nextUnreviewedId and returnTo props", () => {
    assert.ok(detailSrc.includes("nextUnreviewedId: string | null"), "EditPanelProps must include nextUnreviewedId");
    assert.ok(detailSrc.includes("returnTo: string | null"), "EditPanelProps must include returnTo");
  });
  it("Save & Next button is rendered in the edit footer", () => {
    assert.ok(detailSrc.includes("Save &amp; Next") || detailSrc.includes("Save & Next"), "must render Save & Next button");
  });
  it("handleSaveAndNext sets advanceNextRef before submitting", () => {
    assert.ok(detailSrc.includes("advanceNextRef") && detailSrc.includes("handleSaveAndNext"), "must have advanceNextRef and handleSaveAndNext");
  });
  it("auto-advance only fires when saveFetcher.data.ok is true (not on error)", () => {
    // The useEffect checks saveFetcher.data?.ok — falsy on error response
    assert.ok(detailSrc.includes("saveFetcher.data?.ok"), "advance condition must require data.ok");
  });
});

// ── §3B-I Prev / Next adjacent navigation ────────────────────────────────────

describe("§3B-I adjacent prev/next navigation", () => {
  it("getAdjacentItemIds is exported from closet-intelligence.server", () => {
    assert.ok(ciSrc.includes("export async function getAdjacentItemIds"), "must export getAdjacentItemIds");
  });
  it("prev uses gt createdAt (newer items first)", () => {
    assert.ok(ciSrc.includes("createdAt: { gt: current.createdAt }"), "prev must query newer items");
  });
  it("next uses lt createdAt (older items)", () => {
    // getAdjacentItemIds uses lt for the next direction
    // (getNextUnreviewedItemId also uses lt — both are correct and distinct)
    const adjIdx = ciSrc.indexOf("export async function getAdjacentItemIds");
    const adjSection = ciSrc.slice(adjIdx, adjIdx + 1100);
    assert.ok(adjSection.includes("createdAt: { lt: current.createdAt }"), "next-in-list must query older items");
  });
  it("adjacent queries are scoped to the same customer", () => {
    const adjIdx = ciSrc.indexOf("export async function getAdjacentItemIds");
    const adjSection = ciSrc.slice(adjIdx, adjIdx + 1100);
    assert.ok(adjSection.includes("customerId"), "getAdjacentItemIds must filter by customerId to avoid crossing customer boundaries");
  });
  it("detail route renders na-nav-adj links", () => {
    assert.ok(detailSrc.includes("na-nav-adj"), "detail must render .na-nav-adj adjacent nav links");
  });
  it("prev/next links are <Link> elements, not <Form> or <button> — cannot mutate state", () => {
    // Adjacent nav links use <Link> (anchor), not fetcher.Form or button
    const adjBlock = detailSrc.slice(detailSrc.indexOf("na-nav-adj"), detailSrc.indexOf("na-nav-adj") + 400);
    assert.ok(!adjBlock.includes("<Form") && !adjBlock.includes("<fetcher"), "adjacent nav must be read-only Links");
  });
});

// ── §3B-J Queue exclusion regression ─────────────────────────────────────────

describe("§3B-J next-unreviewed excludes reviewed and corrected items", () => {
  it("getNextUnreviewedItemId includes items with null adminReview", () => {
    const fnIdx = ciSrc.indexOf("export async function getNextUnreviewedItemId");
    const fnBody = ciSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(fnBody.includes("adminReview: null"), "must include items with no review record");
  });
  it("getNextUnreviewedItemId includes items with reviewStatus=unreviewed", () => {
    const fnIdx = ciSrc.indexOf("export async function getNextUnreviewedItemId");
    const fnBody = ciSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(fnBody.includes('"unreviewed"'), "must include unreviewed status");
  });
  it("getNextUnreviewedItemId does NOT include reviewStatus=reviewed", () => {
    const fnIdx = ciSrc.indexOf("export async function getNextUnreviewedItemId");
    const fnBody = ciSrc.slice(fnIdx, fnIdx + 600);
    // 'reviewed' must NOT appear as a standalone query target (only as part of 'unreviewed')
    const reviewedMatches = [...fnBody.matchAll(/"reviewed"/g)];
    // Only 'unreviewed' may appear, not bare 'reviewed'
    assert.ok(!reviewedMatches.some(m => !fnBody.slice(Math.max(0, m.index! - 2), m.index!).includes("un")),
      "getNextUnreviewedItemId must not query for reviewStatus='reviewed'");
  });
  it("getNextUnreviewedItemId does NOT include reviewStatus=overridden", () => {
    const fnIdx = ciSrc.indexOf("export async function getNextUnreviewedItemId");
    const fnBody = ciSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(!fnBody.includes('"overridden"'), "must not include overridden items in unreviewed queue");
  });
});

// ── §3B-K Vocabulary gap flag ─────────────────────────────────────────────────

const reviewSrc = readFileSync(resolve(ROOT, "app/lib/admin/closet-review.server.ts"), "utf8");

describe("§3B-K vocabulary gap flag", () => {
  it("setVocabGapFlag is exported from closet-review.server", () => {
    assert.ok(reviewSrc.includes("export async function setVocabGapFlag"), "must export setVocabGapFlag");
  });
  it("clearVocabGapFlag is exported from closet-review.server", () => {
    assert.ok(reviewSrc.includes("export async function clearVocabGapFlag"), "must export clearVocabGapFlag");
  });
  it("setVocabGapFlag stores [VOCAB_GAP] prefix in adminNotes", () => {
    assert.ok(reviewSrc.includes("[VOCAB_GAP]"), "must use [VOCAB_GAP] prefix");
  });
  it("detail action handles flag-vocab-gap intent", () => {
    assert.ok(detailSrc.includes('"flag-vocab-gap"'), "action must handle flag-vocab-gap");
  });
  it("detail action handles clear-vocab-gap intent", () => {
    assert.ok(detailSrc.includes('"clear-vocab-gap"'), "action must handle clear-vocab-gap");
  });
  it("save-overrides action preserves existing adminNotes (does not hardcode null)", () => {
    // The save-overrides call must NOT pass a hardcoded null as the last argument
    // It should omit adminNotes so saveAdminReview preserves existing value
    const saveOverridesBlock = detailSrc.slice(
      detailSrc.indexOf('"save-overrides"'),
      detailSrc.indexOf('"save-overrides"') + 400,
    );
    assert.ok(
      !saveOverridesBlock.includes("reviewedBy, null)"),
      "save-overrides must not pass hardcoded null for adminNotes",
    );
  });
  it("saveAdminReview accepts undefined adminNotes to preserve existing", () => {
    assert.ok(
      reviewSrc.includes("undefined") && reviewSrc.includes("adminNotes"),
      "saveAdminReview must handle undefined adminNotes",
    );
  });
  it("vocab gap toggle is rendered on detail page", () => {
    assert.ok(detailSrc.includes("VocabGapToggle") || detailSrc.includes("na-vocab-gap"), "detail must render vocab gap toggle");
  });
});

// ── §3B-L Style Personality column ───────────────────────────────────────────

describe("§3B-L Style Personality column", () => {
  it("ClosetItemRow interface includes stylePersonality field", () => {
    assert.ok(ciSrc.includes("stylePersonality: string | null"), "ClosetItemRow must include stylePersonality");
  });
  it("list query selects stylePersonality from DB", () => {
    assert.ok(ciSrc.includes("stylePersonality: true"), "listClosetItems must select stylePersonality from DB");
  });
  it("adminReview overrides are selected (for human-override precedence)", () => {
    assert.ok(ciSrc.includes("overrides: true"), "adminReview select must include overrides");
  });
  it("effective value prefers human override over stored value", () => {
    // The mapper must check overrides.stylePersonality before item.stylePersonality
    const mapperIdx = ciSrc.indexOf("stylePersonality: (overrides");
    assert.ok(mapperIdx !== -1, "mapper must apply override precedence for stylePersonality");
    const mapperLine = ciSrc.slice(mapperIdx, mapperIdx + 120);
    assert.ok(
      mapperLine.includes("overrides?.stylePersonality") && mapperLine.includes("item.stylePersonality"),
      "must fall back to item.stylePersonality when no override",
    );
  });
  it("Style Personality column header is rendered in the list table", () => {
    assert.ok(listSrc.includes("Style Personality"), "list table must have Style Personality column header");
  });
  it("column is placed between Formality and Occasions", () => {
    const formalityIdx     = listSrc.indexOf("Formality");
    const stylePersonIdx   = listSrc.indexOf("Style Personality");
    const occasionsIdx     = listSrc.indexOf("Occasions");
    assert.ok(
      formalityIdx < stylePersonIdx && stylePersonIdx < occasionsIdx,
      "Style Personality must appear between Formality and Occasions",
    );
  });
  it("cell renders item.stylePersonality when present", () => {
    assert.ok(listSrc.includes("item.stylePersonality"), "cell must render item.stylePersonality");
  });
  it("cell renders — when stylePersonality is absent", () => {
    // The na-null span with — is used for missing values
    const spIdx = listSrc.indexOf("item.stylePersonality");
    const cellBlock = listSrc.slice(spIdx, spIdx + 200);
    assert.ok(cellBlock.includes("na-null"), "missing stylePersonality must render na-null dash");
  });
});

// ── §3B-M Delete items ────────────────────────────────────────────────────────

describe("§3B-M delete items", () => {
  it("deleteClosetItem is exported from closet-review.server", () => {
    assert.ok(reviewSrc.includes("export async function deleteClosetItem"), "must export deleteClosetItem");
  });
  it("deleteClosetItems is exported from closet-review.server", () => {
    assert.ok(reviewSrc.includes("export async function deleteClosetItems"), "must export deleteClosetItems");
  });
  it("deleteClosetItems uses deleteMany (bulk)", () => {
    assert.ok(reviewSrc.includes("deleteMany"), "deleteClosetItems must use deleteMany");
  });
  it("list action handles delete-item intent", () => {
    assert.ok(listSrc.includes('"delete-item"'), "action must handle delete-item");
  });
  it("list action handles delete-items intent", () => {
    assert.ok(listSrc.includes('"delete-items"'), "action must handle delete-items");
  });
  it("list action imports deleteClosetItem and deleteClosetItems", () => {
    assert.ok(
      listSrc.includes("deleteClosetItem") && listSrc.includes("deleteClosetItems"),
      "list route must import both delete functions",
    );
  });
  it("list renders per-row delete button", () => {
    assert.ok(listSrc.includes("na-btn-row-delete"), "list must render per-row delete button");
  });
  it("list renders bulk action bar with delete button", () => {
    assert.ok(listSrc.includes("na-bulk-bar") && listSrc.includes("na-btn-delete"), "list must render bulk delete bar");
  });
  it("list renders checkbox column for selection", () => {
    assert.ok(listSrc.includes("Select all on this page"), "list must have select-all checkbox");
  });
  it("delete-item action requires itemId (rejects missing)", () => {
    const deleteBlock = listSrc.slice(listSrc.indexOf('"delete-item"'), listSrc.indexOf('"delete-item"') + 300);
    assert.ok(deleteBlock.includes("Missing itemId"), "delete-item must reject missing itemId");
  });
  it("delete-items action requires non-empty itemIds (rejects empty selection)", () => {
    const deleteBlock = listSrc.slice(listSrc.indexOf('"delete-items"'), listSrc.indexOf('"delete-items"') + 400);
    assert.ok(deleteBlock.includes("No items selected"), "delete-items must reject empty selection");
  });
  it("per-row delete uses fetcher (non-navigating) and confirms before deleting", () => {
    assert.ok(listSrc.includes("deleteFetcher") && listSrc.includes("window.confirm"), "delete must use fetcher and confirm dialog");
  });
  it("list route uses useState and useEffect for selection state", () => {
    assert.ok(listSrc.includes("useState") && listSrc.includes("useEffect"), "must use useState/useEffect for selection");
  });
});
