// app/components/VtoExperience.tsx
// Production VTO trigger UI — shown on StyleMe result, Closet, and Buy/Skip
// when vtoEnabled (staging gate).
//
// Security / legal contract:
//   - Eligibility is the CALLER's responsibility; this component renders if mounted.
//   - isAuthenticated check is the only guard inside this component.
//   - Result image is always accompanied by PROVIDER_DISCLAIMER.
//   - Never implies fit, size, or body shape certainty.
//   - No body data is sent or received by this component; see useTryOn.ts.
//   - resultUrl comes from the server only; this component never constructs or stores it.

import { useTryOn, type VtoSource } from "~/hooks/useTryOn";
import { PROVIDER_DISCLAIMER } from "~/lib/ai/virtual-try-on.types";

export type { VtoSource };

export type VtoExperienceProps = VtoSource & {
  garmentTitle: string;
  naiaModelIsReady: boolean;
  isAuthenticated: boolean;
};

// Outer guard — skips hook entirely when unauthenticated.
// Eligibility is the CALLER's responsibility (NADINE catalog uses isTryOnEligible;
// Closet uses tryOnEligibility === "ready-for-try-on"; BuySkip uses !!imagePublicId).
export function VtoExperience({ isAuthenticated, garmentTitle, naiaModelIsReady, ...vtoSource }: VtoExperienceProps) {
  if (!isAuthenticated) return null;

  return (
    <VtoExperienceInner
      vtoSource={vtoSource as VtoSource}
      garmentTitle={garmentTitle}
      naiaModelIsReady={naiaModelIsReady}
    />
  );
}

interface InnerProps {
  vtoSource: VtoSource;
  garmentTitle: string;
  naiaModelIsReady: boolean;
}

function VtoExperienceInner({ vtoSource, garmentTitle, naiaModelIsReady }: InnerProps) {
  const { state, trigger, reset } = useTryOn(vtoSource);

  // Model not set up — CTA to configure
  if (!naiaModelIsReady) {
    return (
      <div style={{ marginTop: "16px" }}>
        <a
          href="/my-naia-model"
          className="sm-result-action-btn sm-result-action-btn--accent"
          style={{ fontSize: "8px", letterSpacing: "2px", padding: "10px 20px", display: "inline-block" }}
        >
          See This On Me — Set Up nAia Model
        </a>
      </div>
    );
  }

  if (state.tag === "idle") {
    return (
      <div style={{ marginTop: "16px" }}>
        <button
          onClick={trigger}
          className="sm-result-action-btn sm-result-action-btn--accent"
          style={{ fontSize: "8px", letterSpacing: "2px", padding: "10px 20px" }}
        >
          See This On Me
        </button>
      </div>
    );
  }

  if (state.tag === "submitting") {
    return (
      <div style={{ marginTop: "16px" }}>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", color: "var(--naia-muted)" }}>
          Preparing your visual preview…
        </p>
      </div>
    );
  }

  if (state.tag === "polling") {
    return (
      <div style={{ marginTop: "16px" }}>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", color: "var(--naia-muted)" }}>
          Creating your visual preview — this takes about 30 seconds…
        </p>
      </div>
    );
  }

  if (state.tag === "failed") {
    return (
      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", color: "var(--naia-muted)" }}>
          {state.message}
        </p>
        <button
          onClick={reset}
          className="sm-result-action-btn"
          style={{ fontSize: "8px", letterSpacing: "2px", alignSelf: "flex-start" }}
        >
          Try Again
        </button>
      </div>
    );
  }

  if (state.tag === "completed") {
    return (
      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <img
          src={state.resultUrl}
          alt={`Visual preview — ${garmentTitle}`}
          style={{
            width: "100%",
            maxWidth: "320px",
            borderRadius: "4px",
            objectFit: "cover",
          }}
        />
        <p style={{
          fontFamily: "var(--naia-ff-body)",
          fontSize: "12px",
          fontStyle: "italic",
          color: "var(--naia-muted)",
          lineHeight: 1.5,
          maxWidth: "320px",
        }}>
          {PROVIDER_DISCLAIMER}
        </p>
        <button
          onClick={reset}
          className="sm-result-action-btn"
          style={{ fontSize: "8px", letterSpacing: "2px", alignSelf: "flex-start" }}
        >
          Close Preview
        </button>
      </div>
    );
  }

  return null;
}
