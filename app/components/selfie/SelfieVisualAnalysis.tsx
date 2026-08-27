// Shared Visual Analysis display — used by both /passport (chapter) and /passport/selfie (utility flow).
// Renders completed SelfieStyleSignals; handles v1 and v2 field variants gracefully.
// Does NOT include upload, consent, moderation, or storage-choice UI — those stay in passport.selfie.tsx.

import type { SelfieStyleSignals } from "~/lib/ai/selfie-analysis";
import {
  buildContrastNote,
  buildNecklineSummary,
} from "~/lib/ai/selfie-styling-signals";

// ── Sub-components ─────────────────────────────────────────────────────────────

export function AnalysisSubsection({
  title,
  children,
  first,
}: {
  title: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: first ? "16px" : "24px",
        ...(first ? {} : { paddingTop: "20px", borderTop: "1px solid var(--naia-border)" }),
      }}
    >
      <div
        style={{
          fontFamily: "var(--naia-ff-ui)",
          fontSize: "10px",
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: "var(--naia-muted)",
          marginBottom: "12px",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sp-detail-row">
      <dt className="sp-detail-label">{label}</dt>
      <dd className="sp-detail-value">{value}</dd>
    </div>
  );
}

export function SwatchGroup({
  label,
  swatches,
}: {
  label: string;
  swatches: Array<{ name: string; hex: string }>;
}) {
  return (
    <div style={{ marginTop: "14px" }}>
      <div
        style={{
          fontFamily: "var(--naia-ff-ui)",
          fontSize: "11px",
          letterSpacing: "0.4px",
          color: "var(--naia-muted)",
          marginBottom: "8px",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        {swatches.map(s => (
          <div
            key={s.hex + s.name}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: s.hex,
                border: "1px solid rgba(0,0,0,0.1)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "var(--naia-ff-ui)",
                fontSize: "10px",
                textAlign: "center",
                color: "var(--naia-muted)",
                maxWidth: "58px",
                lineHeight: 1.3,
              }}
            >
              {s.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TieredChips({
  top,
  also,
  careful,
}: {
  top?: string[];
  also?: string[];
  careful?: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {top && top.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--naia-muted)",
              marginBottom: "6px",
            }}
          >
            Most Flattering
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {top.map(item => (
              <span
                key={item}
                style={{
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  border: "1px solid var(--naia-border)",
                  background: "rgba(34,21,22,0.04)",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
      {also && also.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--naia-muted)",
              marginBottom: "6px",
            }}
          >
            Also Works
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {also.map(item => (
              <span
                key={item}
                style={{
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  border: "1px solid var(--naia-border)",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
      {careful && careful.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--naia-muted)",
              marginBottom: "6px",
            }}
          >
            Use Carefully
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {careful.map(item => (
              <span
                key={item}
                style={{
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  border: "1px dashed var(--naia-border)",
                  opacity: 0.75,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main display component ─────────────────────────────────────────────────────

export function SelfieVisualAnalysis({ signals }: { signals: SelfieStyleSignals }) {
  return (
    <>
      <AnalysisSubsection title="Face & Feature Profile" first>
        <dl className="sp-detail-list">
          <SignalRow label="Face Shape" value={signals.faceShapeDirection} />
          {signals.featureBalance && <SignalRow label="Feature Balance" value={signals.featureBalance} />}
          {signals.eyeShape && <SignalRow label="Eye Shape" value={signals.eyeShape} />}
          {signals.browShape && <SignalRow label="Brow Shape" value={signals.browShape} />}
          {signals.lipShape && <SignalRow label="Lip Shape" value={signals.lipShape} />}
          <SignalRow label="Contrast" value={buildContrastNote(signals.contrastLevel)} />
        </dl>
      </AnalysisSubsection>

      <AnalysisSubsection title="Colour Direction">
        {signals.colourTemperature && (
          <div style={{ marginBottom: "12px" }}>
            <span style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", letterSpacing: "0.4px", padding: "3px 10px", border: "1px solid var(--naia-border)", textTransform: "capitalize" }}>
              {signals.colourTemperature} tone
            </span>
          </div>
        )}
        <dl className="sp-detail-list">
          <SignalRow label="Colour Families" value={signals.colourFamilies.join(", ")} />
        </dl>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65, marginTop: "8px" }}>
          {signals.colourExplanation}
        </p>
        {signals.bestNeutrals && signals.bestNeutrals.length > 0 && (
          <SwatchGroup label="Best Neutrals" swatches={signals.bestNeutrals} />
        )}
        {signals.everydayColours && signals.everydayColours.length > 0 && (
          <SwatchGroup label="Everyday Colours" swatches={signals.everydayColours} />
        )}
        {signals.accentColours && signals.accentColours.length > 0 && (
          <SwatchGroup label="Accent Colours" swatches={signals.accentColours} />
        )}
        {signals.useCareNearFace && signals.useCareNearFace.length > 0 && (
          <SwatchGroup label="Use Carefully Near Face" swatches={signals.useCareNearFace} />
        )}
      </AnalysisSubsection>

      <AnalysisSubsection title="Necklines">
        {signals.necklinesTop && signals.necklinesTop.length > 0 ? (
          <TieredChips
            top={signals.necklinesTop}
            also={signals.necklinesAlso}
            careful={signals.necklinesCareful}
          />
        ) : (
          <dl className="sp-detail-list">
            <SignalRow label="Necklines" value={buildNecklineSummary(signals)} />
          </dl>
        )}
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65, marginTop: "10px" }}>
          {signals.necklineExplanation}
        </p>
      </AnalysisSubsection>

      <AnalysisSubsection title="Jewellery">
        <dl className="sp-detail-list">
          <SignalRow
            label="Earrings"
            value={signals.earringsTop?.length
              ? signals.earringsTop.join(", ")
              : signals.earringsDirection}
          />
          {signals.earringsScale && <SignalRow label="Scale" value={signals.earringsScale} />}
          {signals.necklaceLengths && signals.necklaceLengths.length > 0 && (
            <SignalRow label="Necklaces" value={signals.necklaceLengths.join(", ")} />
          )}
          {signals.metalDirection && <SignalRow label="Metal" value={signals.metalDirection} />}
        </dl>
      </AnalysisSubsection>

      <AnalysisSubsection title="Glasses">
        {signals.glassesTop && signals.glassesTop.length > 0 ? (
          <TieredChips
            top={signals.glassesTop}
            also={signals.glassesAlso}
            careful={signals.glassesCareful}
          />
        ) : (
          <dl className="sp-detail-list">
            <SignalRow label="Frames" value={signals.glassesFrameDirection} />
          </dl>
        )}
      </AnalysisSubsection>

      <AnalysisSubsection title="Hair Direction">
        <dl className="sp-detail-list">
          <SignalRow label="Length" value={signals.hairLengthDirection} />
          <SignalRow label="Volume" value={signals.hairVolumeDirection} />
          <SignalRow label="Parting" value={signals.hairPartingDirection} />
          {signals.hairLayers && <SignalRow label="Layers" value={signals.hairLayers} />}
          {signals.hairTextureDirection && <SignalRow label="Texture" value={signals.hairTextureDirection} />}
          {signals.hairUpdoDirection && <SignalRow label="Updo" value={signals.hairUpdoDirection} />}
          {signals.hairColourFamilies && signals.hairColourFamilies.length > 0 && (
            <SignalRow label="Hair Colour" value={signals.hairColourFamilies.join(", ")} />
          )}
        </dl>
      </AnalysisSubsection>

      {(signals.makeupComplexionFinish || signals.makeupBlush ||
        signals.makeupEyeshadow || signals.makeupLipsEveryday ||
        signals.makeupLipsRich || signals.makeupColourDirection) && (
        <AnalysisSubsection title="Makeup Direction">
          <dl className="sp-detail-list">
            {signals.makeupComplexionFinish && <SignalRow label="Complexion" value={signals.makeupComplexionFinish} />}
            {signals.makeupBlush && <SignalRow label="Blush" value={signals.makeupBlush} />}
            {signals.makeupEyeshadow && <SignalRow label="Eyeshadow" value={signals.makeupEyeshadow} />}
            {signals.makeupLipsEveryday && <SignalRow label="Everyday Lip" value={signals.makeupLipsEveryday} />}
            {signals.makeupLipsRich && <SignalRow label="Evening Lip" value={signals.makeupLipsRich} />}
            {!signals.makeupComplexionFinish && signals.makeupColourDirection && (
              <SignalRow label="Colour Direction" value={signals.makeupColourDirection} />
            )}
          </dl>
        </AnalysisSubsection>
      )}

      {signals.styleFormula && signals.styleFormula.length > 0 && (
        <AnalysisSubsection title="Visual Style Formula">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
            {signals.styleFormula.map(tag => (
              <span
                key={tag}
                style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "12px", letterSpacing: "0.4px", padding: "6px 14px", border: "1px solid var(--naia-border)" }}
              >
                {tag}
              </span>
            ))}
          </div>
          {signals.styleFormulaNote && (
            <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", lineHeight: 1.65 }}>
              {signals.styleFormulaNote}
            </p>
          )}
        </AnalysisSubsection>
      )}
    </>
  );
}
