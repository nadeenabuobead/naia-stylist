// app/components/checkout/EarlyServiceConsentCheckbox.tsx
//
// Express early-service-start consent control — Founder Decision 2
// (2026-11-17): approved checkbox label and explanation text, provided
// verbatim below, superseding the earlier bracketed placeholder. Purely
// presentational and UNWIRED: starts unchecked, as required, and has no
// onChange default that could make it opt-out instead of opt-in.
//
// Deliberately carries NO persistence of its own. Where this gets
// recorded (a Subscription field, a separate consent table) and what
// "delayed start" actually means operationally are checkout/billing
// decisions — this component only renders the control and reports its
// current value via onChange; whoever owns checkout decides what to do
// with that value on submit.
//
// Decision 2 is explicit that checking this box does NOT waive the
// statutory withdrawal right, and does not introduce an immediate
// digital-content waiver — the explanation text says so directly. Do
// not alter that text to imply otherwise.

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
    <div className="early-service-consent">
      <label className="early-service-consent-checkbox">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          I expressly request that my nAia Membership starts immediately, before any applicable statutory
          withdrawal period ends.
        </span>
      </label>
      <p className="early-service-consent-explanation">
        Starting now does not itself remove your statutory withdrawal right. If you qualify for statutory
        withdrawal and exercise it within the applicable period, we will refund your membership payment in
        full, without deducting for membership usage. This does not create a voluntary refund right where no
        statutory right applies.
      </p>
    </div>
  );
}
