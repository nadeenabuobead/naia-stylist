import { useState } from "react";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

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

const COMM_PREFS = [
  "Editorial & new arrivals",
  "Order and delivery updates",
  "Styling recommendations from nAia",
  "Personalised trend reports",
];

function SectionBlock({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: "1px solid var(--fg-10)", paddingTop: "2.5rem" }}>
      <div className="mn-eyebrow">{eyebrow}</div>
      <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "1.5rem", letterSpacing: "0.02em", textTransform: "uppercase" }}>{title}</h2>
      <div style={{ marginTop: "1.5rem" }}>{children}</div>
    </section>
  );
}

function ControlRow({ specKey, onOpen, tone = "destructive" }: { specKey: ConfirmKey; onOpen: (k: ConfirmKey) => void; tone?: "destructive" | "neutral" }) {
  const spec = CONFIRMATIONS[specKey];
  const label = specKey === "download" ? "Request my data" : specKey === "delete-account" ? "Review account deletion" : "Continue";
  return (
    <div className="mn-control-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--ff-display)", fontWeight: 300, fontSize: "1.125rem", letterSpacing: "0.02em", textTransform: "uppercase", color: tone === "destructive" ? "var(--lipstick)" : "var(--fg)" }}>
          {spec.title}
        </div>
        <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", lineHeight: 1.625, color: "var(--fg-75)" }}>{spec.removes}</p>
      </div>
      <button type="button" className="mn-btn-outline" style={{ flexShrink: 0 }} onClick={() => onOpen(specKey)}>{label}</button>
    </div>
  );
}

export default function SettingsPage() {
  const [pending, setPending] = useState<ConfirmKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const confirm = () => {
    if (!pending) return;
    setStatus(
      pending === "delete-account"
        ? "Your account deletion request has been received and is being reviewed. You may cancel it from Settings before processing completes."
        : pending === "download"
        ? "Your data export request has been received. You will be notified when it is ready."
        : "Your request has been received."
    );
    setPending(null);
  };

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <SectionBlock eyebrow="Account Details" title="Account Details">
          <div>
            {[
              { label: "Name", value: "Nadine [Last Name]" },
              { label: "Email", value: "nadine@example.com" },
              { label: "Telephone", value: "+971 [placeholder]" },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", borderBottom: "1px solid var(--fg-10)", padding: "0.75rem 0" }}>
                <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{row.label}</span>
                <span style={{ fontSize: "0.9rem", color: "var(--fg-85)" }}>{row.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "1.5rem" }}>
            <button type="button" className="mn-btn-outline">Update Details</button>
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Delivery Addresses" title="Delivery Addresses">
          <div style={{ border: "1px solid var(--fg-10)", background: "var(--bg-50)", padding: "1.25rem" }}>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>Primary</div>
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
              [Recipient name]<br />
              [Address line 1]<br />
              [City], [Emirate]<br />
              United Arab Emirates
            </p>
            <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button type="button" className="mn-btn-outline">Edit</button>
              <button type="button" className="mn-btn-outline">Add Another Address</button>
            </div>
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Communication Preferences" title="Communication Preferences">
          <ul style={{ listStyle: "none", padding: 0, borderTop: "1px solid var(--fg-10)", borderBottom: "1px solid var(--fg-10)" }}>
            {COMM_PREFS.map((label) => (
              <li key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 0", borderBottom: "1px solid var(--fg-10)" }}>
                <span style={{ fontSize: "0.9rem", color: "var(--fg-85)" }}>{label}</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.24em", color: "var(--fg-70)", cursor: "pointer" }}>
                  <input type="checkbox" style={{ width: "1rem", height: "1rem", accentColor: "var(--fg)" }} />
                  Allow
                </label>
              </li>
            ))}
          </ul>
        </SectionBlock>

        <SectionBlock eyebrow="Image & Analysis Controls" title="Image & Analysis Controls">
          <p style={{ maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Manage the private images and derived analysis stored for your account.
          </p>
          <div style={{ marginTop: "1.5rem", display: "grid", gap: "0.75rem" }}>
            <ControlRow specKey="model" onOpen={setPending} />
            <ControlRow specKey="selfie" onOpen={setPending} />
            <ControlRow specKey="analysis" onOpen={setPending} />
            <ControlRow specKey="both" onOpen={setPending} />
          </div>
        </SectionBlock>

        <SectionBlock eyebrow="Data & Account" title="Data & Account">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <ControlRow specKey="download" onOpen={setPending} tone="neutral" />
            <ControlRow specKey="delete-account" onOpen={setPending} />
          </div>
        </SectionBlock>

        {status && <p className="mn-state-note">{status}</p>}
      </div>

      {/* Confirmation modal */}
      {pending && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        >
          <button
            type="button"
            aria-label="Close"
            style={{ position: "absolute", inset: 0, background: "oklch(0.22 0.035 45 / 0.40)", backdropFilter: "blur(4px)", border: "none", cursor: "default" }}
            onClick={() => setPending(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm action"
            style={{ position: "relative", zIndex: 1, maxHeight: "90vh", width: "100%", maxWidth: "32rem", overflowY: "auto", background: "var(--bg)", color: "var(--fg)", boxShadow: "0 -8px 32px oklch(0.22 0.035 45 / 0.12)" }}
          >
            <div style={{ borderBottom: "1px solid var(--fg-10)", padding: "1.5rem" }}>
              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>Confirm</div>
              <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "1.5rem", textTransform: "uppercase" }}>
                {CONFIRMATIONS[pending].title}
              </h3>
            </div>
            <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <p style={{ fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>{CONFIRMATIONS[pending].removes}</p>
              {pending !== "download" && pending !== "delete-account" && (
                <p style={{ fontSize: "0.8rem", lineHeight: 1.625, color: "var(--fg-65)" }}>This action cannot be undone.</p>
              )}
              {pending === "delete-account" && (
                <p style={{ fontSize: "0.8rem", lineHeight: 1.625, color: "var(--fg-65)" }}>
                  This does not delete your account immediately. Your request enters a review and processing period; you may cancel it before it completes.
                </p>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid var(--fg-10)", padding: "1.25rem 1.5rem" }}>
              <button type="button" className="mn-btn-outline" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className="mn-btn-primary" onClick={confirm}>
                {pending === "delete-account" ? "Request deletion of my account" : pending === "download" ? "Request my data" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
