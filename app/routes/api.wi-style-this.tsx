// app/routes/api.wi-style-this.tsx
// Wardrobe Intelligence → StyleMe handoff.
// Called when a customer clicks "Style this in StyleMe" on a rediscovered
// Closet piece, or "Style this look in StyleMe" on a multi-garment WI
// combination, on /closet/intelligence.
// POST-only: state-changing session writes must not be triggered by GET requests.
// Same-origin (the WI page lives inside this app) — no Origin check needed, unlike
// the cross-origin NADINE handoff in api.styleme-handoff.tsx.
// Ownership is re-verified server-side via resolveClosetAnchor for EVERY submitted
// id — the browser-supplied closetItemId values are never trusted on their own.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession, STYLEME_SESSION_KEYS } from "~/lib/session.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import type { ClosetAnchorInput } from "~/lib/ai/styleme-recommendation.types";

// Pure helpers, extracted so the submission-shape logic (dedup, same-slot conflict) is
// independently unit-testable without a database — resolveClosetAnchor's ownership check is
// the only DB-dependent step in this action and stays integration-only, per this codebase's
// existing convention (see wi-handoff-fresh-session.test.ts).

/** Dedupe while preserving first-seen order; drops non-string/empty values. */
export function dedupeGarmentIds(raw: FormDataEntryValue[]): string[] {
  const strings = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  return [...new Set(strings)];
}

/**
 * The first clothing slot claimed by more than one of the given items, or null when every
 * item occupies a distinct slot. Category-level only — sufficient to catch a malformed or
 * adversarial submission (e.g. a forged duplicate id resolving to two different rows that
 * both land in "top"); not the fuller admin-override-aware slot resolution the engine itself
 * uses once an occasion is known.
 */
export function findConflictingSlot(
  items: Array<{ category: string; subcategory?: string | null }>,
): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    const slot = closetItemToSlot(item.category, item.subcategory);
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  for (const [slot, count] of counts) {
    if (count > 1) return slot;
  }
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return redirect("/auth/shopify/login");
  }

  const formData = await request.formData();
  // getAll, not get: a multi-garment WI combination submits one hidden input per
  // garment, all named closetItemId. A single-piece "Style this in StyleMe" CTA
  // still submits exactly one — that path is byte-identical to before.
  // Dedupe while preserving first-seen order — a combination should never be
  // able to submit the same garment twice and have it silently become its own
  // "companion". See dedupeGarmentIds' own unit tests for the direct proof.
  const closetItemIds = dedupeGarmentIds(formData.getAll("closetItemId"));

  // Every early exit redirects back to the WI page with a reason code rather than
  // a bare, unexplained bounce — "fail closed" must not mean "fail silent". The WI
  // page is free to surface wiStyleError as a message (or ignore it, today); either
  // way the response is honest and independently testable, never a disguised no-op.
  const fail = (reason: string) => redirect(`/closet/intelligence?wiStyleError=${reason}`);

  if (closetItemIds.length === 0) {
    return fail("no-selection");
  }

  // Resolve + verify ownership for EVERY id, same check the single-piece path has
  // always used. Fail closed on the WHOLE set if even one id doesn't resolve —
  // resolveClosetAnchor collapses "doesn't exist" and "not owned by this customer"
  // into the same null (no ownership-leak signal), and a partial multi-garment
  // handoff (silently dropping just the bad id) would be exactly the kind of
  // silent garment loss this feature exists to eliminate.
  //
  // Run in parallel, not a sequential loop (2026-10-24): each call is one
  // independent, read-only DB lookup with no shared state between garments —
  // a 4-garment WI combination was paying for 4 serialized round-trips to the
  // database before this redirect could even start, which is the actual
  // "Complete This Look feels slow" backend delay, not anything in the
  // browser. Promise.all preserves input order in its result array, so
  // resolvedItems[0] is still reliably the anchor below.
  const resolutions = await Promise.all(
    closetItemIds.map((id) => resolveClosetAnchor(naiaCustomer.id, id)),
  );
  if (resolutions.some((r) => r === null)) {
    return fail("invalid-garment");
  }
  const resolvedItems = resolutions as ClosetAnchorInput[];

  // Reject two garments that would claim the same core clothing slot (e.g. two
  // tops) — an "incompatible category" combination that must never silently let
  // one piece overwrite the other's slot downstream. Honest response, not a
  // silent pick of one garment over the other: the whole handoff fails with a
  // distinguishable reason. See findConflictingSlot's own unit tests.
  if (findConflictingSlot(resolvedItems) !== null) {
    return fail("slot-conflict");
  }

  const [resolved, ...companions] = resolvedItems;

  // Pre-select the anchor exactly as a manual pick would, on the existing
  // session cookie — the engine never knows this came from Wardrobe
  // Intelligence rather than the closet picker. Mirrors api.styleme-handoff.tsx's
  // session-priming shape, minus the cross-origin check (this is same-origin).
  const session = await getSession(request.headers.get("Cookie"));

  // A fresh Today questionnaire. Clicking a garment in Wardrobe Intelligence starts a new
  // session, so every prior answer goes first — otherwise she arrives at question one with
  // last session's answers already selected. QA hit exactly this: an old intention
  // ("HELP ME FEEL SHARPER") was pre-selected on entry.
  //
  // Driven off STYLEME_SESSION_KEYS rather than a hand-written list, for the reason that
  // registry documents about itself: a key missing from it silently survives into the next
  // questionnaire. The two NADINE doorways clear their own explicit lists; this one cannot
  // drift from the registry, and a key added there is covered here automatically.
  //
  // Only styleMe* keys are in that registry, so authentication and Style Passport data are
  // untouched — the customer stays signed in and her profile is unaffected.
  //
  // ORDER MATTERS: clear first, then set the anchor. The reverse would discard the very
  // garment she clicked.
  for (const key of STYLEME_SESSION_KEYS) {
    session.unset(key);
  }

  session.set("styleMeSource", "my-closet");
  session.set("styleMeMode", "naia");
  session.set("styleMeClosetAnchorId", resolved.id);
  // She tapped this exact garment in Wardrobe Intelligence, so the anchor is MANUAL:
  // New Look may vary the outfit around it but must never move it. Stated rather than
  // left to default — an "AUTO" left in the cookie by an earlier session would otherwise
  // survive and let the reroll replace a piece she explicitly chose.
  session.set("styleMeAnchorProvenance", "MANUAL");
  session.set("styleMeAnchorLocked", "1");
  // Only set for a genuine multi-garment combination — a single-piece handoff never
  // writes this key at all, so it stays absent/undefined for that path exactly as
  // before this feature existed.
  if (companions.length > 0) {
    session.set("styleMeClosetCompanionIds", JSON.stringify(companions.map((c) => c.id)));
  }

  return redirect("/style-me/state", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
