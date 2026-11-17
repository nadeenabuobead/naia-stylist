// app/routes/my-naia.withdrawal-request.tsx
//
// EU statutory right-of-withdrawal REQUEST capture (Legal handoff W2,
// 2026-11-17). Deliberately separate from ordinary subscription
// cancellation — this page and its action never touch
// Subscription.cancelAtPeriodEnd or any cancellation field. See
// withdrawal-request.server.ts's own header for the full reasoning.
//
// LEGAL CONTENT NOTE: the explanatory copy below describes what this
// mechanism actually does (procedural fact, safe to state) — it does NOT
// assert a specific statutory deadline or waiver term, since that wording
// needs Legal's sign-off, not an engineering guess. The bracketed
// placeholder is deliberately visible, not filled in, matching the same
// "honest pending" treatment already used for Privacy Policy/Terms of
// Service elsewhere in this app, rather than a disguised dead end.

import { useState } from "react";
import { Form, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/my-naia.withdrawal-request";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { submitWithdrawalRequest, getWithdrawalRequestsForCustomer } from "~/lib/withdrawal-request.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export function links() {
  return [{ rel: "stylesheet", href: naiaStyles }];
}

type PriorWithdrawalRequest = Awaited<ReturnType<typeof getWithdrawalRequestsForCustomer>>[number];

export async function loader({ request }: Route.LoaderArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const priorRequests = await getWithdrawalRequestsForCustomer(customer.id);
  return {
    needsEmailConfirmation: !customer.email,
    knownEmail: customer.email ?? "",
    knownName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null,
    priorRequests: priorRequests.map((r: PriorWithdrawalRequest) => ({
      reference: r.reference,
      submittedAt: r.submittedAt.toISOString(),
      status: r.status,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const confirmedEmail = String(formData.get("confirmedEmail") ?? "").trim();
  const email = customer.email ?? confirmedEmail;

  if (!email || !email.includes("@")) {
    return { ok: false as const, error: "A valid email is required to identify this request." };
  }

  const created = await submitWithdrawalRequest({
    customerId: customer.id,
    customerEmailAtRequest: email,
    customerNameAtRequest: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null,
  });

  return { ok: true as const, reference: created.reference, submittedAt: created.submittedAt.toISOString() };
}

export default function WithdrawalRequestPage() {
  const { needsEmailConfirmation, knownEmail, knownName, priorRequests } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [confirmedEmail, setConfirmedEmail] = useState("");

  return (
    <MyNaiaLayout>
      <div className="wr-page">
        <h1>Withdrawal request.</h1>
        <p>
          This submits a formal request to exercise your statutory right of withdrawal, separate from
          cancelling your membership. [Exact statutory window and terms — pending Legal sign-off.]
          Submitting a cancellation instead? That's handled from{" "}
          <a href="/my-naia/plan-usage">Plans &amp; usage</a>, not here.
        </p>

        {actionData?.ok ? (
          <div className="wr-confirmation" role="status">
            <h2>Request received.</h2>
            <p>
              Reference <strong>{actionData.reference}</strong>, submitted{" "}
              {new Date(actionData.submittedAt).toLocaleString()}.
            </p>
            <p>Keep this reference — it's your durable record that this request was made.</p>
          </div>
        ) : (
          <Form method="post" className="wr-form">
            <p>
              Submitting as: <strong>{knownName ?? "—"}</strong>
              {!needsEmailConfirmation && <> ({knownEmail})</>}
            </p>
            {needsEmailConfirmation && (
              <label>
                Confirm your email to identify this request
                <input
                  type="email"
                  name="confirmedEmail"
                  required
                  value={confirmedEmail}
                  onChange={(e) => setConfirmedEmail(e.target.value)}
                />
              </label>
            )}
            {actionData?.ok === false && (
              <p role="alert" className="wr-error">
                {actionData.error}
              </p>
            )}
            <button type="submit">Submit withdrawal request</button>
          </Form>
        )}

        {priorRequests.length > 0 && (
          <section className="wr-history">
            <h2>Previous requests</h2>
            <ul>
              {priorRequests.map((r: { reference: string; submittedAt: string; status: string }) => (
                <li key={r.reference}>
                  {r.reference} — {new Date(r.submittedAt).toLocaleString()} — {r.status}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </MyNaiaLayout>
  );
}
