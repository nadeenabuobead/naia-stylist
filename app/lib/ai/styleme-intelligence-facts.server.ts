// app/lib/ai/styleme-intelligence-facts.server.ts
//
// Shared Customer Intelligence — Phase 5 architecture correction.
//
// StyleMe source facts that are genuinely independent of Wardrobe
// Intelligence, extracted from wardrobe-intelligence.server.ts so neither
// WI nor the Shared Customer Intelligence resolver has to import one
// through the other. One canonical loader, not two copies — WI imports
// loadRawOutcomeFactsForEvidence from here now, same as the resolver does.
//
// loadRawOutcomeFactsForEvidence qualified for this move because its
// entire dependency chain (wardrobe-feedback-evidence.ts ->
// outfit-formula-integrity.ts) has zero WI-vocabulary dependency — it is a
// plain StyleMeOutcome query with no register classification or any other
// WI-specific transformation.
//
// loadStyleMeDemandFacts (the sibling StyleMe-demand loader) deliberately
// stayed in wardrobe-intelligence.server.ts — see that file's comment on
// it for why: its own output shape (RawStyleMeDemandFact.register) is
// genuinely computed via styleMeSessionRegister()/RegisterId, both owned
// by wardrobe-needs.ts. Moving it here would either still import that WI
// vocabulary (no real decoupling) or require relocating RegisterId itself
// — a larger, riskier change than this phase's scope.

import prisma from "~/db.server";
import type { RawOutcomeFact } from "~/lib/ai/wardrobe-feedback-evidence";

/**
 * Raw StyleMe-feedback facts for the V1 evidence layer — deliberately NOT
 * the same shape as wardrobe-intelligence.server.ts's own loadOutcomes().
 * That function drops a null closetItemId immediately, which is safe for
 * its own purpose (look-level/register-level tallies) but would silently
 * reconstruct a partial historical formula if reused here. This loader
 * keeps every item's closetItemId/itemType/shopifyProductId intact so
 * wardrobe-feedback-evidence.ts can apply its own formula-integrity rule
 * and exclude what it cannot verify.
 */
export async function loadRawOutcomeFactsForEvidence(customerId: string): Promise<RawOutcomeFact[]> {
  const db = prisma as unknown as {
    styleMeOutcome: {
      findMany: (args: unknown) => Promise<Array<{
        id: string;
        suggestionId: string;
        outcomeStatus: string;
        changeTypes: string[];
        submittedAt: Date;
        suggestion: {
          items: Array<{ closetItemId: string | null; itemType: string; shopifyProductId: string | null }>;
        } | null;
      }>>;
    };
  };

  const rows = await db.styleMeOutcome.findMany({
    where: { customerId },
    select: {
      id: true,
      suggestionId: true,
      outcomeStatus: true,
      changeTypes: true,
      submittedAt: true,
      suggestion: {
        select: {
          items: { select: { closetItemId: true, itemType: true, shopifyProductId: true } },
        },
      },
    },
  });

  const VALID = new Set(["wore-it", "changed-something", "didnt-wear-it"]);
  return rows
    .filter((row) => VALID.has(row.outcomeStatus))
    .map((row) => ({
      outcomeId: row.id,
      suggestionId: row.suggestionId,
      outcomeStatus: row.outcomeStatus as RawOutcomeFact["outcomeStatus"],
      changeTypes: row.changeTypes,
      submittedAt: row.submittedAt,
      items: row.suggestion?.items ?? [],
    }));
}
