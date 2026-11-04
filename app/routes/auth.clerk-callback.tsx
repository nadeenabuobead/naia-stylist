// app/routes/auth.clerk-callback.tsx
//
// Where Clerk's own <SignUp/> component redirects once it considers a
// brand-new customer signed up (forceRedirectUrl in sign-up.tsx). This is
// the ONE place resolveCustomerForClerkSignUp actually runs — every other
// route's loader just calls getCurrentNaiaCustomer/requireCurrentNaiaCustomer
// as before and gets back whatever Customer row (if any) ends up linked
// here.
//
// Also reachable on an ordinary returning sign-in with no linked Customer
// row yet (e.g. a legacy account that hasn't completed the one-time
// identity-link flow) — resolveCustomerForClerkSignUp is idempotent against
// a repeat call for the same clerkUserId, so there is no harm in routing
// both through the same place.

import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getAuth, clerkClient } from "@clerk/react-router/server";
import { resolveCustomerForClerkSignUp } from "~/lib/identity-linking.server";

export async function loader(args: LoaderFunctionArgs) {
  const { userId } = await getAuth(args);
  if (!userId) return redirect("/sign-in");

  const user = await clerkClient(args).users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) {
    // Clerk is configured to require an email for every account — this
    // would only happen under a configuration this app doesn't expect.
    // Fail toward sign-in rather than guessing at a Customer row with no
    // email to resolve one by.
    return redirect("/sign-in");
  }

  const result = await resolveCustomerForClerkSignUp({
    clerkUserId: userId,
    email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  switch (result.status) {
    case "created":
    case "already-linked":
      // my-naia._index.tsx's own loader computes passportState ("start" /
      // "continue" / "view") from this customer's onboardingProfile — a
      // brand-new customer and a fully-set-up returning one land on the
      // exact same route and each see the state that's actually true for
      // them. No separate "new customer" destination needed.
      return redirect("/my-naia");
    case "link-pending":
      return redirect("/account/link-identity");
    case "email-conflict":
      return redirect("/sign-in?error=email_in_use");
  }
}
