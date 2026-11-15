// app/routes/api.export-zip.ts
//
// GET-only download endpoint for the full data export (JSON + actual
// retained images, zipped) — a real browser navigation, not a fetcher, so
// Content-Disposition: attachment triggers a native save-file dialog
// instead of being intercepted as a fetch response. Auth works exactly
// like every other customer route: requireCurrentNaiaCustomer(request)
// resolves the customer from the session, never from anything in the URL,
// so this can only ever produce the caller's own export.

import type { LoaderFunctionArgs } from "react-router";
import { Readable } from "node:stream";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { buildCustomerExportZip } from "~/lib/customer-export-zip.server";
import { buildLargeCustomerExportZip, buildExportJobDownloadUrl } from "~/lib/customer-export-zip-large.server";
import { checkRateLimit, rateLimitResponse } from "~/lib/api-rate-limit.server";
import { recordExportAudit } from "~/lib/export-audit.server";

// Shadow mode first, matching this codebase's own established rollout
// discipline for every rate limit introduced so far (api.cloudinary-signature.jsx) —
// never jump straight to blocking real customers on a brand-new limit.
// 5/hour is deliberately tight: a full data export (and especially the
// >300-image path below) is meaningfully more expensive per call than a
// Cloudinary signature, which already uses 20/minute.
const EXPORT_RATE_LIMIT = {
  routeKey: "export-zip",
  limit: 5,
  windowSeconds: 3600,
  mode: "shadow" as const,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);

  const rl = await checkRateLimit(customer.id, EXPORT_RATE_LIMIT);
  if (!rl.allowed) {
    recordExportAudit(customer.id, "failed", { reason: "rate_limited" });
    return rateLimitResponse(rl);
  }

  recordExportAudit(customer.id, "requested");

  const result = await buildCustomerExportZip(customer.id);

  if (!result.ok) {
    if (result.reason === "too_large") {
      const large = await buildLargeCustomerExportZip(customer.id, result.imageCount);
      if (!large.ok) {
        recordExportAudit(customer.id, "failed", { reason: "large_export_build_failed", imageCount: result.imageCount });
        return new Response(
          "Your export could not be prepared right now. Please try again shortly, or contact support if this continues.",
          { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      }
      const download = await buildExportJobDownloadUrl(large.jobId, customer.id);
      if (!download.ok) {
        // Built successfully but the immediate link couldn't be signed (e.g.
        // Cloudinary config unavailable) — the job is still COMPLETED and
        // retrievable; a customer retry (or the dedicated download route
        // directly) will succeed once that's resolved. Never silently lose
        // the already-uploaded archive.
        recordExportAudit(customer.id, "failed", { reason: "large_export_link_unavailable", imageCount: result.imageCount });
        return new Response(
          "Your export is ready but the download link could not be generated. Please try again shortly.",
          { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      }
      recordExportAudit(customer.id, "completed", { large: true, imageCount: result.imageCount });
      return new Response(null, {
        status: 302,
        headers: { Location: download.downloadUrl, "Cache-Control": "no-store" },
      });
    }
    recordExportAudit(customer.id, "failed", { reason: "not_found" });
    return new Response("We couldn't find your account data to export.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  recordExportAudit(customer.id, "completed");

  const webStream = Readable.toWeb(result.stream) as unknown as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
