// app/routes/my-naia.what-naia-notices.tsx
// Phase 5D — What nAia Is Noticing page.
//
// Shows CONFIRMED StyleTendency observations (max 5) with Accurate / Not quite feedback.
// Three page states:
//   A — no evidence yet (all below CANDIDATE threshold)
//   B — evidence accumulating but nothing CONFIRMED
//   C — one or more CONFIRMED observations

import {
  useLoaderData,
  useFetcher,
  type LoaderFunctionArgs,
  type LinksFunction,
} from "react-router";
import { data } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadConfirmedTendencies } from "~/lib/ai/taste-reconcile.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "What nAia Is Noticing | nAia" }];
}

// ── Loader ─────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const { confirmed, candidateCount } = await loadConfirmedTendencies(customer.id);

  return data({
    confirmed: confirmed.map(t => ({
      id:               t.id,
      dimension:        t.dimension,
      value:            t.value,
      observationFamily: t.observationFamily,
      claimText:        t.claimText,
      rationaleText:    t.rationaleText,
      customerFeedback: t.customerFeedback,
    })),
    candidateCount,
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

interface TendencyItem {
  id: string;
  dimension: string;
  value: string;
  observationFamily: string;
  claimText: string | null;
  rationaleText: string | null;
  customerFeedback: string | null;
}

function ObservationCard({ tendency }: { tendency: TendencyItem }) {
  const feedbackFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const isPending  = feedbackFetcher.state === "submitting";
  const savedFeedback = feedbackFetcher.data?.ok
    ? (feedbackFetcher.formData?.get("feedback") as string ?? null)
    : tendency.customerFeedback;

  function submit(fb: "accurate" | "not-quite") {
    feedbackFetcher.submit(
      { tendencyId: tendency.id, feedback: fb },
      { method: "POST", action: "/api/taste-observation-feedback", encType: "application/json" },
    );
  }

  const familyLabel =
    tendency.observationFamily === "WORKS_WELL" ? "CONSISTENTLY WORKS" : "RECURRING FRICTION";

  return (
    <div className="sp-card" style={{ padding: "24px", marginBottom: "16px" }}>
      <p className="sp-overline" style={{ marginBottom: "8px", opacity: 0.6, fontSize: "11px", letterSpacing: "0.08em" }}>
        {familyLabel}
      </p>
      <p style={{ marginBottom: "12px", lineHeight: 1.55 }}>{tendency.claimText}</p>
      {tendency.rationaleText && (
        <p style={{ marginBottom: "16px", fontSize: "14px", opacity: 0.65, lineHeight: 1.5 }}>
          {tendency.rationaleText}
        </p>
      )}

      {savedFeedback === "not-quite" ? (
        <p style={{ fontSize: "13px", opacity: 0.5, fontStyle: "italic" }}>Noted — nAia won't show this again.</p>
      ) : savedFeedback === "accurate" ? (
        <p style={{ fontSize: "13px", opacity: 0.5, fontStyle: "italic" }}>Glad this resonates.</p>
      ) : (
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            className="sp-btn sp-btn-outline"
            style={{ fontSize: "13px", padding: "8px 16px" }}
            disabled={isPending}
            onClick={() => submit("accurate")}
          >
            Accurate
          </button>
          <button
            className="sp-btn sp-btn-ghost"
            style={{ fontSize: "13px", padding: "8px 16px", opacity: 0.7 }}
            disabled={isPending}
            onClick={() => submit("not-quite")}
          >
            Not quite
          </button>
        </div>
      )}
    </div>
  );
}

export default function WhatNaiaNotices() {
  const { confirmed, candidateCount } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <div className="sp-shell" style={{ maxWidth: "680px", margin: "0 auto", padding: "0 20px" }}>

        <h1 className="sp-shell-title" style={{ marginBottom: "8px" }}>
          What nAia Is Noticing
        </h1>

        <p style={{ marginBottom: "6px", lineHeight: 1.6, opacity: 0.75, maxWidth: "560px" }}>
          Your Style Passport captures what you already know about your style. This page is where
          nAia shares patterns it learns from your reviews, outcomes and the way you describe the
          clothes you own.
        </p>
        <p style={{ marginBottom: "40px", lineHeight: 1.6, opacity: 0.5, fontSize: "14px", maxWidth: "560px" }}>
          These observations stay separate from your Passport and can evolve as you do.
        </p>

        {confirmed.length > 0 ? (
          // State C — CONFIRMED observations
          <>
            {confirmed.map(t => (
              <ObservationCard key={`${t.id}`} tendency={t} />
            ))}
          </>
        ) : candidateCount > 0 ? (
          // State B — evidence accumulating but nothing CONFIRMED
          <div className="sp-card" style={{ padding: "28px 24px" }}>
            <p style={{ lineHeight: 1.6, opacity: 0.75 }}>
              nAia has picked up something, but not quite enough to say it with confidence yet.
              Keep rating and reviewing your looks — it should become clearer shortly.
            </p>
          </div>
        ) : (
          // State A — no evidence yet
          <div className="sp-card" style={{ padding: "28px 24px" }}>
            <p
              className="sp-overline"
              style={{ marginBottom: "12px", opacity: 0.5, fontSize: "11px", letterSpacing: "0.1em" }}
            >
              STILL LEARNING
            </p>
            <p style={{ lineHeight: 1.65, opacity: 0.7, maxWidth: "460px" }}>
              Keep reviewing your looks and telling nAia what worked — as patterns become clear,
              they'll begin appearing here.
            </p>
          </div>
        )}
      </div>
    </MyNaiaLayout>
  );
}
