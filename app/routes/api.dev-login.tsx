import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "~/db.server";
import {
  createNaiaSession,
  buildSessionCookieHeader,
} from "~/lib/naia-session.server";

const DEV_CUSTOMER_ID = "staging-dev-preview-001";

export async function loader({ request }: LoaderFunctionArgs) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (
    !process.env.STAGING_SEED_SECRET ||
    secret !== process.env.STAGING_SEED_SECRET
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: DEV_CUSTOMER_ID },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: { shopifyCustomerId: DEV_CUSTOMER_ID },
    });
  }

  const rawToken = await createNaiaSession(customer.id, request);

  return redirect("/my-naia", {
    headers: { "Set-Cookie": buildSessionCookieHeader(rawToken) },
  });
}
