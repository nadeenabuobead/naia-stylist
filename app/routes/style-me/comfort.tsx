// app/routes/style-me/comfort.tsx
// COMPATIBILITY REDIRECT — retired legacy questionnaire step 3.
//
// The canonical StyleMe questionnaire is Rev 3: State → Intention → Fit/Comfort
// → Occasion. This route survives only so stale links, browser history and
// half-finished legacy sessions are not stranded on a 404.
//
// MIGRATION: a session holding legacy answers (styleMeMood / styleMeFeelings)
// and no styleMeState restarts at State with those answers dropped. We do NOT
// map old emotional IDs onto the 12 intention IDs — no approved mapping exists,
// and inventing one would silently change what the customer said. Re-asking is
// the honest option. Occasion, formality, source, mode and any NADINE handoff
// anchor are vocabulary-compatible and are preserved across the transition.

import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import {
  CANONICAL_STYLEME_ENTRY,
  clearLegacyQuestionnaireKeys,
  hasStrandedLegacySession,
} from "~/lib/styleme/handoff";

async function toCanonicalEntry(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  if (!hasStrandedLegacySession(session)) {
    return redirect(CANONICAL_STYLEME_ENTRY);
  }
  clearLegacyQuestionnaireKeys(session);
  return redirect(CANONICAL_STYLEME_ENTRY, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return toCanonicalEntry(request);
}

// A stale form POST from a cached legacy page must not 405 — send it onward too.
export async function action({ request }: ActionFunctionArgs) {
  return toCanonicalEntry(request);
}
