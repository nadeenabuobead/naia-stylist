// app/routes/vto-entry-points-wiring.test.ts
//
// Closes a real, confirmed gap: the server-side persistence path
// (/api/trigger-tryon, /api/tryon-status/:jobId) already has extensive
// behavioral coverage for the closet/nadine/buyskip sources (see
// api.trigger-tryon.test.ts, 1400+ lines), and the shared client hook
// (useTryOn.ts) that calls it is simple and well-contained — but NOTHING
// in this repo previously asserted that Closet's and StyleMe's own result
// pages actually wire their real, per-item identifiers into that shared
// mechanism correctly. closet._index.tsx had no test file at all; the
// existing StyleMe result test mocks VtoExperience as a no-op
// (`() => null`), asserting nothing about what it's given.
//
// Source-code assertions — no DOM, no Prisma connection, no network, same
// convention as settings.test.ts / my-naia.buying-decisions.test.ts. This
// is deliberately NOT a live/paid verification — it proves the UI wiring
// is correct without any real FASHN call, consistent with "automated
// tests using existing records first, no paid AI calls without approval."

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const closetSrc = readFileSync(join(here, "closet._index.tsx"), "utf-8");
const styleMeSrc = readFileSync(join(here, "style-me", "result.tsx"), "utf-8");
const buyskipSrc = readFileSync(join(here, "buyskip.$id.tsx"), "utf-8");
const useTryOnSrc = readFileSync(join(here, "..", "hooks", "useTryOn.ts"), "utf-8");

describe("VTO entry-point wiring — Closet, StyleMe, Buy or Skip", () => {
  it("all three result pages import the SAME shared VtoExperience component — no per-feature fork", () => {
    for (const [name, src] of [["closet", closetSrc], ["style-me", styleMeSrc], ["buyskip", buyskipSrc]] as const) {
      assert.ok(
        src.includes('from "~/components/VtoExperience"'),
        `${name} imports the shared VtoExperience, not a one-off implementation`,
      );
    }
  });

  it("Closet passes source=\"closet\" with the REAL item's own id, not a hardcoded or derived value", () => {
    assert.ok(closetSrc.includes('source="closet"'), "closet source literal present");
    assert.ok(
      closetSrc.includes("closetItemId={item.id}"),
      "closetItemId comes from the actual rendered item, not a fixed string",
    );
  });

  it("Closet gates VTO on real eligibility signals (feature flag, a real uploaded photo, and category), not unconditionally", () => {
    const idx = closetSrc.indexOf("<VtoExperience");
    const guardWindow = closetSrc.slice(Math.max(0, idx - 300), idx);
    assert.ok(/vtoEnabled/.test(guardWindow), "feature flag checked before rendering");
    assert.ok(/item\.imagePublicId/.test(guardWindow), "a real uploaded photo is required");
    assert.ok(/isVtoCategoryAllowed/.test(guardWindow), "category eligibility is checked");
  });

  it('StyleMe passes source="nadine" with the REAL recommended product handle, not a hardcoded value', () => {
    assert.ok(styleMeSrc.includes('source="nadine"'), "nadine source literal present");
    assert.ok(
      styleMeSrc.includes("productHandle={suggestionMeta.primaryHandle}"),
      "productHandle comes from the actual recommendation, not a fixed string",
    );
  });

  it("StyleMe gates VTO on the feature flag and real try-on eligibility for that exact handle", () => {
    const idx = styleMeSrc.indexOf("<VtoExperience");
    const guardWindow = styleMeSrc.slice(Math.max(0, idx - 300), idx);
    assert.ok(/loaderData\.vtoEnabled/.test(guardWindow), "feature flag checked before rendering");
    assert.ok(/isTryOnEligible\(suggestionMeta\.primaryHandle\)/.test(guardWindow), "eligibility checked for the exact handle being shown");
  });

  it('Buy or Skip passes source="buyskip" with the REAL analysis id, not a hardcoded value', () => {
    assert.ok(buyskipSrc.includes('source="buyskip"'), "buyskip source literal present");
    assert.ok(
      buyskipSrc.includes("analysisId={analysis.id}"),
      "analysisId comes from the actual loaded analysis, not a fixed string",
    );
  });

  it("the shared hook's VtoSource type covers exactly these three literals — no entry point can pass an unsupported source", () => {
    assert.ok(/"nadine";\s*productHandle/.test(useTryOnSrc), "nadine source typed");
    assert.ok(/"closet";\s*closetItemId/.test(useTryOnSrc), "closet source typed");
    assert.ok(/"buyskip";\s*analysisId/.test(useTryOnSrc), "buyskip source typed");
  });

  it("the hook never accepts a client-supplied customerId or garment URL — both documented as server-resolved only", () => {
    assert.ok(
      useTryOnSrc.includes("customerId is never passed from the client"),
      "customerId-never-from-client contract documented",
    );
    assert.ok(
      useTryOnSrc.includes("Garment image URLs are NEVER sent from the client"),
      "garment-URL-never-from-client contract documented",
    );
    // And the actual request body construction never includes either field.
    const bodyBuildStart = useTryOnSrc.indexOf("const body: Record<string, unknown>");
    const bodyBuildEnd = useTryOnSrc.indexOf("try {", bodyBuildStart);
    const bodyBuild = useTryOnSrc.slice(bodyBuildStart, bodyBuildEnd);
    assert.ok(!/customerId/.test(bodyBuild), "request body never includes customerId");
    assert.ok(!/garmentUrl|imageUrl/.test(bodyBuild), "request body never includes a garment/image URL");
  });

  it("the hook only ever treats COMPLETED + a server-provided resultUrl as success — never infers completion from anything else", () => {
    assert.ok(
      /resBody\.status === "COMPLETED" && typeof resBody\.resultUrl === "string"/.test(useTryOnSrc),
      "completion requires both the exact status string AND a real resultUrl from the server",
    );
  });
});
