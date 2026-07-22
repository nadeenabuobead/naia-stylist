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
  // onboardingProfile is included by resolveNaiaSession
  return { profile: customer.onboardingProfile };
}

function PassportRow({
  label,
  value,
}: {
  label: string;
  value: string | string[] | number | null | undefined;
}) {
  const displayValue = Array.isArray(value)
    ? value.length > 0 ? value.join(", ") : null
    : value != null && value !== "" ? String(value) : null;

  return (
    <div className="mn-detail-row">
      <span className="mn-detail-row-label">{label}</span>
      <span
        className={`mn-detail-row-value${!displayValue ? " mn-detail-row-value--missing" : ""}`}
      >
        {displayValue ?? "Not yet answered"}
      </span>
    </div>
  );
}

export default function MyNaiaStylePassport() {
  const { profile } = useLoaderData<typeof loader>();

  if (!profile) {
    return (
      <MyNaiaLayout currentPath="/my-naia/style-passport">
        <section className="mn-section-shell" style={{ borderTop: 0, paddingTop: 0 }}>
          <div className="mn-section-shell-header">
            <div>
              <p className="mn-section-shell-eyebrow">Style Passport</p>
              <h1 className="mn-section-shell-title">Your style, on record.</h1>
            </div>
          </div>
          <p className="mn-section-shell-desc">
            Your Style Passport hasn&#8217;t been started yet. Answer a few questions and
            nAia will begin personalising every look it creates for you.
          </p>
          <div className="mn-passport-actions">
            <Link to="/full-style-profile" className="mn-btn-primary">
              Start Passport
            </Link>
          </div>
        </section>
      </MyNaiaLayout>
    );
  }

  return (
    <MyNaiaLayout currentPath="/my-naia/style-passport">

      <section className="mn-section-shell" style={{ borderTop: 0, paddingTop: 0 }}>
        <div className="mn-section-shell-header">
          <div>
            <p className="mn-section-shell-eyebrow">Style Passport</p>
            <h1 className="mn-section-shell-title">Your style, on record.</h1>
          </div>
        </div>
        {profile.completed ? (
          <p className="mn-section-shell-desc">
            Your passport is complete. Review and update your answers any time.
          </p>
        ) : (
          <p className="mn-section-shell-desc">
            Your passport is in progress. Continue answering to help nAia personalise further.
          </p>
        )}
      </section>

      {/* Section 1 — Style Identity */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Style Identity</span>
        </div>
        <div className="mn-passport-rows">
          <PassportRow label="Style Personalities" value={profile.stylePersonalities} />
          <PassportRow label="Style Icons" value={profile.styleIcons} />
          <PassportRow label="Favourite Colours" value={profile.favoriteColors} />
          <PassportRow label="Colours to Avoid" value={profile.avoidColors} />
        </div>
      </section>

      {/* Section 2 — Lifestyle */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Lifestyle &amp; Context</span>
        </div>
        <div className="mn-passport-rows">
          <PassportRow label="Lifestyle" value={profile.lifestyle} />
          <PassportRow label="Dresses For" value={profile.dressesFor} />
          <PassportRow label="Typical Day" value={profile.typicalDay} />
        </div>
      </section>

      {/* Section 3 — How you want to feel */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">How You Want to Feel</span>
        </div>
        <div className="mn-passport-rows">
          <PassportRow label="Desired Feeling" value={profile.desiredFeeling} />
          <PassportRow label="Desired Feelings (quiz)" value={profile.desiredFeelings} />
          <PassportRow label="Who You&#8217;re Becoming" value={profile.becoming} />
          <PassportRow label="Desired Impression" value={profile.desiredImpression} />
        </div>
      </section>

      {/* Section 4 — Confidence & Challenges */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Confidence &amp; Challenges</span>
        </div>
        <div className="mn-passport-rows">
          <PassportRow label="Current Mood About Style" value={profile.currentMood} />
          <PassportRow label="Confidence Blockers" value={profile.confidenceBlockers} />
          <PassportRow label="Style Struggles" value={profile.styleStruggles} />
          <PassportRow label="Style Support Needed" value={profile.styleSupport} />
          <PassportRow label="Comfort Level (1&#8211;10)" value={profile.comfortLevel} />
        </div>
      </section>

      {/* Section 5 — Fit & Preferences */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Fit &amp; Preferences</span>
        </div>
        <div className="mn-passport-rows">
          <PassportRow label="Fit Preferences" value={profile.fitPreferences} />
          <PassportRow label="Areas to Highlight" value={profile.bodyFocusAreas} />
          <PassportRow label="Areas to Minimise" value={profile.bodyAvoidAreas} />
          <PassportRow label="Budget Range" value={profile.budgetRange} />
          <PassportRow label="Shopping Habits" value={profile.shoppingHabits} />
        </div>
      </section>

      {/* Section 6 — Sizes */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Size Information</span>
        </div>
        <div className="mn-passport-rows">
          <PassportRow label="Top Size" value={profile.topSize} />
          <PassportRow label="Bottom Size" value={profile.bottomSize} />
          <PassportRow label="Dress Size" value={profile.dressSize} />
          <PassportRow label="Shoe Size" value={profile.shoeSize} />
        </div>
      </section>

      {/* CTAs */}
      <div className="mn-passport-actions">
        <Link to="/full-style-profile" className="mn-btn-primary">
          {profile.completed ? "Update Answers" : "Continue Passport"}
        </Link>
        {profile.completed && (
          <Link to="/my-naia" className="mn-btn-ghost">
            Back to Overview
          </Link>
        )}
      </div>

    </MyNaiaLayout>
  );
}
