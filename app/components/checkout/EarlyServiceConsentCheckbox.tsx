// app/components/checkout/EarlyServiceConsentCheckbox.tsx
//
// Express early-service-start consent control (Legal handoff W1,
// 2026-11-17 — "a separate, unchecked express early-service request and
// a delayed-start option if unchecked"). Purely presentational and
// UNWIRED: it starts unchecked, as required, and has no onChange default
// that could make it opt-out instead of opt-in.
//
// Deliberately carries NO persistence of its own. Where this gets
// recorded (a Subscription field, a separate consent table) and what
// "delayed start" actually means operationally are checkout/billing
// decisions — this component only renders the control and reports its
// current value via onChange; whoever owns checkout decides what to do
// with that value on submit.
//
// LEGAL CONTENT NOTE: the exact statutory consequence of checking this
// box (what right is being waived, for how long) is Legal's wording to
// write, not an engineering guess — the bracketed placeholder below is
// deliberately visible rather than filled in with invented legal text.

export interface EarlyServiceConsentCheckboxProps {
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export default function EarlyServiceConsentCheckbox({
  name = "earlyServiceConsent",
  checked,
  onChange,
  disabled = false,
}: EarlyServiceConsentCheckboxProps) {
  return (
    <label className="early-service-consent-checkbox">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        I want my membership to start immediately. [Exact statutory consequence of this choice — pending Legal
        sign-off.] Leaving this unchecked delays activation instead.
      </span>
    </label>
  );
}
