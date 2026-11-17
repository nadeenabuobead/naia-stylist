// app/entry.server.handle-error.test.ts
//
// 2026-11-17 — H3 partial regression test (Nov 12 privacy/breach audit).
//
// H3 ("zero monitoring/alerting of any kind — no Sentry/Datadog/equivalent")
// is still substantially TRUE and is NOT claimed fixed by this file: the
// capture seam writes to stdout only, so no error leaves the process and
// nobody is paged. See docs/runbooks/error-tracking-provider-setup.md.
//
// What this pins is the one cheap, safe improvement available: the COVERAGE
// of the existing seam. Before handleError existed, the only capture call on
// the request path was onError → captureError("ssr-render") inside
// renderToPipeableStream, which fires only for React render-stream errors.
// Unhandled errors thrown by server loaders and actions — where DB, provider
// and auth failures actually live — were never captured.
//
// Run: npx vitest run app/entry.server.handle-error.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { captureErrorMock } = vi.hoisted(() => ({ captureErrorMock: vi.fn() }));

vi.mock("./lib/error-tracking.server", () => ({
  captureError: captureErrorMock,
  captureFailure: vi.fn(),
}));

// entry.server.jsx imports shopify.server at module load, which reads env;
// stubbed so this test needs no Shopify credentials.
vi.mock("./shopify.server", () => ({
  addDocumentResponseHeaders: vi.fn(),
}));

vi.mock("./lib/content-security-policy.server", () => ({
  ensureFrameAncestorsDirective: vi.fn(),
}));

const { handleError } = await import("./entry.server.jsx");

function req(url: string, method = "GET", aborted = false) {
  return {
    url,
    method,
    signal: { aborted },
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("H3 — handleError captures loader/action errors", () => {
  it("captures a thrown error under a distinct context tag", async () => {
    const err = new Error("prisma P2024 pool timeout");

    handleError(err, { request: req("https://naiabynadine.com/closet") });

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [context, captured] = captureErrorMock.mock.calls[0];
    // A tag distinct from "ssr-render" so the two surfaces stay
    // distinguishable in logs.
    expect(context).toBe("request-handler");
    expect(context).not.toBe("ssr-render");
    expect(captured).toBe(err);
  });

  it("records method and pathname, and NOTHING else", async () => {
    handleError(new Error("boom"), {
      request: req("https://naiabynadine.com/settings", "POST"),
    });

    const [, , meta] = captureErrorMock.mock.calls[0];
    expect(meta).toEqual({ method: "POST", pathname: "/settings" });
  });

  it("never writes the query string — it can carry customer-identifying values", async () => {
    handleError(new Error("boom"), {
      request: req(
        "https://naiabynadine.com/closet?customerId=cust-secret-1&email=someone%40example.com&token=abc123",
      ),
    });

    const [, , meta] = captureErrorMock.mock.calls[0];
    expect(meta.pathname).toBe("/closet");

    // Belt and braces: no part of the captured metadata may contain any of
    // those values, however the pathname was derived.
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("cust-secret-1");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("?");
  });

  it("skips an aborted request — a client going away is not an application fault", async () => {
    handleError(new Error("aborted"), {
      request: req("https://naiabynadine.com/closet", "GET", true),
    });

    // Capturing these would bury real failures in noise.
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("still captures when the URL is malformed — reporting must not throw its own error", async () => {
    expect(() =>
      handleError(new Error("boom"), { request: req("not a url", "GET") }),
    ).not.toThrow();

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, , meta] = captureErrorMock.mock.calls[0];
    expect(meta.pathname).toBe("unknown");
  });

  it("handles a non-Error thrown value without throwing", async () => {
    // Loaders can throw strings or objects; error-tracking.server.ts
    // normalizes these, but handleError must not blow up reaching it.
    expect(() =>
      handleError("a bare string", { request: req("https://naiabynadine.com/x") }),
    ).not.toThrow();

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
  });
});
