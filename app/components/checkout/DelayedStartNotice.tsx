// app/components/checkout/DelayedStartNotice.tsx
//
// Delayed-start confirmation — Founder Decision 2 (2026-11-17). Shown
// when the EarlyServiceConsentCheckbox is left unchecked: states the
// actual service-start and first-billing dates plainly, so "unchecked"
// never reads as "nothing happens" or silently activates paid service
// now. Purely presentational — dates come from computeDelayedStart
// (delayed-start.ts), this component only renders them.

import { formatDelayedStartDate, type DelayedStartDates } from "~/lib/delayed-start";

export interface DelayedStartNoticeProps {
  dates: DelayedStartDates;
}

export default function DelayedStartNotice({ dates }: DelayedStartNoticeProps) {
  return (
    <div className="delayed-start-notice" role="status">
      <p>
        Your membership will not start today. Service begins on{" "}
        <strong>{formatDelayedStartDate(dates.serviceStartDate)}</strong>, and you will be billed on that
        same date — not before.
      </p>
      <p className="delayed-start-notice-note">
        You can change this and start immediately at any time before then.
      </p>
    </div>
  );
}
