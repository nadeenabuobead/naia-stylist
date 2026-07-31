// app/routes/api.vto-event.tsx
// Phase 4B3 — Minimal authenticated server action for vto_initiated journey events.
// Called by TryOnPanel via useFetcher when a VTO result first becomes visible.
// Fire-and-forget on the client side — the action always responds with ok:true.
// Never calls FASHN. Never modifies any DB record. Never blocks the response.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { emitVtoInitiated, recordJourneyEvent } from "~/lib/ai/journey-events.server";

const VALID_ENTRY_POINTS = new Set<string>([
  "styleme-single-piece",
  "styleme-complete-look",
  "product-page",
  "closet-combination",
  "complete-look-preview",
]);

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return data({ ok: false }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return data({ ok: false }, { status: 400 });

  const { productHandle, sessionId, context } = body as Record<string, unknown>;
  if (typeof productHandle !== "string" || !productHandle) {
    return data({ ok: false }, { status: 400 });
  }

  const safeSessionId = typeof sessionId === "string" ? sessionId : "unknown";
  const rawContext = typeof context === "string" ? context : "styleme-single-piece";
  const safeEntryPoint = VALID_ENTRY_POINTS.has(rawContext)
    ? (rawContext as "styleme-single-piece" | "styleme-complete-look" | "product-page" | "closet-combination" | "complete-look-preview")
    : ("styleme-single-piece" as const);

  // Fire-and-forget — response is not blocked by event emission
  try {
    const ev = emitVtoInitiated({
      customerId: customer.id,
      sessionId: safeSessionId,
      entryPoint: safeEntryPoint,
      productHandle,
    });
    recordJourneyEvent(ev);
  } catch { /* never let event emission block the response */ }

  return data({ ok: true });
}
