// app/routes/api.styleme-handoff.tsx
// StyleMe pre-selection handoff. Two callers, one mechanism:
//
//   source=nadine-piece   the NADINE storefront product page (Phase 4A4)
//   source=trend          a matched closet piece in a Trend Report (Step 6)
//
// POST-only: state-changing session writes must not be triggered by a GET.
// Origin-validated. No database writes beyond ownership verification, and no
// profile mutation.
//
// ── TREND CONTEXT IS PROVENANCE, NOT RANKING ────────────────────────────────
// The trend keys this sets are carried for display only. Nothing downstream
// reads them into computeStyleMeResult(); StyleMe's existing hierarchy stays
// authoritative. A trend explains why she arrived, not what she should wear.

import { redirect, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { LOCKED_CATALOGUE_HANDLES } from "~/lib/ai/naia-product-media";

const VALID_HANDLES = new Set<string>(LOCKED_CATALOGUE_HANDLES);
const STOREFRONT_ORIGIN = "https://naiabynadine.com";

/** Trend handoffs come from inside the app; product handoffs from the storefront. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === STOREFRONT_ORIGIN) return true;
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // Origin guard — rejects CSRF from any page other than the storefront or this app.
  // Browsers always set Origin on cross-origin form POSTs; null/missing is rejected.
  if (!originAllowed(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();

  // ── Trend → StyleMe ─────────────────────────────────────────────────────
  if (formData.get("source") === "trend") {
    const customer = await getCurrentNaiaCustomer(request);
    if (!customer) return redirect("/auth/shopify/login?return_to=%2Ftrends%2Fmy-edits");

    const closetItemId = String(formData.get("closetItemId") ?? "").trim();
    if (!closetItemId) return redirect("/style-me");

    // Ownership is verified server-side: a closet item id from another customer
    // must never become an anchor, whatever the form said.
    const owned = await prisma.closetItem.findFirst({
      where: { id: closetItemId, customerId: customer.id },
      select: { id: true },
    });
    if (!owned) return redirect("/style-me");

    const session = await getSession(request.headers.get("Cookie"));

    // The matched piece is the EXPLICIT anchor. resolveActionAnchor() is given a
    // concrete closetItemId, so autoSelectClosetAnchor() never runs and cannot
    // substitute a different garment.
    session.set("styleMeSource", "my-closet");
    session.set("styleMeAnchorMode", "manual");
    session.set("styleMeClosetAnchorId", owned.id);
    session.unset("styleMeNadineAnchorHandle");
    session.set("styleMeMode", "naia");

    // Provenance only.
    const str = (k: string, max: number) => {
      const v = formData.get(k);
      return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
    };
    const reportId = str("reportId", 64);
    const reportTitle = str("reportTitle", 160);
    const contentId = str("contentId", 64);
    const trendLabel = str("trendLabel", 160);
    if (reportId) session.set("styleMeTrendReportId", reportId);
    if (reportTitle) session.set("styleMeTrendReportTitle", reportTitle);
    if (contentId) session.set("styleMeTrendContentId", contentId);
    if (trendLabel) session.set("styleMeTrendLabel", trendLabel);

    return redirect("/style-me/state", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  // ── NADINE product → StyleMe (unchanged) ────────────────────────────────
  const handle = formData.get("handle") as string | null;

  // Reject unknown or missing handles — fail closed.
  // Server-side validation against LOCKED_CATALOGUE_HANDLES; browser-supplied value cannot
  // resolve to an arbitrary anchor — only the 11 verified NADINE handles are accepted.
  if (!handle || !VALID_HANDLES.has(handle)) {
    return redirect("/style-me/mood");
  }

  const session = await getSession(request.headers.get("Cookie"));

  // Pre-select source and anchor so source.tsx skips straight to anchor confirmation.
  session.set("styleMeSource", "naia-piece");
  session.set("styleMeNadineAnchorHandle", handle);
  // Clear stale closet anchor if any.
  session.unset("styleMeClosetAnchorId");
  // Mark as NADINE-website session: Closet + NADINE catalogue recommendations.
  session.set("styleMeMode", "nadine");
  // A product handoff carries no trend context.
  session.unset("styleMeTrendReportId");
  session.unset("styleMeTrendReportTitle");
  session.unset("styleMeTrendContentId");
  session.unset("styleMeTrendLabel");

  return redirect("/style-me/mood", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}
