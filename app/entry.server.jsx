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

// React Router's server-side error hook — the only capture point for errors
// thrown by a server loader/action (e.g. a Prisma/Postgres failure in
// getCurrentNaiaCustomer) rather than during React's render stream. Without
// this, those errors reach the client ErrorBoundary but are never logged
// with any structure at all.
//
// Logged metadata is deliberately minimal and PII-free: method and
// pathname only. The query string is excluded on purpose, since it can
// carry customer-identifying values.
export function handleError(error, { request }) {
  // A client that goes away mid-flight aborts the request, which surfaces
  // here as an error that is not an application fault.
  if (request.signal.aborted) return;

  let pathname = "unknown";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    // A malformed URL must not turn error reporting into a second error.
  }

  captureError("request-handler", error, { method: request.method, pathname });
}
