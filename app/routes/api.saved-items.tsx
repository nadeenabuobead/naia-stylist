// app/routes/api.saved-items.tsx
//
// Save / unsave from anywhere in nAia. POST only, fetcher-driven, so a save
// never navigates the customer away from what they were reading.
//
// The client sends identifiers only — contentType, contentId, reportSlug. Every
// label, sublabel and provenance string is resolved server-side from the report
// (see saved-items-resolve.server.ts), so display copy is never trusted from the
// browser and the snapshot always matches what the report actually says.
//
// customerId comes from the session and nowhere else. A refKey belonging to
// another customer matches nothing, because every query is scoped by customerId.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { saveItem, unsaveItem } from "~/lib/saved-items.server";
import { resolveSaveTarget, type SaveTargetRef } from "~/lib/saved-items-resolve.server";
import { isTrendContentType } from "~/lib/trend-content-identity";

export type SavedItemActionResult =
  | { ok: true; saved: boolean; refKey: string }
  | { ok: false; error: "unauthenticated"; signInPath: string }
  | { ok: false; error: "bad_request" | "not_found" | "unsupported" };

function readString(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Only same-origin in-app paths are echoed back into a sign-in redirect. */
function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/trends";
  return value;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ ok: false, error: "bad_request" } as SavedItemActionResult, { status: 405 });
  }

  const form = await request.formData();
  const intent = readString(form, "intent");
  const returnTo = safeReturnTo(readString(form, "returnTo"));

  // Not signed in: answer the fetcher rather than redirecting it. A 302 on a
  // background POST would be followed silently and the customer would see
  // nothing happen. The control renders a sign-in link instead.
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return data(
      {
        ok: false,
        error: "unauthenticated",
        signInPath: `/auth/shopify/login?return_to=${encodeURIComponent(returnTo)}`,
      } as SavedItemActionResult,
      { status: 401 },
    );
  }

  // ── Unsave ────────────────────────────────────────────────────────────────
  if (intent === "unsave") {
    const refKey = readString(form, "refKey");
    if (!refKey) {
      return data({ ok: false, error: "bad_request" } as SavedItemActionResult, { status: 400 });
    }
    // deleteMany scoped by customerId — another customer's refKey matches nothing.
    await unsaveItem(customer.id, refKey);
    return data({ ok: true, saved: false, refKey } as SavedItemActionResult);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  if (intent === "save") {
    const contentType = readString(form, "contentType");
    const contentId = readString(form, "contentId");
    if (!contentType || !contentId || !isTrendContentType(contentType)) {
      return data({ ok: false, error: "bad_request" } as SavedItemActionResult, { status: 400 });
    }

    const ref: SaveTargetRef = {
      contentType,
      contentId,
      reportSlug: readString(form, "reportSlug"),
      sourceContentId: readString(form, "sourceContentId"),
    };

    // Only the personalised edit knows its own generated wording, so the route
    // that rendered it passes the sentence through for the snapshot.
    const takeawayText = contentType === "TAKEAWAY" ? readString(form, "takeawayText") : null;

    const resolved = await resolveSaveTarget(ref, { takeawayText });
    if (!resolved.ok) {
      const status = resolved.reason === "unsupported" ? 400 : 404;
      return data(
        { ok: false, error: resolved.reason === "unsupported" ? "unsupported" : "not_found" } as SavedItemActionResult,
        { status },
      );
    }

    // Idempotent: a repeat save is a no-op that still reports saved:true, so the
    // control settles into the same state either way.
    const result = await saveItem(customer.id, resolved.request);
    return data({ ok: true, saved: true, refKey: result.refKey } as SavedItemActionResult);
  }

  return data({ ok: false, error: "bad_request" } as SavedItemActionResult, { status: 400 });
}

/** POST-only endpoint — a GET is a mistake, not a page. */
export function loader() {
  return data({ ok: false, error: "bad_request" } as SavedItemActionResult, { status: 405 });
}
