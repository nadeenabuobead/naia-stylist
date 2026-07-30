// app/components/TryOnPanel.tsx
// Phase 4A7 — Shared virtual try-on panel used by all entry points.
// Phase 4B1 — VTO usefulness/fidelity feedback added to has-result state.
// No server imports. All eligibility + model state is passed via props.

import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import { isTryOnEligible } from "~/lib/ai/tryon-product-eligibility";
import { PROVIDER_DISCLAIMER } from "~/lib/ai/virtual-try-on.types";
import type { GarmentRef } from "~/lib/ai/tryon-orchestration";

// ── Closet fixture types ──────────────────────────────────────────────────────

export type ClosetItemEligibility =
  | "ready-for-try-on"
  | "pending-assessment"
  | "needs-clearer-photo"
  | "not-supported";

export interface DevClosetItem {
  id: string;
  name: string;
  category: "clothing" | "bag" | "shoes";
  eligibility: ClosetItemEligibility;
  customerHint: string | null;
}

// ── Dev generation state ──────────────────────────────────────────────────────

export type DevGenStep = { step: number; total: number; label: string };

export type DevGenerationState =
  | null
  | "preparing"
  | DevGenStep
  | "completed"
  | { type: "partial-failure"; failedStep: number; stepLabel: string }
  | { type: "full-failure"; message: string };

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TryOnPanelProps {
  open: boolean;
  onClose: () => void;
  handle: string | null;
  garmentTitle: string | null;
  context: "single-piece" | "complete-look";
  naiaModelIsReady: boolean;
  fixtureResults: Record<string, string>;
  devMode: boolean;
  // Complete-look
  completeLookGarments?: GarmentRef[];
  // Closet fixtures — used only when devMode=true; replaces live closet query
  closetFixtures?: DevClosetItem[];
  // Dev generation simulation — when provided, shows the generation flow
  devGenerationState?: DevGenerationState;
  onDevGenerate?: () => void;
  onDevReset?: () => void;
  // Phase 4B1 — passed through to VTO feedback section
  sessionId?: string | null;
  suggestionId?: string | null;
}

type PanelState =
  | "setup-required"
  | "closet-selection"  // complete-look only; user selects closet items
  | "generating"        // dev simulation in progress
  | "has-result"
  | "no-fixture"
  | "not-eligible"
  | "pending-outcome";

function derivePanelState(
  handle: string | null,
  naiaModelIsReady: boolean,
  fixtureResults: Record<string, string>,
  context: "single-piece" | "complete-look",
  devGenState: DevGenerationState,
  showClosetSelection: boolean,
): PanelState {
  if (!naiaModelIsReady) return "setup-required";
  if (showClosetSelection) return "closet-selection";
  if (devGenState === "preparing" || (devGenState !== null && typeof devGenState === "object" && "step" in devGenState)) return "generating";
  if (devGenState === "completed") return "has-result";
  if (!handle) return "no-fixture";
  if (fixtureResults[handle]) return "has-result";
  if (isTryOnEligible(handle)) return "no-fixture";
  return "not-eligible";
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(34,21,22,0.55)",
    zIndex: 9000,
    display: "flex",
    justifyContent: "flex-end",
  },
  panel: {
    width: "min(420px, 100vw)",
    height: "100%",
    background: "#f4f4f1",
    display: "flex",
    flexDirection: "column" as const,
    overflowY: "auto" as const,
    boxShadow: "-8px 0 32px rgba(34,21,22,0.12)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 24px",
    borderBottom: "1px solid rgba(59,5,16,0.08)",
    flexShrink: 0,
  },
  headerLabel: {
    fontFamily: "'Space Mono','Courier New',monospace",
    fontSize: "8px",
    letterSpacing: "3px",
    textTransform: "uppercase" as const,
    color: "#8b2035",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "20px",
    color: "#7a6f6a",
    lineHeight: 1,
    padding: "4px",
  },
  body: {
    padding: "28px 24px",
    flex: 1,
  },
  title: {
    fontFamily: "'Playfair Display',Georgia,serif",
    fontSize: "22px",
    fontWeight: 900,
    fontStyle: "italic" as const,
    color: "#221516",
    marginBottom: "20px",
    lineHeight: 1.3,
  },
  subtitle: {
    fontFamily: "'Space Mono','Courier New',monospace",
    fontSize: "8px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    color: "#8b2035",
    marginBottom: "12px",
  },
  resultImg: {
    width: "100%",
    aspectRatio: "3/4",
    objectFit: "cover" as const,
    display: "block",
    background: "#e8e3df",
    marginBottom: "16px",
  },
  disclaimer: {
    fontFamily: "'Cormorant Garamond',Garamond,serif",
    fontSize: "13px",
    fontStyle: "italic" as const,
    color: "#7a6f6a",
    lineHeight: 1.6,
    marginBottom: "24px",
  },
  bodyText: {
    fontFamily: "'Cormorant Garamond',Garamond,serif",
    fontSize: "16px",
    lineHeight: 1.7,
    color: "#7a6f6a",
    marginBottom: "24px",
  },
  cta: {
    display: "inline-block",
    padding: "13px 24px",
    background: "#221516",
    color: "#f4f4f1",
    fontFamily: "'Space Mono','Courier New',monospace",
    fontSize: "9px",
    letterSpacing: "3px",
    textTransform: "uppercase" as const,
    textDecoration: "none",
    border: "none",
    cursor: "pointer",
  },
  secondaryCta: {
    display: "inline-block",
    padding: "10px 20px",
    background: "none",
    color: "#221516",
    fontFamily: "'Space Mono','Courier New',monospace",
    fontSize: "9px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    textDecoration: "none",
    border: "1px solid rgba(59,5,16,0.25)",
    cursor: "pointer",
    marginTop: "10px",
  },
  devBadge: {
    display: "inline-block",
    padding: "2px 6px",
    background: "#8b2035",
    color: "#f4f4f1",
    fontFamily: "'Space Mono',monospace",
    fontSize: "7px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    marginLeft: "8px",
    verticalAlign: "middle" as const,
  },
  garmentRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid rgba(59,5,16,0.07)",
  },
  garmentLabel: {
    fontFamily: "'Cormorant Garamond',Garamond,serif",
    fontSize: "15px",
    color: "#221516",
    lineHeight: 1.3,
  },
  garmentType: {
    fontFamily: "'Space Mono','Courier New',monospace",
    fontSize: "7px",
    letterSpacing: "2px",
    textTransform: "uppercase" as const,
    color: "#7a6f6a",
    marginBottom: "2px",
  },
  closetSection: {
    marginTop: "24px",
    borderTop: "1px solid rgba(59,5,16,0.08)",
    paddingTop: "20px",
  },
  closetItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    background: "rgba(59,5,16,0.03)",
    marginBottom: "8px",
    cursor: "pointer" as const,
  },
  closetItemSelected: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    background: "rgba(139,32,53,0.08)",
    border: "1px solid #8b2035",
    marginBottom: "8px",
    cursor: "pointer" as const,
  },
  eligibilityBadge: (eligibility: ClosetItemEligibility) => ({
    display: "inline-block",
    padding: "2px 6px",
    fontSize: "7px",
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    fontFamily: "'Space Mono',monospace",
    background:
      eligibility === "ready-for-try-on" ? "#221516" :
      eligibility === "pending-assessment" ? "rgba(59,5,16,0.06)" :
      "rgba(59,5,16,0.06)",
    color:
      eligibility === "ready-for-try-on" ? "#f4f4f1" :
      "#7a6f6a",
  }),
  progressBar: {
    width: "100%",
    height: "2px",
    background: "rgba(59,5,16,0.1)",
    marginBottom: "20px",
    overflow: "hidden" as const,
  },
  progressFill: (pct: number) => ({
    height: "100%",
    background: "#8b2035",
    width: `${pct}%`,
    transition: "width 0.5s ease",
  }),
} as const;

// ── Panel state sub-components ────────────────────────────────────────────────

function SetupRequired() {
  return (
    <>
      <div style={S.title}>Set up your nAia Model first.</div>
      <p style={S.bodyText}>
        To see yourself in a piece, you need a full-body photo and virtual try-on consent on your nAia Model.
      </p>
      <a href="/my-naia-model" style={S.cta}>
        Set Up My nAia Model →
      </a>
    </>
  );
}

// ── VTO feedback section ──────────────────────────────────────────────────────
// Preview usefulness + garment fidelity ONLY.
// Does NOT ask about physical fit or sizing accuracy.

const VTO_INACCURACY_REASONS = [
  { aspect: "garment-looks-inaccurate",       label: "Garment looked inaccurate" },
  { aspect: "layering-looks-inaccurate",      label: "Layering looked inaccurate" },
  { aspect: "colour-looks-inaccurate",        label: "Colour looked inaccurate" },
  { aspect: "accessory-placement-inaccurate", label: "Accessory placement looked inaccurate" },
  { aspect: "useful-despite-differences",     label: "Result was useful despite differences" },
] as const;

type VtoAspect = (typeof VTO_INACCURACY_REASONS)[number]["aspect"];

function VtoFeedbackSection({
  sessionId,
  suggestionId,
}: {
  sessionId?: string | null;
  suggestionId?: string | null;
}) {
  const [rating, setRating] = useState<"love" | "okay" | "not-for-me" | null>(null);
  const [aspects, setAspects] = useState<VtoAspect[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    if (d.ok) {
      setSubmitted(true);
    } else {
      setError(true);
    }
  }, [fetcher.data]);

  const toggleAspect = (a: VtoAspect) => {
    setAspects((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  const handleSubmit = () => {
    if (!rating || isSubmitting) return;
    const vtoAspects: string[] = [...aspects];
    if (rating === "love" && !vtoAspects.includes("preview-useful")) {
      vtoAspects.unshift("preview-useful");
    } else if (rating === "not-for-me" && !vtoAspects.includes("preview-not-useful")) {
      vtoAspects.unshift("preview-not-useful");
    }
    setError(false);
    fetcher.submit(
      {
        _intent: "create",
        sessionId: sessionId ?? null,
        suggestionId: suggestionId ?? null,
        target: "vto-preview",
        shopifyProductId: null,
        closetItemId: null,
        rating,
        reasonCodes: [],
        vtoAspects,
        note: null,
      },
      {
        method: "post",
        action: "/api/recommendation-feedback",
        encType: "application/json",
      },
    );
  };

  const mono = "'Space Mono','Courier New',monospace";
  const serif = "'Cormorant Garamond',Garamond,serif";

  const sectionStyle: React.CSSProperties = {
    marginTop: "20px",
    paddingTop: "16px",
    borderTop: "1px solid rgba(59,5,16,0.08)",
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: mono, fontSize: "7px", letterSpacing: "2px",
    textTransform: "uppercase", color: "#7a6f6a", marginBottom: "10px",
  };
  const chipRow: React.CSSProperties = {
    display: "flex", gap: "6px", flexWrap: "wrap",
  };
  const ratingChip = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px",
    border: active ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.15)",
    background: active ? "rgba(139,32,53,0.08)" : "transparent",
    color: active ? "#8b2035" : "#7a6f6a",
    fontFamily: mono, fontSize: "7px", letterSpacing: "1px",
    textTransform: "uppercase", cursor: "pointer",
  });
  const aspectChip = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    border: active ? "1px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
    background: active ? "rgba(139,32,53,0.06)" : "transparent",
    color: active ? "#8b2035" : "#7a6f6a",
    fontFamily: mono, fontSize: "7px", letterSpacing: "1px",
    cursor: "pointer",
  });
  const submitBtn: React.CSSProperties = {
    marginTop: "10px",
    padding: "6px 14px", background: "#221516", color: "#f4f4f1",
    border: "none", fontFamily: mono, fontSize: "7px", letterSpacing: "2px",
    textTransform: "uppercase", cursor: "pointer",
  };
  const savedStyle: React.CSSProperties = {
    fontFamily: mono, fontSize: "7px", letterSpacing: "2px",
    textTransform: "uppercase", color: "#8b2035",
  };

  if (submitted) {
    return (
      <div style={sectionStyle}>
        <span style={savedStyle}>Preview feedback saved</span>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <div style={labelStyle}>Was this preview helpful?</div>
      <div style={chipRow}>
        {([
          { value: "love" as const,         label: "Helpful preview" },
          { value: "okay" as const,         label: "Somewhat helpful" },
          { value: "not-for-me" as const,   label: "Not helpful" },
        ] as const).map(({ value, label }) => (
          <button key={value} style={ratingChip(rating === value)} onClick={() => setRating(value)}>
            {label}
          </button>
        ))}
      </div>

      {rating && (
        <div style={{ marginTop: "10px" }}>
          <div style={{ ...labelStyle, marginBottom: "6px", marginTop: "4px" }}>
            Any details? <span style={{ color: "#c5bdb9" }}>optional</span>
          </div>
          <div style={{ ...chipRow, marginBottom: "8px" }}>
            {VTO_INACCURACY_REASONS.map(({ aspect, label }) => (
              <button key={aspect} style={aspectChip(aspects.includes(aspect))} onClick={() => toggleAspect(aspect)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontFamily: mono, fontSize: "7px", color: "#8b2035", marginTop: "6px" }}>
          Couldn't save — try again
        </div>
      )}

      {rating && (
        <button style={submitBtn} onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Submit"}
        </button>
      )}
    </div>
  );
}

function HasResult({
  imgUrl,
  garmentTitle,
  context,
  onReset,
  devMode,
  sessionId,
  suggestionId,
}: {
  imgUrl: string;
  garmentTitle: string | null;
  context: "single-piece" | "complete-look";
  onReset?: () => void;
  devMode: boolean;
  sessionId?: string | null;
  suggestionId?: string | null;
}) {
  const headingPrefix = context === "complete-look" ? "Your look: " : "You in ";
  return (
    <>
      <div style={S.title}>
        {headingPrefix}{garmentTitle ?? "this piece"}
      </div>
      <img
        src={imgUrl}
        alt={`Virtual try-on result for ${garmentTitle ?? "this piece"}`}
        style={S.resultImg}
      />
      <p style={S.disclaimer}>{PROVIDER_DISCLAIMER}</p>
      <VtoFeedbackSection sessionId={sessionId} suggestionId={suggestionId} />
      {devMode && onReset && (
        <button style={S.secondaryCta} onClick={onReset}>
          Reset (dev)
        </button>
      )}
    </>
  );
}

function NotAvailable() {
  return (
    <>
      <div style={S.title}>Not available for this piece.</div>
      <p style={S.bodyText}>
        Virtual preview isn't available for this piece yet. More pieces are on their way.
      </p>
    </>
  );
}

function EligibilityLabel({ eligibility }: { eligibility: ClosetItemEligibility }) {
  const labels: Record<ClosetItemEligibility, string> = {
    "ready-for-try-on": "Ready",
    "pending-assessment": "Assessing…",
    "needs-clearer-photo": "Retake photo",
    "not-supported": "Not supported",
  };
  return (
    <span style={S.eligibilityBadge(eligibility)}>
      {labels[eligibility]}
    </span>
  );
}

// ── Garment sequence list ─────────────────────────────────────────────────────

function GarmentSequence({ garments }: { garments: GarmentRef[] }) {
  if (!garments.length) return null;
  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={S.subtitle}>Layering order</div>
      {garments.map((g, i) => (
        <div key={g.handle} style={S.garmentRow}>
          <div>
            <div style={S.garmentType}>{String(i + 1).padStart(2, "0")} · {g.itemType}</div>
            <div style={S.garmentLabel}>{g.title}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Closet item picker ────────────────────────────────────────────────────────

function ClosetPicker({
  items,
  category,
  label,
  selected,
  onSelect,
}: {
  items: DevClosetItem[];
  category: "clothing" | "bag" | "shoes";
  label: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const filtered = items.filter((i) => i.category === category);
  if (!filtered.length) return null;
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={S.subtitle}>{label} <span style={{ color: "#c5bdb9" }}>optional</span></div>
      {filtered.map((item) => {
        const isSelected = selected === item.id;
        const canSelect = item.eligibility === "ready-for-try-on";
        return (
          <div
            key={item.id}
            style={isSelected ? S.closetItemSelected : S.closetItem}
            onClick={() => canSelect ? onSelect(isSelected ? null : item.id) : undefined}
            role={canSelect ? "button" : undefined}
            aria-pressed={isSelected}
            tabIndex={canSelect ? 0 : undefined}
          >
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "14px", color: "#221516", marginBottom: "3px" }}>
                {item.name}
              </div>
              {item.eligibility === "needs-clearer-photo" && item.customerHint && (
                <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "12px", color: "#8b2035", fontStyle: "italic" }}>
                  {item.customerHint}
                </div>
              )}
            </div>
            <EligibilityLabel eligibility={item.eligibility} />
          </div>
        );
      })}
    </div>
  );
}

// ── Generation states ─────────────────────────────────────────────────────────

function GeneratingState({ genState }: { genState: DevGenerationState }) {
  if (genState === "preparing") {
    return (
      <>
        <div style={S.title}>Preparing your look…</div>
        <div style={S.progressBar}><div style={S.progressFill(10)} /></div>
        <p style={S.bodyText}>Getting your model and garment images ready.</p>
      </>
    );
  }
  if (genState && typeof genState === "object" && "step" in genState) {
    const pct = Math.round((genState.step / genState.total) * 80) + 10;
    return (
      <>
        <div style={S.title}>Generating your look…</div>
        <div style={S.progressBar}><div style={S.progressFill(pct)} /></div>
        <div style={S.subtitle}>Step {genState.step} of {genState.total} · {genState.label}</div>
        <p style={S.bodyText}>Each garment is layered in order. This takes a moment.</p>
      </>
    );
  }
  return null;
}

function PartialFailure({ failedStep, stepLabel, onReset }: { failedStep: number; stepLabel: string; onReset?: () => void }) {
  return (
    <>
      <div style={S.title}>Partial result.</div>
      <p style={S.bodyText}>
        Step {failedStep} ({stepLabel}) couldn't be generated. The rest of the look completed successfully.
      </p>
      {onReset && <button style={S.secondaryCta} onClick={onReset}>Try again (dev)</button>}
    </>
  );
}

function FullFailure({ message, onReset }: { message: string; onReset?: () => void }) {
  return (
    <>
      <div style={S.title}>Preview unavailable.</div>
      <p style={S.bodyText}>{message}</p>
      {onReset && <button style={S.secondaryCta} onClick={onReset}>Try again (dev)</button>}
    </>
  );
}

// ── Closet selection view ─────────────────────────────────────────────────────

function ClosetSelectionView({
  garments,
  closetFixtures,
  selectedClothing,
  selectedBag,
  selectedShoes,
  onSelectClothing,
  onSelectBag,
  onSelectShoes,
  onGenerate,
}: {
  garments: GarmentRef[];
  closetFixtures: DevClosetItem[];
  selectedClothing: string | null;
  selectedBag: string | null;
  selectedShoes: string | null;
  onSelectClothing: (id: string | null) => void;
  onSelectBag: (id: string | null) => void;
  onSelectShoes: (id: string | null) => void;
  onGenerate: () => void;
}) {
  return (
    <>
      <GarmentSequence garments={garments} />
      <div style={S.closetSection}>
        <div style={S.subtitle}>Add from your closet</div>
        <ClosetPicker
          items={closetFixtures}
          category="clothing"
          label="Clothing"
          selected={selectedClothing}
          onSelect={onSelectClothing}
        />
        <ClosetPicker
          items={closetFixtures}
          category="bag"
          label="Bag"
          selected={selectedBag}
          onSelect={onSelectBag}
        />
        <ClosetPicker
          items={closetFixtures}
          category="shoes"
          label="Shoes"
          selected={selectedShoes}
          onSelect={onSelectShoes}
        />
      </div>
      <button style={{ ...S.cta, marginTop: "28px", width: "100%", textAlign: "center" }} onClick={onGenerate}>
        Preview this look →
      </button>
      <p style={{ ...S.disclaimer, marginTop: "16px" }}>
        {PROVIDER_DISCLAIMER}
      </p>
    </>
  );
}

// ── TryOnPanel ────────────────────────────────────────────────────────────────

export function TryOnPanel({
  open,
  onClose,
  handle,
  garmentTitle,
  context,
  naiaModelIsReady,
  fixtureResults,
  devMode,
  completeLookGarments = [],
  closetFixtures = [],
  devGenerationState = null,
  onDevGenerate,
  onDevReset,
  sessionId = null,
  suggestionId = null,
}: TryOnPanelProps) {
  const [showClosetSelection, setShowClosetSelection] = useState(false);
  const [selectedClothing, setSelectedClothing] = useState<string | null>(null);
  const [selectedBag, setSelectedBag] = useState<string | null>(null);
  const [selectedShoes, setSelectedShoes] = useState<string | null>(null);

  // Reset closet selection when panel opens/closes
  useEffect(() => {
    if (!open) {
      setShowClosetSelection(false);
      setSelectedClothing(null);
      setSelectedBag(null);
      setSelectedShoes(null);
    } else if (context === "complete-look" && naiaModelIsReady && devMode) {
      setShowClosetSelection(true);
    }
  }, [open, context, naiaModelIsReady, devMode]);

  const handleGenerate = useCallback(() => {
    setShowClosetSelection(false);
    onDevGenerate?.();
  }, [onDevGenerate]);

  const handleReset = useCallback(() => {
    setShowClosetSelection(context === "complete-look" && devMode);
    onDevReset?.();
  }, [onDevReset, context, devMode]);

  // Fire-and-forget vto_initiated event when panel first shows a result
  const vtoEventFetcher = useFetcher<{ ok: boolean }>();
  const vtoInitFiredRef = useRef(false);
  const hasFixtureForHandle = !!handle && !!fixtureResults[handle];

  useEffect(() => {
    if (!open) { vtoInitFiredRef.current = false; return; }
    const hasResult = naiaModelIsReady && (devGenerationState === "completed" || hasFixtureForHandle);
    if (!hasResult || vtoInitFiredRef.current || !sessionId || !handle) return;
    vtoInitFiredRef.current = true;
    vtoEventFetcher.submit(
      {
        productHandle: handle,
        sessionId,
        context: context === "complete-look" ? "styleme-complete-look" : "styleme-single-piece",
      },
      { method: "post", action: "/api/vto-event", encType: "application/json" },
    );
  }, [open, naiaModelIsReady, devGenerationState, hasFixtureForHandle, sessionId, context, handle, vtoEventFetcher]);

  if (!open) return null;

  const state = derivePanelState(
    handle,
    naiaModelIsReady,
    fixtureResults,
    context,
    devGenerationState,
    showClosetSelection,
  );

  const headerText =
    context === "complete-look" ? "Complete Look Try-On" : "Virtual Try-On";

  // Resolve result image: dev generation result → fixture results map
  const resultImgUrl =
    devGenerationState === "completed" && handle && fixtureResults[handle]
      ? fixtureResults[handle]
      : handle && fixtureResults[handle]
      ? fixtureResults[handle]
      : null;

  return (
    <div style={S.overlay} onClick={onClose} aria-modal="true" role="dialog">
      <div style={S.panel} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <span style={S.headerLabel}>
            {headerText}
            {devMode && <span style={S.devBadge}>dev</span>}
          </span>
          <button style={S.closeBtn} onClick={onClose} aria-label="Close try-on panel">
            ×
          </button>
        </div>
        <div style={S.body}>

          {state === "setup-required" && <SetupRequired />}

          {state === "closet-selection" && (
            <ClosetSelectionView
              garments={completeLookGarments}
              closetFixtures={closetFixtures}
              selectedClothing={selectedClothing}
              selectedBag={selectedBag}
              selectedShoes={selectedShoes}
              onSelectClothing={setSelectedClothing}
              onSelectBag={setSelectedBag}
              onSelectShoes={setSelectedShoes}
              onGenerate={handleGenerate}
            />
          )}

          {state === "generating" && (
            <GeneratingState genState={devGenerationState} />
          )}

          {state === "has-result" && resultImgUrl && (
            <HasResult
              imgUrl={resultImgUrl}
              garmentTitle={garmentTitle}
              context={context}
              onReset={devMode ? handleReset : undefined}
              devMode={devMode}
              sessionId={sessionId}
              suggestionId={suggestionId}
            />
          )}

          {state === "has-result" && !resultImgUrl && <NotAvailable />}

          {(state === "no-fixture" || state === "not-eligible" || state === "pending-outcome") && (
            <NotAvailable />
          )}

          {devGenerationState && typeof devGenerationState === "object" && "type" in devGenerationState && devGenerationState.type === "partial-failure" && (
            <PartialFailure
              failedStep={devGenerationState.failedStep}
              stepLabel={devGenerationState.stepLabel}
              onReset={handleReset}
            />
          )}

          {devGenerationState && typeof devGenerationState === "object" && "type" in devGenerationState && devGenerationState.type === "full-failure" && (
            <FullFailure message={devGenerationState.message} onReset={handleReset} />
          )}

        </div>
      </div>
    </div>
  );
}
