import { useState } from "react";
import type { LoaderFunctionArgs, LinksFunction } from "react-router";
import { useLoaderData, Link, Form } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "Settings & Privacy | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  return {
    firstName: customer.firstName,
    lastName:  customer.lastName,
    email:     customer.email,
  };
}

// ── Confirmation specs ────────────────────────────────────────────────────────

type ConfirmKey = "model" | "selfie" | "analysis" | "both" | "download" | "delete-account";

const CONFIRMATIONS: Record<ConfirmKey, { title: string; removes: string }> = {
  model: {
    title: "Delete My nAia Model",
    removes: "Your saved private model will be removed. Virtual previews that depend on the model will no longer be available until you create a new one. Saved looks and StyleMe recommendations are not deleted.",
  },
  selfie: {
    title: "Delete selfie only",
    removes: "Your uploaded selfie will be removed. Your existing Personal Styling Analysis is kept until you also choose to delete it.",
  },
  analysis: {
    title: "Delete styling analysis only",
    removes: "Your Personal Styling Analysis will be removed. Your selfie is kept until you also choose to delete it.",
  },
  both: {
    title: "Delete both selfie and analysis",
    removes: "Your selfie and your Personal Styling Analysis will both be removed. You can create them again at any time.",
  },
  download: {
    title: "Download or request my data",
    removes: "A copy of your NADINE and nAia data will be prepared for you to download or receive by email. You will be notified when it is ready. This may take up to 30 days depending on the volume of data.",
  },
  "delete-account": {
    title: "Review account deletion",
    removes: "Your account, saved looks, Style Passport, My Closet, My nAia Model and eligible nAia data will be scheduled for removal in accordance with our Privacy Policy and applicable law. Some order, payment or legal records may need to be retained. Deletion is not immediate — a processing period applies, and you may cancel your request before processing completes.",
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ControlRow({ specKey, onOpen, tone = "destructive" }: {
  specKey: ConfirmKey;
  onOpen: (k: ConfirmKey) => void;
  tone?: "destructive" | "neutral";
}) {
  const spec = CONFIRMATIONS[specKey];
  const btnLabel =
    specKey === "download"       ? "Request my data" :
    specKey === "delete-account" ? "Review account deletion" :
    "Continue";
  return (
    <div className="set-control-row">
      <div>
        <div className={`set-control-title${tone === "destructive" ? " set-control-title--destructive" : ""}`}>
          {spec.title}
        </div>
        <p className="set-control-desc">{spec.removes}</p>
      </div>
      <button type="button" className="sp-btn-outline" onClick={() => onOpen(specKey)}>
        {btnLabel}
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { firstName, lastName, email } = useLoaderData<typeof loader>();
  const [pending, setPending] = useState<ConfirmKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "—";

  function confirm() {
    if (!pending) return;
    if (pending === "delete-account") {
      setStatus("Your account deletion request has been received and is being reviewed. You may cancel it from Settings before processing completes.");
    } else if (pending === "download") {
      setStatus("Your data export request has been received. You will be notified when it is ready.");
    } else {
      setStatus("Your request has been received.");
    }
    setPending(null);
  }

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Settings & Privacy</div>
        <h1 className="sp-shell-title">Your Account</h1>
      </div>

      {/* Account Details */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Account Details</div>
        <h2 className="set-section-title">Account Details</h2>
        <dl className="sp-detail-list">
          <div className="sp-detail-row">
            <dt className="sp-detail-label">Name</dt>
            <dd className="sp-detail-value">{fullName}</dd>
          </div>
          <div className="sp-detail-row">
            <dt className="sp-detail-label">Email</dt>
            <dd className="sp-detail-value">{email || "—"}</dd>
          </div>
          <div className="sp-detail-row">
            <dt className="sp-detail-label">Telephone</dt>
            <dd className="sp-detail-value" style={{ color: "var(--naia-muted)", fontStyle: "italic" }}>Not provided</dd>
          </div>
        </dl>
        <div style={{ marginTop: "20px" }}>
          <button type="button" className="sp-btn-outline">Update Details</button>
        </div>
      </section>

      {/* Delivery Addresses */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Delivery Addresses</div>
        <h2 className="set-section-title">Delivery Addresses</h2>
        <div className="set-address-box">
          <div style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "9px", letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--naia-muted)", marginBottom: "10px" }}>Primary</div>
          <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", lineHeight: 1.75, color: "rgba(34,21,22,0.75)" }}>
            Delivery addresses are managed via your NADINE account.
          </p>
        </div>
        <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <button type="button" className="sp-btn-outline">Edit</button>
          <button type="button" className="sp-btn-outline">Add Another Address</button>
        </div>
      </section>

      {/* Communication Preferences */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Communication Preferences</div>
        <h2 className="set-section-title">Communication Preferences</h2>
        <ul className="set-comm-list">
          {["Editorial & new arrivals", "Order and delivery updates", "Styling recommendations from nAia", "Personalised trend reports"].map(label => (
            <li key={label} className="set-comm-row">
              <span>{label}</span>
              <label className="set-comm-toggle">
                <input type="checkbox" className="set-comm-check" />
                Allow
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* Image & Analysis Controls */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Image & Analysis Controls</div>
        <h2 className="set-section-title">Image & Analysis Controls</h2>
        <p className="sp-shell-desc" style={{ marginBottom: "24px" }}>
          Manage the private images and derived analysis stored for your account. Each option explains exactly what will be removed.
        </p>
        <div className="set-controls">
          <ControlRow specKey="model"    onOpen={setPending} />
          <ControlRow specKey="selfie"   onOpen={setPending} />
          <ControlRow specKey="analysis" onOpen={setPending} />
          <ControlRow specKey="both"     onOpen={setPending} />
        </div>
      </section>

      {/* Data & Account */}
      <section className="bos-section">
        <div className="set-section-eyebrow">Data & Account</div>
        <h2 className="set-section-title">Data & Account</h2>
        <div className="set-controls">
          <ControlRow specKey="download"       onOpen={setPending} tone="neutral" />
          <ControlRow specKey="delete-account" onOpen={setPending} />
        </div>
      </section>

      {/* Privacy statement */}
      <section className="bos-section">
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "15px", fontStyle: "italic", lineHeight: 1.75, color: "rgba(34,21,22,0.8)", maxWidth: "640px", marginBottom: "12px" }}>
          nAia stores your Style Passport, closet items, styling sessions, post-wear reviews, and virtual try-on model in order to personalise your experience. Your data is never sold or shared with third parties.
        </p>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", fontStyle: "italic", lineHeight: 1.7, color: "var(--naia-muted)" }}>
          To request a copy of your data or request deletion, email{" "}
          <a href="mailto:privacy@naiabynadine.com" style={{ color: "var(--naia-accent)" }}>privacy@naiabynadine.com</a>.
          Data deletion requests are processed within 30 days.
        </p>
      </section>

      {/* Sign Out */}
      <section className="bos-section">
        <Form method="post" action="/auth/logout">
          <button type="submit" className="sp-btn-ghost">Sign Out</button>
        </Form>
      </section>

      {/* Status note */}
      {status && (
        <div className="sp-state-note" style={{ marginTop: "32px" }}>
          {status}{" "}
          <button type="button" className="sp-save-inline-btn" onClick={() => setStatus(null)}>Dismiss</button>
        </div>
      )}

      {/* Confirmation modal */}
      {pending && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Confirm</div>
            <h3 id="settings-confirm-title" className="dc-modal-title">{CONFIRMATIONS[pending].title}</h3>
            <p className="dc-modal-desc">{CONFIRMATIONS[pending].removes}</p>
            {pending !== "download" && pending !== "delete-account" && (
              <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                This action cannot be undone.
              </p>
            )}
            {pending === "delete-account" && (
              <p style={{ fontFamily: "var(--naia-ff-ui)", fontSize: "11px", color: "var(--naia-muted)", marginBottom: "8px" }}>
                This does not delete your account immediately. Your request enters a review and processing period; you may cancel it before it completes.
              </p>
            )}
            <div className="dc-modal-actions">
              <button type="button" className="sp-btn-ghost" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className="sp-btn-primary" onClick={confirm}>
                {pending === "delete-account" ? "Request deletion of my account" :
                 pending === "download"       ? "Request my data" :
                 "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
