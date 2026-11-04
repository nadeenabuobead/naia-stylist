// app/routes/account.link-identity.tsx
//
// Where a brand-new Clerk sign-up lands when their email collided with an
// existing, unlinked Customer row — see identity-linking.server.ts for the
// full flow this is the UI for. Reachable only via auth.clerk-callback.tsx's
// "link-pending" redirect.

import { useState } from "react";
import { Form, redirect, useActionData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getAuth } from "@clerk/react-router/server";
import { confirmIdentityLink, abandonIdentityLink } from "~/lib/identity-linking.server";

export async function loader(args: LoaderFunctionArgs) {
  const { userId } = await getAuth(args);
  if (!userId) return redirect("/sign-in");
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const { userId } = await getAuth(args);
  if (!userId) return redirect("/sign-in");

  const formData = await args.request.formData();
  const intent = formData.get("intent");

  if (intent === "abandon") {
    await abandonIdentityLink({ clerkUserId: userId });
    return redirect("/sign-in");
  }

  const code = String(formData.get("code") ?? "").trim();
  const result = await confirmIdentityLink({ clerkUserId: userId, code });

  if (result.status === "confirmed") return redirect("/my-naia");
  return { error: result.status };
}

const ERROR_COPY: Record<string, string> = {
  "not-found": "This link request is no longer valid. Please sign in again.",
  expired: "That code has expired. Please sign in again to request a new one.",
  "too-many-attempts": "Too many incorrect attempts. Please sign in again to request a new code.",
  "incorrect-code": "That code wasn't right. Please check your email and try again.",
};

export default function LinkIdentityPage() {
  const actionData = useActionData() as { error?: string } | undefined;
  const [code, setCode] = useState("");

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ maxWidth: 420, width: "100%" }}>
        <h1>We found an existing nAia account with this email</h1>
        <p>
          Enter the 6-digit code we sent to that email address to confirm it's you and continue with all your
          existing Closet items, Style Passport answers, and membership — nothing is lost.
        </p>
        <Form method="post">
          <input
            name="code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
          />
          <button type="submit">Confirm</button>
        </Form>
        {actionData?.error && <p role="alert">{ERROR_COPY[actionData.error] ?? "Something went wrong. Please try again."}</p>}
        <Form method="post">
          <input type="hidden" name="intent" value="abandon" />
          <button type="submit">This isn't me</button>
        </Form>
      </div>
    </div>
  );
}
