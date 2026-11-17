// app/components/checkout/TermsAcceptanceCheckbox.tsx
//
// Reusable Terms-of-Service acceptance control (Legal handoff W1,
// 2026-11-17). Deliberately presentational and unwired — it renders a
// checkbox and a label, nothing else. Whoever owns the checkout flow
// decides WHERE this renders and what happens on submit (calling
// recordTermsAcceptance from terms-acceptance.server.ts); this component
// makes no assumptions about that action, so it can be dropped into any
// form without this file needing to change.
//
// LEGAL CONTENT NOTE: the label text states only that acceptance is
// required to proceed — it does not attempt to summarize OR link to the
// actual Terms of Service, since that document doesn't exist yet (see
// MyNaiaLayout's footer, "Terms of Service" still pending). Linking to
// a placeholder would be worse than not linking at all — the checkbox
// stays plain text until there's a real destination to point to.

export interface TermsAcceptanceCheckboxProps {
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  // Surfaced so a caller can block submission until this is true —
  // kept out of this component's own responsibility, since "can the
  // customer proceed" is a checkout-flow decision, not a checkbox's.
  required?: boolean;
}

export default function TermsAcceptanceCheckbox({
  name = "termsAccepted",
  checked,
  onChange,
  disabled = false,
  required = true,
}: TermsAcceptanceCheckboxProps) {
  return (
    <label className="terms-acceptance-checkbox">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>I have read and accept the Terms of Service.</span>
    </label>
  );
}
