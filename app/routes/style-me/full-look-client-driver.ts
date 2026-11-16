// app/routes/style-me/full-look-client-driver.ts
//
// Drives a Full-Look VTO chain to completion in the browser, after the
// customer's one explicit "Try This Look On" click.
//
// Why this exists: GET /api/full-look-vto (pollFullLookOutfit) is
// intentionally fail-closed — it never submits a new, billable FASHN step,
// so a page load or refresh can never silently spend money
// (full-look-vto-orchestrator.server.ts's allowSubmitNext: false). That
// means a GET-only polling loop can observe a garment finish but can never
// advance to the next one — the chain stalls after step 1 with no way for
// the customer to recover short of knowing to reload and re-click.
//
// The fix is not to loosen the GET endpoint — it's to stop polling it after
// the first step. This driver instead re-sends the SAME authorized POST the
// initial click used (outfitSuggestionId + a fresh consent timestamp +
// retry:false), on the same cadence a poll would use. The server's own
// startOrResumeFullLookChain is idempotent — a POST against an
// already-started chain resumes it and never resubmits a finished step — so
// repeating that one authorized request is exactly equivalent to the
// customer manually reloading and re-clicking after every garment, just
// automated for as long as this page stays open. Every request this driver
// sends is identical in kind to the one the customer's own click already
// authorized; nothing here grants itself new authorization.
//
// Safety properties preserved, all enforced server-side (not by this file):
//   - at most FULL_LOOK_MAX_GARMENTS submissions per chain (full-look-handle-
//     constants.ts), regardless of how many times this driver ticks
//   - atomic processing leases + idempotent job creation make overlapping
//     calls (two tabs, a slow tick overlapping the next) safe by
//     construction — this driver also never has two requests in flight at
//     once, as a courtesy, not as the thing that makes it safe
//   - a server-reported FAILED stops the driver for good — it never
//     automatically retries a failed paid prediction; only an explicit
//     customer action (the "Try Again" button, retry: true) starts a new
//     attempt, and that flag is only ever sent on the call this driver was
//     started with, never on an automatic tick

export type FullLookDriverOutcome =
  | { kind: "PROCESSING"; stepIndex?: number; totalSteps?: number }
  | { kind: "COMPLETED"; resultUrl: string; omittedLabels?: string[] }
  | { kind: "FAILED"; message: string };

export interface FullLookDriverCallbacks {
  onProgress: (stepIndex: number | undefined, totalSteps: number | undefined) => void;
  onDone: (resultUrl: string, omittedLabels: string[] | undefined) => void;
  onError: (message: string) => void;
}

export interface FullLookDriverOptions {
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  // setTimeout/clearTimeout-shaped, injectable so tests can use fake timers
  // or drive ticks manually instead of waiting on real wall-clock time.
  scheduleNext?: (fn: () => void, ms: number) => unknown;
  cancelNext?: (handle: unknown) => void;
  nowIso?: () => string;
}

const DEFAULT_INTERVAL_MS = 3000;

async function sendAdvance(
  fetchImpl: typeof fetch,
  nowIso: () => string,
  suggestionId: string,
  retry: boolean,
): Promise<FullLookDriverOutcome> {
  const res = await fetchImpl("/api/full-look-vto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outfitSuggestionId: suggestionId,
      virtualTryOnConsentAt: nowIso(),
      retry,
    }),
  });
  const json = await res.json();
  if (!json.ok) {
    return { kind: "FAILED", message: json.code ?? "unknown" };
  }
  if (json.status === "COMPLETED") {
    return { kind: "COMPLETED", resultUrl: json.resultUrl, omittedLabels: json.omittedLabels };
  }
  if (json.status === "FAILED") {
    return { kind: "FAILED", message: json.errorCode ?? "unknown" };
  }
  // PROCESSING is the normal in-flight case. AWAITING_AUTHORIZATION should
  // be unreachable here — every request this driver sends passes
  // allowSubmitNext: true server-side — but treating it as "still going"
  // rather than silently stalling is the safe direction if the orchestrator
  // ever changes underneath this. NOT_STARTED similarly shouldn't happen
  // once a chain exists, but isn't a failure either.
  return { kind: "PROCESSING", stepIndex: json.stepIndex, totalSteps: json.totalSteps };
}

export function createFullLookDriver(options: FullLookDriverOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const scheduleNext = options.scheduleNext ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelNext = options.cancelNext ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const nowIso = options.nowIso ?? (() => new Date().toISOString());

  let timer: unknown = null;
  let stopped = true;
  let inFlight = false;
  let generation = 0;

  function stop() {
    stopped = true;
    generation += 1;
    if (timer !== null) {
      cancelNext(timer);
      timer = null;
    }
  }

  function tick(suggestionId: string, callbacks: FullLookDriverCallbacks, retry: boolean, myGeneration: number) {
    if (stopped || inFlight || myGeneration !== generation) return;
    inFlight = true;
    sendAdvance(fetchImpl, nowIso, suggestionId, retry)
      .then((outcome) => {
        inFlight = false;
        if (stopped || myGeneration !== generation) return;
        if (outcome.kind === "COMPLETED") {
          stop();
          callbacks.onDone(outcome.resultUrl, outcome.omittedLabels);
        } else if (outcome.kind === "FAILED") {
          stop();
          callbacks.onError(outcome.message);
        } else {
          callbacks.onProgress(outcome.stepIndex, outcome.totalSteps);
          timer = scheduleNext(() => tick(suggestionId, callbacks, false, myGeneration), intervalMs);
        }
      })
      .catch(() => {
        inFlight = false;
        if (stopped || myGeneration !== generation) return;
        // A dropped request, not a server-reported failure — nothing was
        // double-submitted (either the request never reached the server, or
        // it did and the next call's idempotent resume will see the exact
        // same state). Retry on the same schedule, never with retry: true.
        timer = scheduleNext(() => tick(suggestionId, callbacks, false, myGeneration), intervalMs);
      });
  }

  function start(suggestionId: string, callbacks: FullLookDriverCallbacks, opts: { retry?: boolean } = {}) {
    stop();
    stopped = false;
    const myGeneration = generation;
    tick(suggestionId, callbacks, opts.retry ?? false, myGeneration);
  }

  return { start, stop, isRunning: () => !stopped };
}

export type FullLookDriver = ReturnType<typeof createFullLookDriver>;
