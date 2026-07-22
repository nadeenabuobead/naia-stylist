// Staging-only developer login bypass.
// Returns 404 unless DEV_LOGIN_ENABLED=true is set as a Vercel env var on the staging project.
// Never set DEV_LOGIN_ENABLED on the production Vercel project.

import { redirect } from "react-router";
import { Form, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "~/db.server";
import { createNaiaSession, buildSessionCookieHeader } from "~/lib/naia-session.server";
import { validateReturnTo } from "~/lib/shopify-customer-oauth.server";

const DEV_SHOPIFY_ID = "dev-staging-001";

function guard() {
  if (!process.env.DEV_LOGIN_ENABLED) {
    throw new Response("Not Found", { status: 404 });
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  guard();
  const url = new URL(request.url);
  const returnTo = validateReturnTo(url.searchParams.get("return_to"));
  return { returnTo };
}

export async function action({ request }: ActionFunctionArgs) {
  guard();
  const form = await request.formData();
  const returnTo = validateReturnTo(form.get("return_to") as string | null);

  let customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: DEV_SHOPIFY_ID },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { shopifyCustomerId: DEV_SHOPIFY_ID },
    });
  }

  const rawToken = await createNaiaSession(customer.id, request);
  return redirect(returnTo, {
    headers: { "Set-Cookie": buildSessionCookieHeader(rawToken) },
  });
}

export default function DevLogin() {
  const { returnTo } = useLoaderData<typeof loader>();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
        background: "#f9f9f8",
      }}
    >
      <div
        style={{
          border: "1px solid #ddd",
          padding: "2rem",
          maxWidth: "22rem",
          width: "100%",
          background: "#fff",
        }}
      >
        <div
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#999",
            marginBottom: "0.75rem",
          }}
        >
          Staging · Dev Login
        </div>
        <p
          style={{
            fontSize: "0.875rem",
            color: "#444",
            marginBottom: "1.5rem",
            lineHeight: 1.65,
          }}
        >
          Logs in as the staging development customer, bypassing Shopify OAuth.
          Only available when{" "}
          <code style={{ background: "#f4f4f4", padding: "0 0.2rem", fontSize: "0.8rem" }}>
            DEV_LOGIN_ENABLED
          </code>{" "}
          is set on this deployment.
        </p>
        <Form method="post">
          <input type="hidden" name="return_to" value={returnTo} />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              background: "#111",
              color: "#fff",
              border: "none",
              fontSize: "0.72rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Log In as Dev Customer
          </button>
        </Form>
      </div>
    </div>
  );
}
