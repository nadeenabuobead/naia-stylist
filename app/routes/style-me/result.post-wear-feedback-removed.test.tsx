// app/routes/style-me/result.post-wear-feedback-removed.test.tsx
//
// 21 October 2026 — the immediate post-wear feedback block ("Your Feedback Helps nAia
// Learn" / "After You Wear This" / "What happened with this look?" / Wore It, Changed
// Something, Didn't Wear It) asked the customer to report on an outfit before she had
// necessarily worn it, interrupting the styling moment. Removed from this page by request.
//
// This is a UI-only removal: the backend (/api/styleme-outcome, outcome-persistence.server,
// the loader's existingOutcome read) is untouched, so a future post-wear prompt (in-app or
// email, after confirmed wear) can be built on the same persistence without redoing it. This
// test pins the render, not the backend — it would not catch a regression in the API route.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

const state = vi.hoisted(() => ({
  loader: null as unknown,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Link: ({ to, children, className, style }: any) =>
      createElement("a", { href: to, className, style }, children),
    Form: ({ children, method }: any) => createElement("form", { method }, children),
    useLoaderData: () => state.loader,
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      submit: vi.fn(),
    }),
    UNSAFE_withComponentProps: (C: any) => C,
  };
});

// ── .server modules the route file imports at module scope — never touched by this UI
// change, mocked only so the component under test can be loaded in isolation. ──
vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
  validatePublicIdOwnership: vi.fn(),
  buildPrivateDownloadUrl: vi.fn(),
}));
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
  computeModelReadinessFromRecord: vi.fn(() => ({ isReadyForTryOn: false })),
}));
vi.mock("~/db.server", () => ({ default: {} }));
vi.mock("~/lib/session.server", () => ({
  getSession: vi.fn(),
  commitSession: vi.fn(),
  clearStyleMeSession: vi.fn(),
}));
vi.mock("~/lib/pending-save.server", () => ({
  readPendingSave: vi.fn(),
  writePendingSave: vi.fn(),
  clearPendingSave: vi.fn(),
}));
vi.mock("~/lib/ai/styleme-result.server", () => ({
  buildEngineInput: vi.fn(),
  buildProfileSignals: vi.fn(),
  computeStyleMeResult: vi.fn(),
  buildDbPayload: vi.fn(),
  styleSourceToSessionSource: vi.fn(),
}));
vi.mock("~/lib/ai/styleme-anchor.server", () => ({
  autoSelectClosetAnchor: vi.fn(),
  resolveActionAnchor: vi.fn(),
  loadAllClosetItemsForEngine: vi.fn(),
}));
vi.mock("~/lib/styleme/look-image-resolution.server", () => ({ resolveItemImage: vi.fn() }));
vi.mock("~/lib/ai/feedback-persistence.server", () => ({ loadSessionFeedback: vi.fn() }));
vi.mock("~/lib/ai/outcome-persistence.server", () => ({ loadOutcomeForSuggestion: vi.fn() }));
vi.mock("~/lib/plan/entitlement.server", () => ({ checkEntitlement: vi.fn() }));
vi.mock("~/lib/ai/journey-context.server", () => ({
  buildCustomerJourneyContext: vi.fn(),
  buildEphemeralContextSignals: vi.fn(),
}));
vi.mock("~/lib/ai/journey-events.server", () => ({
  emitSessionStarted: vi.fn(),
  emitRecommendationServed: vi.fn(),
  emitLookSaved: vi.fn(),
  emitInSessionReviewSubmitted: vi.fn(),
  recordJourneyEvent: vi.fn(),
  recordJourneyEventAwaited: vi.fn(),
}));
vi.mock("~/lib/dev-tryon-image-tokens.server", () => ({ issueImageToken: vi.fn() }));

// Child components stubbed out — none are reachable from the fixture below (devTryOnEnabled
// and vtoEnabled are both false, and the single item owns a closetItemId so the per-item
// feedback widget's own render guard does not fire), stubbed only so the import resolves.
vi.mock("~/components/TryOnPanel", () => ({ TryOnPanel: () => null }));
vi.mock("~/components/VtoExperience", () => ({ VtoExperience: () => null }));
vi.mock("~/components/RecommendationFeedbackWidget", () => ({ RecommendationFeedbackWidget: () => null }));

import StyleMeResult from "./result";

const BASE_LOADER_DATA = {
  isLoading: false,
  isAuthenticated: true,
  naiaModelIsReady: false,
  devTryOnEnabled: false,
  vtoEnabled: false,
  isStagingProject: false,
  tryOnFixtureTokens: {},
  sessionId: "session-1",
  mood: "confident",
  currentMood: "confident",
  desiredFeeling: "put-together",
  occasion: "everyday",
  pendingState: null,
  existingOutfitFeedback: null,
  existingOutcome: null,
  error: null,
  suggestion: {
    id: "suggestion-1",
    sessionId: "session-1",
    outfitName: "The Effortless Edit",
    whyThisWorks: "This look balances structure and ease for your day.",
    confidenceBoost: null,
    perfumeRec: null,
    hairstyleRec: null,
    makeupVibeRec: null,
    songRec: null,
    songArtist: null,
    moodDescription: null,
    items: [
      {
        id: "item-1",
        itemType: "TOPS",
        productTitle: "Silk Top",
        productImageUrl: null,
        closetItemId: "closet-1",
        shopifyProductId: null,
        stylingNotes: "Pairs well with your trousers.",
        productUrl: null,
      },
    ],
  },
};

beforeEach(() => {
  state.loader = BASE_LOADER_DATA;
});

const render = () => renderToString(<StyleMeResult />);

describe("StyleMe result page — post-wear feedback block removed", () => {
  it("does not render the feedback eyebrow or intro copy", () => {
    const html = render();
    expect(html).not.toContain("Your Feedback Helps n");
    expect(html).not.toContain("Rate your looks to help n");
  });

  it("does not render the After You Wear This prompt or its question", () => {
    const html = render();
    expect(html.toLowerCase()).not.toContain("after you wear this");
    expect(html).not.toContain("What happened with this look?");
  });

  it("does not render the Wore It / Changed Something / Didn't Wear It buttons", () => {
    const html = render();
    expect(html).not.toContain("Wore it");
    expect(html).not.toContain("Changed something");
    expect(html).not.toContain("Didn&#x27;t wear it");
  });

  it("still renders Save Look, New Look Same Vibe, Adjust Vibe, and Start Over", () => {
    const html = render();
    expect(html).toContain("Save Look");
    expect(html).toContain("New Look, Same Vibe");
    expect(html).toContain("Adjust Vibe");
    expect(html).toContain("Start Over");
  });

  it("keeps the actions intent values wired to the real form submissions", () => {
    const html = render();
    expect(html).toContain('value="adjust-vibe"');
    expect(html).toContain('value="start-over"');
  });

  it("renders the rest of the outfit result (sanity: not an empty/broken page)", () => {
    const html = render();
    expect(html).toContain("The Effortless Edit");
    expect(html).toContain("Why This Works");
  });
});
