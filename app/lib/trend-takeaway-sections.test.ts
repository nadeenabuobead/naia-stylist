// app/lib/trend-takeaway-sections.test.ts
//
// This file's real job is a compile-time one: TAKEAWAY_SECTION_KEYS is
// declared `as const satisfies readonly (keyof ShopperEdit)[]` in
// trend-takeaway-sections.ts, importing ShopperEdit from
// trend-evidence.server.ts via `import type` only. If that assertion did
// not actually hold against ShopperEdit's real field names, `npm run
// typecheck` would fail on that file — this test just confirms the runtime
// shape agrees, and that importing this module at runtime never pulls in
// trend-evidence.server.ts's runtime code (no DB/env access happens here).

import { describe, it, expect } from "vitest";
import {
  TAKEAWAY_SECTION_KEYS,
  isTakeawaySectionKey,
  type TakeawaySectionKey,
} from "./trend-takeaway-sections";

describe("trend-takeaway-sections", () => {
  it("has exactly the 11 ShopperEdit prose fields, type-checked against the real type", () => {
    expect(TAKEAWAY_SECTION_KEYS).toEqual([
      "yourVersion",
      "evidenceStyleDna",
      "evidencePassportSays",
      "evidenceReviews",
      "lowDataNotice",
      "yourBestRouteIn",
      "aLookToTry",
      "theBalanceToProtect",
      "worthInvestingStatement",
      "partToTake",
      "partToLeave",
    ]);
  });

  it("isTakeawaySectionKey accepts every listed key and rejects anything else", () => {
    for (const key of TAKEAWAY_SECTION_KEYS) {
      expect(isTakeawaySectionKey(key)).toBe(true);
    }
    expect(isTakeawaySectionKey("madeUpSection")).toBe(false);
    expect(isTakeawaySectionKey(123)).toBe(false);
  });

  it("the exported type is usable as a plain string union at the type level", () => {
    const sample: TakeawaySectionKey = "yourBestRouteIn";
    expect(TAKEAWAY_SECTION_KEYS).toContain(sample);
  });
});
