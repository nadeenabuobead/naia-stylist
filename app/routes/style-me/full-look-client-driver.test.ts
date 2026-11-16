// app/routes/style-me/full-look-client-driver.test.ts
//
// Regression coverage for the fix to the confirmed defect: GET-only polling
// (allowSubmitNext: false, by design) can observe a garment finish but can
// never submit the next one, so a customer who clicked "Try This Look On"
// once would see the chain complete garment 1 and then hang forever. This
// driver replaces GET-polling with repeated authorized POSTs (the same
// request the initial click sends), on the same cadence, until a terminal
// state. These tests exercise the driver in isolation with a mocked fetch
// and a manually-stepped scheduler — no React, no server, no FASHN calls.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFullLookDriver } from "./full-look-client-driver";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Response#json() reads the body as a stream, which takes more than a plain
// microtask hop to settle — a real macrotask boundary reliably flushes it
// (and every microtask queued before it) without coupling tests to how many
// .then() hops the driver happens to use internally.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A manually-stepped scheduler: scheduleNext records the pending callback
// instead of using real timers. Tests call `fireNext()` to advance exactly
// one tick, keeping assertions deterministic and immediate.
function makeManualScheduler() {
  let pending: (() => void) | null = null;
  let pendingMs: number | null = null;
  const cancelled: unknown[] = [];
  return {
    scheduleNext: (fn: () => void, ms: number) => {
      pending = fn;
      pendingMs = ms;
      return fn; // the handle is the function itself — fine for this fake
    },
    cancelNext: (handle: unknown) => {
      cancelled.push(handle);
      if (handle === pending) pending = null;
    },
    hasPending: () => pending !== null,
    lastIntervalMs: () => pendingMs,
    fireNext: async () => {
      const fn = pending;
      pending = null;
      if (!fn) throw new Error("no pending tick scheduled");
      fn();
      // let the driver's own promise chain (fetch mock + .then/.catch) settle
      await flush();
    },
  };
}

function makeCallbacks() {
  const progress: Array<{ stepIndex?: number; totalSteps?: number }> = [];
  const done: Array<{ resultUrl: string; omittedLabels?: string[] }> = [];
  const errors: string[] = [];
  return {
    progress,
    done,
    errors,
    callbacks: {
      onProgress: (stepIndex?: number, totalSteps?: number) => progress.push({ stepIndex, totalSteps }),
      onDone: (resultUrl: string, omittedLabels?: string[]) => done.push({ resultUrl, omittedLabels }),
      onError: (message: string) => errors.push(message),
    },
  };
}

describe("createFullLookDriver", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function readBody(callIndex: number): { outfitSuggestionId: string; virtualTryOnConsentAt: string; retry: boolean } {
    const call = fetchMock.mock.calls[callIndex];
    return JSON.parse(call[1].body);
  }

  it("the initial call sends retry exactly as requested, and every subsequent automatic tick sends retry:false", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 0, totalSteps: 3 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 1, totalSteps: 3 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "COMPLETED", resultUrl: "https://cdn/x.png" }));

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
      nowIso: () => "2026-11-16T12:00:00.000Z",
    });
    const { callbacks, progress, done } = makeCallbacks();

    driver.start("sugg-1", callbacks, { retry: true });
    await flush();
    expect(readBody(0).retry).toBe(true);
    expect(readBody(0).outfitSuggestionId).toBe("sugg-1");

    await scheduler.fireNext();
    expect(readBody(1).retry).toBe(false);

    await scheduler.fireNext();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([
      { stepIndex: 0, totalSteps: 3 },
      { stepIndex: 1, totalSteps: 3 },
    ]);
    expect(done).toEqual([{ resultUrl: "https://cdn/x.png", omittedLabels: undefined }]);
    expect(driver.isRunning()).toBe(false);
  });

  it("drives a full 5-garment chain to completion across repeated ticks", async () => {
    for (let step = 0; step < 4; step++) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: step, totalSteps: 5 }));
    }
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, status: "COMPLETED", resultUrl: "https://cdn/full.png", omittedLabels: ["belt"] }),
    );

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks, progress, done } = makeCallbacks();

    driver.start("sugg-5", callbacks, { retry: false });
    await flush();

    for (let i = 0; i < 4; i++) {
      await scheduler.fireNext();
    }

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(progress.map((p) => p.stepIndex)).toEqual([0, 1, 2, 3]);
    expect(done).toEqual([{ resultUrl: "https://cdn/full.png", omittedLabels: ["belt"] }]);
    expect(scheduler.hasPending()).toBe(false);
  });

  it("stops for good on a server-reported FAILED — never automatically retries a failed paid prediction", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 0, totalSteps: 3 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "FAILED", errorCode: "PROVIDER_FAILED" }));

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks, errors } = makeCallbacks();

    driver.start("sugg-fail", callbacks);
    await flush();
    await scheduler.fireNext();

    expect(errors).toEqual(["PROVIDER_FAILED"]);
    expect(driver.isRunning()).toBe(false);
    expect(scheduler.hasPending()).toBe(false);

    // Nothing left scheduled, so real time passing fires nothing further.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops for good when the action responds not-ok (e.g. quota_exceeded) without retrying", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, code: "quota_exceeded" }));
    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks, errors } = makeCallbacks();

    driver.start("sugg-q", callbacks);
    await flush();

    expect(errors).toEqual(["quota_exceeded"]);
    expect(driver.isRunning()).toBe(false);
    expect(scheduler.hasPending()).toBe(false);
  });

  it("treats AWAITING_AUTHORIZATION the same as still-in-progress rather than stalling", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "AWAITING_AUTHORIZATION", stepIndex: 2, totalSteps: 4 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "COMPLETED", resultUrl: "https://cdn/y.png" }));

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks, progress, done } = makeCallbacks();

    driver.start("sugg-aa", callbacks);
    await flush();
    expect(progress).toEqual([{ stepIndex: 2, totalSteps: 4 }]);

    await scheduler.fireNext();
    expect(done).toEqual([{ resultUrl: "https://cdn/y.png", omittedLabels: undefined }]);
  });

  it("never sends a second request while one is still in flight (duplicate-poll guard)", async () => {
    const resolver: { fn: ((res: Response) => void) | null } = { fn: null };
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolver.fn = resolve;
        }),
    );

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks } = makeCallbacks();

    driver.start("sugg-dup", callbacks);
    await flush();

    // No tick is scheduled yet (the first call hasn't resolved), so there is
    // nothing to fire — simulate an interval trying to fire early by calling
    // start() again, which must not pile up a second concurrent request.
    driver.start("sugg-dup", callbacks);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolver.fn?.(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 0, totalSteps: 3 }));
    await flush();
  });

  it("a dropped network request retries on the same schedule, never flagged as retry:true", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "COMPLETED", resultUrl: "https://cdn/z.png" }));

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks, done, errors } = makeCallbacks();

    driver.start("sugg-net", callbacks);
    await flush();

    expect(errors).toEqual([]);
    expect(scheduler.hasPending()).toBe(true);

    await scheduler.fireNext();
    expect(readBody(1).retry).toBe(false);
    expect(done).toEqual([{ resultUrl: "https://cdn/z.png", omittedLabels: undefined }]);
  });

  it("stop() cancels a pending tick and suppresses any in-flight response that resolves afterward", async () => {
    const resolver: { fn: ((res: Response) => void) | null } = { fn: null };
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolver.fn = resolve;
        }),
    );

    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks, progress, done, errors } = makeCallbacks();

    driver.start("sugg-stop", callbacks);
    await flush();

    driver.stop();
    expect(driver.isRunning()).toBe(false);

    resolver.fn?.(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 0, totalSteps: 3 }));
    await flush();

    expect(progress).toEqual([]);
    expect(done).toEqual([]);
    expect(errors).toEqual([]);
    expect(scheduler.hasPending()).toBe(false);
  });

  it("browser-close/reopen: restarting after stop() resumes with a fresh authorized call, not retry:true, and the resumed chain still completes within the original budget", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 1, totalSteps: 3 }));
    const scheduler1 = makeManualScheduler();
    const driver1 = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler1.scheduleNext,
      cancelNext: scheduler1.cancelNext,
    });
    const { callbacks: cb1 } = makeCallbacks();
    driver1.start("sugg-resume", cb1);
    await flush();
    driver1.stop(); // simulate the browser tab closing mid-chain

    // Reopening the page constructs a brand-new driver instance (as the
    // real component does on remount) and resumes — this must be a plain,
    // non-retry call: the chain already exists server-side and must only
    // ever be resumed, never restarted as a new attempt.
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: "COMPLETED", resultUrl: "https://cdn/resumed.png" }));
    const scheduler2 = makeManualScheduler();
    const driver2 = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler2.scheduleNext,
      cancelNext: scheduler2.cancelNext,
    });
    const { callbacks: cb2, done } = makeCallbacks();
    driver2.start("sugg-resume", cb2, { retry: false });
    await flush();

    expect(readBody(1).retry).toBe(false);
    expect(done).toEqual([{ resultUrl: "https://cdn/resumed.png", omittedLabels: undefined }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the default 3-second interval between automatic ticks unless overridden", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 0, totalSteps: 3 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "PROCESSING", stepIndex: 1, totalSteps: 3 }));
    const scheduler = makeManualScheduler();
    const driver = createFullLookDriver({
      fetchImpl: fetchMock as unknown as typeof fetch,
      scheduleNext: scheduler.scheduleNext,
      cancelNext: scheduler.cancelNext,
    });
    const { callbacks } = makeCallbacks();
    driver.start("sugg-interval", callbacks);
    await flush();
    expect(scheduler.lastIntervalMs()).toBe(3000);
  });
});
