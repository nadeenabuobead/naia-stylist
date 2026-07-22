import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  return { profile: customer.onboardingProfile };
}

function DetailRow({ label, value }: { label: string; value: string | string[] | number | null | undefined }) {
  const display = Array.isArray(value)
    ? value.length > 0 ? value.join(" · ") : null
    : value != null && value !== "" ? String(value) : null;

  return (
    <div className="mn-detail-row">
      <span className="mn-detail-label">{label}</span>
      <span className="mn-detail-value" style={!display ? { color: "var(--lipstick)" } : undefined}>
        {display ?? "Missing — please complete"}
      </span>
    </div>
  );
}

const PASSPORT_SECTIONS = [
  {
    eyebrow: "Style Identity",
    rows: [
      { label: "Style Personalities", key: "stylePersonalities" },
      { label: "Style Icons", key: "styleIcons" },
      { label: "Favourite Colours", key: "favoriteColors" },
      { label: "Colours to Avoid", key: "avoidColors" },
    ],
  },
  {
    eyebrow: "Lifestyle & Context",
    rows: [
      { label: "Lifestyle", key: "lifestyle" },
      { label: "Dresses For", key: "dressesFor" },
      { label: "Typical Day", key: "typicalDay" },
    ],
  },
  {
    eyebrow: "How You Want to Feel",
    rows: [
      { label: "Desired Feeling", key: "desiredFeeling" },
      { label: "Desired Feelings (quiz)", key: "desiredFeelings" },
      { label: "Who You're Becoming", key: "becoming" },
      { label: "Desired Impression", key: "desiredImpression" },
    ],
  },
  {
    eyebrow: "Confidence & Challenges",
    rows: [
      { label: "Current Mood About Style", key: "currentMood" },
      { label: "Confidence Blockers", key: "confidenceBlockers" },
      { label: "Style Struggles", key: "styleStruggles" },
      { label: "Style Support Needed", key: "styleSupport" },
      { label: "Comfort Level (1–10)", key: "comfortLevel" },
    ],
  },
  {
    eyebrow: "Fit & Preferences",
    rows: [
      { label: "Fit Preferences", key: "fitPreferences" },
      { label: "Areas to Highlight", key: "bodyFocusAreas" },
      { label: "Areas to Minimise", key: "bodyAvoidAreas" },
      { label: "Budget Range", key: "budgetRange" },
      { label: "Shopping Habits", key: "shoppingHabits" },
    ],
  },
  {
    eyebrow: "Size Information",
    rows: [
      { label: "Top Size", key: "topSize" },
      { label: "Bottom Size", key: "bottomSize" },
      { label: "Dress Size", key: "dressSize" },
      { label: "Shoe Size", key: "shoeSize" },
    ],
  },
] as const;

export default function MyNaiaStylePassport() {
  const { profile } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">

        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header section */}
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div className="mn-eyebrow">Style Passport</div>
              <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(1.875rem,5vw,2.25rem)", lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                Your Style Passport
              </h1>
            </div>
            {/* Sample badge */}
            <span className="mn-sample-badge">
              <span className="mn-sample-dot" aria-hidden="true" />
              Sample data
            </span>
          </div>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Your Style Passport guides every StyleMe recommendation. Update it whenever your
            preferences evolve — changes flow through the rest of nAia immediately.
          </p>
        </section>

        {/* Status */}
        {profile && (
          <div style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "1.5rem" }}>
            <div className="mn-eyebrow">Status</div>
            <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", color: "var(--fg-85)" }}>
              {profile.completed ? "Your Style Passport is up to date." : "A few details are still missing."}
            </p>
          </div>
        )}

        {!profile ? (
          <>
            <p className="mn-state-note">
              Your Style Passport hasn&#8217;t been started yet. Answer a few questions and
              nAia will begin personalising every look it creates for you.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <Link to="/full-style-profile" className="mn-btn-primary">Start Passport</Link>
            </div>
          </>
        ) : (
          <>
            {/* All sections */}
            {PASSPORT_SECTIONS.map((section) => (
              <section key={section.eyebrow} className="mn-section">
                <div className="mn-section-head">
                  <div className="mn-eyebrow">{section.eyebrow}</div>
                </div>
                <div className="mn-section-body">
                  {section.rows.map((row) => (
                    <DetailRow
                      key={row.key}
                      label={row.label}
                      value={(profile as Record<string, unknown>)[row.key] as string | string[] | number | null}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Actions */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <Link to="/full-style-profile" className="mn-btn-primary">
                {profile.completed ? "Update Answers" : "Continue Passport"}
              </Link>
              {!profile.completed && (
                <p className="mn-state-note" style={{ flex: "1 1 auto", margin: 0 }}>
                  You&#8217;ll resume where you left off. All previous answers are preserved.
                </p>
              )}
            </div>
          </>
        )}

      </div>
    </MyNaiaLayout>
  );
}
