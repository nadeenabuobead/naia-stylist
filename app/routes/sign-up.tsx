// app/routes/sign-up.tsx
//
// nAia's primary customer registration — email + password, via Clerk's
// hosted component. forceRedirectUrl sends every completed sign-up to
// auth.clerk-callback.tsx, which is where the actual nAia Customer row
// gets created or the identity-link flow gets started — see that route's
// own comment.

import { SignUp } from "@clerk/react-router";

export default function SignUpPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "var(--c-bg)",
      }}
    >
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/auth/clerk-callback" />
    </div>
  );
}
