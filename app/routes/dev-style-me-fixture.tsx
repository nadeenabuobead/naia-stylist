// app/routes/dev-style-me-fixture.tsx
// Phase 4A7 — Dev fixture route for verifying all TryOnPanel entry points and states.
// Returns 404 unless DEV_TRYON_UI_ENABLED=true.
// Renders a simulated StyleMe result with:
//   - Two eligible NADINE garments (asymmetrical-pants, suede-skirt)
//   - Dev closet fixtures (one clothing, one bag, one shoes)
// Used only to verify the UI; does not alter the recommendation engine or locked files.

import { useLoaderData } from "react-router";
import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { isTryOnEligible } from "~/lib/ai/tryon-product-eligibility";
import { issueImageToken } from "~/lib/dev-tryon-image-tokens.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { TryOnPanel } from "~/components/TryOnPanel";
import type { DevClosetItem, DevGenerationState } from "~/components/TryOnPanel";
import type { GarmentRef } from "~/lib/ai/tryon-orchestration";
import { buildCompleteLookGarments } from "~/lib/ai/tryon-orchestration";

// ── Dev fixture data ──────────────────────────────────────────────────────────

const FIXTURE_GARMENTS: GarmentRef[] = [
  { handle: "asymmetrical-pants", title: "Becoming Grounded Trousers", itemType: "BOTTOM" },
  { handle: "suede-skirt",        title: "Becoming Rooted Skirt",       itemType: "BOTTOM" },
];

const FIXTURE_CLOSET_ITEMS: DevClosetItem[] = [
  {
    id: "fixture-clothing-1",
    name: "Silk blouse — soft white",
    category: "clothing",
    eligibility: "ready-for-try-on",
    customerHint: null,
  },
  {
    id: "fixture-clothing-2",
    name: "Linen jacket",
    category: "clothing",
    eligibility: "pending-assessment",
    customerHint: null,
  },
  {
    id: "fixture-clothing-3",
    name: "Cropped knit",
    category: "clothing",
    eligibility: "needs-clearer-photo",
    customerHint: "The sleeves are cut off. Retake the photo with the full garment visible.",
  },
  {
    id: "fixture-bag-1",
    name: "Mini leather tote",
    category: "bag",
    eligibility: "ready-for-try-on",
    customerHint: null,
  },
  {
    id: "fixture-bag-2",
    name: "Canvas shopper",
    category: "bag",
    eligibility: "not-supported",
    customerHint: null,
  },
  {
    id: "fixture-shoes-1",
    name: "Block-heel mules — nude",
    category: "shoes",
    eligibility: "ready-for-try-on",
    customerHint: null,
  },
  {
    id: "fixture-shoes-2",
    name: "White trainers",
    category: "shoes",
    eligibility: "pending-assessment",
    customerHint: null,
  },
];

// Dev generation step sequence
const GEN_STEPS = [
  { step: 1, total: 2, label: "Bottoms layer" },
  { step: 2, total: 2, label: "Tops layer" },
];

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const devTryOnEnabled = process.env.DEV_TRYON_UI_ENABLED === 'true';
  if (!devTryOnEnabled) throw new Response("Not Found", { status: 404 });

  const naiaCustomer = await getCurrentNaiaCustomer(request);
  const naiaModel = naiaCustomer ? await loadNaiaModel(naiaCustomer.id) : null;
  const naiaModelIsReady = computeModelReadinessFromRecord(naiaModel).isReadyForTryOn;

  const fixtureResults: Record<string, string> = {};
  for (const g of FIXTURE_GARMENTS) {
    if (isTryOnEligible(g.handle)) {
      const slug = g.handle.replace(/\//g, "-");
      const token = issueImageToken(slug);
      fixtureResults[g.handle] = `/app/dev-tryon-img/${slug}?t=${encodeURIComponent(token)}`;
    }
  }

  return data({ naiaModelIsReady, fixtureResults });
}

// ── Dev generation simulation hook ───────────────────────────────────────────

function useDevGeneration() {
  const [genState, setGenState] = useState<DevGenerationState>(null);

  const start = useCallback(() => {
    setGenState("preparing");
    let stepIdx = 0;
    const advance = () => {
      if (stepIdx < GEN_STEPS.length) {
        setGenState(GEN_STEPS[stepIdx]);
        stepIdx++;
        setTimeout(advance, 1400);
      } else {
        setGenState("completed");
      }
    };
    setTimeout(advance, 900);
  }, []);

  const reset = useCallback(() => setGenState(null), []);

  return { genState, start, reset };
}

// ── Entry point strip ─────────────────────────────────────────────────────────

const ENTRY_POINTS = [
  { id: "single-asymmetrical", label: "StyleMe: single piece (asymmetrical-pants)", handle: "asymmetrical-pants", title: "Becoming Grounded Trousers", context: "single-piece" as const },
  { id: "single-suede",        label: "StyleMe: single piece (suede-skirt)",        handle: "suede-skirt",        title: "Becoming Rooted Skirt",       context: "single-piece" as const },
  { id: "complete-look",       label: "StyleMe: complete look",                     handle: "asymmetrical-pants", title: "The complete look",            context: "complete-look" as const },
];

// ── Page component ────────────────────────────────────────────────────────────

export default function DevStyleMeFixture() {
  const { naiaModelIsReady, fixtureResults } = useLoaderData<typeof loader>();
  const [openPanel, setOpenPanel] = useState<null | typeof ENTRY_POINTS[number]>(null);
  const { genState, start, reset } = useDevGeneration();

  const completeLookGarments = buildCompleteLookGarments(FIXTURE_GARMENTS);

  function handleOpen(ep: typeof ENTRY_POINTS[number]) {
    reset();
    setOpenPanel(ep);
  }

  function handleClose() {
    setOpenPanel(null);
    reset();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
        <a href="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", textDecoration: "none" }}>← Back</a>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "22px", fontStyle: "italic", letterSpacing: "3px", color: "#221516" }}>nAia</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ padding: "4px 10px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px" }}>DEV</span>
          <span style={{ padding: "4px 10px", background: "rgba(59,5,16,0.06)", color: naiaModelIsReady ? "#2d7a2d" : "#7a6f6a", fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "1px" }}>
            Model: {naiaModelIsReady ? "ready" : "not set up"}
          </span>
        </div>
      </div>

      <main style={{ maxWidth: "880px", margin: "0 auto", padding: "48px 40px 80px" }}>
        <div style={{ marginBottom: "48px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Dev Fixture</div>
          <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, color: "#221516", letterSpacing: "-1px", marginBottom: "8px" }}>StyleMe Result Verification</h1>
          <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>
            All five TryOnPanel entry points. Two eligible NADINE garments. Typed closet fixtures across all assessment states.
          </p>
        </div>

        {/* Simulated result */}
        <div style={{ background: "rgba(59,5,16,0.02)", border: "1px solid rgba(59,5,16,0.07)", padding: "32px", marginBottom: "48px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "20px" }}>Simulated outfit suggestion</div>

          {/* Outfit name */}
          <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "28px", fontWeight: 900, fontStyle: "italic", color: "#221516", marginBottom: "8px" }}>The Grounded Edit</div>
          <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "28px" }}>
            A considered pairing for feeling rooted and present.
          </div>

          {/* Complete look CTA */}
          <button
            onClick={() => handleOpen(ENTRY_POINTS[2])}
            style={{ marginBottom: "24px", padding: "12px 24px", background: "none", border: "1px solid #8b2035", color: "#8b2035", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer" }}
          >
            Try the complete look
          </button>

          {/* Item cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {FIXTURE_GARMENTS.map((g, idx) => (
              <div key={g.handle} style={{ padding: "20px", background: "#f4f4f1", border: "1px solid rgba(59,5,16,0.08)" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "6px" }}>
                  {g.itemType}
                  <span style={{ marginLeft: "6px", padding: "2px 5px", background: "#8b2035", color: "#f4f4f1" }}>
                    {isTryOnEligible(g.handle) ? "Try-On Ready" : "Pending"}
                  </span>
                </div>
                <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "16px", fontStyle: "italic", color: "#221516", marginBottom: "12px" }}>{g.title}</div>
                {isTryOnEligible(g.handle) && (
                  <button
                    onClick={() => handleOpen(ENTRY_POINTS[idx])}
                    style={{ padding: "8px 16px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", border: "none", cursor: "pointer" }}
                  >
                    Try this piece on
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* State matrix */}
        <div style={{ marginBottom: "48px" }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "20px" }}>Panel State Matrix</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
            {ENTRY_POINTS.map((ep) => (
              <button
                key={ep.id}
                onClick={() => handleOpen(ep)}
                style={{ padding: "16px", background: "rgba(59,5,16,0.02)", border: "1px solid rgba(59,5,16,0.1)", textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "6px" }}>
                  {ep.context}
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "14px", color: "#221516" }}>{ep.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Closet fixture reference */}
        <div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "16px" }}>Closet Fixture Reference</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            {FIXTURE_CLOSET_ITEMS.map((item) => (
              <div key={item.id} style={{ padding: "12px", background: "rgba(59,5,16,0.02)", border: "1px solid rgba(59,5,16,0.06)" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "4px" }}>{item.category}</div>
                <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "13px", color: "#221516", marginBottom: "6px" }}>{item.name}</div>
                <span style={{
                  display: "inline-block", padding: "2px 6px", fontSize: "7px", letterSpacing: "1px",
                  textTransform: "uppercase", fontFamily: "'Space Mono',monospace",
                  background: item.eligibility === "ready-for-try-on" ? "#221516" : "rgba(59,5,16,0.06)",
                  color: item.eligibility === "ready-for-try-on" ? "#f4f4f1" : "#7a6f6a",
                }}>
                  {item.eligibility}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* TryOnPanel */}
      {openPanel && (
        <TryOnPanel
          open={true}
          onClose={handleClose}
          handle={openPanel.handle}
          garmentTitle={openPanel.title}
          context={openPanel.context}
          naiaModelIsReady={naiaModelIsReady}
          fixtureResults={fixtureResults}
          devMode={true}
          completeLookGarments={openPanel.context === "complete-look" ? completeLookGarments : []}
          closetFixtures={openPanel.context === "complete-look" ? FIXTURE_CLOSET_ITEMS : []}
          devGenerationState={genState}
          onDevGenerate={start}
          onDevReset={reset}
        />
      )}
    </div>
  );
}
