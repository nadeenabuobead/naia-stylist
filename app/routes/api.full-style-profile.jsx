// GET loader: returns the customer's existing full-style-profile fields if present.
// This is the legacy profile format (styleDNA, preferredSilhouettes, etc.).
// The canonical current profile is api.save-style-profile.jsx (OnboardingProfile).
// The loader is preserved so full-style-profile/_index.tsx doesn't see a 404 on GET.

import { getCurrentNaiaCustomer } from "../lib/naia-session.server";

export async function loader({ request }) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return Response.json({ profile: null, authenticated: false }, { status: 401 });
  }

  // The old schema fields (styleDNA, preferredSilhouettes, etc.) do not exist in the
  // current schema. Return null so the component shows an empty profile form.
  return Response.json({ profile: null, authenticated: true });
}

// POST action: deprecated — the old schema fields no longer exist.
// full-style-profile/_index.tsx shows an error alert and the user cannot save via this route.
// The canonical write path is api.save-style-profile.jsx / OnboardingProfile.
export async function action() {
  return Response.json(
    {
      error: "deprecated",
      message: "This profile format is no longer supported. Use the Style Passport instead.",
    },
    { status: 410 },
  );
}
