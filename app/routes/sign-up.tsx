// app/routes/sign-up.tsx
//
// nAia's primary customer registration — email + password, via Clerk's
// hosted <SignUp/> component. See sign-in.tsx's own header comment for the
// design-integration points (appearance prop vs. headless hooks) — the same
// applies here; this file renders Clerk's unstyled default appearance.
//
// forceRedirectUrl always sends a completed sign-up through
// auth.clerk-callback.tsx — that's where the actual nAia Customer row gets
// created or the identity-link flow begins, never here.

import { useSearchParams } from "react-router";
import { SignUp } from "@clerk/react-router";

export default function SignUpPage() {
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return_to");
  const callbackUrl = returnTo ? `/auth/clerk-callback?return_to=${encodeURIComponent(returnTo)}` : "/auth/clerk-callback";

  return <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl={callbackUrl} />;
}
