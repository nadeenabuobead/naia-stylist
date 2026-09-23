// app/routes/api.trend-feedback.tsx
//
// "Not for me" — an explicit negative preference on one Trend Report content
// unit. POST only, fetcher-driven, so it never navigates away from the report.
//
// The client sends identifiers only: contentType, contentId, reportSlug. The
// report, the label and the facets are resolved server-side, so display copy is
// never trusted from the browser and the facets used for evidence are the
// authored ones.
//
// customerId comes from the session. Every query is scoped by it, so one
// customer can never read or alter another's feedback.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { setTrendFeedback } from "~/lib/trend-feedback.server";
import { resolveSaveTarget } from "~/lib/saved-items-resolve.server";
import { savedItemFacets } from "~/lib/saved-items.server";
import { isTrendContentType } from "~/lib/trend-content-identity";

export type TrendFeedbackResult =
  | { ok: true; notForMe: boolean }
  | { ok: false; error: "unauthenticated"; signInPath: string }
  | { ok: false; error: "bad_request" | "not_found" };

function readString(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/trends";
  return value;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ ok: false, error: "bad_request" } as TrendFeedbackResult, { status: 405 });
  }

  const form = await request.formData();
  const returnTo = safeReturnTo(readString(form, "returnTo"));

  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    // Answer the fetcher rather than redirecting it — a 302 on a background
    // POST is followed silently and the customer sees nothing happen.
    return data(
      {
        ok: false,
        error: "unauthenticated",
        signInPath: `/auth/shopify/login?return_to=${encodeURIComponent(returnTo)}`,
      } as TrendFeedbackResult,
      { status: 401 },
    );
  }

  const contentType = readString(form, "contentType");
  const contentId = readString(form, "contentId");
  const reportSlug = readString(form, "reportSlug");
  if (!contentType || !contentId || !isTrendContentType(contentType)) {
    return data({ ok: false, error: "bad_request" } as TrendFeedbackResult, { status: 400 });
  }

  // The intended STATE, not a toggle instruction: a double-submit lands on the
  // same state instead of flipping it back.
  const active = readString(form, "active") !== "false";

  // Resolving proves the content exists in that report and gives us its real
  // label and canonical report id.
  const resolved = await resolveSaveTarget({ contentType, contentId, reportSlug });
  if (!resolved.ok || !resolved.request.reportId) {
    return data({ ok: false, error: "not_found" } as TrendFeedbackResult, { status: 404 });
  }

  const result = await setTrendFeedback(
    customer.id,
    {
      reportId: resolved.request.reportId,
      contentType,
      contentId,
      contentLabel: resolved.request.label,
      facets: await savedItemFacets(reportSlug, contentType, contentId),
    },
    "NOT_FOR_ME",
    active,
  );

  return data({ ok: true, notForMe: result.active } as TrendFeedbackResult);
}

/** POST-only endpoint. */
export function loader() {
  return data({ ok: false, error: "bad_request" } as TrendFeedbackResult, { status: 405 });
}
