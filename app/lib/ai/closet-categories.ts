// app/lib/ai/closet-categories.ts
//
// The runtime list of ClosetCategory values.
//
// Prisma is the authority for this vocabulary, but `@prisma/client` cannot be
// imported for its VALUES into a module that also runs in the browser bundle.
// So the list lives here once, and the two assertions below make drift a BUILD
// ERROR rather than a silent mismatch: adding a category to schema.prisma
// without adding it here fails to compile, and vice versa.
//
// The `import type` is erased at build time — no runtime Prisma dependency.

import type { ClosetCategory } from "@prisma/client";

export const CLOSET_CATEGORY_VALUES = [
  "TOPS",
  "BOTTOMS",
  "DRESSES",
  "OUTERWEAR",
  "SHOES",
  "BAGS",
  "ACCESSORIES",
  "JEWELRY",
  "ACTIVEWEAR",
  "SWIMWEAR",
  "LOUNGEWEAR",
  "OTHER",
] as const;

export type ClosetCategoryValue = (typeof CLOSET_CATEGORY_VALUES)[number];

// ── Drift guards ──────────────────────────────────────────────────────────────
// Both directions must hold. If either fails, the vocabularies have diverged.

type MissingFromList = Exclude<ClosetCategory, ClosetCategoryValue>;
type ExtraInList = Exclude<ClosetCategoryValue, ClosetCategory>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _noneMissing: MissingFromList extends never ? true : never = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _noneExtra: ExtraInList extends never ? true : never = true;

export const CLOSET_CATEGORY_SET: ReadonlySet<string> = new Set(CLOSET_CATEGORY_VALUES);
