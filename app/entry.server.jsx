import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { captureError } from "./lib/error-tracking.server";

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
  // enforced. This carries the exact same intended value forward as a real
  // header, only for the requests Shopify's own helper doesn't cover --
  // never overriding the dynamic, shop-scoped value it sets for embedded
  // admin routes.
  if (!responseHeaders.has("Content-Security-Policy")) {
    responseHeaders.set(
      "Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
    );
  }
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
