// app/routes/api.styleme-outcome.tsx
// Style Memory V1 — API route for StyleMe outcome capture (UPSERT).
//
// POST /api/styleme-outcome
//   Body: { suggestionId, outcomeStatus, changeTypes, otherChangeNote, goalOutcome, selectedDirection }
//   Returns: { ok: true, outcome: StyleMeOutcomeSummary } | { error: string }
//
// GET /api/styleme-outcome?suggestionId=...
//   Returns: { outcome: StyleMeOutcomeSummary | null }
//
// Security:
//   - Requires authenticated NaiaCustomer
//   - Ownership verified: suggestion.session.customerId === customer.id
//   - sessionId derived server-side from OutfitSuggestion.sessionId — never from client
//   - selectedDirection validated against saved resultDirections for the suggestion
//   - No OnboardingProfile, dressingPreferences, or garmentRelationships are touched

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { prisma } from "~/lib/prisma.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { parseSuggestionMetadata } from "~/lib/ai/styleme-result.types";
import {
  validateOutcomeInput,
  validateDirectionAgainstMetadata,
} from "~/lib/ai/outcome-contract";
import {
  upsertOutcome,
  loadOutcomeForSuggestion,
} from "~/lib/ai/outcome-persistence.server";

// ── GET — load existing outcome ───────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const suggestionId = url.searchParams.get("suggestionId");
  if (!suggestionId) return data({ error: "suggestionId required" }, { status: 400 });

  try {
    const outcome = await loadOutcomeForSuggestion(suggestionId, customer.id);
    return data({ outcome });
  } catch {
    return data({ error: "failed-to-load" }, { status: 500 });
  }
}

// ── POST — UPSERT outcome ─────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return data({ error: "invalid-body" }, { status: 400 });
  }

  const { suggestionId } = body as Record<string, unknown>;
  if (typeof suggestionId !== "string" || !suggestionId) {
    return data({ error: "suggestionId required" }, { status: 400 });
  }

  // ── Ownership verification — load OutfitSuggestion with session ───────────
  // Never trust client-provided sessionId.
  // Verify the suggestion belongs to this authenticated customer via the session chain.

  let suggestion: Awaited<ReturnType<typeof prisma.outfitSuggestion.findUnique>>;
  try {
    suggestion = await prisma.outfitSuggestion.findUnique({
      where: { id: suggestionId },
      include: { session: true },
    });
  } catch {
    return data({ error: "failed-to-load-suggestion" }, { status: 500 });
  }

  if (!suggestion) {
    return data({ error: "not-found" }, { status: 404 });
  }
  if (suggestion.session.customerId !== customer.id) {
    // Uniform 404 — do not reveal whether the suggestion exists
    return data({ error: "not-found" }, { status: 404 });
  }

  // sessionId derived from the suggestion's session — never from request body
  const sessionId = suggestion.sessionId;

  // ── Validate outcome input ─────────────────────────────────────────────────

  const validation = validateOutcomeInput(body as Record<string, unknown>);
  if (!validation.ok) {
    return data({ error: validation.error }, { status: validation.status });
  }
  const { normalized } = validation;

  // ── Validate selectedDirection against saved metadata ──────────────────────
  // Parse the suggestion's moodDescription to get the actual stored resultDirections.
  // This prevents forged or stale direction references.

  const meta = parseSuggestionMetadata(suggestion.moodDescription);
  const directionError = validateDirectionAgainstMetadata(
    normalized.selectedDirection,
    meta?.resultDirections ?? null,
  );
  if (directionError) {
    return data({ error: directionError }, { status: 400 });
  }

  // ── UPSERT ────────────────────────────────────────────────────────────────

  try {
    const record = await upsertOutcome(
      customer.id,
      suggestionId,
      sessionId,
      normalized,
    );
    return data({
      ok: true,
      outcome: {
        outcomeStatus:    record.outcomeStatus,
        changeTypes:      record.changeTypes,
        otherChangeNote:  record.otherChangeNote,
        goalOutcome:      record.goalOutcome,
        selectedDirection: record.selectedDirection,
        whatWorked:        record.whatWorked,
        whatFeltOff:       record.whatFeltOff,
        didntWearReasons:  record.didntWearReasons,
        reasonOtherNote:   record.reasonOtherNote,
      },
    }, { status: 200 });
  } catch {
    return data({ error: "failed-to-save" }, { status: 500 });
  }
}
