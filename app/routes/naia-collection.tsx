// app/routes/naia-collection.tsx
// Phase 4A7 — Dev-only NADINE collection page with virtual try-on CTAs.
// Gated by DEV_TRYON_UI_ENABLED=true; returns 404 in all other environments.

import { useLoaderData } from "react-router";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getAllCatalogProducts } from "~/lib/ai/naia-catalog";
import { isTryOnEligible, getTryOnOutcome } from "~/lib/ai/tryon-product-eligibility";
import { issueImageToken } from "~/lib/dev-tryon-image-tokens.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { TryOnPanel } from "~/components/TryOnPanel";

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const devTryOnEnabled = process.env.DEV_TRYON_UI_ENABLED === 'true';
  if (!devTryOnEnabled) throw new Response("Not Found", { status: 404 });

  // Load model readiness from DB for the authenticated customer (if any).
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  const naiaModel = naiaCustomer ? await loadNaiaModel(naiaCustomer.id) : null;
  const naiaModelIsReady = computeModelReadinessFromRecord(naiaModel).isReadyForTryOn;

  const products = getAllCatalogProducts().map((p) => {
    const handle = p.handle;
    const outcome = getTryOnOutcome(handle);
    const eligible = outcome === "accepted";
    let fixtureUrl: string | null = null;
    if (eligible) {
      const slug = handle.replace(/\//g, "-");
      const token = issueImageToken(slug);
      fixtureUrl = `/app/dev-tryon-img/${slug}?t=${encodeURIComponent(token)}`;
    }
    return {
      handle,
      title: p.parsed.identity.verifiedTitle,
      itemType: p.parsed.identity.itemType,
      liveUrl: p.parsed.identity.liveUrl,
      outcome,
      eligible,
      fixtureUrl,
    };
  });

  // Pre-compute tokens for all accepted handles (keyed by handle).
  const fixtureResults: Record<string, string> = {};
  for (const p of products) {
    if (p.fixtureUrl) fixtureResults[p.handle] = p.fixtureUrl;
  }

  return data({ products, fixtureResults, naiaModelIsReady });
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({
  handle,
  title,
  itemType,
  outcome,
  eligible,
  onTryOn,
}: {
  handle: string;
  title: string;
  itemType: string;
  outcome: string;
  eligible: boolean;
  onTryOn: (handle: string, title: string) => void;
}) {
  const outcomeBadge = {
    accepted: { label: "Try-On Ready", bg: "#8b2035", color: "#f4f4f1" },
    "not-eligible": { label: "Not Eligible", bg: "rgba(59,5,16,0.08)", color: "#7a6f6a" },
    pending: { label: "Pending", bg: "rgba(59,5,16,0.04)", color: "#7a6f6a" },
  }[outcome] ?? { label: outcome, bg: "transparent", color: "#7a6f6a" };

  return (
    <div style={{ padding: "20px", background: "rgba(59,5,16,0.02)", borderLeft: `3px solid ${eligible ? "#8b2035" : "rgba(59,5,16,0.12)"}` }}>
      <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "4px" }}>
        {itemType}
        <span style={{ marginLeft: "8px", padding: "2px 6px", background: outcomeBadge.bg, color: outcomeBadge.color, fontSize: "6px", letterSpacing: "1px" }}>
          {outcomeBadge.label}
        </span>
        <span style={{ marginLeft: "4px", padding: "2px 6px", background: "#8b2035", color: "#f4f4f1", fontSize: "6px", letterSpacing: "1px" }}>
          dev
        </span>
      </div>
      <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "18px", fontStyle: "italic", color: "#221516", marginBottom: "8px" }}>{title}</div>
      <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "13px", color: "#7a6f6a", marginBottom: "12px" }}>/{handle}</div>
      {eligible && (
        <button
          onClick={() => onTryOn(handle, title)}
          style={{ padding: "8px 18px", background: "#221516", color: "#f4f4f1", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", border: "none", cursor: "pointer" }}
        >
          Try It On Me
        </button>
      )}
    </div>
  );
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function NaiaCollection() {
  const { products, fixtureResults, naiaModelIsReady } = useLoaderData<typeof loader>();
  const [tryOnPanel, setTryOnPanel] = useState<{ handle: string; title: string } | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
        <a href="/" style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", textDecoration: "none" }}>← Back</a>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "22px", fontStyle: "italic", letterSpacing: "3px", color: "#221516" }}>nAia</div>
        <div style={{ padding: "4px 10px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px" }}>DEV</div>
      </div>

      <main style={{ maxWidth: "800px", margin: "0 auto", padding: "48px 40px 80px" }}>
        <div style={{ marginBottom: "40px" }}>
          <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "12px" }}>Dev Preview</div>
          <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, color: "#221516", letterSpacing: "-1px", marginBottom: "8px" }}>NADINE Collection</h1>
          <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>
            Virtual try-on available for accepted pieces only. Fixture results from Phase 4A5.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
          {products.map((p) => (
            <ProductCard
              key={p.handle}
              handle={p.handle}
              title={p.title}
              itemType={p.itemType}
              outcome={p.outcome}
              eligible={p.eligible}
              onTryOn={(handle, title) => setTryOnPanel({ handle, title })}
            />
          ))}
        </div>
      </main>

      <TryOnPanel
        open={!!tryOnPanel}
        onClose={() => setTryOnPanel(null)}
        handle={tryOnPanel?.handle ?? null}
        garmentTitle={tryOnPanel?.title ?? null}
        context="single-piece"
        naiaModelIsReady={naiaModelIsReady}
        fixtureResults={fixtureResults}
        devMode={true}
      />
    </div>
  );
}
