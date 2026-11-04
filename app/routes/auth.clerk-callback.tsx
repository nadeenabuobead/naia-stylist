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
// Reused, not reimplemented — same "/", not "//", length-capped check the
// legacy Shopify flow already applies to its own return_to. sign-in.tsx/
// sign-up.tsx forward this value unvalidated; this is the one place it's
// ever actually used in a redirect, so this is where it's checked.
import { validateReturnTo } from "~/lib/shopify-customer-oauth.server";

export async function loader(args: LoaderFunctionArgs) {
  const { userId } = await getAuth(args);
  if (!userId) return redirect("/sign-in");

  const returnTo = validateReturnTo(new URL(args.request.url).searchParams.get("return_to"));

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
      // A brand-new customer has no data anywhere yet — an inherited
      // return_to (e.g. a deep link to /closet from before they had an
      // account) wouldn't make sense to honor. my-naia._index.tsx's own
      // passportState ("start"/"continue"/"view") logic is what correctly
      // renders this customer's actual (empty) state.
      return redirect("/my-naia");
    case "already-linked":
      // A returning customer — send them back to wherever they were
      // actually trying to go, same as the legacy Shopify flow did.
      return redirect(returnTo);
    case "link-pending":
      return redirect("/account/link-identity");
    case "email-conflict":
      return redirect("/sign-in?error=email_in_use");
    case "locked":
      // Deliberately the same destination as "link-pending" — not a
      // different error page. See startIdentityLink's own comment: this
      // flow never reveals "this specific email is locked" as a distinct,
      // more specific signal than "a request was made."
      return redirect("/account/link-identity?error=locked");
  }
}
