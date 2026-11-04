// app/routes/sign-in.tsx
//
// nAia's primary customer sign-in — email + password, via Clerk's hosted
// <SignIn/> component. Password recovery ("Forgot password?") and
// persistent sessions are both Clerk's own built-in behavior; no custom
// nAia code or email-sending is involved in either.
//
// ── DESIGN INTEGRATION POINTS (visual design is being handled separately —
// this file intentionally renders Clerk's UNSTYLED default appearance, no
// layout/branding decisions made here) ──────────────────────────────────────
//
// Clerk exposes exactly two ways to make this match nAia's existing visual
// identity (root.jsx's CSS custom properties — --c-bg, --c-ink, --c-burg,
// --c-surface, --ff-display, --ff-body, etc. — see root.jsx's <style> block):
//
//   1. The `appearance` prop (https://clerk.com/docs/guides/customizing-clerk/appearance-prop/overview)
//      — `appearance.variables` (colorPrimary, colorBackground, colorText,
//      fontFamily, borderRadius, ...) theme the hosted component without
//      touching its markup/behavior. `appearance.elements` allows targeted
//      CSS-in-JS per internal part (e.g. `formButtonPrimary`,
//      `card`, `headerTitle`) for anything variables alone can't reach.
//      This is additive on top of this file — pass
//      `appearance={{ variables: { colorPrimary: "var(--c-burg)", ... } }}`
//      once the token mapping is decided; nothing else here needs to change.
//   2. A fully custom UI built on Clerk's headless hooks (`useSignIn` from
//      "@clerk/react-router") instead of the `<SignIn/>` component — total
//      layout control, more code to own (the multi-step/MFA/error-state
//      machine `<SignIn/>` otherwise handles for free). Only worth it if
//      the design calls for something `appearance` genuinely can't express.
//
// Until that decision is made, this route works exactly as-is — it's a
// placeholder for FUNCTION (the redirect/return_to wiring below), not look.

import { useSearchParams } from "react-router";
import { SignIn } from "@clerk/react-router";

export default function SignInPage() {
  const [searchParams] = useSearchParams();
  // requireCurrentNaiaCustomer (clerk-session.server.ts) sets return_to to
  // the page the customer was trying to reach — forwarded through to
  // auth.clerk-callback.tsx, which re-validates it server-side via the same
  // validateReturnTo used by the legacy Shopify flow before it's ever used
  // in a redirect. Never trust this value itself; it's just carried along.
  const returnTo = searchParams.get("return_to");
  const callbackUrl = returnTo ? `/auth/clerk-callback?return_to=${encodeURIComponent(returnTo)}` : "/auth/clerk-callback";

  return <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl={callbackUrl} />;
}
