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

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const result = await buildCustomerExportZip(customer.id);

  if (!result.ok) {
    if (result.reason === "too_large") {
      return new Response(
        "Your export is larger than this automatic download can currently handle. " +
          "Please contact support and we will prepare a copy for you manually.",
        { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    return new Response("We couldn't find your account data to export.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

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
