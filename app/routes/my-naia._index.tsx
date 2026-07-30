import naiaStyles from "~/styles/naia-design-system.css?url";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import MyNaiaPageIntro from "~/components/my-naia/MyNaiaPageIntro";
import MyNaiaSection from "~/components/my-naia/MyNaiaSection";
import MyNaiaSectionHeader from "~/components/my-naia/MyNaiaSectionHeader";
import MyNaiaAction from "~/components/my-naia/MyNaiaAction";
import DevFixtureNotice from "~/components/my-naia/DevFixtureNotice";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCurrentNaiaCustomer(request);
  return { isDev: process.env.NODE_ENV !== "production" };
}

export default function MyNaiaOverview() {
  const { isDev } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout currentPath="/my-naia">
      <DevFixtureNotice show={isDev} />

      <MyNaiaPageIntro
        eyebrow="MY nAia"
        heading="Your personal style space"
      />

      <MyNaiaSection>
        <MyNaiaSectionHeader
          label="STYLE INTELLIGENCE"
          heading="Build and refine your style"
        />
        <div className="mn-action-list">
          <MyNaiaAction
            label="StyleMe"
            description="Get dressed for your day with NADINE pieces and your own wardrobe"
            to="/style-me"
          />
          <MyNaiaAction
            label="Style Passport"
            description="Your personal styling brief — answers that shape every recommendation"
            to="/passport"
          />
          <MyNaiaAction
            label="Personal Styling Analysis"
            description="Selfie-based read of your natural colouring and style signals"
            to="/passport/selfie"
          />
          <MyNaiaAction
            label="My nAia Model"
            description="Your personalised model for virtual try-on"
            to="/my-naia-model"
          />
        </div>
      </MyNaiaSection>

      <MyNaiaSection bordered>
        <MyNaiaSectionHeader
          label="YOUR WARDROBE"
          heading="Items you own and decisions you're making"
        />
        <div className="mn-action-list">
          <MyNaiaAction
            label="Digital Closet"
            description="Your photographed and assessed wardrobe items"
            to="/closet"
          />
          <MyNaiaAction
            label="Buy or Skip"
            description="Upload a piece you are considering — get an honest verdict"
            to="/buyskip"
          />
          <MyNaiaAction
            label="My Trend Edits"
            description="Trend reports filtered to your style and closet"
            to="/trends"
          />
        </div>
      </MyNaiaSection>

      <MyNaiaSection bordered>
        <MyNaiaSectionHeader
          label="COLLECTION & ACCOUNT"
          heading="Your saved work and account settings"
        />
        <div className="mn-action-list">
          <MyNaiaAction
            label="Saved Looks"
            description="Looks you have saved from your style sessions"
            to="/my-naia/saved"
          />
          <MyNaiaAction
            label="Settings & Privacy"
            description="Data controls, consent and account preferences"
            to="/settings"
          />
          <MyNaiaAction
            label="Orders"
            description="Your NADINE orders — available once Shopify account connection is complete"
            status="inactive"
          />
        </div>
      </MyNaiaSection>

      <MyNaiaSection bordered>
        <Form method="post" action="/auth/logout">
          <button
            type="submit"
            className="mn-action mn-action--signout"
            style={{
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              padding: "0",
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex",
            }}
          >
            <div className="mn-action-body">
              <p className="mn-action-label">Sign Out</p>
              <p className="mn-action-desc">End your current nAia session</p>
            </div>
          </button>
        </Form>
      </MyNaiaSection>
    </MyNaiaLayout>
  );
}
