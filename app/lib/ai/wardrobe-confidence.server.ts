// app/lib/ai/wardrobe-confidence.server.ts
//
// How much of the wardrobe nAia is actually looking at.
//
// This lived inside the Wardrobe Intelligence route, which meant the only way
// to find out whether a Closet was substantially complete was to render a page.
// Buy or Skip needs it before it tells someone to spend money; StyleMe needs it
// before it says a look cannot be built; any future designer aggregate needs it
// to weight the evidence. So it belongs in the domain layer, with one reading
// shared by every consumer rather than a copy per feature.

import prisma from "~/db.server";
import type { ClosetConfidence } from "~/lib/ai/wardrobe-page";

export type { ClosetConfidence };

/** The two answers a customer can give, plus the state before she has. */
export const CLOSET_COMPLETENESS_ANSWERS = ["mostly", "still-adding"] as const;
export type ClosetCompletenessAnswer = (typeof CLOSET_COMPLETENESS_ANSWERS)[number];

export function isClosetCompletenessAnswer(value: unknown): value is ClosetCompletenessAnswer {
  return typeof value === "string"
    && (CLOSET_COMPLETENESS_ANSWERS as readonly string[]).includes(value);
}

/**
 * Reads the stored answer.
 *
 * Guarded: the column arrives with the Wardrobe Intelligence migration, and an
 * un-migrated database degrades to "not answered yet" — a state every consumer
 * already has to handle honestly — rather than throwing.
 */
export async function readClosetConfidence(customerId: string): Promise<ClosetConfidence> {
  try {
    const row = await (prisma as unknown as {
      onboardingProfile: { findUnique(a: unknown): Promise<{ closetCompleteness: string | null } | null> };
    }).onboardingProfile.findUnique({
      where: { customerId },
      select: { closetCompleteness: true },
    });
    const value = row?.closetCompleteness;
    return isClosetCompletenessAnswer(value) ? value : "unknown";
  } catch {
    return "unknown";
  }
}

/** Records an answer. Returns false when the value is not one of the two. */
export async function recordClosetConfidence(input: {
  customerId: string;
  answer: unknown;
}): Promise<boolean> {
  if (!isClosetCompletenessAnswer(input.answer)) return false;
  await prisma.onboardingProfile.updateMany({
    where: { customerId: input.customerId },
    data: { closetCompleteness: input.answer, closetCompletenessAt: new Date() },
  });
  return true;
}
