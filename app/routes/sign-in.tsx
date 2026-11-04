// app/routes/sign-in.tsx
//
// nAia's primary customer sign-in — email + password, via Clerk's hosted
// component. Password recovery ("Forgot password?") is built into this
// component; no custom nAia code or email-sending is involved in that flow,
// Clerk's own infrastructure handles it end to end.
//
// routing="path" + the matching sign-up/* registration in app/routes.ts is
// what lets Clerk navigate its own internal multi-step sub-paths (e.g.
// /sign-in/factor-one for a step-up verification challenge) without a full
// page reload.

import { SignIn } from "@clerk/react-router";

export default function SignInPage() {
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
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </div>
  );
}
