// app/routes/passport-noticing-feedback.test.ts
//
// QA BUG regression — "ACCURATE appears to do nothing" on the Passport
// Noticing card. Root cause: resolveSavedFeedback (passport.tsx) read
// `fetcher.formData?.get("feedback")` after a successful submit, but both
// submitAccurate and submitNotQuite submit with encType: "application/json",
// and react-router's fetcher never populates `.formData` for a JSON
// submission — it stays undefined; the submitted value lives on `.json`
// instead (formData/json are mutually exclusive on react-router's own
// Submission type). So the confirmation branch ("Glad this resonates." /
// "Got it...") never rendered immediately after a successful submit, even
// though the POST succeeded and customerFeedback was persisted correctly —
// only a full page reload (which re-reads tendency.customerFeedback from a
// fresh loader run) ever showed it.
//
// Uses vitest (not node:test) because passport.tsx imports a Vite-style
// `?url` CSS asset (`~/styles/naia-design-system.css?url`), which plain
// tsx/esm cannot resolve — same reason my-naia._index.test.tsx uses vitest.

import { describe, it, expect } from "vitest";
import { resolveSavedFeedback } from "./passport";

describe("resolveSavedFeedback — the exact bug behind 'Accurate does nothing'", () => {
  it("BEFORE the submit: no fetcher data yet → falls back to the tendency's stored feedback", () => {
    expect(resolveSavedFeedback(undefined, undefined, null)).toBeNull();
    expect(resolveSavedFeedback(undefined, undefined, "accurate")).toBe("accurate");
  });

  it("a failed submit (ok: false or absent) never shows a confirmation, regardless of what was sent", () => {
    expect(resolveSavedFeedback({ ok: false }, { tendencyId: "t1", feedback: "accurate" }, null)).toBeNull();
  });

  it("REGRESSION — a successful Accurate submit (real react-router JSON-fetcher shape: formData undefined, json populated) resolves to 'accurate'", () => {
    // This is exactly what feedbackFetcher looks like right after
    // submitAccurate()'s fetcher.submit({...}, { encType: "application/json" })
    // resolves successfully — no .formData involved at all.
    const result = resolveSavedFeedback(
      { ok: true },
      { tendencyId: "t1", feedback: "accurate" },
      null,
    );
    expect(result).toBe("accurate");
  });

  it("REGRESSION — a successful Send Feedback / Skip Details not-quite submit resolves to 'not-quite', detail fields included or not", () => {
    expect(resolveSavedFeedback({ ok: true }, { tendencyId: "t1", feedback: "not-quite", notQuiteReason: null, notQuiteNote: null }, null)).toBe("not-quite");
    expect(resolveSavedFeedback({ ok: true }, { tendencyId: "t1", feedback: "not-quite", notQuiteReason: "only-sometimes", notQuiteNote: "a note" }, null)).toBe("not-quite");
  });

  it("documents why the OLD formData-based read was broken: a JSON submission's fetcher.formData is always undefined", () => {
    // The old implementation was effectively:
    //   fetcherData?.ok ? (fetcherFormData?.get("feedback") ?? null) : stored
    // Simulate it directly to prove it could only ever produce null here,
    // which is the bug — not a hypothetical, this is what shipped.
    const fetcherData = { ok: true };
    const fetcherFormData: FormData | undefined = undefined; // real shape for a JSON submission
    const oldBuggyResult = fetcherData?.ok ? ((fetcherFormData?.get("feedback") as string | null) ?? null) : null;
    expect(oldBuggyResult).toBeNull();

    // The fix reads .json instead, which IS populated for a JSON submission.
    const fixedResult = resolveSavedFeedback(fetcherData, { tendencyId: "t1", feedback: "accurate" }, null);
    expect(fixedResult).toBe("accurate");
  });

  it("repeated identical calls are idempotent — calling resolveSavedFeedback again with the same inputs never changes the answer", () => {
    const args = [{ ok: true }, { tendencyId: "t1", feedback: "accurate" }, null] as const;
    const first = resolveSavedFeedback(...args);
    const second = resolveSavedFeedback(...args);
    expect(first).toBe(second);
    expect(first).toBe("accurate");
  });
});
