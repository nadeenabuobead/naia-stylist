// app/routes/style-me/source.anchor-rejection-render.test.tsx
//
// Renders the real route component through the real submission primitive, because the
// previous fix (fdbd234) was correct at every layer except the one that mattered.
//
// WHAT WAS TRACED, AND WHY A SOURCE-TEXT ASSERTION WAS NOT ENOUGH.
// Live QA, 2026-10-06 11:16:45–11:17:02Z: ten POST 400 /style-me/source.data, no message
// on screen. Every link in the chain checked out:
//
//   - the submission is a plain <Form method="post">, NOT a fetcher, so route-level
//     useActionData is the correct data source
//   - the 400 response is well formed and carries the error:
//       HTTP/2 400 · content-type: text/x-script · x-remix-response: yes
//       [{"_1":2},"data",{"_3":4},"error","Please select a Closet item"]
//   - react-router 7.13.1 single fetch throws a 400 .data response to the ErrorBoundary
//     ONLY when the X-Remix-Response header is absent (chunk-LFPYN7LY.mjs:8146).
//     generateSingleFetchResponse stamps that header on every single-fetch response
//     (index.js:1095), so a data() 400 is delivered to useActionData, not thrown
//   - both refusal branches of evaluateAnchorEligibility carry a non-empty message
//   - ActionError is in the shipped chunk and ClosetAnchorStep is the only
//     closet-anchor branch in the step dispatch
//
// So the message WAS rendered. It was rendered where she could not see it: above the
// picker, while the loader's closet query is uncapped (findMany, no take) and every item
// becomes a 3/4-ratio tile in a two-column grid. She selects a piece and presses CONTINUE
// at the BOTTOM of that grid; the refusal appeared off-screen above it. A silent button
// and an answer rendered a screenful away are the same bug to the person using it.
//
// Hence the assertions below are about POSITION and CONTAINMENT, not presence. A test that
// only asks "is the message in the markup?" passed throughout the entire failure.
//
// The refusal itself is untouched: evaluateAnchorEligibility is unchanged, no gate is
// weakened, and no garment is ever substituted for the one she chose.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

const state = vi.hoisted(() => ({
  loader: null as unknown,
  action: undefined as unknown,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Link: ({ to, children, className, style }: any) =>
      createElement("a", { href: to, className, style }, children),
    // The primitive the UI actually uses. Rendered as a real <form> so containment
    // can be asserted: a refusal belongs inside the form whose submit produced it.
    Form: ({ children, method, style }: any) =>
      createElement("form", { method, style }, children),
    useLoaderData: () => state.loader,
    useActionData: () => state.action,
    UNSAFE_withComponentProps: (C: any) => C,
  };
});

vi.mock("~/lib/session.server", () => ({ getSession: vi.fn(), commitSession: vi.fn() }));
vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/db.server", () => ({ default: {} }));
vi.mock("~/lib/cloudinary-admin.server", () => ({
  buildPrivateDownloadUrl: vi.fn(),
  getCloudinaryConfig: vi.fn(() => null),
}));
vi.mock("~/lib/ai/styleme-anchor.server", () => ({
  autoSelectClosetAnchor: vi.fn(),
  resolveClosetAnchor: vi.fn(),
}));

import StyleMeSource from "./source";

// Eight items, as a real closet is: enough that the grid is taller than a phone screen,
// which is the whole point.
const ITEMS = Array.from({ length: 8 }, (_, i) => ({
  id: `item-${i}`,
  name: `Piece ${i}`,
  category: "TOPS",
  imageUrl: null,
}));

// The exact shape the action returns on refusal:
//   return data({ error: eligibility.message, anchorRejectionCode: eligibility.code },
//               { status: 400 })
const REFUSAL = {
  error:
    "This piece doesn't meet the coverage you've set in your Style Passport, " +
    "and no layer can change that. Choose another piece, or update your Passport.",
  anchorRejectionCode: "dressing-requirement",
};

beforeEach(() => {
  state.loader = { step: "closet-anchor", source: "my-closet", items: ITEMS };
  state.action = undefined;
});

const render = () => renderToString(<StyleMeSource />);

/** Byte offset of a needle, or -1. */
const at = (html: string, needle: string) => html.indexOf(needle);

describe("AR-R — the refusal reaches the place she is looking", () => {
  it("AR-R.1 the server's exact message is rendered verbatim", () => {
    state.action = REFUSAL;
    const html = render();
    // Verbatim: nAia must not paraphrase the reason the gate gave.
    expect(html).toContain(
      "This piece doesn&#x27;t meet the coverage you&#x27;ve set in your Style Passport",
    );
    expect(html).toContain("Choose another piece, or update your Passport.");
  });

  it("AR-R.2 it is announced, and carries the rejection code", () => {
    state.action = REFUSAL;
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-anchor-rejection="dressing-requirement"');
  });

  it("AR-R.3 it sits AFTER the picker grid, not above it", () => {
    state.action = REFUSAL;
    const html = render();
    const lastTile = html.lastIndexOf("sm-item-pick-btn");
    const msg = at(html, 'role="alert"');
    expect(lastTile).toBeGreaterThan(-1);
    expect(msg).toBeGreaterThan(-1);
    expect(msg).toBeGreaterThan(lastTile);
  });

  it("AR-R.4 it sits immediately before the CONTINUE she pressed", () => {
    state.action = REFUSAL;
    const html = render();
    const msg = at(html, 'role="alert"');
    const buttons = at(html, "sm-step-buttons");
    expect(buttons).toBeGreaterThan(-1);
    expect(msg).toBeLessThan(buttons);
    // Nothing between the refusal and the button but the button's own container.
    const between = html.slice(msg, buttons);
    expect(between).not.toContain("sm-item-pick-btn");
  });

  it("AR-R.5 it lives inside the form whose submit produced it", () => {
    state.action = REFUSAL;
    const html = render();
    const setAnchorForm = at(html, 'value="set-anchor"');
    // The back form is a separate <form> rendered after the picker's.
    const backForm = at(html, 'value="back"');
    const msg = at(html, 'role="alert"');
    expect(setAnchorForm).toBeGreaterThan(-1);
    expect(backForm).toBeGreaterThan(setAnchorForm);
    expect(msg).toBeGreaterThan(setAnchorForm);
    expect(msg).toBeLessThan(backForm);
  });

  it("AR-R.6 it is focusable, so it can be moved to rather than hoped for", () => {
    state.action = REFUSAL;
    const html = render();
    const msg = at(html, 'role="alert"');
    // tabindex="-1" on the alert is what lets the effect pull focus to it.
    const tag = html.slice(html.lastIndexOf("<p", msg), html.indexOf(">", msg) + 1);
    expect(tag).toContain('tabindex="-1"');
  });

  it("AR-R.7 CONTINUE is still guarded, so an empty submit stays impossible", () => {
    state.action = REFUSAL;
    const html = render();
    expect(html).toContain("disabled");
  });

  it("AR-R.8 every item is still listed and selectable after a refusal", () => {
    state.action = REFUSAL;
    const html = render();
    const tiles = (html.match(/sm-item-pick-btn/g) ?? []).length;
    expect(tiles).toBe(ITEMS.length);
  });

  it("AR-R.9 no alert is rendered when there is nothing to report", () => {
    state.action = undefined;
    const html = render();
    expect(html).not.toContain('role="alert"');
  });

  it("AR-R.10 an action response without an error renders no alert", () => {
    state.action = { anchorRejectionCode: undefined };
    const html = render();
    expect(html).not.toContain('role="alert"');
  });
});

describe("AR-R — the other steps that can 400 still show their own", () => {
  it("AR-R.11 the anchor-method step renders the refusal next to its submit", () => {
    state.loader = { step: "anchor-method", source: "my-closet", prevMethod: null };
    state.action = { error: "Please choose how to pick the piece" };
    const html = render();
    const msg = at(html, 'role="alert"');
    expect(msg).toBeGreaterThan(-1);
    expect(msg).toBeLessThan(at(html, "sm-step-buttons"));
  });

  it("AR-R.12 the source step renders the refusal next to its submit", () => {
    state.loader = { step: "source", isRev3: true, prevSource: null };
    state.action = { error: "Please select what we're styling" };
    const html = render();
    const msg = at(html, 'role="alert"');
    expect(msg).toBeGreaterThan(-1);
    expect(msg).toBeLessThan(at(html, "sm-step-buttons"));
  });
});
