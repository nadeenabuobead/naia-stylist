// app/routes/passport-noticing-feedback.test.ts
//
// QA BUG regression — "Accurate confirmation flashes briefly, then the
// buttons come back."
//
// Two bugs, same root cause, fixed in sequence:
//
//   Bug 1 (fixed earlier): resolveSavedFeedback read
//   `fetcher.formData?.get("feedback")`. A JSON submission (encType:
//   "application/json", used by both submitAccurate and submitNotQuite)
//   never populates `.formData` at all, so the confirmation never
//   appeared — not even briefly.
//
//   Bug 2 (this file): the fix for Bug 1 switched to reading
//   `fetcher.json` instead. `.json` IS populated while the fetcher is
//   "submitting"/"loading" — which is why the confirmation flashed
//   briefly — but react-router's own Fetcher type shows `.json` reverts
//   to `undefined` once the fetcher settles to "idle" (only `.data`
//   persists across that transition). So the confirmation vanished the
//   instant the fetcher went idle, even though `.data.ok` was still true.
//
// The real fix: derive the confirmed value from `fetcher.data` — the
// actual action response (now echoing back the feedback value the server
// validated and persisted, see api.taste-observation-feedback.tsx) — which
// persists through idle and every subsequent re-render until a *new*
// submission replaces it. A failed/absent response always falls back to
// the loader-supplied persisted value, so a failure can never show a false
// confirmation, and a fresh page load (persisted customerFeedback from the
// loader, no fetcher activity yet) renders correctly with zero client
// state at all.
//
// Uses vitest (not node:test) because passport.tsx imports a Vite-style
// `?url` CSS asset (`~/styles/naia-design-system.css?url`), which plain
// tsx/esm cannot resolve — same reason my-naia._index.test.tsx uses vitest.

import { describe, it, expect } from "vitest";
import { resolveSavedFeedback } from "./passport";

describe("resolveSavedFeedback — ACCURATE", () => {
  it("initial load, nothing submitted yet, no prior feedback → null (buttons render)", () => {
    expect(resolveSavedFeedback(undefined, null)).toBeNull();
  });

  it("click → submitting (fetcher.data still undefined, no response yet) → still falls back to the pre-submit stored value", () => {
    // Mirrors the real transition: during "submitting", fetcher.data has
    // not been set yet regardless of what .json/.formData hold — there is
    // no response to derive confirmation from until the action returns.
    expect(resolveSavedFeedback(undefined, null)).toBeNull();
  });

  it("REGRESSION — successful response → confirmation appears, and does NOT depend on any transient submission field", () => {
    // The real react-router shape right after a successful submit: no
    // second parameter for .json/.formData exists in this function's
    // signature at all anymore — .data alone must be enough.
    const result = resolveSavedFeedback({ ok: true, feedback: "accurate" }, null);
    expect(result).toBe("accurate");
  });

  it("REGRESSION — fetcher returns to idle (fetcher.data unchanged, this is the exact moment the old .json-based fix broke) → confirmation remains", () => {
    // react-router's Fetcher.Idle type has `json: undefined` explicitly,
    // but `data` is NOT reset — it keeps the last response. Passing the
    // identical fetcherData again (simulating the fetcher settling to
    // idle with no new submission) must produce the identical result.
    const fetcherDataAfterIdle = { ok: true, feedback: "accurate" as const };
    expect(resolveSavedFeedback(fetcherDataAfterIdle, null)).toBe("accurate");
  });

  it("ordinary re-render with the same fetcher.data → confirmation stays stable across repeated calls", () => {
    const fetcherData = { ok: true, feedback: "accurate" as const };
    const first = resolveSavedFeedback(fetcherData, null);
    const second = resolveSavedFeedback(fetcherData, null);
    const third = resolveSavedFeedback(fetcherData, null);
    expect([first, second, third]).toEqual(["accurate", "accurate", "accurate"]);
  });

  it("persisted customerFeedback='accurate' on the loader (no fetcher activity this session) → confirmation renders, buttons do not", () => {
    // This is the full-refresh case: a brand new component instance,
    // fresh fetcher (data undefined), the only source of truth is what
    // the loader supplied from the real, persisted StyleTendency row.
    expect(resolveSavedFeedback(undefined, "accurate")).toBe("accurate");
  });

  it("full refresh after a successful submit in a prior session is indistinguishable from an always-accurate tendency — both derive purely from the persisted value", () => {
    const freshPageLoad = resolveSavedFeedback(undefined, "accurate");
    expect(freshPageLoad).toBe("accurate");
  });
});

describe("resolveSavedFeedback — NOT QUITE", () => {
  it("a successful not-quite confirmation does not disappear merely because transient submission metadata (.json/.formData) would have cleared", () => {
    // There is no .json/.formData parameter in this function's signature
    // at all — proving the confirmation cannot regress to depending on
    // either again without a type error at every call site.
    const result = resolveSavedFeedback({ ok: true, feedback: "not-quite" }, null);
    expect(result).toBe("not-quite");
  });

  it("holds across the idle transition exactly like Accurate — same function, same guarantee", () => {
    const fetcherDataAfterIdle = { ok: true, feedback: "not-quite" as const };
    expect(resolveSavedFeedback(fetcherDataAfterIdle, null)).toBe("not-quite");
    expect(resolveSavedFeedback(fetcherDataAfterIdle, null)).toBe("not-quite");
  });

  it("persisted customerFeedback='not-quite' on the loader renders correctly on a fresh load too", () => {
    expect(resolveSavedFeedback(undefined, "not-quite")).toBe("not-quite");
  });
});

describe("resolveSavedFeedback — FAILED SUBMISSION", () => {
  it("ok: false never shows a confirmation, regardless of any feedback value present", () => {
    expect(resolveSavedFeedback({ ok: false, feedback: "accurate" }, null)).toBeNull();
  });

  it("a failed submission falls back to the real pre-submit persisted value, not to a success state", () => {
    expect(resolveSavedFeedback({ ok: false }, "accurate")).toBe("accurate"); // unchanged, not re-derived from the failed attempt
    expect(resolveSavedFeedback({ ok: false }, null)).toBeNull(); // still unconfirmed, buttons render
  });

  it("an absent/undefined fetcher response (never submitted) behaves identically to an explicit failure", () => {
    expect(resolveSavedFeedback(undefined, "accurate")).toBe("accurate");
    expect(resolveSavedFeedback(undefined, null)).toBeNull();
  });

  it("a response with ok:true but no feedback value (malformed/old server) does not fabricate a confirmation", () => {
    expect(resolveSavedFeedback({ ok: true }, null)).toBeNull();
    expect(resolveSavedFeedback({ ok: true }, "accurate")).toBe("accurate");
  });
});
