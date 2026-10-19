// app/routes/onboarding.age-confirm.tsx
//
// Priority 5 (2026-10-19) — mandatory age declaration.
//
// Standalone interstitial, not a numbered Passport question — kept
// separate from onboarding/step.$step.tsx's question bank entirely so
// adding it never shifts a later step number. Reached via the redirect in
// either onboarding/step.$step.tsx's loader (new/returning-to-onboarding
// customers) or my-naia._index.tsx's loader (the existing-customer
// backfill, 2026-10-19) when hasConfirmedCurrentAge(customer) is false;
// once confirmed, redirects back to `next` — validated against an exact
// allowlist (an onboarding step, or the /my-naia hub) so it can never
// become an open redirect. Falls back to /my-naia, not step 1, for
// anything else — that default must stay safe for both entry paths.
//
// There is no "I am not 18+" path: the single control is an affirmative,
// required checkbox, same shape as every other consent control in this
// app (passport.selfie.tsx, my-naia-model). A customer who will not check
// it simply cannot proceed past this page.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, redirect } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { hasConfirmedCurrentAge, recordAgeConfirmation } from "~/lib/age-confirmation.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links = () => [{ rel: "stylesheet", href: naiaStyles }];

export function meta() {
  return [{ title: "Confirm Your Age | nAia" }];
}

function safeNextPath(raw: string | null): string {
  if (raw === "/my-naia") return raw;
  if (raw && /^\/onboarding\/step\/\d+$/.test(raw)) return raw;
  return "/my-naia";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));

  if (hasConfirmedCurrentAge(customer)) {
    return redirect(next);
  }
  return { next };
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const next = safeNextPath(formData.get("next") as string | null);

  if (formData.get("ageConfirmed") !== "true") {
    return { error: "Please confirm your age to continue." };
  }

  await recordAgeConfirmation(customer.id);
  return redirect(next);
}

export default function OnboardingAgeConfirm() {
  const { next } = useLoaderData<typeof loader>();

  return (
    <div className="sp-shell">
      <div className="sp-shell-eyebrow">Before we begin</div>
      <h1 className="sp-shell-title">CONFIRM YOUR <span className="sp-shell-accent">age.</span></h1>
      <p className="sp-shell-desc">
        nAia's styling service is intended for adults. Please confirm before continuing with your
        Style Passport.
      </p>

      <Form method="post">
        <input type="hidden" name="next" value={next} />
        <div style={{ marginBottom: "20px", padding: "16px 20px", background: "rgba(34,21,22,0.03)", border: "1px solid var(--naia-border)" }}>
          <label className="psa-consent-row">
            <input type="checkbox" name="ageConfirmed" value="true" id="age-confirmed" required className="psa-consent-check" />
            <span>I confirm that I am 18 years of age or older.</span>
          </label>
        </div>
        <button type="submit" className="sp-btn-primary">
          Continue
        </button>
      </Form>
    </div>
  );
}
