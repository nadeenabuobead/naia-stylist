// app/lib/styleme/commerce-cta.test.ts
//
// A NADINE product must never be sold under the nAia label.
//
// nAia is the stylist; NADINE is the brand she is buying. The result footer said
// "Shop nAia" for every result that was not closet-led, including results whose hero IS a
// NADINE garment — so the one moment the customer is being asked to buy named the wrong
// party. These tests pin the brand decision, and the destination that goes with it.
//
// WHY A PURE MODULE RATHER THAN A RENDER TEST. The label depends on three independent
// signals that can disagree, and the combination space is what has to be safe — not one
// rendered example. result.tsx is a very large route with a deep server import graph, so a
// render test there would cover one row of a table that needs covering exhaustively. The
// render site is pinned separately (CC-E) so the literal cannot come back.
//
// THE THREE SIGNALS, AND WHY NONE OF THEM IS ENOUGH ALONE:
//
//   outcome === "nadine-recommendation"
//     Authoritative when present, but a result can carry a NADINE product under other
//     outcomes, and legacy rows predate parts of this vocabulary.
//
//   mode === "nadine"
//     The session's product context. OPTIONAL in StyleMeMetadata — suggestions persisted
//     before the field existed carry none, and history must keep rendering them. So a
//     mode-only rule would relabel every legacy NADINE result as nAia.
//
//   a purchasable item in the look
//     The ground truth for "this result contains a NADINE product", and the only signal
//     legacy rows still have. An item counts only when it is NOT something she already
//     owns (closetItemId) AND it has somewhere to go (productUrl).
//
// Any one of the three means NADINE. Only the absence of all three leaves the nAia label.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CTA_LABEL_NADINE,
  CTA_LABEL_NAIA,
  NADINE_STOREFRONT_URL,
  findNadineProductItem,
  isNadineCommerceContext,
  resolveCommerceCtaLabel,
  resolveCommerceCtaHref,
  type CommerceCtaInput,
} from "./commerce-cta.js";

const NADINE_TOP = {
  itemType: "TOP",
  closetItemId: null,
  productUrl: "https://naiabynadine.com/products/double-top",
};
const NADINE_SHOE = {
  itemType: "SHOES",
  closetItemId: null,
  productUrl: "https://naiabynadine.com/products/heeled-sandal",
};
const OWNED_TOP = { itemType: "TOP", closetItemId: "closet-1", productUrl: null };
const OWNED_BOTTOM = { itemType: "BOTTOM", closetItemId: "closet-2", productUrl: null };
// Guidance with no product behind it — the engine leaves a slot unfilled this way.
const GUIDANCE_SHOE = { itemType: "SHOES", closetItemId: null, productUrl: null };

// ── CC-A: a NADINE product can never be labelled nAia ─────────────────────

describe("CC-A — a NADINE product is never sold as nAia", () => {
  // The headline guarantee, stated over the whole combination space rather than one case.
  const nadineCases: Array<[string, CommerceCtaInput]> = [
    ["hero garment, mode recorded", { outcome: "nadine-recommendation", mode: "nadine", items: [NADINE_TOP, OWNED_BOTTOM] }],
    ["hero garment, legacy row with no mode", { outcome: "nadine-recommendation", items: [NADINE_TOP, OWNED_BOTTOM] }],
    ["hero garment, no outcome and no mode", { items: [NADINE_TOP] }],
    ["NADINE piece behind owned pieces", { items: [OWNED_TOP, OWNED_BOTTOM, NADINE_TOP] }],
    ["only a NADINE accessory", { items: [OWNED_TOP, OWNED_BOTTOM, NADINE_SHOE] }],
    ["mode=nadine with nothing purchasable yet", { mode: "nadine", items: [OWNED_TOP] }],
    ["mode=nadine, no items at all", { mode: "nadine", items: [] }],
    ["outcome alone, no items", { outcome: "nadine-recommendation", items: [] }],
  ];

  for (const [name, input] of nadineCases) {
    test(`CC-A.${nadineCases.findIndex((c) => c[0] === name) + 1} ${name} → ${CTA_LABEL_NADINE}`, () => {
      assert.equal(resolveCommerceCtaLabel(input), CTA_LABEL_NADINE);
      assert.notEqual(
        resolveCommerceCtaLabel(input),
        CTA_LABEL_NAIA,
        "a NADINE context must never render the nAia label",
      );
      assert.equal(isNadineCommerceContext(input), true);
    });
  }
});

// ── CC-B: the nAia label survives where it is correct ─────────────────────

describe("CC-B — a genuinely nAia-context result keeps its label", () => {
  test("CC-B.1 nothing purchasable, no mode, no outcome", () => {
    assert.equal(resolveCommerceCtaLabel({ items: [OWNED_TOP, OWNED_BOTTOM] }), CTA_LABEL_NAIA);
  });

  test("CC-B.2 naia mode with an all-owned look", () => {
    assert.equal(
      resolveCommerceCtaLabel({ mode: "naia", outcome: "closet-led", items: [OWNED_TOP, OWNED_BOTTOM] }),
      CTA_LABEL_NAIA,
    );
  });

  test("CC-B.3 no eligible product, nothing to buy", () => {
    assert.equal(
      resolveCommerceCtaLabel({ mode: "naia", outcome: "no-eligible-product", items: [] }),
      CTA_LABEL_NAIA,
    );
  });

  test("CC-B.4 an unfilled slot is not a product", () => {
    // closetItemId null but productUrl null too: guidance, not merchandise.
    assert.equal(resolveCommerceCtaLabel({ items: [OWNED_TOP, GUIDANCE_SHOE] }), CTA_LABEL_NAIA);
    assert.equal(findNadineProductItem([OWNED_TOP, GUIDANCE_SHOE]), null);
  });

  test("CC-B.5 missing and malformed input do not invent a brand", () => {
    assert.equal(resolveCommerceCtaLabel({}), CTA_LABEL_NAIA);
    assert.equal(resolveCommerceCtaLabel({ items: null }), CTA_LABEL_NAIA);
    assert.equal(resolveCommerceCtaLabel({ mode: null, outcome: null, items: undefined }), CTA_LABEL_NAIA);
    assert.equal(resolveCommerceCtaLabel({ mode: "NADINE" }), CTA_LABEL_NAIA, "mode is lowercase in the envelope");
  });
});

// ── CC-C: it links to the right product ───────────────────────────────────

describe("CC-C — the destination is the NADINE product, not the homepage", () => {
  test("CC-C.1 the purchasable garment's own URL is used", () => {
    assert.equal(
      resolveCommerceCtaHref({ outcome: "nadine-recommendation", items: [NADINE_TOP, OWNED_BOTTOM] }),
      NADINE_TOP.productUrl,
    );
  });

  test("CC-C.2 a NADINE piece behind owned pieces is still found", () => {
    // The regression this fixes: the old selector took the FIRST non-accessory item, so a
    // closet top ahead of the NADINE bottom sent her to the homepage instead of the piece.
    const href = resolveCommerceCtaHref({ items: [OWNED_TOP, NADINE_TOP] });
    assert.equal(href, NADINE_TOP.productUrl);
    assert.notEqual(href, NADINE_STOREFRONT_URL, "a known product must not degrade to the storefront");
  });

  test("CC-C.3 a garment is preferred over an accessory", () => {
    assert.equal(
      resolveCommerceCtaHref({ items: [NADINE_SHOE, NADINE_TOP] }),
      NADINE_TOP.productUrl,
      "the hero of the look is the garment, not the shoe",
    );
  });

  test("CC-C.4 an accessory is used when it is the only product", () => {
    assert.equal(resolveCommerceCtaHref({ items: [OWNED_TOP, NADINE_SHOE] }), NADINE_SHOE.productUrl);
  });

  test("CC-C.5 the storefront is the fallback when there is no product", () => {
    assert.equal(resolveCommerceCtaHref({ items: [OWNED_TOP, OWNED_BOTTOM] }), NADINE_STOREFRONT_URL);
    assert.equal(resolveCommerceCtaHref({}), NADINE_STOREFRONT_URL);
  });

  test("CC-C.6 an owned piece is never a commerce destination", () => {
    const owned = { itemType: "TOP", closetItemId: "closet-9", productUrl: "https://example.com/leaked" };
    assert.equal(findNadineProductItem([owned]), null, "a piece she already owns is not for sale");
    assert.equal(resolveCommerceCtaHref({ items: [owned] }), NADINE_STOREFRONT_URL);
  });
});

// ── CC-D: label and destination never disagree ────────────────────────────

describe("CC-D — label and destination agree", () => {
  test("CC-D.1 whenever a product URL is used, the label is NADINE", () => {
    const inputs: CommerceCtaInput[] = [
      { items: [NADINE_TOP] },
      { items: [OWNED_TOP, NADINE_TOP] },
      { items: [OWNED_TOP, NADINE_SHOE] },
      { outcome: "nadine-recommendation", mode: "nadine", items: [NADINE_TOP, OWNED_BOTTOM] },
    ];
    for (const input of inputs) {
      const href = resolveCommerceCtaHref(input);
      assert.notEqual(href, NADINE_STOREFRONT_URL);
      assert.equal(
        resolveCommerceCtaLabel(input),
        CTA_LABEL_NADINE,
        `linking to ${href} must not be labelled ${CTA_LABEL_NAIA}`,
      );
    }
  });

  test("CC-D.2 the nAia label never points at a specific product", () => {
    const inputs: CommerceCtaInput[] = [
      { items: [OWNED_TOP, OWNED_BOTTOM] },
      { mode: "naia", outcome: "no-eligible-product", items: [] },
      { items: [OWNED_TOP, GUIDANCE_SHOE] },
      {},
    ];
    for (const input of inputs) {
      if (resolveCommerceCtaLabel(input) === CTA_LABEL_NAIA) {
        assert.equal(resolveCommerceCtaHref(input), NADINE_STOREFRONT_URL);
      }
    }
  });
});

// ── CC-E: the render site cannot drift back to a literal ──────────────────

describe("CC-E — result.tsx renders the decision, not a hardcoded brand", () => {
  const result = (): string =>
    readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");

  test("CC-E.1 the footer CTA calls the resolvers", () => {
    const text = result();
    assert.ok(/resolveCommerceCtaLabel\(/.test(text), "the label must be derived, not typed");
    assert.ok(/resolveCommerceCtaHref\(/.test(text), "the destination must be derived too");
  });

  test("CC-E.2 no hardcoded brand label survives in the footer CTA", () => {
    const text = result();
    assert.equal(
      (text.match(/>Shop nAia</g) ?? []).length,
      0,
      "a literal label here is exactly how a NADINE product got sold as nAia",
    );
    assert.equal((text.match(/>Shop NADINE</g) ?? []).length, 0, "both literals, not just one");
  });

  test("CC-E.3 the closet-led suppression is unchanged", () => {
    assert.ok(
      result().includes('outcome !== "closet-led"'),
      "a closet-only look still offers nothing to buy",
    );
  });
});
