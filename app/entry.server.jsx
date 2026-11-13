import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { captureError } from "./lib/error-tracking.server";
import { ensureFrameAncestorsDirective } from "./lib/content-security-policy.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  // Shopify's own addDocumentResponseHeaders() (called above) only sets a
  // real Content-Security-Policy: frame-ancestors header when the request
  // carries a `shop` query param -- i.e. Shopify-embedded-admin routes
  // (/app/*), confirmed by reading @shopify/shopify-app-react-router's own
  // add-response-headers.js. Every customer-facing route (trend reports,
  // my-naia, style-me, closet, settings, ...) never carries that param, so
  // without this fallback those routes get no real frame-ancestors
  // protection at all -- the <meta> tag that used to declare this value in
  // root.jsx's <head> is spec-defined to be ignored for frame-ancestors
  // (meta-delivered CSP cannot carry it; the framing decision is already
  // made by the time the HTML is parsed), so it was never actually
  // enforced.
  //
  // ensureFrameAncestorsDirective checks for the frame-ancestors
  // DIRECTIVE specifically, not just whether a Content-Security-Policy
  // header exists -- a header that set e.g. script-src only, with no
  // frame-ancestors, must still get one appended rather than being left
  // as-is. It never touches an existing frame-ancestors directive, so
  // Shopify's own dynamic, shop-scoped value for embedded-admin routes is
  // always preserved unchanged. Customer-facing routes, which have no
  // confirmed legitimate embedding use case anywhere in this app, get the
  // strictest value: frame-ancestors 'none' -- no site may frame them.
  responseHeaders.set(
    "Content-Security-Policy",
    ensureFrameAncestorsDirective(responseHeaders.get("Content-Security-Policy")),
  );
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          captureError("ssr-render", error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
