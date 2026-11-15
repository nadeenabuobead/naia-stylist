// app/routes/api.export-zip-download.$jobId.ts
//
// Re-access route for an already-built large export (see
// customer-export-zip-large.server.ts) — lets a customer retry after a
// failed or expired download link without re-triggering the expensive
// rebuild. Session-authenticated exactly like every other customer route;
// the job is looked up scoped to (jobId, customer.id) together, so a
// mismatched jobId or a jobId belonging to a different customer is
// indistinguishable from "not found" — never a cross-customer leak.

import type { LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { buildExportJobDownloadUrl } from "~/lib/customer-export-zip-large.server";
import { recordExportAudit } from "~/lib/export-audit.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const jobId = params.jobId;
  if (!jobId) {
    return new Response("Not found", { status: 404 });
  }

  const result = await buildExportJobDownloadUrl(jobId, customer.id);

  if (!result.ok) {
    recordExportAudit(customer.id, "failed", { reason: `large_export_redownload_${result.reason}` });
    if (result.reason === "not_found") {
      return new Response("We couldn't find that export.", { status: 404 });
    }
    if (result.reason === "expired") {
      return new Response(
        "This export has expired. Please request a new export.",
        { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    return new Response(
      "This export isn't ready yet. Please try again shortly.",
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  recordExportAudit(customer.id, "completed", { reason: "large_export_redownload" });
  return new Response(null, {
    status: 302,
    headers: { Location: result.downloadUrl, "Cache-Control": "no-store" },
  });
}
