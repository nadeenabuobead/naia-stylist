// app/routes/trends-save-controls.test.tsx
//
// Step 3 — the ♡ on Trend Reports.
//
// Two kinds of check:
//   1. the control itself renders the right state and the right accessible name
//   2. the controls are placed on the right content, and ONLY that content
//
// The placement checks read route source, which is the convention the existing
// trends.phase4 tests already use. They exist because the editorial read is the
// primary experience: a regression that scatters save buttons through the prose
// should fail here rather than in review.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Control rendering ─────────────────────────────────────────────────────────

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      Form: ({ children, ...props }: Record<string, unknown> & { children?: unknown }) => {
        const { createElement } = require("react");
        return createElement("form", props, children);
      },
      state: "idle",
      data: undefined,
      submit: vi.fn(),
    }),
  };
});

import { renderToString } from "react-dom/server";
import React from "react";
import SaveControl from "~/components/SaveControl";

function render(props: Partial<React.ComponentProps<typeof SaveControl>> = {}) {
  return renderToString(
    React.createElement(SaveControl, {
      contentType: "TREND",
      contentId: "tc_aaaaaaaaaaaa",
      reportSlug: "autumn-edit-2026",
      refKey: "r:rep_1|TREND|tc_aaaaaaaaaaaa",
      initiallySaved: false,
      returnTo: "/trends/autumn-edit-2026",
      label: "Suede Textures",
      ...props,
    } as React.ComponentProps<typeof SaveControl>),
  );
}

describe("§SC-1 save control states", () => {
  it("offers Save when not yet saved", () => {
    const html = render();
    expect(html).toContain("♡");
    expect(html).toContain("Save");
    expect(html).toContain('aria-pressed="false"');
  });

  it("shows Saved when the loader says this customer saved it", () => {
    const html = render({ initiallySaved: true });
    expect(html).toContain("♥");
    expect(html).toContain("Saved");
    expect(html).toContain('aria-pressed="true"');
  });

  it("names what it saves, for screen readers", () => {
    expect(render()).toContain('aria-label="Save Suede Textures to My Saved"');
    expect(render({ initiallySaved: true })).toContain("Saved: Suede Textures");
  });

  it("posts to the save endpoint rather than navigating", () => {
    const html = render();
    expect(html).toContain('action="/api/saved-items"');
    expect(html).toContain('method="post"');
  });

  it("sends the unsave intent once saved — a second click removes it", () => {
    expect(render()).toContain('name="intent" value="save"');
    expect(render({ initiallySaved: true })).toContain('name="intent" value="unsave"');
  });

  it("sends identifiers only — never display copy", () => {
    const html = render();
    expect(html).toContain('name="contentType"');
    expect(html).toContain('name="contentId"');
    expect(html).toContain('name="refKey"');
    // The label is an accessible name, not a posted field.
    expect(html).not.toContain('name="label"');
    expect(html).not.toContain('name="sublabel"');
    expect(html).not.toContain('name="sourceReportTitle"');
  });

  it("carries a return path so sign-in comes back to the report", () => {
    expect(render()).toContain('name="returnTo" value="/trends/autumn-edit-2026"');
  });

  it("passes the generated wording for a takeaway snapshot", () => {
    const html = render({ contentType: "TAKEAWAY", contentId: "aLookToTry", takeawayText: "Your navy blazer." });
    expect(html).toContain('name="takeawayText"');
  });

  it("announces the result politely without moving the page", () => {
    expect(render()).toContain('aria-live="polite"');
  });
});

// ── Placement ─────────────────────────────────────────────────────────────────

const read = (file: string) => readFileSync(join(process.cwd(), "app/routes", file), "utf8");

describe("§SC-2 placement on the public report", () => {
  const src = read("trends.$slug.tsx");

  it("saves a key trend, a signal and a reference — the three discrete objects", () => {
    expect(src).toContain('save("TREND", t.id, t.name)');
    expect(src).toContain('save("SIGNAL", r.id, r.signal)');
    expect(src).toContain('save("SIGNAL", f.id, f.signal)');
    expect(src).toContain('save("REFERENCE", ref.id');
  });

  it("does NOT manufacture a control for editorial prose", () => {
    for (const prose of ["naiaTake", "editorialIntro", "wardrobeNote", "naiaVerdict"]) {
      expect(src).not.toContain(`save("${prose}`);
    }
  });

  it("reads save state from the loader, so a refresh shows the real truth", () => {
    expect(src).toContain("loadReportSaveState");
    expect(src).toContain("saveState.saved");
  });

  it("keeps the report public — auth is optional and only fills in the ♡", () => {
    expect(src).toContain("getCurrentNaiaCustomer");
    expect(src).not.toContain("requireCurrentNaiaCustomer");
  });

  it("degrades to no controls rather than failing when save state is absent", () => {
    expect(src).toContain("loaderData.saveState ?? { refKeys: {}, saved: [], canSave: false }");
  });

  it("skips content that has no stable id yet", () => {
    expect(src).toContain("if (!contentId) return null;");
  });
});

describe("§SC-3 placement on the personalised edit", () => {
  const src = read("trends.my-edits.$slug.tsx");

  it("saves the two concrete takeaways by SECTION key", () => {
    expect(src).toContain('saveTakeaway("yourBestRouteIn"');
    expect(src).toContain('saveTakeaway("aLookToTry"');
  });

  it("uses no positional bullet identity", () => {
    expect(src).not.toContain("partToTake:");
    expect(src).not.toContain("partToLeave:");
  });

  it("saves the NADINE piece by its catalogue handle", () => {
    expect(src).toContain("contentType=\"PRODUCT\"");
    expect(src).toContain("nadineRecommendation.handle");
  });

  it("limits takeaway saves to the two actionable sections", () => {
    expect(src).toContain('takeawaySections: ["yourBestRouteIn", "aLookToTry"]');
  });
});
